// T-Shirt Configurator JavaScript - Multi-text support

// PNG Design options (replacing SVG crosses)
const designOptions = {
  'cross-modern': { name: 'Modern Cross', file: 'cross-1-isolated.png' },
  'cross-celtic': { name: 'Celtic Cross', file: 'cross-celtic.png' },
  'cross-flame': { name: 'Flame Cross', file: 'cross-flame.png' },
  'cross-wood': { name: 'Rustic Wood Cross', file: 'cross-wood-rustic.png' },
  'crown-thorns': { name: 'Crown of Thorns', file: 'crown-thorns-isolated.png' },
  'dove': { name: 'Peace Dove', file: 'dove-isolated.png' },
  'praying-hands': { name: 'Praying Hands', file: 'praying-hands.png' },
  'heart-cross': { name: 'Heart with Cross', file: 'heart-cross.png' },
  'anchor': { name: 'Anchor Cross', file: 'anchor-cross.png' },
  'lamb': { name: 'Lamb of God', file: 'lamb-god.png' },
  'bible': { name: 'Bible with Cross', file: 'bible-cross.png' },
  'chi-rho': { name: 'Chi Rho Symbol', file: 'chi-rho.png' },
  'three-crosses': { name: 'Three Crosses', file: 'three-crosses.png' },
  'butterfly': { name: 'Butterfly Cross', file: 'butterfly-cross.png' },
  'alpha-omega': { name: 'Alpha & Omega', file: 'alpha-omega.png' },
  'fish': { name: 'Christian Fish', file: 'fish-isolated.png' }
};

// Preload design images
const designImages = {};
let designImagesLoaded = false;

function loadDesignImages() {
  const promises = Object.entries(designOptions).map(([key, option]) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve(); // Resolve even on error to not block
      img.src = `../images/designs/${option.file}`;
      designImages[key] = img;
    });
  });
  
  Promise.all(promises).then(() => {
    designImagesLoaded = true;
    drawPreview(); // Redraw once all images are loaded
  });
}

