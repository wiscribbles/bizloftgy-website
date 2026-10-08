# The Business Loft — www.bizloftgy.com

Landing page for The Business Loft, Lot 43 Croal Street, Stabroek, Georgetown.

- **Plan signup** buttons link to SphereMail's sign-up page with the plan and term preselected: `https://thebusinessloft.spheremail.co/customers/sign-up?plan_id=…&term=monthly|yearly` (Mailbox Only 8289, Virtual Office 8290, Virtual Office Plus 8291). The Monthly/Annual toggle on the page switches which link is shown. The server-side API functions remain in the repo but are unused.
- **Meeting-room booking** embeds the OfficeRnD Growth Hub calendar, with a link to the booking page (`https://e-commerce.officernd.com/bizloftgy`) as a fallback.
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

The meeting-room section embeds OfficeRnD's Growth Hub (`<growth-hub slug="bizloftgy" initial-route="resources/6aa12ce0276695ee76ff07fd">`), loaded by `site.js` from `https://e-commerce.officernd.com/webc`. An "Open the booking page" button is always shown as a fallback. If the calendar hasn't loaded within 15 seconds, the embed hides itself.

- **Don't put `#section` in the page address.** Growth Hub routes with the URL hash and reads `#book` as an organisation name ("Integration settings not found for org book"). `site.js` scrolls in-page links without changing the hash and clears a section hash on arrival.
- **The CSP must allow OfficeRnD's hosts.** These are e-commerce.officernd.com, CloudFront `d35ll89fr5oblf.cloudfront.net`, unpkg.com (Kendo theme CSS and fonts) and Stripe for checkout.

Keep the room's details and prices in OfficeRnD in line with the rate card: 10 seats, Mon–Fri 08:30–16:30, Saturday 08:00–12:00 and no evening slots.

## Business registration and company incorporation

`/business-registration/` has two forms. Both post to Netlify functions, which check everything, then forward to a Google Apps Script web app that writes to a private Google Sheet and saves the uploads to Drive. Setup is in `google-apps-script/README.md`. Netlify needs `GOOGLE_SCRIPT_URL` and `GOOGLE_SCRIPT_SECRET`; until they're set, both forms ask applicants to WhatsApp or email instead.

**Business-name registration** (`#apply`, `/api/registration`)

- **Price:** GYD 16,000 (US$80) one-off, which includes DCRA's fee and the GYD 1,000 mailbox set-up fee. Then Mailbox Only at GYD 6,000 (US$30) a month.
- **Fields:** the particulars required by the Business Names (Registration) Act, plus email, the ID and TIN uploads, and a declaration. The principal place of business is fixed at Lot 43 Croal Street, Stabroek.
- **Next step:** after submitting, applicants always go to SphereMail plan **8301** (monthly), which is where they pay.

**Company incorporation** (`#company`, `/api/incorporation`)

- **Company details:** proposed name, an alternative name and the nature of the business.
- **Parties:** party 1 is required. Parties 2–5 are switched on with tick boxes. Each party has a full name, shares %, address and roles (Shareholder, Director, or Company Secretary).
- **Rules, checked in the browser and on the server:**
  - shares must total 100%
  - at least one Director
  - exactly one Company Secretary
  - a shareholder must have shares above 0
- **IDs:** one per active party, 2 MB each and 4 MB in total. Photos are shrunk to about 0.7 MB in the browser.
- **Fee and partner:** GYD 275,000 (US$1,375) one-off, paid in cash at our office. Incorporation is offered through our partnership with an external attorney-at-law, and the page, terms and privacy policy all say so.
- **Notices on the form:** standard by-laws, and the registered office at Lot 43 Croal Street, Stabroek, with a unit number assigned after sign-up.
- **Next step:** after submitting, applicants go to SphereMail **Virtual Office** plan 8290, monthly.

Shared code lives in `netlify/lib/intake.mjs`. Validation is in `netlify/lib/registration.mjs` and `netlify/lib/incorporation.mjs`. The browser side is in `public/assets/js/intake.js`.

## Meeting-room photo

`index.html` has a placeholder ("Photo of the boardroom coming soon") above the booking card. When the photo is ready:

1. Export it landscape at 3:2, at least 1600 × 1067 px.
2. Save `room-800`, `room-1200` and `room-1600` as `.avif`, `.webp` and `.jpg` in `public/assets/img/`.
3. Replace the placeholder `<figure class="room-photo room-photo--pending">` with the commented-out `<figure class="room-photo">` just above it.

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
