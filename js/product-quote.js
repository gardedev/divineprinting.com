(function (global) {
  'use strict';
  const metadata = document.getElementById('quoteProduct');
  if (!metadata) return;
  const product = JSON.parse(metadata.textContent);
  function text(value, max = 500) { const result = String(value ?? '').trim(); if (result.length > max) throw new Error('A customization field is too long. Please shorten it before requesting a quote.'); return result; }
  function quantity(value) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1 || number > 10000) throw new Error('Choose a quantity from 1 to 10,000.'); return number; }
  function selected(root, key, attribute) {
    const controls = Array.from(root.querySelectorAll(`[${attribute}="${key}"]`));
    const chosen = controls.filter(node => (node.matches('input,select') && node.value.trim()) || node.classList.contains('selected'));
    if (chosen.length !== 1) throw new Error('Choose exactly one ' + key + '.');
    return text(chosen[0].dataset.variant || chosen[0].value);
  }
  function snapshot() {
    if (product.adapter === 'tshirt') {
      if (typeof global.buildConfiguredJobRequest !== 'function') throw new Error('The design editor is not ready. Please reload before sending.');
      for (const input of document.querySelectorAll('#variantAllocations input[data-size]')) {
        const amount = Number(input.value || 0);
        if (input.validity.badInput || !Number.isSafeInteger(amount) || amount < 0 || amount > 10000) throw new Error('Enter a whole quantity from 0 to 10,000 for every shirt size.');
      }
      const job = global.buildConfiguredJobRequest();
      job.variantAllocations.forEach(entry => quantity(entry.quantity));
      return { product: product.slug, configuration: job.customerConfiguration, sizeAllocations: job.variantAllocations, instructions: text(job.customerInstructions, 500) };
    }
    const root = document.querySelector('[data-standard-product]');
    if (!root) {
      const quoteFields = {};
      for (const name of product.optionFields) quoteFields[name] = text(document.getElementById('quoteForm').elements.namedItem(name)?.value || '');
      return { product: product.slug, quoteFields };
    }
    const selections = {}, options = {};
    const keys = new Set(Array.from(root.querySelectorAll('[data-dimension]')).map(node => node.dataset.dimension));
    if (root.dataset.dimension) keys.add(root.dataset.dimension);
    for (const key of keys) {
      const nodes = root.querySelectorAll(`[data-dimension="${key}"]`);
      if (!nodes.length && root.dataset.dimension === key) {
        const choices = root.querySelectorAll('[data-variant].selected');
        if (choices.length !== 1) throw new Error('Choose exactly one ' + key + '.');
        selections[key] = text(choices[0].dataset.variant);
      } else selections[key] = selected(root, key, 'data-dimension');
    }
    for (const node of root.querySelectorAll('[data-option]')) {
      const key = node.dataset.option;
      if ((node.matches('input,select') && node.value.trim()) || node.classList.contains('selected')) options[key] = text(node.dataset.variant || node.value);
      if (node.dataset.optionRequired === 'true' && !options[key]) throw new Error('Choose a ' + key + '.');
    }
    const amount = quantity(root.querySelector('#qty')?.textContent || 1);
    const result = { product: product.slug, backendProductId: root.dataset.productId, selections, options, quantity: amount, quantityMode: root.dataset.quantityMode || 'UNIT' };
    if (root.dataset.packageUnits) {
      const units = JSON.parse(root.dataset.packageUnits); const selection = Object.values(selections).find(value => Object.hasOwn(units, value));
      if (!selection || !Number.isSafeInteger(units[selection])) throw new Error('Choose a package size.');
      result.unitsPerPack = units[selection]; result.physicalUnits = amount * units[selection];
    }
    return result;
  }
  function prepare(form, data) {
    const configuration = snapshot();
    const encoded = JSON.stringify(configuration);
    if (encoded.length > 24000) throw new Error('Your customization is too large to send. Please shorten the text.');
    data.set('product', product.name); data.set('product_id', product.slug);
    data.set('selected_options', encoded);
    data.set('customization_summary', JSON.stringify(configuration, null, 2));
    if (configuration.quantity) data.set('configured_quantity', String(configuration.quantity));
  }
  global.DivineQuoteOptions = { prepare, snapshot };
  // Pure presentation setup; never loads or mutates a cart.
  function updatePackage() {
    const root = document.querySelector('[data-standard-product]'); if (!root?.dataset.packageUnits) return;
    try { const item = snapshot(); const output = root.querySelector('[data-physical-quantity]'); if (output) output.textContent = `${item.quantity} pack(s) × ${item.unitsPerPack} = ${item.physicalUnits} ${root.dataset.physicalLabel || 'units'}`; } catch (_) { /* Submission shows validation errors. */ }
  }
  document.addEventListener('click', () => setTimeout(updatePackage, 0));
  updatePackage();
})(window);