// Color categories for organized display
const colorCategories = {
  'Popular': [
    { name: 'White', hex: '#FFFFFF', image: 'white.jpg' },
    { name: 'Black', hex: '#1a1a1a', image: 'black.jpg' },
    { name: 'Navy', hex: '#1a237e', image: 'navy.jpg' },
    { name: 'Red', hex: '#c62828', image: 'red.jpg' },
    { name: 'Purple', hex: '#3d1a6e', image: 'purple.jpg' },
    { name: 'Gold', hex: '#c9a227', image: 'gold.jpg' },
    { name: 'Forest Green', hex: '#1b5e20', image: 'forest-green.jpg' },
  ],
  'Neutrals': [
    { name: 'Ash', hex: '#B2BEB5', image: 'ash.jpg' },
    { name: 'Charcoal', hex: '#36454F', image: 'charcoal.jpg' },
    { name: 'Dark Heather', hex: '#4A4A4A', image: 'dark-heather.jpg' },
    { name: 'Graphite Heather', hex: '#5A5A5A', image: 'graphite-heather.jpg' },
    { name: 'Gravel', hex: '#808080', image: 'gravel.jpg' },
    { name: 'Ice Grey', hex: '#E0E0E0', image: 'ice-grey.jpg' },
    { name: 'Natural', hex: '#F5F5DC', image: 'natural.jpg' },
    { name: 'Off White', hex: '#FAF9F6', image: 'off-white.jpg' },
    { name: 'Sport Grey', hex: '#A9A9A9', image: 'sport-grey.jpg' },
    { name: 'Tweed', hex: '#8B8589', image: 'tweed.jpg' },
  ],
  'Blues': [
    { name: 'Carolina Blue', hex: '#7BAFD4', image: 'carolina-blue.jpg' },
    { name: 'Cobalt', hex: '#0047AB', image: 'cobalt.jpg' },
    { name: 'Indigo Blue', hex: '#3F00FF', image: 'indigo-blue.jpg' },
    { name: 'Iris', hex: '#5A4FCF', image: 'iris.jpg' },
    { name: 'Light Blue', hex: '#ADD8E6', image: 'light-blue.jpg' },
    { name: 'Midnight', hex: '#191970', image: 'midnight.jpg' },
    { name: 'Royal', hex: '#4169E1', image: 'royal.jpg' },
    { name: 'Sapphire', hex: '#0F52BA', image: 'sapphire.jpg' },
    { name: 'Sky', hex: '#87CEEB', image: 'sky.jpg' },
    { name: 'Tropical Blue', hex: '#00BFFF', image: 'tropical-blue.jpg' },
    { name: 'Aquatic', hex: '#7FFFD4', image: 'aquatic.jpg' },
    { name: 'Blue Dusk', hex: '#4A6FA5', image: 'blue-dusk.jpg' },
  ],
  'Greens': [
    { name: 'Irish Green', hex: '#00A86B', image: 'irish-green.jpg' },
    { name: 'Lime', hex: '#00FF00', image: 'lime.jpg' },
    { name: 'Mint Green', hex: '#98FF98', image: 'mint-green.jpg' },
    { name: 'Military Green', hex: '#4B5320', image: 'military-green.jpg' },
    { name: 'Turf Green', hex: '#006400', image: 'turf-green.jpg' },
    { name: 'Electric Green', hex: '#00FF00', image: 'electric-green.jpg' },
    { name: 'Fan Dark Green', hex: '#013220', image: 'fan-dark-green.jpg' },
    { name: 'Heather Military Green', hex: '#4B5320', image: 'heather-military-green.jpg' },
    { name: 'Kiwi', hex: '#8EE53F', image: 'kiwi.jpg' },
    { name: 'Safety Green', hex: '#00FF7F', image: 'safety-green.jpg' },
    { name: 'Neon Green', hex: '#39FF14', image: 'neon-green.jpg' },
  ],
  'Reds & Pinks': [
    { name: 'Cardinal', hex: '#C41E3A', image: 'cardinal.jpg' },
    { name: 'Coral Silk', hex: '#F88379', image: 'coral-silk.jpg' },
    { name: 'Dusty Rose', hex: '#DCAE96', image: 'dusty-rose.jpg' },
    { name: 'Garnet', hex: '#733635', image: 'garnet.jpg' },
    { name: 'Heather Red', hex: '#B85450', image: 'heather-red.jpg' },
    { name: 'Heliconia', hex: '#FF69B4', image: 'heliconia.jpg' },
    { name: 'Light Pink', hex: '#FFB6C1', image: 'light-pink.jpg' },
    { name: 'Maroon', hex: '#800000', image: 'maroon.jpg' },
    { name: 'Safety Pink', hex: '#FF69B4', image: 'safety-pink.jpg' },
    { name: 'Azalea', hex: '#F4A6D7', image: 'azalea.jpg' },
    { name: 'Berry', hex: '#8B008B', image: 'berry.jpg' },
  ],
  'Purples': [
    { name: 'Fan Dark Purple', hex: '#301934', image: 'fan-dark-purple.jpg' },
    { name: 'Heather Radiant Orchid', hex: '#B565A7', image: 'heather-radiant-orchid.jpg' },
    { name: 'Lilac', hex: '#C8A2C8', image: 'lilac.jpg' },
    { name: 'Violet', hex: '#8F00FF', image: 'violet.jpg' },
    { name: 'Blackberry', hex: '#4A0E4E', image: 'blackberry.jpg' },
  ],
  'Yellows & Oranges': [
    { name: 'Daisy', hex: '#FFE4B5', image: 'daisy.jpg' },
    { name: 'Old Gold', hex: '#CFB53B', image: 'old-gold.jpg' },
    { name: 'Orange', hex: '#FFA500', image: 'orange.jpg' },
    { name: 'Safety Orange', hex: '#FF6700', image: 'safety-orange.jpg' },
    { name: 'Sunset', hex: '#FD5E53', image: 'sunset.jpg' },
    { name: 'Tangerine', hex: '#F28500', image: 'tangerine.jpg' },
    { name: 'Tennessee Orange', hex: '#FF8200', image: 'tennessee-orange.jpg' },
    { name: 'Texas Orange', hex: '#BF5700', image: 'texas-orange.jpg' },
    { name: 'Yellow Haze', hex: '#FFFF00', image: 'yellow-haze.jpg' },
    { name: 'Antique Orange', hex: '#CD853F', image: 'antique-orange.jpg' },
  ],
  'Antique & Heather': [
    { name: 'Antique Cherry Red', hex: '#8B3A3A', image: 'antique-cherry-red.jpg' },
    { name: 'Antique Irish Green', hex: '#4A7C59', image: 'antique-irish-green.jpg' },
    { name: 'Antique Jade Dome', hex: '#5F9EA0', image: 'antique-jade-dome.jpg' },
    { name: 'Antique Orange', hex: '#CD853F', image: 'antique-orange.jpg' },
    { name: 'Antique Sapphire', hex: '#2F4F4F', image: 'antique-sapphire.jpg' },
    { name: 'Heather Navy', hex: '#2C3E50', image: 'heather-navy.jpg' },
    { name: 'Heather Sapphire', hex: '#3A5F8A', image: 'heather-sapphire.jpg' },
  ],
  'Browns & Earth': [
    { name: 'Brown Savana', hex: '#8B4513', image: 'brown-savana.jpg' },
    { name: 'Cornsilk', hex: '#FFF8DC', image: 'cornsilk.jpg' },
    { name: 'Dark Chocolate', hex: '#3D2817', image: 'dark-chocolate.jpg' },
    { name: 'Prairie Dust', hex: '#D2B48C', image: 'prairie-dust.jpg' },
    { name: 'Russet', hex: '#80461B', image: 'russet.jpg' },
    { name: 'Sand', hex: '#C2B280', image: 'sand.jpg' },
  ]
};

