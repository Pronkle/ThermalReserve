import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FleetConfig, Scenario } from '@thermal-reserve/model';
import { MapPreview } from '../components/MapPreview';
import { Metric } from '../components/Metric';
import { buildOpsData, clockLabel, constants, dailyShortfall, decimal, defaultConfig, integer, scenarios, temperature, type PreviewStrategy } from '../lib/ops';

const strategyNames: Record<PreviewStrategy, string> = { BASELINE: 'Baseline', NAIVE_4H: 'Naive morning setback', SUSTAIN_STAGGER: 'Sustain + stagger' };
const initialScenario = scenarios.find(sc => sc.id === 'design') ?? scenarios[0];
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function Ops() {
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const [config, setConfig] = useState(() => defaultConfig(initialScenario));
  const deferredConfig = useDeferredValue(config);
  const [strategy, setStrategy] = useState<PreviewStrategy>('SUSTAIN_STAGGER');
  const [hour, setHour] = useState(initialScenario.eventStartHour);
  const [speed, setSpeed] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<'fleet' | 'system'>('fleet');
  const data = useMemo(() => buildOpsData(scenario, deferredConfig), [scenario, deferredConfig]);
  const run = data.runs[strategy];
  const cursor = Math.min(Math.floor(hour), scenario.hours - 1);
  const current = run.hours[cursor];
  const shortfall = dailyShortfall(run, deferredConfig.capacityMMcfd);
  const recoveryPeak = Math.max(...data.chart.map(row => row.naive - row.baseline));
  const systemChart = run.hours.map((row, h) => ({ ...data.chart[h], system: row.systemMMcfh, baselineSystem: scenario.systemMMcfh[h], reliefBand: row.systemMMcfh <= scenario.systemMMcfh[h] ? [row.systemMMcfh, scenario.systemMMcfh[h]] : undefined }));
  const overCapacityDays = Array.from({ length: Math.ceil(scenario.hours / 24) }, (_, day) => day).filter(day => run.hours.slice(day * 24, day * 24 + 24).reduce((sum, row) => sum + row.systemMMcfh, 0) > deferredConfig.capacityMMcfd);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setHour(value => {
      const next = Math.min(scenario.hours - 1, value + speed / 4);
      if (next >= scenario.hours - 1) setPlaying(false);
      return next;
    }), 250);
    return () => window.clearInterval(timer);
  }, [playing, speed, scenario.hours]);
  function selectScenario(sc: Scenario) { setPlaying(false); setScenario(sc); setConfig(defaultConfig(sc)); setHour(sc.eventStartHour); }
  function preset() { selectScenario(scenarios.find(sc => sc.id === 'feb2024') ?? initialScenario); setStrategy('SUSTAIN_STAGGER'); setSpeed(2); }
  function parameter(key: keyof FleetConfig, value: number) { setConfig(previous => ({ ...previous, [key]: value })); }
  const ranges: { key: 'enrolledHomes' | 'maxDepthF' | 'floorF' | 'capacityMMcfd'; label: string; min: number; max: number; step: number; unit: string; note: string }[] = [
    { key: 'enrolledHomes', label: 'Enrolled homes', min: 1000, max: 50000, step: 1000, unit: 'homes', note: 'Assumed participation; operator-selected scenario input.' },
    { key: 'maxDepthF', label: 'Max setback', min: 2, max: 10, step: 1, unit: '°F', note: `${constants.raw.max_depth_default_f.label}: ${constants.raw.max_depth_default_f.source}` },
    { key: 'floorF', label: 'Comfort floor', min: constants.floorMinF, max: 66, step: 1, unit: '°F', note: `${constants.raw.floor_default_f.label}: ${constants.raw.floor_default_f.source}` },
    { key: 'capacityMMcfd', label: 'Daily capacity', min: Math.floor(scenario.capacityMMcfd - 30), max: Math.ceil(scenario.capacityMMcfd + 30), step: 0.5, unit: 'MMcf/day', note: `Assumed: ${scenario.capacityNote}` },
  ];
  return <>
    <div className="ops-heading">
      <div><p className="eyebrow">Local model preview</p><h1>Operator console</h1></div>
      <div className="clock-status"><strong>{clockLabel(scenario, cursor)}</strong><span title={`${scenario.kind}: ${scenario.source}`}>{playing ? 'Playing preview' : 'Preview paused'} · {scenario.name}</span></div>
    </div>
    <div className="ops-grid">
      <div className="ops-visuals">
        <section className="panel map-panel" aria-labelledby="map-title">
          <div className="panel-heading"><h2 id="map-title">Anchorage fleet</h2><span title="Assumed: enrolled homes divided by sampled dots.">Each dot ≈ {integer.format(data.homesPerDot)} homes <span className="metric-label">assumed</span></span></div>
          <div className="map-frame"><MapPreview homes={data.homes} run={run} hour={cursor} /></div>
          <div className="map-legend" aria-label="Map legend">
            <span><i className="dot normal" />Normal</span><span><i className="dot holding" />Holding setback</span><span><i className="dot recovering" />Recovering</span><span><i className="dot overridden" />Overridden</span><span><i className="dot exempt" />Exempt</span><span><i className="dot household" />Real household</span>
          </div>
          <p className="map-caption">Deterministic sample locations; real households appear after live connection.</p>
        </section>
        <figure className="panel fleet-panel" aria-labelledby="chart-title">
          <div className="panel-heading"><h2 id="chart-title">{view === 'fleet' ? 'Fleet gas demand' : 'Southcentral gas demand'}</h2><div className="chart-tabs" aria-label="Chart view"><button aria-pressed={view === 'fleet'} onClick={() => setView('fleet')}>Fleet</button><button aria-pressed={view === 'system'} onClick={() => setView('system')}>System</button></div></div>
          <div className="strategy-legend">{view === 'fleet' ? <><span className="baseline-line">— BASELINE</span><span className="naive-line">┄ NAIVE_4H</span><span className="sustain-line">— SUSTAIN_STAGGER</span></> : <><span className="baseline-line">— Without program</span><span className="sustain-line">— {strategy}</span><span className="naive-line">┄ Daily capacity average</span></>}<span className="metric-label">derived · model</span></div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={view === 'fleet' ? data.chart : systemChart} margin={{ top: 4, right: 12, bottom: 16, left: 6 }} accessibilityLayer>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="hour" type="number" domain={[0, scenario.hours - 1]} ticks={[0, 24, 48, 72, scenario.hours - 1]} stroke="var(--muted)" tick={{ fontSize: 10 }} tickFormatter={value => clockLabel(scenario, Number(value)).split(', ').slice(1).join(' ')} label={{ value: 'Anchorage time', position: 'bottom', fill: 'var(--muted)', fontSize: 11 }} />
                <YAxis stroke="var(--muted)" width={56} tickFormatter={value => decimal.format(Number(value))} label={{ value: 'MMcf/hour', angle: -90, position: 'insideLeft', fill: 'var(--muted)', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }} formatter={value => `${decimal.format(Number(value))} MMcf/hour · derived`} labelFormatter={value => clockLabel(scenario, Number(value))} />
                <ReferenceArea x1={scenario.eventStartHour} x2={scenario.eventEndHour} fill="#5BC0EB" fillOpacity={0.06} />
                {view === 'fleet' ? <><Line name="BASELINE" dataKey="baseline" stroke="#7A869A" dot={false} isAnimationActive={false} /><Line name="NAIVE_4H" dataKey="naive" stroke="#F2A541" strokeDasharray="5 3" strokeWidth={2} dot={false} isAnimationActive={false} /><Line name="SUSTAIN_STAGGER" dataKey="sustain" stroke="#5BC0EB" strokeWidth={2} dot={false} isAnimationActive={false} /></> : <><Area name="Relief" dataKey="reliefBand" fill="#30A46C" fillOpacity={0.35} stroke="none" isAnimationActive={false} /><Line name={`${strategy} system demand`} dataKey="system" stroke="#5BC0EB" dot={false} isAnimationActive={false} /><Line name="Without program" dataKey="baselineSystem" stroke="#7A869A" dot={false} isAnimationActive={false} />{overCapacityDays.map(day => <ReferenceArea key={day} x1={day * 24} x2={Math.min(scenario.hours - 1, day * 24 + 23)} fill="#E5484D" fillOpacity={0.08} />)}<ReferenceLine y={deferredConfig.capacityMMcfd / 24} stroke="#F2A541" strokeDasharray="5 3" label={{ value: 'Daily capacity ÷ 24 (average)', position: 'insideTopRight', fill: '#F2A541', fontSize: 10 }} /></>}
                <ReferenceLine x={cursor} stroke="#E6EDF7" strokeDasharray="2 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <label className="timeline">Preview hour <input aria-label="Preview hour" type="range" min={0} max={scenario.hours - 1} step={1} value={cursor} onChange={event => { setPlaying(false); setHour(Number(event.target.value)); }} /><output title="Assumed: selected simulation hour.">{cursor} h</output></label>
          <figcaption>{view === 'fleet' ? `Naive setbacks shift gas use into recovery; largest rebound is ${decimal.format(recoveryPeak)} MMcf/hour above baseline (derived). Net daily savings include recovery.` : `${(scenario as Scenario & { placeholder?: boolean }).placeholder ? 'System demand is assumed placeholder data. ' : ''}Red shading marks days over capacity. Within-day swings covered by linepack/storage is assumed.`}</figcaption>
        </figure>
      </div>
      <aside className="ops-side" aria-label="Fleet metrics and controls">
        <section className="kpi-grid" aria-label="Fleet metrics">
          <Metric name="Net relief" value={decimal.format(run.totals.netSavedMMcfdDuringEvent)} unit="MMcf/day" formula="(baseline fleet gas − plan fleet gas across the full scenario) ÷ event duration in days; includes recovery, exemptions and overrides. Model-derived." />
          <Metric name="Peak-hour relief" value={decimal.format(run.totals.peakHourReliefMMcfh)} unit="MMcf/hour" formula="Baseline − plan fleet gas at the highest-demand event hour. Model-derived; may be negative during recovery." />
          <Metric name="Minimum indoor" value={temperature.format(current.minTaF)} unit="°F" formula="Minimum cohort indoor temperature at the selected preview hour. Model-derived." />
          <Metric name="Homes at floor" value={temperature.format(current.shareAtFloor * 100)} unit="%" formula="Model shareAtFloor × 100 at the selected preview hour; cohorts within 0.1°F of the configured floor." />
          <Metric name="Overrides" value={integer.format(current.overrides)} unit="homes" formula={`Model-estimated overrides at the selected hour. ${constants.raw.override_rate.label}: ${constants.raw.override_rate.source}`} />
          <Metric name="Gas value" value={money.format(Math.round(run.totals.netSavedMMcfdDuringEvent * 1000 * constants.marginalPriceUsdPerMcf / 100) * 100)} unit="/day" formula={`Net relief (MMcf/day) × 1,000 Mcf/MMcf × $${constants.marginalPriceUsdPerMcf}/Mcf; rounded to $100. ${constants.raw.marginal_price_usd_mcf.label}: ${constants.raw.marginal_price_usd_mcf.source}`} />
        </section>
        <section className="panel controls-panel" aria-labelledby="controls-title">
          <div className="panel-heading"><h2 id="controls-title">Preview controls</h2><span className="metric-label">assumed inputs</span></div>
          <div className="controls-grid">
            <label>Scenario<select value={scenario.id} onChange={event => selectScenario(scenarios.find(sc => sc.id === event.target.value)!)}>{scenarios.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}</select></label>
            <label>Strategy<select value={strategy} onChange={event => setStrategy(event.target.value as PreviewStrategy)}>{Object.entries(strategyNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option disabled>Optimized · solver pending</option><option disabled>Max relief · solver pending</option></select></label>
            {ranges.map(range => <label key={range.key} title={range.note}>{range.label}<output>{(range.unit === '°F' ? temperature : range.unit === 'MMcf/day' ? decimal : integer).format(config[range.key])} {range.unit}</output><input type="range" aria-label={range.label} min={range.min} max={range.max} step={range.step} value={config[range.key]} onChange={event => parameter(range.key, Number(event.target.value))} /></label>)}
            <label title="Assumed: local preview playback speed.">Speed<output>{speed} h/s</output><input type="range" aria-label="Speed" min={0.5} max={4} step={0.5} value={speed} onChange={event => setSpeed(Number(event.target.value))} /></label>
          </div>
          <div className="control-actions"><button onClick={preset}>Demo preset</button><button disabled title="Plan solver is added in W3">Solve plan</button><button disabled title="Live dispatch is added with the connection">Dispatch</button><button onClick={() => { if (hour >= scenario.hours - 1) setHour(0); setPlaying(true); }}>Start preview</button><button onClick={() => setPlaying(false)}>Pause</button><button onClick={() => { setPlaying(false); setHour(0); }}>Reset</button><button disabled title="No connected households in local preview">Reset households</button></div>
          <p className="control-note">Local preview only · no live commands sent.</p>
        </section>
        <section className="panel log-panel" aria-labelledby="log-title"><h2 id="log-title">Event log</h2><p>Live joins, overrides and reassignment will appear when connected.</p>{shortfall > 0 && <p className="shortfall" title="Derived: largest daily sum of model system gas minus daily capacity.">Uncovered shortfall: {decimal.format(shortfall)} MMcf/day <span className="metric-label">derived</span></p>}</section>
      </aside>
    </div>
  </>;
}
