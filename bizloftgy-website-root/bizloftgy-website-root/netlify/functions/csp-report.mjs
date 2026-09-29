// POST /api/csp-report — receives Content-Security-Policy violation reports so
// a blocked third-party origin (OfficeRnD, Stripe, Turnstile) shows up in the
// Netlify function log instead of silently breaking the page. Only the directive
// and the blocked origin are logged, never full URLs with query strings.
import { log } from '../lib/http.mjs';

function originOf(u) {
  try { return new URL(u).origin; } catch { return typeof u === 'string' ? u.slice(0, 40) : ''; }
}

export default async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  try {
    const text = (await req.text()).slice(0, 16 * 1024);
    const data = JSON.parse(text);
    const reports = Array.isArray(data) ? data.map((r) => r.body || r) : [data['csp-report'] || data];
    for (const r of reports.slice(0, 2)) {
      log('csp_violation', {
        directive: String(r.effectiveDirective || r['effective-directive'] || r['violated-directive'] || '').slice(0, 60),
        blocked: originOf(r.blockedURL || r['blocked-uri'] || ''),
        page: originOf(r.documentURL || r['document-uri'] || ''),
      });
    }
  } catch { /* ignore malformed reports */ }
  return new Response(null, { status: 204 });
};

export const config = { path: '/api/csp-report', rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