// T-shirt images loaded dynamically based on selection
const tshirtImages = {};
let imagesLoaded = false;
let currentShirtImage = null;

function loadShirtImage(imageName) {
  if (tshirtImages[imageName]) {
    currentShirtImage = tshirtImages[imageName];
    imagesLoaded = true;
    drawPreview();
    return;
  }
  
  const img = new Image();
  img.onload = () => {
    tshirtImages[imageName] = img;
    currentShirtImage = img;
    imagesLoaded = true;
    drawPreview();
  };
  img.onerror = () => {
    // Fallback to color fill if image fails to load
    currentShirtImage = null;
    imagesLoaded = true;
    drawPreview();
  };
  img.src = `../images/tshirts/${imageName}`;
}

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

let nextTextId = 2;

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
  if (!state.selectedElement) return;
  const { cx, cy, scale } = getDefaultPositions();
  
  if (state.selectedElement === 'design') {
    if (!state.designX) { state.designX = cx; state.designY = cy; }
    switch(e.key) {
      case 'ArrowUp': state.designY -= MOVE_STEP; e.preventDefault(); break;
      case 'ArrowDown': state.designY += MOVE_STEP; e.preventDefault(); break;
      case 'ArrowLeft': state.designX -= MOVE_STEP; e.preventDefault(); break;
      case 'ArrowRight': state.designX += MOVE_STEP; e.preventDefault(); break;
    }
  } else {
    const textObj = state.texts.find(t => t.id === state.selectedElement);
    if (textObj) {
      if (!textObj.x) { textObj.x = cx; textObj.y = cy + scale/2 + 25; }
      switch(e.key) {
        case 'ArrowUp': textObj.y -= MOVE_STEP; e.preventDefault(); break;
        case 'ArrowDown': textObj.y += MOVE_STEP; e.preventDefault(); break;
        case 'ArrowLeft': textObj.x -= MOVE_STEP; e.preventDefault(); break;
        case 'ArrowRight': textObj.x += MOVE_STEP; e.preventDefault(); break;
      }
    }
  }
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
  const coords = getCanvasCoords(e);
  const { cx, cy, scale } = getDefaultPositions();
  
  for (let i = state.texts.length - 1; i >= 0; i--) {
    const textObj = state.texts[i];
    if (!textObj.text) continue;
    const textX = textObj.x || cx;
    const textY = textObj.y || (cy + scale/2 + 25);
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
  
  const designX = state.designX || cx;
  const designY = state.designY || cy;
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
    state.designX = coords.x + dragOffsetX;
    state.designY = coords.y + dragOffsetY;
  } else {
    const textObj = state.texts.find(t => t.id === state.selectedElement);
    if (textObj) { textObj.x = coords.x + dragOffsetX; textObj.y = coords.y + dragOffsetY; }
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
function addTextInstance() {
  const { cx, cy, scale } = getDefaultPositions();
  state.texts.push({
    id: nextTextId++,
    text: '',
    x: cx,
    y: cy + scale/2 + 40 + state.texts.length * 25,
    font: 'Cinzel',
    size: 16,
    color: state.printColor
  });
  renderTextControls();
}

function removeTextInstance(id) {
  if (state.texts.length <= 1) return;
  state.texts = state.texts.filter(t => t.id !== id);
  if (state.selectedElement === id) state.selectedElement = null;
  renderTextControls();
  drawPreview();
}

function updateText(id, value) { const t = state.texts.find(x => x.id === id); if (t) { t.text = value; drawPreview(); } }
function updateTextFont(id, font) { const t = state.texts.find(x => x.id === id); if (t) { t.font = font; drawPreview(); } }
function updateTextColor(id, color) { const t = state.texts.find(x => x.id === id); if (t) { t.color = color; drawPreview(); } }
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
  container.innerHTML = state.texts.map((t, i) => `
    <div class="text-instance ${state.selectedElement === t.id ? 'selected' : ''}" data-id="${t.id}">
      <div class="text-instance-header">
        <label>Text ${i + 1}</label>
        ${state.texts.length > 1 ? `<button onclick="removeTextInstance(${t.id})" class="remove-text-btn">&times;</button>` : ''}
      </div>
      <input type="text" class="church-text-input ${state.selectedElement === t.id ? 'active' : ''}" placeholder="Enter text..." value="${t.text}" oninput="updateText(${t.id}, this.value)" onfocus="selectText(${t.id})"/>
      <div class="text-controls-row">
        <select onchange="updateTextFont(${t.id}, this.value)" class="font-select-small">
          <option value="Cinzel" ${t.font === 'Cinzel' ? 'selected' : ''}>Cinzel</option>
          <option value="Inter" ${t.font === 'Inter' ? 'selected' : ''}>Inter</option>
          <option value="Georgia" ${t.font === 'Georgia' ? 'selected' : ''}>Georgia</option>
          <option value="Brush Script MT" ${t.font === 'Brush Script MT' ? 'selected' : ''}>Script</option>
          <option value="Impact" ${t.font === 'Impact' ? 'selected' : ''}>Impact</option>
          <option value="Playfair Display" ${t.font === 'Playfair Display' ? 'selected' : ''}>Playfair</option>
          <option value="Oswald" ${t.font === 'Oswald' ? 'selected' : ''}>Oswald</option>
          <option value="Lobster" ${t.font === 'Lobster' ? 'selected' : ''}>Lobster</option>
        </select>
        <input type="color" value="${t.color}" onchange="updateTextColor(${t.id}, this.value)" class="color-picker-small" title="Text color">
      </div>
      <div class="size-control">
        <label>Size: <span id="size-label-${t.id}">${t.size}px</span></label>
        <input type="range" min="10" max="48" value="${t.size}" oninput="updateTextSize(${t.id}, this.value)" class="size-slider">
      </div>
      <div class="arch-control">
        <label>Arch: <span id="arch-label-${t.id}">${t.arch || 0}°</span></label>
        <input type="range" min="-30" max="30" value="${t.arch || 0}" oninput="updateTextArch(${t.id}, this.value)" class="arch-slider" title="Curve text up or down">
      </div>
    </div>
  `).join('');
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

// Draw arched/curved text
// arch: positive = upward curve, negative = downward curve, 0 = straight
function drawArchedText(ctx, text, x, y, size, font, color, arch) {
  ctx.save();
  ctx.font = '600 ' + size + 'px "' + font + '", sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  const totalWidth = ctx.measureText(text).width;
  const radius = (totalWidth / 2) / Math.sin(Math.abs(arch) * Math.PI / 180) || totalWidth * 2;
  const angleStep = (Math.abs(arch) * 2 * Math.PI / 180) / text.length;
  const startAngle = -Math.abs(arch) * Math.PI / 180;
  
  ctx.translate(x, y);
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const charWidth = ctx.measureText(char).width;
    const angle = startAngle + (i + 0.5) * angleStep;
    
    ctx.save();
    if (arch > 0) {
      // Upward arch
      ctx.rotate(angle);
      ctx.fillText(char, 0, -radius);
    } else if (arch < 0) {
      // Downward arch
      ctx.rotate(-angle);
      ctx.fillText(char, 0, radius);
    }
    ctx.restore();
    
    // Move to next character position
    ctx.rotate(angleStep);
  }
  
  ctx.restore();
}

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (file) {
    document.getElementById('uploadedFileName').textContent = 'Uploaded: ' + file.name;
    const reader = new FileReader();
    reader.onload = (ev) => { 
      const img = new Image(); 
      img.onload = () => { state.uploadedImage = img; drawPreview(); }; 
      img.src = ev.target.result; 
    };
    reader.readAsDataURL(file);
  }
}

