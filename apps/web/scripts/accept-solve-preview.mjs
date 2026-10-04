import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH);
const url = process.env.WEB_URL || 'http://127.0.0.1:5176';
const passcode = process.env.STDB_PASSCODE || (await readFile('stdb/HANDOFF.md', 'utf8')).match(/For `thermal-reserve-dev` it is `([^`]+)`/)[1];
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept(passcode));
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.goto(`${url}/ops?db=thermal-reserve-dev`);
  await page.getByText(/Connected · thermal-reserve-dev/).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Demo preset', exact: true }).click();
  await page.getByText(/Connected · thermal-reserve-dev · Operator/).waitFor();
  async function range(name, value) {
    await page.getByLabel(name, { exact: true }).fill(String(value));
    await page.waitForTimeout(150);
  }
  async function solve() {
    await page.getByRole('button', { name: 'Solve plan', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.solve-status')?.textContent.startsWith('Optimized ·'), { timeout: 10000 });
    await page.waitForTimeout(150);
  }
  const metrics = page.locator('.metric-value');
  await range('Enrolled homes', 50000); await range('Max setback', 10); await range('Comfort floor', 60);
  await page.getByLabel('Strategy', { exact: true }).selectOption('OPTIMIZED');
  await page.locator('.solve-status').filter({ hasText: 'Not solved for these inputs' }).waitFor();
  assert((await metrics.allTextContents()).every(value => value.startsWith('—')), 'Unsolved LP KPIs blank');
  assert.equal(await page.locator('.recharts-line-curve[stroke="#5BC0EB"]').count(), 0, 'No substituted Staggered curve');
  await solve();
  const floor60 = await metrics.first().innerText();
  const solve60 = await page.locator('.solve-status').innerText();
  assert(!floor60.startsWith('—'));
  await range('Comfort floor', 62); await solve();
  const floor62 = await metrics.first().innerText();
  await range('Comfort floor', 60);
  assert.equal(await metrics.first().innerText(), floor60, '60°F result restored from cache');
  assert.equal(await page.locator('.solve-status').innerText(), solve60);
  assert(await page.getByRole('button', { name: 'Dispatch', exact: true }).isEnabled());
  await range('Preview hour', 60);
  await page.locator('.map-fallback').waitFor();
  assert(await page.locator('.map-fallback circle title').filter({ hasText: 'holding' }).count() > 0, 'Idle live state does not override solved preview colors');
  await page.getByRole('button', { name: 'Relief', exact: true }).click();
  await page.getByRole('heading', { name: 'Hourly gas relief' }).waitFor();
  assert.equal(await page.locator('.recharts-line-curve[stroke="#5BC0EB"]').count(), 1);
  assert(await page.getByText(/negative values mean rebound/).isVisible());
  await page.waitForFunction(() => [...document.querySelectorAll('.recharts-cartesian-axis-tick-value')].some(el => el.textContent.startsWith('-')));
  await page.screenshot({ path: '/tmp/thermal-reserve-relief-preview.png', fullPage: true });
  assert((await page.locator('.recharts-cartesian-axis-tick-value').allTextContents()).some(value => value.startsWith('-')), 'Rebound axis includes negative values');
  await range('Daily capacity', 295);
  await page.getByText('All days covered at this capacity', { exact: true }).waitFor();
  assert((await metrics.allTextContents()).every(value => value.startsWith('—')));
  await solve();
  await page.getByText(/No shortfall at this capacity/).waitFor();
  assert((await metrics.first().innerText()).startsWith('0.00'));
  const footer = await page.locator('.app-footer').boundingBox();
  const log = await page.locator('.log-panel').boundingBox();
  await page.screenshot({ path: '/tmp/thermal-reserve-preview-capacity.png', fullPage: true });
  assert(log.y + log.height <= footer.y, 'Controls and log fit with capacity hint');
  const grid = await page.locator('.ops-grid').boundingBox();
  assert(log.y + log.height <= grid.y + grid.height + 1, 'Event log stays inside its column');
  assert(await page.evaluate(() => document.documentElement.scrollHeight <= 800));
  await page.getByRole('button', { name: 'Demo preset', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.control-note')?.textContent.includes('Sending'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', floor60, floor62, verified: ['unsolved LP blank, no substitute curve', '60→62→60 solve cache', 'preview hour60 holding dots while idle', 'relief curve and negative rebound axis', '295 capacity explained and solved zero relief', '1280×800 footer/log clear'], pageErrors: errors }));
} finally { await browser.close(); }
