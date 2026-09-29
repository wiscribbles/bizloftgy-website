/* The Business Loft — bizloftgy.com
   No dependencies. Everything user-supplied is written with textContent,
   never innerHTML. Nothing is stored in the browser. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const root = document.documentElement;

  // ---------------------------------------------------------------------------
  // 1. Opening rates run to 31 Dec 2026 (Guyana time, UTC-4). From then on the
  //    page shows standard rates without anyone having to edit it.
  //    ?prices=standard previews the January page.
  // ---------------------------------------------------------------------------
  const OPENING_ENDS = Date.parse('2027-01-01T04:00:00Z');
  const forceStandard = new URLSearchParams(location.search).get('prices') === 'standard';
  if (forceStandard || Date.now() >= OPENING_ENDS) root.classList.add('after-opening');
  const yr = $('[data-year]');
  if (yr) yr.textContent = String(new Date().getFullYear());

  // ---------------------------------------------------------------------------
  // 2. Header: transparent over the photo, solid navy once scrolled.
  // ---------------------------------------------------------------------------
  const header = $('[data-header]');
  const hero = $('.hero');
  if (header) {
    if (hero && 'IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => header.classList.toggle('is-solid', !e.isIntersecting), {
        rootMargin: '-80px 0px 0px 0px',
      }).observe(hero);
    } else {
      header.classList.add('is-solid');
    }
  }
  const menuBtn = $('[data-menu-btn]');
  const mobileNav = $('[data-mobile-nav]');
  if (menuBtn && mobileNav) {
    const setMenu = (open) => {
      menuBtn.setAttribute('aria-expanded', String(open));
      mobileNav.hidden = !open;
      if (open) header.classList.add('is-solid');
    };
    menuBtn.addEventListener('click', () => setMenu(mobileNav.hidden));
    mobileNav.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !mobileNav.hidden) { setMenu(false); menuBtn.focus(); } });
  }

  // ---------------------------------------------------------------------------
  // 3. Monthly / annual toggle on the plan cards.
  // ---------------------------------------------------------------------------
  const plansSection = $('[data-plans]');
  let currentTerm = 'monthly';
  $$('[data-term-btn]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentTerm = btn.dataset.termBtn;
      plansSection.dataset.term = currentTerm;
      $$('[data-term-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Plan signup (SphereMail via our own /api functions).
  // ---------------------------------------------------------------------------
  const PLAN_NAMES = { mailbox_only: 'Mailbox Only', virtual_office: 'Virtual Office', virtual_office_plus: 'Virtual Office Plus' };
  const PRICES = {
    opening: { mailbox_only: [6000, 60000, 5000], virtual_office: [15000, 150000, 8000], virtual_office_plus: [30000, 300000, 10000] },
    standard: { mailbox_only: [8000, 80000, 5000], virtual_office: [19000, 190000, 8000], virtual_office_plus: [38000, 380000, 10000] },
  };
  const WHATSAPP = 'https://wa.me/5926032923';
  const fmt = (n) => n.toLocaleString('en-US');

  const dlg = $('[data-signup-dialog]');
  if (!dlg) return;
  const f1 = $('form[data-step="1"]', dlg);
  const f2 = $('form[data-step="2"]', dlg);
  const done = $('[data-step="3"]', dlg);

  let config = null;          // from /api/plans
  let configPromise = null;
  let tsWidget = null;
  let tsToken = '';
  let step1Data = null;       // kept in memory only between steps

  function loadConfig() {
    if (!configPromise) {
      configPromise = fetch('/api/plans', { headers: { accept: 'application/json' }, credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((c) => { config = c; applyAvailability(); return c; })
        .catch(() => { config = { ok: false, available: {} }; applyAvailability(); return config; });
    }
    return configPromise;
  }

  // Each plan button ends up as one of three things:
  //  - a link to SphereMail's hosted signup page (hosted mode, set in Netlify),
  //  - the in-page signup form (a SphereMail plan ID is configured), or
  //  - a WhatsApp enquiry (neither is configured).
  function applyAvailability() {
    $$('[data-signup]').forEach((btn) => {
      const key = btn.dataset.signup;
      if (config && config.signupUrl && config.hosted && config.hosted[key] && /^https:\/\//.test(config.signupUrl)) {
        const a = document.createElement('a');
        a.className = btn.className;
        a.href = config.signupUrl;
        a.rel = 'noopener';
        a.textContent = btn.textContent;
        btn.replaceWith(a);
        return;
      }
      if (config && config.available && config.available[key]) return;
      const a = document.createElement('a');
      a.className = btn.className;
      a.href = `${WHATSAPP}?text=${encodeURIComponent(`Hi, I'd like to start ${PLAN_NAMES[key]} at The Business Loft.`)}`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = `Enquire about ${PLAN_NAMES[key]}`;
      btn.replaceWith(a);
    });
  }

  function planSummary(plan, term) {
    const band = root.classList.contains('after-opening') ? 'standard' : 'opening';
    const [m, y, setup] = PRICES[band][plan];
    return term === 'annual'
      ? `GYD ${fmt(y)} a year, set-up waived.`
      : `GYD ${fmt(m)} a month, plus one-off set-up of GYD ${fmt(setup)}.`;
  }
  function refreshHeader() {
    const plan = f1.plan.value;
    const term = f1.querySelector('input[name="term"]:checked').value;
    $('[data-plan-name]', dlg).textContent = PLAN_NAMES[plan];
    $('[data-plan-summary]', dlg).textContent = planSummary(plan, term);
  }
  f1.plan.addEventListener('change', refreshHeader);
  $$('input[name="term"]', f1).forEach((r) => r.addEventListener('change', refreshHeader));

  function showStep(n) {
    f1.hidden = n !== 1; f2.hidden = n !== 2; done.hidden = n !== 3;
    $$('[data-step-ind]', dlg).forEach((li) => {
      const i = Number(li.dataset.stepInd);
      if (i === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      li.classList.toggle('done', i < n);
    });
    const target = n === 3 ? done : $('input:not([type=hidden]):not([tabindex="-1"])', n === 1 ? f1 : f2);
    if (target) setTimeout(() => target.focus(), 30);
  }

  function clearErrors(form) {
    $$('[data-err]', form).forEach((p) => { p.textContent = ''; });
    $$('[aria-invalid]', form).forEach((el) => { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); });
    const a = $('[data-form-alert]', form); a.hidden = true; a.textContent = '';
  }
  function fieldEl(form, name) {
    if (name === 'region') return form.country && form.country.value !== 'GY' ? form.regionOther : form.region;
    return form.elements[name];
  }
  function showErrors(form, fields) {
    let first = null;
    for (const [name, msg] of Object.entries(fields || {})) {
      const holders = $$(`[data-err="${name}"]`, form).filter((p) => !p.closest('[hidden]'));
      const holder = holders[0];
      if (holder) holder.textContent = msg;
      const el = fieldEl(form, name);
      if (el && el.setAttribute) {
        el.setAttribute('aria-invalid', 'true');
        if (holder) { holder.id = holder.id || `err-${name}`; el.setAttribute('aria-describedby', holder.id); }
        if (!first) first = el;
      } else if (!holder && msg) {
        alertMsg(form, msg);
      }
    }
    if (first && first.focus) first.focus();
  }
  function alertMsg(form, msg, ref) {
    const a = $('[data-form-alert]', form);
    a.textContent = ref ? `${msg} (Reference ${ref})` : msg;
    a.hidden = false;
    a.scrollIntoView({ block: 'nearest' });
  }
  function busy(form, on) {
    const b = $('button[type="submit"]', form);
    b.disabled = on;
    b.classList.toggle('is-busy', on);
  }

  async function post(url, body) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
    } catch {
      return { status: 0, data: { ok: false, message: 'You seem to be offline. Check your connection and try again.' } };
    }
    let data = {};
    try { data = await res.json(); } catch { data = {}; }
    return { status: res.status, data };
  }

  // Turnstile (bot check) — loaded only when the dialog opens and only if configured.
  // Each step gets a fresh token; the widget is re-rendered into the visible form.
  function ensureTurnstile(form = f1) {
    const key = config && config.turnstileSiteKey;
    $$('[data-turnstile]', dlg).forEach((b) => { b.hidden = true; });
    if (!key) return;
    const box = $('[data-turnstile]', form);
    box.hidden = false;
    const render = () => {
      if (tsWidget !== null) { try { window.turnstile.remove(tsWidget); } catch { /* already gone */ } tsWidget = null; }
      tsToken = '';
      tsWidget = window.turnstile.render(box, {
        sitekey: key,
        action: 'signup',
        callback: (t) => { tsToken = t; },
        'expired-callback': () => { tsToken = ''; },
        'error-callback': () => { tsToken = ''; },
      });
    };
    if (window.turnstile) { render(); return; }
    const existing = $('script[data-ts]');
    if (existing) { existing.addEventListener('load', render, { once: true }); return; }
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.defer = true; s.dataset.ts = '1';
    s.addEventListener('load', render, { once: true });
    document.head.appendChild(s);
  }

  async function openSignup(plan) {
    f1.reset(); f2.reset(); clearErrors(f1); clearErrors(f2);
    step1Data = null;
    f1.plan.value = plan;
    const termInput = f1.querySelector(`input[name="term"][value="${currentTerm}"]`);
    if (termInput) termInput.checked = true;
    syncCountry();
    refreshHeader();
    showStep(1);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    await loadConfig();
    ensureTurnstile(f1);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-signup]');
    if (btn) { e.preventDefault(); openSignup(btn.dataset.signup); }
  });
  $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('close', () => { f2.password.value = ''; f2.password2.value = ''; step1Data = null; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // backdrop click

  // Step 1 — details, then email a code.
  const NAME_OK = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{0,59}$/u;
  const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  f1.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(f1);
    const data = {
      firstName: f1.firstName.value.trim(),
      lastName: f1.lastName.value.trim(),
      company: f1.company.value.trim(),
      email: f1.email.value.trim(),
      phone: f1.phone.value.trim(),
      plan: f1.plan.value,
      term: f1.querySelector('input[name="term"]:checked').value,
    };
    const errs = {};
    if (!NAME_OK.test(data.firstName)) errs.firstName = 'Enter your first name.';
    if (!NAME_OK.test(data.lastName)) errs.lastName = 'Enter your last name.';
    if (!EMAIL_OK.test(data.email)) errs.email = 'Enter a valid email address.';
    if (data.phone.replace(/\D/g, '').length < 7) errs.phone = 'Enter a mobile number, with the country code if outside Guyana.';
    if (Object.keys(errs).length) { showErrors(f1, errs); return; }
    if (config && config.turnstileSiteKey && !tsToken) { alertMsg(f1, 'Please complete the “I’m not a robot” check above the button.'); return; }

    busy(f1, true);
    const { status, data: r } = await post('/api/signup/code', { ...data, website: f1.website.value, turnstileToken: tsToken });
    busy(f1, false);
    if (status === 200 && r.ok) {
      step1Data = data;
      $('[data-sent-to]', f2).textContent = `We’ve emailed a code to ${data.email}. It can take a minute — check your spam folder if it isn’t there.`;
      showStep(2);
      ensureTurnstile(f2);
      return;
    }
    ensureTurnstile(f1);
    if (r.fields) showErrors(f1, r.fields);
    else alertMsg(f1, r.message || 'Something went wrong on our side. Please try again, or message us on WhatsApp.', r.ref);
  });

  // Step 2 — create the account and open the subscription.
  function syncCountry() {
    const gy = f2.country.value === 'GY';
    $('[data-region-gy]', f2).hidden = !gy;
    $('[data-region-other]', f2).hidden = gy;
    $('[data-postcode]', f2).hidden = gy;
  }
  f2.country.addEventListener('change', syncCountry);
  $('[data-back]', f2).addEventListener('click', () => { clearErrors(f2); showStep(1); ensureTurnstile(f1); });

  f2.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(f2);
    if (!step1Data) { showStep(1); return; }
    const gy = f2.country.value === 'GY';
    const data = {
      ...step1Data,
      code: f2.code.value.replace(/\s/g, ''),
      street: f2.street.value.trim(),
      city: f2.city.value.trim(),
      country: f2.country.value,
      region: gy ? f2.region.value : f2.regionOther.value.trim(),
      postcode: gy ? '' : f2.postcode.value.trim(),
      password: f2.password.value,
      acceptTerms: f2.acceptTerms.checked,
      website: f1.website.value,
    };
    const errs = {};
    if (!/^[A-Za-z0-9]{4,10}$/.test(data.code)) errs.code = 'Enter the code from the email we sent you.';
    if (data.street.length < 3) errs.street = 'Enter your street address.';
    if (data.city.length < 2) errs.city = 'Enter your city, town or village.';
    if (data.region.length < 2) errs.region = gy ? 'Choose your region.' : 'Enter your state, province or county.';
    if (data.password.length < 10) errs.password = 'Use at least 10 characters.';
    else if (data.password !== f2.password2.value) errs.password2 = 'The two passwords don’t match.';
    if (!data.acceptTerms) errs.acceptTerms = 'Please accept the terms and privacy policy to continue.';
    if (Object.keys(errs).length) { showErrors(f2, errs); return; }
    if (config && config.turnstileSiteKey && !tsToken) { alertMsg(f2, 'Please complete the “I’m not a robot” check above the button.'); return; }

    busy(f2, true);
    const { status, data: r } = await post('/api/signup', { ...data, turnstileToken: tsToken });
    busy(f2, false);
    if ((status === 201 || status === 200) && r.ok) {
      f2.password.value = ''; f2.password2.value = '';
      step1Data = null;
      const portal = $('[data-portal]', done);
      if (r.portalUrl && /^https:\/\//.test(r.portalUrl)) { portal.href = r.portalUrl; portal.hidden = false; } else { portal.hidden = true; }
      if (r.subscribed === false) {
        $('[data-done-title]', done).textContent = 'Your account is set up.';
        $('[data-done-text]', done).textContent = r.message || 'To finish, sign in to your mailbox account and choose your plan there. Then:';
      } else {
        $('[data-done-title]', done).textContent = `You’re signed up for ${PLAN_NAMES[data.plan]}.`;
        $('[data-done-text]', done).textContent = 'Two things left before we switch your plan on:';
      }
      showStep(3);
      return;
    }
    const f = r.fields || {};
    const step1Keys = ['firstName', 'lastName', 'company', 'email', 'phone', 'plan', 'term'];
    const s1 = Object.fromEntries(Object.entries(f).filter(([k]) => step1Keys.includes(k)));
    const s2 = Object.fromEntries(Object.entries(f).filter(([k]) => !step1Keys.includes(k)));
    if (Object.keys(s1).length) { showStep(1); showErrors(f1, s1); ensureTurnstile(f1); return; }
    ensureTurnstile(f2);
    if (Object.keys(s2).length) { showErrors(f2, s2); if (s2.form) alertMsg(f2, s2.form, r.ref); return; }
    alertMsg(f2, r.message || 'Something went wrong on our side. Nothing has been charged. Please try again, or message us on WhatsApp.', r.ref);
  });

  // Fetch plan availability once the plans are close to view, so buttons
  // that can't sign up online turn into enquiries before anyone taps them.
  if (plansSection && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); loadConfig(); }
    }, { rootMargin: '400px 0px' });
    io.observe(plansSection);
  } else {
    loadConfig();
  }
})();
