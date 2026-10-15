// POST /api/incorporation — company incorporation form.
// Checks the company details, up to five parties (shares must total 100%, at least
// one director, exactly one company secretary) and an ID document for each party,
// then hands them to the Google Apps Script web app, which adds a row to the
// "Company incorporations" tab and saves the IDs in a private Drive folder.
import { json, newRef, log } from '../lib/http.mjs';
import { checkUpload, sheetSafe } from '../lib/registration.mjs';
import { validateIncorporation, isActive, rolesOf, MAX_PARTIES, MAX_TOTAL_FILE_BYTES, REGISTERED_OFFICE, COMPANY_PLAN } from '../lib/incorporation.mjs';
import { scriptTarget, readApplication, isHoneypot, notConfigured, forward, safeLabel } from '../lib/intake.mjs';

export default async (req, context) => {
  const startedAt = Date.now();
  const env = process.env;
  const read = await readApplication(req, context, { key: 'inc', env });
  if (read.response) return read.response;
  const { form } = read;
  const ref = newRef();

  if (isHoneypot(form)) { log('incorporation_honeypot', { ref }); return json(200, { ok: true, ref, next: COMPANY_PLAN.url }); }

  const input = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string' && k.length < 40) input[k] = v;

  const { errors, value } = validateIncorporation(input);
  const files = [];
  let totalBytes = 0;
  for (let n = 1; n <= MAX_PARTIES; n++) {
    if (!isActive(input, n)) continue;
    const r = await checkUpload(form.get(`p${n}_id`), `identification document for party ${n}`);
    if (!r.ok) { errors[`p${n}_id`] = r.error; continue; }
    totalBytes += r.file.bytes.length;
    files.push({ field: `p${n}_id`, ...r.file });
  }
  if (totalBytes > MAX_TOTAL_FILE_BYTES) errors.files_total = 'The ID files together are larger than 4 MB. Please use smaller scans or photos.';
  if (Object.keys(errors).length) return json(422, { ok: false, code: 'VALIDATION', fields: errors });

  const target = scriptTarget(env);
  if (!target.configured) return notConfigured(ref, target.invalid);

  const record = {
    ref,
    submitted_at: new Date().toISOString(),
    company_name: sheetSafe(value.company_name),
    company_name_alt: sheetSafe(value.company_name_alt),
    nature: sheetSafe(value.nature),
    registered_office: REGISTERED_OFFICE,
    bylaws: 'Standard by-laws',
    phone: sheetSafe(value.phone),
    email: sheetSafe(value.email),
    shares_total: value.shares_total,
    plan_name: COMPANY_PLAN.name,
  };
  for (const p of value.parties) {
    record[`p${p.n}_name`] = sheetSafe(p.name);
    record[`p${p.n}_shares`] = p.shares;
    record[`p${p.n}_address`] = sheetSafe(p.address);
    record[`p${p.n}_roles`] = rolesOf(p);
  }
  const label = safeLabel(value.company_name, 'company');
  return forward(target, {
    kind: 'company',
    ref,
    record,
    files: files.map((f) => {
      const n = f.field.slice(1, 2);
      const who = safeLabel(record[`p${n}_name`], `party ${n}`);
      return { ...f, name: `${ref} Party ${n} ID - ${who} - ${label}.${f.ext}` };
    }),
  }, { next: COMPANY_PLAN.url, plan: COMPANY_PLAN.name }, env, startedAt);
};

export const config = { path: '/api/incorporation', rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
