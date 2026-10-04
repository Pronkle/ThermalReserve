import { useEffect, useMemo, useRef, useState } from 'react';
import { pressureParams, runPlan, curtailedSeriesMMcf, type FleetConfig, type Plan, type Strategy } from '@thermal-reserve/model';
import { buildOpsData, clockLabel, cohorts, constants, defaultConfig, integer, scenarios, temperature } from '../lib/ops';
import { deliveryTicks, livePressure, presets, pressureInputKey, pressurePlanId, pressureView, type PressureInputs, type Preset } from '../lib/pressure-ui';
import { useAggregates, useConnection, useEventLog, useReducers, useSampleHomes, useSimConfig } from '../lib/stdb';
import { dispatchPlan, dispatchPreview, loadPressurePreset } from '../lib/operator';
import { launchSolve } from '../lib/solver';
import { PressureChart } from '../components/PressureChart';
import { TemperatureChart } from '../components/TemperatureChart';
import { DiscomfortChart } from '../components/DiscomfortChart';
import { StatusSentence, VerdictStrip } from '../components/VerdictStrip';
import { PresetBar } from '../components/PresetBar';
import { JoinQr } from '../components/JoinQr';
import { MapPreview } from '../components/MapPreview';
import { GasOps } from './GasOps';
import './pressure.css';
const names: Record<Strategy, string> = { BASELINE: 'No program', NAIVE_4H: 'Naive 4-hour', SUSTAIN_STAGGER: 'Staggered', OPTIMIZED: 'Optimized', MAX_RELIEF: 'Max relief' };
const numberConstant = (key: string) => Number(constants.raw[key].value);
const firstPreset = presets.find(preset => preset.id === 'nearmiss')!;
const firstScenario = scenarios.find(scenario => scenario.id === firstPreset?.scenarioId) ?? scenarios[0];
export function PressureOps() {
  const live = useConnection();
  const sim = useSimConfig();
  const reducers = useReducers();
  const aggregates = useAggregates();
  const samples = useSampleHomes();
  const events = useEventLog(12);
  const [scenario, setScenario] = useState(firstScenario);
  const [config, setConfig] = useState<FleetConfig>(() => ({ ...defaultConfig(firstScenario), enrolledHomes: firstPreset.enrolledHomes }));
  const [input, setInput] = useState<PressureInputs>(() => ({ lostMMcfd: firstPreset.lostMMcfd, reserveIdx: firstPreset.reserveIdx, bufferSigma: 0, planningMode: 'OBSERVED', strategy: 'OPTIMIZED' }));
  const [speed, setSpeed] = useState(2);
  const [hour, setHour] = useState(0);
  const [busy, setBusy] = useState(false);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [cache, setCache] = useState(() => new Map<string, Plan>());
  const [gasOpen, setGasOpen] = useState(false);
  const pending = useRef<ReturnType<typeof launchSolve> | undefined>(undefined);
  const generation = useRef(0);
  const connected = live.status === 'connected';
  const p = useMemo(() => pressureParams(constants, constants.raw, input.lostMMcfd, input.reserveIdx), [input.lostMMcfd, input.reserveIdx]);
  const cfg = useMemo(() => ({ ...config, capacityMMcfd: p.rMMcfd }), [config, p.rMMcfd]);
  const key = pressureInputKey(scenario.id, cfg, input);
  const data = useMemo(() => buildOpsData(scenario, cfg), [scenario, cfg]);
  const remoteTargets = JSON.stringify(live.plans.map(row => [row.cohortId, row.hour, row.targetF]));
  const remote = useMemo<Plan | undefined>(() => {
    if (!sim || sim.scenarioId !== scenario.id || sim.planId !== pressurePlanId(scenario.id, input.strategy, 0, key)) return;
    const targetsF = cohorts.map(() => Array<number>(scenario.hours).fill(NaN));
    for (const [cohortId, h, target] of JSON.parse(remoteTargets) as number[][]) if (targetsF[cohortId]) targetsF[cohortId][h] = target;
    return { id: sim.planId, strategy: input.strategy, targetsF };
  }, [remoteTargets, sim?.planId, sim?.scenarioId, key, scenario, input.strategy]);
  const selectedPlan = cache.get(key) ?? remote;
  const needsSolve = (input.strategy === 'OPTIMIZED' || input.strategy === 'MAX_RELIEF') && !selectedPlan;
  const selectedRun = useMemo(() => selectedPlan ? runPlan(scenario, cohorts, cfg, selectedPlan, constants) : needsSolve ? undefined : data.runs[input.strategy as 'BASELINE' | 'NAIVE_4H' | 'SUSTAIN_STAGGER'], [selectedPlan, needsSolve, scenario, cfg, input.strategy, data]);
  const views = useMemo(() => ({ baseline: pressureView(data.runs.BASELINE, data.runs.BASELINE, cfg, p), naive: pressureView(data.runs.NAIVE_4H, data.runs.BASELINE, cfg, p), staggered: pressureView(data.runs.SUSTAIN_STAGGER, data.runs.BASELINE, cfg, p), active: selectedRun ? pressureView(selectedRun, data.runs.BASELINE, cfg, p) : undefined }), [data, cfg, p, selectedRun]);
  const liveIndex = useMemo(() => sim?.scenarioId === scenario.id ? livePressure(new Map(aggregates.map(row => [row.hour, row.systemMmcf])), scenario.hours, { ...p, rMMcfd: sim.capacityMmcfd }) : [], [aggregates, sim?.scenarioId, sim?.capacityMmcfd, scenario, p]);
  const liveCurtailed = curtailedSeriesMMcf(liveIndex, p);
  const pressureRows = [{ hour: 0, baseline: 100, naive: 100, staggered: 100, active: selectedRun ? 100 : undefined, live: aggregates.length ? 100 : undefined }, ...Array.from({ length: scenario.hours }, (_, h) => ({ hour: h + 1, baseline: views.baseline.index[h], naive: views.naive.index[h], staggered: views.staggered.index[h], active: views.active?.index[h], live: liveIndex[h], curtailed: { baseline: views.baseline.curtailed[h], naive: views.naive.curtailed[h], staggered: views.staggered.curtailed[h], active: views.active?.curtailed[h], live: liveCurtailed[h] } }))];
  const discomfortRows = Array.from({ length: scenario.hours }, (_, h) => ({ hour: h, active: views.active?.discomfort.meanF[h], worst: views.active?.discomfort.worstF[h], naive: views.naive.discomfort.meanF[h], staggered: views.staggered.discomfort.meanF[h] }));
  const cursor = Math.max(0, Math.min(scenario.hours - 1, Math.floor(hour)));
  const mapRun = selectedRun ?? data.runs.BASELINE;
  const mapHomes = sim?.status === 'running' && samples.length ? samples.map(home => ({ ...home, overrideHour: home.overridden ? 0 : null })) : data.homes;
  useEffect(() => {
    generation.current++; pending.current?.cancel(); setSolving(false);
    return () => { generation.current++; pending.current?.cancel(); };
  }, [key]);
  useEffect(() => { if (sim) { setHour(sim.simHour); setSpeed(sim.speedHoursPerSec); } }, [sim?.simHour, sim?.speedHoursPerSec]);
  const remoteConfig = sim ? JSON.stringify([sim.scenarioId, sim.enrolledHomes, sim.exemptShare, sim.floorF, sim.maxDepthF, sim.overrideRate, sim.capacityMmcfd]) : '';
  useEffect(() => {
    if (!sim) return;
    const sc = scenarios.find(item => item.id === sim.scenarioId);
    if (sc) setScenario(sc);
    setConfig(previous => ({ ...previous, enrolledHomes: sim.enrolledHomes, exemptShare: sim.exemptShare, floorF: sim.floorF, maxDepthF: sim.maxDepthF, overrideRate: sim.overrideRate }));
    setInput(previous => ({ ...previous, lostMMcfd: numberConstant('deliverability_2024_mmcfd') - sim.capacityMmcfd }));
  }, [remoteConfig]);
  async function command(action: (api: NonNullable<typeof reducers>) => Promise<void>) {
    if (!reducers || busy) return;
    setBusy(true); setError('');
    try {
      if (sim?.operator?.toHexString() !== live.identity) {
        const passcode = window.prompt('Operator passcode');
        if (passcode === null) return;
        await reducers.claimOperator({ passcode });
      }
      await action(reducers);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  async function solveFor(sc = scenario, nextCfg = cfg, nextInput = input) {
    const attempt = ++generation.current;
    pending.current?.cancel(); setSolving(true); setError(''); setElapsed(0);
    const start = performance.now();
    const timer = setInterval(() => setElapsed(performance.now() - start), 50);
    const nextPressure = pressureParams(constants, constants.raw, nextInput.lostMMcfd, nextInput.reserveIdx);
    const actualCfg = { ...nextCfg, capacityMMcfd: nextPressure.rMMcfd };
    const nextKey = pressureInputKey(sc.id, actualCfg, nextInput);
    try {
      pending.current = launchSolve({ sc, cohorts, cfg: actualCfg, mode: nextInput.strategy === 'MAX_RELIEF' ? 'MAX_RELIEF' : 'OPTIMIZED', consts: constants, opts: { pressure: nextPressure } });
      const solved = await pending.current.result;
      if (attempt !== generation.current) return;
      const plan = { ...solved, id: pressurePlanId(sc.id, nextInput.strategy, 0, nextKey) };
      setCache(previous => { const next = new Map(previous); next.set(nextKey, plan); while (next.size > 10) next.delete(next.keys().next().value!); return next; });
      setElapsed(performance.now() - start);
      return plan;
    } catch (failure) { if (attempt === generation.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { clearInterval(timer); if (attempt === generation.current) setSolving(false); }
  }
  async function preset(value: Preset, resetHouseholds = false) {
    const sc = scenarios.find(item => item.id === value.scenarioId)!;
    const nextInput: PressureInputs = { ...input, lostMMcfd: value.lostMMcfd, reserveIdx: value.reserveIdx, strategy: 'OPTIMIZED', planningMode: 'OBSERVED' };
    const nextCfg = { ...defaultConfig(sc), enrolledHomes: value.enrolledHomes, capacityMMcfd: pressureParams(constants, constants.raw, value.lostMMcfd, value.reserveIdx).rMMcfd };
    setScenario(sc); setConfig(nextCfg); setInput(nextInput); setSpeed(2); setHour(0);
    // Let React install the new solve key before starting this preset's solve.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const plan = await solveFor(sc, nextCfg, nextInput);
    if (!plan || !connected) return;
    await command(async api => {
      await api.pause({});
      if (resetHouseholds) await api.resetHouseholds({});
      await loadPressurePreset(api, sc, nextCfg);
      await dispatchPlan(api, plan);
      await api.pause({});
    });
  }
  function param(field: keyof FleetConfig, value: number) { setConfig(previous => ({ ...previous, [field]: value })); }
  const noLiveInputs = !connected && live.status !== 'unconfigured';
  return <>
    <div className="ops-heading pressure-heading"><div><p className="eyebrow">{connected ? `Live · ${live.database}` : 'Local model preview'}</p><h1>Operator console</h1></div><div className="clock-status"><strong>{clockLabel(scenario, hour)}</strong><span>{scenario.name} · {input.lostMMcfd.toFixed(1)} MMcf/day less supply <span className="metric-label">assumed</span></span><span>{sim?.status ?? 'Preview paused'} · {names[input.strategy]}</span></div><JoinQr /></div>
    <StatusSentence summary={views.active?.summary} reserve={input.reserveIdx} />
    {live.status === 'disconnected' && <p className="connection-banner" role="status">Disconnected — retrying</p>}
    {selectedPlan?.note && <p className="fallback-banner" role="status">Rule-based fallback in use · Staggered</p>}
    {error && <p className="connection-banner" role="alert">{error}</p>}
    <VerdictStrip summary={views.active?.summary} baseline={views.baseline.summary} degreeHours={views.active?.degreeHours} reserve={input.reserveIdx} />
    <div className="pressure-grid"><div className="pressure-charts">
      <PressureChart rows={pressureRows} scenario={scenario} reserve={input.reserveIdx} summary={views.active?.summary} baseline={views.baseline.summary} caption={views.active ? `${names[input.strategy]}: lowest modeled pressure ${integer.format(views.active.summary.minIndex)} index points; ${views.active.summary.curtailedMMcf.toFixed(1)} MMcf curtailed. Derived from the full cold snap.` : 'Plan results stay blank until solved for these inputs.'} />
      <TemperatureChart scenario={scenario} />
      <DiscomfortChart rows={discomfortRows} scenario={scenario} maxDepthF={cfg.maxDepthF} degreeHours={views.active?.degreeHours} minIndoorF={views.active?.minIndoorF} />
    </div><aside className="pressure-side">
      <section className="panel pressure-map"><div className="panel-heading"><h2>Anchorage fleet</h2><span className="metric-label">assumed participation</span></div><div className="map-frame"><MapPreview homes={mapHomes} run={mapRun} hour={cursor} /></div><div className="map-legend"><span><i className="dot normal" />Normal</span><span><i className="dot holding" />Holding</span><span><i className="dot recovering" />Recovering</span><span><i className="dot overridden" />Override</span><span><i className="dot exempt" />Exempt</span><span><i className="dot household" />Household</span></div><p className="map-caption">Each dot ≈ {integer.format(cfg.enrolledHomes / data.homes.length)} homes · assumed</p></section>
      <section className="panel pressure-controls"><h2>{connected ? 'Operator controls' : 'Preview controls'}</h2><PresetBar busy={busy || solving || noLiveInputs} onPreset={value => void preset(value)} /><div className="controls-grid">
        <label>Scenario<select aria-label="Scenario" value={scenario.id} onChange={event => { const sc = scenarios.find(item => item.id === event.target.value)!; setScenario(sc); setConfig(defaultConfig(sc)); setHour(0); }} >{scenarios.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}</select></label>
        <label>Strategy<select aria-label="Strategy" value={input.strategy} onChange={event => setInput(previous => ({ ...previous, strategy: event.target.value as Strategy }))}>{Object.entries(names).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label>
        <label className="delivery-control" title="Assumed scenario loss. Maximum delivery = Feb 2024 deliverability minus selected loss; usable linepack stays fixed.">Deliverability lost vs Feb 2024<output>{input.lostMMcfd.toFixed(1)} MMcf/day</output><input aria-label="Deliverability lost vs Feb 2024" type="range" min={0} max={35} step={0.5} list="delivery-ticks" value={input.lostMMcfd} onChange={event => setInput(previous => ({ ...previous, lostMMcfd: Number(event.target.value) }))} /><datalist id="delivery-ticks">{deliveryTicks.map(tick => <option key={tick.lostMMcfd} value={tick.lostMMcfd} label={tick.label} />)}</datalist><div className="delivery-ticks">{deliveryTicks.map(tick => <span key={tick.lostMMcfd} title={`${tick.label_kind}: ${tick.source}`}>{tick.lostMMcfd} · {tick.label}</span>)}</div></label>
        <label title="Assumed participation; no measured thermostat penetration is claimed.">Enrolled homes<output>{integer.format(cfg.enrolledHomes)} homes</output><input aria-label="Enrolled homes" type="range" min={5000} max={50000} step={1000} value={cfg.enrolledHomes} onChange={event => param('enrolledHomes', Number(event.target.value))} /></label>
        <label title={`${constants.raw.reserve_default_idx.label}: ${constants.raw.reserve_default_idx.source}`}>Reserve<output>{input.reserveIdx} index points</output><input aria-label="Reserve" type="range" min={5} max={20} step={1} value={input.reserveIdx} onChange={event => setInput(previous => ({ ...previous, reserveIdx: Number(event.target.value) }))} /></label>
        <label title={`${constants.raw.max_depth_default_f.label}: ${constants.raw.max_depth_default_f.source}`}>Max setback<output>{cfg.maxDepthF}°F</output><input aria-label="Max setback" type="range" min={2} max={10} step={1} value={cfg.maxDepthF} onChange={event => param('maxDepthF', Number(event.target.value))} /></label>
        <label title={`${constants.raw.floor_default_f.label}: ${constants.raw.floor_default_f.source}`}>Comfort floor<output>{cfg.floorF}°F</output><input aria-label="Comfort floor" type="range" min={constants.floorMinF} max={66} step={1} value={cfg.floorF} onChange={event => param('floorF', Number(event.target.value))} /></label>
        <label>Speed<output>{speed} h/s</output><input aria-label="Speed" type="range" min={0.5} max={4} step={0.5} value={speed} onChange={event => setSpeed(Number(event.target.value))} /></label>
      </div><div className="control-actions">
        <button disabled={busy || solving || Boolean(sim && sim.simHour > 0)} onClick={() => void solveFor()}>{solving ? `Solving · ${(elapsed / 1000).toFixed(1)} s` : 'Solve plan'}</button>
        <button disabled={!connected || busy || solving || needsSolve} onClick={() => void command(async api => { if (sim?.scenarioId !== scenario.id) await loadPressurePreset(api, scenario, cfg); await api.setParams({ configJson: JSON.stringify({ ...cfg, speedHoursPerSec: speed }) }); await (selectedPlan ? dispatchPlan(api, selectedPlan) : dispatchPreview(api, scenario, cfg, input.strategy as 'BASELINE' | 'NAIVE_4H' | 'SUSTAIN_STAGGER')); })}>Dispatch</button>
        <button disabled={!connected || busy || solving || needsSolve || (selectedPlan ? sim?.planId !== selectedPlan.id : sim?.strategy !== input.strategy)} onClick={() => void command(api => api.start({}))}>Start</button>
        <button disabled={!connected || busy} onClick={() => void command(api => api.pause({}))}>Pause</button>
        <button disabled={busy || solving || noLiveInputs} onClick={() => void preset(firstPreset, true)}>Reset demo</button>
        <button disabled={!connected || busy} onClick={() => void command(api => api.reset({}))}>Reset</button>
        <button disabled={!connected || busy} onClick={() => void command(api => api.resetHouseholds({}))}>Reset households</button>
        <button disabled={!connected || busy} onClick={() => void command(api => api.setParams({ configJson: JSON.stringify({ ...cfg, speedHoursPerSec: speed }) }))}>Apply inputs</button>
      </div><p className="solve-status" aria-live="polite">{solving ? `Solving · ${(elapsed / 1000).toFixed(1)} s` : selectedPlan ? `${names[input.strategy]} · ${((selectedPlan.solveMs ?? elapsed) / 1000).toFixed(2)} s` : needsSolve ? 'Not solved for these inputs: press Solve plan' : ''}</p><p className="control-note">{busy ? 'Sending command…' : connected ? `Connected · ${live.database} · ${sim?.operator?.toHexString() === live.identity ? 'Operator' : 'Viewer'}` : 'Local model preview'}</p></section>
      <section className="panel log-panel"><h2>Event log</h2>{events.length ? <ol className="event-list">{events.map(event => <li key={event.id.toString()}><time>{clockLabel(scenario, event.simHour)}</time><span>{event.message}</span></li>)}</ol> : <p>No events yet. Load a preset to begin.</p>}</section>
      <details className="gas-drawer-toggle panel" onToggle={event => setGasOpen(event.currentTarget.open)}><summary>Gas details (MMcf)</summary>{gasOpen && <GasOps region="details" preview={{ scenario, config: cfg, strategy: input.strategy, plan: selectedPlan, hour: cursor }} />}</details>
    </aside></div>
  </>;
}
