import { useEffect, useRef, useState } from 'react';
import { useAggregates, useConnection, useMyContactLine, useMyHousehold, useReducers, useSimConfig } from '../lib/stdb';
import { clockLabel, constants, decimal, integer, scenarios, temperature } from '../lib/ops';
import { eventCountdown, heatStatus, householdDayStart, householdLinkCode } from '../lib/household';
import { livePressureReading } from '../lib/pressure-ui';
import { HouseholdMap } from '../components/HouseholdMap';
import './home.css';

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
export function Home() {
  const live = useConnection();
  const config = useSimConfig();
  const home = useMyHousehold();
  const contactLine = useMyContactLine();
  const reducers = useReducers();
  const aggregates = useAggregates();
  const [step, setStep] = useState(0);
  const [nickname, setNickname] = useState('');
  const [heating, setHeating] = useState('furnace');
  const [thermostat, setThermostat] = useState('other');
  const [exempt, setExempt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [textUpdates, setTextUpdates] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [contactState, setContactState] = useState<'idle' | 'saving' | 'failed' | 'saved'>('idle');
  const [awaitingLine, setAwaitingLine] = useState(false);
  const hadAssignedLine = useRef(false);
  const [linkCode, setLinkCode] = useState('');
  const identityHex = home?.identity.toHexString();
  useEffect(() => {
    setLinkCode('');
    if (!identityHex) return;
    let current = true;
    void householdLinkCode(identityHex).then(code => { if (current) setLinkCode(code); }).catch(() => { /* Optional companion must never block heat controls. */ });
    return () => { current = false; };
  }, [identityHex]);
  const connected = live.status === 'connected';
  const pendingLineKey = `thermal-reserve.imessage-pending:${live.database}:${live.identity}`;
  useEffect(() => {
    if (!connected) return;
    if (!home || contactLine || hadAssignedLine.current) {
      try { sessionStorage.removeItem(pendingLineKey); } catch { /* Still works without storage. */ }
      setAwaitingLine(false);
      if (!home || !contactLine && hadAssignedLine.current) setContactState('idle');
      hadAssignedLine.current = Boolean(contactLine);
      return;
    }
    try { if (sessionStorage.getItem(pendingLineKey) === '1') setAwaitingLine(true); } catch { /* Optional persistence. */ }
  }, [connected, identityHex, contactLine?.line, pendingLineKey]);
  const previouslyJoined = useRef(false);
  useEffect(() => {
    if (home) previouslyJoined.current = true;
    else if (connected && previouslyJoined.current) {
      previouslyJoined.current = false; setStep(0); setTextUpdates(false); setContactState('idle');
      setFirstName(''); setLastName(''); setPhone(''); setError('');
    }
  }, [home, connected]);
  const scenario = scenarios.find(item => item.id === config?.scenarioId);
  const maxDepthF = config?.maxDepthF ?? constants.maxDepthDefaultF;
  const consentFloorF = constants.floorDefaultF;
  async function act(action: (api: NonNullable<typeof reducers>) => Promise<void>) {
    if (!reducers || busy) return;
    setBusy(true); setError('');
    try { await action(reducers); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  async function saveContact(api: NonNullable<typeof reducers>) {
    setContactState('saving');
    try {
      await api.setContact({ firstName, lastName, phone });
      setContactState('saved'); setFirstName(''); setLastName(''); setPhone('');
      if (!contactLine) {
        setAwaitingLine(true);
        try { sessionStorage.setItem(pendingLineKey, '1'); } catch { /* No contact fields are persisted. */ }
      }
    } catch (failure) { setContactState('failed'); throw failure; }
  }
  const contactFields = <div className="contact-fields">
    <label>First name<input value={firstName} autoComplete="given-name" maxLength={40} onChange={event => setFirstName(event.target.value)} /></label>
    <label>Last name<input value={lastName} autoComplete="family-name" maxLength={40} onChange={event => setLastName(event.target.value)} /></label>
    <label>Phone<input type="tel" value={phone} autoComplete="tel" placeholder="+19075550123" onChange={event => setPhone(event.target.value)} /></label>
  </div>;
  const privacyCopy = 'Demo only. Your name and number are stored privately for this demo, never shown publicly, and deleted when you reply STOP or the demo resets.';
  const dayStart = householdDayStart(config?.simHour ?? 0, config?.hours ?? 0);
  const today = aggregates.filter(row => row.hour >= dayStart && row.hour < dayStart + 24);
  const communitySavedMMcf = today.reduce((sum, row) => sum + row.reliefMmcf, 0);
  const baselineTodayMMcf = scenario?.systemMMcfh.slice(dayStart, dayStart + 24).reduce((sum, demand) => sum + demand, 0) ?? 0;
  const targetMMcf = Math.max(0, baselineTodayMMcf - (config?.capacityMmcfd ?? 0));
  const status = home ? heatStatus(home) : undefined;
  const pressure = config ? livePressureReading(new Map(aggregates.map(row => [row.hour, row.systemMmcf])), config.hours, config.capacityMmcfd, Number(constants.raw.reserve_default_idx?.value ?? 0)) : undefined;
  return <section className="household-page">
    <p className="eyebrow">Thermal Reserve · household demo</p>
    <h1>Your home</h1>
    {live.status !== 'connected' && <p className="home-connection" role="status">{live.status === 'unconfigured' ? 'Live connection is not configured.' : live.status === 'connecting' ? 'Connecting to the community…' : 'Disconnected — retrying. Your heat controls return when connected.'}</p>}
    {error && <p className="home-error" role="alert">{error}</p>}
    {home && status ? <>
      <div className={`panel heat-card ${status.mode}`}>
        <div className="home-card-heading"><h2>{home.nickname}</h2><span className="heat-status" role="status">{status.name}</span></div>
        <p className="indoor-temperature" title="Derived: simulated household indoor air temperature from the server thermal model.">{temperature.format(home.taF)}<span>°F</span></p>
        <p className="home-temperature-label">Indoor temperature <span className="label-chip">derived · simulated</span></p>
        <p className="setpoint" title="Derived: current heat target; exempt and overridden households follow their normal setpoint.">Setpoint <strong>{temperature.format(status.targetF)}°F</strong></p>
        {config && scenario && <div className="home-clock"><time>{clockLabel(scenario, config.simHour)}</time><span>{config.status} · {eventCountdown(config.simHour, config.eventStartHour, config.eventEndHour)}</span></div>}
        {home.exempt ? <p className="steady-heat">Your home keeps steady heat. You are exempt from setbacks.</p> : <button className="override-button" disabled={!connected || busy} onClick={() => void act(api => home.overridden ? api.cancelOverride({}) : api.override({}))}>{busy ? 'Updating…' : home.overridden ? 'Rejoin event' : 'Override'}</button>}
        {home.overridden && !home.exempt && <p className="steady-heat">Normal heat restored. You can rejoin when ready.</p>}
        <p className="home-limit" title={`${constants.raw.max_depth_default_f.label}: operator-selected setback limit; household comfort floor.`}>Program limit: up to {temperature.format(maxDepthF)}°F lower, never below {temperature.format(Math.max(home.floorF, constants.floorDefaultF))}°F <span className="metric-label">assumed</span></p>
      </div>
      <HouseholdMap />
      {(contactState !== 'idle' || awaitingLine || contactLine) && <section className="panel home-contact" aria-labelledby="contact-title">
        <h2 id="contact-title">iMessage updates</h2>
        {contactLine ? <>
          {linkCode ? <>
            <p>Text <strong className="link-code">Link my home {linkCode}</strong> to <strong className="assigned-line">{contactLine.line}</strong> to turn on iMessage updates.</p>
            <a className="home-primary text-updates-link" href={`sms:${contactLine.line}&body=${encodeURIComponent(`Link my home ${linkCode}`)}`}>Text to link your home</a>
          </> : <><p>Your iMessage number: <strong className="assigned-line">{contactLine.line}</strong></p><p className="home-limit">Your link code is unavailable. Reload to try again.</p></>}
          <p className="home-limit">Send the message to start updates. Reply STOP any time.</p>
        </> : contactState === 'saved' || awaitingLine ? <p role="status">Setting up your iMessage line…</p> : contactState === 'saving' ? <p role="status">Saving your iMessage details…</p> : <>
          <p>Your home has joined. Correct your details to finish opting in.</p>
          {contactFields}
          <button className="home-primary" disabled={!connected || busy} onClick={() => void act(saveContact)}>Save iMessage details</button>
          <button className="home-back" disabled={busy} onClick={() => { setContactState('idle'); setTextUpdates(false); setFirstName(''); setLastName(''); setPhone(''); setError(''); }}>Continue without updates</button>
        </>}
        <p className="home-limit">{privacyCopy}</p>
      </section>}
      {pressure && <section className="panel home-pressure" aria-label="Modeled system pressure" title="Derived: P = 100 × modeled linepack / usable linepack, using completed live system gas hours and the delivery rate. Not psi or Enstar telemetry.">
        <h2>Modeled system pressure</h2>
        <p>System pressure: <strong>{integer.format(pressure.index)}</strong>, {pressure.index < 0 ? 'below' : 'above'} the curtailment line <span className="metric-label">derived · index points</span></p>
        <meter aria-label="Modeled pressure index" min={0} max={100} low={pressure.reserveIdx} optimum={100} value={Math.max(0, Math.min(100, pressure.index))} />
        <p className="home-limit">100 = full, 0 = curtailment begins. Not psi or Enstar telemetry. Completed simulation hours only.</p>
      </section>}
      <section className="panel home-savings" aria-labelledby="savings-title">
        <h2 id="savings-title">Your contribution</h2>
        <div className="home-savings-grid">
          <div title="Derived: cumulative baseline household gas minus actual household gas since joining or reset. Recovery can reduce this total."><strong>{decimal.format(home.savedCf)} <span>cf</span></strong><span>Net gas saved this event</span><span className="metric-label">derived · includes recovery</span></div>
          <div title={`Derived: saved cf ÷ 1,000 × $${constants.marginalPriceUsdPerMcf}/Mcf. ${constants.raw.marginal_price_usd_mcf.label}: ${constants.raw.marginal_price_usd_mcf.source}`}><strong>{dollars.format(home.savedCf / 1000 * constants.marginalPriceUsdPerMcf)}</strong><span>Gas value, not a bill credit</span><span className="metric-label">derived</span></div>
        </div>
        <h3>{config?.status === 'finished' ? 'Community on the final day' : 'Community today'}</h3>
        <p title="Derived: sum of completed hourly baseline fleet gas minus actual fleet gas in this simulation day."><strong>{decimal.format(communitySavedMMcf)} MMcf</strong> net saved <span className="metric-label">derived</span></p>
        {targetMMcf > 0 ? <><progress aria-label="Progress toward today's relief target" max={targetMMcf} value={Math.max(0, Math.min(targetMMcf, communitySavedMMcf))} /><p className="home-limit" title="Derived: no-program system demand for this gas day minus operator-selected daily capacity.">Toward {decimal.format(targetMMcf)} MMcf for the day <span className="metric-label">derived</span></p></> : <p className="home-limit">No extra relief is needed to cover this day's modeled demand.</p>}
        <p className="home-limit">Completed simulation hours only. Net savings can fall while homes recover.</p>
      </section>
      {linkCode && contactState === 'idle' && !awaitingLine && !contactLine && <section className="panel home-imessage" aria-labelledby="imessage-title">
        <h2 id="imessage-title">Get updates by iMessage</h2>
        <p>Reply <strong className="link-code">Link my home {linkCode}</strong> in your Thermal Reserve iMessage thread to get heat updates by text. Reply STOP any time.</p>
        <p className="home-limit">Demo: works when the team's iMessage assistant is running.</p>
      </section>}
    </> : step === 0 ? <div className="panel enrollment-intro">
      <h2>Steady heat. A stronger community.</h2>
      <p>Try an Anchorage home in our cold-snap simulation. You stay in control of your heat.</p>
      <button className="home-primary" onClick={() => setStep(1)}>Join as an Anchorage home</button>
      <p className="home-limit">This is a demo. It does not connect to your thermostat.</p>
    </div> : step === 1 ? <form className="panel enrollment-form" onSubmit={event => { event.preventDefault(); setStep(2); }}>
      <p className="home-step">Home details · next: consent</p>
      <h2>Tell us about your home</h2>
      <label>Nickname <span className="muted">(optional)</span><input aria-label="Nickname (optional)" value={nickname} maxLength={24} autoComplete="nickname" placeholder="A name you will spot on the map" onChange={event => setNickname(event.target.value)} /></label>
      <label>Heating type<select aria-label="Heating type" value={heating} onChange={event => setHeating(event.target.value)}><option value="furnace">Furnace</option><option value="boiler">Boiler</option><option value="other">Other</option></select></label>
      <label>Thermostat<select aria-label="Thermostat" value={thermostat} onChange={event => setThermostat(event.target.value)}><option value="nest">Nest</option><option value="ecobee">ecobee</option><option value="honeywell">Honeywell</option><option value="other">Other</option><option value="none">None</option></select></label>
      <label className="steady-checkbox"><input type="checkbox" checked={exempt} onChange={event => setExempt(event.target.checked)} /><span>Someone here needs steady heat <span className="muted">(infant, elderly, medical)</span></span></label>
      <button className="home-primary" type="submit">Continue</button>
      <button className="home-back" type="button" onClick={() => setStep(0)}>Back</button>
    </form> : <div className="panel enrollment-consent">
      <p className="home-step">Your choice · join when ready</p>
      <h2>You keep control</h2>
      {exempt ? <p>Your home is exempt. Your heat will stay at its normal setting during events.</p> : <p title="Assumed: operator-selected maximum setback and household comfort floor.">During a gas emergency your heat may be lowered up to {integer.format(maxDepthF)}°F, never below {integer.format(consentFloorF)}°F. Override any time.</p>}
      <p>This demo simulates your heat and savings. No real thermostat is controlled.</p>
      <label className="steady-checkbox text-updates"><input type="checkbox" checked={textUpdates} onChange={event => setTextUpdates(event.target.checked)} /><span>Text me updates by iMessage</span></label>
      {textUpdates && <>{contactFields}<p className="home-limit">{privacyCopy}</p></>}
      <button className="home-primary" disabled={!connected || !config?.hours || busy} onClick={() => void act(async api => {
        await api.joinHousehold({ nickname, heating, thermostat, exempt });
        if (textUpdates) await saveContact(api);
      })}>{busy ? 'Joining…' : 'Join'}</button>
      {!config?.hours && <p className="home-limit">The operator needs to load a scenario before you can join.</p>}
      <button className="home-back" onClick={() => setStep(1)}>Back</button>
    </div>}
    <details className="why-heat panel"><summary>Why this matters</summary><p>If gas runs short, Enstar's plan cuts large commercial and industrial customers first. When pressure falls too low, Enstar must cut customers, businesses first. Small voluntary reductions at home make those cuts smaller and lower the chance of rolling blackouts. Override any time.</p><p>Thermal Reserve simulates emergency relief across many homes. It helps with cold-day demand; it does not solve the seasonal gas shortfall.</p></details>
  </section>;
}
