// T-Shirt Configurator JavaScript

const crossSVGs = {
  classic: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="none" stroke="#c9a227" stroke-width="3"/><path d="M50 25v50M25 50h50" stroke="#3d1a6e" stroke-width="6" stroke-linecap="round"/></svg>',
  celtic: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="none" stroke="#1a237e" stroke-width="3"/><circle cx="50" cy="50" r="15" fill="none" stroke="#c9a227" stroke-width="3"/><path d="M50 15v70M15 50h70" stroke="#c62828" stroke-width="5" stroke-linecap="round"/></svg>',
  ornate: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="38" fill="#f5efe0" stroke="#c9a227" stroke-width="2"/><path d="M50 20v60M20 50h60" stroke="#3d1a6e" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="50" r="8" fill="#c9a227"/></svg>',
  flame: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="none" stroke="#c62828" stroke-width="3"/><path d="M50 20c-5 15-10 25-10 35 0 12 5 20 10 20s10-8 10-20c0-10-5-20-10-35z" fill="#ff6b35" opacity="0.9"/><path d="M50 30v45M30 50h40" stroke="#c62828" stroke-width="4" stroke-linecap="round"/></svg>',
  royal: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="#3d1a6e"/><path d="M50 22v56M22 50h56" stroke="#c9a227" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="50" r="10" fill="#c9a227"/></svg>',
  emerald: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="none" stroke="#1b5e20" stroke-width="3"/><path d="M50 18c-8 12-12 22-12 32 0 15 5 25 12 25s12-10 12-25c0-10-4-20-12-32z" fill="#4caf50"/><path d="M50 25v50M25 50h50" stroke="#1b5e20" stroke-width="4" stroke-linecap="round"/></svg>',
  silver: '<svg viewBox="0 0 100 100"><defs><linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#e0e0e0"/><stop offset="50%" stop-color="#909090"/><stop offset="100%" stop-color="#e0e0e0"/></linearGradient></defs><circle cx="50" cy="50" r="35" fill="url(#g1)" stroke="#606060" stroke-width="2"/><path d="M50 20v60M20 50h60" stroke="#3d1a6e" stroke-width="5" stroke-linecap="round"/></svg>',
  heart: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="none" stroke="#c62828" stroke-width="3"/><path d="M50 35c-10-10-25-5-25 10 0 15 25 30 25 30s25-15 25-30c0-15-15-20-25-10z" fill="#e91e63"/><path d="M50 30v40M30 50h40" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>',
  dove: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="#e3f2fd" stroke="#1a237e" stroke-width="2"/><path d="M30 50c10-5 15-10 20-10s15 5 20 10c-5 8-10 15-20 15s-15-7-20-15z" fill="#fff" stroke="#1a237e" stroke-width="2"/><path d="M50 25v50M25 50h50" stroke="#1a237e" stroke-width="3" stroke-linecap="round"/></svg>',
  ichthys: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="none" stroke="#c9a227" stroke-width="3"/><path d="M30 50c15-15 30-10 35 0-5 10-20 15-35 0z" fill="none" stroke="#3d1a6e" stroke-width="3"/><circle cx="58" cy="45" r="3" fill="#3d1a6e"/><path d="M50 25v50M25 50h50" stroke="#3d1a6e" stroke-width="3" stroke-linecap="round" opacity="0.3"/></svg>'
};

const crossNames = { classic: 'Classic', celtic: 'Celtic', ornate: 'Ornate', flame: 'Flame', royal: 'Royal', emerald: 'Emerald', silver: 'Silver', heart: 'Heart', dove: 'Dove', ichthys: 'Ichthys' };

let state = { text: '', cross: 'classic', shirtColor: '#FFFFFF', printColor: '#1a1a1a', position: 'center', font: 'Cinzel', uploadedImage: null, textX: null, textY: null, crossX: null, crossY: null, selectedElement: null };

// Arrow key movement
const MOVE_STEP = 2;
document.addEventListener('keydown', (e) => {
  if (!state.selectedElement) return;
  
  const { cx, cy, scale } = getDefaultPositions();
  
  if (state.selectedElement === 'text') {
    if (!state.textX) {
      state.textX = cx;
      state.textY = cy + scale/2 + (state.position === 'back' ? 40 : 25);
    }
    switch(e.key) {
      case 'ArrowUp': state.textY -= MOVE_STEP; e.preventDefault(); break;
      case 'ArrowDown': state.textY += MOVE_STEP; e.preventDefault(); break;
      case 'ArrowLeft': state.textX -= MOVE_STEP; e.preventDefault(); break;
      case 'ArrowRight': state.textX += MOVE_STEP; e.preventDefault(); break;
    }
  } else if (state.selectedElement === 'cross') {
    if (!state.crossX) {
      state.crossX = cx;
      state.crossY = cy;
    }
    switch(e.key) {
      case 'ArrowUp': state.crossY -= MOVE_STEP; e.preventDefault(); break;
      case 'ArrowDown': state.crossY += MOVE_STEP; e.preventDefault(); break;
      case 'ArrowLeft': state.crossX -= MOVE_STEP; e.preventDefault(); break;
      case 'ArrowRight': state.crossX += MOVE_STEP; e.preventDefault(); break;
    }
  }
  drawPreview();
});

