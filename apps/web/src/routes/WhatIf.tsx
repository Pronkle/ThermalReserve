import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { loadConstants, whatIf, type ConstantsJson, type WhatIfInput } from '@thermal-reserve/model';
import raw from '../../../../data/constants.json';
import { Metric } from '../components/Metric';
import './public.css';

const constants = loadConstants(raw as ConstantsJson);

// Ranges and defaults from AGENTS.md Section 3; 16.7% of ~150,000 customers ≈ 25,000 homes.
const fields: { key: keyof WhatIfInput; param: string; label: string; min: number; max: number; step: number; initial: number; unit: string }[] = [
  { key: 'participationPct', param: 'p', label: 'Participation', min: 0, max: 50, step: 0.1, initial: 16.7, unit: '% of customers' },
  { key: 'setbackF', param: 'setback', label: 'Setback', min: 1, max: 10, step: 1, initial: 5, unit: '°F' },
  { key: 'outdoorF', param: 'outdoor', label: 'Outdoor temperature', min: -40, max: 30, step: 1, initial: -20, unit: '°F' },
  { key: 'days', param: 'days', label: 'Cold-snap length', min: 1, max: 10, step: 1, initial: 3, unit: 'days' },
  { key: 'tier2Pct', param: 'tier2', label: 'Tier 2 pledged homes', min: 0, max: 50, step: 1, initial: 0, unit: '% of customers' },
];

const two = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const one = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function readInput(params: URLSearchParams): WhatIfInput {
  const input = {} as WhatIfInput;
  for (const f of fields) {
    const v = Number(params.get(f.param));
    input[f.key] = params.has(f.param) && Number.isFinite(v) ? Math.min(f.max, Math.max(f.min, v)) : f.initial;
  }
  return input;
}

export function WhatIf() {
  const [params, setParams] = useSearchParams();
  const input = readInput(params);
  const result = useMemo(() => whatIf(input, constants), [input.participationPct, input.setbackF, input.outdoorF, input.days, input.tier2Pct]);
  const homes = (constants.customers * input.participationPct) / 100;

  function update(key: keyof WhatIfInput, value: number) {
    const next = new URLSearchParams(params);
    const f = fields.find((x) => x.key === key)!;
    if (value === f.initial) next.delete(f.param);
    else next.set(f.param, String(value));
    setParams(next, { replace: true });
  }

  const lbl = (key: string) => constants.raw[key]?.label ?? 'assumed';
  return <section className="panel public-page">
    <p className="eyebrow">Explore participation</p>
    <h1>What-if calculator</h1>
    <p className="public-lede">How much gas could a sustained thermostat setback free up on Southcentral Alaska's coldest days? Move the sliders; every result shows its formula and sources. The link updates as you go, so you can share a scenario.</p>

    <form className="whatif-inputs" aria-label="What-if inputs" onSubmit={(e) => e.preventDefault()}>
      {fields.map((f) => <label key={f.key} className="whatif-field">
        <span className="whatif-field-name">{f.label}<output>{f.key === 'participationPct' ? one.format(input[f.key]) : whole.format(input[f.key])} {f.unit}</output></span>
        <input type="range" min={f.min} max={f.max} step={f.step} value={input[f.key]} aria-label={f.label} onChange={(e) => update(f.key, Number(e.target.value))} />
        {f.key === 'participationPct' && <span className="whatif-hint">≈ {whole.format(homes)} homes of {whole.format(constants.customers)} customers <span className="metric-label">{lbl('customers')}</span></span>}
        {f.key === 'tier2Pct' && <span className="whatif-hint">Homes that pledge to turn down by hand, counted at {whole.format(constants.tier2Effectiveness * 100)}% effectiveness <span className="metric-label">{lbl('tier2_effectiveness')}</span></span>}
      </label>)}
    </form>

    <h2 className="public-h2">Results</h2>
    <div className="whatif-results" aria-live="polite">
      <Metric name="Gas freed up" value={two.format(result.mmcfPerDay)} unit="MMcf/day" formula={result.formulaLines[3]} />
      <Metric name="Share of needle peak" value={one.format(result.needlePeakShare * 100)} unit="%" formula={result.formulaLines[4]} />
      <Metric name="Share of 2024 deliverability loss" value={one.format(result.deliverabilityLossShare * 100)} unit="%" formula={result.formulaLines[5]} />
      <Metric name={`Share of 3 Bcf shortfall over ${whole.format(input.days)} days`} value={two.format(result.shortfallShare * 100)} unit="%" formula={result.formulaLines[6]} />
      <Metric name="Value at the marginal price" value={money.format(Math.round(result.usdPerDay / 100) * 100)} unit="/day" formula={result.formulaLines[7]} />
    </div>
    <p className="public-note">This helps on the coldest days, when the system is short of delivery capacity. It does not close the seasonal supply gap: the shortfall result shows how small a share of the 3 Bcf seasonal gap it covers.</p>

    <details className="public-math">
      <summary>Show the math</summary>
      <ol>{result.formulaLines.map((line, i) => <li key={i}>{line}</li>)}</ol>
      <p className="public-note">Steady-state estimate: it assumes the setback is held all day and ignores the reheating spike at the end, which the operator console models in full. Labels in brackets: sourced (published figure), derived (computed from sourced figures), assumed (our modeling choice).</p>
    </details>
  </section>;
}
