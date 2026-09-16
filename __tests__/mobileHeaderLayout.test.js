'use strict';

const fs = require('fs');
const path = require('path');

const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const productPage = fs.readFileSync(path.join(__dirname, '..', 'products', 'church-t-shirt.html'), 'utf8');

describe('narrow mobile header layout', () => {
  test('reserves a compact 320px layout without changing normal mobile styles', () => {
    expect(styles).toContain('@media (max-width: 360px) {');
    expect(styles).toContain('.nav-inner { padding: 10px 12px; gap: 8px; }');
    expect(styles).toContain('.logo-icon { width: 38px; height: 38px; }');
    expect(styles).toContain('.header-actions { gap: 4px; }');
    expect(styles).toContain('.header-icon, .mobile-menu-btn { padding: 7px; }');
    expect(styles).toContain('@media (max-width: 768px) {');
  });

  test('keeps the product page mobile-menu control connected to its existing handler', () => {
    expect(productPage).toContain('function toggleMobileMenu() {');
    expect(productPage).toContain("menu.classList.toggle('active');");
  });
});
