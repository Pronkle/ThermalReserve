import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { DbConnection } from '../../../packages/stdb-bindings/src/index.ts';
import { buildCohorts, loadConstants, pressureParams, pressureIndex, pressureSummary, runPlan } from '../../../packages/model/src/index.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH);
const url = process.env.WEB_URL || 'http://127.0.0.1:5173';
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const raw = await json('data/constants.json');
const consts = loadConstants(raw);
const cohorts = buildCohorts(await json('data/cohort_spec.json'), consts.uaMeanBtuHPerF);
const sc = await json('data/scenarios/feb2024.json');
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
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.solve-status')?.textContent.startsWith('Optimized ·') && document.querySelector('.control-note')?.textContent.includes('Operator'), { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('.control-note')?.textContent.includes('Sending'));
  if (await page.getByLabel('Planning mode', { exact: true }).inputValue() !== 'OBSERVED') {
    await page.getByLabel('Planning mode', { exact: true }).selectOption('OBSERVED');
    await page.getByRole('button', { name: 'Solve plan', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.solve-status')?.textContent.startsWith('Optimized ·'));
    await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.control-note')?.textContent.includes('Sending'));
  }
  assert(await page.getByText('Above the curtailment line for the whole cold snap.', { exact: true }).isVisible());
  assert((await page.locator('.verdict-tile').first().innerText()).includes('10'));
  assert((await page.locator('.verdict-tile').first().innerText()).includes('No program: -7'));
  assert(await page.getByRole('button', { name: 'Start', exact: true }).isEnabled());
  for (const [width, height] of [[1280, 800], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    assert(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), `No scroll at ${width}×${height}`);
    for (const selector of ['.pressure-chart', '.temperature-chart', '.discomfort-chart']) {
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
  connection = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Inspector connection timed out')), 30000);
    DbConnection.builder().withUri('wss://maincloud.spacetimedb.com').withDatabaseName('thermal-reserve-dev')
      .onConnect(conn => conn.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(conn); }).subscribe(['SELECT * FROM sim_config', 'SELECT * FROM plan_hour', 'SELECT * FROM aggregate_hour']))
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
  });
  const config = [...connection.db.simConfig.iter()][0];
  assert.equal(config.simHour, 0); assert.equal(config.status, 'idle');
  const p = pressureParams(consts, raw, 11.5, 10);
  assert.equal(config.capacityMmcfd, p.rMMcfd);
  const targetsF = cohorts.map(() => Array(sc.hours).fill(NaN));
  for (const row of connection.db.planHour.iter()) targetsF[row.cohortId][row.hour] = row.targetF;
  const cfg = { enrolledHomes: config.enrolledHomes, exemptShare: config.exemptShare, floorF: config.floorF, maxDepthF: config.maxDepthF, capacityMMcfd: config.capacityMmcfd, overrideRate: config.overrideRate, seed: 42 };
  const expected = runPlan(sc, cohorts, cfg, { id: config.planId, strategy: config.strategy, targetsF }, consts);
  const expectedIndex = pressureIndex(expected.hours.map(row => row.systemMMcfh), p);
  assert(pressureSummary(expectedIndex, p).minIndex >= 10);
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(`${url}/home?db=thermal-reserve-dev`);
  await phone.getByRole('button', { name: 'Join as an Anchorage home', exact: true }).click();
  await phone.getByRole('button', { name: 'Continue', exact: true }).click();
  await phone.getByRole('button', { name: 'Join', exact: true }).click();
  await phone.locator('.heat-card').waitFor();
  await page.getByLabel('Speed', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Apply inputs', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.control-note')?.textContent.includes('Sending'));
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const deadline = Date.now() + 45000;
  while ([...connection.db.aggregateHour.iter()].length < sc.hours && Date.now() < deadline) await sleep(100);
  const aggregates = [...connection.db.aggregateHour.iter()].sort((a, b) => a.hour - b.hour);
  assert.equal(aggregates.length, sc.hours);
  const actualIndex = pressureIndex(aggregates.map(row => row.systemMmcf), p);
  const error = Math.max(...actualIndex.map((value, h) => Math.abs(value - expectedIndex[h])));
  assert(error <= 3, `Live pressure error ${error} points`);
  await phone.locator('.home-pressure').waitFor();
  await phone.waitForFunction(value => document.querySelector('.home-pressure strong')?.textContent === String(value), Math.round(actualIndex.at(-1)));
  assert(await phone.getByRole('heading', { name: 'Community on the final day' }).isVisible());
  await page.getByRole('button', { name: 'Stress', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pressure-status')?.textContent.startsWith('Below the curtailment line'), { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('.control-note')?.textContent.includes('Sending'));
  assert((await page.locator('.pressure-status').innerText()).includes('MMcf would be curtailed'));
  await page.screenshot({ path: '/tmp/thermal-reserve-pressure-stress.png', fullPage: true });
  await page.goto(`${url}/ops?ui=gas&db=thermal-reserve-dev`);
  await page.getByRole('button', { name: 'Demo preset', exact: true }).waitFor();
  await page.goto(`${url}/ops?db=thermal-reserve-dev`);
  await page.getByText(/Connected · thermal-reserve-dev/).waitFor();
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pressure-status')?.textContent.startsWith('Above') && !document.querySelector('.control-note')?.textContent.includes('Sending'), { timeout: 15000 });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ acceptance: 'Pressure W-A1/W-A2/W-B1 automated PASS', hoursCompared: aggregates.length, maxPressureError: error, phonePressureMatches: true, layouts: ['1280×800', '1440×900'], inputInvalidation: true, gasFallback: true, pageErrors: errors }));
} finally { connection?.disconnect(); await browser.close(); }
