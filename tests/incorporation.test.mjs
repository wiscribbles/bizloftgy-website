import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { validateIncorporation, rolesOf } from '../netlify/lib/incorporation.mjs';
import { _resetRateLimits } from '../netlify/lib/http.mjs';
import handler from '../netlify/functions/incorporation.mjs';

const base = () => ({
  company_name: 'Croal Street Traders Inc.', nature: 'Import and retail of hardware',
  phone: '+592 600 0000', email: 'jane@example.com', consent: 'yes',
  p1_name: 'Jane Mary Doe', p1_shares: '60', p1_address: 'Lot 1 Main Street, Georgetown', p1_shareholder: 'yes', p1_director: 'yes',
  p2_active: 'yes', p2_name: 'John Paul Roe', p2_shares: '40', p2_address: 'Lot 2 Water Street, Georgetown', p2_shareholder: 'yes',
  secretary: '2',
});

test('a valid two-party company passes', () => {
  const r = validateIncorporation(base());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.parties.length, 2);
  assert.equal(r.value.shares_total, 100);
  assert.equal(rolesOf(r.value.parties[1]), 'Shareholder, Company Secretary');
});

test('shares must total exactly 100%', () => {
  const r = validateIncorporation({ ...base(), p2_shares: '30' });
  assert.match(r.errors.shares_total, /90%/);
});

test('inactive parties are ignored, even if filled in', () => {
  const r = validateIncorporation({ ...base(), p3_name: 'Ghost', p3_shares: '50', p3_address: 'x' });
  assert.equal(r.ok, true);
  assert.equal(r.value.parties.length, 2);
});

test('party 1 name is required; ticked parties need name and address', () => {
  const r = validateIncorporation({ ...base(), p1_name: '', p3_active: 'yes', p3_director: 'yes' });
  assert.ok(r.errors.p1_name);
  assert.ok(r.errors.p3_name);
  assert.ok(r.errors.p3_address);
});

test('needs a director, one secretary who is an active party, and roles that match shares', () => {
  assert.ok(validateIncorporation({ ...base(), p1_director: '' }).errors.directors);
  assert.ok(validateIncorporation({ ...base(), secretary: '' }).errors.secretary);
  assert.ok(validateIncorporation({ ...base(), secretary: '4' }).errors.secretary);
  assert.ok(validateIncorporation({ ...base(), p2_shareholder: '' }).errors.p2_roles);
  assert.ok(validateIncorporation({ ...base(), p1_shares: 'abc' }).errors.p1_shares);
});

test('decimal shares that total 100 are accepted', () => {
  const r = validateIncorporation({ ...base(), p1_shares: '33.33', p2_shares: '33.33', p3_active: 'yes', p3_name: 'Ann Lee', p3_address: 'Lot 3 Camp Street', p3_shares: '33.34', p3_shareholder: 'yes' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// --- end to end ---------------------------------------------------------------
const PDF = new TextEncoder().encode('%PDF-1.4\n%test\n');
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
let server; let received = [];
const SECRET = 's'.repeat(40);
before(async () => {
  server = createServer(async (req, res) => {
    const c = []; for await (const x of req) c.push(x);
    const b = JSON.parse(Buffer.concat(c).toString()); received.push(b);
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: b.secret === SECRET }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { LOCAL_DEV: '1', GOOGLE_SCRIPT_URL: `http://127.0.0.1:${server.address().port}/exec`, GOOGLE_SCRIPT_SECRET: SECRET, ALLOWED_ORIGINS: 'https://www.bizloftgy.com' });
  delete process.env.CONTEXT; delete process.env.URL;
});
after(() => server.close());

const post = (fields, files) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [k, [bytes, type]] of Object.entries(files)) fd.append(k, new Blob([bytes], { type }), `${k}.bin`);
  return handler(new Request('https://www.bizloftgy.com/api/incorporation', { method: 'POST', headers: { origin: 'https://www.bizloftgy.com' }, body: fd }), { ip: `10.1.0.${Math.floor(Math.random() * 250)}` });
};

test('a good company application is forwarded with one ID per party and goes to Virtual Office', async () => {
  _resetRateLimits(); received = [];
  const res = await post(base(), { p1_id: [PDF, 'application/pdf'], p2_id: [JPG, 'image/jpeg'], p3_id: [JPG, 'image/jpeg'] });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.next, 'https://thebusinessloft.spheremail.co/customers/sign-up?plan_id=8290&term=monthly');
  const sent = received[0];
  assert.equal(sent.kind, 'company');
  assert.deepEqual(sent.files.map((f) => f.field), ['p1_id', 'p2_id']);
  assert.equal(sent.record.p1_roles, 'Shareholder, Director');
  assert.equal(sent.record.bylaws, 'Standard by-laws');
  assert.match(sent.record.registered_office, /^Lot 43 Croal Street, Stabroek/);
  assert.equal(sent.record.p3_name, undefined);
});

test('an ID is required for every active party', async () => {
  _resetRateLimits();
  const res = await post(base(), { p1_id: [PDF, 'application/pdf'] });
  assert.equal(res.status, 422);
  assert.ok((await res.json()).fields.p2_id);
});

test('shares not totalling 100% are refused by the server', async () => {
  _resetRateLimits();
  const res = await post({ ...base(), p2_shares: '50' }, { p1_id: [PDF, 'application/pdf'], p2_id: [JPG, 'image/jpeg'] });
  assert.equal(res.status, 422);
  assert.ok((await res.json()).fields.shares_total);
});
