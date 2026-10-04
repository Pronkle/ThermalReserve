import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DbConnection } from '../../../packages/stdb-bindings/src/index.ts';
import { setTimeout as sleep } from 'node:timers/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH);
const url = process.env.WEB_URL || 'http://127.0.0.1:5173';
const passcode = process.env.STDB_PASSCODE || (await readFile('stdb/HANDOFF.md', 'utf8')).match(/For `thermal-reserve-dev` it is `([^`]+)`/)[1];
const browser = await chromium.launch({ headless: true });
const errors = [];
let inspector;
const current = () => [...inspector.db.simConfig.iter()][0];
async function waitState(predicate) {
  const deadline = Date.now() + 15000;
  while (!predicate(current()) && Date.now() < deadline) await sleep(100);
  assert(predicate(current()), 'Expected live simulation state');
}
async function open(page) {
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.goto(`${url}/ops?db=thermal-reserve-dev`);
  await page.locator('.control-note').filter({ hasText: 'Connected' }).waitFor({ timeout: 30000 });
}
async function unsolved(page) {
  await page.getByText('Not solved for these inputs: press Solve plan.', { exact: true }).waitFor();
  assert.equal(await page.locator('.verdict-tile strong').count(), 3);
  for (const tile of await page.locator('.verdict-tile strong').all()) assert((await tile.innerText()).startsWith('—'));
  assert.equal(await page.locator('.pressure-chart .recharts-line-curve[stroke="#5BC0EB"]').count(), 0);
  assert(await page.getByRole('button', { name: 'Solve plan', exact: true }).isEnabled());
}
async function solve(page) {
  await page.getByRole('button', { name: 'Solve plan', exact: true }).click();
  await page.getByText('Above the curtailment line for the whole cold snap.', { exact: true }).waitFor({ timeout: 15000 });
  assert.equal((await page.locator('.verdict-tile strong').first().innerText()).trim().split(/\s+/)[0], '10');
}
try {
  inspector = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Inspector timed out')), 30000);
    DbConnection.builder().withUri('wss://maincloud.spacetimedb.com').withDatabaseName('thermal-reserve-dev')
      .onConnect(conn => conn.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(conn); }).subscribe('SELECT * FROM sim_config'))
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
  });
  const operator = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  operator.on('dialog', dialog => dialog.accept(passcode));
  await open(operator);
  await operator.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await operator.waitForFunction(() => document.querySelector('.control-note')?.textContent.includes('Operator') && !document.querySelector('.control-note')?.textContent.includes('Sending') && document.querySelector('.pressure-status')?.textContent.startsWith('Above'), { timeout: 15000 });
  const viewer = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await open(viewer);
  await unsolved(viewer);
  await solve(viewer);
  assert((await viewer.locator('.control-note').innerText()).includes('Viewer'), 'Solve does not claim operator or write a plan');
  await viewer.reload();
  await viewer.locator('.control-note').filter({ hasText: 'Connected' }).waitFor();
  await unsolved(viewer);
  await viewer.close();
  await operator.getByRole('button', { name: 'Start', exact: true }).click();
  await waitState(config => config.simHour > 0);
  await operator.getByRole('button', { name: 'Pause', exact: true }).click();
  await waitState(config => config.status === 'paused');
  const pausedClock = current().simHour;
  await operator.reload();
  await operator.locator('.control-note').filter({ hasText: 'Connected' }).waitFor();
  await unsolved(operator);
  await solve(operator);
  assert.equal(current().simHour, pausedClock, 'Local solve preserves live clock');
  assert.equal(current().status, 'paused');
  assert(await operator.getByRole('button', { name: 'Start', exact: true }).isEnabled());
  await operator.getByRole('button', { name: 'Start', exact: true }).click();
  if (!await operator.locator('.log-panel').evaluate(element => element.open)) await operator.locator('.log-panel summary').click();
  await operator.locator('.log-panel').getByText(/Re-plan .*new forecast/).first().waitFor({ timeout: 15000 });
  await operator.getByRole('button', { name: 'Pause', exact: true }).click();
  await operator.waitForFunction(() => !document.querySelector('.control-note')?.textContent.includes('Sending'));
  await operator.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await operator.waitForFunction(() => document.querySelector('.pressure-status')?.textContent.startsWith('Above') && !document.querySelector('.control-note')?.textContent.includes('Sending'), { timeout: 15000 });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ acceptance: 'Reload verdict PASS', freshViewerBlank: true, viewerSolveReadOnly: true, midRunReloadBlank: true, midRunSolveRestoresSchedule: true, dispatchResumed: true, pausedClock, pageErrors: errors }));
} finally { inspector?.disconnect(); await browser.close(); }
