// POST /api/registration — business-name registration form.
// Checks the details and the two uploads, then hands them to the Google Apps Script
// web app, which writes a row to the private Google Sheet and saves the uploads in
// a private Google Drive folder. Nothing is stored on this website.
// See google-apps-script/README.md.
import { json, newRef, log } from '../lib/http.mjs';
import { validateRegistration, checkUpload, sheetSafe, BUSINESS_PLAN, PRINCIPAL_PLACE, TEXT_FIELDS, FILE_FIELDS } from '../lib/registration.mjs';
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
  for (const [name, label] of FILE_FIELDS) {
    const r = await checkUpload(form.get(name), label);
    if (!r.ok) errors[name] = r.error;
    else files.push({ field: name, ...r.file });
  }
  if (Object.keys(errors).length) return json(422, { ok: false, code: 'VALIDATION', fields: errors });

  const target = scriptTarget(env);
  if (!target.configured) return notConfigured(ref, target.invalid);

  const label = safeLabel(value.business_name);
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
    files: files.map((f) => ({ ...f, name: `${ref} ${f.field === 'id_doc' ? 'ID' : 'TIN'} - ${label}.${f.ext}` })),
  }, { next: BUSINESS_PLAN.url, plan: BUSINESS_PLAN.name }, env);
};

// Platform rate limit, counted across all instances.
export const config = { path: '/api/registration', rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
