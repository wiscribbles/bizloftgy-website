// Tests for the signup API. Run with `npm test` (Node 20+, no dependencies).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { _resetRateLimits, guardJsonPost } from '../netlify/lib/http.mjs';
import { validateCodeRequest, validateSignup, deriveUsername } from '../netlify/lib/validate.mjs';
import { createClient } from '../netlify/lib/spheremail.mjs';
import plans from '../netlify/functions/plans.mjs';
import signupCode from '../netlify/functions/signup-code.mjs';
import signup from '../netlify/functions/signup.mjs';
import cspReport from '../netlify/functions/csp-report.mjs';

const ORIGIN = 'https://www.bizloftgy.com';
const base = { firstName: 'Anya', lastName: 'Persaud', company: 'Persaud Trading', email: 'anya@example.gy', phone: '+592 600 1234', plan: 'virtual_office', term: 'monthly' };
const full = { ...base, code: '123456', street: '12 Main Street', city: 'Georgetown', country: 'GY', region: 'Demerara-Mahaica', password: 'correct horse battery', acceptTerms: true };

function req(path, body, { origin = ORIGIN, ctype = 'application/json', method = 'POST' } = {}) {
  const headers = { 'content-type': ctype };
  if (origin) headers.origin = origin;
  return new Request(`https://www.bizloftgy.com${path}`, { method, headers, body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
}
const ctx = (ip = '203.0.113.1') => ({ ip });

beforeEach(() => {
  _resetRateLimits();
  for (const k of Object.keys(process.env)) if (k.startsWith('SPHEREMAIL_') || k.startsWith('TURNSTILE_')) delete process.env[k];
  process.env.SPHEREMAIL_MOCK = '1';
});

// --- validation -------------------------------------------------------------
test('valid step-1 details pass', () => {
  const r = validateCodeRequest(base);
  assert.equal(r.ok, true);
  assert.equal(r.value.phone, '+5926001234');
  assert.equal(r.value.email, 'anya@example.gy');
});

test('step-1 rejects bad input with field messages', () => {
  const r = validateCodeRequest({ firstName: '<script>', lastName: '', email: 'nope', phone: '12', plan: 'gold', term: 'weekly' });
  assert.equal(r.ok, false);
  for (const f of ['firstName', 'lastName', 'email', 'phone', 'plan', 'term']) assert.ok(r.errors[f], f);
});

test('non-string values are treated as empty, not coerced', () => {
  const r = validateCodeRequest({ ...base, email: { $ne: '' }, firstName: ['Anya'] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.email && r.errors.firstName);
});

test('step-2 requires region from the Guyana list, terms, and a 10+ char password', () => {
  assert.equal(validateSignup(full).ok, true);
  const r = validateSignup({ ...full, region: 'Atlantis', password: 'short', acceptTerms: 'yes' });
  assert.ok(r.errors.region && r.errors.password && r.errors.acceptTerms);
  const r2 = validateSignup({ ...full, password: 'anya12345678' });
  assert.ok(r2.errors.password, 'password containing the email name is refused');
});

test('overseas address needs a state/province', () => {
  assert.equal(validateSignup({ ...full, country: 'US', region: 'NY', postcode: '10001' }).ok, true);
  assert.ok(validateSignup({ ...full, country: 'US', region: '' }).errors.region);
});

test('usernames are derived safely from the email', () => {
  assert.equal(deriveUsername('Anya.P+test@example.gy', '0042'), 'anya.ptest0042');
  assert.equal(deriveUsername('"@x.gy', '1234'), 'client1234');
});

// --- request guard ------------------------------------------------------------
test('guard: wrong origin, wrong content type, oversized and non-object bodies are refused', async () => {
  assert.equal((await guardJsonPost(req('/x', {}, { origin: 'https://evil.example' }))).response.status, 403);
  assert.equal((await guardJsonPost(req('/x', {}, { origin: null }))).response.status, 403);
  assert.equal((await guardJsonPost(req('/x', 'a=b', { ctype: 'application/x-www-form-urlencoded' }))).response.status, 415);
  assert.equal((await guardJsonPost(req('/x', JSON.stringify({ a: 'x'.repeat(9000) })))).response.status, 413);
  assert.equal((await guardJsonPost(req('/x', '[1,2]'))).response.status, 400);
  assert.equal((await guardJsonPost(req('/x', '{bad'))).response.status, 400);
  assert.ok((await guardJsonPost(req('/x', { a: 1 }))).body);
});

// --- /api/plans -------------------------------------------------------------------
test('plans: mock mode reports all three plans available and exposes no secrets', async () => {
  process.env.TURNSTILE_SECRET_KEY = 'secret-should-not-leak';
  const r = await plans(new Request('https://www.bizloftgy.com/api/plans'));
  const j = await r.json();
  assert.deepEqual(j.available, { mailbox_only: true, virtual_office: true, virtual_office_plus: true });
  assert.ok(!JSON.stringify(j).includes('secret-should-not-leak'));
});

test('plans: live mode only offers plans with a configured ID', async () => {
  delete process.env.SPHEREMAIL_MOCK;
  process.env.SPHEREMAIL_PLAN_VIRTUAL_OFFICE = '42';
  process.env.TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
  const j = await (await plans(new Request('https://www.bizloftgy.com/api/plans'))).json();
  assert.deepEqual(j.available, { mailbox_only: false, virtual_office: true, virtual_office_plus: false });
  assert.equal(j.turnstileSiteKey, '1x00000000000000000000AA');
});

// --- /api/signup/code ---------------------------------------------------------
test('code: happy path', async () => {
  const r = await signupCode(req('/api/signup/code', base), ctx());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('code: honeypot gets a fake success and nothing is sent', async () => {
  const r = await signupCode(req('/api/signup/code', { ...base, website: 'http://spam' }), ctx());
  assert.equal(r.status, 200);
});

test('code: email already registered → 409 with a field message', async () => {
  const r = await signupCode(req('/api/signup/code', { ...base, email: 'taken@example.com' }), ctx());
  assert.equal(r.status, 409);
  assert.ok((await r.json()).fields.email);
});

test('code: rate limited per IP after 5 attempts', async () => {
  for (let i = 0; i < 5; i++) await signupCode(req('/api/signup/code', { ...base, email: `a${i}@example.gy` }), ctx('198.51.100.7'));
  const r = await signupCode(req('/api/signup/code', base), ctx('198.51.100.7'));
  assert.equal(r.status, 429);
});

test('code: live mode fails closed when Turnstile is not configured', async () => {
  delete process.env.SPHEREMAIL_MOCK;
  process.env.SPHEREMAIL_PLAN_VIRTUAL_OFFICE = '42';
  const r = await signupCode(req('/api/signup/code', base), ctx());
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, 'BOT_CHECK');
});

test('code: live mode with no plan ID configured → 409 PLAN_UNAVAILABLE', async () => {
  delete process.env.SPHEREMAIL_MOCK;
  const r = await signupCode(req('/api/signup/code', base), ctx());
  assert.equal(r.status, 409);
});

// --- /api/signup ------------------------------------------------------------------
test('signup: happy path creates the account and subscribes', async () => {
  process.env.SPHEREMAIL_PORTAL_URL = 'https://portal.example.com';
  const r = await signup(req('/api/signup', full), ctx());
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.equal(j.subscribed, true);
  assert.equal(j.portalUrl, 'https://portal.example.com');
  assert.ok(!JSON.stringify(j).includes('mock-access'), 'tokens never returned');
});

test('signup: wrong code maps to the code field', async () => {
  const r = await signup(req('/api/signup', { ...full, code: '000000' }), ctx());
  assert.equal(r.status, 422);
  assert.ok((await r.json()).fields.code);
});

test('signup: validation errors come back per field', async () => {
  const r = await signup(req('/api/signup', { ...full, street: '', acceptTerms: false }), ctx());
  const j = await r.json();
  assert.equal(r.status, 422);
  assert.ok(j.fields.street && j.fields.acceptTerms);
});

// --- live client against a fake SphereMail --------------------------------------
test('live client: sends the documented account shape, logs out after subscribing, never logs the password', async () => {
  const calls = [];
  const logs = [];
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  console.log = (s) => logs.push(String(s));
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const ok0 = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.hostname === 'challenges.cloudflare.com') return ok0({ success: true, action: 'signup', hostname: 'www.bizloftgy.com' });
    calls.push({ method: init.method, path: u.pathname, auth: init.headers?.authorization, body: init.body ? JSON.parse(init.body) : null });
    const ok = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
    if (u.pathname.endsWith('/countries')) return ok({ countries: [{ id: 88, name: 'Guyana', iso: 'GY' }] });
    if (u.pathname.endsWith('/countries/88')) return ok({ states: [{ id: 9, name: 'Demerara-Mahaica' }] });
    if (u.pathname.endsWith('/account/validate_available')) return ok({});
    if (u.pathname.endsWith('/account/') && init.method === 'POST') return ok({}, 201);
    if (u.pathname.endsWith('/authentication/') && init.method === 'POST') return ok({ access_token: 'AT', refresh_token: 'RT' });
    if (u.pathname.endsWith('/subscriptions')) return ok({ account_id: 1, plan_id: 42 }, 201);
    if (u.pathname.endsWith('/authentication/') && init.method === 'DELETE') return new Response(null, { status: 204 });
    return ok({ errors: { base: ['unexpected'] } }, 500);
  };
  try {
    delete process.env.SPHEREMAIL_MOCK;
    process.env.SPHEREMAIL_PLAN_VIRTUAL_OFFICE = '42';
    process.env.TURNSTILE_SECRET_KEY = 'x';
    const r = await signup(req('/api/signup', { ...full, turnstileToken: 'tok-1234567890' }), ctx());
    assert.equal(r.status, 201);
    assert.equal((await r.json()).subscribed, true);
    const acct = calls.find((c) => c.path.endsWith('/account/') && c.method === 'POST').body.account;
    assert.equal(acct.country_id, 88);
    assert.equal(acct.state_id, 9);
    assert.equal(acct.zip_code, '00000');
    assert.equal(acct.accept_terms, true);
    assert.equal(acct.accept_policy, true);
    assert.equal(acct.verification_code, '123456');
    assert.match(acct.user_name, /^anya\d{4}$/);
    const sub = calls.find((c) => c.path.endsWith('/subscriptions'));
    assert.equal(sub.auth, 'Bearer AT');
    assert.deepEqual(sub.body, { plan_id: 42, term: 'monthly' });
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/authentication/')), 'logged out');
    const logText = logs.join('\n');
    assert.ok(!logText.includes(full.password) && !logText.includes(full.email) && !logText.includes('AT"'), 'no secrets or PII in logs');
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
});

test('live client: upstream 5xx becomes a safe 502 with a reference, no internals', async () => {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  console.log = () => {};
  globalThis.fetch = async (url) => new URL(url).hostname === 'challenges.cloudflare.com'
    ? new Response(JSON.stringify({ success: true, action: 'signup', hostname: 'www.bizloftgy.com' }))
    : new Response('<html>stack trace at line 42</html>', { status: 500 });
  try {
    delete process.env.SPHEREMAIL_MOCK;
    process.env.TURNSTILE_SECRET_KEY = 'x';
    process.env.SPHEREMAIL_PLAN_VIRTUAL_OFFICE = '42';
    process.env.SPHEREMAIL_COUNTRY_ID_GY = '88';
    process.env.SPHEREMAIL_STATE_ID_GY = '9';
    const r = await signup(req('/api/signup', { ...full, turnstileToken: 'tok-1234567890' }), ctx());
    const j = await r.json();
    assert.equal(r.status, 502);
    assert.match(j.ref, /^[0-9A-F]{10}$/);
    assert.ok(!JSON.stringify(j).includes('stack trace'));
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
});

test('live client: refuses a non-https API base', () => {
  assert.throws(() => createClient({ SPHEREMAIL_API_BASE: 'http://api.spheremail.co/v1' }));
});

test('csp-report accepts reports and returns 204', async () => {
  const realLog = console.log; console.log = () => {};
  try {
    const r = await cspReport(req('/api/csp-report', { 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'https://evil.example/x.js?token=abc' } }, { ctype: 'application/csp-report' }));
    assert.equal(r.status, 204);
  } finally { console.log = realLog; }
});

// --- hardening from the security review ---------------------------------------
import { verifyTurnstile, isProductionRuntime } from '../netlify/lib/http.mjs';
import { isMock } from '../netlify/lib/spheremail.mjs';

function withFetch(fake, fn) {
  const real = globalThis.fetch; const realLog = console.log;
  globalThis.fetch = fake; console.log = () => {};
  return fn().finally(() => { globalThis.fetch = real; console.log = realLog; });
}
const tsReply = (b) => async () => new Response(JSON.stringify(b));

test('turnstile: token must match our action and hostname', async () => {
  const env = { TURNSTILE_SECRET_KEY: 'x' };
  await withFetch(tsReply({ success: true, action: 'signup', hostname: 'www.bizloftgy.com' }), async () => assert.equal((await verifyTurnstile('tok-1234567890', '1.2.3.4', env)).ok, true));
  await withFetch(tsReply({ success: true, action: 'login', hostname: 'www.bizloftgy.com' }), async () => assert.equal((await verifyTurnstile('tok-1234567890', '1.2.3.4', env)).reason, 'wrong-action'));
  await withFetch(tsReply({ success: true, action: 'signup', hostname: 'evil.example' }), async () => assert.equal((await verifyTurnstile('tok-1234567890', '1.2.3.4', env)).reason, 'wrong-hostname'));
});

test('signup: live mode requires the bot check on step 2 too', async () => {
  delete process.env.SPHEREMAIL_MOCK;
  process.env.SPHEREMAIL_PLAN_VIRTUAL_OFFICE = '42';
  const r = await signup(req('/api/signup', full), ctx());
  assert.equal(r.status, 503);
});

test('code: failed bot checks do not use up the email quota', async () => {
  delete process.env.SPHEREMAIL_MOCK;
  process.env.SPHEREMAIL_PLAN_VIRTUAL_OFFICE = '42';
  process.env.TURNSTILE_SECRET_KEY = 'x';
  await withFetch(tsReply({ success: false }), async () => {
    for (let i = 0; i < 4; i++) await signupCode(req('/api/signup/code', base), ctx(`192.0.2.${i}`));
  });
  let status;
  await withFetch(async (url) => {
    const u = new URL(url);
    if (u.hostname === 'challenges.cloudflare.com') return new Response(JSON.stringify({ success: true, action: 'signup', hostname: 'www.bizloftgy.com' }));
    return new Response('{}', { status: 200 });
  }, async () => { status = (await signupCode(req('/api/signup/code', { ...base, turnstileToken: 'tok-1234567890' }), ctx('192.0.2.99'))).status; });
  assert.equal(status, 200);
});

test('signup: "email already taken" from SphereMail is not revealed as a field error', async () => {
  delete process.env.SPHEREMAIL_MOCK;
  process.env.SPHEREMAIL_PLAN_VIRTUAL_OFFICE = '42';
  process.env.TURNSTILE_SECRET_KEY = 'x';
  process.env.SPHEREMAIL_COUNTRY_ID_GY = '88';
  process.env.SPHEREMAIL_STATE_ID_GY = '9';
  let j, status;
  await withFetch(async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'challenges.cloudflare.com') return new Response(JSON.stringify({ success: true, action: 'signup', hostname: 'www.bizloftgy.com' }));
    if (u.pathname.endsWith('/account/') && init.method === 'POST') return new Response(JSON.stringify({ errors: { email: ['has already been taken'] } }), { status: 422 });
    return new Response('{}', { status: 200 });
  }, async () => { const r = await signup(req('/api/signup', { ...full, turnstileToken: 'tok-1234567890' }), ctx()); status = r.status; j = await r.json(); });
  assert.equal(status, 422);
  assert.ok(!j.fields || !j.fields.email);
  assert.ok(!JSON.stringify(j).includes('already been taken'));
});

test('mock mode and localhost origins are refused on the live site', () => {
  const live = { SPHEREMAIL_MOCK: '1', LOCAL_DEV: '1', URL: 'https://www.bizloftgy.com' };
  assert.equal(isProductionRuntime(live), true);
  assert.equal(isMock(live), false);
  assert.equal(isMock({ SPHEREMAIL_MOCK: '1', CONTEXT: 'production' }), false);
  assert.equal(isMock({ SPHEREMAIL_MOCK: '1', URL: 'https://deploy-preview-3--bizloft.netlify.app' }), true);
});

test('plans: hosted mode points the chosen plans at SphereMail signup', async () => {
  delete process.env.SPHEREMAIL_MOCK;
  process.env.SPHEREMAIL_SIGNUP_URL = 'https://bizloftgy.spheremail.co/';
  let j = await (await plans(new Request('https://www.bizloftgy.com/api/plans'))).json();
  assert.equal(j.signupUrl, 'https://bizloftgy.spheremail.co/');
  assert.deepEqual(j.hosted, { mailbox_only: true, virtual_office: true });
  process.env.SPHEREMAIL_SIGNUP_URL = 'javascript:alert(1)';
  j = await (await plans(new Request('https://www.bizloftgy.com/api/plans'))).json();
  assert.equal(j.signupUrl, null);
  assert.deepEqual(j.hosted, {});
  delete process.env.SPHEREMAIL_SIGNUP_URL;
});
