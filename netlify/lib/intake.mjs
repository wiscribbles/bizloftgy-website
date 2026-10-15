// Shared plumbing for the two application forms (business-name registration and
// company incorporation): request checks, and handing a checked application to
// the Google Apps Script web app that writes it to the private Google Sheet.
import { json, allowedOrigins, clientIp, rateLimited, log, isProductionRuntime } from './http.mjs';
import { MAX_BODY_BYTES } from './registration.mjs';

export const GENERIC_FAIL = 'We couldn’t send your application just now. Please try again in a few minutes, or WhatsApp us on (+592) 739-7855.';

/** Where submissions go. On the live site only a Google Apps Script URL is accepted. */
export function scriptTarget(env = process.env) {
  const url = env.GOOGLE_SCRIPT_URL || '';
  const secret = env.GOOGLE_SCRIPT_SECRET || '';
  if (!url || !secret) return { configured: false };
  if (/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) return { configured: true, url, secret };
  if (env.LOCAL_DEV === '1' && !isProductionRuntime(env) && /^http:\/\/127\.0\.0\.1:\d+\//.test(url)) return { configured: true, url, secret };
  return { configured: false, invalid: true };
}

/**
 * Checks every application POST before its contents are read:
 * method, same-site Origin, multipart body, size, and a per-connection limit.
 * Returns { form } or { response } to return immediately.
 */
export async function readApplication(req, context, { key, env = process.env }) {
  if (req.method !== 'POST') return { response: json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, { allow: 'POST' }) };
  const origin = (req.headers.get('origin') || '').replace(/\/$/, '');
  if (!origin || !allowedOrigins(env).has(origin)) return { response: json(403, { ok: false, code: 'FORBIDDEN_ORIGIN' }) };
  const ctype = (req.headers.get('content-type') || '').toLowerCase();
  if (!ctype.startsWith('multipart/form-data')) return { response: json(415, { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE' }) };
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
    return { response: json(413, { ok: false, code: 'PAYLOAD_TOO_LARGE', message: 'Your files together are too large. Please send smaller scans or photos.' }) };
  }
  const ip = clientIp(req, context);
  if (rateLimited(`${key}:ip:${ip}`, 5, 60 * 60_000)) {
    return { response: json(429, { ok: false, code: 'RATE_LIMITED', message: 'Too many applications from this connection. Please try again in an hour, or WhatsApp us.' }, { 'retry-after': '3600' }) };
  }
  try {
    return { form: await req.formData() };
  } catch {
    return { response: json(400, { ok: false, code: 'BAD_FORM' }) };
  }
}

export function isHoneypot(form) {
  const v = form.get('website');
  return typeof v === 'string' && v.trim() !== '';
}

export function notConfigured(ref, invalid) {
  log('intake_not_configured', { ref, invalid: Boolean(invalid) });
  return json(503, { ok: false, code: 'NOT_CONFIGURED', message: 'Online applications aren’t switched on yet. Please WhatsApp us on (+592) 739-7855 or email support@bizloftgy.com and we’ll take your details directly.', ref });
}

/** How long we wait for Google before answering the browser. Netlify stops a
 *  function at 10 seconds, so this counts from when the request arrived. */
function waitBudget(env, startedAt) {
  const budget = Number(env.GOOGLE_SCRIPT_TIMEOUT_MS || 8500);
  return Math.max(budget - (Date.now() - startedAt), Math.min(1500, budget));
}

/**
 * Send a checked application to Apps Script. Returns a Response for the browser.
 *
 * Saving four documents to Drive can take Google longer than Netlify lets a
 * function run. Apps Script keeps going after we stop waiting, so a slow reply
 * is answered with 202 PENDING and the reference; the browser then asks
 * /api/application-status whether that reference has reached the sheet.
 */
export async function forward(target, { kind, ref, record, files }, success, env = process.env, startedAt = Date.now()) {
  const payload = {
    secret: target.secret,
    kind,
    record,
    files: files.map((f) => ({ field: f.field, name: f.name, mime: f.mime, base64: Buffer.from(f.bytes).toString('base64') })),
  };
  try {
    // Apps Script answers a POST with a redirect to the result; fetch follows it.
    const res = await fetch(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: AbortSignal.timeout(waitBudget(env, startedAt)),
    });
    let data = null;
    try { data = await res.json(); } catch { /* not JSON: treated as failure below */ }
    if (!res.ok || !data || data.ok !== true) {
      log('intake_store_failed', { kind, ref, status: res.status, code: (data && data.code) || 'NO_JSON' });
      return json(502, { ok: false, code: 'UPSTREAM', message: GENERIC_FAIL, ref });
    }
    log('intake_stored', { kind, ref });
    return json(200, { ok: true, ref, ...success });
  } catch (e) {
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    log('intake_store_error', { kind, ref, timeout });
    if (timeout) {
      return json(202, {
        ok: false,
        code: 'PENDING',
        kind,
        ref,
        ...success,
        message: `Still saving your documents (reference ${ref}). Please keep this page open.`,
      });
    }
    return json(502, { ok: false, code: 'UPSTREAM', message: GENERIC_FAIL, ref });
  }
}

export const KINDS = new Set(['business_name', 'company']);

/**
 * Ask Apps Script whether an application's row is in the sheet yet.
 * Returns { found: true|false } or { error: 'UNSUPPORTED' | 'UPSTREAM' | 'TIMEOUT' }.
 */
export async function lookupRef(target, kind, ref, env = process.env) {
  try {
    const res = await fetch(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: target.secret, kind: 'status', form: kind, ref }),
      redirect: 'follow',
      signal: AbortSignal.timeout(Number(env.GOOGLE_STATUS_TIMEOUT_MS || 8000)),
    });
    let data = null;
    try { data = await res.json(); } catch { /* handled below */ }
    if (res.ok && data && data.ok === true) return { found: data.found === true };
    // The script in Google hasn't been updated with the status check yet.
    if (data && data.code === 'BAD_KIND') return { error: 'UNSUPPORTED' };
    return { error: 'UPSTREAM' };
  } catch (e) {
    return { error: e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'TIMEOUT' : 'UPSTREAM' };
  }
}

/** A filesystem- and Drive-friendly label from user text. */
export function safeLabel(s, fallback = 'application') {
  return String(s || '').replace(/[^A-Za-z0-9 _-]+/g, '').trim().slice(0, 40) || fallback;
}
