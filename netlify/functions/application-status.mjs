// POST /api/application-status — { kind, ref } → { ok, found }.
// Used only when saving an application took Google longer than Netlify lets a
// function run: the form then asks here, every few seconds, whether that
// reference has reached the private sheet. It reveals nothing but yes or no
// for a random 10-character reference.
import { json, guardJsonPost, clientIp, rateLimited, log } from '../lib/http.mjs';
import { scriptTarget, lookupRef, KINDS } from '../lib/intake.mjs';

const REF_RE = /^[0-9A-F]{10}$/;

export default async (req, context) => {
  const env = process.env;
  const guard = await guardJsonPost(req, env);
  if (guard.response) return guard.response;
  const { kind, ref } = guard.body;
  if (!KINDS.has(kind) || typeof ref !== 'string' || !REF_RE.test(ref)) return json(400, { ok: false, code: 'BAD_REQUEST' });
  if (rateLimited(`status:ip:${clientIp(req, context)}`, 40, 10 * 60_000)) return json(429, { ok: false, code: 'RATE_LIMITED' }, { 'retry-after': '600' });

  const target = scriptTarget(env);
  if (!target.configured) return json(503, { ok: false, code: 'NOT_CONFIGURED' });

  const r = await lookupRef(target, kind, ref, env);
  if (r.error === 'UNSUPPORTED') { log('status_unsupported', { ref }); return json(501, { ok: false, code: 'UNSUPPORTED' }); }
  if (r.error) return json(r.error === 'TIMEOUT' ? 504 : 502, { ok: false, code: r.error });
  return json(200, { ok: true, found: r.found });
};

export const config = { path: '/api/application-status', rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
