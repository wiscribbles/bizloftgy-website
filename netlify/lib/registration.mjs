// Business-name registration form: validation and file checks.
// This is the security boundary. The browser checks the same things for
// convenience, but nothing it sends is trusted until it has passed through here.

export const PRINCIPAL_PLACE = 'Lot 43 Croal Street, Stabroek, Georgetown, Guyana (provided by The Business Loft)';

// Business registration has its own SphereMail plan (8301): GYD 16,000 one-off,
// covering DCRA's fee and the mailbox set-up, plus Mailbox Only monthly. Paid at sign-up.
export const BUSINESS_PLAN = { name: 'Business registration + Mailbox Only (plan 8301)', url: 'https://thebusinessloft.spheremail.co/customers/sign-up?plan_id=8301&term=monthly' };

export const MAX_FILE_BYTES = 2_000_000;   // per upload, after the browser has shrunk photos
export const MAX_BODY_BYTES = 4_400_000;   // stays under Netlify's 6 MB function payload limit once encoded

// Text fields: [name, label, required, max length]
export const TEXT_FIELDS = [
  ['business_name', 'Business name', true, 120],
  ['nature', 'Nature of the business', true, 300],
  ['present_names', 'Present forenames and surname', true, 120],
  ['former_names', 'Former forenames and surname', false, 120],
  ['nationality', 'Nationality', true, 60],
  ['nationality_origin', 'Nationality of origin', false, 60],
  ['residence', 'Usual residence', true, 300],
  ['other_occupation', 'Other business occupation', true, 200],
  ['other_business_names', 'Other business names', false, 300],
  ['id_number', 'ID or passport number', true, 30],
  ['dob', 'Date of birth', true, 10],
  ['phone', 'Contact numbers', true, 80],
  ['email', 'Email', true, 254],
  ['tin', 'TIN certificate number', true, 20],
  ['commencement', 'Date of commencement', false, 10],
];

export const FILE_FIELDS = [
  ['id_doc', 'Scan of your National ID card or passport'],
  ['tin_cert', 'Scan of your TIN certificate'],
];

const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function clean(v, max, multiline = false) {
  if (typeof v !== 'string') return '';
  let s = v.replace(CONTROL_RE, '');
  s = multiline ? s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}

function parseDate(s) {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return d;
}

function ageOn(dob, now) {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

/** Validate the text part of the form. Returns { ok, errors, value }. */
export function validateRegistration(input, now = new Date()) {
  const v = {};
  const errors = {};
  for (const [name, label, required, max] of TEXT_FIELDS) {
    const multiline = ['nature', 'residence', 'other_business_names'].includes(name);
    v[name] = clean(input[name], max, multiline);
    if (required && !v[name]) errors[name] = `Enter ${label.toLowerCase()}.`;
  }
  v.email = v.email.toLowerCase();

  if (v.business_name && v.business_name.length < 2) errors.business_name = 'Enter the full business name.';
  if (v.nature && v.nature.length < 3) errors.nature = 'Describe what the business does.';
  if (v.present_names && !/^[\p{L}\p{M}][\p{L}\p{M} .,'’-]{2,119}$/u.test(v.present_names)) errors.present_names = 'Enter your forenames and surname, as on your ID.';
  if (v.residence && v.residence.length < 5) errors.residence = 'Enter your full home address.';
  if (v.id_number && !/^[A-Za-z0-9][A-Za-z0-9 /-]{3,29}$/.test(v.id_number)) errors.id_number = 'Enter the number exactly as it appears on your ID or passport.';
  if (v.tin && !/^[A-Za-z0-9][A-Za-z0-9 -]{3,19}$/.test(v.tin)) errors.tin = 'Enter the TIN as it appears on your certificate.';
  if (v.email && !EMAIL_RE.test(v.email)) errors.email = 'Enter a valid email address.';
  if (v.phone) {
    const digits = v.phone.replace(/\D/g, '');
    if (!/^[+\d][\d\s()+.,/-]*$/.test(v.phone) || digits.length < 7) errors.phone = 'Enter at least one phone number, with the country code if outside Guyana.';
  }
  if (v.dob) {
    const d = parseDate(v.dob);
    if (!d) errors.dob = 'Enter your date of birth.';
    else if (ageOn(d, now) < 18) errors.dob = 'The applicant must be 18 or older.';
    else if (ageOn(d, now) > 110) errors.dob = 'Check the year of your date of birth.';
  }
  if (v.commencement) {
    const d = parseDate(v.commencement);
    const max = new Date(now.getTime() + 366 * 86400_000);
    if (!d || d.getUTCFullYear() < 1900 || d > max) errors.commencement = 'Enter a valid date, or leave it blank.';
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
