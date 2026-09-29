// GET /api/plans — tells the page which plans can be signed up for online and
// hands over the public Turnstile site key. Nothing secret is returned: plan IDs
// stay on the server and the site key is public by design.
import { json } from '../lib/http.mjs';
import { PLAN_KEYS } from '../lib/validate.mjs';
import { planIdFor } from '../lib/plans.mjs';
import { isMock } from '../lib/spheremail.mjs';

export default async (req) => {
  if (req.method !== 'GET') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, { allow: 'GET' });
  const env = process.env;
  const mock = isMock(env);
  const available = Object.fromEntries(PLAN_KEYS.map((k) => [k, mock || Boolean(planIdFor(k, env))]));

  // Hosted mode: when SPHEREMAIL_SIGNUP_URL is set, the listed plans send the
  // customer to SphereMail's own signup page instead of the in-page form.
  const signupUrl = /^https:\/\/[^\s]+$/.test(env.SPHEREMAIL_SIGNUP_URL || '') ? env.SPHEREMAIL_SIGNUP_URL : null;
  const hosted = {};
  if (signupUrl) {
    const keys = (env.SPHEREMAIL_HOSTED_PLANS || 'mailbox_only,virtual_office').split(',').map((k) => k.trim());
    for (const k of PLAN_KEYS) if (keys.includes(k)) hosted[k] = true;
  }

  return json(200, {
    ok: true,
    available,
    signupUrl,
    hosted,
    turnstileSiteKey: mock ? null : env.TURNSTILE_SITE_KEY || null,
    portalUrl: env.SPHEREMAIL_PORTAL_URL || null,
  }, { 'cache-control': 'public, max-age=300' });
};

export const config = { path: '/api/plans' };
