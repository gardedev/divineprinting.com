'use strict';
const asset = '<script src="/js/meta-tracking.js" defer></script>';
function addMetaTracking(html) {
  if (!/<head\b/i.test(html) || !/<body\b/i.test(html)) return html;
  html = html.replace(/<!-- Meta Pixel Code -->[\s\S]*?<!-- End Meta Pixel Code -->/g, block => {
    const ids = [...block.matchAll(/fbq\(["']init["'],\s*["'](\d+)["']/g)].map(match => match[1]);
    if (ids.length !== 1 || ids[0] !== '2413483535782004' || !block.includes('connect.facebook.net/en_US/fbevents.js')) throw new Error('Unexpected Meta Pixel installation requires review');
    return '';
  });
  html = html.replaceAll(asset + '\n', '').replaceAll(asset, '');
  if (/\bfbq\s*\(|connect\.facebook\.net|facebook\.com\/tr\b|meta-tracking\.js/i.test(html)) throw new Error('Conflicting Meta tracking requires review');
  return html.replace(/<\/head>/i, asset + '\n</head>');
}
module.exports = { addMetaTracking };
