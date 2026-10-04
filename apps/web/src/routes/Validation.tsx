import type { ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { anchorageSanity, buildCohorts, loadConstants, validateConEdLike, validateSoCalLike, type CohortSpec, type ConstantsJson } from '@thermal-reserve/model';
import forecastError from '../../../../data/forecast_error.json';
import raw from '../../../../data/constants.json';
import specJson from '../../../../data/cohort_spec.json';
import './public.css';

const constants = loadConstants(raw as ConstantsJson);
const spec = specJson as CohortSpec;
const cohorts = buildCohorts(spec, constants.uaMeanBtuHPerF);
// Pure functions of the data files; computed once per page load (~tens of ms).
const coned = validateConEdLike(cohorts, constants);
const socal = validateSoCalLike(cohorts, constants);
const sanity = anchorageSanity(cohorts, constants);
const fleetEta = cohorts.reduce((s, c) => s + c.share * c.eta, 0);
const sanityExpected = (constants.uaMeanBtuHPerF * 90 * 24) / (fleetEta * constants.hhvBtuPerCf) / 1000;

const two = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const three = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const one = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const lbl = (key: string) => constants.raw[key]?.label ?? 'assumed';

type Status = 'pass' | 'gap' | 'check';
const statusText: Record<Status, string> = { pass: 'Pass', gap: 'Gap', check: 'Sanity check' };

function EventDayChart({ hourly, title }: { hourly: { hour: number; baselineCf: number; eventCf: number }[]; title: string }) {
  return <figure className="validation-chart">
    <div className="validation-chart-box" role="img" aria-label={`${title}: gas per home by hour, normal day versus event day; event 06:00 to 10:00`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={hourly} margin={{ top: 8, right: 8, bottom: 16, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <ReferenceArea x1={6} x2={10} fill="#5BC0EB" fillOpacity={0.12} />
          <XAxis dataKey="hour" type="number" domain={[0, 23]} ticks={[0, 6, 10, 12, 18, 23]} tickFormatter={(h) => `${String(h).padStart(2, '0')}:00`} tick={{ fontSize: 12 }} stroke="var(--muted)" label={{ value: 'Hour of day', position: 'bottom', fontSize: 10, fill: 'var(--muted)' }} />
          <YAxis width={40} tick={{ fontSize: 12 }} stroke="var(--muted)" tickFormatter={(v) => one.format(Number(v))} />
          <Tooltip formatter={(v) => `${two.format(Number(v))} cf per home · derived`} labelFormatter={(h) => `${String(h).padStart(2, '0')}:00`} />
          <Line name="Normal day" dataKey="baselineCf" stroke="#7A869A" dot={false} isAnimationActive={false} />
          <Line name="Event day" dataKey="eventCf" stroke="#126187" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    <figcaption>Gas per home, cubic feet per hour. <span className="legend-swatch baseline" aria-hidden="true" />Normal day <span className="legend-swatch event" aria-hidden="true" />Event day · shaded: setback 06:00–10:00 · <span className="metric-label">derived · model</span></figcaption>
  </figure>;
}

function Card({ id, title, status, children }: { id: string; title: string; status: Status; children: ReactNode }) {
  return <article className={`validation-card status-${status}`} aria-labelledby={`${id}-title`}>
    <div className="validation-card-head">
      <h2 id={`${id}-title`}>{title}</h2>
      <span className={`status-chip ${status}`}>{status === 'pass' ? '✓ ' : status === 'gap' ? '△ ' : '• '}{statusText[status]}</span>
    </div>
    {children}
  </article>;
}

const tuned: { name: string; value: string; range: string; note: string }[] = [
  ...spec.heating.map((h) => ({ name: `Air heat capacity, ${h.key}`, value: `${whole.format(h.caBtuPerF)} BTU/°F`, range: '1,500–8,000', note: 'Tuned' })),
  { name: 'Air–mass coupling', value: `${one.format(spec.hamMult)} × UA`, range: '1–6 × UA', note: 'Tuned' },
  ...spec.mass.map((m) => ({ name: `Mass time constant, ${m.key}`, value: `${whole.format(m.tauMassH)} h`, range: '15–60 h', note: 'Tuned' })),
  { name: 'Mean heat-loss rate (UA)', value: `${one.format(constants.uaMeanBtuHPerF)} BTU/(h·°F)`, range: '—', note: `Calibrated from gas use (${lbl('ua_mean_btuh_per_f')})` },
  { name: 'Envelope split to air node', value: `${two.format(spec.uaSplitAo)} of UA`, range: '—', note: 'Fixed' },
  ...spec.heating.map((h) => ({ name: `Efficiency, ${h.key}`, value: two.format(h.eta), range: '—', note: 'Fixed' })),
];

export function Validation() {
  const conedStatus: Status = coned.pass ? 'pass' : 'gap';
  const socalStatus: Status = socal.pass ? 'pass' : 'gap';
  return <section className="panel public-page validation-page">
    <p className="eyebrow">Check the evidence</p>
    <h1>Validation</h1>
    <p className="public-lede">Before trusting the simulator's numbers for Anchorage, we ask it to reproduce what real smart-thermostat pilots measured. Each card runs our house model under the pilot's conditions and compares. One check passes; one shows a gap we report rather than hide.</p>

    <Card id="coned" title="ConEd-like: how much saving survives snapback" status={conedStatus}>
      <p className="validation-figure"><strong>{three.format(coned.retention)}</strong> of event-hour savings kept over the day <span className="metric-label">derived</span></p>
      <p>Target {two.format(constants.conedRetentionTarget)} <span className="metric-label">{lbl('validation_coned_retention_target')}</span> (ConEd measured {whole.format(Number(constants.raw.coned_snapback_pct?.value ?? 52))}% lost to snapback <span className="metric-label">{lbl('coned_snapback_pct')}</span>). Pass band {two.format(coned.band[0])}–{two.format(coned.band[1])} <span className="metric-label">{lbl('validation_coned_band')}</span>.</p>
      <EventDayChart hourly={coned.hourly} title="ConEd-like event day" />
      <p className="validation-conditions">Conditions: outdoor 30°F all day, thermostat 70°F, lowered 4°F from 06:00 to 10:00; the second day of a two-day run is measured.</p>
    </Card>

    <Card id="socal" title="SoCalGas-like: net daily reduction" status={socalStatus}>
      <p className="validation-figure"><strong>{two.format(socal.dailyPct)}%</strong> net daily reduction <span className="metric-label">derived</span> vs {one.format(constants.socalDailyPct)}% published <span className="metric-label">{lbl('socal_daily_pct')}</span></p>
      <p>We fit the share of homes that respond (r = {two.format(socal.responseRate)}) so the event-hour reduction matches SoCalGas's {one.format(constants.socalEventPct)}% <span className="metric-label">{lbl('socal_event_pct')}</span>, then read off the daily result. Band {one.format(socal.band[0])}–{one.format(socal.band[1])}% <span className="metric-label">{lbl('validation_socal_daily_band')}</span>.</p>
      {!socal.pass && <p className="validation-gap"><strong>Gap, stated plainly.</strong> Our model keeps less of the event-hour saving than SoCalGas reported ({two.format(socal.dailyPct)}% vs {one.format(socal.band[0])}–{one.format(socal.band[1])}% daily). ConEd's pilot implies about half the saving is lost to snapback; SoCalGas's implies far less. One house model can't match both under these test conditions, and we tuned only within physically plausible ranges. So our net-savings numbers lean conservative.</p>}
      <EventDayChart hourly={socal.hourly} title="SoCalGas-like event day" />
      <p className="validation-conditions">Conditions: outdoor 45°F all day, thermostat 68°F, lowered 4°F from 06:00 to 10:00. Chart shows the fleet average at the fitted response rate.</p>
    </Card>

    <Card id="anchorage" title="Anchorage sanity: gas per home on a −20°F day" status="check">
      <p className="validation-figure"><strong>{two.format(sanity.mcfPerHomeDay)}</strong> Mcf per home per day <span className="metric-label">derived</span></p>
      <p>Steady-state expectation from the calibrated heat-loss rate: UA × 90°F × 24 h ÷ (efficiency × heat content) = {two.format(sanityExpected)} Mcf/day <span className="metric-label">derived</span>. Heat content {whole.format(constants.hhvBtuPerCf)} BTU/cf <span className="metric-label">{lbl('hhv_btu_per_cf')}</span>. Conditions: outdoor −20°F, thermostat 70°F, no setback.</p>
    </Card>

    <h2 className="public-h2">Archived forecast error</h2>
    <p className="public-note">{forecastError.scope}</p>
    <div className="table-scroll"><table className="param-table"><thead><tr><th scope="col">Replay</th><th scope="col">Lead, h</th><th scope="col">Mean error, °F</th><th scope="col">RMSE, °F</th><th scope="col">Samples</th></tr></thead>
      <tbody>{Object.entries(forecastError.scenarios).flatMap(([id, scenario]) => scenario.byLead.map(row => <tr key={`${id}-${row.leadH}`} title={`${forecastError.label}: ${forecastError.source}`}><th scope="row">{id}</th><td>{row.leadH}</td><td>{row.meanErrorF === null ? 'No samples' : two.format(row.meanErrorF)}</td><td>{row.rmseF === null ? 'No samples' : two.format(row.rmseF)}</td><td>{row.n}</td></tr>))}</tbody></table></div>
    <p className="public-note">{forecastError.method} <span className="metric-label">{forecastError.label}</span></p>
    <p className="public-note">{forecastError.source}</p>
    <h2 className="public-h2">Model parameters</h2>
    <p className="public-note">Tuned values were the only ones adjusted to meet the checks above, and only inside the listed ranges. Everything here comes from <code>data/cohort_spec.json</code> and <code>data/constants.json</code>; cohort shares and settings are assumed unless labeled.</p>
    <div className="table-scroll">
      <table className="param-table">
        <thead><tr><th scope="col">Parameter</th><th scope="col">Value</th><th scope="col">Allowed range</th><th scope="col">Status</th></tr></thead>
        <tbody>{tuned.map((r) => <tr key={r.name}><th scope="row">{r.name}</th><td>{r.value}</td><td>{r.range}</td><td>{r.note}</td></tr>)}</tbody>
      </table>
    </div>
  </section>;
}
