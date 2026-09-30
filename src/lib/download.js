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

export function svgToPngBlob(markup, width, height) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed.'))), 'image/png');
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The drawing could not be rendered to PNG.'));
    };
    image.src = url;
  });
}
