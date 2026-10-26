// Exercises track.js against a minimal DOM stand-in.
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert';

const src = readFileSync('public/assets/js/track.js', 'utf8');

function run(html, pathname = '/', search = '') {
  const listeners = [];
  const links = [...html.matchAll(/href="([^"]+)"(?:[^>]*aria-label="([^"]*)")?/g)].map(([, href, label]) => {
    const el = { _href: href, getAttribute: (k) => (k === 'href' ? el._href : k === 'aria-label' ? label || null : null), setAttribute: (k, v) => { if (k === 'href') el._href = v; }, textContent: 'click', closest: () => el };
    return el;
  });
  const doc = {
    readyState: 'complete',
    addEventListener: (ev, fn) => listeners.push({ ev, fn }),
    querySelectorAll: (sel) => (sel.includes('wa.me') ? links.filter((l) => l._href.includes('wa.me')) : []),
  };
  const pushed = [];
  const fbCalls = [];
  const win = {
    dataLayer: [],
    fbq: (...a) => fbCalls.push(a),
    location: { pathname, search, href: 'https://www.bizloftgy.com' + pathname + search, hostname: 'www.bizloftgy.com', protocol: 'https:' },
    document: doc,
  };
  const fn = new Function('window', 'document', 'location', 'URL', 'URLSearchParams', src);
  fn(win, doc, win.location, URL, URLSearchParams);
  const click = (el) => {
    const h = listeners.find((l) => l.ev === 'click');
    h.fn({ defaultPrevented: false, button: 0, target: { closest: () => el } });
  };
  return { links, click, dl: win.dataLayer, fb: fbCalls };
}

test('plan sign-up click maps plan id to name and value', () => {
  const h = '<a href="https://thebusinessloft.spheremail.co/customers/sign-up?plan_id=8291&term=yearly" aria-label="Start Virtual Office Plus, yearly billing">x</a>';
  const r = run(h);
  r.click(r.links[0]);
  const e = r.dl.at(-1);
  assert.equal(e.conversion_type, 'plan_signup');
  assert.equal(e.conversion_plan, 'Virtual Office Plus');
  assert.equal(e.conversion_term, 'yearly');
  assert.equal(e.conversion_value, 6);
  assert.equal(r.fb.at(-1)[1], 'InitiateCheckout');
  assert.equal(r.fb.at(-1)[2].content_name, 'Virtual Office Plus');
});

test('unknown plan id still tracked', () => {
  const r = run('<a href="https://thebusinessloft.spheremail.co/customers/sign-up?plan_id=9999">x</a>');
  r.click(r.links[0]);
  assert.equal(r.dl.at(-1).conversion_plan, 'Unknown');
});

test('meeting room, whatsapp, phone and email each fire a Lead', () => {
  for (const [href, type] of [
    ['https://e-commerce.officernd.com/bizloftgy/resources/abc', 'meeting_room_booking'],
    ['https://wa.me/message/FGDWVGQWA5XBK1', 'whatsapp'],
    ['tel:+5922251164', 'phone'],
    ['mailto:support@bizloftgy.com', 'email'],
  ]) {
    const r = run(`<a href="${href}">x</a>`);
    r.click(r.links[0]);
    assert.equal(r.dl.at(-1).conversion_type, type, href);
    assert.equal(r.fb.at(-1)[1], 'Lead', href);
  }
});

test('social links are tracked but are not leads', () => {
  const r = run('<a href="https://www.instagram.com/bizloftgy/">x</a>');
  r.click(r.links[0]);
  assert.equal(r.dl.at(-1).conversion_type, 'social');
  assert.equal(r.fb.length, 0, 'no Meta lead event for a social follow');
});

test('internal links fire nothing', () => {
  const r = run('<a href="/mailbox/">x</a>');
  r.click(r.links[0]);
  assert.equal(r.dl.length, 0);
});

test('whatsapp link is rewritten with page source and campaign', () => {
  const r = run('<a href="https://wa.me/message/FGDWVGQWA5XBK1">x</a>', '/virtual-office/', '?utm_campaign=oct-boardroom');
  const href = r.links[0]._href;
  assert.ok(href.startsWith('https://wa.me/5927397855?text='), href);
  const text = decodeURIComponent(new URL(href).searchParams.get('text'));
  assert.match(text, /Virtual Office page/);
  assert.match(text, /oct-boardroom/);
});

test('campaign value is sanitised', () => {
  const r = run('<a href="https://wa.me/message/X">x</a>', '/', '?utm_campaign=<script>bad</script>');
  const text = decodeURIComponent(new URL(r.links[0]._href).searchParams.get('text'));
  assert.ok(!text.includes('<'), text);
});

test('missing fbq does not throw', () => {
  const src2 = src;
  assert.ok(src2.includes('typeof window.fbq'));
  const r = run('<a href="tel:+5922251164">x</a>');
  delete r.fb;
  r.click(r.links[0]);
});
