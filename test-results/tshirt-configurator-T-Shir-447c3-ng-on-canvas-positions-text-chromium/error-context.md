# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tshirt-configurator.spec.js >> T-Shirt Configurator >> clicking on canvas positions text
- Location: tests/tshirt-configurator.spec.js:112:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('#positionHint')
Expected substring: "Text positioned"
Received string:    "Text selected - use arrow keys to move"
Timeout: 5000ms

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for locator('#positionHint')
    8 × locator resolved to <div id="positionHint" class="text-position-hint">Text selected - use arrow keys to move</div>
      - unexpected value "Text selected - use arrow keys to move"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]: ✝ Queens, NY Based - Serving Ministries Nationwide
  - banner [ref=e3]:
    - generic [ref=e4]:
      - link "Divine Printing Logo Divine Printing Crafted for the Kingdom" [ref=e5] [cursor=pointer]:
        - /url: ../index.html
        - img "Divine Printing Logo" [ref=e7]
        - generic [ref=e8]:
          - generic [ref=e9]: Divine Printing
          - generic [ref=e10]: Crafted for the Kingdom
      - navigation [ref=e11]:
        - link "Home" [ref=e12] [cursor=pointer]:
          - /url: ../index.html
        - link "Banners" [ref=e13] [cursor=pointer]:
          - /url: ../index.html#banners
        - link "Events" [ref=e14] [cursor=pointer]:
          - /url: ../index.html#events
        - link "Signs" [ref=e15] [cursor=pointer]:
          - /url: ../index.html#signage
        - link "Design Your Shirt" [ref=e16] [cursor=pointer]:
          - /url: "#designer"
  - generic [ref=e17]:
    - generic [ref=e18]:
      - generic [ref=e19]:
        - img "Group wearing custom church t-shirts" [ref=e20]
        - generic [ref=e21]: New
      - generic [ref=e22]:
        - text: "\"Clothe yourselves with compassion, kindness, humility\""
        - generic [ref=e23]: "- Colossians 3:12"
    - generic [ref=e24]:
      - generic [ref=e25]: ✝ Apparel
      - heading "Custom Church T-Shirts" [level=1] [ref=e26]
      - paragraph [ref=e27]: Wear your faith. Custom designs for your ministry, event, or congregation.
      - generic [ref=e28]:
        - heading "Product Specifications" [level=4] [ref=e29]
        - generic [ref=e30]:
          - generic [ref=e31]: Material
          - generic [ref=e32]: 100% Cotton or Cotton/Poly Blend
        - generic [ref=e33]:
          - generic [ref=e34]: Sizes
          - generic [ref=e35]: S - 5XL
        - generic [ref=e36]:
          - generic [ref=e37]: Print
          - generic [ref=e38]: Screen Print or DTG
        - generic [ref=e39]:
          - generic [ref=e40]: Colors
          - generic [ref=e41]: 7 Colors Available
      - generic [ref=e42]:
        - heading "Key Features" [level=4] [ref=e43]
        - list [ref=e44]:
          - listitem [ref=e45]: ✝ 10 unique cross designs
          - listitem [ref=e46]: ✝ Click to place text anywhere
          - listitem [ref=e47]: ✝ Upload your own logo
          - listitem [ref=e48]: ✝ Bulk discounts
      - link "✝ Design Your Shirt" [ref=e50] [cursor=pointer]:
        - /url: "#designer"
  - generic [ref=e51]:
    - heading "Design Your Custom T-Shirt" [level=2] [ref=e52]
    - paragraph [ref=e53]: Choose a design, click on the shirt to place your text.
    - generic [ref=e54]:
      - generic [ref=e55]:
        - paragraph [ref=e57]: Digital preview - actual colors may vary slightly
        - paragraph [ref=e58]: Tap/click text to select → Drag to move → Arrow keys to fine-tune
      - generic [ref=e59]:
        - generic [ref=e60]:
          - generic [ref=e61]: From $15.00
          - text: Per shirt for 25+ qty. Pricing adjusts based on quantity.
        - generic [ref=e62]:
          - generic [ref=e63]: Your Church Name / Text
          - textbox "Grace Community Church" [ref=e64]
        - generic [ref=e65]: Text selected - use arrow keys to move
        - button "Reset Text Position" [ref=e66] [cursor=pointer]
        - generic [ref=e67]:
          - generic [ref=e68]: Choose a Cross Design
          - generic [ref=e69]:
            - generic "Classic" [ref=e70] [cursor=pointer]:
              - img [ref=e71]
            - generic "Celtic" [ref=e74] [cursor=pointer]:
              - img [ref=e75]
            - generic "Ornate" [ref=e79] [cursor=pointer]:
              - img [ref=e80]
            - generic "Flame" [ref=e84] [cursor=pointer]:
              - img [ref=e85]
            - generic "Royal" [ref=e89] [cursor=pointer]:
              - img [ref=e90]
            - generic "Emerald" [ref=e94] [cursor=pointer]:
              - img [ref=e95]
            - generic "Silver" [ref=e99] [cursor=pointer]:
              - img [ref=e100]
            - generic "Heart" [ref=e103] [cursor=pointer]:
              - img [ref=e104]
            - generic "Dove" [ref=e108] [cursor=pointer]:
              - img [ref=e109]
            - generic "Ichthys" [ref=e113] [cursor=pointer]:
              - img [ref=e114]
        - generic [ref=e119]:
          - generic [ref=e120]: T-Shirt Color
          - generic [ref=e121]:
            - generic "White" [ref=e122] [cursor=pointer]
            - generic "Black" [ref=e123] [cursor=pointer]
            - generic "Navy" [ref=e124] [cursor=pointer]
            - generic "Red" [ref=e125] [cursor=pointer]
            - generic "Purple" [ref=e126] [cursor=pointer]
            - generic "Gold" [ref=e127] [cursor=pointer]
            - generic "Forest Green" [ref=e128] [cursor=pointer]
        - generic [ref=e129]:
          - generic [ref=e130]: Print Color
          - generic [ref=e131]:
            - generic "White" [ref=e132] [cursor=pointer]
            - generic "Black" [ref=e133] [cursor=pointer]
            - generic "Gold" [ref=e134] [cursor=pointer]
            - generic "Red" [ref=e135] [cursor=pointer]
            - generic "Navy" [ref=e136] [cursor=pointer]
        - generic [ref=e137]:
          - generic [ref=e138]: Design Position
          - combobox [ref=e139]:
            - option "Center Chest" [selected]
            - option "Left Chest"
            - option "Full Back"
        - generic [ref=e140]:
          - generic [ref=e141]: Font Style
          - combobox [ref=e142]:
            - option "Cinzel (Elegant)" [selected]
            - option "Inter (Clean)"
            - option "Georgia (Classic)"
            - option "Brush Script (Script)"
            - option "Impact (Bold)"
            - option "Playfair (Premium)"
            - option "Oswald (Modern)"
            - option "Lobster (Friendly)"
        - generic [ref=e143]:
          - generic [ref=e144]: Upload Your Own Design
          - generic [ref=e145] [cursor=pointer]:
            - generic [ref=e146]: Click to upload logo/artwork
            - text: PNG, JPG, SVG (max 5MB)
        - button "Add to Cart - $15.00" [ref=e147] [cursor=pointer]
