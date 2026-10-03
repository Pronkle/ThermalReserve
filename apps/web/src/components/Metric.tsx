export function Metric({ name, value, unit, formula, label = 'derived' }: { name: string; value: string; unit: string; formula: string; label?: 'derived' | 'assumed' | 'sourced' }) {
  return <div className="metric" tabIndex={0} aria-label={`${name}: ${value} ${unit}. ${label}. ${formula}`}>
    <div className="metric-name">{name}<span className="metric-label">{label}</span></div>
    <div className="metric-value">{value}<span>{unit}</span></div>
    <div className="metric-tooltip" role="tooltip">{label} · {formula}</div>
  </div>;
}
