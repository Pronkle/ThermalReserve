import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH);
const url = process.env.WEB_URL || 'http://127.0.0.1:5176';
const browser = await chromium.launch({ headless: true });
const errors = [];
const results = [];
try {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.testSockets = [];
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) { super(...args); window.testSockets.push(this); }
    };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  for (const [width, height] of [[1280, 800], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${url}/ops?db=thermal-reserve-dev`);
    await page.getByText(/Connected · thermal-reserve-dev/).waitFor({ timeout: 30000 });
    await page.locator('.map-fallback').waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const axis = await page.getByText('MMcf/hour', { exact: true }).first().boundingBox();
    const chart = await page.locator('.chart-container').boundingBox();
    assert(axis.x >= chart.x && axis.y >= chart.y && axis.y + axis.height <= chart.y + chart.height, 'Full axis unit is inside chart');
    await page.getByRole('button', { name: 'Enlarge household join QR code' }).click();
    assert(await page.getByRole('dialog').isVisible());
    await page.keyboard.press('Escape');
    assert(!await page.getByRole('dialog').isVisible());
    assert(await page.getByRole('button', { name: 'Enlarge household join QR code' }).evaluate(el => el === document.activeElement));
    assert(await page.evaluate(() => {
      const dot = document.createElement('div'); dot.className = 'household-map-dot'; document.body.append(dot);
      const off = getComputedStyle(dot).animationName === 'none'; dot.remove(); return off;
    }));
    results.push(`ops ${width}×${height}: layout, tiles fallback, axis, QR keyboard, reduced motion`);
  }
  await context.setOffline(true);
  // Chromium's offline emulation keeps established WebSockets open. Close the
  // transport too, then ensure retries fail offline and recover when restored.
  await page.evaluate(() => window.testSockets.forEach(socket => socket.close()));
  await page.getByText('Disconnected — retrying', { exact: false }).first().waitFor({ timeout: 15000 });
  await context.setOffline(false);
  await page.getByText(/Connected · thermal-reserve-dev/).waitFor({ timeout: 45000 });
  results.push('Spacetime network loss and reconnect');
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ['home', 'whatif', 'validation']) {
      await page.goto(`${url}/${route}`);
      await page.locator('h1').waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} fits ${width}px`);
      assert((await page.title()).includes('Thermal Reserve'));
    }
  }
  results.push('home/whatif/validation: 360, 390, 430px and page titles');
  await page.goto(`${url}/whatif`);
  await page.getByText('Show the math', { exact: true }).click();
  assert(await page.locator('.public-math').getAttribute('open') !== null);
  await page.getByLabel('Participation', { exact: true }).focus();
  const previous = await page.getByLabel('Participation', { exact: true }).inputValue();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(value => document.querySelector('input[aria-label="Participation"]').value !== value, previous);
  const shared = page.url();
  assert(shared.includes('?'));
  const participation = await page.getByLabel('Participation', { exact: true }).inputValue();
  await page.reload();
  assert.equal(await page.getByLabel('Participation', { exact: true }).inputValue(), participation);
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'));
  await context.setOffline(true);
  await page.getByRole('link', { name: 'Validation', exact: true }).click();
  await page.getByRole('heading', { name: 'Validation', exact: true }).waitFor();
  await page.getByRole('link', { name: 'What-if calculator', exact: true }).click();
  await page.getByRole('heading', { name: 'What-if calculator', exact: true }).waitFor();
  await context.setOffline(false);
  results.push('calculator share URL, math, keyboard focus; loaded public pages work offline');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'W7 automated checks PASS', results, pageErrors: errors, manualPending: ['Safari and real-device accessibility/keyboard checks'] }));
} finally { await browser.close(); }
