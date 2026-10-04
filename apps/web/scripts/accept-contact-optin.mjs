import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH);
assert.equal(process.env.CONTACT_TEST_APPROVED, '1', 'Confirm companion onboarding is off on dev before writing the fictional contact');
const browser = await chromium.launch({ headless: true });
const url = process.env.WEB_URL || 'http://127.0.0.1:5173';
const errors = [];
try {
  const ordinaryContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const ordinary = await ordinaryContext.newPage();
  ordinary.on('pageerror', error => errors.push(error.message));
  await ordinary.goto(`${url}/home?db=thermal-reserve-dev`);
  await ordinary.getByRole('button', { name: 'Join as an Anchorage home', exact: true }).click();
  await ordinary.getByRole('button', { name: 'Continue', exact: true }).click();
  const checkbox = ordinary.getByRole('checkbox', { name: 'Text me updates by iMessage', exact: true });
  assert(!await checkbox.isChecked());
  assert.equal(await ordinary.getByLabel('First name', { exact: true }).count(), 0);
  await ordinary.getByRole('button', { name: 'Join', exact: true }).click();
  await ordinary.locator('.heat-card').waitFor({ timeout: 30000 });
  assert.equal(await ordinary.locator('.home-contact').count(), 0);
  await ordinary.locator('.link-code').waitFor();
  assert(await ordinary.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const optedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const opted = await optedContext.newPage();
  opted.on('pageerror', error => errors.push(error.message));
  await opted.goto(`${url}/home?db=thermal-reserve-dev`);
  await opted.getByRole('button', { name: 'Join as an Anchorage home', exact: true }).click();
  await opted.getByLabel('Nickname (optional)', { exact: true }).fill('WEB contact test');
  await opted.getByRole('button', { name: 'Continue', exact: true }).click();
  await opted.getByRole('checkbox', { name: 'Text me updates by iMessage', exact: true }).check();
  assert.equal(await opted.locator('input[type=email]').count(), 0);
  await opted.getByLabel('First name', { exact: true }).fill('WEB');
  await opted.getByLabel('Last name', { exact: true }).fill('Test');
  await opted.getByLabel('Phone', { exact: true }).fill('invalid');
  assert(await opted.getByText('Demo only. Your name and number are stored privately for this demo, never shown publicly, and deleted when you reply STOP or the demo resets.', { exact: true }).isVisible());
  await opted.getByRole('button', { name: 'Join', exact: true }).click();
  await opted.locator('.heat-card').waitFor();
  await opted.getByRole('alert').filter({ hasText: 'phone: expected a number like +19075550123' }).waitFor();
  assert(await opted.getByRole('button', { name: 'Override', exact: true }).isEnabled());
  assert.equal(await opted.getByLabel('Phone', { exact: true }).inputValue(), 'invalid');
  await opted.getByLabel('Phone', { exact: true }).fill('+1 (907) 555-0123');
  await opted.getByLabel('First name', { exact: true }).fill('');
  await opted.getByRole('button', { name: 'Save iMessage details', exact: true }).click();
  await opted.getByRole('alert').filter({ hasText: 'first_name: required' }).waitFor();
  await opted.getByLabel('First name', { exact: true }).fill('WEB');
  await opted.getByRole('button', { name: 'Save iMessage details', exact: true }).click();
  await opted.getByText('You opted in to iMessage updates. Reply STOP any time.', { exact: true }).waitFor();
  assert.equal(await opted.getByRole('alert').count(), 0);
  assert.equal(await opted.getByLabel('Phone', { exact: true }).count(), 0);
  assert(await opted.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await opted.getByRole('button', { name: 'Override', exact: true }).click();
  await opted.getByRole('button', { name: 'Rejoin event', exact: true }).waitFor();
  await opted.getByRole('button', { name: 'Rejoin event', exact: true }).click();
  await opted.getByRole('button', { name: 'Override', exact: true }).waitFor();
  await opted.screenshot({ path: '/tmp/thermal-reserve-contact-optin.png', fullPage: true });
  // Use this browser's own identity to verify private-view access and clean up its contact.
  const result = await opted.evaluate(async () => {
    const { DbConnection } = await import('/@fs/home/allenguo/mhacks26-codex/ThermalReserve/packages/stdb-bindings/src/index.ts');
    const token = localStorage.getItem('thermal-reserve.identity:wss://maincloud.spacetimedb.com:thermal-reserve-dev');
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Privacy inspector timed out')), 30000);
      DbConnection.builder().withUri('wss://maincloud.spacetimedb.com').withDatabaseName('thermal-reserve-dev').withToken(token)
        .onConnect(conn => conn.subscriptionBuilder().onApplied(async () => {
          try { const rows = [...conn.db.contactFeed.iter()].length; await conn.reducers.clearContact({}); clearTimeout(timer); conn.disconnect(); resolve({ rows }); }
          catch (error) { clearTimeout(timer); conn.disconnect(); reject(error); }
        }).subscribe('SELECT * FROM contact_feed'))
        .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
    });
  });
  assert.equal(result.rows, 0, 'A household cannot read private contacts');
  const noCryptoContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
  await noCryptoContext.addInitScript(() => {
    Object.defineProperty(crypto.subtle, 'digest', { value: () => Promise.reject(new Error('Crypto unavailable')) });
  });
  const noCrypto = await noCryptoContext.newPage();
  noCrypto.on('pageerror', error => errors.push(error.message));
  await noCrypto.goto(`${url}/home?db=thermal-reserve-dev`);
  await noCrypto.getByRole('button', { name: 'Join as an Anchorage home', exact: true }).click();
  await noCrypto.getByRole('button', { name: 'Continue', exact: true }).click();
  await noCrypto.getByRole('button', { name: 'Join', exact: true }).click();
  await noCrypto.locator('.heat-card').waitFor();
  assert.equal(await noCrypto.locator('.home-imessage').count(), 0);
  assert(await noCrypto.getByRole('button', { name: 'Override', exact: true }).isEnabled());
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ acceptance: 'Mobile contact opt-in PASS', ordinaryThreeTapJoin: true, uncheckedByDefault: true, serverPhoneErrorVisible: true, requiredNameErrorVisible: true, retryAfterEnrollment: true, heatControlsWork: true, contactFieldsCleared: true, privateViewEmpty: true, ownContactCleared: true, cryptoFailureNonblocking: true, layouts: [360, 390], pageErrors: errors }));
} finally { await browser.close(); }
