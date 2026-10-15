/* The Business Loft — application forms (business-name registration and
   company incorporation). No dependencies. Everything user-supplied is written
   with textContent. Nothing is stored in the browser: answers and files go
   straight to our server over HTTPS and are cleared from the page once sent. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const SPHEREMAIL = 'https://thebusinessloft.spheremail.co/';
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollTo = (el, block = 'center') => el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block });

  const MESSAGES = {
    business_name: 'Enter the business name.',
    nature: 'Describe what the business does.',
    present_names: 'Enter your present forenames and surname.',
    nationality: 'Enter your nationality.',
    residence: 'Enter your usual residence.',
    other_occupation: 'Enter your other business occupation, or “None”.',
    id_number: 'Enter your ID or passport number.',
    dob: 'Enter your date of birth. You must be 18 or older.',
    phone: 'Enter at least one contact number.',
    email: 'Enter a valid email address.',
    tin: 'Enter your TIN certificate number.',
    commencement: 'Enter a valid date, or leave it blank.',
    consent: 'Please confirm the declaration to continue.',
    company_name: 'Enter the proposed company name.',
    applicant_name: 'Enter your full name.',
  };
  const partyMsg = (name) => {
    const m = /^p(\d)_(name|address|shares)$/.exec(name);
    if (!m) return null;
    return { name: 'Enter this party’s full name.', address: 'Enter this party’s full address.', shares: 'Enter a percentage from 0 to 100.' }[m[2]];
  };

  $$('form[data-intake]').forEach(setup);

  function setup(form) {
    const isCompany = form.hasAttribute('data-company');
    const alertBox = $('[data-alert]', form);
    const submitBtn = $('[data-submit]', form);
    const done = $(form.dataset.done);
    const prepared = new Map(); // upload field name -> Blob ready to send
    const imageTarget = Number(form.dataset.imageTarget) || (isCompany ? 700_000 : 1_400_000);
    const maxSide = imageTarget < 1_000_000 ? 1800 : 2200;
    const MAX_BYTES = 2_000_000;
    const MAX_TOTAL = 4_000_000;

    // ---- dates -----------------------------------------------------------
    const dob = form.elements.dob;
    if (dob) {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 18);
      dob.max = d.toISOString().slice(0, 10);
      dob.min = `${new Date().getFullYear() - 110}-01-01`;
    }

    // ---- errors ----------------------------------------------------------
    const errEl = (name) => $(`[data-err-for="${name}"]`, form) || $(`#e-${name}`, form);
    function fieldEl(name) {
      const el = form.elements[name];
      if (!el) return null;
      return el instanceof RadioNodeList ? el[0] : el;
    }
    function setError(name, msg) {
      const el = errEl(name);
      if (el) el.textContent = msg || '';
      const input = fieldEl(name);
      if (input && input.setAttribute) {
        if (msg) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
    }
    function clearErrors() {
      $$('.err', form).forEach((e) => { e.textContent = ''; });
      $$('[aria-invalid]', form).forEach((e) => e.removeAttribute('aria-invalid'));
      alertBox.hidden = true;
      alertBox.textContent = '';
    }
    function showAlert(msg, info = false) {
      alertBox.textContent = msg;
      alertBox.classList.toggle('info', info);
      alertBox.hidden = false;
      scrollTo(alertBox);
    }
    function focusFirstError() {
      const first = $('[aria-invalid="true"]', form) || $$('.err', form).find((e) => e.textContent);
      if (first) { if (first.focus) first.focus({ preventScroll: true }); scrollTo(first); }
    }

    // ---- uploads ---------------------------------------------------------
    const fmtMB = (n) => `${(n / 1_000_000).toFixed(n < 100_000 ? 2 : 1)} MB`;
    async function shrinkImage(file) {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const width = Math.round(bmp.width * scale);
      const height = Math.round(bmp.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bmp, 0, 0, width, height);
      if (bmp.close) bmp.close();
      let q = 0.85;
      let blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
      while (blob && blob.size > imageTarget && q > 0.45) {
        q -= 0.1;
        blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
      }
      return blob;
    }
    async function prepareUpload(input) {
      const status = $('[data-upload-status]', input.closest('.field'));
      prepared.delete(input.name);
      setError(input.name, '');
      status.textContent = '';
      const file = input.files && input.files[0];
      if (!file) return;
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const isImage = /^image\//.test(file.type) || /\.(jpe?g|png|heic|heif)$/i.test(file.name);
      if (!isPdf && !isImage) { setError(input.name, 'Upload a PDF, JPG or PNG file.'); return; }
      if (isPdf) {
        if (file.size > MAX_BYTES) { setError(input.name, `This PDF is ${fmtMB(file.size)}. The limit is 2 MB — scan at a lower resolution, or upload a photo instead.`); return; }
        prepared.set(input.name, file);
        status.textContent = `Ready: ${file.name} (${fmtMB(file.size)})`;
        return;
      }
      if (file.size <= imageTarget && /^image\/(jpeg|png)$/.test(file.type)) {
        prepared.set(input.name, file);
        status.textContent = `Ready: ${file.name} (${fmtMB(file.size)})`;
        return;
      }
      status.textContent = 'Preparing photo…';
      try {
        const blob = await shrinkImage(file);
        if (!blob || blob.size > MAX_BYTES) throw new Error('too big');
        prepared.set(input.name, blob);
        status.textContent = `Ready: photo reduced to ${fmtMB(blob.size)}`;
      } catch {
        status.textContent = '';
        setError(input.name, 'We couldn’t read this photo. Try a JPG or PNG, or a PDF under 2 MB.');
      }
    }
    $$('[data-upload]', form).forEach((input) => input.addEventListener('change', () => prepareUpload(input)));

    // ---- company: parties, shares, roles ---------------------------------
    const sharesNum = (v) => (/^\d{1,3}(\.\d{1,2})?$/.test(v.trim()) ? Number(v) : v.trim() === '' ? 0 : NaN);
    const activeParties = () => [1, 2, 3, 4, 5].filter((n) => n === 1 || ($(`[data-party-toggle="${n}"]`, form) || {}).checked);
    function updateShares() {
      const box = $('[data-shares-total]', form);
      if (!box) return 0;
      let total = 0;
      for (const n of activeParties()) total += sharesNum(form.elements[`p${n}_shares`].value) || 0;
      total = Math.round(total * 100) / 100;
      $('[data-shares-sum]', box).textContent = `${total}%`;
      box.classList.toggle('is-ok', total === 100);
      box.classList.toggle('is-bad', total > 100 || (total !== 100 && box.dataset.touched === '1'));
      return total;
    }
    function setPartyActive(n, on) {
      const fs = $(`[data-party-fields="${n}"]`, form);
      const up = $(`[data-party-upload="${n}"]`, form);
      fs.disabled = !on; fs.hidden = !on;
      up.hidden = !on; $('input', up).disabled = !on;
      if (!on) {
        const sec = $('[data-secretary]', fs);
        if (sec.checked) sec.checked = false;
        prepared.delete(`p${n}_id`);
      }
      updateShares();
    }
    if (isCompany) {
      $$('[data-party-toggle]', form).forEach((t) => {
        t.addEventListener('change', () => {
          setPartyActive(Number(t.dataset.partyToggle), t.checked);
          if (t.checked) form.elements[`p${t.dataset.partyToggle}_name`].focus();
        });
        setPartyActive(Number(t.dataset.partyToggle), t.checked);
      });
      $$('[data-shares]', form).forEach((input) => {
        input.addEventListener('input', () => {
          const n = input.id.match(/p(\d)_/)[1];
          const v = sharesNum(input.value);
          const sh = $(`[data-shareholder="${n}"]`, form);
          if (v > 0) sh.checked = true;
          updateShares();
        });
        input.addEventListener('blur', () => { $('[data-shares-total]', form).dataset.touched = '1'; updateShares(); });
      });
      $$('[data-party-name]', form).forEach((input) => input.addEventListener('input', () => {
        const label = $(`[data-party-label="${input.dataset.partyName}"]`, form);
        label.textContent = input.value.trim() ? ` — ${input.value.trim()}` : '';
      }));
      updateShares();
    }

    function validateCompany() {
      let ok = true;
      const parties = activeParties();
      let total = 0;
      for (const n of parties) {
        const v = sharesNum(form.elements[`p${n}_shares`].value);
        const sh = form.elements[`p${n}_shareholder`].checked;
        const dir = form.elements[`p${n}_director`].checked;
        const sec = form.elements.secretary.value === String(n);
        if (Number.isNaN(v) || v > 100) { setError(`p${n}_shares`, 'Enter a percentage from 0 to 100.'); ok = false; continue; }
        total += v;
        if (v > 0 && !sh) { setError(`p${n}_roles`, 'Tick Shareholder for anyone holding shares.'); ok = false; }
        if (sh && v === 0) { setError(`p${n}_shares`, 'A shareholder needs a percentage above 0.'); ok = false; }
        if (!sh && !dir && !sec) { setError(`p${n}_roles`, 'Choose at least one role.'); ok = false; }
      }
      total = Math.round(total * 100) / 100;
      if (total !== 100) {
        setError('shares_total', `Warning: the shares add up to ${total}%. They must add up to exactly 100%.`);
        $('[data-shares-total]', form).dataset.touched = '1';
        updateShares();
        ok = false;
      }
      if (!parties.some((n) => form.elements[`p${n}_director`].checked)) { setError('directors', 'At least one person must be a Director.'); ok = false; }
      if (!parties.includes(Number(form.elements.secretary.value))) { setError('secretary', 'Choose one person as Company Secretary.'); ok = false; }
      return ok;
    }

    function validateLocally() {
      let ok = true;
      for (const el of form.elements) {
        if (!el.name || el.disabled || el.type === 'file' || el.type === 'radio' || el.name === 'website') continue;
        if (!el.checkValidity()) { setError(el.name, MESSAGES[el.name] || partyMsg(el.name) || 'Check this field.'); ok = false; }
      }
      for (const input of $$('[data-upload]', form)) {
        if (input.disabled) continue;
        if (errEl(input.name).textContent) { ok = false; continue; }
        if (!prepared.has(input.name)) {
          setError(input.name, input.files && input.files.length ? 'Still preparing this file — try again in a moment.' : 'Attach this document.');
          ok = false;
        }
      }
      let bytes = 0;
      for (const input of $$('[data-upload]', form)) { if (input.disabled) continue; const b = prepared.get(input.name); if (b) bytes += b.size; }
      if (bytes > MAX_TOTAL) { setError('files_total', `Your files add up to ${fmtMB(bytes)}. The total limit is 4 MB — use smaller scans or photos.`); ok = false; }
      if (isCompany && !validateCompany()) ok = false;
      return ok;
    }

    // ---- submit ----------------------------------------------------------
    let sending = false;
    const submitText = submitBtn.textContent;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (sending) return;
      clearErrors();
      if (!validateLocally()) { showAlert('Please check the highlighted fields.'); focusFirstError(); return; }

      const data = new FormData();
      for (const el of form.elements) {
        if (!el.name || el.disabled || el.type === 'file') continue;
        if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked) data.append(el.name, el.value); continue; }
        data.append(el.name, el.value);
      }
      for (const input of $$('[data-upload]', form)) {
        if (input.disabled) continue;
        const blob = prepared.get(input.name);
        const ext = blob.type === 'application/pdf' ? 'pdf' : blob.type === 'image/png' ? 'png' : 'jpg';
        data.append(input.name, blob, `${input.name}.${ext}`);
      }

      sending = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending securely…';
      try {
        const res = await fetch(form.action, { method: 'POST', body: data, credentials: 'same-origin', headers: { accept: 'application/json' } });
        let body = {};
        try { body = await res.json(); } catch { /* handled below */ }
        if (res.ok && body.ok) { finish(body); return; }
        if (res.status === 202 && body.code === 'PENDING' && body.ref) {
          // Google is still saving the documents. Wait until the row is in the sheet.
          submitBtn.textContent = 'Still saving your documents…';
          if (await confirmSaved(body.kind, body.ref)) { finish(body); return; }
          showAlert(`We couldn’t confirm your application yet, but it has probably reached us. Before sending it again, WhatsApp us on (+592) 739-7855 with reference ${body.ref}.`);
          return;
        }
        if (body.fields) {
          Object.entries(body.fields).forEach(([k, v]) => setError(k, v));
          showAlert('Please check the highlighted fields.');
          focusFirstError();
        } else {
          const ref = body.ref ? ` (Reference ${body.ref})` : '';
          showAlert((body.message || 'Something went wrong sending your application. Please try again, or WhatsApp us on (+592) 739-7855.') + ref, body.code === 'NOT_CONFIGURED');
        }
      } catch {
        showAlert('We couldn’t reach our server. Check your connection and try again.');
      } finally {
        sending = false;
        submitBtn.disabled = false;
        submitBtn.textContent = submitText;
      }
    });

    async function confirmSaved(kind, ref) {
      const until = Date.now() + 60_000;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 4000));
        try {
          const r = await fetch('/api/application-status', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ kind, ref }),
          });
          let b = {};
          try { b = await r.json(); } catch { /* keep waiting */ }
          if (r.ok && b.ok && b.found) return true;
          if ([400, 403, 501, 503].includes(r.status)) return false;
        } catch { /* network blip: keep waiting */ }
      }
      return false;
    }

    function finish(body) {
      const nextBtn = $('[data-next]', done);
      const next = typeof body.next === 'string' && body.next.startsWith(SPHEREMAIL) ? body.next : nextBtn.href;
      nextBtn.href = next;
      $('[data-ref]', done).textContent = body.ref || '';
      form.reset();
      prepared.clear();
      form.hidden = true;
      done.hidden = false;
      done.focus({ preventScroll: true });
      scrollTo(done, 'start');
      let n = 8;
      const cd = $('[data-countdown]', done);
      const tick = () => {
        if (n <= 0) { location.assign(next); return; }
        cd.textContent = `Taking you to sign-up in ${n} second${n === 1 ? '' : 's'}…`;
        n -= 1;
        setTimeout(tick, 1000);
      };
      tick();
    }
  }
})();
