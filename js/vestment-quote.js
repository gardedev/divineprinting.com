'use strict';
// One initializer per document, even if a script is accidentally loaded twice.
(function initializeQuoteForm() {
  const form = document.getElementById('quoteForm');
  if (!form || form.dataset.quoteInitialized) return;
  form.dataset.quoteInitialized = 'true';
  const config = window.DivineQuoteConfig;
  const button = document.getElementById('submitBtn');
  const status = document.getElementById('quoteStatus');
  let inFlight = false;
  let captchaProblem = '';
  function announce(message) { status.textContent = message; }
  function resetCaptcha() { try { window.hcaptcha?.reset(); } catch (_) { /* Keep entered fields usable. */ } }
  window.divineQuoteCaptchaReady = () => { captchaProblem = ''; if (!inFlight) announce('CAPTCHA completed. You can send your request.'); };
  window.divineQuoteCaptchaExpired = () => { captchaProblem = 'The CAPTCHA expired. Please complete it again.'; if (!inFlight) announce(captchaProblem); };
  window.divineQuoteCaptchaError = () => { captchaProblem = 'CAPTCHA could not load. Check your connection or privacy settings, then reload this page before submitting.'; if (!inFlight) announce(captchaProblem); };
  if (window.divineQuoteCaptchaLoadFailed) window.divineQuoteCaptchaError();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (inFlight || button.disabled || !form.reportValidity()) return;
    if (!config || form.action !== config.endpoint) { announce('The quote form is unavailable. Please contact Divine Printing. Your details have been kept.'); return; }
    let token;
    try {
      if (captchaProblem) { announce(captchaProblem); return; }
      if (!window.hcaptcha || typeof window.hcaptcha.getResponse !== 'function') { announce('CAPTCHA is not ready. Check your connection or privacy settings and try completing it again.'); return; }
      token = window.hcaptcha.getResponse();
      if (!token) { announce('Please complete the CAPTCHA to continue.'); return; }
    } catch (_) { announce('CAPTCHA could not be checked. Please reload the page before submitting. Your details are still shown here.'); return; }
    inFlight = true;
    button.disabled = true;
    button.textContent = 'Sending...';
    announce('Sending your request to Formspree…');
    let timer;
    let controller;
    let timedOut = false;
    try {
      controller = new AbortController();
      const data = new FormData(form);
      try { window.DivineQuoteOptions?.prepare(form, data); } catch (error) { announce(error.message || 'Please review your product selections.'); return; }
      data.set('h-captcha-response', token);
      // Canonical identity stays stable even when the customer arrives with #quote.
      data.set('product_page_url', new URL(window.location.href).origin + window.location.pathname);
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('timeout')); }, config.timeoutMs);
      });
      const request = (async () => {
        const response = await fetch(config.endpoint, { method: 'POST', body: data, headers: { Accept: 'application/json' }, signal: controller.signal });
        const text = response.status === 204 ? '' : await response.text();
        if (!response.ok) {
          const error = new Error('rejected'); error.status = response.status; throw error;
        }
        let payload;
        if (text) { try { payload = JSON.parse(text); } catch (_) { throw new Error('unexpected-response'); } }
        const explicitError = payload && (payload.ok === false || payload.error || (Array.isArray(payload.errors) && payload.errors.length));
        const unexpected = response.status !== 204 && (!payload || typeof payload !== 'object' || Array.isArray(payload));
        if (explicitError || unexpected) throw new Error('unexpected-response');
        // Formspree's documented AJAX success uses response.ok; no optional ok:true required.
        return true;
      })();
      await Promise.race([request, timeout]);
      announce('Formspree accepted your request. Opening the confirmation page…');
      window.location.href = config.thankYouUrl;
    } catch (error) {
      if (error.status === 429) announce('Formspree is receiving too many requests. Your details have been kept. Please wait before trying again.');
      else if (error.status) announce('Formspree did not accept this request. Review your details and CAPTCHA, or contact Divine Printing. Your details have been kept.');
      else announce(timedOut ? 'The request timed out. We could not confirm whether Formspree received it. Your details have been kept. Please contact Divine Printing before resending.' : 'We could not confirm whether Formspree received your request. Your details have been kept. Check your connection or contact Divine Printing before resending.');
      resetCaptcha();
      captchaProblem = '';
    } finally {
      clearTimeout(timer);
      inFlight = false;
      button.disabled = false;
      button.textContent = '✝ Send My Quote Request';
    }
  });
})();
// Navigation is separate from quote submission and applies only to these products.
if (document.getElementById('quoteForm')) {
  const quoteSection = document.getElementById('quote');
  const quoteHeading = document.getElementById('quoteHeading');
  const header = document.querySelector('header');
  if (quoteSection && quoteHeading && header && !quoteSection.dataset.navigationInitialized) {
    quoteSection.dataset.navigationInitialized = 'true';
    let pendingFrame;
    function updateQuoteOffset() {
      quoteSection.style.setProperty('--quote-header-offset', `${Math.ceil(header.getBoundingClientRect().height) + 16}px`);
    }
    function showQuote(focusHeading = true) {
      updateQuoteOffset();
      quoteSection.scrollIntoView({ block: 'start', behavior: 'instant' });
      if (focusHeading) quoteHeading.focus({ preventScroll: true });
    }
    function scheduleQuote(focusHeading = true) {
      if (pendingFrame) cancelAnimationFrame(pendingFrame);
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = undefined;
        if (window.location.hash === '#quote' && (focusHeading || document.activeElement === quoteHeading)) showQuote(focusHeading);
      });
    }
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[href="#quote"]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (window.location.hash !== '#quote') window.history.pushState(null, '', '#quote');
      showQuote();
    });
    window.addEventListener('hashchange', () => scheduleQuote());
    window.addEventListener('popstate', () => scheduleQuote());
    function canRealignQuote() {
      const oldOffset = parseFloat(quoteSection.style.getPropertyValue('--quote-header-offset'));
      return document.activeElement === quoteHeading && Math.abs(quoteSection.getBoundingClientRect().top - oldOffset) < 8;
    }
    window.addEventListener('load', () => {
      if (document.activeElement === document.body || document.activeElement === quoteHeading) scheduleQuote();
    });
    window.addEventListener('resize', () => {
      const realign = canRealignQuote();
      updateQuoteOffset();
      if (realign) scheduleQuote(false);
    });
    if (window.ResizeObserver) new ResizeObserver(() => {
      const realign = canRealignQuote();
      updateQuoteOffset();
      if (realign && window.location.hash === '#quote') scheduleQuote(false);
    }).observe(header);
    updateQuoteOffset();
    scheduleQuote();
    // Font loading can change a wrapped navigation row after the initial fragment.
    document.fonts?.ready.then(() => { if (canRealignQuote()) scheduleQuote(false); });
  }
}
