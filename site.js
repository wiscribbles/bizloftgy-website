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
  // In-page links scroll smoothly without adding "#section" to the address,
  // and a section hash on arrival (e.g. from /prices) is scrolled to once the
  // page has finished laying out, then removed from the address bar.
  // ---------------------------------------------------------------------------
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function goToSection(id, smooth) {
    const target = id && document.getElementById(id);
    if (!target) return false;
    target.scrollIntoView({ behavior: smooth && !reduceMotion ? 'smooth' : 'auto', block: 'start' });
    if (!target.matches('a, button, input, select, textarea, [tabindex]')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    return true;
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const url = new URL(a.getAttribute('href'), location.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash || url.hash.startsWith('#/')) return;
    if (goToSection(decodeURIComponent(url.hash.slice(1)), true)) e.preventDefault();
  });
  if (location.hash && !location.hash.startsWith('#/')) {
    const id = decodeURIComponent(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    if (document.getElementById(id)) {
      goToSection(id, false);
      window.addEventListener('load', () => goToSection(id, false), { once: true });
    }
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

})();
