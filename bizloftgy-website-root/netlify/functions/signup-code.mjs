// POST /api/signup/code — step 1 of signup. Checks the details, confirms the
// email isn't already registered with SphereMail, and asks SphereMail to email
// a verification code. This is the only endpoint that causes an email to be
// sent, so it carries the bot check (Turnstile) and the tightest limits.
import { json, guardJsonPost, clientIp, rateLimited, verifyTurnstile, newRef, log } from '../lib/http.mjs';
import { validateCodeRequest, isBot } from '../lib/validate.mjs';
import { planIdFor } from '../lib/plans.mjs';
import { getClient, isMock } from '../lib/spheremail.mjs';

export default async (req, context) => {
  const env = process.env;
  const guard = await guardJsonPost(req, env);
  if (guard.response) return guard.response;
  const input = guard.body;
  const ref = newRef();
  const ip = clientIp(req, context);

  // Bots that fill the hidden field get a normal-looking reply and nothing happens.
  if (isBot(input)) { log('signup_code_honeypot', { ref }); return json(200, { ok: true }); }

  if (rateLimited(`code:ip:${ip}`, 5, 15 * 60_000)) {
    return json(429, { ok: false, code: 'RATE_LIMITED', message: 'Too many attempts. Please wait fifteen minutes and try again.' }, { 'retry-after': '900' });
  }

  const { ok, errors, value } = validateCodeRequest(input);
  if (!ok) return json(422, { ok: false, code: 'VALIDATION', fields: errors });

  if (!planIdFor(value.plan, env)) {
    return json(409, { ok: false, code: 'PLAN_UNAVAILABLE', message: 'Online signup for this plan isn’t open yet. Message us and we’ll set it up for you.' });
  }

  if (!isMock(env)) {
    const ts = await verifyTurnstile(input.turnstileToken, ip, env, 'signup');
    if (!ts.ok) {
      log('signup_code_turnstile_fail', { ref, reason: ts.reason });
      const msg = ts.reason === 'not-configured'
        ? 'Online signup is temporarily unavailable. Please message us and we’ll set you up.'
        : 'We couldn’t confirm you’re not a robot. Please try the check again.';
      return json(ts.reason === 'not-configured' ? 503 : 400, { ok: false, code: 'BOT_CHECK', message: msg, ref });
    }
  }

  // Counted only after the bot check, so nobody can use up another person's quota.
  if (rateLimited(`code:email:${value.email}`, 3, 60 * 60_000)) {
    return json(429, { ok: false, code: 'RATE_LIMITED', message: 'We’ve already sent a few codes to this address. Check your inbox and spam folder, or try again in an hour.' }, { 'retry-after': '3600' });
  }

  const sm = getClient(env);
  try {
    const free = await sm.isEmailAvailable(value.email);
    if (!free) {
      return json(409, { ok: false, code: 'EMAIL_TAKEN', fields: { email: 'This email already has a SphereMail account. Sign in to your mailbox portal to add a plan, or use a different email.' } });
    }
    await sm.sendVerificationCode(value.email);
    log('signup_code_sent', { ref, plan: value.plan });
    return json(200, { ok: true });
  } catch (e) {
    log('signup_code_error', { ref, status: e.status || 0, code: e.code || 'UNKNOWN' });
    if (e.fields && Object.keys(e.fields).length) return json(422, { ok: false, code: 'VALIDATION', fields: e.fields, ref });
    return json(502, { ok: false, code: 'UPSTREAM', message: 'Our mailbox provider didn’t respond. Please try again in a minute.', ref });
  }
};

// Platform rate limit, counted across all instances (the in-memory limits above are per instance).
export const config = { path: '/api/signup/code', rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
