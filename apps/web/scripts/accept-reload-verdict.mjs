import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH);
const url = process.env.WEB_URL || 'http://127.0.0.1:5173';
const passcode = process.env.STDB_PASSCODE || (await readFile('stdb/HANDOFF.md', 'utf8')).match(/For `thermal-reserve-dev` it is `([^`]+)`/)[1];
const browser = await chromium.launch({ headless: true });
const errors = [];
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
  assert((await page.locator('.verdict-tile strong').first().innerText()).startsWith('10 '));
}
try {
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
  await operator.waitForFunction(() => !document.querySelector('.clock-status strong')?.textContent.endsWith('00:00'), { timeout: 10000 });
  await operator.getByRole('button', { name: 'Pause', exact: true }).click();
  await operator.waitForFunction(() => document.querySelector('.clock-status')?.textContent.includes('paused') && !document.querySelector('.control-note')?.textContent.includes('Sending'));
  const pausedClock = await operator.locator('.clock-status strong').innerText();
  await operator.reload();
  await operator.locator('.control-note').filter({ hasText: 'Connected' }).waitFor();
  await unsolved(operator);
  await solve(operator);
  assert.equal(await operator.locator('.clock-status strong').innerText(), pausedClock, 'Local solve preserves live clock');
  assert((await operator.locator('.clock-status').innerText()).includes('paused'));
  assert(await operator.getByRole('button', { name: 'Start', exact: true }).isEnabled());
  await operator.getByRole('button', { name: 'Start', exact: true }).click();
  await operator.locator('.log-panel').getByText(/Re-plan .*new forecast/).first().waitFor({ timeout: 15000 });
  await operator.getByRole('button', { name: 'Pause', exact: true }).click();
  await operator.waitForFunction(() => !document.querySelector('.control-note')?.textContent.includes('Sending'));
  await operator.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await operator.waitForFunction(() => document.querySelector('.pressure-status')?.textContent.startsWith('Above') && !document.querySelector('.control-note')?.textContent.includes('Sending'), { timeout: 15000 });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ acceptance: 'Reload verdict PASS', freshViewerBlank: true, viewerSolveReadOnly: true, midRunReloadBlank: true, midRunSolveRestoresSchedule: true, dispatchResumed: true, pausedClock, pageErrors: errors }));
} finally { await browser.close(); }
