/* The Business Loft — conversion tracking.
   Every conversion on this site finishes somewhere else: SphereMail (plan
   signup), OfficeRnD (room booking), WhatsApp, phone and email. Without this
   file, analytics sees a visit and then nothing, and ad spend gets optimised
   against pageviews instead of leads. This turns each exit into an event.

   Events go to the dataLayer (for GTM/GA4) and, where a lead is meant, direct
   to the Meta Pixel so Meta works whether or not a GTM tag is configured.

   No dependencies, no cookies of its own, nothing stored in the browser.
   If this file fails to load, every link still works exactly as before. */
(() => {
  'use strict';

  window.dataLayer = window.dataLayer || [];
  const push = (o) => { try { window.dataLayer.push(o); } catch { /* never break a click */ } };
  const fb = (name, params, id) => {
    try { if (typeof window.fbq === 'function') window.fbq('track', name, params || {}, id ? { eventID: id } : undefined); } catch { /* ditto */ }
  };

  // SphereMail plan ids -> the names used in reporting. Keep in step with the
  // sign-up links in the page; an unknown id is still tracked, as 'Unknown'.
  const PLANS = {
    8289: 'Mailbox Only',
    8290: 'Virtual Office',
    8291: 'Virtual Office Plus',
    8301: 'Business Registration',
  };

  // Rough value ranking so Meta and GA4 can optimise toward the plans worth
  // having rather than the cheapest lead. Relative weights, not real prices.
  const PLAN_VALUE = {
    'Mailbox Only': 1,
    'Virtual Office': 3,
    'Virtual Office Plus': 6,
    'Business Registration': 4,
  };

  const pageName = () => {
    const p = location.pathname.replace(/\/$/, '');
    return p === '' ? 'home' : p.replace(/^\//, '');
  };

  // A short id so a single click isn't counted twice if a GTM tag is later set
  // up for the same event.
  const newId = () => 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  function classify(url, a) {
    const host = url.hostname.replace(/^www\./, '');
    if (url.protocol === 'tel:') return { type: 'phone', label: url.pathname, lead: true };
    if (url.protocol === 'mailto:') return { type: 'email', label: url.pathname.split('?')[0], lead: true };
    if (host === 'wa.me' || host.endsWith('whatsapp.com')) return { type: 'whatsapp', label: 'whatsapp', lead: true };
    if (host.endsWith('spheremail.co')) {
      const id = url.searchParams.get('plan_id');
      const plan = PLANS[id] || 'Unknown';
      return { type: 'plan_signup', label: plan, plan, term: url.searchParams.get('term') || 'monthly', lead: true };
    }
    if (host.endsWith('officernd.com')) return { type: 'meeting_room_booking', label: 'meeting room', lead: true };
    if (host.endsWith('facebook.com') || host.endsWith('instagram.com')) return { type: 'social', label: host, lead: false };
    if (host && host !== location.hostname.replace(/^www\./, '')) return { type: 'outbound', label: host, lead: false };
    return null;
  }

  document.addEventListener('click', (e) => {
    // Ignore modified clicks and anything already handled.
    if (e.defaultPrevented || e.button !== 0) return;
    const a = e.target.closest('a[href]');
    if (!a) return;

    let url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch { return; }
    const hit = classify(url, a);
    if (!hit) return;

    const eventId = newId();
    const cta = (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 80);

    push({
      event: 'conversion_click',
      conversion_type: hit.type,
      conversion_label: hit.label,
      conversion_plan: hit.plan || undefined,
      conversion_term: hit.term || undefined,
      conversion_value: PLAN_VALUE[hit.plan] || undefined,
      cta_text: cta,
      page_name: pageName(),
      event_id: eventId,
    });

    if (!hit.lead) return;

    // Plan sign-ups are the money event; everything else is a lead.
    if (hit.type === 'plan_signup') {
      fb('InitiateCheckout', {
        content_name: hit.plan,
        content_category: 'plan_signup',
        value: PLAN_VALUE[hit.plan] || 1,
        currency: 'USD',
      }, eventId);
    } else {
      fb('Lead', { content_name: hit.label, content_category: hit.type }, eventId);
    }
  }, true);

  // ---------------------------------------------------------------------------
  // WhatsApp source tagging.
  // WhatsApp conversations are otherwise an attribution blind spot: a message
  // arrives with no idea which page or advert produced it. Rewriting the link
  // to carry a prefilled first line puts the source in the chat itself.
  //
  // The published short link (wa.me/message/CODE) does not reliably accept
  // prefilled text, so this rewrites to the number form. If this script never
  // runs, the original short link is untouched and still works.
  // ---------------------------------------------------------------------------
  const WA_NUMBER = '5927397855';
  const PAGE_LABEL = {
    home: 'the home page',
    'virtual-office': 'the Virtual Office page',
    mailbox: 'the Mailbox page',
    'meeting-room': 'the Meeting Room page',
    'business-registration': 'the Business Registration page',
  };

  function tagWhatsAppLinks() {
    const where = PAGE_LABEL[pageName()] || 'your website';
    const params = new URLSearchParams(location.search);
    const campaign = params.get('utm_campaign') || params.get('utm_source');
    const suffix = campaign ? ` (${String(campaign).replace(/[^\w -]/g, '').slice(0, 40)})` : '';
    const text = `Hello Business Loft — I'm enquiring from ${where}${suffix}.`;

    document.querySelectorAll('a[href*="wa.me"]').forEach((a) => {
      try {
        const u = new URL(a.getAttribute('href'), location.href);
        if (u.hostname.replace(/^www\./, '') !== 'wa.me') return;
        if (u.searchParams.has('text')) return; // already tagged
        a.setAttribute('href', `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`);
      } catch { /* leave the original link alone */ }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tagWhatsAppLinks, { once: true });
  } else {
    tagWhatsAppLinks();
  }
})();