// Drawing functions - Updated to fill canvas better
function drawTShirt(ctx, canvasWidth, canvasHeight) {
  if (currentShirtImage && currentShirtImage.complete && currentShirtImage.naturalWidth > 0) {
    // Calculate dimensions to fill the canvas while maintaining aspect ratio
    const imgAspect = currentShirtImage.width / currentShirtImage.height;
    const canvasAspect = canvasWidth / canvasHeight;
    
    let drawWidth, drawHeight, drawX, drawY;
    
    // Zoom in to fill more of the canvas (crop the image slightly to remove excess margins)
    // Use 108% zoom to crop out some empty space without cutting off the shirt
    const zoomFactor = 1.08;
    
    if (imgAspect > canvasAspect) {
      // Image is wider relative to canvas
      drawHeight = canvasHeight * zoomFactor;
      drawWidth = drawHeight * imgAspect;
      drawX = (canvasWidth - drawWidth) / 2;
      drawY = (canvasHeight - drawHeight) / 2;
    } else {
      // Image is taller relative to canvas - shift up slightly to show more of the shirt body
      drawWidth = canvasWidth * zoomFactor;
      drawHeight = drawWidth / imgAspect;
      drawX = (canvasWidth - drawWidth) / 2;
      drawY = (canvasHeight - drawHeight) / 2 - (canvasHeight * 0.02); // Shift up 2%
    }
    
    ctx.drawImage(currentShirtImage, drawX, drawY, drawWidth, drawHeight);
  } else {
    // Fallback - draw simple t-shirt shape with selected color
    const x = canvasWidth * 0.05;
    const y = canvasHeight * 0.02;
    const w = canvasWidth * 0.9;
    const h = canvasHeight * 0.96;
    const color = state.shirtColor;
    
    ctx.fillStyle = color;
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 2;
    
    // Body
    ctx.beginPath();
    ctx.moveTo(x + w*0.25, y + h*0.15);
    ctx.lineTo(x + w*0.75, y + h*0.15);
    ctx.lineTo(x + w*0.85, y + h*0.25);
    ctx.lineTo(x + w*0.75, y + h*0.35);
    ctx.lineTo(x + w*0.75, y + h*0.90);
    ctx.quadraticCurveTo(x + w*0.50, y + h*0.93, x + w*0.25, y + h*0.90);
    ctx.lineTo(x + w*0.25, y + h*0.35);
    ctx.lineTo(x + w*0.15, y + h*0.25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Collar
    ctx.beginPath();
    ctx.moveTo(x + w*0.35, y + h*0.15);
    ctx.quadraticCurveTo(x + w*0.50, y + h*0.22, x + w*0.65, y + h*0.15);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.stroke();
    
    // Sleeves
    ctx.fillStyle = color;
    ctx.strokeStyle = '#ddd';
    ctx.beginPath();
    ctx.moveTo(x + w*0.15, y + h*0.25);
    ctx.lineTo(x + w*0.05, y + h*0.35);
    ctx.lineTo(x + w*0.15, y + h*0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(x + w*0.85, y + h*0.25);
    ctx.lineTo(x + w*0.95, y + h*0.35);
    ctx.lineTo(x + w*0.85, y + h*0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawCross(ctx, cx, cy, size, color, style) {
  const s = size/100;
  ctx.save();
  if (style === 'classic') {
    ctx.strokeStyle = color; ctx.lineWidth = 4*s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, 30*s, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy-20*s); ctx.lineTo(cx, cy+20*s); ctx.moveTo(cx-20*s, cy); ctx.lineTo(cx+20*s, cy); ctx.stroke();
  } else if (style === 'celtic') {
    ctx.strokeStyle = color; ctx.lineWidth = 3*s;
    ctx.beginPath(); ctx.arc(cx, cy, 30*s, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 12*s, 0, Math.PI*2); ctx.stroke();
    ctx.lineWidth = 4*s;
    ctx.beginPath(); ctx.moveTo(cx, cy-25*s); ctx.lineTo(cx, cy+25*s); ctx.moveTo(cx-25*s, cy); ctx.lineTo(cx+25*s, cy); ctx.stroke();
  } else if (style === 'ornate') {
    ctx.fillStyle = color + '20'; ctx.beginPath(); ctx.arc(cx, cy, 35*s, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 3*s; ctx.beginPath(); ctx.arc(cx, cy, 35*s, 0, Math.PI*2); ctx.stroke();
    ctx.lineWidth = 4*s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy-22*s); ctx.lineTo(cx, cy+22*s); ctx.moveTo(cx-22*s, cy); ctx.lineTo(cx+22*s, cy); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 6*s, 0, Math.PI*2); ctx.fillStyle = color; ctx.fill();
  } else if (style === 'flame') {
    ctx.strokeStyle = color; ctx.lineWidth = 2*s; ctx.beginPath(); ctx.arc(cx, cy, 30*s, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = '#ff6b35'; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(cx, cy-18*s); ctx.quadraticCurveTo(cx-8*s, cy-5*s, cx-8*s, cy+8*s); ctx.quadraticCurveTo(cx-8*s, cy+18*s, cx, cy+22*s); ctx.quadraticCurveTo(cx+8*s, cy+18*s, cx+8*s, cy+8*s); ctx.quadraticCurveTo(cx+8*s, cy-5*s, cx, cy-18*s); ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2*s;
    ctx.beginPath(); ctx.moveTo(cx, cy-12*s); ctx.lineTo(cx, cy+12*s); ctx.stroke();
  } else if (style === 'royal') {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy, 32*s, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 3*s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy-20*s); ctx.lineTo(cx, cy+20*s); ctx.moveTo(cx-20*s, cy); ctx.lineTo(cx+20*s, cy); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 8*s, 0, Math.PI*2); ctx.fillStyle = '#c9a227'; ctx.fill();
  } else if (style === 'emerald') {
    ctx.strokeStyle = color; ctx.lineWidth = 2*s; ctx.beginPath(); ctx.arc(cx, cy, 30*s, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = '#4caf50';
    ctx.beginPath(); ctx.moveTo(cx, cy-20*s); ctx.quadraticCurveTo(cx-10*s, cy-8*s, cx-10*s, cy+5*s); ctx.quadraticCurveTo(cx-10*s, cy+18*s, cx, cy+22*s); ctx.quadraticCurveTo(cx+10*s, cy+18*s, cx+10*s, cy+5*s); ctx.quadraticCurveTo(cx+10*s, cy-8*s, cx, cy-20*s); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 3*s;
    ctx.beginPath(); ctx.moveTo(cx, cy-15*s); ctx.lineTo(cx, cy+15*s); ctx.moveTo(cx-15*s, cy); ctx.lineTo(cx+15*s, cy); ctx.stroke();
  } else if (style === 'silver') {
    const grad = ctx.createLinearGradient(cx-30*s, cy-30*s, cx+30*s, cy+30*s);
    grad.addColorStop(0, '#e0e0e0'); grad.addColorStop(0.5, '#909090'); grad.addColorStop(1, '#e0e0e0');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, 32*s, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#606060'; ctx.lineWidth = 2*s; ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 4*s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy-22*s); ctx.lineTo(cx, cy+22*s); ctx.moveTo(cx-22*s, cy); ctx.lineTo(cx+22*s, cy); ctx.stroke();
  } else if (style === 'heart') {
    ctx.strokeStyle = color; ctx.lineWidth = 2*s; ctx.beginPath(); ctx.arc(cx, cy, 30*s, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = '#e91e63';
    ctx.beginPath(); ctx.moveTo(cx, cy-8*s); ctx.bezierCurveTo(cx-15*s, cy-25*s, cx-30*s, cy-15*s, cx-30*s, cy); ctx.bezierCurveTo(cx-30*s, cy+15*s, cx, cy+28*s, cx, cy+28*s); ctx.bezierCurveTo(cx, cy+28*s, cx+30*s, cy+15*s, cx+30*s, cy); ctx.bezierCurveTo(cx+30*s, cy-15*s, cx+15*s, cy-25*s, cx, cy-8*s); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2*s; ctx.beginPath(); ctx.moveTo(cx, cy-5*s); ctx.lineTo(cx, cy+15*s); ctx.stroke();
  } else if (style === 'dove') {
    ctx.fillStyle = '#e3f2fd'; ctx.beginPath(); ctx.arc(cx, cy, 32*s, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2*s; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = color; ctx.lineWidth = 1.5*s;
    ctx.beginPath(); ctx.ellipse(cx-5*s, cy, 18*s, 10*s, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 2*s; ctx.beginPath(); ctx.moveTo(cx, cy-18*s); ctx.lineTo(cx, cy+18*s); ctx.stroke();
  } else if (style === 'ichthys') {
    ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 2*s; ctx.beginPath(); ctx.arc(cx, cy, 30*s, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 2.5*s;
    ctx.beginPath(); ctx.moveTo(cx-18*s, cy); ctx.quadraticCurveTo(cx-5*s, cy-15*s, cx+15*s, cy); ctx.quadraticCurveTo(cx-5*s, cy+15*s, cx-18*s, cy); ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx+10*s, cy-5*s, 3*s, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

function drawPreview() {
  const canvas = document.getElementById('tshirtCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Updated to use canvas dimensions for better fill
  drawTShirt(ctx, canvas.width, canvas.height);

  const { cx, cy, scale } = getDefaultPositions();
  const designX = state.designX || cx;
  const designY = state.designY || cy;

  if (state.selectedElement === 'design' && !state.uploadedImage) {
    ctx.save();
    ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ctx.strokeRect(designX - scale/2 - 5, designY - scale/2 - 5, scale + 10, scale + 10);
    ctx.restore();
  }

  if (state.uploadedImage) {
    // Uploaded images can stretch to fill the area
    const dw = scale * state.uploadedImageScale;
    const dh = scale * state.uploadedImageScale;
    ctx.drawImage(state.uploadedImage, designX - dw/2, designY - dh/2, dw, dh);
  } else if (state.selectedDesign && designImages[state.selectedDesign]) {
    const designImg = designImages[state.selectedDesign];
    if (designImg && designImg.complete && designImg.naturalWidth > 0) {
      const aspect = designImg.width / designImg.height;
      const baseScale = scale * state.designScale;
      const dw = baseScale * (aspect > 1 ? 1 : aspect);
      const dh = baseScale / (aspect > 1 ? aspect : 1);
      ctx.drawImage(designImg, designX - dw/2, designY - dh/2, dw, dh);
    }
  }
  
  state.texts.forEach((textObj, index) => {
    if (!textObj.text) return;
    const x = textObj.x || cx;
    // Position text closer to design: design is at cy, text starts just below it
    const y = textObj.y || (cy + scale/2 + 10 + index * 22);
    
    if (state.selectedElement === textObj.id) {
      ctx.save();
      ctx.strokeStyle = '#3d1a6e'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
      ctx.font = textObj.size + 'px ' + textObj.font;
      const metrics = ctx.measureText(textObj.text);
      ctx.strokeRect(x - metrics.width/2 - 8, y - textObj.size/2 - 8, metrics.width + 16, textObj.size + 16);
      ctx.restore();
    }
    
    ctx.fillStyle = textObj.color || state.printColor;
    
    // Draw text with arch/curve support
    if (textObj.arch && textObj.arch !== 0) {
      drawArchedText(ctx, textObj.text, x, y, textObj.size, textObj.font, textObj.color, textObj.arch);
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Use bolder font weight and ensure crisp rendering
      ctx.font = '600 ' + textObj.size + 'px "' + textObj.font + '", sans-serif';
      ctx.fillText(textObj.text, x, y);
    }
  });
  
  // Update cart button with current design
  updateCartButton();
}

// Init
function init() {
  // Load initial shirt image
  loadShirtImage(currentShirtImageName);
  
  // Load design images
  loadDesignImages();
  
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
        currentSelectedColorName = color.name;
        
        // Update UI
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        
        // Update selected color display
        const preview = document.getElementById('selectedColorPreview');
        const nameEl = document.getElementById('selectedColorName');
        if (preview) preview.style.background = color.hex;
        if (nameEl) nameEl.textContent = color.name;
        
        loadShirtImage(color.image);
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
    state.crossX = null; state.crossY = null;
    state.texts.forEach(t => { t.x = null; t.y = null; });
    state.selectedElement = null;
    drawPreview();
  });

  const addTextBtn = document.getElementById('addTextBtn');
  if (addTextBtn) addTextBtn.addEventListener('click', addTextInstance);

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

// Snipcart integration - Update cart button with current design
function updateCartButton() {
  const btn = document.querySelector('.snipcart-add-item');
  if (!btn) return;
  
  // Get current design info
  const designName = state.selectedDesign ? designOptions[state.selectedDesign]?.name : 'Custom Upload';
  const colorName = document.getElementById('selectedColorName')?.textContent || 'Antique Cherry Red';
  const position = document.getElementById('positionSelect')?.value || 'center';
  const size = document.getElementById('sizeSelect')?.value || 'L';
  const quantity = parseInt(document.getElementById('quantityInput')?.value || '25');
  const texts = state.texts.filter(t => t.text).map(t => t.text).join(', ') || 'None';
  
  // Determine price based on quantity
  let price = 15.00;
  let tier = '25-49';
  if (quantity <= 5) { price = 25.00; tier = '1-5'; }
  else if (quantity <= 10) { price = 22.00; tier = '6-10'; }
  else if (quantity <= 24) { price = 18.00; tier = '11-24'; }
  else if (quantity <= 49) { price = 15.00; tier = '25-49'; }
  else if (quantity <= 99) { price = 13.00; tier = '50-99'; }
  else { price = 11.00; tier = '100+'; }
  
  // Update data attributes
  btn.setAttribute('data-item-price', price.toFixed(2));
  btn.setAttribute('data-item-quantity', quantity);
  btn.setAttribute('data-item-custom1-value', texts);
  btn.setAttribute('data-item-custom2-value', designName);
  btn.setAttribute('data-item-custom3-value', colorName);
  btn.setAttribute('data-item-custom4-value', position);
  btn.setAttribute('data-item-custom5-value', state.uploadedImage ? 'Custom Upload' : 'Standard Design');
  btn.setAttribute('data-item-custom6-value', size);
  btn.setAttribute('data-item-custom7-value', tier);
  
  // Update button text
  btn.textContent = `Add to Cart - $${price.toFixed(2)} each`;
  
  // Generate design preview image
  const canvas = document.getElementById('tshirtCanvas');
  if (canvas) {
    try {
      const previewUrl = canvas.toDataURL('image/png');
      btn.setAttribute('data-item-image', previewUrl);
    } catch (e) {
      console.log('Could not generate preview image');
    }
  }
}

// Save current design to localStorage
function saveCurrentDesign() {
  const canvas = document.getElementById('tshirtCanvas');
  let previewUrl = null;
  
  try {
    previewUrl = canvas.toDataURL('image/png');
  } catch (e) {
    console.log('Could not generate preview');
  }
  
  const designName = prompt('Enter a name for this design:');
  if (!designName) return;
  
  const design = {
    name: designName,
    date: new Date().toISOString(),
    design: state.selectedDesign ? designOptions[state.selectedDesign]?.name : 'Custom Upload',
    color: document.getElementById('selectedColorName')?.textContent || 'Antique Cherry Red',
    text: state.texts.filter(t => t.text).map(t => t.text).join(', ') || 'None',
    position: document.getElementById('positionSelect')?.value || 'center',
    preview: previewUrl,
    state: JSON.parse(JSON.stringify(state))
  };
  
  const savedDesigns = JSON.parse(localStorage.getItem('divinePrinting_savedDesigns') || '[]');
  savedDesigns.push(design);
  localStorage.setItem('divinePrinting_savedDesigns', JSON.stringify(savedDesigns));
  
  alert('Design saved! View it in My Account → Saved Designs');
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

// Generate high-resolution printable design (300 DPI, 12" x 12" = 3600x3600px)
function generatePrintableDesign() {
  const canvas = document.createElement('canvas');
  canvas.width = 3600;
  canvas.height = 3600;
  const ctx = canvas.getContext('2d');
  
  // Transparent background for print
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  const { cx, cy, scale } = getDefaultPositions();
  const designX = state.designX || cx;
  const designY = state.designY || cy;
  
  // Scale up for print resolution
  const printScale = scale * 9;
  
  if (state.uploadedImage) {
    const dw = printScale * state.uploadedImageScale;
    const dh = printScale * state.uploadedImageScale;
    ctx.drawImage(state.uploadedImage, designX * 9 - dw/2, designY * 9 - dh/2, dw, dh);
  } else if (state.selectedDesign && designImages[state.selectedDesign]) {
    const designImg = designImages[state.selectedDesign];
    if (designImg && designImg.complete && designImg.naturalWidth > 0) {
      const aspect = designImg.width / designImg.height;
      const baseScale = printScale * state.designScale;
      const dw = baseScale * (aspect > 1 ? 1 : aspect);
      const dh = baseScale / (aspect > 1 ? aspect : 1);
      ctx.drawImage(designImg, designX * 9 - dw/2, designY * 9 - dh/2, dw, dh);
    }
  }
  
  // Add text at high resolution
  state.texts.forEach((textObj, index) => {
    if (!textObj.text) return;
    const x = (textObj.x || cx) * 9;
    const y = (textObj.y || (cy + scale/2 + 25 + index * 25)) * 9;
    
    ctx.fillStyle = textObj.color || state.printColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = (textObj.size * 9) + 'px ' + textObj.font;
    ctx.fillText(textObj.text, x, y);
  });
  
  return canvas.toDataURL('image/png');
}

// Save printable design when order is placed
async function saveOrderDesign(orderToken) {
  try {
    const printableDataUrl = generatePrintableDesign();
    const previewDataUrl = document.getElementById('tshirtCanvas').toDataURL('image/png');
    
    const orderData = {
      orderToken: orderToken,
      previewImage: previewDataUrl,
      printableImage: printableDataUrl,
      designInfo: {
        design: state.selectedDesign ? designOptions[state.selectedDesign]?.name : 'Custom Upload',
        color: document.getElementById('selectedColorName')?.textContent || 'Antique Cherry Red',
        texts: state.texts.filter(t => t.text).map(t => t.text).join(', ') || 'None',
        position: document.getElementById('positionSelect')?.value || 'center',
        size: document.getElementById('sizeSelect')?.value || 'L',
        quantity: document.getElementById('quantityInput')?.value || '25'
      },
      timestamp: new Date().toISOString()
    };
    
    // Store in localStorage
    const pendingOrders = JSON.parse(localStorage.getItem('divinePrinting_pendingOrders') || '[]');
    pendingOrders.push(orderData);
    localStorage.setItem('divinePrinting_pendingOrders', JSON.stringify(pendingOrders));
    
    console.log('Design saved for order:', orderToken);
    return orderData;
  } catch (e) {
    console.error('Error saving design:', e);
    return null;
  }
}

document.addEventListener('DOMContentLoaded', init);

// Listen for Snipcart order completion
document.addEventListener('snipcart.ready', function() {
  Snipcart.events.on('order.completed', function(order) {
    console.log('Order completed:', order.token);
    saveOrderDesign(order.token);
  });
});
