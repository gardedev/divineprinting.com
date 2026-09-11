'use strict';

const SUPPORT_EMAIL = 'info@divineprinting.com';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

function plain(value) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim();
}

function money(cents, currency = 'USD') {
  if (!Number.isSafeInteger(cents) || cents < 0 || currency !== 'USD') throw new TypeError('Invalid order money value');
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

function itemLabel(item) {
  return plain(item.productName || item.baseSku || 'Configured item').slice(0, 200);
}

function renderOrderConfirmation({ order, items }) {
  if (!order || !/^DP-[A-Z0-9]+$/.test(order.orderNumber || '')) throw new TypeError('Invalid customer-facing order number');
  if (!Array.isArray(items) || items.length === 0 || items.length > 96) throw new TypeError('Invalid order items');
  const currency = order.currency || 'USD';
  const rows = items.map((item) => {
    const quantity = Number.isSafeInteger(item.quantity) && item.quantity > 0 ? item.quantity : item.totalQuantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new TypeError('Invalid item quantity');
    const unit = Number.isSafeInteger(item.unitPriceCents) ? ` | ${money(item.unitPriceCents, currency)} each` : '';
    return { label: itemLabel(item), quantity, unit, total: money(item.lineTotalCents, currency) };
  });
  const totals = [
    ['Merchandise subtotal', order.merchandiseSubtotalCents ?? order.subtotalCents],
    ...(order.discountCents > 0 ? [['Discount', -order.discountCents]] : []),
    ...(Number.isSafeInteger(order.shippingCents) ? [['Shipping', order.shippingCents]] : []),
    ...(Number.isSafeInteger(order.taxCents) ? [['Tax', order.taxCents]] : []),
    ['Order total', order.totalCents],
  ];
  for (const [, amount] of totals) if (!Number.isSafeInteger(amount)) throw new TypeError('Invalid order total');
  const displayMoney = (amount) => amount < 0 ? `-${money(-amount, currency)}` : money(amount, currency);
  const subject = `Divine Printing order confirmation ${order.orderNumber}`;
  const textItems = rows.map((row) => `- ${row.label} | Qty ${row.quantity}${row.unit} | ${row.total}`).join('\n');
  const textTotals = totals.map(([label, amount]) => `${label}: ${displayMoney(amount)}`).join('\n');
  const text = `Divine Printing\n\nWe received your order.\nOrder ${order.orderNumber}\n\n${textItems}\n\n${textTotals}\n\nQuestions? Contact ${SUPPORT_EMAIL}.`;
  const htmlRows = rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.quantity}</td><td>${escapeHtml(row.unit.replace(/^ \| /, ''))}</td><td>${escapeHtml(row.total)}</td></tr>`).join('');
  const htmlTotals = totals.map(([label, amount]) => `<tr><th colspan="3">${escapeHtml(label)}</th><td>${escapeHtml(displayMoney(amount))}</td></tr>`).join('');
  const html = `<!doctype html><html><body><h1>Divine Printing</h1><p>We received your order.</p><h2>Order ${escapeHtml(order.orderNumber)}</h2><table><thead><tr><th>Item</th><th>Quantity</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${htmlRows}${htmlTotals}</tbody></table><p>Questions? Contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p></body></html>`;
  return { subject, text, html };
}

module.exports = { renderOrderConfirmation, escapeHtml, plain, money, SUPPORT_EMAIL };
