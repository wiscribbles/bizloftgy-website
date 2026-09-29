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
  return json(200, {
    ok: true,
    available,
    turnstileSiteKey: mock ? null : env.TURNSTILE_SITE_KEY || null,
    portalUrl: env.SPHEREMAIL_PORTAL_URL || null,
  }, { 'cache-control': 'public, max-age=300' });
};

export const config = { path: '/api/plans' };
