import { useEffect, useRef, useState } from 'react';

const OPTIONS = [
  {
    key: 'playback',
    label: 'Signal playback',
    detail: 'Load high-resolution controller data (the Indiana event log, .csv) and play it back on the plan and in 3D: '
      + 'phase greens, yellows and reds, walk signals and detector actuations.',
  },
  {
    key: 'its',
    label: 'ITS & equipment',
    detail: 'Cabinet, CCTV cameras, the detection system with its cameras, and preemption, on the plan and in 3D. '
      + 'Detectors are drawn by technology: loops as 6 ft circles, video as zones.',
  },
  {
    key: 'video',
    label: 'Video playback',
    detail: 'Play a local video in a window beside the plan, synced to signal playback by its start time, with a 3D view '
      + 'from a CCTV camera (needs ITS & equipment).',
  },
  {
    key: 'corridor',
    label: 'Corridor view',
    detail: 'Several signals from a GTSS feed, placed by location and joined by the road between them. Replay their '
      + 'high-resolution data together to see the coordination: a map, a time-space diagram, and vehicles driving '
      + 'signal to signal in 3D.',
  },
];

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
          {OPTIONS.map((o) => (
            <label key={o.key} className="settings-option">
              <input type="checkbox" checked={!!settings[o.key]} onChange={(e) => set(o.key, e.target.checked)} />
              <span>
                <span className="menu-label">{o.label}</span>
                <span className="menu-detail">{o.detail}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
