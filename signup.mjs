// POST /api/signup — step 2. Creates the customer's SphereMail account using
// the emailed code, then signs in once, opens the subscription for the chosen
// plan and signs straight out again. Tokens never leave this function.
//
// The customer adds their card and uploads ID in the SphereMail portal after
// this — card details never touch this site.
import { json, guardJsonPost, clientIp, rateLimited, verifyTurnstile, newRef, log } from '../lib/http.mjs';
import { validateSignup, isBot, deriveUsername, TERMS, COUNTRIES } from '../lib/validate.mjs';
import { planIdFor } from '../lib/plans.mjs';
import { getClient, isMock } from '../lib/spheremail.mjs';

function suffix() {
  return String(crypto.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, '0');
}

export default async (req, context) => {
  const env = process.env;
  const guard = await guardJsonPost(req, env);
  if (guard.response) return guard.response;
  const input = guard.body;
  const ref = newRef();
  const ip = clientIp(req, context);

  if (isBot(input)) { log('signup_honeypot', { ref }); return json(200, { ok: true, subscribed: true }); }

  if (rateLimited(`signup:ip:${ip}`, 8, 15 * 60_000)) {
    return json(429, { ok: false, code: 'RATE_LIMITED', message: 'Too many attempts. Please wait fifteen minutes and try again.' }, { 'retry-after': '900' });
  }

  const { ok, errors, value } = validateSignup(input);
  if (!ok) return json(422, { ok: false, code: 'VALIDATION', fields: errors });

  const planId = planIdFor(value.plan, env);
  if (!planId) {
    return json(409, { ok: false, code: 'PLAN_UNAVAILABLE', message: 'Online signup for this plan isn’t open yet. Message us and we’ll set it up for you.' });
  }

  // Bot check again on this step, so the emailed code can't be brute-forced by script.
  if (!isMock(env)) {
    const ts = await verifyTurnstile(input.turnstileToken, ip, env, 'signup');
    if (!ts.ok) {
      log('signup_turnstile_fail', { ref, reason: ts.reason });
      const msg = ts.reason === 'not-configured'
        ? 'Online signup is temporarily unavailable. Please message us and we’ll set you up.'
        : 'We couldn’t confirm you’re not a robot. Please try the check again.';
      return json(ts.reason === 'not-configured' ? 503 : 400, { ok: false, code: 'BOT_CHECK', message: msg, ref });
    }
  }

  const sm = getClient(env);
  const portalUrl = env.SPHEREMAIL_PORTAL_URL || null;

  // 1. Create the account.
  let username;
  try {
    const { countryId, stateId } = await sm.resolveLocation(value.country, COUNTRIES[value.country], value.region);
    username = deriveUsername(value.email, suffix());
    if (!(await sm.isUsernameAvailable(username))) username = deriveUsername(value.email, suffix() + suffix().slice(0, 2));

    await sm.createAccount({
      first_name: value.firstName,
      last_name: value.lastName,
      user_name: username,
      company_name: value.company || undefined,
      email: value.email,
      password: value.password,
      phone: value.phone,
      country_id: countryId,
      street: value.street,
      city: value.city,
      state_id: stateId,
      zip_code: value.postcode || env.SPHEREMAIL_DEFAULT_ZIP || '00000',
      verification_code: value.code,
      accept_policy: true,
      accept_poicy: true, // spelled this way in SphereMail's published example; sent both ways to be safe
      accept_terms: true,
    });
    log('signup_account_created', { ref, plan: value.plan });
  } catch (e) {
    log('signup_account_error', { ref, status: e.status || 0, code: e.code || 'UNKNOWN' });
    // Don't reveal whether an email or username is registered: drop those
    // field errors and answer generically. Everything else is passed through.
    const fields = { ...(e.fields || {}) };
    const identity = Boolean(fields.email);
    delete fields.email;
    if (Object.keys(fields).length) return json(422, { ok: false, code: 'VALIDATION', fields, ref });
    if (identity) return json(422, { ok: false, code: 'VALIDATION', message: 'We couldn’t create an account with those details. If you already have a mailbox account, sign in to it instead — or message us and we’ll sort it out.', ref });
    if (e.status === 422) return json(422, { ok: false, code: 'VALIDATION', fields: { code: 'That code is incorrect or has expired. Go back and request a new one.' }, ref });
    return json(502, { ok: false, code: 'UPSTREAM', message: 'We couldn’t create your account just now. Nothing has been charged. Please try again, or message us.', ref });
  }

  // 2. Open the subscription. If this fails the account still exists, so the
  //    customer is sent to the portal to choose the plan there — not asked to start over.
  let token = null;
  try {
    const session = await sm.login(value.email, value.password);
    token = session?.access_token || null;
    if (!token) throw Object.assign(new Error('no token'), { code: 'NO_TOKEN' });
    await sm.subscribe(token, planId, TERMS[value.term]);
    log('signup_subscribed', { ref, plan: value.plan, term: value.term });
    return json(201, { ok: true, subscribed: true, portalUrl });
  } catch (e) {
    log('signup_subscribe_error', { ref, status: e.status || 0, code: e.code || 'UNKNOWN' });
    return json(201, { ok: true, subscribed: false, portalUrl, ref,
      message: 'Your account is set up. To finish, sign in to the mailbox portal and choose your plan there — it takes a minute.' });
  } finally {
    if (token) await sm.logout(token);
  }
};

// Platform rate limit, counted across all instances (the in-memory limit above is per instance).
export const config = { path: '/api/signup', rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
