import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH);
const url = process.env.WEB_URL || 'http://127.0.0.1:5176';
const passcode = process.env.STDB_PASSCODE || (await readFile('stdb/HANDOFF.md', 'utf8')).match(/For `thermal-reserve-dev` it is `([^`]+)`/)[1];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('dialog', dialog => dialog.accept(passcode));
  await page.goto(`${url}/ops?ui=gas&db=thermal-reserve-dev`);
  await page.getByText(/Connected · thermal-reserve-dev/).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Demo preset', exact: true }).click();
  await page.getByText(/Connected · thermal-reserve-dev · Operator/).waitFor();
  async function range(name, value) {
    await page.getByLabel(name, { exact: true }).fill(String(value));
    await page.waitForTimeout(100);
  }
  async function solve() {
    await page.getByRole('button', { name: 'Solve plan', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.solve-status')?.textContent.startsWith('Optimized ·'), { timeout: 10000 });
  }
  await range('Enrolled homes', 50000); await range('Max setback', 10); await range('Comfort floor', 60); await range('Daily capacity', 265);
  await page.getByLabel('Strategy', { exact: true }).selectOption('OPTIMIZED');
  await solve();
  assert.equal(await page.getByText(/No shortfall at this capacity/).count(), 0);
  await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.control-note')?.textContent.includes('Sending'));
  const observer = await browser.newPage();
  await observer.goto(`${url}/ops?ui=gas&db=thermal-reserve-dev`);
  await observer.getByText(/Connected · thermal-reserve-dev/).waitFor({ timeout: 30000 });
  await observer.locator('.solve-status').filter({ hasText: 'Optimized · dispatched' }).waitFor();
  await range('Daily capacity', 295);
  await page.getByRole('button', { name: 'Apply inputs', exact: true }).click();
  await page.getByText(/Dispatched plan hidden/).waitFor();
  await observer.getByText(/Dispatched plan hidden/).waitFor();
  await range('Comfort floor', 62); await solve();
  await page.getByText(/No shortfall at this capacity/).waitFor();
  await range('Comfort floor', 60);
  await page.getByText(/Dispatched plan hidden/).waitFor();
  assert(await page.getByRole('button', { name: 'Dispatch', exact: true }).isDisabled());
  await solve();
  await page.getByText(/No shortfall at this capacity/).waitFor();
  assert.equal(await page.getByText(/Dispatched plan hidden/).count(), 0);
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => document.documentElement.scrollHeight <= 800), 'Explanation still fits operator layout');
  await page.getByRole('button', { name: 'Demo preset', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.control-note')?.textContent.includes('Sending'));
  console.log(JSON.stringify({ result: 'PASS', verified: ['current dispatched plan survives new browser', 'capacity change hides old plan in both browsers', '62°F solve then return to 60°F does not resurrect old curve', '295 MMcf/day normal-heat plan explained', '1280×800 layout fits'] }));
} finally { await browser.close(); }
