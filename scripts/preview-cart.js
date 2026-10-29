'use strict';
// Local-only synthetic development lane. Access it through an authenticated SSH tunnel.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { isPublicAsset } = require('./build-static');
function createPreview(root = path.resolve(__dirname, '..')) {
  let cart = { cartId: 'private-preview', status: 'active', currency: 'USD', version: 1, subtotalCents: 0, totalCents: 0 };
  let items = [];
  return http.createServer(async (req, res) => {
    const host = req.headers.host || '';
    if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)) { res.writeHead(403); return res.end(); }
    const url = new URL(req.url, 'http://' + host);
    const reply = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (url.pathname.startsWith('/api/')) {
      if (!url.pathname.startsWith('/api/carts/anonymous')) return reply(503, { code: 'PREVIEW_NO_GO', error: 'Only synthetic draft carts are available. Checkout and payments are disabled.' });
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 32768) return reply(413, {}); }
      if (req.method === 'POST' && url.pathname.endsWith('/items')) {
        let payload; try { payload = JSON.parse(raw); } catch (_) { return reply(400, {}); }
        const quantity = (payload.variantAllocations || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
        items.push({ ...payload, cartItemId: 'preview-' + (items.length + 1), version: 1, quantity, totalQuantity: quantity, displayName: 'Synthetic preview item', lineTotalCents: 0 }); cart.version++;
      } else if (req.method === 'PATCH') {
        let payload; try { payload = JSON.parse(raw); } catch (_) { return reply(400, {}); }
        const item = items.find(row => url.pathname.endsWith('/' + row.cartItemId));
        if (!item) return reply(404, { error: 'Synthetic item not found' });
        Object.assign(item, payload, { version: item.version + 1 });
        item.totalQuantity = item.quantity = (item.variantAllocations || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0); cart.version++;
      } else if (req.method === 'DELETE') { items = items.filter(item => !url.pathname.endsWith('/' + item.cartItemId)); cart.version++; }
      return reply(200, { cart, items, cartToken: 'local-synthetic-only' });
    }
    let relative; try { relative = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html'; } catch (_) { res.writeHead(400); return res.end(); }
    if (!isPublicAsset(relative)) { res.writeHead(404); return res.end(); }
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) { res.writeHead(404); return res.end(); }
    const headers = { 'content-type': ({ '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.woff2':'font/woff2' })[path.extname(absolute)] || 'application/octet-stream', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'none'; form-action 'none'" };
    let data = fs.readFileSync(absolute);
    if (relative === 'js/cognito-auth.js') data = Buffer.from('window.getAccessToken=()=>null;window.getUserInfo=()=>null;');
    if (relative.endsWith('.html')) data = Buffer.from(data.toString().replace(/<head\b[^>]*>/i, tag => tag + '<script>window.DIVINE_CART_API_BASE=location.origin;</script>'));
    res.writeHead(200, headers); res.end(data);
  });
}
if (require.main === module) createPreview().listen( Number(process.env.PREVIEW_PORT || 4317), '127.0.0.1', () => console.log('Private synthetic cart preview on 127.0.0.1:' + (process.env.PREVIEW_PORT || 4317)));
module.exports = { createPreview };
