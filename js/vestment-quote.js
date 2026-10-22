'use strict';
function toggleMobileMenu() {
  document.getElementById('mobile-menu')?.classList.toggle('active');
}
const quoteForm = document.getElementById('quoteForm');
if (quoteForm) quoteForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('submitBtn');
  const status = document.getElementById('quoteStatus');
  if (button.disabled || !quoteForm.reportValidity()) return;
  const token = window.hcaptcha?.getResponse();
  if (!token) { status.textContent = 'Please complete the CAPTCHA to continue.'; return; }
  button.disabled = true;
  button.textContent = 'Sending...';
  status.textContent = '';
  try {
    const data = new FormData(quoteForm);
    data.set('h-captcha-response', token);
    const response = await fetch(quoteForm.action, { method: 'POST', body: data, headers: { Accept: 'application/json' } });
    if (response.ok) { window.location.href = '../thank-you.html'; return; }
    const json = await response.json().catch(() => ({}));
    status.textContent = Array.isArray(json.errors) ? json.errors.map(error => error.message).join(', ') : 'Something went wrong. Please try again.';
  } catch (error) {
    status.textContent = 'Network error. Please try again.';
  }
  window.hcaptcha?.reset();
  button.disabled = false;
  button.textContent = '✝ Send My Quote Request';
});

// Navigation is separate from quote submission and applies only to these products.
if (document.body?.classList?.contains('vestment-product')) {
  const quoteSection = document.getElementById('quote');
  const quoteHeading = document.getElementById('quoteHeading');
  const header = document.querySelector('header');
  if (quoteSection && quoteHeading && header) {
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
