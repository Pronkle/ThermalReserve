import type { PressureSummary } from '@thermal-reserve/model';
import { integer } from '../lib/ops';
export function StatusSentence({ summary, reserve }: { summary?: PressureSummary; reserve: number }) {
  const text = !summary ? 'Not solved for these inputs: press Solve plan.' : summary.hoursBelowZero > 0 ? `Below the curtailment line for ${summary.hoursBelowZero} hours: about ${summary.curtailedMMcf.toFixed(1)} MMcf would be curtailed, businesses first.` : summary.minIndex < reserve ? `Above the line; ${integer.format(summary.reserveHeld)} of the ${integer.format(reserve)}-point reserve held.` : 'Above the curtailment line for the whole cold snap.';
  return <p className={`pressure-status ${!summary ? '' : summary.minIndex < 0 ? 'danger' : summary.minIndex < reserve ? 'caution' : 'safe'}`} role="status">{text}</p>;
}
export function VerdictStrip({ summary, baseline, degreeHours, reserve, planningBasis = 'Plan uses observed weather' }: { summary?: PressureSummary; baseline: PressureSummary; degreeHours?: number; reserve: number; planningBasis?: string }) {
  const tone = !summary ? '' : summary.minIndex < 0 ? 'danger' : summary.minIndex < reserve ? 'caution' : 'safe';
  const items = [
    { name: 'Lowest pressure', value: summary?.minIndex, base: baseline.minIndex, unit: 'index points', formula: 'Derived: minimum end-of-hour pressure index. P = 100 × modeled linepack / usable linepack.' },
    { name: 'Hours below the line', value: summary?.hoursBelowZero, base: baseline.hoursBelowZero, unit: 'h', formula: 'Derived: count of completed model hours with pressure index below zero.' },
    { name: 'Home discomfort', value: degreeHours, base: 0, unit: '°F·h/home', formula: 'Derived: sum of hourly mean degrees below each home’s own no-program indoor temperature.' },
  ];
  return <section className={`verdict-strip ${tone}`} aria-label="Pressure verdict">{items.map(item => <div className="verdict-tile" key={item.name} title={item.formula}><span>{item.name}</span><strong>{item.value === undefined ? '—' : integer.format(item.value)} <small>{item.unit}</small></strong><span>No program: {integer.format(item.base)} {item.unit} <span className="metric-label">derived</span></span></div>)}<div className="planning-chip">{planningBasis}<span className="metric-label">Modeled planning basis</span></div></section>;
}
