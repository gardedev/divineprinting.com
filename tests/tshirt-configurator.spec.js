const { test, expect } = require('@playwright/test');

// Test the t-shirt configurator

test.describe('T-Shirt Configurator', () => {
  test.beforeEach(async ({ page }) => {
    // Load the t-shirt page
    await page.goto('file://' + __dirname + '/../products/church-t-shirt.html');
    // Wait for canvas to be ready
    await page.waitForSelector('#tshirtCanvas');
  });

  test('page loads with default state', async ({ page }) => {
    // Check that canvas exists
    const canvas = await page.locator('#tshirtCanvas');
    await expect(canvas).toBeVisible();
    
    // Check that cross selector has 10 options
    const crossOptions = await page.locator('.cross-option').count();
    expect(crossOptions).toBe(10);
    
    // Check default text input is empty
    const textInput = await page.locator('#churchText');
    await expect(textInput).toHaveValue('');
  });

  test('selecting different cross designs updates preview', async ({ page }) => {
    // Get initial canvas data
    const canvas = page.locator('#tshirtCanvas');
    
    // Click on different cross options
    const crossOptions = await page.locator('.cross-option');
    
    // Click second cross (celtic)
    await crossOptions.nth(1).click();
    await page.waitForTimeout(100);
    
    // Click third cross (ornate)
    await crossOptions.nth(2).click();
    await page.waitForTimeout(100);
    
    // Click fourth cross (flame)
    await crossOptions.nth(3).click();
    await page.waitForTimeout(100);
    
    // Verify the selected class is applied
    await expect(crossOptions.nth(3)).toHaveClass(/selected/);
  });

  test('changing shirt color updates preview', async ({ page }) => {
    const shirtColors = await page.locator('#shirtColors .color-option');
    
    // Click red shirt color
    await shirtColors.nth(3).click();
    await page.waitForTimeout(100);
    
    // Verify selected class
    await expect(shirtColors.nth(3)).toHaveClass(/selected/);
  });

  test('changing print color updates preview', async ({ page }) => {
    const printColors = await page.locator('#printColors .color-option');
    
    // Click gold print color
    await printColors.nth(2).click();
    await page.waitForTimeout(100);
    
    // Verify selected class
    await expect(printColors.nth(2)).toHaveClass(/selected/);
  });

  test('typing text updates preview', async ({ page }) => {
    const textInput = page.locator('#churchText');
    
    // Type church name
    await textInput.fill('Grace Community Church');
    await page.waitForTimeout(100);
    
    // Verify text is entered
    await expect(textInput).toHaveValue('Grace Community Church');
  });

  test('changing position updates preview', async ({ page }) => {
    const positionSelect = page.locator('#positionSelect');
    
    // Change to left chest
    await positionSelect.selectOption('left');
    await page.waitForTimeout(100);
    
    // Verify selection
    await expect(positionSelect).toHaveValue('left');
    
    // Change to full back
    await positionSelect.selectOption('back');
    await page.waitForTimeout(100);
    
    // Verify selection
    await expect(positionSelect).toHaveValue('back');
  });

  test('changing font updates preview', async ({ page }) => {
    const fontSelect = page.locator('#fontSelect');
    
    // Change to Impact
    await fontSelect.selectOption('Impact');
    await page.waitForTimeout(100);
    
    // Verify selection
    await expect(fontSelect).toHaveValue('Impact');
  });

  test('clicking on canvas positions text', async ({ page }) => {
    const canvas = page.locator('#tshirtCanvas');
    const hint = page.locator('#positionHint');
    
    // Click on canvas
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(100);
    
    // Verify hint updated
    await expect(hint).toContainText('Text positioned');
  });

  test('reset button clears text position', async ({ page }) => {
    const canvas = page.locator('#tshirtCanvas');
    const resetBtn = page.locator('button:has-text("Reset Text Position")');
    const hint = page.locator('#positionHint');
    
    // First click to position
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(100);
    
    // Click reset
    await resetBtn.click();
    await page.waitForTimeout(100);
    
    // Verify hint reset
    await expect(hint).toContainText('Click on the shirt preview');
  });

  test('file upload input exists', async ({ page }) => {
    const fileInput = page.locator('#fileUpload');
    await expect(fileInput).toBeHidden(); // Hidden but exists
  });

  test('snipcart button exists', async ({ page }) => {
    const addToCartBtn = page.locator('.snipcart-add-item');
    await expect(addToCartBtn).toBeVisible();
    await expect(addToCartBtn).toContainText('Add to Cart');
  });
});

