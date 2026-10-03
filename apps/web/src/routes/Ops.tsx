import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildPreview } from '../lib/preview';

export function Ops() {
  const preview = useMemo(buildPreview, []);
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  return <>
    <div className="ops-heading">
      <div><p className="eyebrow">Alaska winter control room</p><h1>Operator console</h1></div>
      <span className="label-chip" title="Assumed: placeholder output from the model scaffold, not validated simulation results.">assumed · model stub preview</span>
    </div>
    <figure className="panel" aria-labelledby="fleet-title">
      <h2 id="fleet-title">Fleet gas demand</h2>
      <p className="muted">Baseline preview · live dispatch is being prepared</p>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={preview.hours} margin={{ top: 8, right: 16, bottom: 24, left: 16 }} accessibilityLayer>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="hour" stroke="var(--muted)" label={{ value: 'Simulation hour (h)', position: 'bottom', fill: 'var(--muted)' }} />
            <YAxis stroke="var(--muted)" tickFormatter={value => number.format(Number(value))} label={{ value: 'MMcf/hour', angle: -90, position: 'insideLeft', fill: 'var(--muted)' }} />
            <Tooltip contentStyle={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }} formatter={value => [`${number.format(Number(value))} MMcf/hour`, 'Baseline · assumed stub']} labelFormatter={value => `Simulation hour ${value} · assumed preview`} />
            <Line name="BASELINE" type="monotone" dataKey="fleetGasMMcfh" stroke="#7A869A" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption>Placeholder data checks the chart connection to the model. Net daily relief and strategy comparisons will appear after the model is implemented.</figcaption>
    </figure>
  </>;
}
