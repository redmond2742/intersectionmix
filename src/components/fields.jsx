/** Small form controls shared by the inspector panels. */

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Text({ value, onChange, ...rest }) {
  return <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />;
}

export function Num({ value, onChange, min, max, step = 1, ...rest }) {
  return (
    <input type="number" value={value ?? ''} min={min} max={max} step={step}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(n)) onChange(n);
      }} {...rest} />
  );
}

export function Choice({ value, onChange, options }) {
  const entries = Array.isArray(options) ? options.map((o) => [o, o || '—']) : Object.entries(options);
  const known = entries.some(([v]) => v === value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {!known && <option value={value}>{value}</option>}
      {entries.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}

