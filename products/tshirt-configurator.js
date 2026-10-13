// T-Shirt Configurator JavaScript - Multi-text support

// PNG Design options (replacing SVG crosses)
const designOptions = DivineTshirtAssets.templates;
const colorCategories = { Popular: DivineTshirtAssets.colors };

// State
let state = {
  selectedDesign: 'cross-modern',
  shirtColor: '#8B3A3A',
  position: 'center',
  uploadedImage: null,
  designX: null,
  designY: null,
  designScale: 1.0,
  uploadedImageScale: 1.0,
  uploadedImageStretch: false,
  selectedElement: null,
  texts: [
    { id: 0, text: 'Your Church Name', x: 400, y: 330, font: 'Cinzel', size: 32, color: '#FFFFFF', arch: 0 },
    { id: 1, text: 'Faith • Hope • Love', x: 400, y: 376, font: 'Inter', size: 24, color: '#FFFFFF', arch: 0 }
  ]
};



// Current shirt image filename
let currentShirtImageName = 'antique-cherry-red.jpg';

function getDefaultPositions() {
  let cx, cy, scale;
  // Using 800x800 canvas, so coordinates are doubled from 400x400
  if (state.position === 'center') { cx = 400; cy = 240; scale = 140; }
  else if (state.position === 'left') { cx = 280; cy = 220; scale = 100; }
  else { cx = 200; cy = 200; scale = 90; }
  return { cx, cy, scale };
}

// Movement
const MOVE_STEP = 2;
document.addEventListener('keydown', (e) => {
  if (state.selectedElement === null || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return;
  const { cx, cy, scale } = getDefaultPositions();
  
  if (state.selectedElement === 'design') {
    if (state.designX == null) { state.designX = cx; state.designY = cy; }
    switch(e.key) {
      case 'ArrowUp': state.designY -= MOVE_STEP; e.preventDefault(); break;
      case 'ArrowDown': state.designY += MOVE_STEP; e.preventDefault(); break;
      case 'ArrowLeft': state.designX -= MOVE_STEP; e.preventDefault(); break;
      case 'ArrowRight': state.designX += MOVE_STEP; e.preventDefault(); break;
    }
  } else {
    const textObj = state.texts.find(t => t.id === state.selectedElement);
    if (textObj) {
      if (textObj.x == null) { textObj.x = cx; textObj.y = cy + scale/2 + 10 + state.texts.indexOf(textObj) * 22; }
      switch(e.key) {
        case 'ArrowUp': textObj.y -= MOVE_STEP; e.preventDefault(); break;
        case 'ArrowDown': textObj.y += MOVE_STEP; e.preventDefault(); break;
        case 'ArrowLeft': textObj.x -= MOVE_STEP; e.preventDefault(); break;
        case 'ArrowRight': textObj.x += MOVE_STEP; e.preventDefault(); break;
      }
    }
  }
  state.designX = state.designX == null ? null : DivineTshirtPreview.coordinate(state.designX, 400);
  state.designY = state.designY == null ? null : DivineTshirtPreview.coordinate(state.designY, 240);
  state.texts.forEach(t => { if (t.x != null) t.x = DivineTshirtPreview.coordinate(t.x, 400); if (t.y != null) t.y = DivineTshirtPreview.coordinate(t.y, 330); });
  drawPreview();
});

// Drag support
let isDragging = false;
let dragOffsetX = 0, dragOffsetY = 0;

function getCanvasCoords(e) {
  const canvas = document.getElementById('tshirtCanvas');
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: (clientY - rect.top) * (canvas.height / rect.height)
  };
}