// Touch/drag support for mobile
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOffsetX = 0;
let dragOffsetY = 0;

function getCanvasCoordinates(e) {
  const canvas = document.getElementById('tshirtCanvas');
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: (clientY - rect.top) * (canvas.height / rect.height)
  };
}

function getDefaultPositions() {
  let cx, cy, scale;
  if (state.position === 'center') { cx = 200; cy = 110; scale = 70; }
  else if (state.position === 'left') { cx = 140; cy = 100; scale = 50; }
  else { cx = 200; cy = 180; scale = 100; }
  return { cx, cy, scale };
}

function handleDragStart(e) {
  const coords = getCanvasCoordinates(e);
  const { cx, cy, scale } = getDefaultPositions();
  
  // Check if clicking/touching near text first
  const textX = state.textX || cx;
  const textY = state.textY || (cy + scale/2 + (state.position === 'back' ? 40 : 25));
  const textDist = Math.sqrt(Math.pow(coords.x - textX, 2) + Math.pow(coords.y - textY, 2));
  
  // Check if clicking/touching near cross/icon
  const crossX = state.crossX || cx;
  const crossY = state.crossY || cy;
  const crossDist = Math.sqrt(Math.pow(coords.x - crossX, 2) + Math.pow(coords.y - crossY, 2));
  
  if (textDist < 60 && state.text) {
    isDragging = true;
    state.selectedElement = 'text';
    dragOffsetX = textX - coords.x;
    dragOffsetY = textY - coords.y;
    document.getElementById('positionHint').textContent = 'Dragging text...';
    e.preventDefault();
    drawPreview();
  } else if (crossDist < 50) {
    isDragging = true;
    state.selectedElement = 'cross';
    dragOffsetX = crossX - coords.x;
    dragOffsetY = crossY - coords.y;
    document.getElementById('positionHint').textContent = 'Dragging icon...';
    e.preventDefault();
    drawPreview();
  }
}

function handleDragMove(e) {
  if (!isDragging) return;
  
  const coords = getCanvasCoordinates(e);
  if (state.selectedElement === 'text') {
    state.textX = coords.x + dragOffsetX;
    state.textY = coords.y + dragOffsetY;
  } else if (state.selectedElement === 'cross') {
    state.crossX = coords.x + dragOffsetX;
    state.crossY = coords.y + dragOffsetY;
  }
  e.preventDefault();
  drawPreview();
}

function handleDragEnd(e) {
  if (isDragging) {
    isDragging = false;
    const elementName = state.selectedElement === 'text' ? 'Text' : 'Icon';
    document.getElementById('positionHint').textContent = elementName + ' positioned - drag to move or use arrow keys';
    drawPreview();
  }
}

// Add touch events for mobile
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

function init() {
  const crossSelector = document.getElementById('crossSelector');
  Object.keys(crossSVGs).forEach(key => {
    const div = document.createElement('div');
    div.className = 'cross-option' + (key === state.cross ? ' selected' : '');
    div.innerHTML = crossSVGs[key];
    div.title = crossNames[key];
    div.onclick = () => { 
      state.cross = key; 
      document.querySelectorAll('.cross-option').forEach(el => el.classList.remove('selected')); 
      div.classList.add('selected'); 
      drawPreview(); 
    };
    crossSelector.appendChild(div);
  });

  document.querySelectorAll('#shirtColors .color-option').forEach(el => {
    el.onclick = () => { state.shirtColor = el.dataset.color; document.querySelectorAll('#shirtColors .color-option').forEach(c => c.classList.remove('selected')); el.classList.add('selected'); drawPreview(); };
  });

  document.querySelectorAll('#printColors .color-option').forEach(el => {
    el.onclick = () => { state.printColor = el.dataset.color; document.querySelectorAll('#printColors .color-option').forEach(c => c.classList.remove('selected')); el.classList.add('selected'); drawPreview(); };
  });

  document.getElementById('churchText').addEventListener('input', (e) => { state.text = e.target.value; drawPreview(); });
  document.getElementById('positionSelect').addEventListener('change', (e) => { state.position = e.target.value; state.textX = null; state.textY = null; state.crossX = null; state.crossY = null; state.selectedElement = null; drawPreview(); });
  document.getElementById('fontSelect').addEventListener('change', (e) => { state.font = e.target.value; drawPreview(); });

  document.getElementById('tshirtCanvas').addEventListener('click', (e) => {
    const canvas = e.target, rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const clickY = (e.clientY - rect.top) * (canvas.height / rect.height);
    
    // Check if clicking near existing text
    let cx, cy, scale;
    if (state.position === 'center') { cx = 200; cy = 110; scale = 70; }
    else if (state.position === 'left') { cx = 140; cy = 100; scale = 50; }
    else { cx = 200; cy = 180; scale = 100; }
    
    const textX = state.textX || cx;
    const textY = state.textY || (cy + scale/2 + (state.position === 'back' ? 40 : 25));
    
    // If clicking near text, select it; otherwise move it
    const dist = Math.sqrt(Math.pow(clickX - textX, 2) + Math.pow(clickY - textY, 2));
    if (dist < 50) {
      state.selectedElement = 'text';
      document.getElementById('positionHint').textContent = 'Text selected - use arrow keys to move';
    } else {
      state.textX = clickX;
      state.textY = clickY;
      state.selectedElement = 'text';
      document.getElementById('positionHint').textContent = 'Text positioned - use arrow keys to fine-tune';
    }
    drawPreview();
  });

  drawPreview();
}

