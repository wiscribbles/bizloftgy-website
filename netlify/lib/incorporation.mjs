// Company incorporation form: validation. This is the security boundary; the
// browser checks the same rules for convenience only.

export const REGISTERED_OFFICE = 'Lot 43 Croal Street, Stabroek, Georgetown, Guyana (unit number assigned by The Business Loft)';
export const COMPANY_PLAN = { name: 'Virtual Office (plan 8290, monthly)', url: 'https://thebusinessloft.spheremail.co/customers/sign-up?plan_id=8290&term=monthly' };
export const MAX_PARTIES = 5;
export const MAX_TOTAL_FILE_BYTES = 4_200_000;

const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .,'’-]{2,119}$/u;
const SHARES_RE = /^\d{1,3}(\.\d{1,2})?$/;

function clean(v, max, multiline = false) {
  if (typeof v !== 'string') return '';
  let s = v.replace(CONTROL_RE, '');
  s = multiline ? s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}

/** Party n is in use: party 1 always, parties 2–5 when their tick box is ticked. */
export function isActive(input, n) {
  return n === 1 || input[`p${n}_active`] === 'yes';
}

/**
 * input: plain object of form strings. Returns { ok, errors, value } where
 * value.parties lists only the parties in use.
 */
export function validateIncorporation(input) {
  const errors = {};
  const v = {
    company_name: clean(input.company_name, 120),
    company_name_alt: clean(input.company_name_alt, 120),
    nature: clean(input.nature, 300, true),
    phone: clean(input.phone, 80),
    email: clean(input.email, 254).toLowerCase(),
  };
  if (v.company_name.length < 2) errors.company_name = 'Enter the proposed company name.';
  if (v.nature.length < 3) errors.nature = 'Describe what the company will do.';
  if (!v.email || !EMAIL_RE.test(v.email)) errors.email = 'Enter a valid email address.';
  const digits = v.phone.replace(/\D/g, '');
  if (!v.phone || !/^[+\d][\d\s()+.,/-]*$/.test(v.phone) || digits.length < 7) errors.phone = 'Enter at least one phone number, with the country code if outside Guyana.';

  const secretary = clean(input.secretary, 2);
  const parties = [];
  let total = 0;
  for (let n = 1; n <= MAX_PARTIES; n++) {
    if (!isActive(input, n)) continue;
    const p = {
      n,
      name: clean(input[`p${n}_name`], 120),
      shares_raw: clean(input[`p${n}_shares`], 6),
      address: clean(input[`p${n}_address`], 300, true),
      shareholder: input[`p${n}_shareholder`] === 'yes',
      director: input[`p${n}_director`] === 'yes',
      secretary: secretary === String(n),
    };
    if (!p.name) errors[`p${n}_name`] = 'Enter this party’s full name.';
    else if (!NAME_RE.test(p.name)) errors[`p${n}_name`] = 'Enter the full name as it appears on their ID.';
    if (p.address.length < 5) errors[`p${n}_address`] = 'Enter this party’s full address.';
    const sharesText = p.shares_raw === '' ? '0' : p.shares_raw;
    if (!SHARES_RE.test(sharesText) || Number(sharesText) > 100) {
      errors[`p${n}_shares`] = 'Enter a percentage from 0 to 100.';
      p.shares = 0;
    } else {
      p.shares = Number(sharesText);
    }
    if (p.shares > 0 && !p.shareholder) errors[`p${n}_roles`] = 'Tick Shareholder for anyone holding shares.';
    if (p.shareholder && p.shares === 0 && !errors[`p${n}_shares`]) errors[`p${n}_shares`] = 'A shareholder needs a percentage above 0.';
    if (!p.shareholder && !p.director && !p.secretary) errors[`p${n}_roles`] = 'Choose at least one role.';
    total += p.shares;
    parties.push(p);
  }
  total = Math.round(total * 100) / 100;
  if (Math.abs(total - 100) > 0.001) errors.shares_total = `The shares add up to ${total}%. They must add up to exactly 100%.`;
  if (!parties.some((p) => p.director)) errors.directors = 'At least one person must be a Director.';
  if (!parties.some((p) => p.secretary)) errors.secretary = 'Choose one person as Company Secretary.';
  if (input.consent !== 'yes') errors.consent = 'Please confirm the declaration to continue.';

  return { ok: Object.keys(errors).length === 0, errors, value: { ...v, parties, shares_total: total } };
}

export function rolesOf(p) {
  return [p.shareholder && 'Shareholder', p.director && 'Director', p.secretary && 'Company Secretary'].filter(Boolean).join(', ');
}
