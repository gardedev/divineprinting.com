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