// Mobile viewport tests
test.describe('Mobile Responsive', () => {
  test('mobile viewport - iPhone 12', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('file://' + __dirname + '/../products/church-t-shirt.html');
    await page.waitForSelector('#tshirtCanvas');
    
    // Check canvas is visible and properly sized
    const canvas = page.locator('#tshirtCanvas');
    await expect(canvas).toBeVisible();
    
    // Check that controls are accessible
    const addTextBtn = page.locator('#addTextBtn');
    await expect(addTextBtn).toBeVisible();
    
    // Take screenshot for visual regression
    await expect(page).toHaveScreenshot('tshirt-mobile-iphone.png', {
      fullPage: true
    });
  });

  test('mobile viewport - Samsung Galaxy S21', async ({ page }) => {
    await page.setViewportSize({ width: 384, height: 854 });
    await page.goto('file://' + __dirname + '/../products/church-t-shirt.html');
    await page.waitForSelector('#tshirtCanvas');
    
    // Test touch/drag functionality
    const canvas = page.locator('#tshirtCanvas');
    await expect(canvas).toBeVisible();
    
    // Add text and try to drag
    await page.locator('.church-text-input').first().fill('Test');
    await canvas.tap({ position: { x: 200, y: 200 } });
    
    await expect(page).toHaveScreenshot('tshirt-mobile-samsung.png', {
      fullPage: true
    });
  });

  test('tablet viewport - iPad', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('file://' + __dirname + '/../products/church-t-shirt.html');
    await page.waitForSelector('#tshirtCanvas');
    
    const canvas = page.locator('#tshirtCanvas');
    await expect(canvas).toBeVisible();
    
    // Layout should be side-by-side on tablet
    const configuratorWrap = page.locator('.configurator-wrap');
    const wrapStyles = await configuratorWrap.evaluate(el => window.getComputedStyle(el).gridTemplateColumns);
    
    await expect(page).toHaveScreenshot('tshirt-tablet-ipad.png', {
      fullPage: true
    });
  });

  test('desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('file://' + __dirname + '/../products/church-t-shirt.html');
    await page.waitForSelector('#tshirtCanvas');
    
    const canvas = page.locator('#tshirtCanvas');
    await expect(canvas).toBeVisible();
    
    // Check canvas size is appropriate
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox.width).toBeGreaterThan(350);
    expect(canvasBox.height).toBeGreaterThan(350);
    
    await expect(page).toHaveScreenshot('tshirt-desktop.png', {
      fullPage: false,
      clip: { x: 0, y: 0, width: 1280, height: 800 }
    });
  });
});

// Visual regression test
test.describe('Visual Regression', () => {
  test('default state screenshot', async ({ page }) => {
    await page.goto('file://' + __dirname + '/../products/church-t-shirt.html');
    await page.waitForSelector('#tshirtCanvas');
    await page.waitForTimeout(500);
    
    await expect(page).toHaveScreenshot('tshirt-default.png', {
      fullPage: false,
      clip: { x: 0, y: 0, width: 1280, height: 800 }
    });
  });

  test('with text and cross screenshot', async ({ page }) => {
    await page.goto('file://' + __dirname + '/../products/church-t-shirt.html');
    await page.waitForSelector('#tshirtCanvas');
    
    // Add text
    await page.locator('#churchText').fill('Test Church');
    
    // Select a cross
    await page.locator('.cross-option').nth(2).click();
    
    // Change colors
    await page.locator('#shirtColors .color-option').nth(1).click(); // Black shirt
    await page.locator('#printColors .color-option').nth(2).click(); // Gold print
    
    await page.waitForTimeout(500);
    
    await expect(page).toHaveScreenshot('tshirt-customized.png', {
      fullPage: false,
      clip: { x: 0, y: 0, width: 1280, height: 800 }
    });
  });
});
