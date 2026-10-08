import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { validateRegistration, sniffType, sheetSafe, MAX_FILE_BYTES } from '../netlify/lib/registration.mjs';
import { _resetRateLimits } from '../netlify/lib/http.mjs';
import handler, { scriptTarget } from '../netlify/functions/registration.mjs';

const NOW = new Date('2026-10-08T12:00:00Z');
const good = () => ({
  business_name: 'Croal Street Traders', nature: 'Retail sale of clothing', present_names: 'Jane Mary Doe',
  former_names: '', nationality: 'Guyanese', nationality_origin: '', residence: 'Lot 1 Main Street, Georgetown',
  other_occupation: 'None', other_business_names: '', id_number: '123456789', dob: '1990-05-01',
  phone: '+592 600 0000, 225 0000', email: 'Jane@Example.com', tin: '012345678', commencement: '2026-11-01',
  consent: 'yes',
});

const PDF = new TextEncoder().encode('%PDF-1.4\n%test\n');
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0]);

test('valid application passes and normalises email', () => {
  const r = validateRegistration(good(), NOW);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.email, 'jane@example.com');
});

test('required fields, consent and plan are enforced', () => {
  const r = validateRegistration({ consent: 'no' }, NOW);
  for (const k of ['business_name', 'nature', 'present_names', 'nationality', 'residence', 'other_occupation', 'id_number', 'dob', 'phone', 'email', 'tin', 'consent']) {
    assert.ok(r.errors[k], `expected error for ${k}`);
  }
  assert.equal(r.errors.former_names, undefined);
  assert.equal(r.errors.commencement, undefined);
});

test('applicant must be 18 and dates must be real', () => {
  assert.ok(validateRegistration({ ...good(), dob: '2010-01-01' }, NOW).errors.dob);
  assert.ok(validateRegistration({ ...good(), dob: '1990-02-30' }, NOW).errors.dob);
  assert.ok(validateRegistration({ ...good(), commencement: '2030-01-01' }, NOW).errors.commencement);
});

test('uploads are identified by content, not name', () => {
  assert.equal(sniffType(PDF).mime, 'application/pdf');
  assert.equal(sniffType(JPG).mime, 'image/jpeg');
  assert.equal(sniffType(EXE), null);
});

test('formula-like values are neutralised for Sheets', () => {
  assert.equal(sheetSafe('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
  assert.equal(sheetSafe('+592 600'), "'+592 600");
  assert.equal(sheetSafe('Jane'), 'Jane');
});

test('only a Google Apps Script URL is accepted outside local dev', () => {
  assert.equal(scriptTarget({ GOOGLE_SCRIPT_URL: 'https://evil.example/exec', GOOGLE_SCRIPT_SECRET: 'x'.repeat(40) }).configured, false);
  assert.equal(scriptTarget({ GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfy_abc-123/exec', GOOGLE_SCRIPT_SECRET: 'x'.repeat(40) }).configured, true);
  assert.equal(scriptTarget({ GOOGLE_SCRIPT_URL: 'http://127.0.0.1:9/x', GOOGLE_SCRIPT_SECRET: 's', CONTEXT: 'production' }).configured, false);
});

// --- end to end through the function, with a stand-in for Apps Script --------
let server; let received = [];
const SECRET = 's'.repeat(40);
before(async () => {
  server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    received.push(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: body.secret === SECRET }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  Object.assign(process.env, { LOCAL_DEV: '1', GOOGLE_SCRIPT_URL: `http://127.0.0.1:${port}/exec`, GOOGLE_SCRIPT_SECRET: SECRET, ALLOWED_ORIGINS: 'https://www.bizloftgy.com' });
  delete process.env.CONTEXT; delete process.env.URL;
});
after(() => server.close());

function formWith(fields, files = { id_doc: [PDF, 'application/pdf', 'id.pdf'], tin_cert: [JPG, 'image/jpeg', 'tin.jpg'] }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [k, [bytes, type, name]] of Object.entries(files)) fd.append(k, new Blob([bytes], { type }), name);
  return fd;
}
const post = (fd, origin = 'https://www.bizloftgy.com') =>
  handler(new Request('https://www.bizloftgy.com/api/registration', { method: 'POST', headers: { origin }, body: fd }), { ip: `10.0.0.${Math.floor(Math.random() * 250)}` });

test('a good application is forwarded with both files and a reference', async () => {
  _resetRateLimits(); received = [];
  const res = await post(formWith(good()));
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.match(body.ref, /^[0-9A-F]{10}$/);
  assert.equal(body.next, 'https://thebusinessloft.spheremail.co/customers/sign-up?plan_id=8301&term=monthly');
  assert.equal(received.length, 1);
  const sent = received[0];
  assert.equal(sent.files.length, 2);
  assert.equal(sent.record.principal_place.startsWith('Lot 43 Croal Street, Stabroek'), true);
  assert.equal(sent.record.phone, "'+592 600 0000, 225 0000");
  assert.equal(sent.kind, 'business_name');
  assert.match(sent.record.plan_name, /8301/);
});

test('any plan value sent by the browser is ignored; sign-up is always plan 8301', async () => {
  _resetRateLimits();
  const body = await (await post(formWith({ ...good(), plan: 'virtual_office' }))).json();
  assert.equal(body.next, 'https://thebusinessloft.spheremail.co/customers/sign-up?plan_id=8301&term=monthly');
});

test('a disguised executable is refused', async () => {
  _resetRateLimits();
  const res = await post(formWith(good(), { id_doc: [EXE, 'application/pdf', 'id.pdf'], tin_cert: [JPG, 'image/jpeg', 't.jpg'] }));
  assert.equal(res.status, 422);
  assert.ok((await res.json()).fields.id_doc);
});

test('missing uploads are refused', async () => {
  _resetRateLimits();
  const res = await post(formWith(good(), {}));
  const body = await res.json();
  assert.equal(res.status, 422);
  assert.ok(body.fields.id_doc && body.fields.tin_cert);
});

test('oversized upload is refused', async () => {
  _resetRateLimits();
  const big = new Uint8Array(MAX_FILE_BYTES + 10); big.set(PDF);
  const res = await post(formWith(good(), { id_doc: [big, 'application/pdf', 'big.pdf'], tin_cert: [JPG, 'image/jpeg', 't.jpg'] }));
  assert.equal(res.status, 422);
});

test('posts from other sites are refused', async () => {
  const res = await post(formWith(good()), 'https://evil.example');
  assert.equal(res.status, 403);
});

test('honeypot submissions look fine but are not stored', async () => {
  _resetRateLimits(); received = [];
  const res = await post(formWith({ ...good(), website: 'http://spam' }));
  assert.equal(res.status, 200);
  assert.equal(received.length, 0);
});

test('without Google settings the form asks people to contact us', async () => {
  _resetRateLimits();
  const saved = process.env.GOOGLE_SCRIPT_URL; delete process.env.GOOGLE_SCRIPT_URL;
  const res = await post(formWith(good()));
  process.env.GOOGLE_SCRIPT_URL = saved;
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'NOT_CONFIGURED');
});

test('a wrong secret is reported as a failure, not success', async () => {
  _resetRateLimits();
  const saved = process.env.GOOGLE_SCRIPT_SECRET; process.env.GOOGLE_SCRIPT_SECRET = 'wrong'.repeat(10);
  const res = await post(formWith(good()));
  process.env.GOOGLE_SCRIPT_SECRET = saved;
  assert.equal(res.status, 502);
});
