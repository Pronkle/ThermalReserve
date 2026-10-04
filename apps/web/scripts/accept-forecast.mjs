import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { DbConnection } from '../../../packages/stdb-bindings/src/index.ts';
import { buildCohorts, loadConstants, pressureParams, pressureIndex, pressureSummary, runPlan, replanRun } from '../../../packages/model/src/index.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH);
const url = process.env.WEB_URL || 'http://127.0.0.1:5173';
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const raw = await json('data/constants.json');
const consts = loadConstants(raw);
const cohorts = buildCohorts(await json('data/cohort_spec.json'), consts.uaMeanBtuHPerF);
const sc = await json('data/scenarios/feb2024.json');
assert(sc.forecastRuns?.length, 'Archived forecast data must be fetched before W-C1 acceptance');
const passcode = process.env.STDB_PASSCODE || (await readFile('stdb/HANDOFF.md', 'utf8')).match(/For `thermal-reserve-dev` it is `([^`]+)`/)[1];
const browser = await chromium.launch({ headless: true });
let connection;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept(passcode));
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.goto(`${url}/ops?db=thermal-reserve-dev`);
  await page.getByText(/Connected · thermal-reserve-dev/).waitFor({ timeout: 30000 });
  await page.evaluate(() => { window.solveBeats = []; window.solveTimer = setInterval(() => window.solveBeats.push(performance.now()), 50); });
  const solveStarted = Date.now();
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.solve-status')?.textContent.startsWith('Optimized ·') && document.querySelector('.control-note')?.textContent.includes('Operator'), { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('.control-note')?.textContent.includes('Sending'));
  const solveMs = Date.now() - solveStarted;
  const maxBeatGap = await page.evaluate(() => { clearInterval(window.solveTimer); return Math.max(...window.solveBeats.slice(1).map((value, i) => value - window.solveBeats[i])); });
  assert(solveMs < 15000, `Precompute ${solveMs} ms`);
  assert(maxBeatGap < 1000, `Main thread gap ${maxBeatGap} ms`);
  assert((await page.locator('.pressure-status').innerText()).startsWith('Above'));
  assert.equal(await page.getByLabel('Planning mode', { exact: true }).inputValue(), 'REPLAN');
  assert(await page.locator('.planning-chip').innerText().then(text => text.includes('Forecast issued')));

  assert(await page.getByRole('button', { name: 'Start', exact: true }).isEnabled());
  for (const [width, height] of [[1280, 800], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    assert(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), `No scroll at ${width}×${height}`);
    for (const selector of ['.pressure-chart', '.temperature-chart', '.discomfort-chart', '.pressure-map']) {
      const bounds = await page.locator(selector).boundingBox();
      assert(bounds && bounds.y + bounds.height <= height, `${selector} fits`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: '/tmp/thermal-reserve-pressure-nearmiss.png', fullPage: true });
  for (const [label, changed] of [['Deliverability lost vs Feb 2024', '12'], ['Reserve', '11'], ['Enrolled homes', '26000'], ['Max setback', '6'], ['Comfort floor', '63']]) {
    const control = page.getByLabel(label, { exact: true });
    const original = await control.inputValue();
    await control.fill(changed);
    await page.getByText('Not solved for these inputs: press Solve plan', { exact: true }).first().waitFor();
    assert(await page.getByRole('button', { name: 'Dispatch', exact: true }).isDisabled());
    assert.equal(await page.locator('.pressure-chart .recharts-line-curve[stroke="#5BC0EB"]').count(), 0);
    await control.fill(original);
    await page.waitForFunction(() => document.querySelector('.solve-status')?.textContent.startsWith('Optimized ·'));
  }
  for (const [label, changed] of [['Planning mode', 'OBSERVED'], ['Cold buffer', '1.25']]) {
    const control = page.getByLabel(label, { exact: true });
    const original = await control.inputValue();
    await control.selectOption(changed);
    assert(await page.getByRole('button', { name: 'Dispatch', exact: true }).isDisabled());
    assert.equal(await page.locator('.pressure-chart .recharts-line-curve[stroke="#5BC0EB"]').count(), 0);
    await control.selectOption(original);
    await page.waitForFunction(() => document.querySelector('.solve-status')?.textContent.startsWith('Optimized ·'));
  }
  connection = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Inspector connection timed out')), 30000);
    DbConnection.builder().withUri('wss://maincloud.spacetimedb.com').withDatabaseName('thermal-reserve-dev')
      .onConnect(conn => conn.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(conn); }).subscribe(['SELECT * FROM sim_config', 'SELECT * FROM plan_hour', 'SELECT * FROM aggregate_hour', 'SELECT * FROM event_log']))
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
  });
  const config = [...connection.db.simConfig.iter()][0];
  assert.equal(config.simHour, 0); assert.equal(config.status, 'idle');
  const p = pressureParams(consts, raw, 11.5, 10);
  assert.equal(config.capacityMmcfd, p.rMMcfd);
  const cfg = { enrolledHomes: config.enrolledHomes, exemptShare: config.exemptShare, floorF: config.floorF, maxDepthF: config.maxDepthF, capacityMMcfd: config.capacityMmcfd, overrideRate: config.overrideRate, seed: 42 };
  const expected = await replanRun(sc, cohorts, cfg, consts, p, { mode: 'REPLAN', bufferSigma: raw.forecast_buffer_sigma_default.value, strategy: 'OPTIMIZED', policy: { kind: 'SCHEDULED_PLUS_DRIFT', driftTempF: raw.drift_temp_f.value, driftHours: raw.drift_hours.value, driftPressureIdx: raw.drift_pressure_idx.value, driftFadeH: raw.drift_fade_h.value } });
  const expectedIndex = pressureIndex(expected.run.hours.map(row => row.systemMMcfh), p);
  assert(expected.segments.length > 1, 'Multiple forecast segments');
  assert(await page.locator('.temperature-chart .recharts-reference-line').count() > 0);
  const dispatches = [];
  connection.db.simConfig.onUpdate((_ctx, previous, next) => {
    if (previous.planId !== next.planId) dispatches.push({ planId: next.planId, hour: next.simHour });
  });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(`${url}/home?db=thermal-reserve-dev`);
  await phone.getByRole('button', { name: 'Join as an Anchorage home', exact: true }).click();
  await phone.getByRole('button', { name: 'Continue', exact: true }).click();
  await phone.getByRole('button', { name: 'Join', exact: true }).click();
  await phone.locator('.heat-card').waitFor();
  await page.getByLabel('Speed', { exact: true }).fill(process.env.SIM_SPEED || '2');
  await page.getByRole('button', { name: 'Apply inputs', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.control-note')?.textContent.includes('Sending'));
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const deadline = Date.now() + 120000;
  while ([...connection.db.aggregateHour.iter()].length < sc.hours && Date.now() < deadline) {
    const current = [...connection.db.simConfig.iter()][0];
    assert.equal(current.capacityMmcfd, p.rMMcfd, 'Shared dev inputs changed during acceptance');
    assert.equal(current.operator?.toHexString(), config.operator?.toHexString(), 'Another operator claimed shared dev during acceptance');
    await sleep(100);
  }
  const aggregates = [...connection.db.aggregateHour.iter()].sort((a, b) => a.hour - b.hour);
  assert.equal(aggregates.length, sc.hours);
  const actualIndex = pressureIndex(aggregates.map(row => row.systemMmcf), p);
  const error = Math.max(...actualIndex.map((value, h) => Math.abs(value - expectedIndex[h])));
  assert(error <= 3, `Live pressure error ${error} points`);
  await phone.locator('.home-pressure').waitFor();
  await phone.waitForFunction(value => document.querySelector('.home-pressure strong')?.textContent === String(value), Math.round(actualIndex.at(-1)));
  assert(await phone.getByRole('heading', { name: 'Community on the final day' }).isVisible());
  const boundaries = expected.segments.slice(1).map(segment => segment.fromHour);
  for (const boundary of boundaries) {
    const dispatched = dispatches.find(item => item.planId.includes(`-rp${boundary}-`));
    assert(dispatched, `Segment ${boundary} dispatched`);
    assert(dispatched.hour >= boundary && dispatched.hour < boundary + 1, `Dispatch at boundary ${boundary}, got ${dispatched.hour}`);
  }
  const recorded = [...connection.db.eventLog.iter()].filter(event => event.kind === 'dispatch');
  for (const boundary of boundaries) assert(recorded.some(event => event.simHour >= boundary && event.simHour < boundary + 1), `Database log at ${boundary}`);
  assert(await page.locator('.log-panel').innerText().then(text => text.includes('Re-plan')));
  await page.screenshot({ path: '/tmp/thermal-reserve-forecast-run.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ acceptance: 'Forecast W-C1 automated PASS', solveMs, maxBeatGap, segments: expected.segments.map(segment => ({ hour: segment.fromHour, reason: segment.reason })), dispatches, hoursCompared: aggregates.length, maxPressureError: error, phonePressureMatches: true, layouts: ['1280×800', '1440×900'], inputInvalidation: true, pageErrors: errors }));
} finally { connection?.disconnect(); await browser.close(); }
