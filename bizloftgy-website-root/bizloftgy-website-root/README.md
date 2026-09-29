# The Business Loft — www.bizloftgy.com

Landing page for The Business Loft, 43 Croal Street, Stabroek, Georgetown.

- **Plan signup** for Mailbox Only, Virtual Office and Virtual Office Plus runs through the SphereMail API. Small server-side functions handle it, so no API token ever reaches the browser.
- **Meeting-room booking** uses the OfficeRnD Growth Hub web component (`https://e-commerce.officernd.com/webc`).
- The site has no framework and no runtime dependencies. It runs on Netlify.

```
public/                 the website (served as-is)
  index.html            landing page — copy, SEO meta, JSON-LD (LocalBusiness + FAQ)
  privacy/ terms/       policy pages linked from the footer and the signup form
  404.html, robots.txt, sitemap.xml, site.webmanifest, .well-known/security.txt
  assets/css/site.css   brand tokens and layout (navy #081738, gold #DDAE54, Archivo + Source Sans 3)
  assets/js/site.js     header, price switch-over, OfficeRnD loader, signup dialog
  assets/img, fonts     optimised photo (AVIF/WebP/JPEG), logo marks, self-hosted fonts (OFL)
netlify/functions/      /api/plans, /api/signup/code, /api/signup, /api/csp-report
netlify/lib/            request guard, validation, SphereMail client (+ mock)
netlify.toml            security headers, CSP, caching, short links (/book, /plans, /prices)
scripts/check.mjs       build guard: blocks a deploy that contains secrets or mock mode
scripts/dev-server.mjs  local server with the same headers, SphereMail mocked
tests/                  `npm test` — 27 tests for the API layer
```

## Deploy on Netlify

1. **Import the repo.** In Netlify, choose *Add new site → Import an existing project → GitHub → bizloftgy-website*. You don't need to enter a build command or publish directory; both come from `netlify.toml`.
2. **Set the environment variables** under *Site configuration → Environment variables*. `.env.example` lists them all. Required for live signup:
   - `SPHEREMAIL_PLAN_MAILBOX_ONLY`, `SPHEREMAIL_PLAN_VIRTUAL_OFFICE` and `SPHEREMAIL_PLAN_VIRTUAL_OFFICE_PLUS` — the plan IDs from `GET /plans/`.
     - A plan left blank shows **"Enquire about …"** (a WhatsApp link) instead of signup. You can open plans one at a time.
   - `SPHEREMAIL_PORTAL_URL` — the customer portal where clients add a card and upload ID.
   - `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` — see below. Without them, signup refuses requests; it fails closed.
   - **Never** set `SPHEREMAIL_MOCK` or `LOCAL_DEV` on the live site.
     - The build fails if either is visible at build time.
     - On `bizloftgy.com` the functions ignore both at runtime anyway.
3. **Add the domain.** Under *Domain management*:
   - Add `www.bizloftgy.com` as the primary domain and `bizloftgy.com` as an alias.
   - Point DNS at Netlify: either use Netlify DNS, or set a CNAME `www` → `<site>.netlify.app` and an ALIAS/A record for the apex as Netlify instructs.
   - The HTTPS certificate is issued automatically. Netlify itself redirects `http://` to `https://` and `bizloftgy.com` to the primary domain, so keep **www.bizloftgy.com as the primary domain**. Don't add apex/www redirect rules to `netlify.toml`: combined with Netlify's own redirect they can loop ("too many redirects").
4. **Check after the first deploy.**
   - `https://securityheaders.com/?q=www.bizloftgy.com` should grade A.
   - Google's Rich Results Test on the home page should find *LocalBusiness* and *FAQPage*.
   - Submit `https://www.bizloftgy.com/sitemap.xml` in Google Search Console.

### Cloudflare Turnstile (free)

Turnstile is the "not a robot" check. It protects both signup steps; the first one sends an email, so it is the one bots would abuse.

1. In the Cloudflare dashboard, go to *Turnstile → Add widget*. Choose mode *Managed* and add hostnames `www.bizloftgy.com` and `bizloftgy.com`.
2. Copy the keys into `TURNSTILE_SITE_KEY` (public) and `TURNSTILE_SECRET_KEY` (secret).
3. The server only accepts tokens issued for action `signup` on one of the site's own hostnames.

## SphereMail — two ways to take signups

Each plan button can work in one of three ways, chosen by Netlify environment variables. No code change is needed to switch.

| Mode | Set in Netlify | What the customer sees |
|---|---|---|
| **Hosted (recommended to start)** | `SPHEREMAIL_SIGNUP_URL` = your SphereMail customer signup page (https) | The button opens SphereMail's own signup page. SphereMail handles the account, email check, card and ID upload. |
| **In-page form** | Plan IDs plus Turnstile keys (below); leave `SPHEREMAIL_SIGNUP_URL` blank | A two-step form on bizloftgy.com that creates the SphereMail account through the API. |
| **Enquire** | Nothing | A WhatsApp enquiry button. |

`SPHEREMAIL_HOSTED_PLANS` (default `mailbox_only,virtual_office`) picks which plans use the hosted page. Virtual Office Plus stays on "Enquire" unless you add it.

Why hosted first: SphereMail's API documentation doesn't say how requests made without a login are tied to *your* operator account rather than someone else's. Their own customer app works it out from your subdomain. Until SphereMail confirms how a server-to-server signup is tied to Bizloft, the hosted page is the only route guaranteed to create customers under your account.

## SphereMail — what to confirm before switching signup on

The client follows SphereMail's published v1 API:

