'use strict';
// Browser-only, consent-gated advertising. Quote acceptance is verified by the form handler.
(function (window, document) {
  if (window.DivineMeta) return;
  const PIXEL_ID = '2413483535782004';
  const CONSENT = 'divine-ad-consent-v1', ATTRIBUTION = 'divine-meta-attribution-v1', SENT = 'divine-meta-leads-v1';
  const DAY = 86400000;
  let consent = false, initialized = false, pageSent = false;
  const sent = new Set();
  function read(key) { try { return JSON.parse(window.localStorage.getItem(key)); } catch (_) { return null; } }
  function write(key, value) { try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* In-memory consent and dedup still apply. */ } }
  function remove(key) { try { window.localStorage.removeItem(key); } catch (_) {} }
  function cookie(name) { return document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1) || ''; }
  function product() {
    try {
      const data = JSON.parse(document.getElementById('quoteProduct')?.textContent || 'null');
      if (data && /^[a-z0-9-]{1,100}$/.test(data.slug) && typeof data.name === 'string') return { content_ids: [data.slug], content_type: 'product', content_name: data.name.slice(0, 200) };
    } catch (_) {}
    return null;
  }
  function captureAttribution() {
    if (!consent) return {};
    let data = read(ATTRIBUTION);
    if (!data || !Number.isFinite(data.created) || Date.now() - data.created > 90 * DAY || data.created > Date.now()) data = { created: Date.now() };
    const click = new URL(window.location.href).searchParams.get('fbclid');
    if (click && /^[A-Za-z0-9_-]{1,512}$/.test(click) && click !== data.fbclid) data = { created: Date.now(), fbclid: click, fbc: 'fb.1.' + Date.now() + '.' + click };
    const fbc = cookie('_fbc'), fbp = cookie('_fbp');
    if (/^fb\.\d\.\d{10,16}\.[A-Za-z0-9_-]{1,512}$/.test(fbc) && (!data.fbc || Number(fbc.split('.')[2]) >= Number(data.fbc.split('.')[2])) && (!click || fbc.endsWith('.' + click))) data.fbc = fbc;
    if (/^fb\.\d\.\d{10,16}\.\d+$/.test(fbp)) data.fbp = fbp;
    write(ATTRIBUTION, data);
    return Object.fromEntries(['fbclid', 'fbc', 'fbp'].filter(key => typeof data[key] === 'string').map(key => [key, data[key]]));
  }
  function startPixel() {
    if (!consent) return;
    if (!initialized) {
      // A managed GTM Meta tag must not be added alongside this installation.
      if (window.fbq) return;
      const fbq = window.fbq = function () { fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); };
      window._fbq = fbq; fbq.push = fbq; fbq.loaded = true; fbq.version = '2.0'; fbq.queue = [];
      fbq('consent', 'grant'); fbq('init', PIXEL_ID);
      const script = document.createElement('script'); script.async = true; script.src = 'https://connect.facebook.net/en_US/fbevents.js';
      document.head.appendChild(script); initialized = true;
    }
    window.fbq('consent', 'grant');
    if (!pageSent) {
      pageSent = true; window.fbq('track', 'PageView');
      const content = product(); if (content) window.fbq('track', 'ViewContent', content);
    }
    captureAttribution();
  }
  function clearAdvertisingData() {
    remove(ATTRIBUTION);
    for (const name of ['_fbp', '_fbc']) {
      const suffix = '; Max-Age=0; Path=/; SameSite=Lax';
      document.cookie = name + '=' + suffix;
      const host = window.location.hostname;
      for (const domain of [host, 'divineprinting.com']) if (host === domain || host.endsWith('.' + domain)) document.cookie = name + '=' + suffix + '; Domain=.' + domain;
    }
  }
  function choose(allowed) {
    consent = allowed;
    write(CONSENT, { allowed, at: Date.now() });
    if (allowed) startPixel();
    else { try { if (initialized) window.fbq('consent', 'revoke'); } finally { clearAdvertisingData(); } }
    document.getElementById('divine-ad-choice').hidden = true;
  }
  function acceptedQuote(id) {
    // Only called after the provider response has been accepted, never on a confirmation page.
    if (!consent || !initialized || !/^[a-zA-Z0-9-]{16,100}$/.test(id)) return Promise.resolve();
    const ledger = read(SENT);
    const entries = Array.isArray(ledger) ? ledger.filter(entry => entry && typeof entry.id === 'string' && Number.isFinite(entry.at) && Date.now() - entry.at < 90 * DAY).slice(-99) : [];
    if (sent.has(id) || entries.some(entry => entry.id === id)) return Promise.resolve();
    sent.add(id); entries.push({ id, at: Date.now() }); write(SENT, entries);
    try { window.fbq('track', 'Lead', product() || {}, { eventID: id }); } catch (_) { return Promise.resolve(); }
    // Delivery is best effort; never hold quote confirmation for a blocked external script.
    return new Promise(resolve => window.setTimeout(resolve, 250));
  }
  window.DivineMeta = { acceptedQuote, attribution: captureAttribution };
  function ui() {
    const style = document.createElement('style');
    style.textContent = '#divine-ad-choice{position:fixed;bottom:3.5rem;left:1rem;right:1rem;max-width:36rem;padding:1rem;background:#fff;color:#222;border:2px solid #473364;border-radius:8px;z-index:10000;font:16px/1.5 system-ui;box-shadow:0 2px 15px #0003}#divine-ad-choice[hidden]{display:none}#divine-ad-choice button{margin:.5rem .75rem 0 0;padding:.5rem .8rem;cursor:pointer}#divine-ad-preferences{position:fixed;bottom:.5rem;left:1rem;z-index:9999;padding:.5rem;background:#fff;color:#222;border:1px solid #473364;border-radius:4px;cursor:pointer}';
    document.head.appendChild(style);
    const panel = document.createElement('section'); panel.id = 'divine-ad-choice'; panel.setAttribute('aria-label', 'Advertising privacy choices');
    panel.innerHTML = '<strong>Advertising cookies</strong><p>With your permission, Meta Pixel measures product visits and successful quote requests for our Facebook and Instagram ads. You can request a quote without accepting. <a href="/privacy.html">Privacy policy</a></p><button type="button" data-choice="yes">Accept advertising</button><button type="button" data-choice="no">Decline advertising</button>';
    panel.querySelector('[data-choice="yes"]').addEventListener('click', () => choose(true));
    panel.querySelector('[data-choice="no"]').addEventListener('click', () => choose(false));
    const preferences = document.createElement('button'); preferences.id = 'divine-ad-preferences'; preferences.type = 'button'; preferences.textContent = 'Advertising preferences';
    preferences.addEventListener('click', () => { panel.hidden = false; panel.querySelector('button').focus(); });
    document.body.append(panel, preferences);
    const saved = read(CONSENT);
    const valid = saved && typeof saved.allowed === 'boolean' && Number.isFinite(saved.at) && Date.now() - saved.at < 180 * DAY && saved.at <= Date.now();
    panel.hidden = !!valid;
    consent = !!(valid && saved.allowed);
    if (consent) startPixel(); else clearAdvertisingData();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ui, { once: true }); else ui();
})(window, document);
