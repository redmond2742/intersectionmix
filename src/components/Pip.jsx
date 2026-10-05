import { useCallback, useEffect, useState } from 'react';

const KEY = 'intersectionMix:pip:v1';
const MIN_W = 200;
const MIN_H = 130;

function readRect() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || 'null');
    return r && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(r[k])) ? r : null;
  } catch {
    return null;
  }
}

function saveRect(r) {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // a per-viewer convenience; fine to lose
  }
}

/** Keeps a rect inside an area, no smaller than the minimum. */
export function clampRect(r, areaW, areaH) {
  const w = Math.max(MIN_W, Math.min(r.w, areaW - 8));
  const h = Math.max(MIN_H, Math.min(r.h, areaH - 8));
  return {
    w,
    h,
    x: Math.max(4, Math.min(r.x, areaW - w - 4)),
    y: Math.max(4, Math.min(r.y, areaH - h - 4)),
  };
}

/**
 * The floating window's rect, in pixels inside the stage area: about 38%
 * of the width at the bottom right to start (60% on a phone), then wherever
 * it was dragged, remembered per viewer.
 */
export function usePipRect(areaRef) {
  const [rect, setRect] = useState(readRect);
  const fit = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    const W = area.clientWidth;
    const H = area.clientHeight;
    setRect((r) => {
      let next = r;
      if (!next) {
        const w = Math.round(W * (W < 560 ? 0.6 : 0.38));
        const h = Math.round(w * 0.5625) + 64;
        next = { w, h, x: W - w - 12, y: H - h - 12 };
      }
      const c = clampRect(next, W, H);
      return r && c.x === r.x && c.y === r.y && c.w === r.w && c.h === r.h ? r : c;
    });
  }, [areaRef]);
  useEffect(() => {
    fit();
    const area = areaRef.current;
    if (!area) return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(area);
    return () => observer.disconnect();
  }, [areaRef, fit]);
  const update = useCallback((r) => {
    setRect(r);
    saveRect(r);
  }, []);
  return [rect, update];
}

/** Starts dragging (move) or resizing (resize) the floating window. */
export function startPipDrag(event, mode, rect, areaEl, onRect) {
  if (event.button !== 0 || !rect || !areaEl) return;
  if (event.target.closest('button, select, input') && mode === 'move') return;
  event.preventDefault();
  const start = { x: event.clientX, y: event.clientY, rect };
  const W = areaEl.clientWidth;
  const H = areaEl.clientHeight;
  const onMove = (e) => {
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const r = mode === 'move'
      ? { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy }
      : { ...start.rect, w: start.rect.w + dx, h: start.rect.h + dy };
    onRect(clampRect(r, W, H));
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

export const rectStyle = (r) => (r ? { left: r.x, top: r.y, width: r.w, height: r.h } : undefined);

/** The grip in a floating window's bottom-right corner. */
export function ResizeGrip({ onPointerDown }) {
  return <span className="pip-grip" onPointerDown={onPointerDown} aria-hidden="true" />;
}
