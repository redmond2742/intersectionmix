import { useEffect, useRef, useState } from 'react';

/** The ⚙ menu. Advanced features live here, off until switched on. */
export default function SettingsMenu({ settings, onChange }) {
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

  const set = (key, value) => onChange({ ...settings, [key]: value });

  return (
    <div className="export-menu settings-menu" ref={root}>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label="Settings" title="Settings"
        className="settings-button" onClick={() => setOpen((v) => !v)}>⚙</button>
      {open && (
        <div className="menu settings-panel" role="dialog" aria-label="Settings">
          <div className="settings-head">Advanced</div>
          <label className="settings-option">
            <input type="checkbox" checked={!!settings.playback} onChange={(e) => set('playback', e.target.checked)} />
            <span>
              <span className="menu-label">Signal playback</span>
              <span className="menu-detail">
                Load high-resolution controller data (the Indiana event log, .csv) and play it back on the plan: phase
                greens, yellows and reds, walk signals and detector actuations.
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
