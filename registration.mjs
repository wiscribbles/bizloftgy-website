// Business Registration package: validation and file checks.
// The package is DCRA business-name registration plus GRA and NIS compliance
// certificate applications. Clients download and complete two PDFs (the DCRA
// application and the Bizloft letter of authorisation) and upload them with their
// ID and TIN certificate. This is the security boundary: the browser checks the
// same things for convenience, but nothing it sends is trusted until it passes here.

export const PRINCIPAL_PLACE = 'Lot 43 Croal Street, Stabroek, Georgetown, Guyana (provided by The Business Loft)';

// SphereMail plan 8301: the Business Registration package (GYD 30,000 one-off) plus
// Mailbox Only monthly. Paid at sign-up.
export const BUSINESS_PLAN = { name: 'Business Registration package + Mailbox Only (plan 8301)', url: 'https://thebusinessloft.spheremail.co/customers/sign-up?plan_id=8301&term=monthly' };

export const MAX_FILE_BYTES = 2_000_000;        // per upload, after the browser has shrunk photos
export const MAX_TOTAL_FILE_BYTES = 4_200_000;  // all uploads together
export const MAX_BODY_BYTES = 4_400_000;        // stays under Netlify's 6 MB function payload limit once encoded

// Text fields: [name, label, required, max length]
export const TEXT_FIELDS = [
  ['applicant_name', 'Full name', true, 120],
  ['phone', 'Contact numbers', true, 80],
  ['email', 'Email', true, 254],
];

// Upload fields: [name, label, short name used in the Drive file name]
export const FILE_FIELDS = [
  ['application', 'Business Registration Application Form', 'Application form'],
  ['authorization', 'Bizloft Authorization Form', 'Authorization'],
  ['id_doc', 'National ID card or passport', 'ID'],
  ['tin_cert', 'TIN certificate', 'TIN'],
];

const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function clean(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Validate the text part of the form. Returns { ok, errors, value }. */
export function validateRegistration(input) {
  const v = {};
  const errors = {};
  for (const [name, label, required, max] of TEXT_FIELDS) {
    v[name] = clean(input[name], max);
    if (required && !v[name]) errors[name] = `Enter your ${label.toLowerCase()}.`;
  }
  v.email = v.email.toLowerCase();
  if (v.applicant_name && !/^[\p{L}\p{M}][\p{L}\p{M} .,'’-]{2,119}$/u.test(v.applicant_name)) errors.applicant_name = 'Enter your full name, as it appears on your ID.';
  if (v.email && !EMAIL_RE.test(v.email)) errors.email = 'Enter a valid email address.';
  if (v.phone) {
    const digits = v.phone.replace(/\D/g, '');
    if (!/^[+\d][\d\s()+.,/-]*$/.test(v.phone) || digits.length < 7) errors.phone = 'Enter at least one phone number, with the country code if outside Guyana.';
  }
  if (input.consent !== 'yes') errors.consent = 'Please confirm the declaration to continue.';
  return { ok: Object.keys(errors).length === 0, errors, value: v };
}

/** Identify an upload by its first bytes, never by its name or the browser's claim. */
export function sniffType(bytes) {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return { mime: 'application/pdf', ext: 'pdf' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { mime: 'image/png', ext: 'png' };
  return null;
}

/** Check one uploaded File. Returns { ok, error } or { ok, file: { mime, ext, bytes } }. */
export async function checkUpload(file, label) {
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function' || file.size === 0) {
    return { ok: false, error: `Attach the ${label.toLowerCase()}.` };
  }
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: 'This file is larger than 2 MB. Send a smaller scan or a photo instead.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes);
  if (!type) return { ok: false, error: 'Upload a PDF, JPG or PNG file.' };
  return { ok: true, file: { ...type, bytes } };
}

/** Values that start like a formula would run as one in Google Sheets. */
export function sheetSafe(s) {
  return typeof s === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
