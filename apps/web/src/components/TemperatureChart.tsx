import { CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Scenario } from '@thermal-reserve/model';
import { clockLabel, temperature } from '../lib/ops';
export function TemperatureChart({ scenario }: { scenario: Scenario }) {
  const rows = scenario.outdoorF.map((actual, hour) => ({ hour, actual }));
  return <figure className="panel temperature-chart"><h2>2 · Outdoor temperature <span className="metric-label">{scenario.kind === 'replay' ? 'derived · replay' : 'assumed · synthetic'}</span></h2>
    <div className="pressure-plot"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} syncId="pressure-clock" margin={{ top: 4, right: 20, bottom: 2, left: 8 }} accessibilityLayer>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="hour" type="number" domain={[0, scenario.hours]} hide /><YAxis width={58} stroke="var(--muted)" tick={{ fontSize: 10 }} label={{ value: 'Outdoor °F', angle: -90, position: 'insideLeft', dy: 25, fill: 'var(--muted)', fontSize: 10 }} />
      <Tooltip contentStyle={{ background: 'var(--surface)', borderColor: 'var(--border)' }} labelFormatter={h => clockLabel(scenario, Number(h))} formatter={v => `${temperature.format(Number(v))}°F`} />
      <ReferenceArea x1={scenario.eventStartHour} x2={scenario.eventEndHour} fill="#5BC0EB" fillOpacity={0.05} /><Line name="Actual weather" dataKey="actual" stroke="#E6EDF7" dot={false} isAnimationActive={false} />
    </ComposedChart></ResponsiveContainer></div><figcaption title={scenario.source}>Replay: plan uses observed temperatures. Coldest hour: {temperature.format(Math.min(...scenario.outdoorF))}°F.</figcaption></figure>;
}
