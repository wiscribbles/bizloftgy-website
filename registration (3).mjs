// POST /api/registration — Business Registration package documents.
// Checks the applicant's name and contact details and the four uploads, then hands them to the Google Apps Script
// web app, which writes a row to the private Google Sheet and saves the uploads in
// a private Google Drive folder. Nothing is stored on this website.
// See google-apps-script/README.md.
import { json, newRef, log } from '../lib/http.mjs';
import { validateRegistration, checkUpload, sheetSafe, BUSINESS_PLAN, PRINCIPAL_PLACE, TEXT_FIELDS, FILE_FIELDS, MAX_TOTAL_FILE_BYTES } from '../lib/registration.mjs';
import { scriptTarget, readApplication, isHoneypot, notConfigured, forward, safeLabel } from '../lib/intake.mjs';

export { scriptTarget };

export default async (req, context) => {
  const env = process.env;
  const read = await readApplication(req, context, { key: 'reg', env });
  if (read.response) return read.response;
  const { form } = read;
  const ref = newRef();

  // Bots that fill the hidden field get a normal-looking reply and nothing is stored.
  if (isHoneypot(form)) { log('registration_honeypot', { ref }); return json(200, { ok: true, ref, next: BUSINESS_PLAN.url }); }

  const input = {};
  for (const [name] of TEXT_FIELDS) { const v = form.get(name); input[name] = typeof v === 'string' ? v : ''; }
  input.consent = form.get('consent');

  const { errors, value } = validateRegistration(input);
  const files = [];
  let totalBytes = 0;
  for (const [name, label, short] of FILE_FIELDS) {
    const r = await checkUpload(form.get(name), label);
    if (!r.ok) { errors[name] = r.error; continue; }
    totalBytes += r.file.bytes.length;
    files.push({ field: name, short, ...r.file });
  }
  if (totalBytes > MAX_TOTAL_FILE_BYTES) errors.files_total = 'Your files together are larger than 4 MB. Please use smaller scans or photos.';
  if (Object.keys(errors).length) return json(422, { ok: false, code: 'VALIDATION', fields: errors });

  const target = scriptTarget(env);
  if (!target.configured) return notConfigured(ref, target.invalid);

  const label = safeLabel(value.applicant_name, 'applicant');
  return forward(target, {
    kind: 'business_name',
    ref,
    record: {
      ref,
      submitted_at: new Date().toISOString(),
      principal_place: PRINCIPAL_PLACE,
      plan_name: BUSINESS_PLAN.name,
      ...Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sheetSafe(v)])),
    },
    files: files.map(({ short, ...f }) => ({ ...f, name: `${ref} ${short} - ${label}.${f.ext}` })),
  }, { next: BUSINESS_PLAN.url, plan: BUSINESS_PLAN.name }, env);
};

// Platform rate limit, counted across all instances.
export const config = { path: '/api/registration', rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
