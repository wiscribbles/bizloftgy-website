// SphereMail API client — server-side only.
//
// Grounded in the SphereMail v1 API documentation:
//   POST  /authentication/                     login -> { access_token, refresh_token, ... }   (no auth)
//   DELETE /authentication/                    logout / invalidate tokens                        (bearer)
//   GET   /plans/                              list plans                                        (no auth)
//   GET   /account/validate_available?email=   422 when taken                                    (no auth)
//   POST  /account/generate_verification_code/ { email } -> emails a verification_code           (no auth)
//   POST  /account/                            { account: {...} } create customer account        (no auth)
//   POST  /subscriptions                       { plan_id, term } -> 201                          (bearer)
//   GET   /countries, GET /countries/:id       used to resolve country_id / state_id
//
// Security properties:
//  - This module never runs in the browser. Customer passwords arrive over HTTPS,
//    are forwarded once to SphereMail and are never logged or stored.
//  - The session opened to create the subscription is closed immediately after;
//    access and refresh tokens never leave this function.
//  - Card details are never collected by this site. Customers add a payment method
//    in the SphereMail customer portal, where SphereMail's payment gateway handles it.
//  - Every call has a timeout, and upstream errors are mapped to safe messages.

import { isProductionRuntime } from './http.mjs';

const DEFAULT_BASE = 'https://api.spheremail.co/v1';

export class SphereMailError extends Error {
  constructor(message, { status = 0, fields = {}, code = 'UPSTREAM' } = {}) {
    super(message);
    this.status = status;
    this.fields = fields; // { firstName: 'message', ... } safe to show the user
    this.code = code;
  }
}

// SphereMail field -> our form field, for surfacing validation errors next to the right input.
const FIELD_MAP = {
  first_name: 'firstName', last_name: 'lastName', company_name: 'company', email: 'email',
  phone: 'phone', password: 'password', street: 'street', city: 'city', zip_code: 'postcode',
  state_id: 'region', country_id: 'country', verification_code: 'code', user_name: 'email',
  accept_terms: 'acceptTerms', accept_policy: 'acceptTerms',
};

