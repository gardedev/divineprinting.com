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
