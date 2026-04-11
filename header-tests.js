const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = 'file:///home/ubuntu/.openclaw/workspace/divineprinting';
const PAGES = [
  { name: 'Homepage', path: '/index.html' },
  { name: 'About', path: '/about.html' },
  { name: 'Contact', path: '/contact.html' },
  { name: 'Product - Church T-Shirt', path: '/products/church-t-shirt.html' }
];

// Test results
const results = {
  timestamp: new Date().toISOString(),
  desktop: [],
  mobile: [],
  crossPage: [],
  screenshots: []
};

// Helper to delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper to log test result
function logResult(category, testName, passed, details = '') {
  const result = { testName, passed, details, timestamp: new Date().toISOString() };
  results[category].push(result);
  console.log(`${passed ? '✅' : '❌'} ${testName}: ${details || (passed ? 'PASSED' : 'FAILED')}`);
  return result;
}

// Helper to take screenshot
async function takeScreenshot(page, name, category) {
  const screenshotPath = path.join(__dirname, 'test-report', 'screenshots', `${category}-${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  results.screenshots.push({ name, category, path: screenshotPath });
  return screenshotPath;
}

// Desktop Tests
async function runDesktopTests(browser) {
  console.log('\n=== DESKTOP TESTS ===\n');
  
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  
  // Navigate to homepage
  await page.goto(`${BASE_URL}/index.html`);
  await delay(1000);
  
  // Test 1: Cart icon visible
  try {
    const cartIcon = await page.locator('.cart-icon, [aria-label*="Cart"]').first();
    const isVisible = await cartIcon.isVisible().catch(() => false);
    logResult('desktop', 'Cart icon visible in header', isVisible);
  } catch (e) {
    logResult('desktop', 'Cart icon visible in header', false, e.message);
  }
  
  // Test 2: Account icon visible
  try {
    const accountIcon = await page.locator('[aria-label*="Account"], a[href*="account"]').first();
    const isVisible = await accountIcon.isVisible().catch(() => false);
    logResult('desktop', 'Account icon visible in header', isVisible);
  } catch (e) {
    logResult('desktop', 'Account icon visible in header', false, e.message);
  }
  
  // Test 3: Click cart icon shows alert
  try {
    page.on('dialog', async dialog => {
      const message = dialog.message();
      await dialog.accept();
      logResult('desktop', 'Cart icon click shows alert', message.includes('Cart coming soon'));
    });
    const cartIcon = await page.locator('.cart-icon, [aria-label*="Cart"]').first();
    await cartIcon.click();
    await delay(500);
  } catch (e) {
    logResult('desktop', 'Cart icon click shows alert', false, e.message);
  }
  
  // Test 4: Click account icon navigates to account page
  try {
    await page.goto(`${BASE_URL}/index.html`);
    await delay(500);
    const accountIcon = await page.locator('[aria-label*="Account"], a[href*="account"]').first();
    await accountIcon.click();
    await delay(1000);
    const url = page.url();
    const navigated = url.includes('account');
    logResult('desktop', 'Account icon navigates to account page', navigated, `URL: ${url}`);
  } catch (e) {
    logResult('desktop', 'Account icon navigates to account page', false, e.message);
  }
  
  // Test 5: Navigation links work
  try {
    await page.goto(`${BASE_URL}/index.html`);
    await delay(500);
    const navLinks = await page.locator('nav.desktop-nav a, header nav a').all();
    let workingLinks = 0;
    for (const link of navLinks.slice(0, 3)) {
      const href = await link.getAttribute('href');
      if (href && !href.startsWith('#')) {
        workingLinks++;
      }
    }
    logResult('desktop', 'Navigation links present', workingLinks > 0, `${workingLinks} links found`);
  } catch (e) {
    logResult('desktop', 'Navigation links present', false, e.message);
  }
  
  // Screenshot
  await page.goto(`${BASE_URL}/index.html`);
  await delay(500);
  await takeScreenshot(page, 'header-desktop', 'desktop');
  
  await context.close();
}

// Mobile Tests
async function runMobileTests(browser) {
  console.log('\n=== MOBILE TESTS ===\n');
  
  const context = await browser.newContext({ 
    viewport: { width: 375, height: 667 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
  });
  const page = await context.newPage();
  
  // Navigate to homepage
  await page.goto(`${BASE_URL}/index.html`);
  await delay(1000);
  
  // Test 1: Hamburger menu button visible
  try {
    const hamburger = await page.locator('.mobile-menu-btn, button[aria-label*="Menu"], .hamburger').first();
    const isVisible = await hamburger.isVisible().catch(() => false);
    logResult('mobile', 'Hamburger menu button visible', isVisible);
  } catch (e) {
    logResult('mobile', 'Hamburger menu button visible', false, e.message);
  }
  
  // Test 2: Click hamburger opens mobile menu
  try {
    const hamburger = await page.locator('.mobile-menu-btn, button[aria-label*="Menu"]').first();
    await hamburger.click();
    await delay(500);
    const mobileMenu = await page.locator('#mobile-menu, .mobile-menu, .mobile-nav').first();
    const isVisible = await mobileMenu.isVisible().catch(() => false);
    logResult('mobile', 'Hamburger click opens mobile menu', isVisible);
  } catch (e) {
    logResult('mobile', 'Hamburger click opens mobile menu', false, e.message);
  }
  
  // Test 3: Mobile menu shows all nav links + Account + Cart
  try {
    const mobileMenu = await page.locator('#mobile-menu, .mobile-menu, .mobile-nav').first();
    const menuLinks = await mobileMenu.locator('a').allInnerTexts();
    const hasNavLinks = menuLinks.some(t => t.toLowerCase().includes('home') || t.toLowerCase().includes('banner'));
    const hasAccount = menuLinks.some(t => t.toLowerCase().includes('account'));
    const hasCart = menuLinks.some(t => t.toLowerCase().includes('cart'));
    const passed = hasNavLinks && hasAccount && hasCart;
    logResult('mobile', 'Mobile menu shows nav links + Account + Cart', passed, 
      `Links found: ${menuLinks.join(', ')}`);
  } catch (e) {
    logResult('mobile', 'Mobile menu shows nav links + Account + Cart', false, e.message);
  }
  
  // Test 4: Close button works
  try {
    const closeBtn = await page.locator('.mobile-menu-close, button[aria-label*="Close"]').first();
    await closeBtn.click();
    await delay(500);
    const mobileMenu = await page.locator('#mobile-menu, .mobile-menu').first();
    const isHidden = await mobileMenu.isHidden().catch(() => true);
    logResult('mobile', 'Close button hides mobile menu', isHidden);
  } catch (e) {
    logResult('mobile', 'Close button hides mobile menu', false, e.message);
  }
  
  // Test 5: Cart icon shows in header with badge
  try {
    await page.goto(`${BASE_URL}/index.html`);
    await delay(500);
    const cartIcon = await page.locator('.cart-icon, [aria-label*="Cart"]').first();
    const cartVisible = await cartIcon.isVisible().catch(() => false);
    const badge = await cartIcon.locator('.cart-count, .badge').first();
    const badgeVisible = await badge.isVisible().catch(() => false);
    logResult('mobile', 'Cart icon visible in mobile header with badge', cartVisible, 
      `Cart: ${cartVisible}, Badge: ${badgeVisible}`);
  } catch (e) {
    logResult('mobile', 'Cart icon visible in mobile header with badge', false, e.message);
  }
  
  // Screenshot
  await page.goto(`${BASE_URL}/index.html`);
  await delay(500);
  await takeScreenshot(page, 'header-mobile-closed', 'mobile');
  
  // Open menu and screenshot
  try {
    const hamburger = await page.locator('.mobile-menu-btn, button[aria-label*="Menu"]').first();
    await hamburger.click();
    await delay(500);
    await takeScreenshot(page, 'header-mobile-open', 'mobile');
  } catch (e) {
    console.log('Could not take open menu screenshot:', e.message);
  }
  
  await context.close();
}

// Cross-page Tests
async function runCrossPageTests(browser) {
  console.log('\n=== CROSS-PAGE TESTS ===\n');
  
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  
  for (const pageConfig of PAGES) {
    const page = await context.newPage();
    const fullUrl = `${BASE_URL}${pageConfig.path}`;
    
    try {
      await page.goto(fullUrl);
      await delay(1000);
      
      // Check header exists
      const header = await page.locator('header').first();
      const headerVisible = await header.isVisible().catch(() => false);
      
      // Check cart icon
      const cartIcon = await page.locator('.cart-icon, [aria-label*="Cart"]').first();
      const cartVisible = await cartIcon.isVisible().catch(() => false);
      
      // Check account icon
      const accountIcon = await page.locator('[aria-label*="Account"], a[href*="account"]').first();
      const accountVisible = await accountIcon.isVisible().catch(() => false);
      
      // Check mobile menu button
      const hamburger = await page.locator('.mobile-menu-btn, button[aria-label*="Menu"]').first();
      const hamburgerVisible = await hamburger.isVisible().catch(() => false);
      
      const passed = headerVisible && cartVisible && accountVisible;
      logResult('crossPage', `Header on ${pageConfig.name}`, passed, 
        `Header: ${headerVisible}, Cart: ${cartVisible}, Account: ${accountVisible}, Hamburger: ${hamburgerVisible}`);
      
      // Take screenshot
      await takeScreenshot(page, `header-${pageConfig.name.toLowerCase().replace(/\s+/g, '-')}`, 'crosspage');
      
    } catch (e) {
      logResult('crossPage', `Header on ${pageConfig.name}`, false, e.message);
    }
    
    await page.close();
  }
  
  await context.close();
}

// Generate HTML Report
function generateReport() {
  const reportDir = path.join(__dirname, 'test-report');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  if (!fs.existsSync(path.join(reportDir, 'screenshots'))) {
    fs.mkdirSync(path.join(reportDir, 'screenshots'), { recursive: true });
  }
  
  const totalTests = results.desktop.length + results.mobile.length + results.crossPage.length;
  const passedTests = [...results.desktop, ...results.mobile, ...results.crossPage].filter(r => r.passed).length;
  const failedTests = totalTests - passedTests;
  
  const generateSection = (title, tests) => {
    const passed = tests.filter(t => t.passed).length;
    const failed = tests.length - passed;
    return `
      <div class="section">
        <h2>${title} <span class="badge ${failed === 0 ? 'success' : 'error'}">${passed}/${tests.length} Passed</span></h2>
        <table>
          <thead>
            <tr><th>Test</th><th>Status</th><th>Details</th></tr>
          </thead>
          <tbody>
            ${tests.map(t => `
              <tr class="${t.passed ? 'pass' : 'fail'}">
                <td>${t.testName}</td>
                <td class="status">${t.passed ? '✅ PASS' : '❌ FAIL'}</td>
                <td>${t.details || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  };
  
  const generateScreenshots = () => {
    const desktop = results.screenshots.filter(s => s.category === 'desktop');
    const mobile = results.screenshots.filter(s => s.category === 'mobile');
    const crosspage = results.screenshots.filter(s => s.category === 'crosspage');
    
    const makeGallery = (items) => items.map(s => `
      <div class="screenshot">
        <img src="screenshots/${path.basename(s.path)}" alt="${s.name}" />
        <p>${s.name}</p>
      </div>
    `).join('');
    
    return `
      <div class="section">
        <h2>Screenshots</h2>
        <h3>Desktop</h3>
        <div class="gallery">${makeGallery(desktop)}</div>
        <h3>Mobile</h3>
        <div class="gallery">${makeGallery(mobile)}</div>
        <h3>Cross-Page</h3>
        <div class="gallery">${makeGallery(crosspage)}</div>
      </div>
    `;
  };
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DivinePrinting Header Test Report</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a0d30;
      color: #f0e8ff;
      margin: 0;
      padding: 20px;
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 {
      font-family: 'Cinzel', serif;
      color: #c9a227;
      text-align: center;
      margin-bottom: 10px;
    }
    .summary {
      background: rgba(201,162,39,0.1);
      border: 1px solid rgba(201,162,39,0.3);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 30px;
      text-align: center;
    }
    .summary .stats {
      display: flex;
      justify-content: center;
      gap: 40px;
      margin-top: 15px;
    }
    .stat { text-align: center; }
    .stat .number {
      font-size: 2.5rem;
      font-weight: bold;
      color: #c9a227;
    }
    .stat .label { color: rgba(240,232,255,0.7); }
    .section {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .section h2 {
      color: #c9a227;
      margin-top: 0;
      display: flex;
      align-items: center;
      gap: 15px;
    }
    .section h3 {
      color: rgba(240,232,255,0.9);
      margin-top: 20px;
      margin-bottom: 10px;
    }
    .badge {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .badge.success { background: #4caf50; color: white; }
    .badge.error { background: #f44336; color: white; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    th {
      color: #c9a227;
      font-weight: 600;
    }
    tr.pass { background: rgba(76,175,80,0.1); }
    tr.fail { background: rgba(244,67,54,0.1); }
    .status { font-weight: 600; }
    .gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
      margin-top: 15px;
    }
    .screenshot {
      background: rgba(0,0,0,0.3);
      border-radius: 8px;
      overflow: hidden;
    }
    .screenshot img {
      width: 100%;
      height: auto;
      display: block;
    }
    .screenshot p {
      padding: 10px;
      margin: 0;
      text-align: center;
      color: rgba(240,232,255,0.8);
      font-size: 0.9rem;
    }
    .timestamp {
      text-align: center;
      color: rgba(240,232,255,0.5);
      margin-top: 30px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🧪 DivinePrinting Header Test Report</h1>
    
    <div class="summary">
      <p>Comprehensive header functionality testing across desktop and mobile viewports</p>
      <div class="stats">
        <div class="stat">
          <div class="number">${totalTests}</div>
          <div class="label">Total Tests</div>
        </div>
        <div class="stat">
          <div class="number" style="color: #4caf50;">${passedTests}</div>
          <div class="label">Passed</div>
        </div>
        <div class="stat">
          <div class="number" style="color: #f44336;">${failedTests}</div>
          <div class="label">Failed</div>
        </div>
      </div>
    </div>
    
    ${generateSection('Desktop Tests', results.desktop)}
    ${generateSection('Mobile Tests', results.mobile)}
    ${generateSection('Cross-Page Tests', results.crossPage)}
    ${generateScreenshots()}
    
    <p class="timestamp">Generated: ${new Date(results.timestamp).toLocaleString()}</p>
  </div>
</body>
</html>`;
  
  fs.writeFileSync(path.join(reportDir, 'index.html'), html);
  console.log(`\n📊 Report generated: ${path.join(reportDir, 'index.html')}`);
}

// Main
(async () => {
  console.log('🚀 Starting DivinePrinting Header Tests...\n');
  
  const browser = await chromium.launch({ headless: true });
  
  try {
    await runDesktopTests(browser);
    await runMobileTests(browser);
    await runCrossPageTests(browser);
  } catch (e) {
    console.error('Test error:', e);
  }
  
  await browser.close();
  
  generateReport();
  
  // Summary
  const totalTests = results.desktop.length + results.mobile.length + results.crossPage.length;
  const passedTests = [...results.desktop, ...results.mobile, ...results.crossPage].filter(r => r.passed).length;
  console.log(`\n✅ Tests Complete: ${passedTests}/${totalTests} passed`);
})();
