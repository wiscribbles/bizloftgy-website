// When Google takes longer to save than Netlify lets a function run, the form
// gets 202 PENDING and then confirms via /api/application-status.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { _resetRateLimits } from '../netlify/lib/http.mjs';
import registration from '../netlify/functions/registration.mjs';
import status from '../netlify/functions/application-status.mjs';

const SECRET = 's'.repeat(40);
const saved = new Set();
let supportsStatus = true;
let server;

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const reply = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (body.secret !== SECRET) return reply({ ok: false, code: 'FORBIDDEN' });
    if (body.kind === 'status') {
      if (!supportsStatus) return reply({ ok: false, code: 'BAD_KIND' });
      return reply({ ok: true, found: saved.has(body.ref) });
    }
    // Slow save: answer after the function has stopped waiting, like Drive with four files.
    setTimeout(() => { saved.add(body.record.ref); reply({ ok: true }); }, 400);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    LOCAL_DEV: '1', GOOGLE_SCRIPT_URL: `http://127.0.0.1:${server.address().port}/exec`, GOOGLE_SCRIPT_SECRET: SECRET,
    GOOGLE_SCRIPT_TIMEOUT_MS: '150', ALLOWED_ORIGINS: 'https://www.bizloftgy.com',
  });
  delete process.env.CONTEXT; delete process.env.URL;
});
after(() => server.close());

const PDF = new TextEncoder().encode('%PDF-1.4\n%test\n');
function application() {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ applicant_name: 'Jane Mary Doe', phone: '+592 600 0000', email: 'jane@example.com', consent: 'yes' })) fd.append(k, v);
  for (const k of ['application', 'authorization', 'id_doc', 'tin_cert']) fd.append(k, new Blob([PDF], { type: 'application/pdf' }), `${k}.pdf`);
  return fd;
}
const origin = 'https://www.bizloftgy.com';
const ask = (body, o = origin) => status(new Request('https://www.bizloftgy.com/api/application-status', {
  method: 'POST', headers: { origin: o, 'content-type': 'application/json' }, body: JSON.stringify(body),
}), { ip: '10.1.1.1' });

test('a slow save answers PENDING with the reference and sign-up link, then status confirms it', async () => {
  _resetRateLimits();
  const res = await registration(new Request('https://www.bizloftgy.com/api/registration', { method: 'POST', headers: { origin }, body: application() }), { ip: '10.0.0.9' });
  const body = await res.json();
  assert.equal(res.status, 202);
  assert.equal(body.code, 'PENDING');
  assert.equal(body.kind, 'business_name');
  assert.match(body.ref, /^[0-9A-F]{10}$/);
  assert.match(body.next, /plan_id=8301/);

  const early = await (await ask({ kind: 'business_name', ref: body.ref })).json();
  assert.deepEqual(early, { ok: true, found: false });
  await new Promise((r) => setTimeout(r, 500));
  const later = await (await ask({ kind: 'business_name', ref: body.ref })).json();
  assert.deepEqual(later, { ok: true, found: true });
});

test('status refuses bad input and other sites', async () => {
  _resetRateLimits();
  assert.equal((await ask({ kind: 'business_name', ref: 'nope' })).status, 400);
  assert.equal((await ask({ kind: 'other', ref: 'ABCDEF1234' })).status, 400);
  assert.equal((await ask({ kind: 'company', ref: 'ABCDEF1234' }, 'https://evil.example')).status, 403);
});

test('an Apps Script without the status check is reported as unsupported', async () => {
  _resetRateLimits();
  supportsStatus = false;
  const res = await ask({ kind: 'company', ref: 'ABCDEF1234' });
  supportsStatus = true;
  assert.equal(res.status, 501);
});