function safeText(s) {
  return String(s).replace(/<[^>]*>/g, '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 200);
}

function mapUpstreamErrors(payload) {
  const out = {};
  const errs = payload && typeof payload === 'object' ? payload.errors : null;
  if (!errs || typeof errs !== 'object') return out;
  for (const [key, val] of Object.entries(errs)) {
    const msg = Array.isArray(val) ? val[0] : val;
    if (typeof msg !== 'string' || !msg) continue;
    const field = FIELD_MAP[key] || (key === 'base' ? 'form' : null);
    if (field && !out[field]) out[field] = safeText(msg);
  }
  return out;
}

export function createClient(env = process.env) {
  const base = (env.SPHEREMAIL_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
  if (!base.startsWith('https://')) throw new Error('SPHEREMAIL_API_BASE must be https');
  let extra = {};
  if (env.SPHEREMAIL_EXTRA_HEADERS) {
    // Optional operator-scoping headers, if SphereMail gives you any. JSON object.
    try { extra = JSON.parse(env.SPHEREMAIL_EXTRA_HEADERS); } catch { extra = {}; }
  }

  async function call(method, path, { body, token, query } = {}) {
    const url = new URL(base + path);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const headers = { accept: 'application/json', ...extra };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(Number(env.SPHEREMAIL_TIMEOUT_MS || 10000)),
        redirect: 'error',
      });
    } catch (e) {
      throw new SphereMailError('SphereMail unreachable', { code: e?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK' });
    }
    let payload = null;
    const text = await res.text();
    if (text) { try { payload = JSON.parse(text); } catch { payload = null; } }
    if (!res.ok) {
      throw new SphereMailError(`SphereMail ${method} ${path} -> ${res.status}`, {
        status: res.status,
        fields: mapUpstreamErrors(payload),
        code: res.status === 419 ? 'TOKEN_EXPIRED' : res.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM',
      });
    }
    return payload;
  }

  // --- location resolution (SphereMail's account schema is US-shaped: country_id,
  // state_id and zip_code are required). Resolved once per instance and cached.
  const countryCache = new Map();
  async function resolveLocation(countryIso2, countryName, regionName) {
    const envCountry = env[`SPHEREMAIL_COUNTRY_ID_${countryIso2}`];
    let countryId = envCountry ? Number(envCountry) : countryCache.get(countryIso2);
    if (!countryId) {
      const data = await call('GET', '/countries');
      const list = Array.isArray(data) ? data : data?.countries || data?.data || [];
      const hit = list.find((c) => {
        const codes = [c.iso, c.iso2, c.code, c.alpha2, c.abbreviation].filter(Boolean).map((x) => String(x).toUpperCase());
        const names = [c.name, c.title].filter(Boolean).map((x) => String(x).toLowerCase());
        return codes.includes(countryIso2) || names.includes(countryName.toLowerCase());
      });
      if (!hit?.id) throw new SphereMailError('Country not found in SphereMail', { code: 'CONFIG' });
      countryId = Number(hit.id);
      countryCache.set(countryIso2, countryId);
    }
    let stateId = env[`SPHEREMAIL_STATE_ID_${countryIso2}`] ? Number(env[`SPHEREMAIL_STATE_ID_${countryIso2}`]) : null;
    if (!stateId) {
      try {
        const detail = await call('GET', `/countries/${countryId}`);
        const states = detail?.states || detail?.country?.states || detail?.data?.states || [];
        const want = regionName.toLowerCase();
        const match = states.find((s) => String(s.name || s.title || '').toLowerCase() === want) || states[0];
        if (match?.id) stateId = Number(match.id);
      } catch { /* fall through to default */ }
    }
    if (!stateId && env.SPHEREMAIL_STATE_ID_DEFAULT) stateId = Number(env.SPHEREMAIL_STATE_ID_DEFAULT);
    if (!stateId) throw new SphereMailError('No state_id available for country', { code: 'CONFIG' });
    return { countryId, stateId };
  }

  return {
    listPlans: () => call('GET', '/plans/'),

    async isEmailAvailable(email) {
      try {
        await call('GET', '/account/validate_available', { query: { email } });
        return true;
      } catch (e) {
        if (e.status === 422) return false;
        throw e;
      }
    },

    async isUsernameAvailable(username) {
      try {
        await call('GET', '/account/validate_available', { query: { username } });
        return true;
      } catch (e) {
        if (e.status === 422) return false;
        throw e;
      }
    },

    sendVerificationCode: (email) => call('POST', '/account/generate_verification_code/', { body: { email } }),

    resolveLocation,

    createAccount: (account) => call('POST', '/account/', { body: { account } }),

    login: (login, password) => call('POST', '/authentication/', { body: { login, password } }),

    subscribe: (token, planId, term) => call('POST', '/subscriptions', { token, body: { plan_id: planId, term } }),

    async logout(token) {
      try { await call('DELETE', '/authentication/', { token }); } catch { /* best effort */ }
    },
  };
}

// ---------------------------------------------------------------------------
// Mock client — used when SPHEREMAIL_MOCK=1 (local development and tests).
// Behaves like the real API for the paths this site uses, with fixed triggers:
//   taken@example.com  -> email unavailable
//   code 000000        -> invalid verification code
//   plan id 999        -> subscription fails (account still created)
// ---------------------------------------------------------------------------
export function createMockClient() {
  const accounts = new Map();
  const codes = new Map();
  return {
    async listPlans() {
      return {
        plans: [
          { id: 101, title: 'Mailbox Only', period_unit: 'monthly', period_amount: 600000, is_active: true },
          { id: 102, title: 'Virtual Office', period_unit: 'monthly', period_amount: 1500000, is_active: true },
          { id: 103, title: 'Virtual Office Plus', period_unit: 'monthly', period_amount: 3000000, is_active: true },
        ],
      };
    },
    async isEmailAvailable(email) { return email !== 'taken@example.com' && !accounts.has(email); },
    async isUsernameAvailable() { return true; },
    async sendVerificationCode(email) { codes.set(email, '123456'); return {}; },
    async resolveLocation() { return { countryId: 1, stateId: 1 }; },
    async createAccount(account) {
      if (account.verification_code === '000000') {
        throw new SphereMailError('bad code', { status: 422, fields: { code: 'That code is incorrect or has expired.' } });
      }
      accounts.set(account.email, { ...account, password: '[redacted]' });
      return {};
    },
    async login() { return { access_token: 'mock-access', refresh_token: 'mock-refresh' }; },
    async subscribe(_t, planId) {
      if (planId === 999) throw new SphereMailError('needs payment', { status: 422 });
      return { plan_id: planId };
    },
    async logout() {},
    _accounts: accounts,
  };
}

export function isMock(env = process.env) {
  return env.SPHEREMAIL_MOCK === '1' && !isProductionRuntime(env);
}

export function getClient(env = process.env) {
  return isMock(env) ? createMockClient() : createClient(env);
}