function handleDragStart(e) {
  document.getElementById('tshirtCanvas').focus();
  const coords = getCanvasCoords(e);
  const { cx, cy, scale } = getDefaultPositions();
  
  for (let i = state.texts.length - 1; i >= 0; i--) {
    const textObj = state.texts[i];
    if (!textObj.text) continue;
    const textX = textObj.x ?? cx;
    const textY = textObj.y ?? (cy + scale/2 + 10 + state.texts.indexOf(textObj) * 22);
    if (Math.sqrt(Math.pow(coords.x - textX, 2) + Math.pow(coords.y - textY, 2)) < 60) {
      isDragging = true;
      state.selectedElement = textObj.id;
      dragOffsetX = textX - coords.x;
      dragOffsetY = textY - coords.y;
      updateTextSelectionUI();
      document.getElementById('positionHint').textContent = 'Dragging text...';
      e.preventDefault();
      drawPreview();
      return;
    }
  }
  
  const designX = state.designX ?? cx;
  const designY = state.designY ?? cy;
  if (Math.sqrt(Math.pow(coords.x - designX, 2) + Math.pow(coords.y - designY, 2)) < 50) {
    isDragging = true;
    state.selectedElement = 'design';
    dragOffsetX = designX - coords.x;
    dragOffsetY = designY - coords.y;
    document.getElementById('positionHint').textContent = 'Dragging design...';
    e.preventDefault();
    drawPreview();
  }
}

function handleDragMove(e) {
  if (!isDragging) return;
  const coords = getCanvasCoords(e);
  if (state.selectedElement === 'design') {
    state.designX = DivineTshirtPreview.coordinate(coords.x + dragOffsetX, 400);
    state.designY = DivineTshirtPreview.coordinate(coords.y + dragOffsetY, 330);
  } else {
    const textObj = state.texts.find(t => t.id === state.selectedElement);
    if (textObj) { textObj.x = DivineTshirtPreview.coordinate(coords.x + dragOffsetX, 400); textObj.y = DivineTshirtPreview.coordinate(coords.y + dragOffsetY, 330); }
  }
  e.preventDefault();
  drawPreview();
}

function handleDragEnd() {
  if (isDragging) {
    isDragging = false;
    const name = state.selectedElement === 'design' ? 'Design' : 'Text';
    document.getElementById('positionHint').textContent = name + ' positioned - drag to move or use arrow keys';
    drawPreview();
  }
}

// Text management
function updateText(id, value) { 
  const t = state.texts.find(x => x.id === id); 
  if (t) { 
    t.text = value; 
    syncDefaultTextPreview(); 
    drawPreview(); 
  } 
}

// Sync the default-text-preview panel (left side) with state.texts
function syncDefaultTextPreview() {
  const headline = document.querySelector('.default-headline');
  const subtext = document.querySelector('.default-subtext');
  if (headline && state.texts.length >= 1) {
    const val = state.texts[0].text;
    if (headline.textContent !== val) {
      headline.textContent = val || '';
    }
  }
  if (subtext && state.texts.length >= 2) {
    const val = state.texts[1].text;
    if (subtext.textContent !== val) {
      subtext.textContent = val || '';
    }
  }
}

// Sync text input fields (right side) with state.texts
function syncTextInputs() {
  const inputs = document.querySelectorAll('.church-text-input');
  state.texts.forEach((t, i) => {
    if (inputs[i] && inputs[i].value !== t.text) {
      inputs[i].value = t.text;
    }
  });
}
function updateTextFont(id, font) { const t = state.texts.find(x => x.id === id); if (t) { t.font = font; drawPreview(); } }
function updateTextColor(id, color) { const t = state.texts.find(x => x.id === id); if (t) { t.color = color.toUpperCase(); drawPreview(); } }
function updateTextSize(id, size) { 
  const t = state.texts.find(x => x.id === id); 
  if (t) { 
    t.size = parseInt(size); 
    const label = document.getElementById(`size-label-${id}`);
    if (label) label.textContent = size + 'px';
    drawPreview(); 
  } 
}