```

# Test source

```ts
  21  |     
  22  |     // Check default text input is empty
  23  |     const textInput = await page.locator('#churchText');
  24  |     await expect(textInput).toHaveValue('');
  25  |   });
  26  | 
  27  |   test('selecting different cross designs updates preview', async ({ page }) => {
  28  |     // Get initial canvas data
  29  |     const canvas = page.locator('#tshirtCanvas');
  30  |     
  31  |     // Click on different cross options
  32  |     const crossOptions = await page.locator('.cross-option');
  33  |     
  34  |     // Click second cross (celtic)
  35  |     await crossOptions.nth(1).click();
  36  |     await page.waitForTimeout(100);
  37  |     
  38  |     // Click third cross (ornate)
  39  |     await crossOptions.nth(2).click();
  40  |     await page.waitForTimeout(100);
  41  |     
  42  |     // Click fourth cross (flame)
  43  |     await crossOptions.nth(3).click();
  44  |     await page.waitForTimeout(100);
  45  |     
  46  |     // Verify the selected class is applied
  47  |     await expect(crossOptions.nth(3)).toHaveClass(/selected/);
  48  |   });
  49  | 
  50  |   test('changing shirt color updates preview', async ({ page }) => {
  51  |     const shirtColors = await page.locator('#shirtColors .color-option');
  52  |     
  53  |     // Click red shirt color
  54  |     await shirtColors.nth(3).click();
  55  |     await page.waitForTimeout(100);
  56  |     
  57  |     // Verify selected class
  58  |     await expect(shirtColors.nth(3)).toHaveClass(/selected/);
  59  |   });
  60  | 
  61  |   test('changing print color updates preview', async ({ page }) => {
  62  |     const printColors = await page.locator('#printColors .color-option');
  63  |     
  64  |     // Click gold print color
  65  |     await printColors.nth(2).click();
  66  |     await page.waitForTimeout(100);
  67  |     
  68  |     // Verify selected class
  69  |     await expect(printColors.nth(2)).toHaveClass(/selected/);
  70  |   });
  71  | 
  72  |   test('typing text updates preview', async ({ page }) => {
  73  |     const textInput = page.locator('#churchText');
  74  |     
  75  |     // Type church name
  76  |     await textInput.fill('Grace Community Church');
  77  |     await page.waitForTimeout(100);
  78  |     
  79  |     // Verify text is entered
  80  |     await expect(textInput).toHaveValue('Grace Community Church');
  81  |   });
  82  | 
  83  |   test('changing position updates preview', async ({ page }) => {
  84  |     const positionSelect = page.locator('#positionSelect');
  85  |     
  86  |     // Change to left chest
  87  |     await positionSelect.selectOption('left');
  88  |     await page.waitForTimeout(100);
  89  |     
  90  |     // Verify selection
  91  |     await expect(positionSelect).toHaveValue('left');
  92  |     
  93  |     // Change to full back
  94  |     await positionSelect.selectOption('back');
  95  |     await page.waitForTimeout(100);
  96  |     
  97  |     // Verify selection
  98  |     await expect(positionSelect).toHaveValue('back');
  99  |   });
  100 | 
  101 |   test('changing font updates preview', async ({ page }) => {
  102 |     const fontSelect = page.locator('#fontSelect');
  103 |     
  104 |     // Change to Impact
  105 |     await fontSelect.selectOption('Impact');
  106 |     await page.waitForTimeout(100);
  107 |     
  108 |     // Verify selection
  109 |     await expect(fontSelect).toHaveValue('Impact');
  110 |   });
  111 | 
  112 |   test('clicking on canvas positions text', async ({ page }) => {
  113 |     const canvas = page.locator('#tshirtCanvas');
  114 |     const hint = page.locator('#positionHint');
  115 |     
  116 |     // Click on canvas
  117 |     await canvas.click({ position: { x: 200, y: 200 } });
  118 |     await page.waitForTimeout(100);
  119 |     
  120 |     // Verify hint updated
> 121 |     await expect(hint).toContainText('Text positioned');
      |                        ^ Error: expect(locator).toContainText(expected) failed
  122 |   });
  123 | 
  124 |   test('reset button clears text position', async ({ page }) => {
  125 |     const canvas = page.locator('#tshirtCanvas');
  126 |     const resetBtn = page.locator('button:has-text("Reset Text Position")');
  127 |     const hint = page.locator('#positionHint');
  128 |     
  129 |     // First click to position
  130 |     await canvas.click({ position: { x: 200, y: 200 } });
  131 |     await page.waitForTimeout(100);
  132 |     
  133 |     // Click reset
  134 |     await resetBtn.click();
  135 |     await page.waitForTimeout(100);
  136 |     
  137 |     // Verify hint reset
  138 |     await expect(hint).toContainText('Click on the shirt preview');
  139 |   });
  140 | 
  141 |   test('file upload input exists', async ({ page }) => {
  142 |     const fileInput = page.locator('#fileUpload');
  143 |     await expect(fileInput).toBeHidden(); // Hidden but exists
  144 |   });
  145 | 
  146 |   test('snipcart button exists', async ({ page }) => {
  147 |     const addToCartBtn = page.locator('.snipcart-add-item');
  148 |     await expect(addToCartBtn).toBeVisible();
  149 |     await expect(addToCartBtn).toContainText('Add to Cart');
  150 |   });
  151 | });
  152 | 
  153 | // Visual regression test
  154 | test.describe('Visual Regression', () => {
  155 |   test('default state screenshot', async ({ page }) => {
  156 |     await page.goto('file://' + __dirname + '/../products/church-t-shirt.html');
  157 |     await page.waitForSelector('#tshirtCanvas');
  158 |     await page.waitForTimeout(500);
  159 |     
  160 |     await expect(page).toHaveScreenshot('tshirt-default.png', {
  161 |       fullPage: false,
  162 |       clip: { x: 0, y: 0, width: 1280, height: 800 }
  163 |     });
  164 |   });
  165 | 
  166 |   test('with text and cross screenshot', async ({ page }) => {
  167 |     await page.goto('file://' + __dirname + '/../products/church-t-shirt.html');
  168 |     await page.waitForSelector('#tshirtCanvas');
  169 |     
  170 |     // Add text
  171 |     await page.locator('#churchText').fill('Test Church');
  172 |     
  173 |     // Select a cross
  174 |     await page.locator('.cross-option').nth(2).click();
  175 |     
  176 |     // Change colors
  177 |     await page.locator('#shirtColors .color-option').nth(1).click(); // Black shirt
  178 |     await page.locator('#printColors .color-option').nth(2).click(); // Gold print
  179 |     
  180 |     await page.waitForTimeout(500);
  181 |     
  182 |     await expect(page).toHaveScreenshot('tshirt-customized.png', {
  183 |       fullPage: false,
  184 |       clip: { x: 0, y: 0, width: 1280, height: 800 }
  185 |     });
  186 |   });
  187 | });
  188 | 
```