import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Scenario, ScenarioWithForecasts, ReplanSegment } from '@thermal-reserve/model';
import { forecastChartRows } from '../lib/replan-ui';
import { clockLabel, temperature } from '../lib/ops';
export function TemperatureChart({ scenario, rows = forecastChartRows(scenario, []), segments = [] }: { scenario: Scenario; rows?: ReturnType<typeof forecastChartRows>; segments?: ReplanSegment[] }) {
  const forecastSource = (scenario as ScenarioWithForecasts).forecastRuns?.[0];
  return <figure className="panel temperature-chart"><h2>2 · Outdoor temperature <span className="metric-label">{scenario.kind === 'replay' ? 'derived · replay' : 'assumed · synthetic'}</span></h2>
    <div className="pressure-plot"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} syncId="pressure-clock" margin={{ top: 4, right: 20, bottom: 2, left: 8 }} accessibilityLayer>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="hour" type="number" domain={[0, scenario.hours]} hide /><YAxis width={58} stroke="var(--muted)" tick={{ fontSize: 10 }} label={{ value: 'Outdoor °F', angle: -90, position: 'insideLeft', dy: 25, fill: 'var(--muted)', fontSize: 10 }} />
      <Tooltip contentStyle={{ background: 'var(--surface)', borderColor: 'var(--border)' }} labelFormatter={h => clockLabel(scenario, Number(h))} formatter={v => Array.isArray(v) ? `${v.map(value => temperature.format(Number(value))).join('–')}°F` : `${temperature.format(Number(v))}°F`} />
      <Area name="Forecast ±1σ" dataKey="band" stroke="none" fill="#5BC0EB" fillOpacity={0.15} isAnimationActive={false} />
      <Line name="Forecast" dataKey="forecast" stroke="#5BC0EB" strokeDasharray="3 3" dot={false} isAnimationActive={false} />
      <Line name="Planning temperature" dataKey="planning" stroke="#F2A541" strokeDasharray="2 4" dot={false} isAnimationActive={false} />
      {segments.filter(segment => segment.fromHour > 0).map(segment => <ReferenceLine key={segment.fromHour} x={segment.fromHour} stroke={segment.reason === 'forecast' ? '#5BC0EB' : '#F2A541'} strokeDasharray="2 3" />)}
      <ReferenceArea x1={scenario.eventStartHour} x2={scenario.eventEndHour} fill="#5BC0EB" fillOpacity={0.05} /><Line name="Actual weather" dataKey="actual" stroke="#E6EDF7" dot={false} isAnimationActive={false} />
    </ComposedChart></ResponsiveContainer></div><figcaption title={[scenario.source, forecastSource?.source].filter(Boolean).join('; ')}>{segments.some(segment => segment.runIso) ? `Forecast (${forecastSource?.label ?? 'derived'}) ±1σ; dotted amber includes the cold buffer. Blue ticks mark each new forecast.` : 'Plan uses observed temperatures.'} Coldest hour: {temperature.format(Math.min(...scenario.outdoorF))}°F.</figcaption></figure>;
}
