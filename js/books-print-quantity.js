'use strict';
// Book inquiries accept digits up to JavaScript's exact integer limit, not a production-capacity limit.
(function initializeBookQuantity() {
  const input = document.querySelector('[data-book-quote-quantity]');
  if (!input || !input.form || input.dataset.bookQuantityInitialized) return;
  input.dataset.bookQuantityInitialized = 'true';

  function validate() {
    const raw = input.value;
    let message = '';
    if (raw && !/^[0-9]{1,16}$/.test(raw)) {
      message = 'Enter a positive whole quantity using digits only (at most 16 digits).';
    } else if (raw) {
      const amount = Number(raw);
      if (amount < 1) message = 'Enter a quantity greater than zero.';
      else if (!Number.isSafeInteger(amount)) {
        message = 'This quantity exceeds the numeric input safety limit of 9007199254740991.';
      }
    }
    // Empty values keep the existing native required-field message. Never rewrite the entered value.
    input.setCustomValidity(message);
    return raw !== '' && message === '';
  }

  input.addEventListener('input', validate);
  input.addEventListener('change', validate);
  input.form.addEventListener('submit', event => {
    // Capture runs before the unchanged quote handler, including programmatic submit events.
    if (!validate()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      input.reportValidity();
    }
  }, true);
  validate();
})();
