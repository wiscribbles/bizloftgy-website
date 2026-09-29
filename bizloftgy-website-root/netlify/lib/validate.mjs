// Input validation for the signup endpoints. This is the security boundary:
// the browser validates too, but only for convenience — nothing the client
// sends is trusted until it has passed through here.

export const PLAN_KEYS = ['mailbox_only', 'virtual_office', 'virtual_office_plus'];
export const TERMS = { monthly: 'monthly', annual: 'yearly' }; // site term -> SphereMail term

export const REGIONS_GY = [
  'Barima-Waini',
  'Pomeroon-Supenaam',
  'Essequibo Islands-West Demerara',
  'Demerara-Mahaica',
  'Mahaica-Berbice',
  'East Berbice-Corentyne',
  'Cuyuni-Mazaruni',
  'Potaro-Siparuni',
  'Upper Takutu-Upper Essequibo',
  'Upper Demerara-Berbice',
];

export const COUNTRIES = { GY: 'Guyana', US: 'United States', CA: 'Canada', GB: 'United Kingdom', TT: 'Trinidad and Tobago', BB: 'Barbados' };

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{0,59}$/u;
// Deliberately practical rather than RFC-complete; SphereMail does its own check too.
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const CODE_RE = /^[A-Za-z0-9]{4,10}$/;
const CONTROL_RE = /[\u0000-\u001F\u007F]/g;

function clean(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(CONTROL_RE, '').trim().slice(0, max);
}

function normalisePhone(v) {
  const s = clean(v, 32);
  if (!/^[+\d][\d\s().-]*$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return (s.startsWith('+') ? '+' : '') + digits;
}

/** Step 1: details that trigger the verification email. */
export function validateCodeRequest(input) {
  const errors = {};
  const out = {
    firstName: clean(input.firstName, 60),
    lastName: clean(input.lastName, 60),
    company: clean(input.company, 120),
    email: clean(input.email, 254).toLowerCase(),
    phone: normalisePhone(input.phone),
    plan: clean(input.plan, 40),
    term: clean(input.term, 10),
  };
  if (!NAME_RE.test(out.firstName)) errors.firstName = 'Enter your first name.';
  if (!NAME_RE.test(out.lastName)) errors.lastName = 'Enter your last name.';
  if (!EMAIL_RE.test(out.email)) errors.email = 'Enter a valid email address.';
  if (!out.phone) errors.phone = 'Enter a phone number, including the country code if outside Guyana.';
  if (!PLAN_KEYS.includes(out.plan)) errors.plan = 'Choose a plan.';
  if (!Object.hasOwn(TERMS, out.term)) errors.term = 'Choose monthly or annual billing.';
  return { ok: Object.keys(errors).length === 0, errors, value: out };
}

/** Step 2: everything needed to create the account. Includes step-1 fields
 *  again because the server keeps no session between the two steps. */
export function validateSignup(input) {
  const first = validateCodeRequest(input);
  const errors = { ...first.errors };
  const v = {
    ...first.value,
    code: clean(input.code, 10),
    street: clean(input.street, 200),
    city: clean(input.city, 100),
    region: clean(input.region, 100),
    country: clean(input.country, 2).toUpperCase(),
    postcode: clean(input.postcode, 20),
    password: typeof input.password === 'string' ? input.password : '',
    acceptTerms: input.acceptTerms === true,
  };
  if (!CODE_RE.test(v.code)) errors.code = 'Enter the code from the email we sent you.';
  if (v.street.length < 3) errors.street = 'Enter your street address.';
  if (v.city.length < 2) errors.city = 'Enter your city, town or village.';
  if (!Object.hasOwn(COUNTRIES, v.country)) errors.country = 'Choose your country.';
  if (v.country === 'GY' && !REGIONS_GY.includes(v.region)) errors.region = 'Choose your region.';
  if (v.country !== 'GY' && v.region.length < 2) errors.region = 'Enter your state, province or county.';
  if (v.password.length < 10) errors.password = 'Use at least 10 characters.';
  else if (v.password.length > 128) errors.password = 'Use 128 characters or fewer.';
  else if (v.password.toLowerCase().includes(v.email.split('@')[0]) && v.email.split('@')[0].length >= 4) {
    errors.password = 'Choose a password that doesn’t contain your email name.';
  }
  if (!v.acceptTerms) errors.acceptTerms = 'Please accept the terms and privacy policy to continue.';
  return { ok: Object.keys(errors).length === 0, errors, value: v };
}

/** True when the hidden honeypot field was filled — a bot, not a person. */
export function isBot(input) {
  return typeof input.website === 'string' && input.website.trim() !== '';
}

/** Username for SphereMail: derived from the email, never shown to the user. */
export function deriveUsername(email, suffix) {
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 20) || 'client';
  return `${local}${suffix}`;
}