function updateTextArch(id, arch) {
  const t = state.texts.find(x => x.id === id);
  if (t) {
    t.arch = parseInt(arch);
    const label = document.getElementById(`arch-label-${id}`);
    if (label) label.textContent = arch + '°';
    drawPreview();
  }
}
function selectText(id) {
  state.selectedElement = id;
  updateTextSelectionUI();
  document.getElementById('positionHint').textContent = 'Text ' + (state.texts.findIndex(t => t.id === id) + 1) + ' selected - drag to move';
  drawPreview();
}

function updateTextSelectionUI() {
  document.querySelectorAll('.text-instance').forEach(el => {
    el.classList.toggle('selected', state.selectedElement === parseInt(el.dataset.id));
  });
}

function renderTextControls() {
  const container = document.getElementById('textControlsContainer');
  if (!container) return;
  container.replaceChildren();
  state.texts.forEach((t, i) => {
    const panel = document.createElement('div'); panel.className = 'text-instance'; panel.dataset.id = t.id; panel.tabIndex = 0; panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', `Text ${i + 1} positioning`); panel.addEventListener('focus', () => selectText(t.id));
    const heading = document.createElement('label'); heading.textContent = `Text ${i + 1}`; heading.htmlFor = `text-input-${t.id}`; panel.append(heading);
    const input = document.createElement('input'); input.type = 'text'; input.id = `text-input-${t.id}`; input.className = 'church-text-input'; input.maxLength = 100; input.value = t.text;
    input.addEventListener('input', () => updateText(t.id, input.value)); input.addEventListener('focus', () => selectText(t.id)); panel.append(input);
    const font = document.createElement('select'); font.className = 'font-select-small'; font.setAttribute('aria-label', `Text ${i + 1} font`);
    Object.entries({ Cinzel: 'Cinzel', Inter: 'Inter', Georgia: 'Georgia', 'Brush Script MT': 'Script', Impact: 'Impact', 'Playfair Display': 'Playfair', Oswald: 'Oswald', Lobster: 'Lobster' }).forEach(([value, name]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = name; font.append(option);
    }); font.value = t.font; font.addEventListener('change', () => updateTextFont(t.id, font.value)); panel.append(font);
    const color = document.createElement('input'); color.type = 'color'; color.value = t.color; color.setAttribute('aria-label', `Text ${i + 1} color`); color.addEventListener('input', () => updateTextColor(t.id, color.value)); panel.append(color);
    [['Size', 'size', 10, 48, updateTextSize, 'px'], ['Arch', 'arch', -30, 30, updateTextArch, '°']].forEach(([name, key, min, max, update, unit]) => {
      const label = document.createElement('label'); label.textContent = `${name}: `;
      const value = document.createElement('span'); value.id = `${key}-label-${t.id}`; value.textContent = `${t[key] || 0}${unit}`; label.append(value);
      const slider = document.createElement('input'); slider.type = 'range'; slider.min = min; slider.max = max; slider.value = t[key] || 0; slider.setAttribute('aria-label', `Text ${i + 1} ${name.toLowerCase()}`); slider.addEventListener('input', () => update(t.id, slider.value)); panel.append(label, slider);
    });
    const note = document.createElement('small'); note.textContent = 'Other font selections use Inter in the preview; your selected font is saved.'; panel.append(note); container.append(panel);
  });
  updateTextSelectionUI(); syncDefaultTextPreview();
}

function resetPositions() {
  state.designX = null; state.designY = null;
  state.texts.forEach(t => { t.x = null; t.y = null; });
  state.selectedElement = null;
  document.getElementById('positionHint').textContent = 'Click on the shirt to place elements';
  updateTextSelectionUI();
  drawPreview();
}

function updateDesignSize(value) {
  state.designScale = value / 100;
  const label = document.getElementById('designSizeLabel');
  if (label) label.textContent = value + '%';
  drawPreview();
}

function editorConfiguration() {
  return DivineTshirtPreview.normalizeEditor(state, document.getElementById('selectedColorName')?.textContent || 'Black', (document.getElementById('organizationName')?.value || '').trim());
}

