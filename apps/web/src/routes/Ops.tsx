import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { runPlan, gasDays, type Plan, type Strategy, type FleetConfig, type Scenario } from '@thermal-reserve/model';
import { useConnection, useSimConfig, useAggregates, useSampleHomes, useEventLog, useReducers } from '../lib/stdb';
import { launchSolve } from '../lib/solver';
import { loadPreset, dispatchPreview, dispatchPlan } from '../lib/operator';
import { JoinQr } from '../components/JoinQr';
import { MapPreview } from '../components/MapPreview';
import { Metric } from '../components/Metric';
import { buildOpsData, clockLabel, constants, cohorts, dailyShortfall, decimal, defaultConfig, integer, scenarios, temperature, type PreviewStrategy } from '../lib/ops';

const strategyNames: Record<Strategy, string> = { BASELINE: 'No program', NAIVE_4H: 'Naive morning setback', SUSTAIN_STAGGER: 'Staggered', OPTIMIZED: 'Optimized', MAX_RELIEF: 'Max relief' };
const initialScenario = scenarios.find(sc => sc.id === 'design') ?? scenarios[0];
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function Ops() {
  const live = useConnection();
  const sim = useSimConfig();
  const aggregates = useAggregates();
  const samples = useSampleHomes();
  const events = useEventLog(12);
  const reducers = useReducers();
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState('');
  const connected = live.status === 'connected';
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const [config, setConfig] = useState(() => defaultConfig(initialScenario));
  const deferredConfig = useDeferredValue(config);
  const [strategy, setStrategy] = useState<Strategy>('SUSTAIN_STAGGER');
  const [hour, setHour] = useState(initialScenario.eventStartHour);
  const [speed, setSpeed] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<'fleet' | 'system'>('fleet');
  const data = useMemo(() => buildOpsData(scenario, deferredConfig), [scenario, deferredConfig]);
  const [solving, setSolving] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [solved, setSolved] = useState<{ key: string; plan: Plan }>();
  const pendingSolve = useRef<ReturnType<typeof launchSolve> | undefined>(undefined);
  const solveGeneration = useRef(0);
  const solveKey = JSON.stringify([scenario.id, config]);
  useEffect(() => {
    solveGeneration.current++;
    pendingSolve.current?.cancel();
    setSolving(false);
    return () => { solveGeneration.current++; pendingSolve.current?.cancel(); };
  }, [solveKey]);
  const remoteTargets = JSON.stringify(live.plans.map(row => [row.cohortId, row.hour, row.targetF]));
  const remotePlan = useMemo<Plan | undefined>(() => {
    if (!sim?.planId || (sim.strategy !== 'OPTIMIZED' && sim.strategy !== 'MAX_RELIEF')) return;
    const targetsF = cohorts.map(() => Array<number>(scenario.hours).fill(NaN));
    for (const [cohortId, hour, target] of JSON.parse(remoteTargets) as number[][]) if (targetsF[cohortId]) targetsF[cohortId][hour] = target;
    return { id: sim.planId, strategy: sim.strategy, targetsF };
  }, [remoteTargets, sim?.planId, sim?.strategy, scenario.hours]);
  const serializedConfig = sim ? JSON.stringify({ enrolledHomes: sim.enrolledHomes, exemptShare: sim.exemptShare, floorF: sim.floorF, maxDepthF: sim.maxDepthF, capacityMMcfd: sim.capacityMmcfd, overrideRate: sim.overrideRate, seed: 42 }) : '';
  const selectedPlan = solved?.key === solveKey && (solved.plan.strategy === strategy || (solved.plan.note === 'Rule-based fallback' && (strategy === 'OPTIMIZED' || strategy === 'MAX_RELIEF'))) ? solved.plan : remotePlan?.strategy === strategy && JSON.stringify(config) === serializedConfig ? remotePlan : undefined;
  const solvedRun = useMemo(() => selectedPlan ? runPlan(scenario, cohorts, deferredConfig, selectedPlan, constants) : undefined, [scenario, deferredConfig, selectedPlan]);
  const run = solvedRun ?? data.runs[strategy === 'OPTIMIZED' || strategy === 'MAX_RELIEF' ? 'SUSTAIN_STAGGER' : strategy];
  const activeName = (strategy === 'OPTIMIZED' || strategy === 'MAX_RELIEF') && !selectedPlan ? 'Staggered · unsolved preview' : strategyNames[run.strategy];
  const requiresSolve = (strategy === 'OPTIMIZED' || strategy === 'MAX_RELIEF') && !selectedPlan;
  const days = gasDays(run);
  const tightDay = days.reduce((tightest, day) => day.baselineSystemMMcf - day.capacityMMcf > tightest.baselineSystemMMcf - tightest.capacityMMcf ? day : tightest);
  const fallback = selectedPlan?.note === 'Rule-based fallback' || sim?.planId.includes('-fallback-');
  async function solve() {
    if (solving) return;
    const generation = ++solveGeneration.current;
    const mode = strategy === 'MAX_RELIEF' ? 'MAX_RELIEF' : 'OPTIMIZED';
    setSolving(true); setElapsedMs(0); setCommandError('');
    const start = performance.now();
    const timer = setInterval(() => setElapsedMs(performance.now() - start), 50);
    try {
      pendingSolve.current = launchSolve({ sc: scenario, cohorts, cfg: config, mode, consts: constants });
      const plan = await pendingSolve.current.result;
      if (solveGeneration.current !== generation) return;
      setSolved({ key: solveKey, plan: { ...plan, id: `${plan.id.slice(0, 48)}-${Date.now().toString(36)}` } }); setStrategy(mode); setElapsedMs(performance.now() - start);
    } catch (error) { if (solveGeneration.current === generation) setCommandError(error instanceof Error ? error.message : String(error)); }
    finally { clearInterval(timer); if (solveGeneration.current === generation) setSolving(false); }
  }
  const liveRows = new Map(aggregates.map(row => [row.hour, row]));
  const fleetChart = data.chart.map(row => ({ ...row, active: run.hours[row.hour].fleetGasMMcfh, live: liveRows.get(row.hour)?.fleetGasMmcf }));
  const mapHomes = sim && samples.length ? samples.map(home => ({ ...home, overrideHour: home.overridden ? 0 : null })) : data.homes;
  useEffect(() => {
    if (!sim) return;
    const sc = scenarios.find(item => item.id === sim.scenarioId);
    if (sc) setScenario(sc);
    setHour(sim.simHour);
    setPlaying(false);
  }, [sim?.scenarioId, sim?.simHour, sim?.speedHoursPerSec]);
  useEffect(() => { if (sim) setSpeed(sim.speedHoursPerSec); }, [sim?.speedHoursPerSec]);
  useEffect(() => {
    if (sim?.planId && (sim.strategy === 'BASELINE' || sim.strategy === 'NAIVE_4H' || sim.strategy === 'SUSTAIN_STAGGER' || sim.strategy === 'OPTIMIZED' || sim.strategy === 'MAX_RELIEF')) setStrategy(sim.strategy);
  }, [sim?.strategy, sim?.planId]);
  useEffect(() => { if (serializedConfig) setConfig(JSON.parse(serializedConfig) as FleetConfig); }, [serializedConfig]);
  async function command(action: (api: NonNullable<typeof reducers>) => Promise<void>) {
    if (!reducers || busy) return;
    setBusy(true); setCommandError('');
    try {
      if (sim?.operator?.toHexString() !== live.identity) {
        const passcode = window.prompt('Operator passcode');
        if (passcode === null) return;
        await reducers.claimOperator({ passcode });
      }
      await action(reducers);
    } catch (error) { setCommandError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  function demo() {
    solveGeneration.current++; pendingSolve.current?.cancel(); setSolving(false); setSolved(undefined); setStrategy('SUSTAIN_STAGGER');
    if (!connected) { preset(); return; }
    const sc = scenarios.find(item => item.id === 'feb2024') ?? initialScenario;
    void command(api => loadPreset(api, sc, defaultConfig(sc)));
  }
  const cursor = Math.min(Math.floor(hour), scenario.hours - 1);
  const current = run.hours[cursor];
  const shortfall = dailyShortfall(run, deferredConfig.capacityMMcfd);
  const recoveryPeak = Math.max(...data.chart.map(row => row.naive - row.baseline));
  const systemChart = run.hours.map((row, h) => ({ ...data.chart[h], active: row.fleetGasMMcfh, live: liveRows.get(h)?.systemMmcf, system: row.systemMMcfh, baselineSystem: scenario.systemMMcfh[h], reliefBand: row.systemMMcfh <= scenario.systemMMcfh[h] ? [row.systemMMcfh, scenario.systemMMcfh[h]] : undefined }));
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
      <div><p className="eyebrow">{connected ? `Live · ${live.database}` : live.status === 'unconfigured' ? 'Local model preview' : `Connecting · ${live.database}`}</p><h1>Operator console</h1></div>
      <div className="clock-status"><strong>{clockLabel(scenario, cursor)}</strong><span title={`${scenario.kind}: ${scenario.source}`}>{sim ? sim.status : playing ? 'Playing preview' : 'Preview paused'} · {scenario.name}</span></div>
      <JoinQr />
    </div>
    {live.status === 'disconnected' && <p className="connection-banner" role="status">Disconnected — retrying{live.error ? ` · ${live.error}` : ''}</p>}
    {shortfall > 0 && <p className="shortfall-banner" role="status" title="Derived: largest daily sum of model system gas minus daily capacity.">Uncovered shortfall: {decimal.format(shortfall)} MMcf/day <span className="metric-label">derived · worst gas day</span></p>}
    {fallback && <p className="fallback-banner" role="status">Rule-based fallback in use · Staggered</p>}
    {commandError && <p className="connection-banner" role="alert">{commandError}</p>}
    <div className="ops-grid">
      <div className="ops-visuals">
        <section className="panel map-panel" aria-labelledby="map-title">
          <div className="panel-heading"><h2 id="map-title">Anchorage fleet</h2><span title="Assumed: enrolled homes divided by sampled dots.">Each dot ≈ {integer.format(sim?.homesPerDot ?? data.homesPerDot)} homes <span className="metric-label">assumed</span></span></div>
          <div className="map-frame"><MapPreview homes={mapHomes} run={run} hour={cursor} /></div>
          <div className="map-legend" aria-label="Map legend">
            <span><i className="dot normal" />Normal</span><span><i className="dot holding" />Holding setback</span><span><i className="dot recovering" />Recovering</span><span><i className="dot overridden" />Overridden</span><span><i className="dot exempt" />Exempt</span><span><i className="dot household" />Real household</span>
          </div>
          <p className="map-caption">Deterministic sample locations; larger dots show enrolled demo households.</p>
        </section>
        <figure className="panel fleet-panel" aria-labelledby="chart-title">
          <div className="panel-heading"><h2 id="chart-title">{view === 'fleet' ? 'Fleet gas demand' : 'Southcentral gas demand'}</h2><div className="chart-tabs" aria-label="Chart view"><button aria-pressed={view === 'fleet'} onClick={() => setView('fleet')}>Fleet</button><button aria-pressed={view === 'system'} onClick={() => setView('system')}>System</button></div></div>
          <div className="strategy-legend">{view === 'fleet' ? <><span className="baseline-line">— No program</span><span className="naive-line">┄ Naive morning setback</span><span className="sustain-line">— {activeName}</span></> : <><span className="baseline-line">— Without program</span><span className="sustain-line">— {activeName}</span><span className="naive-line">┄ Daily capacity average</span></>}{connected && <span className="live-line">— Live</span>}<span className="metric-label">derived · model</span></div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={view === 'fleet' ? fleetChart : systemChart} margin={{ top: 4, right: 12, bottom: 16, left: 6 }} accessibilityLayer>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="hour" type="number" domain={[0, scenario.hours - 1]} ticks={[0, 24, 48, 72, scenario.hours - 1]} stroke="var(--muted)" tick={{ fontSize: 10 }} tickFormatter={value => clockLabel(scenario, Number(value)).split(', ').slice(1).join(' ')} label={{ value: 'Anchorage time', position: 'bottom', fill: 'var(--muted)', fontSize: 11 }} />
                <YAxis stroke="var(--muted)" width={62} tick={{ fontSize: 11 }} tickFormatter={value => decimal.format(Number(value))} label={{ value: 'MMcf/hour', angle: -90, position: 'insideLeft', dy: 30, fill: 'var(--muted)', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }} formatter={value => `${decimal.format(Number(value))} MMcf/hour · derived`} labelFormatter={value => clockLabel(scenario, Number(value))} />
                <ReferenceArea x1={scenario.eventStartHour} x2={scenario.eventEndHour} fill="#5BC0EB" fillOpacity={0.06} />
                {view === 'fleet' ? <><Line name="No program" dataKey="baseline" stroke="#7A869A" dot={false} isAnimationActive={false} /><Line name="Naive morning setback" dataKey="naive" stroke="#F2A541" strokeDasharray="5 3" strokeWidth={2} dot={false} isAnimationActive={false} /><Line name={activeName} dataKey="active" stroke="#5BC0EB" strokeWidth={2} dot={false} isAnimationActive={false} /></> : <><Area name="Relief" dataKey="reliefBand" fill="#30A46C" fillOpacity={0.35} stroke="none" isAnimationActive={false} /><Line name={`${activeName} system demand`} dataKey="system" stroke="#5BC0EB" dot={false} isAnimationActive={false} /><Line name="Without program" dataKey="baselineSystem" stroke="#7A869A" dot={false} isAnimationActive={false} />{overCapacityDays.map(day => <ReferenceArea key={day} x1={day * 24} x2={Math.min(scenario.hours - 1, day * 24 + 23)} fill="#E5484D" fillOpacity={0.08} />)}<ReferenceLine y={deferredConfig.capacityMMcfd / 24} stroke="#F2A541" strokeDasharray="5 3" label={{ value: 'Daily capacity ÷ 24 (average)', position: 'insideTopRight', fill: '#F2A541', fontSize: 10 }} /></>}
                <Line name="Live" dataKey="live" stroke="#E6EDF7" strokeWidth={3} dot={false} connectNulls={false} isAnimationActive={false} />
                <ReferenceLine x={cursor} stroke="#E6EDF7" strokeDasharray="2 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <label className="timeline">Preview hour <input disabled={Boolean(sim)} aria-label="Preview hour" type="range" min={0} max={scenario.hours - 1} step={1} value={cursor} onChange={event => { setPlaying(false); setHour(Number(event.target.value)); }} /><output title="Assumed: selected simulation hour.">{cursor} h</output></label>
          <figcaption>{view === 'fleet' ? `Whole-run net saving: ${decimal.format(run.totals.netSavedMMcf)} MMcf (derived, includes recovery). Naive setbacks shift gas use into recovery; largest rebound is ${decimal.format(recoveryPeak)} MMcf/hour above baseline (derived). Net daily savings include recovery.` : `${(scenario as Scenario & { placeholder?: boolean }).placeholder ? 'System demand is assumed placeholder data. ' : ''}Red shading marks days over capacity. Within-day swings covered by linepack/storage is assumed.`}</figcaption>
        </figure>
      </div>
      <aside className="ops-side" aria-label="Fleet metrics and controls">
        <section className="kpi-grid" aria-label="Fleet metrics">
          <Metric name="Relief on tightest day" value={decimal.format(tightDay.reliefMMcf)} unit="MMcf/day" formula="Net baseline − plan gas across the gas day with the largest no-program demand minus daily capacity. Includes that day’s recovery, exemptions and overrides. Model-derived." />
          <Metric name="Peak-hour relief" value={decimal.format(run.totals.peakHourReliefMMcfh)} unit="MMcf/hour" formula="Baseline − plan fleet gas at the highest-demand event hour. Model-derived; may be negative during recovery." />
          <Metric name="Minimum indoor" value={temperature.format(current.minTaF)} unit="°F" formula="Minimum cohort indoor temperature at the selected preview hour. Model-derived." />
          <Metric name="Homes at floor" value={temperature.format(current.shareAtFloor * 100)} unit="%" formula="Model shareAtFloor × 100 at the selected preview hour; cohorts within 0.1°F of the configured floor." />
          <Metric name="Overrides" value={integer.format(current.overrides)} unit="homes" formula={`Model-estimated overrides at the selected hour. ${constants.raw.override_rate.label}: ${constants.raw.override_rate.source}`} />
          <Metric name="Gas value" value={money.format(Math.round(tightDay.reliefMMcf * 1000 * constants.marginalPriceUsdPerMcf / 100) * 100)} unit="/day" formula={`Tightest-day net relief (MMcf/day) × 1,000 Mcf/MMcf × $${constants.marginalPriceUsdPerMcf}/Mcf; rounded to $100. ${constants.raw.marginal_price_usd_mcf.label}: ${constants.raw.marginal_price_usd_mcf.source}`} />
        </section>
        <section className="panel controls-panel" aria-labelledby="controls-title">
          <div className="panel-heading"><h2 id="controls-title">{connected ? 'Operator controls' : 'Preview controls'}</h2><span className="metric-label">assumed inputs</span></div>
          <div className="controls-grid">
            <label>Scenario<select aria-label="Scenario" value={scenario.id} onChange={event => { const sc = scenarios.find(item => item.id === event.target.value)!; if (connected) void command(api => loadPreset(api, sc, defaultConfig(sc))); else selectScenario(sc); }}>{scenarios.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}</select></label>
            <label>Strategy<select aria-label="Strategy" value={strategy} onChange={event => setStrategy(event.target.value as Strategy)}>{Object.entries(strategyNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {ranges.map(range => <label key={range.key} title={range.note}>{range.label}<output>{(range.unit === '°F' ? temperature : range.unit === 'MMcf/day' ? decimal : integer).format(config[range.key])} {range.unit}</output><input type="range" aria-label={range.label} min={range.min} max={range.max} step={range.step} value={config[range.key]} onChange={event => parameter(range.key, Number(event.target.value))} /></label>)}
            <label title="Assumed: local preview playback speed.">Speed<output>{speed} h/s</output><input type="range" aria-label="Speed" min={0.5} max={4} step={0.5} value={speed} onChange={event => setSpeed(Number(event.target.value))} /></label>
          </div>
          <div className="control-actions">
            <button disabled={busy || (live.status !== 'unconfigured' && !connected)} onClick={demo}>Demo preset</button>
            <button disabled={solving || busy || Boolean(sim && sim.simHour > 0)} title={sim && sim.simHour > 0 ? 'Reset to solve from the start' : 'Find a dispatch plan'} onClick={() => void solve()}>{solving ? `Solving · ${(elapsedMs / 1000).toFixed(1)} s` : 'Solve plan'}</button>
            <button disabled={!connected || !sim || busy || solving || requiresSolve} onClick={() => void command(async api => { await api.setParams({ configJson: JSON.stringify({ ...config, speedHoursPerSec: speed }) }); await (selectedPlan ? dispatchPlan(api, selectedPlan) : dispatchPreview(api, scenario, config, strategy as PreviewStrategy)); })}>Dispatch</button>
            <button disabled={busy || solving || (requiresSolve || Boolean(selectedPlan && sim?.planId && sim.planId !== selectedPlan.id)) || (live.status !== 'unconfigured' && (!connected || !sim))} onClick={() => connected ? void command(async api => { if (!sim?.planId) await (selectedPlan ? dispatchPlan(api, selectedPlan) : dispatchPreview(api, scenario, config, strategy as PreviewStrategy)); await api.start({}); }) : setPlaying(true)}>{connected ? 'Start' : 'Start preview'}</button>
            <button disabled={busy} onClick={() => connected ? void command(api => api.pause({})) : setPlaying(false)}>Pause</button>
            <button disabled={busy} onClick={() => connected ? void command(api => api.reset({})) : (setPlaying(false), setHour(0))}>Reset</button>
            <button disabled={!connected || busy} onClick={() => void command(api => api.resetHouseholds({}))}>Reset households</button>
            {connected && <button disabled={busy || !sim} onClick={() => void command(api => api.setParams({ configJson: JSON.stringify({ ...config, speedHoursPerSec: speed, homesPerDot: config.enrolledHomes / 1000 }) }))}>Apply inputs</button>}
          </div>
          <p className="solve-status" aria-live="polite">{solving ? `Solving · ${(elapsedMs / 1000).toFixed(1)} s` : selectedPlan ? `${selectedPlan.note ?? strategyNames[selectedPlan.strategy]}${selectedPlan.solveMs !== undefined ? ` · ${decimal.format(selectedPlan.solveMs / 1000)} s` : ' · dispatched'}` : ''}</p>
          <p className="control-note">{connected ? busy ? 'Sending command…' : `Connected · ${live.database} · ${sim?.operator?.toHexString() === live.identity ? 'Operator' : 'Viewer' }` : 'Local preview only · no live commands sent.'}</p>
        </section>
        <section className="panel log-panel" aria-labelledby="log-title"><h2 id="log-title">Event log</h2>{events.length ? <ol className="event-list">{events.map(event => <li key={event.id.toString()}><time>{clockLabel(scenario, event.simHour)}</time><span>{event.message}</span></li>)}</ol> : <p>{connected ? 'No events yet. Load Demo preset to begin.' : 'Live joins, overrides and reassignment will appear when connected.'}</p>}</section>
      </aside>
    </div>
  </>;
}
