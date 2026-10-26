// Meta Conversions API — server-side conversion events.
//
// Why this exists: every conversion on this site completes somewhere else
// (SphereMail, OfficeRnD, WhatsApp), and the browser pixel loses a large share
// of events to tracking prevention and ad blockers. Events sent from here are
// not subject to either, so Meta sees conversions the pixel misses.
//
// Entirely optional. With META_PIXEL_ID or META_CAPI_ACCESS_TOKEN unset this
// module does nothing and returns quietly — no errors, no effect on the
// customer's request. It must NEVER delay or fail an applicant's submission.
//
// The access token is a secret. Set it in Netlify → Site configuration →
// Environment variables, scoped to Functions. Never commit it.
import { createHash } from 'node:crypto';
import { log } from './http.mjs';

const API_VERSION = 'v21.0';
const TIMEOUT_MS = 2500;

// Meta requires these identifiers pre-hashed, normalised first:
// trimmed, lowercased, and for phone numbers digits only.
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const hashEmail = (v) => (typeof v === 'string' && v.includes('@') ? sha256(v.trim().toLowerCase()) : null);
const hashPhone = (v) => {
  if (typeof v !== 'string') return null;
  const digits = v.replace(/\D/g, '');
  return digits.length >= 7 ? sha256(digits) : null;
};
const hashName = (v) => (typeof v === 'string' && v.trim() ? sha256(v.trim().toLowerCase()) : null);

const clientIp = (req) => {
  const h = req && req.headers;
  if (!h || typeof h.get !== 'function') return null;
  const xff = h.get('x-nf-client-connection-ip') || h.get('x-forwarded-for');
  return xff ? xff.split(',')[0].trim() : null;
};

/**
 * Send one conversion event to Meta. Resolves to true only if Meta accepted it.
 * Never throws: a failure here must not affect the customer-facing response.
 *
 * @param {object}  opts
 * @param {string}  opts.eventName   e.g. 'Lead', 'CompleteRegistration'
 * @param {string}  opts.eventId     dedupe key shared with any browser event (we use `ref`)
 * @param {object}  [opts.user]      { email, phone, firstName, lastName, fbp, fbc }
 * @param {object}  [opts.custom]    custom_data, e.g. { content_name: 'Business Registration' }
 * @param {string}  [opts.sourceUrl] page the conversion came from
 * @param {Request} [opts.req]       incoming request, for IP and user-agent
 */
export async function sendConversion({ eventName, eventId, user = {}, custom = {}, sourceUrl, req, env = process.env }) {
  const pixelId = env.META_PIXEL_ID;
  const token = env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token) return false; // not configured — stay silent

  const userData = {
    em: hashEmail(user.email),
    ph: hashPhone(user.phone),
    fn: hashName(user.firstName),
    ln: hashName(user.lastName),
    client_ip_address: clientIp(req),
    client_user_agent: req && req.headers && typeof req.headers.get === 'function' ? req.headers.get('user-agent') : null,
    fbp: user.fbp || null,
    fbc: user.fbc || null,
  };
  for (const k of Object.keys(userData)) if (!userData[k]) delete userData[k];

  const body = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      ...(sourceUrl ? { event_source_url: sourceUrl } : {}),
      user_data: userData,
      ...(Object.keys(custom).length ? { custom_data: custom } : {}),
    }],
  };
  if (env.META_CAPI_TEST_CODE) body.test_event_code = env.META_CAPI_TEST_CODE;

  try {
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // Log the status only. The response body can echo back the payload.
      log('capi_rejected', { eventName, eventId, status: res.status });
      return false;
    }
    log('capi_sent', { eventName, eventId });
    return true;
  } catch (e) {
    log('capi_error', { eventName, eventId, timeout: !!(e && (e.name === 'TimeoutError' || e.name === 'AbortError')) });
    return false;
  }
}

/**
 * Fire-and-forget wrapper. Uses context.waitUntil where the platform provides
 * it so the event is delivered after the response the customer is waiting for
 * has already been sent. Returns immediately either way.
 */
export function sendConversionInBackground(context, opts) {
  const p = sendConversion(opts).catch(() => false);
  if (context && typeof context.waitUntil === 'function') context.waitUntil(p);
  return p;
}
