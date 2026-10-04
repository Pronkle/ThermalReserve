import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PressureSummary, Scenario } from '@thermal-reserve/model';
import { clockLabel, integer } from '../lib/ops';
import { ChartTooltip, tooltipProps } from './ChartTooltip';
export interface PressureRow { hour: number; baseline?: number; naive?: number; staggered?: number; /** ignored: Staggered is no longer drawn */ active?: number; live?: number; planned?: number; curtailed?: Record<string, number | undefined>; }
export const pressureLabel = 'Pressure index: modeled linepack margin. 100 = full, 0 = curtailment begins. Not psi and not Enstar telemetry.';
export function PressureChart({ rows, scenario, reserve, summary, baseline, caption, selectedName = 'Optimized' }: { rows: PressureRow[]; scenario: Scenario; reserve: number; summary?: PressureSummary; baseline: PressureSummary; caption: string; selectedName?: string }) {
  const minimum = Math.min(-30, ...rows.flatMap(row => [row.baseline, row.naive, row.active, row.live].filter((v): v is number => v !== undefined).map(v => v - 5)));
  const tickStep = minimum < -100 ? 100 : 25;
  const ticks = Array.from({ length: Math.floor((100 - minimum) / tickStep) + 1 }, (_, i) => 100 - i * tickStep).reverse();
  return <figure className="panel pressure-chart" aria-labelledby="pressure-title">
    <h2 id="pressure-title">1 · System pressure <span className="metric-label">derived · modeled</span></h2>
    <p className="pressure-explainer">{pressureLabel}</p>
    <div className="pressure-legend"><span style={{ color: '#7A869A' }}>┄ No program</span><span style={{ color: '#F2A541' }}>┄ Naive 4-hour</span><span style={{ color: '#5BC0EB' }}>— {selectedName}</span><span>— Live</span></div>
    <div className="pressure-plot"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} syncId="pressure-clock" margin={{ top: 16, right: 20, bottom: 2, left: 8 }} accessibilityLayer>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
      <XAxis dataKey="hour" type="number" domain={[0, scenario.hours]} hide />
      <YAxis ticks={ticks} domain={[minimum, 100]} allowDataOverflow tickFormatter={value => integer.format(Number(value))} width={64} tick={{ fontSize: 12 }} stroke="var(--muted)" label={{ value: 'Pressure index', angle: -90, position: 'insideLeft', fontSize: 12, style: { textAnchor: 'middle' }, fill: 'var(--muted)' }} />
      <Tooltip {...tooltipProps} content={props => <ChartTooltip {...props} scenario={scenario} line={entry => {
        const curtailed = (entry.payload as PressureRow).curtailed?.[String(entry.dataKey)];
        return <>{entry.name}: {integer.format(Number(entry.value))} index points{Number(entry.value) < 0 && curtailed !== undefined && <span style={{ display: 'block', color: 'var(--text)' }}>{curtailed.toFixed(1)} MMcf would have to be curtailed by this hour</span>}</>;
      }} />} />
      <ReferenceArea y1={minimum} y2={0} fill="#E5484D" fillOpacity={0.1} />
      <ReferenceArea y1={0} y2={reserve} fill="#F2A541" fillOpacity={0.13} label={{ value: 'Reserve', fill: '#F2A541', fontSize: 12, position: 'insideRight' }} />
      <ReferenceArea x1={scenario.eventStartHour} x2={scenario.eventEndHour} fill="#5BC0EB" fillOpacity={0.05} />
      <ReferenceLine y={0} stroke="#E5484D" label={{ value: 'Curtailment begins', position: 'insideBottomLeft', fill: '#E5484D', fontSize: 12 }} />
      <Line name="No program" dataKey="baseline" stroke="#7A869A" strokeDasharray="5 3" dot={false} isAnimationActive={false} />
      <Line name="Naive 4-hour" dataKey="naive" stroke="#F2A541" strokeDasharray="5 3" dot={false} isAnimationActive={false} />
      {summary && <Line name={selectedName} dataKey="active" stroke="#5BC0EB" strokeWidth={2} dot={false} isAnimationActive={false} />}
      <Line name="Live" dataKey="live" stroke="#E6EDF7" strokeWidth={3} dot={false} connectNulls={false} isAnimationActive={false} />
      {baseline.firstBelowHour !== null && <ReferenceDot x={baseline.firstBelowHour + 1} y={rows[baseline.firstBelowHour + 1]?.baseline} r={3} fill="#E5484D" stroke="#E5484D" label={{ value: `No program: ${clockLabel(scenario, baseline.firstBelowHour + 1)}`, position: 'bottom', fill: 'var(--muted)', fontSize: 11 }} />}
      {summary && <ReferenceDot x={summary.minHour + 1} y={summary.minIndex} r={4} fill="#5BC0EB" stroke="#5BC0EB" label={{ value: `Minimum ${integer.format(summary.minIndex)}`, position: 'top', fill: '#5BC0EB', fontSize: 12 }} />}
    </ComposedChart></ResponsiveContainer></div>
  </figure>;
}
