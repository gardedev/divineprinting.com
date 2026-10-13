(function (global) {
  'use strict';
  const assets = global.DivineTshirtAssets;
  const generations = new WeakMap();
  const images = new Map();
  const placementMap = { center: 'center-chest', left: 'left-chest', back: 'full-back' };
  const fontMap = { Cinzel: 'cinzel', Inter: 'inter', Georgia: 'georgia', 'Brush Script MT': 'script', Impact: 'impact', 'Playfair Display': 'playfair', Oswald: 'oswald', Lobster: 'lobster' };
  function defaults(placement) {
    return placement === 'left-chest' ? { x: 280, y: 220, scale: 100 } : placement === 'full-back' ? { x: 200, y: 200, scale: 90 } : { x: 400, y: 240, scale: 140 };
  }
  function coordinate(value, fallback) {
    const resolved = value == null ? fallback : Number(value);
    if (!Number.isFinite(resolved)) throw new Error('Position must be a finite number.');
    return Math.max(0, Math.min(800, resolved));
  }
  function normalizeEditor(state, color, organizationName) {
    const placement = placementMap[state.position]; const d = defaults(placement);
    if (!placement || !assets.colors.some(c => c.name === color) || state.texts.length !== 2) throw new Error('The two text panels and shirt settings are required.');
    const textElements = []; const blankTextPanels = [];
    state.texts.forEach((entry, order) => {
      const text = String(entry.text || '').trim();
      const fontId = fontMap[entry.font]; const rgb = String(entry.color || '#FFFFFF').toUpperCase();
      const fontSize = Number(entry.size); const archDegrees = Number(entry.arch || 0);
      if (!fontId || !/^#[0-9A-F]{6}$/.test(rgb) || !Number.isInteger(fontSize) || fontSize < 10 || fontSize > 48 || !Number.isInteger(archDegrees) || archDegrees < -30 || archDegrees > 30 || text.length > 100) throw new Error('Review the text panel settings.');
      const panel = { elementId: `text-${order + 1}`, order, fontId, color: rgb, fontSize, archDegrees, position: { x: coordinate(entry.x, d.x), y: coordinate(entry.y, d.y + d.scale / 2 + 10 + order * 22) } };
      if (text) textElements.push({ ...panel, text, elementRole: order === 0 && organizationName && text === organizationName ? 'organizationName' : 'additionalText' });
      else blankTextPanels.push(panel);
    });
    const designScale = Number(state.designScale);
    if (!Number.isFinite(designScale) || designScale < 0.5 || designScale > 2 || !assets.templates[state.selectedDesign]) throw new Error('Review the design settings.');
    return { schemaVersion: 'custom-design-v1', options: { color, placement, designSource: 'TEMPLATE' }, ...(organizationName ? { organizationName } : {}), designConfiguration: { canvasVersion: 'tshirt-800-v1', templateId: state.selectedDesign, templateVersion: 1, designGeometry: { x: coordinate(state.designX, d.x), y: coordinate(state.designY, d.y) }, designScale, textElements, blankTextPanels } };
  }
  function supports(item) {
    return item.productId === assets.productId && item.customerConfiguration?.schemaVersion === 'custom-design-v1' && item.customerConfiguration?.designConfiguration?.canvasVersion === 'tshirt-800-v1';
  }
  function fontFor(fontId) { return fontId === 'cinzel' ? 'Cinzel' : 'Inter'; }
  function fontNote(fontId) { return fontId === 'cinzel' || fontId === 'inter' ? '' : 'Preview uses Inter; selected font is saved.'; }
  function imageReady(src) {
    if (!images.has(src)) images.set(src, new Promise((resolve, reject) => {
      const img = new global.Image();
      img.onload = () => img.naturalWidth ? resolve(img) : reject(new Error('Preview image unavailable.'));
      img.onerror = () => { images.delete(src); reject(new Error('Preview image unavailable.')); };
      img.src = src;
    }));
    return images.get(src);
  }
  async function ready(configuration) {
    const design = configuration.designConfiguration;
    const shirt = assets.colors.find(c => c.name === configuration.options.color);
    const template = assets.templates[design.templateId];
    if (!shirt || !template || design.templateVersion !== 1 || configuration.options.designSource !== 'TEMPLATE') throw new Error('Customized preview unavailable.');
    const fonts = [...new Set(design.textElements.map(p => fontFor(p.fontId)))];
    const resolvedFonts = {};
    const fontTasks = fonts.map(async font => {
      try {
        let timer;
        try {
          const loaded = await Promise.race([
            global.document.fonts?.load(`600 24px "${font}"`),
            new Promise(resolve => { timer = global.setTimeout(() => resolve([]), 2000); })
          ]);
          resolvedFonts[font] = loaded?.length ? font : 'Arial';
        } finally { global.clearTimeout(timer); }
      } catch (_) { resolvedFonts[font] = 'Arial'; }
    });
    const loaded = await Promise.all([imageReady(`/images/tshirts/${shirt.image}`), imageReady(`/images/designs/${template.file}`), ...fontTasks]);
    return { shirt: loaded[0], design: loaded[1], fonts: resolvedFonts };
  }
function drawArchedText(ctx, text, x, y, size, font, color, arch) {
  if (!arch || arch === 0) {
    // Fallback to straight text
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 ' + size + 'px "' + font + '", sans-serif';
    ctx.fillText(text, x, y);
    return;
  }

  ctx.save();
  ctx.font = '600 ' + size + 'px "' + font + '", sans-serif';
  ctx.fillStyle = color;

  // Calculate total width by measuring each character
  const characters = Array.from(text);
  let totalWidth = 0;
  const charWidths = [];
  for (let i = 0; i < characters.length; i++) {
    const w = ctx.measureText(characters[i]).width;
    charWidths.push(w);
    totalWidth += w;
  }

  // Add small spacing between characters for better curve
  const charSpacing = size * 0.05;
  totalWidth += charSpacing * (text.length - 1);

  // Convert arch degrees to radians
  const archRad = arch * Math.PI / 180;

  // Calculate radius based on desired arch angle and text width
  // Use a minimum radius to prevent extreme curves on short text
  const minRadius = totalWidth * 0.8;
  const calculatedRadius = totalWidth / (2 * Math.sin(Math.abs(archRad) / 2));
  const radius = Math.max(minRadius, calculatedRadius);

  // Determine curve direction
  const curveDirection = arch > 0 ? 1 : -1; // Positive = curve up (smile)

  // Arc center is below the text for upward curve, above for downward
  const arcCenterY = y + curveDirection * radius;

  // Calculate the angular width of the text along the arc
  const angularWidth = 2 * Math.asin(totalWidth / (2 * radius));

  // Start angle (left side of text)
  let currentAngle = -angularWidth / 2;

  // Draw each character
  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];
    const charWidth = charWidths[i];

    // Calculate the angle span for this character
    const charAngleSpan = (charWidth + charSpacing) / radius;

    // Angle at the center of this character
    const angle = currentAngle + charAngleSpan / 2;

    // Calculate position on the arc
    const charX = x + radius * Math.sin(angle);
    const charY = arcCenterY - curveDirection * radius * Math.cos(angle);

    // Rotation follows the curve tangent
    const rotation = -curveDirection * angle;

    ctx.save();
    ctx.translate(charX, charY);
    ctx.rotate(rotation);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(char, 0, 0);
    ctx.restore();

    // Move to next character position
    currentAngle += charAngleSpan;
  }

  ctx.restore();
}


  function paint(canvas, configuration, loaded) {
    const ctx = canvas.getContext('2d'); canvas.width = 800; canvas.height = 800;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.clearRect(0, 0, 800, 800);
    const aspect = loaded.shirt.width / loaded.shirt.height;
    const width = aspect > 1 ? 864 * aspect : 864; const height = aspect > 1 ? 864 : 864 / aspect;
    ctx.drawImage(loaded.shirt, (800 - width) / 2, (800 - height) / 2 - (aspect > 1 ? 0 : 16), width, height);
    const d = configuration.designConfiguration; const size = defaults(configuration.options.placement).scale * d.designScale;
    const designAspect = loaded.design.width / loaded.design.height;
    const dw = size * (designAspect > 1 ? 1 : designAspect); const dh = size / (designAspect > 1 ? designAspect : 1);
    ctx.drawImage(loaded.design, d.designGeometry.x - dw / 2, d.designGeometry.y - dh / 2, dw, dh);
    [...d.textElements].sort((a, b) => a.order - b.order).forEach(p => drawArchedText(ctx, p.text.trim(), p.position.x, p.position.y, p.fontSize, loaded.fonts?.[fontFor(p.fontId)] || 'Arial', p.color, p.archDegrees));
  }
  async function render(canvas, configuration, status) {
    const generation = (generations.get(canvas) || 0) + 1; generations.set(canvas, generation);
    if (status) status.textContent = 'Loading customized preview…';
    canvas.style.visibility = 'hidden';
    try {
      const loaded = await ready(configuration);
      if (generations.get(canvas) !== generation) return false;
      paint(canvas, configuration, loaded); canvas.style.visibility = 'visible';
      if (status) status.textContent = (configuration.options.placement === 'full-back' ? 'Full Back placement: this preview uses a front photo, not a rear view.' : 'Customized shirt preview') + (Object.values(loaded.fonts).includes('Arial') ? ' Unavailable preview fonts use Arial; your selected fonts are saved.' : '');
      return true;
    } catch (error) {
      if (generations.get(canvas) === generation && status) status.textContent = 'Customized preview unavailable. Your saved settings remain available.';
      return false;
    }
  }
  global.DivineTshirtPreview = { normalizeEditor, defaults, coordinate, supports, fontFor, fontNote, ready, paint, render };
})(typeof window !== 'undefined' ? window : globalThis);
