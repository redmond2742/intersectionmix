import { useEffect, useMemo, useRef, useState } from 'react';

/** Chooses one signal from a feed that describes many. */
export default function SignalPicker({ feed, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const input = useRef(null);
  useEffect(() => {
    input.current && input.current.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? feed.signals.filter((s) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      : feed.signals;
    return list.slice(0, 200);
  }, [feed, query]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel" role="dialog" aria-modal="true" aria-labelledby="picker-title" onClick={(e) => e.stopPropagation()}>
        <div className="section-head">
          <h2 id="picker-title">Choose a signal</h2>
          <button type="button" className="close static" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className="muted small">{feed.label} describes {feed.signals.length} signals.</p>
        <input ref={input} type="search" placeholder="Search by ID or street" value={query} onChange={(e) => setQuery(e.target.value)} />
        <ul className="signal-list">
          {matches.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onPick(s.id)}>
                <strong>{s.id}</strong>
                <span>{s.name}</span>
                <span className="muted">{s.approaches} approaches</span>
              </button>
            </li>
          ))}
          {!matches.length && <li className="muted">No signal matches.</li>}
        </ul>
      </div>
    </div>
  );
}
