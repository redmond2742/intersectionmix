/** Browser-only helpers for saving files. */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(text) {
  return String(text || 'intersection')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'intersection';
}

/**
 * A standalone copy of a drawing: editing handles and selection outlines
 * (marked data-export="skip") are removed, and it is given a pixel size.
 */
export function svgMarkup(svg, pixelWidth = 1600) {
  const clone = svg.cloneNode(true);
  clone.querySelectorAll('[data-export="skip"]').forEach((node) => node.remove());
  const [, , w, h] = (clone.getAttribute('viewBox') || '0 0 1000 1000').split(/\s+/).map(Number);
  const width = pixelWidth;
  const height = Math.round((pixelWidth * h) / w);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('class');
  clone.removeAttribute('style');
  const markup = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
  return { markup, width, height };
}

/** Rasterises SVG markup onto a new canvas. */
export function svgToCanvas(markup, width, height) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The drawing could not be rendered.'));
    };
    image.src = url;
  });
}

export async function svgToPngBlob(markup, width, height) {
  const canvas = await svgToCanvas(markup, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed.'))), 'image/png');
  });
}

/**
 * The plan as a texture for the 3D view: the whole design at its fitted
 * bounds, without labels, handles, overlays or anything else that stands
 * up in 3D rather than lying on the road.
 */
export function planCanvas(svg, bounds, maxSize = 4096) {
  const clone = svg.cloneNode(true);
  clone.querySelectorAll('[data-export="skip"], [data-3d="skip"]').forEach((node) => node.remove());
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const scale = maxSize / Math.max(w, h);
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  clone.setAttribute('viewBox', `${bounds.minX} ${bounds.minY} ${w} ${h}`);
  clone.setAttribute('preserveAspectRatio', 'none');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('class');
  clone.removeAttribute('style');
  return svgToCanvas(new XMLSerializer().serializeToString(clone), width, height);
}

/**
 * One sheet of every phase diagram, laid out as on screen: ring 1 over
 * ring 2 with the barrier between 2|3 and 6|7, other phases and overlaps
 * after. Built from the rendered diagrams, so it matches what is shown.
 */
export function phaseSheetMarkup(panel, title) {
  const NS = 'http://www.w3.org/2000/svg';
  const CELL_W = 220;
  const CELL_H = 262;
  const LEFT = 76;
  const TOP = 64;
  const cellsOf = (selector) => [...panel.querySelectorAll(`${selector} .phase-cell`)];
  const ring = cellsOf('.ring-grid');
  const others = cellsOf('.other-phases');
  const rows = [];
  if (ring.length) rows.push({ label: 'Ring 1', cells: ring.slice(0, 4), nema: true }, { label: 'Ring 2', cells: ring.slice(4, 8), nema: true });
  for (let i = 0; i < others.length; i += 4) rows.push({ label: i === 0 ? (ring.length ? 'Other' : 'Phases') : '', cells: others.slice(i, i + 4) });

  const width = LEFT + 4 * CELL_W + 24;
  const height = TOP + rows.length * CELL_H + 16;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('font-family', 'Inter, system-ui, -apple-system, Segoe UI, sans-serif');
  const el = (name, attrs, text) => {
    const node = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
    if (text != null) node.textContent = text;
    svg.appendChild(node);
    return node;
  };
  el('rect', { width, height, fill: '#ffffff' });
  el('text', { x: 24, y: 36, 'font-size': 20, 'font-weight': 700, fill: '#1f2328' }, 'Phase diagrams');
  el('text', { x: 24, y: 54, 'font-size': 12, fill: '#69707a' }, title);

  rows.forEach((row, r) => {
    const y = TOP + r * CELL_H;
    el('text', { x: 24, y: y + CELL_H / 2, 'font-size': 13, 'font-weight': 600, fill: '#69707a' }, row.label);
    row.cells.forEach((cell, c) => {
      const x = LEFT + c * CELL_W + (row.nema && c >= 2 ? 12 : 0);
      const name = cell.querySelector('.phase-name');
      const summary = cell.querySelector('.phase-summary');
      const diagram = cell.querySelector('svg');
      const empty = cell.classList.contains('empty');
      el('rect', { x: x + 4, y: y + 4, width: CELL_W - 16, height: CELL_H - 12, rx: 10, fill: '#f7f8f6', stroke: '#dde0da' });
      el('text', { x: x + 16, y: y + 28, 'font-size': 16, 'font-weight': 800, fill: empty ? '#9aa3ad' : (name && getComputedStyle(name).color) || '#1f2328' }, name ? name.textContent : '');
      el('rect', { x: x + 14, y: y + 38, width: CELL_W - 36, height: CELL_W - 36, rx: 6, fill: '#eef0e8' });
      if (diagram) {
        const copy = diagram.cloneNode(true);
        copy.setAttribute('x', String(x + 14));
        copy.setAttribute('y', String(y + 38));
        copy.setAttribute('width', String(CELL_W - 36));
        copy.setAttribute('height', String(CELL_W - 36));
        if (empty) copy.setAttribute('opacity', '0.45');
        svg.appendChild(copy);
      }
      el('text', { x: x + 16, y: y + CELL_W + 20, 'font-size': 11, fill: '#69707a' }, summary ? summary.textContent : '');
    });
    if (row.nema) {
      const bx = LEFT + 2 * CELL_W + 4;
      el('line', { x1: bx, x2: bx, y1: y + 6, y2: y + CELL_H - 8, stroke: '#1f2328', 'stroke-width': 3, 'stroke-dasharray': '6 4' });
    }
  });
  return { markup: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`, width, height };
}