function drawPreview() {
  const canvas = document.getElementById('tshirtCanvas');
  if (!canvas) return;
  const status = document.getElementById('previewStatus');
  try { DivineTshirtPreview.render(canvas, editorConfiguration(), status); }
  catch (error) { if (status) status.textContent = error.message; }
}

// Init
function init() {
  const approved = DivineTshirtAssets.colors;
  Object.keys(colorCategories).forEach(key => { colorCategories[key] = key === 'Popular' ? approved : []; });
  state.shirtColor = approved[0].hex; currentShirtImageName = approved[0].image;
  const selectedColorName = document.getElementById('selectedColorName');
  const selectedColorPreview = document.getElementById('selectedColorPreview');
  if (selectedColorName) selectedColorName.textContent = approved[0].name;
  if (selectedColorPreview) selectedColorPreview.style.background = approved[0].hex;
  // Load initial shirt image
  drawPreview();
  
  // Load design images

  
  // Create design selector with PNG thumbnails
  const crossSelector = document.getElementById('crossSelector');
  if (crossSelector) {
    crossSelector.innerHTML = '';
    crossSelector.style.gridTemplateColumns = 'repeat(4, 1fr)';
    
    Object.entries(designOptions).forEach(([key, option]) => {
      const div = document.createElement('div');
      div.className = 'design-option' + (key === state.selectedDesign ? ' selected' : '');
      div.style.cssText = 'aspect-ratio: 1; border: 2px solid #e8e2f5; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; background: #fff; overflow: hidden; padding: 8px;';
      
      const img = document.createElement('img');
      img.src = `../images/designs/${option.file}`;
      img.style.cssText = 'max-width: 100%; max-height: 100%; object-fit: contain;';
      img.alt = option.name;
      div.appendChild(img);
      
      div.title = option.name;
      div.onclick = () => { 
        state.selectedDesign = key; 
        document.querySelectorAll('.design-option').forEach(el => {
          el.classList.remove('selected');
          el.style.borderColor = '#e8e2f5';
          el.style.background = '#fff';
        }); 
        div.classList.add('selected');
        div.style.borderColor = '#3d1a6e';
        div.style.background = '#f5efe0';
        state.selectedElement = 'design';
        drawPreview(); 
      };
      crossSelector.appendChild(div);
    });
  }

  // Generate color tabs
  const colorTabContent = document.getElementById('colorTabContent');
  const colorTabs = document.querySelectorAll('.color-tab');
  colorTabs.forEach(tab => { if (tab.dataset.category !== 'Popular') tab.hidden = true; });
  
  function renderColorsForCategory(categoryName) {
    if (!colorTabContent) return;
    const colors = colorCategories[categoryName];
    if (!colors) return;
    
    const swatchesDiv = document.createElement('div');
    swatchesDiv.className = 'color-swatches';
    
    colors.forEach(color => {
      const isSelected = color.image === currentShirtImageName;
      const borderStyle = (color.name.includes('White') || color.name.includes('Natural') || color.name.includes('Off White') || color.name.includes('Cornsilk')) ? 'border:1px solid #ddd;' : '';
      
      const swatch = document.createElement('div');
      swatch.className = `color-swatch ${isSelected ? 'selected' : ''}`;
      swatch.innerHTML = `
        <div class="color-swatch-circle" style="background:${color.hex};${borderStyle}"></div>
        <div class="color-swatch-name">${color.name}</div>
      `;
      swatch.onclick = () => {
        state.shirtColor = color.hex;
        currentShirtImageName = color.image;
        
        // Update UI
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        
        // Update selected color display
        const preview = document.getElementById('selectedColorPreview');
        const nameEl = document.getElementById('selectedColorName');
        if (preview) preview.style.background = color.hex;
        if (nameEl) nameEl.textContent = color.name;
        
        drawPreview();
      };
      swatchesDiv.appendChild(swatch);
    });
    
    colorTabContent.innerHTML = '';
    colorTabContent.appendChild(swatchesDiv);
  }
  
  // Set up tab click handlers
  colorTabs.forEach(tab => {
    tab.onclick = () => {
      colorTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderColorsForCategory(tab.dataset.category);
    };
  });
  
  // Render initial category (Popular)
  renderColorsForCategory('Popular');

  document.querySelectorAll('#printColors .color-option').forEach(el => {
    el.onclick = () => { 
      state.printColor = el.dataset.color; 
      document.querySelectorAll('#printColors .color-option').forEach(c => c.classList.remove('selected')); 
      el.classList.add('selected'); 
      drawPreview(); 
    };
  });

  document.getElementById('positionSelect').addEventListener('change', (e) => {
    state.position = e.target.value;
    state.designX = null; state.designY = null;
    state.texts.forEach(t => { t.x = null; t.y = null; });
    state.selectedElement = null;
    drawPreview();
  });


  // Quantity and size change listeners
  const quantityInput = document.getElementById('quantityInput');
  if (quantityInput) {
    quantityInput.addEventListener('change', updateCartButton);
    quantityInput.addEventListener('input', updateCartButton);
  }
  
  const sizeSelect = document.getElementById('sizeSelect');
  if (sizeSelect) {
    sizeSelect.addEventListener('change', updateCartButton);
  }

  renderTextControls();

  // Wire up contenteditable preview elements (left panel) to sync with state + inputs + canvas
  const defaultHeadline = document.querySelector('.default-headline');
  const defaultSubtext = document.querySelector('.default-subtext');
  
  if (defaultHeadline) {
    defaultHeadline.addEventListener('input', function() {
      if (state.texts.length >= 1) {
        state.texts[0].text = this.textContent;
        syncTextInputs();
        drawPreview();
      }
    });
  }
  
  if (defaultSubtext) {
    defaultSubtext.addEventListener('input', function() {
      if (state.texts.length >= 2) {
        state.texts[1].text = this.textContent;
        syncTextInputs();
        drawPreview();
      }
    });
  }

  const canvas = document.getElementById('tshirtCanvas');
  if (canvas) {
    canvas.addEventListener('touchstart', handleDragStart, { passive: false });
    canvas.addEventListener('touchmove', handleDragMove, { passive: false });
    canvas.addEventListener('touchend', handleDragEnd);
    canvas.addEventListener('mousedown', handleDragStart);
    canvas.addEventListener('mousemove', handleDragMove);
    canvas.addEventListener('mouseup', handleDragEnd);
    canvas.addEventListener('mouseleave', handleDragEnd);
  }

  // Initial draw - will use fallback until images load
  drawPreview();
}

function buildConfiguredJobRequest() {
  const allocations = Array.from(document.querySelectorAll('#variantAllocations input[data-size]')).map(input => ({
    selections: { size: input.dataset.size }, quantity: Number(input.value || 0)
  })).filter(entry => Number.isInteger(entry.quantity) && entry.quantity > 0);
  if (!allocations.length) throw new Error('Enter a quantity for at least one size.');
  return {
    productId: 'd204cea4-ce22-4bc5-ad04-530f19fb3878',
    variantAllocations: allocations,
    customerConfiguration: editorConfiguration(),
    customerInstructions: (document.getElementById('customerInstructions')?.value || '').trim()
  };
}

// Load design from URL params if present
function loadDesignFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const designParam = params.get('design');
  const colorParam = params.get('color');
  const textParam = params.get('text');
  
  if (designParam && designOptions[designParam]) {
    state.selectedDesign = designParam;
  }
  
  if (textParam) {
    state.texts[0].text = textParam;
  }
  
  renderTextControls();
  drawPreview();
}

document.addEventListener('DOMContentLoaded', init);
