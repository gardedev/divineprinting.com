(function (global) {
  'use strict';
  const templates = {
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
  const colors = [
    { name: 'Black', hex: '#1A1A1A', image: 'black.jpg' }, { name: 'White', hex: '#FFFFFF', image: 'white.jpg' },
    { name: 'Navy', hex: '#1A237E', image: 'navy.jpg' }, { name: 'Royal Blue', hex: '#4169E1', image: 'royal.jpg' },
    { name: 'Red', hex: '#C62828', image: 'red.jpg' }, { name: 'Maroon', hex: '#800000', image: 'maroon.jpg' },
    { name: 'Forest Green', hex: '#1B5E20', image: 'forest-green.jpg' }, { name: 'Kelly Green', hex: '#00A86B', image: 'irish-green.jpg' },
    { name: 'Purple', hex: '#3D1A6E', image: 'purple.jpg' }, { name: 'Orange', hex: '#FFA500', image: 'orange.jpg' },
    { name: 'Yellow', hex: '#FFFF00', image: 'yellow-haze.jpg' }, { name: 'Light Blue', hex: '#ADD8E6', image: 'light-blue.jpg' },
    { name: 'Light Pink', hex: '#FFB6C1', image: 'light-pink.jpg' }, { name: 'Gray', hex: '#A9A9A9', image: 'sport-grey.jpg' },
    { name: 'Charcoal', hex: '#36454F', image: 'charcoal.jpg' }
  ];
  const fonts = { cinzel: 'Cinzel', inter: 'Inter', georgia: 'Georgia', script: 'Script', impact: 'Impact', playfair: 'Playfair Display', oswald: 'Oswald', lobster: 'Lobster' };
  global.DivineTshirtAssets = { templates, colors, fonts, productId: 'd204cea4-ce22-4bc5-ad04-530f19fb3878' };
})(typeof window !== 'undefined' ? window : globalThis);
