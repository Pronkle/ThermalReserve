import { useEffect, useMemo, useRef, useState } from 'react';
import { pressureParams, runPlan, curtailedSeriesMMcf, type FleetConfig, type Plan, type Strategy, type ScenarioWithForecasts, type ReplanResult } from '@thermal-reserve/model';
import { buildOpsData, clockLabel, cohorts, constants, defaultConfig, integer, scenarios, temperature } from '../lib/ops';
import { deliveryTicks, livePressure, presets, pressureInputKey, pressurePlanId, pressureView, type PressureInputs, type Preset } from '../lib/pressure-ui';
import { useAggregates, useConnection, useEventLog, useReducers, useSimConfig } from '../lib/stdb';
import { dispatchPlan, dispatchPreview, loadPressurePreset } from '../lib/operator';
import { boundarySpeed, segmentSchedules, forecastChartRows, replanMessage } from '../lib/replan-ui';
import { launchSolve, launchReplan } from '../lib/solver';
import { PressureChart } from '../components/PressureChart';
import { TemperatureChart } from '../components/TemperatureChart';
import { DiscomfortChart } from '../components/DiscomfortChart';
import { StatusSentence, VerdictStrip } from '../components/VerdictStrip';
import { PresetBar } from '../components/PresetBar';
import { JoinQr } from '../components/JoinQr';
import { MainNavigation } from '../components/MainNavigation';
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
  const events = useEventLog(12);
  const [scenario, setScenario] = useState(firstScenario);
  const [config, setConfig] = useState<FleetConfig>(() => ({ ...defaultConfig(firstScenario), enrolledHomes: firstPreset.enrolledHomes }));
  const [input, setInput] = useState<PressureInputs>(() => ({ lostMMcfd: firstPreset.lostMMcfd, reserveIdx: firstPreset.reserveIdx, bufferSigma: numberConstant('forecast_buffer_sigma_default'), planningMode: (firstScenario as ScenarioWithForecasts).forecastRuns?.length ? 'REPLAN' : 'OBSERVED', strategy: 'OPTIMIZED' }));
  const [speed, setSpeed] = useState(2);
  const [hour, setHour] = useState(0);
  const [busy, setBusy] = useState(false);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [cache, setCache] = useState(() => new Map<string, Plan>());
  const [replans, setReplans] = useState(() => new Map<string, ReplanResult>());
  const [dispatchRevision, setDispatchRevision] = useState(0);
  const [replanLog, setReplanLog] = useState<string[]>([]);
  const dispatching = useRef(false);
  const lastDispatch = useRef('');
  const autoFailure = useRef(false);
  const [logOpen, setLogOpen] = useState(false);
  const seenEventId = useRef<bigint | undefined>(undefined);
  const pending = useRef<ReturnType<typeof launchSolve> | ReturnType<typeof launchReplan> | undefined>(undefined);
  const generation = useRef(0);
  const connected = live.status === 'connected';
  const p = useMemo(() => pressureParams(constants, constants.raw, input.lostMMcfd, input.reserveIdx), [input.lostMMcfd, input.reserveIdx]);
  const cfg = useMemo(() => ({ ...config, capacityMMcfd: p.rMMcfd }), [config, p.rMMcfd]);
  const key = pressureInputKey(scenario.id, cfg, input);
  const data = useMemo(() => buildOpsData(scenario, cfg), [scenario, cfg]);
  const remoteTargets = JSON.stringify(live.plans.map(row => [row.cohortId, row.hour, row.targetF]));
  const remote = useMemo<Plan | undefined>(() => {
    // A dispatched re-plan segment is incomplete without the later segments.
    // Only the locally solved full schedule can score a forecast re-plan run.
    if (input.planningMode === 'REPLAN') return;
    if (!sim || sim.scenarioId !== scenario.id || sim.planId !== pressurePlanId(scenario.id, input.strategy, 0, key)) return;
    const targetsF = cohorts.map(() => Array<number>(scenario.hours).fill(NaN));
    for (const [cohortId, h, target] of JSON.parse(remoteTargets) as number[][]) if (targetsF[cohortId]) targetsF[cohortId][h] = target;
    return { id: sim.planId, strategy: input.strategy, targetsF };
  }, [remoteTargets, sim?.planId, sim?.scenarioId, key, scenario, input.strategy, input.planningMode]);
  const replan = replans.get(key);
  const schedules = useMemo(() => segmentSchedules(scenario, key, replan?.segments ?? []), [scenario, key, replan]);
  const forecastRows = useMemo(() => forecastChartRows(scenario, replan?.segments ?? []), [scenario, replan]);
  const hasForecast = Boolean((scenario as ScenarioWithForecasts).forecastRuns?.length);
  const selectedPlan = cache.get(key) ?? remote;
  const dispatchablePlan = schedules[0]?.plan ?? selectedPlan;
  const activeSegment = schedules.filter(item => item.segment.fromHour <= hour).at(-1)?.segment;
  const peakHour = scenario.systemMMcfh.indexOf(Math.max(...scenario.systemMMcfh));
  const peakBufferF = activeSegment ? input.bufferSigma * activeSegment.sigmaF[peakHour] : undefined;
  const planningBasis = input.planningMode === 'OBSERVED' ? 'Plan uses observed weather' : activeSegment?.runIso ? `Forecast issued ${new Date(activeSegment.runIso).toLocaleString('en-US', { timeZone: 'America/Anchorage', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(',', '')} Anchorage · ${input.bufferSigma}σ buffer` : 'Forecast plan not solved';
  const needsSolve = (input.strategy === 'OPTIMIZED' || input.strategy === 'MAX_RELIEF') && !selectedPlan;
  const selectedRun = useMemo(() => selectedPlan ? runPlan(scenario, cohorts, cfg, selectedPlan, constants) : needsSolve ? undefined : data.runs[input.strategy as 'BASELINE' | 'NAIVE_4H' | 'SUSTAIN_STAGGER'], [selectedPlan, needsSolve, scenario, cfg, input.strategy, data]);
  const views = useMemo(() => ({ baseline: pressureView(data.runs.BASELINE, data.runs.BASELINE, cfg, p), naive: pressureView(data.runs.NAIVE_4H, data.runs.BASELINE, cfg, p), active: selectedRun ? pressureView(selectedRun, data.runs.BASELINE, cfg, p) : undefined }), [data, cfg, p, selectedRun]);
  const liveIndex = useMemo(() => sim?.scenarioId === scenario.id ? livePressure(new Map(aggregates.map(row => [row.hour, row.systemMmcf])), scenario.hours, { ...p, rMMcfd: sim.capacityMmcfd }) : [], [aggregates, sim?.scenarioId, sim?.capacityMmcfd, scenario, p]);
  const liveCurtailed = curtailedSeriesMMcf(liveIndex, p);
  const pressureRows = [{ hour: 0, baseline: 100, naive: 100, active: selectedRun ? 100 : undefined, live: aggregates.length ? 100 : undefined }, ...Array.from({ length: scenario.hours }, (_, h) => ({ hour: h + 1, baseline: views.baseline.index[h], naive: views.naive.index[h], active: views.active?.index[h], live: liveIndex[h], planned: replan ? forecastRows[h]?.expected : undefined, curtailed: { baseline: views.baseline.curtailed[h], naive: views.naive.curtailed[h], active: views.active?.curtailed[h], live: liveCurtailed[h] } }))];
  const discomfortRows = Array.from({ length: scenario.hours }, (_, h) => ({ hour: h, active: views.active?.discomfort.meanF[h], worst: views.active?.discomfort.worstF[h], naive: views.naive.discomfort.meanF[h] }));
  useEffect(() => {
    if (!connected) return;
    const latest = events.reduce((id, event) => event.id > id ? event.id : id, 0n);
    if (seenEventId.current !== undefined && events.some(event => event.id > seenEventId.current! && (event.kind === 'join' || event.kind === 'override' && !event.message.includes('sample homes')))) setLogOpen(true);
    seenEventId.current = latest;
  }, [events, connected]);
  useEffect(() => {
    generation.current++; pending.current?.cancel(); setSolving(false);
    return () => { generation.current++; pending.current?.cancel(); };
  }, [key]);
  useEffect(() => { if (sim) { setHour(sim.simHour); if (!replan) setSpeed(sim.speedHoursPerSec); } }, [sim?.simHour, sim?.speedHoursPerSec, replan]);
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
  useEffect(() => {
    if (!reducers || !connected || busy || dispatching.current || autoFailure.current || sim?.status !== 'running' || sim.operator?.toHexString() !== live.identity || !schedules.length) return;
    const current = schedules.findIndex(item => item.plan.id === sim.planId);
    if (current < 0) return;
    const next = schedules[current + 1];
    if (!next) return;
    const gap = next.segment.fromHour - sim.simHour;
    if (gap > 0) {
      // The server advances one batch each second. Shorten that batch to land on
      // a boundary rather than simulating its first hour with the previous plan.
      const pacedSpeed = boundarySpeed(speed, sim.simHour, next.segment.fromHour);
      if (sim.speedHoursPerSec === pacedSpeed) return;
      dispatching.current = true;
      void reducers.setParams({ configJson: JSON.stringify({ speedHoursPerSec: pacedSpeed }) }).catch(failure => { autoFailure.current = true; setError(String(failure)); }).finally(() => { dispatching.current = false; setDispatchRevision(value => value + 1); });
      return;
    }
    if (lastDispatch.current === next.plan.id) return;
    dispatching.current = true;
    setBusy(true);
    void (async () => {
      await reducers.pause({});
      await dispatchPlan(reducers, next.plan);
      lastDispatch.current = next.plan.id;
      setReplanLog(previous => [replanMessage(scenario, next.segment), ...previous].slice(0, 12));
      const following = schedules[current + 2];
      await reducers.setParams({ configJson: JSON.stringify({ speedHoursPerSec: following ? boundarySpeed(speed, sim.simHour, following.segment.fromHour) : speed }) });
      await reducers.start({});
    })().catch(failure => { autoFailure.current = true; setError(failure instanceof Error ? failure.message : String(failure)); }).finally(() => { dispatching.current = false; setBusy(false); setDispatchRevision(value => value + 1); });
  }, [sim?.simHour, sim?.planId, sim?.status, sim?.speedHoursPerSec, schedules, reducers, connected, busy, live.identity, scenario, speed, dispatchRevision]);
  async function solveFor(sc = scenario, nextCfg = cfg, nextInput = input) {
    const attempt = ++generation.current;
    pending.current?.cancel(); setSolving(true); setError(''); setElapsed(0);
    const start = performance.now();
    const timer = setInterval(() => setElapsed(performance.now() - start), 50);
    const nextPressure = pressureParams(constants, constants.raw, nextInput.lostMMcfd, nextInput.reserveIdx);
    const actualCfg = { ...nextCfg, capacityMMcfd: nextPressure.rMMcfd };
    const nextKey = pressureInputKey(sc.id, actualCfg, nextInput);
    try {
      const forecastSolve = nextInput.planningMode !== 'OBSERVED';
      pending.current = forecastSolve ? launchReplan({ sc, cohorts, cfg: actualCfg, consts: constants, p: nextPressure, opts: { mode: nextInput.planningMode, bufferSigma: nextInput.bufferSigma, strategy: nextInput.strategy === 'MAX_RELIEF' ? 'MAX_RELIEF' : 'OPTIMIZED', policy: { kind: 'SCHEDULED_PLUS_DRIFT', driftTempF: Infinity, driftHours: numberConstant('drift_hours'), driftPressureIdx: Infinity, driftFadeH: numberConstant('drift_fade_h') } } }) : launchSolve({ sc, cohorts, cfg: actualCfg, mode: nextInput.strategy === 'MAX_RELIEF' ? 'MAX_RELIEF' : 'OPTIMIZED', consts: constants, opts: { pressure: nextPressure } });
      const solved = await pending.current.result;
      if (attempt !== generation.current) return;
      const result = 'segments' in solved ? solved : undefined;
      if (result) setReplans(previous => { const next = new Map(previous).set(nextKey, result); while (next.size > 10) next.delete(next.keys().next().value!); return next; });
      const plan = { ...(result ? result.plan : solved as Plan), id: pressurePlanId(sc.id, nextInput.strategy, 0, nextKey) };
      setCache(previous => { const next = new Map(previous); next.set(nextKey, plan); while (next.size > 10) next.delete(next.keys().next().value!); return next; });
      setElapsed(performance.now() - start);
      return result ? segmentSchedules(sc, nextKey, result.segments)[0]?.plan ?? plan : plan;
    } catch (failure) { if (attempt === generation.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { clearInterval(timer); if (attempt === generation.current) setSolving(false); }
  }
  async function preset(value: Preset, resetHouseholds = false) {
    const sc = scenarios.find(item => item.id === value.scenarioId)!;
    const nextInput: PressureInputs = { ...input, lostMMcfd: value.lostMMcfd, reserveIdx: value.reserveIdx, strategy: 'OPTIMIZED', bufferSigma: numberConstant('forecast_buffer_sigma_default'), planningMode: (sc as ScenarioWithForecasts).forecastRuns?.length ? 'REPLAN' : 'OBSERVED' };
    const nextCfg = { ...defaultConfig(sc), enrolledHomes: value.enrolledHomes, capacityMMcfd: pressureParams(constants, constants.raw, value.lostMMcfd, value.reserveIdx).rMMcfd };
    autoFailure.current = false; lastDispatch.current = ''; setReplanLog([]); setScenario(sc); setConfig(nextCfg); setInput(nextInput); setSpeed(2); setHour(0);
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
  return <div className="pressure-grid"><aside className="pressure-side">
    <div className="ops-heading pressure-heading console-brand-row"><img className="console-logo" src="/borea-flux-logo.webp" alt="BoreaFlux" width={960} height={145} /><JoinQr /></div>
    <MainNavigation />
    <h1>Operator console</h1>
    <StatusSentence summary={views.active?.summary} reserve={input.reserveIdx} />
    {live.status === 'disconnected' && <p className="connection-banner" role="status">Disconnected — retrying</p>}
    {selectedPlan?.note && <p className="fallback-banner" role="status">Rule-based fallback in use · Staggered</p>}
    {error && <p className="connection-banner" role="alert">{error}</p>}
    <VerdictStrip summary={views.active?.summary} baseline={views.baseline.summary} degreeHours={views.active?.degreeHours} reserve={input.reserveIdx} planningBasis={null} />
      <section className="panel pressure-controls" aria-label={connected ? 'Operator controls' : 'Preview controls'}>
        <div className="control-group control-group-situation"><h2>Situation</h2>
          <div className="preset-row"><PresetBar busy={busy || solving || noLiveInputs} onPreset={value => void preset(value)} /><button disabled={busy || solving || noLiveInputs} onClick={() => void preset(firstPreset, true)}>Reset demo</button></div>
          <div className="control-row"><label>Scenario<select aria-label="Scenario" value={scenario.id} onChange={event => { const sc = scenarios.find(item => item.id === event.target.value)!; setScenario(sc); setConfig(defaultConfig(sc)); setHour(0); }} >{scenarios.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}</select></label></div>
          <label className="delivery-control" title="Assumed scenario loss. Maximum delivery = Feb 2024 deliverability minus selected loss; usable linepack stays fixed.">Deliverability lost vs Feb 2024<output>{input.lostMMcfd.toFixed(1)} MMcf/day</output><input aria-label="Deliverability lost vs Feb 2024" type="range" min={0} max={17.5} step={0.5} list="delivery-ticks" value={input.lostMMcfd} onChange={event => setInput(previous => ({ ...previous, lostMMcfd: Number(event.target.value) }))} /><datalist id="delivery-ticks">{deliveryTicks.map(tick => <option key={tick.lostMMcfd} value={tick.lostMMcfd} label={tick.label} />)}</datalist><div className="delivery-ticks">{deliveryTicks.map(tick => <span key={tick.lostMMcfd} title={`${tick.label_kind}: ${tick.source}`}>{tick.lostMMcfd} · {tick.label}</span>)}</div></label>
        </div>
        <div className="control-group"><h2>Run</h2>
          <div className="control-actions primary-actions"><button disabled={busy || solving} onClick={() => void solveFor()}>{solving ? `Solving · ${(elapsed / 1000).toFixed(1)} s` : 'Solve plan'}</button><button disabled={!connected || busy || solving || needsSolve} onClick={() => void command(async api => { if (sim?.scenarioId !== scenario.id) await loadPressurePreset(api, scenario, cfg); await api.setParams({ configJson: JSON.stringify({ ...cfg, speedHoursPerSec: speed }) }); await (dispatchablePlan ? dispatchPlan(api, dispatchablePlan) : dispatchPreview(api, scenario, cfg, input.strategy as 'BASELINE' | 'NAIVE_4H' | 'SUSTAIN_STAGGER')); })}>Dispatch</button><button disabled={!connected || busy || solving || needsSolve || (selectedPlan ? !schedules.some(item => item.plan.id === sim?.planId) && sim?.planId !== selectedPlan.id : sim?.strategy !== input.strategy)} onClick={() => { autoFailure.current = false; void command(api => api.start({})); }}>Start</button><button disabled={!connected || busy} onClick={() => void command(api => api.pause({}))}>Pause</button></div>
          <div className="run-row"><label>Speed<output>{speed} h/s</output><input aria-label="Speed" type="range" min={0.5} max={4} step={0.5} value={speed} onChange={event => setSpeed(Number(event.target.value))} /></label><div className="run-status"><p className="solve-status" aria-live="polite">{solving ? `Solving · ${(elapsed / 1000).toFixed(1)} s` : selectedPlan ? `${names[input.strategy]} · ${((selectedPlan.solveMs ?? elapsed) / 1000).toFixed(2)} s` : needsSolve ? 'Not solved for these inputs: press Solve plan' : ''}</p><p className="control-note" title={connected ? `Connected · ${live.database} · ${sim?.operator?.toHexString() === live.identity ? 'Operator' : 'Viewer'}` : undefined}>{busy ? 'Sending command…' : connected ? `Connected · ${live.database} · ${sim?.operator?.toHexString() === live.identity ? 'Operator' : 'Viewer'}` : 'Local model preview'}</p></div></div>
        </div>
        <div className="control-group"><h2>Plan</h2>
          <p className="planning-basis">{planningBasis} <span className="metric-label">Modeled planning basis</span></p>
          <div className="control-row two"><label>Strategy<select aria-label="Strategy" value={input.strategy} onChange={event => setInput(previous => ({ ...previous, strategy: event.target.value as Strategy }))}>{Object.entries(names).filter(([value]) => value !== 'SUSTAIN_STAGGER').map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label><label className="planning-control">Planning mode<select aria-label="Planning mode" value={input.planningMode} onChange={event => setInput(previous => ({ ...previous, planningMode: event.target.value as PressureInputs['planningMode'] }))}><option value="OBSERVED">Observed weather</option><option value="SINGLE" disabled={!hasForecast}>One forecast</option><option value="REPLAN" disabled={!hasForecast}>Forecast + re-plans</option></select></label></div>
          <div className="control-row two"><label title={`${constants.raw.reserve_default_idx.label}: ${constants.raw.reserve_default_idx.source}`}>Reserve<output>{input.reserveIdx} index points</output><input aria-label="Reserve" type="range" min={5} max={20} step={1} value={input.reserveIdx} onChange={event => setInput(previous => ({ ...previous, reserveIdx: Number(event.target.value) }))} /></label><label title="Assumed: planning temperature = forecast minus buffer times forecast spread.">Cold buffer<output title="Derived: buffer times forecast spread at the peak-demand hour.">{peakBufferF === undefined ? '—' : temperature.format(peakBufferF)}°F at peak</output><select aria-label="Cold buffer" value={input.bufferSigma} disabled={input.planningMode === 'OBSERVED'} onChange={event => setInput(previous => ({ ...previous, bufferSigma: Number(event.target.value) }))}>{Array.from({ length: 9 }, (_, i) => i / 4).map(value => <option key={value} value={value}>{value}σ</option>)}</select></label></div>
        </div>
        <div className="control-group control-group-quiet"><h2>Fleet</h2>
          <div className="control-row three"><label title="Assumed participation; no measured thermostat penetration is claimed.">Enrolled homes<output>{integer.format(cfg.enrolledHomes)} homes</output><input aria-label="Enrolled homes" type="range" min={5000} max={50000} step={1000} value={cfg.enrolledHomes} onChange={event => param('enrolledHomes', Number(event.target.value))} /></label><label title={`${constants.raw.max_depth_default_f.label}: ${constants.raw.max_depth_default_f.source}`}>Max setback<output>{cfg.maxDepthF}°F</output><input aria-label="Max setback" type="range" min={2} max={10} step={1} value={cfg.maxDepthF} onChange={event => param('maxDepthF', Number(event.target.value))} /></label><label title={`${constants.raw.floor_default_f.label}: ${constants.raw.floor_default_f.source}`}>Comfort floor<output>{cfg.floorF}°F</output><input aria-label="Comfort floor" type="range" min={constants.floorMinF} max={66} step={1} value={cfg.floorF} onChange={event => param('floorF', Number(event.target.value))} /></label></div>
        </div>
        <div className="control-actions secondary-actions"><button disabled={!connected || busy} onClick={() => void command(api => api.setParams({ configJson: JSON.stringify({ ...cfg, speedHoursPerSec: speed }) }))}>Apply inputs</button><button disabled={!connected || busy} onClick={() => void command(api => api.reset({}))}>Reset</button><button disabled={!connected || busy} onClick={() => void command(api => api.resetHouseholds({}))}>Reset households</button></div>
      </section>
      <details className="panel log-panel" open={logOpen} onToggle={event => setLogOpen(event.currentTarget.open)}><summary>Event log <span aria-hidden="true">{logOpen ? '▾' : '▸'}</span></summary>{replanLog.length > 0 && <ol className="event-list">{replanLog.map((message, i) => <li key={i}><span>{message}</span></li>)}</ol>}{events.length ? <ol className="event-list">{events.map(event => <li key={event.id.toString()}><time>{clockLabel(scenario, event.simHour)}</time><span>{event.message}</span></li>)}</ol> : <p>No events yet. Load a preset to begin.</p>}</details>
    </aside>
    <div className="pressure-charts">
      <div className="pressure-chart-slot"><PressureChart selectedName={names[input.strategy]} rows={pressureRows} scenario={scenario} reserve={input.reserveIdx} summary={views.active?.summary} baseline={views.baseline.summary} caption={views.active ? `${names[input.strategy]}: lowest modeled pressure ${integer.format(views.active.summary.minIndex)} index points; ${views.active.summary.curtailedMMcf.toFixed(1)} MMcf curtailed. Derived from the full cold snap.` : 'Plan results stay blank until solved for these inputs.'} /></div>
      <div className="pressure-chart-slot"><TemperatureChart scenario={scenario} rows={forecastRows} segments={replan?.segments} /></div>
      <div className="pressure-chart-slot"><DiscomfortChart rows={discomfortRows} scenario={scenario} maxDepthF={cfg.maxDepthF} degreeHours={views.active?.degreeHours} minIndoorF={views.active?.minIndoorF} holdingHours={views.active?.holdingHours} /></div>
    </div>
  </div>;
}
