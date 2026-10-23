'use strict';

// Only browser assets belong in Amplify's public artifact. Never copy the repo wholesale.
const fs = require('node:fs');
const path = require('node:path');
const htmlDirectories = new Set(['products', 'account', 'admin', 'blog', 'checkout']);
const rootAssets = new Set([
  'cart.js', 'snipcart-custom.js', 'snipcart-close-fix.js',
  'styles.css', 'product.css', 'vestments.css', 'snipcart-custom.css', 'cognito-hosted-ui.css',
  'favicon.ico', 'robots.txt', 'sitemap.xml', '_redirects',
]);
const imageExtension = /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i;
const fontExtension = /\.(?:woff2?|ttf|otf|eot|css)$/i;

const gtmHead = `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-MZXJHMD5');</script>
<!-- End Google Tag Manager -->`;
const gtmBody = `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-MZXJHMD5"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`;

function addTagManager(html) {
  // Non-document fixtures and assets must remain byte-for-byte copies.
  if (!/<head\b[^>]*>/i.test(html) || !/<body\b[^>]*>/i.test(html)) return html;
  if (html.split(gtmHead).length === 2 && html.split(gtmBody).length === 2 &&
      (html.match(/GTM-[A-Z0-9]+/gi) || []).length === 2 &&
      /<head\b[^>]*>\s*<!-- Google Tag Manager -->/i.test(html) &&
      /<body\b[^>]*>\s*<!-- Google Tag Manager \(noscript\) -->/i.test(html)) return html;
  if (/googletagmanager\.com\/(?:gtm\.js|ns\.html)|GTM-[A-Z0-9]+/i.test(html)) {
    throw new Error('Existing Google Tag Manager installation requires review');
  }
  return html.replace(/<head\b[^>]*>/i, opening => `${opening}\n${gtmHead}`)
    .replace(/<body\b[^>]*>/i, opening => `${opening}\n${gtmBody}`);
}

function isPublicAsset(relativePath) {
  if (relativePath.includes('\\')) return false;
  const parts = relativePath.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) return false;
  if (parts.length === 1) return rootAssets.has(relativePath) || /\.html$/i.test(relativePath) || imageExtension.test(relativePath);
  if (parts.length === 2 && htmlDirectories.has(parts[0]) && /\.html$/i.test(parts[1])) return true;
  if (parts.length === 2 && parts[0] === 'js' && /\.js$/i.test(parts[1])) return true;
  if (relativePath === 'products/tshirt-configurator.js') return true;
  if (parts[0] === 'images') return imageExtension.test(relativePath);
  if (parts[0] === 'fonts') return fontExtension.test(relativePath) || /^(?:license|ofl|copyright)(?:[-_][\w-]+)?\.txt$/i.test(parts.at(-1));
  return false;
}

function buildStatic(sourceDirectory = path.resolve(__dirname, '..')) {
  const source = path.resolve(sourceDirectory);
  if (fs.lstatSync(source).isSymbolicLink() || fs.realpathSync(source) !== source) throw new Error('Source must be a real directory without symlink ancestors');
  const destination = path.join(source, 'dist');
  const files = [];
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!prefix && entry.name === 'dist') continue;
      const absolute = path.join(source, relative);
      // Reject symlinks in the publishable trees, including links masquerading as assets.
      if (entry.isSymbolicLink()) {
        if (isPublicAsset(relative) || ['images', 'fonts', 'js', ...htmlDirectories].includes(relative)) throw new Error(`Symlink in public assets: ${relative}`);
        continue;
      }
      if (entry.isDirectory()) {
        if ((!prefix && ['images', 'fonts', 'js', ...htmlDirectories].includes(entry.name)) || prefix === 'images' || prefix.startsWith('images/') || prefix === 'fonts' || prefix.startsWith('fonts/')) visit(absolute, relative);
      } else if (entry.isFile() && isPublicAsset(relative)) files.push(relative);
    }
  }
  visit(source);
  if (fs.existsSync(destination) || (() => { try { fs.lstatSync(destination); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } })()) {
    const stat = fs.lstatSync(destination);
    if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(destination) !== destination) throw new Error('Refusing unsafe dist destination');
    fs.rmSync(destination, { recursive: true });
  }
  fs.mkdirSync(destination);
  for (const relative of files) {
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (/\.html$/i.test(relative) && !relative.startsWith('admin/')) {
      const original = fs.readFileSync(path.join(source, relative));
      const html = original.toString('utf8');
      const transformed = addTagManager(html);
      fs.writeFileSync(target, transformed === html ? original : transformed);
    } else fs.copyFileSync(path.join(source, relative), target);
  }
  return files;
}

if (require.main === module) console.log(`Built ${buildStatic().length} public assets in dist/`);
module.exports = { buildStatic, isPublicAsset, addTagManager };
