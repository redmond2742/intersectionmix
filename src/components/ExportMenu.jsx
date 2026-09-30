import { useEffect, useRef, useState } from 'react';

/** A button that opens a menu of export formats. `items` may include { separator: true }. */
export default function ExportMenu({ items }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (root.current && !root.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open && root.current) {
      const first = root.current.querySelector('[role="menuitem"]');
      if (first) first.focus();
    }
  }, [open]);

  const onMenuKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = [...root.current.querySelectorAll('[role="menuitem"]')];
    const i = list.indexOf(document.activeElement);
    const next = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
    if (next) next.focus();
  };

  return (
    <div className="export-menu" ref={root}>
      <button type="button" className="primary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Export ▾
      </button>
      {open && (
        <div className="menu" role="menu" onKeyDown={onMenuKey}>
          {items.filter(Boolean).map((item, i) => (item.separator
            ? <div key={`sep${i}`} className="menu-sep" role="separator" />
            : (
              <button key={item.id} type="button" role="menuitem" className="menu-item"
                onClick={() => { setOpen(false); item.onSelect(); }}>
                <span className="menu-label">{item.label}</span>
                {item.detail && <span className="menu-detail">{item.detail}</span>}
              </button>
            )))}
        </div>
      )}
    </div>
  );
}
