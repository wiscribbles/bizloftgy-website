// Shared request/response helpers for the Netlify functions.
// Everything here is dependency-free and uses web-standard Request/Response,
// so the same code runs on Netlify Functions, Cloudflare Workers or Node 20+.

const MAX_BODY_BYTES = 8 * 1024;

/** JSON response with headers that stop caching and indexing of API output. */
export function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex',
      ...extraHeaders,
    },
  });
}

/** Short random reference shown to the user and written to logs, so a support
 *  request can be matched to a log line without logging anything personal. */
export function newRef() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Structured log line. Never pass request bodies, passwords, tokens or emails. */
export function log(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields, at: new Date().toISOString() }));
}

/** True when running on the live site. Mock mode and localhost origins are
 *  refused here even if someone sets those variables by mistake. */
export function isProductionRuntime(env = process.env) {
  return env.CONTEXT === 'production' || /(^|\.)bizloftgy\.com$/i.test(hostOf(env.URL));
}
function hostOf(u) { try { return new URL(u).hostname; } catch { return ''; } }

/** Origins allowed to call the POST endpoints. Netlify injects URL and
 *  DEPLOY_PRIME_URL, so deploy previews work without extra configuration. */
export function allowedOrigins(env = process.env) {
  const list = (env.ALLOWED_ORIGINS || 'https://www.bizloftgy.com,https://bizloftgy.com')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  for (const key of ['URL', 'DEPLOY_PRIME_URL', 'DEPLOY_URL']) {
    if (env[key]) list.push(env[key].replace(/\/$/, ''));
  }
  if (env.LOCAL_DEV === '1' && !isProductionRuntime(env)) list.push('http://localhost:8888', 'http://127.0.0.1:8888');
  return new Set(list);
}

/**
 * Guards every state-changing endpoint:
 *  - POST only
 *  - Origin header must be one of ours (CSRF defence; browsers always send it on POST)
 *  - Content-Type must be application/json, which forces a CORS preflight for any
 *    cross-origin caller; we never answer preflights, so cross-site posts fail
 *  - body capped at 8 KB and must parse as a JSON object
 * Returns { body } on success or { response } to return immediately.
 */
export async function guardJsonPost(req, env = process.env) {
  if (req.method !== 'POST') {
    return { response: json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, { allow: 'POST' }) };
  }
  const origin = (req.headers.get('origin') || '').replace(/\/$/, '');
  if (!origin || !allowedOrigins(env).has(origin)) {
    return { response: json(403, { ok: false, code: 'FORBIDDEN_ORIGIN' }) };
  }
  const ctype = (req.headers.get('content-type') || '').toLowerCase();
  if (!ctype.startsWith('application/json')) {
    return { response: json(415, { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE' }) };
  }
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) {
    return { response: json(413, { ok: false, code: 'PAYLOAD_TOO_LARGE' }) };
  }
  let text;
  try {
    text = await req.text();
  } catch {
    return { response: json(400, { ok: false, code: 'BAD_REQUEST' }) };
  }
  if (text.length > MAX_BODY_BYTES) {
    return { response: json(413, { ok: false, code: 'PAYLOAD_TOO_LARGE' }) };
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { response: json(400, { ok: false, code: 'BAD_JSON' }) };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { response: json(400, { ok: false, code: 'BAD_JSON' }) };
  }
  return { body };
}

/** Best-available client IP. Netlify sets x-nf-client-connection-ip. */
export function clientIp(req, context) {
  return (
    context?.ip ||
    req.headers.get('x-nf-client-connection-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

// ---------------------------------------------------------------------------
// Rate limiting.
// Serverless instances are short-lived, so an in-memory limiter is best-effort:
// it stops bursts against a warm instance but is not a guarantee. The real
// controls against abuse are Turnstile (bot check) on the step that sends email,
// and the email verification code itself. See README > Hardening for the
// platform-level option.
// ---------------------------------------------------------------------------
const buckets = new Map();

export function rateLimited(key, limit, windowMs, now = Date.now()) {
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) {
    // keep memory bounded on a long-lived instance
    for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  }
  return false;
}

export function _resetRateLimits() {
  buckets.clear();
}

// ---------------------------------------------------------------------------
// Cloudflare Turnstile — bot check on the endpoint that sends email.
// Fails closed: if the secret is missing outside mock mode, callers refuse the
// request instead of running unprotected.
// ---------------------------------------------------------------------------
export async function verifyTurnstile(token, ip, env = process.env, action = 'signup') {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: false, reason: 'not-configured' };
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) {
    return { ok: false, reason: 'missing-token' };
  }
  const form = new URLSearchParams({ secret, response: token });
  if (ip && ip !== 'unknown') form.set('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (data.success !== true) return { ok: false, reason: 'failed' };
    // Bind the token to this form and to our own hostnames, so a token solved
    // elsewhere with the same site key can't be replayed here.
    if (data.action !== action) return { ok: false, reason: 'wrong-action' };
    const hosts = new Set([...allowedOrigins(env)].map(hostOf));
    if (!hosts.has(data.hostname)) return { ok: false, reason: 'wrong-hostname' };
    return { ok: true, reason: 'ok' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}
