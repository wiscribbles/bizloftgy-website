import { isMock } from './spheremail.mjs';
// Maps the site's plan keys to SphereMail plan IDs configured in Netlify
// environment variables. A plan with no ID configured is shown as
// "enquire" rather than offered for online signup.
const ENV_KEYS = {
  mailbox_only: 'SPHEREMAIL_PLAN_MAILBOX_ONLY',
  virtual_office: 'SPHEREMAIL_PLAN_VIRTUAL_OFFICE',
  virtual_office_plus: 'SPHEREMAIL_PLAN_VIRTUAL_OFFICE_PLUS',
};
const MOCK_IDS = { mailbox_only: 101, virtual_office: 102, virtual_office_plus: 103 };

export function planIdFor(key, env = process.env) {
  if (isMock(env)) return MOCK_IDS[key] || null;
  const raw = env[ENV_KEYS[key]];
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