- `POST /account/` with `account{…, verification_code, accept_terms, accept_policy}`
- `POST /authentication/`
- `POST /subscriptions {plan_id, term}`
- `DELETE /authentication/`

Some details depend on how SphereMail has set up your operator account. Ask SphereMail support to confirm these:

- [ ] **Plan IDs and prices.** Create the three plans in SphereMail at the rate-card prices (opening rates until 31 Dec 2026), then copy the IDs into Netlify. The site shows prices, but SphereMail charges them, so they must match.
- [ ] **Country and state IDs for Guyana.**
  - The account schema is US-shaped: it requires `country_id`, `state_id` and `zip_code`.
  - The functions look Guyana up via `GET /countries` and match the region by name. If that fails, set `SPHEREMAIL_COUNTRY_ID_GY` and `SPHEREMAIL_STATE_ID_GY` (or `SPHEREMAIL_STATE_ID_DEFAULT`).
  - Guyana has no postcodes, so `SPHEREMAIL_DEFAULT_ZIP` (default `00000`) is sent. Confirm SphereMail accepts it.
- [ ] **Phone format.** Confirm `+592…` numbers are accepted.
- [ ] **Verification codes.** Confirm how long a code lasts and how many wrong attempts SphereMail allows. The site limits attempts too, but SphereMail's limit is the real one.
- [ ] **Operator scoping.** If SphereMail gives you an operator-specific API URL or header, set `SPHEREMAIL_API_BASE` / `SPHEREMAIL_EXTRA_HEADERS`.
- [ ] **Payment step.** If SphereMail refuses a subscription until a card is on file, signup still succeeds. The customer sees "Your account is set up — choose your plan in the portal" and is sent there.
- [ ] **Identity documents.** Confirm the portal asks for ID and proof of address. The site tells customers to upload them there.

Test with a real email address on a Netlify deploy preview before sending the site live.

## OfficeRnD booking

1. The OfficeRnD organisation is `bizloftgy` (set as `data-slug` in `public/index.html`), so the storefront is `https://e-commerce.officernd.com/bizloftgy`.
2. The component opens on the meeting-room listing (`initial-route="dashboard?type=meeting_room&listingType=resource"`). Change `data-initial-route` if you want a different page.
3. Set the room's prices in OfficeRnD to match the rate card, including the off-peak rate and the 10% discount for Virtual Office clients.

How it loads:

- The booking script loads only when a visitor scrolls near the booking block, so it doesn't slow the first screen.
- If OfficeRnD can't load, the block shows *Message us on WhatsApp* and *Call* buttons instead of an empty box.
- Google Tag Manager inside the component is switched off (`skip-gtm-initialization`). The site doesn't use GTM, and the CSP would block it.

If the calendar ever fails to load after an OfficeRnD update:

- Look in *Netlify → Logs → Functions → csp-report* for `csp_violation` lines. Each line names the blocked domain.
- Add that domain to the matching directive in `netlify.toml`.

## Prices switch automatically on 1 January 2027

The page contains both the opening and the standard rates.

- From midnight on 1 January 2027, Guyana time, `site.js` hides the opening rates and shows the standard ones.
- To preview the January page now, add `?prices=standard` to the URL.
- After January, delete the `only-opening` elements from `index.html` so the HTML matches what visitors see.
- Update the SphereMail and OfficeRnD prices on the same day.

## Local development

```bash
npm run dev      # http://localhost:8888 — SphereMail is mocked
npm test         # API tests (Node 20+)
```

The mock SphereMail works like this:

| Input | Result |
|---|---|
| Any email | Code `123456` works |
| Code `000000` | Wrong-code error |
| `taken@example.com` | "Already registered" |

## Security summary

- **Secrets stay server-side.** Nothing secret is in this repository or in the browser. SphereMail sessions are opened on the server and closed immediately after the subscription is created. Passwords are forwarded once over HTTPS and never logged or stored.
- **No card data.** This site never collects card numbers. Cards go into SphereMail's portal and OfficeRnD's Stripe checkout.
- **What every POST endpoint checks:**
  - an exact `Origin` match against our own domains (CSRF)
  - a JSON content type, with no CORS allowances
  - an 8 KB body limit
  - a honeypot field
  - server-side validation against allow-lists
  - Netlify platform rate limits, plus per-email and per-IP limits
  - Turnstile on both signup steps
- **Safe errors.** Error messages never include upstream detail. Each error carries a 10-character reference that matches a log line, and the log line contains no personal data. The server doesn't reveal whether an email already has an account at the account-creation step.
- **Headers.**
  - CSP with no inline or eval script, `object-src 'none'` and `frame-ancestors 'none'`, with violation reports sent to `/api/csp-report`
  - HSTS, nosniff, `Referrer-Policy`, `Permissions-Policy` and COOP
- **Known trade-offs:**
  - `style-src` allows inline styles because the OfficeRnD component injects its own.
  - OfficeRnD's script runs on the same page as the signup form, so the page trusts OfficeRnD. The script is limited to `e-commerce.officernd.com` and its CDN. If you want stricter isolation later, move booking to its own `/book/` page with its own CSP.

## Before launch

- [ ] The sign in the hero photograph shows the logo in **orange**, not the navy and gold used everywhere else. Replace the sign, or swap in a photo that doesn't show it.
- [ ] An attorney has reviewed the registered-office wording for Virtual Office Plus, and the privacy and terms pages. See the project note *Registered office — regulatory note*.
- [ ] The competitor figures in the comparison block are still current. Recheck them every six months.
- [ ] Someone who has never seen the site has booked the room and started a plan on a phone, start to finish, without help.
