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
  function fontFor(fontId) {
    const spec = assets.fontSpecs[fontId];
    if (!spec) throw new Error('Selected preview font unavailable.');
    return spec.family;
  }
  function fontNote() { return ''; }
  function graphemes(text) {
    if (!global.Intl?.Segmenter) throw new Error('Unicode text rendering unavailable in this browser.');
    return Array.from(new global.Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), entry => entry.segment);
  }
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
    const fontIds = [...new Set(design.textElements.map(p => p.fontId))];
    const resolvedFonts = {};
    const fontTasks = fontIds.map(async fontId => {
      const spec = assets.fontSpecs[fontId];
      if (!spec || !global.document.fonts) throw new Error('Selected preview font unavailable.');
      const text = design.textElements.filter(p => p.fontId === fontId).map(p => p.text).join('');
      for (const char of Array.from(text)) {
        const code = char.codePointAt(0);
        if (!spec.glyphRanges.some(([first, last]) => code >= first && code <= last)) throw new Error('Selected font cannot render every character.');
      }
      let timer;
      try {
        const loaded = await Promise.race([
          global.document.fonts.load(`${spec.weight} 24px "${spec.family}"`, text),
          new Promise((_, reject) => { timer = global.setTimeout(() => reject(new Error('Selected preview font unavailable.')), 5000); })
        ]);
        if (!loaded.length) throw new Error('Selected preview font unavailable.');
        resolvedFonts[fontId] = spec;
      } finally { global.clearTimeout(timer); }
    });
    const loaded = await Promise.all([imageReady(`/images/tshirts/${shirt.image}`), imageReady(`/images/designs/${template.file}`), ...fontTasks]);
    return { shirt: loaded[0], design: loaded[1], fonts: resolvedFonts };
  }
  function archLayout(ctx, text, size, arch) {
    const characters = graphemes(text);
    if (!characters.length) return [];
    const widths = characters.map(char => ctx.measureText(char).width);
    const spacing = size * 0.05;
    const width = widths.reduce((sum, w) => sum + w, 0) + spacing * (characters.length - 1);
    if (!Number.isFinite(width) || width <= 0 || widths.every(w => w <= 0)) return [];
    if (!arch || characters.length === 1) return characters.map((text, index) => ({ text, x: 0, y: 0, rotation: 0 }));
    const direction = Math.sign(arch); const radius = width / (Math.abs(arch) * Math.PI / 180);
    let before = 0;
    return characters.map((text, index) => {
      const angle = (before + widths[index] / 2 - width / 2) / radius;
      before += widths[index] + spacing;
      return { text, x: radius * Math.sin(angle), y: direction * radius * (1 - Math.cos(angle)), rotation: direction * angle };
    });
  }

  function drawArchedText(ctx, text, x, y, size, font, color, arch, weight) {
    if (!text) return;
    ctx.save(); ctx.font = `${weight} ${size}px "${font}"`; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (!arch) ctx.fillText(text, x, y);
    else archLayout(ctx, text, size, arch).forEach(glyph => {
      ctx.save(); ctx.translate(x + glyph.x, y + glyph.y); ctx.rotate(glyph.rotation); ctx.fillText(glyph.text, 0, 0); ctx.restore();
    });
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
    [...d.textElements].sort((a, b) => a.order - b.order).forEach(p => drawArchedText(ctx, p.text.trim(), p.position.x, p.position.y, p.fontSize, loaded.fonts[p.fontId].family, p.color, p.archDegrees, loaded.fonts[p.fontId].weight));
  }
  async function render(canvas, configuration, status) {
    const generation = (generations.get(canvas) || 0) + 1; generations.set(canvas, generation);
    if (status) status.textContent = 'Loading customized preview…';
    canvas.style.visibility = 'hidden';
    try {
      const loaded = await ready(configuration);
      if (generations.get(canvas) !== generation) return false;
      paint(canvas, configuration, loaded); canvas.style.visibility = 'visible';
      if (status) status.textContent = (configuration.options.placement === 'full-back' ? 'Full Back placement: this preview uses a front photo, not a rear view.' : 'Customized shirt preview');
      return true;
    } catch (error) {
      if (generations.get(canvas) === generation && status) status.textContent = `Customized preview unavailable: ${error.message} Your saved settings remain available.`;
      return false;
    }
  }
  global.DivineTshirtPreview = { normalizeEditor, graphemes, archLayout, defaults, coordinate, supports, fontFor, fontNote, ready, paint, render };
})(typeof window !== 'undefined' ? window : globalThis);
