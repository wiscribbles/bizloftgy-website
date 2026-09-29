// Pre-deploy guard run by Netlify as the build command.
// Fails the deploy if a secret-looking value has been committed into /public,
// or if the page is about to go live with obviously broken configuration.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('../public/', import.meta.url).pathname;
const TEXT = new Set(['.html', '.css', '.js', '.txt', '.xml', '.json', '.webmanifest']);
const SECRET_PATTERNS = [
  /TURNSTILE_SECRET/i, /0x4AAAAAA[A-Za-z0-9_-]{10,}/, /sk_(live|test)_[A-Za-z0-9]{10,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /ghp_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{30,}/,
];
const problems = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!TEXT.has(extname(p))) continue;
    const text = readFileSync(p, 'utf8');
    for (const re of SECRET_PATTERNS) if (re.test(text)) problems.push(`${p.replace(ROOT, 'public/')}: looks like a secret (${re})`);
  }
}
walk(ROOT);

const env = process.env;
if (env.CONTEXT === 'production') {
  if (env.SPHEREMAIL_MOCK === '1') problems.push('SPHEREMAIL_MOCK=1 must not be set in production.');
  if (env.LOCAL_DEV === '1') problems.push('LOCAL_DEV=1 must not be set in production.');
  // Variables scoped to Functions only aren't visible here; the functions also refuse
  // mock mode and localhost origins at runtime on the live site (isProductionRuntime).
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY) console.warn('warning: Turnstile keys not set — online plan signup will refuse requests until they are.');
  const plans = ['SPHEREMAIL_PLAN_MAILBOX_ONLY', 'SPHEREMAIL_PLAN_VIRTUAL_OFFICE', 'SPHEREMAIL_PLAN_VIRTUAL_OFFICE_PLUS'].filter((k) => !env[k]);
  if (plans.length) console.warn(`warning: ${plans.join(', ')} not set — those plans will show "Enquire" instead of online signup.`);
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  if (html.includes('REPLACE-WITH-OFFICERND-SLUG')) console.warn('warning: OfficeRnD slug not set in public/index.html — the booking block will show the WhatsApp fallback.');
}

if (problems.length) {
  console.error('Deploy blocked:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('check: ok');
