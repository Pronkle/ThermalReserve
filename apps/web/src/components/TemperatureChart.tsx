import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Scenario, ScenarioWithForecasts, ReplanSegment } from '@thermal-reserve/model';
import { forecastChartRows } from '../lib/replan-ui';
import { temperature } from '../lib/ops';
import { ChartTooltip, tooltipProps } from './ChartTooltip';
export function TemperatureChart({ scenario, rows = forecastChartRows(scenario, []), segments = [] }: { scenario: Scenario; rows?: ReturnType<typeof forecastChartRows>; segments?: ReplanSegment[] }) {
  const forecastSource = (scenario as ScenarioWithForecasts).forecastRuns?.[0];
  return <figure className="panel temperature-chart"><h2 title={[scenario.source, forecastSource?.source].filter(Boolean).join('; ')}>2 · Outdoor temperature{scenario.kind !== 'replay' && <span className="metric-label"> assumed · synthetic</span>}</h2>
    <div className="pressure-plot"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} syncId="pressure-clock" margin={{ top: 4, right: 20, bottom: 2, left: 8 }} accessibilityLayer>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="hour" type="number" domain={[0, scenario.hours]} hide /><YAxis width={64} stroke="var(--muted)" tick={{ fontSize: 12 }} label={{ value: 'Outdoor °F', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' }, fill: 'var(--muted)', fontSize: 12 }} />
      <Tooltip {...tooltipProps} content={props => <ChartTooltip {...props} scenario={scenario} line={entry => <>{entry.name}: {Array.isArray(entry.value) ? `${entry.value.map(value => temperature.format(Number(value))).join('–')}°F` : `${temperature.format(Number(entry.value))}°F`}</>} />} />
      <Area name="Forecast ±1σ" dataKey="band" stroke="none" fill="#5BC0EB" fillOpacity={0.15} isAnimationActive={false} />
      <Line name="Forecast" dataKey="forecast" stroke="#5BC0EB" strokeDasharray="3 3" dot={false} isAnimationActive={false} />
      <Line name="Planning temperature" dataKey="planning" stroke="#F2A541" strokeDasharray="2 4" dot={false} isAnimationActive={false} />
      <ReferenceArea x1={scenario.eventStartHour} x2={scenario.eventEndHour} fill="#5BC0EB" fillOpacity={0.05} /><Line name="Actual weather" dataKey="actual" stroke="#E6EDF7" dot={false} isAnimationActive={false} />
    </ComposedChart></ResponsiveContainer></div></figure>;
}