function resetTextPosition() {
  state.textX = null; state.textY = null; state.crossX = null; state.crossY = null; state.selectedElement = null;
  document.getElementById('positionHint').textContent = 'Click on the shirt preview to place your text';
  drawPreview();
}

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (file) {
    document.getElementById('uploadedFileName').textContent = 'Uploaded: ' + file.name;
    const reader = new FileReader();
    reader.onload = (ev) => { const img = new Image(); img.onload = () => { state.uploadedImage = img; drawPreview(); }; img.src = ev.target.result; };
    reader.readAsDataURL(file);
  }
}

function drawTShirt(ctx, x, y, w, h, color) {
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + w*0.25, y + h*0.15);
  ctx.lineTo(x + w*0.75, y + h*0.15);
  ctx.lineTo(x + w*0.85, y + h*0.25);
  ctx.lineTo(x + w*0.75, y + h*0.35);
  ctx.lineTo(x + w*0.75, y + h*0.9);
  ctx.quadraticCurveTo(x + w*0.5, y + h*0.95, x + w*0.25, y + h*0.9);
  ctx.lineTo(x + w*0.25, y + h*0.35);
  ctx.lineTo(x + w*0.15, y + h*0.25);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w*0.35, y + h*0.15); ctx.quadraticCurveTo(x + w*0.5, y + h*0.22, x + w*0.65, y + h*0.15); ctx.strokeStyle = '#bbb'; ctx.stroke();
  ctx.fillStyle = color; ctx.strokeStyle = '#ddd';
  ctx.beginPath(); ctx.moveTo(x + w*0.15, y + h*0.25); ctx.lineTo(x + w*0.05, y + h*0.35); ctx.lineTo(x + w*0.15, y + h*0.45); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w*0.85, y + h*0.25); ctx.lineTo(x + w*0.95, y + h*0.35); ctx.lineTo(x + w*0.85, y + h*0.45); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
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
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  drawTShirt(ctx, 50, 20, 300, 360, state.shirtColor);
  
  let cx, cy, scale;
  if (state.position === 'center') { cx = 200; cy = 110; scale = 70; }
  else if (state.position === 'left') { cx = 140; cy = 100; scale = 50; }
  else { cx = 200; cy = 180; scale = 100; }
  
  const crossX = state.crossX || cx;
  const crossY = state.crossY || cy;
  
  // Draw dashed border if cross is selected
  if (state.selectedElement === 'cross' && !state.uploadedImage) {
    ctx.save();
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(crossX - scale/2 - 5, crossY - scale/2 - 5, scale + 10, scale + 10);
    ctx.restore();
  }
  
  if (state.uploadedImage) {
    const aspect = state.uploadedImage.width / state.uploadedImage.height;
    const dw = scale * (aspect > 1 ? 1 : aspect);
    const dh = scale / (aspect > 1 ? aspect : 1);
    ctx.drawImage(state.uploadedImage, crossX - dw/2, crossY - dh/2, dw, dh);
  } else {
    drawCross(ctx, crossX, crossY, scale, state.printColor, state.cross);
  }
  
  if (state.text) {
    const x = state.textX || cx;
    const y = state.textY || (cy + scale/2 + (state.position === 'back' ? 40 : 25));
    
    // Draw dashed border if text is selected
    if (state.selectedElement === 'text') {
      ctx.save();
      ctx.strokeStyle = '#3d1a6e';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.font = (state.position === 'left' ? 12 : (state.position === 'back' ? 22 : 16)) + 'px ' + state.font;
      const metrics = ctx.measureText(state.text);
      const padding = 8;
      ctx.strokeRect(
        x - metrics.width/2 - padding,
        y - (state.position === 'back' ? 11 : 8) - padding,
        metrics.width + padding*2,
        (state.position === 'back' ? 22 : 16) + padding*2
      );
      ctx.restore();
    }
    
    ctx.fillStyle = state.printColor; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let fontSize = state.position === 'left' ? 12 : (state.position === 'back' ? 22 : 16);
    ctx.font = fontSize + 'px ' + state.font;
    ctx.fillText(state.text, x, y);
  }
}

document.addEventListener('DOMContentLoaded', init);
