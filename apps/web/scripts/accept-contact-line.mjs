import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { DbConnection } from '../../../packages/stdb-bindings/src/index.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH);
assert.equal(process.env.CONTACT_TEST_APPROVED, '1', 'Confirm dev companion is off before writing fictional contacts');
const database = 'thermal-reserve-dev';
const uri = 'wss://maincloud.spacetimedb.com';
const url = process.env.WEB_URL || 'http://127.0.0.1:5173';
const passcode = process.env.STDB_PASSCODE || (await readFile('stdb/HANDOFF.md', 'utf8')).match(/For `thermal-reserve-dev` it is `([^`]+)`/)[1];
const connect = (token, queries) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Line inspector timed out')), 30000);
  DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token)
    .onConnect(conn => conn.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(conn); }).onError(ctx => { clearTimeout(timer); conn.disconnect(); reject(ctx.event); }).subscribe(queries))
    .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
});
const browser = await chromium.launch({ headless: true });
let reader, owner;
const errors = [];
try {
  reader = await connect(undefined, ['SELECT * FROM contact_feed', 'SELECT * FROM my_contact_line']);
  await reader.reducers.claimContactReader({ passcode });
  const ordinary = await browser.newPage({ viewport: { width: 360, height: 800 } });
  ordinary.on('pageerror', error => errors.push(error.message));
  await ordinary.goto(`${url}/home?db=${database}`);
  await ordinary.getByRole('button', { name: 'Join as an Anchorage home', exact: true }).click();
  await ordinary.getByRole('button', { name: 'Continue', exact: true }).click();
  assert(!await ordinary.getByRole('checkbox', { name: 'Text me updates by iMessage', exact: true }).isChecked());
  await ordinary.getByRole('button', { name: 'Join', exact: true }).click();
  await ordinary.locator('.heat-card').waitFor();
  assert.equal(await ordinary.locator('.home-contact, .home-imessage, .link-code').count(), 0);
  await ordinary.locator('.own-household-map-dot').waitFor();
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on('pageerror', error => errors.push(error.message));
  await phone.goto(`${url}/home?db=${database}`);
  await phone.getByRole('button', { name: 'Join as an Anchorage home', exact: true }).click();
  await phone.getByLabel('Nickname (optional)', { exact: true }).fill('WEB assigned line test');
  await phone.getByRole('button', { name: 'Continue', exact: true }).click();
  await phone.getByRole('checkbox', { name: 'Text me updates by iMessage', exact: true }).check();
  await phone.getByLabel('First name', { exact: true }).fill('WEB');
  await phone.getByLabel('Last name', { exact: true }).fill('Test');
  await phone.getByLabel('Phone', { exact: true }).fill('+19075550123');
  await phone.getByRole('button', { name: 'Join', exact: true }).click();
  await phone.getByText('Setting up your iMessage line…', { exact: true }).waitFor();
  const token = await phone.evaluate(key => localStorage.getItem(key), `thermal-reserve.identity:${uri}:${database}`);
  owner = await connect(token, ['SELECT * FROM my_contact_line']);
  assert.equal([...owner.db.myContactLine.iter()].length, 0);
  await phone.reload();
  await phone.getByText('Setting up your iMessage line…', { exact: true }).waitFor();
  const message = 'START';
  await reader.reducers.setContactLine({ identity: owner.identity, line: '+1 (628) 555-0100' });
  await phone.getByText(`Text ${message} to +16285550100 to turn on iMessage updates.`, { exact: true }).waitFor();
  assert.equal(await phone.getByRole('link', { name: 'Text START', exact: true }).getAttribute('href'), `sms:+16285550100&body=${encodeURIComponent(message)}`);
  assert.equal(await phone.locator('.link-code, .home-imessage').count(), 0);
  assert(!(await phone.locator('body').innerText()).includes('Link my home'));
  assert(await phone.locator('.assigned-line').evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 24));
  assert.equal([...reader.db.myContactLine.iter()].length, 0, 'Reader cannot see household line through its own view');
  assert.equal(await ordinary.locator('.home-contact').count(), 0, 'Unchecked home sees no setup or assigned line');
  await reader.reducers.setContactLine({ identity: owner.identity, line: '+16285550101' });
  await phone.getByText(`Text ${message} to +16285550101 to turn on iMessage updates.`, { exact: true }).waitFor();
  await phone.reload();
  await phone.getByRole('link', { name: 'Text START', exact: true }).waitFor();
  assert.equal(await phone.getByRole('link', { name: 'Text START', exact: true }).getAttribute('href'), `sms:+16285550101&body=${encodeURIComponent(message)}`);
  for (const [width, height] of [[360, 800], [390, 844], [430, 900]]) {
    await phone.setViewportSize({ width, height });
    assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Phone width ${width}`);
    const dot = phone.locator('.own-household-map-dot');
    await dot.waitFor();
    const dotBounds = await dot.boundingBox(), mapBounds = await phone.locator('.household-map .map-frame').boundingBox();
    assert(dotBounds && mapBounds && dotBounds.x >= mapBounds.x && dotBounds.x + dotBounds.width <= mapBounds.x + mapBounds.width, 'Own home is inside map');
  }
  await phone.screenshot({ path: '/tmp/thermal-reserve-contact-line.png', fullPage: true });
  await phone.getByRole('button', { name: 'Override', exact: true }).click();
  await phone.getByRole('button', { name: 'Rejoin event', exact: true }).waitFor();
  await phone.getByRole('button', { name: 'Rejoin event', exact: true }).click();
  await phone.getByRole('button', { name: 'Override', exact: true }).waitFor();
  await reader.reducers.removeContact({ identity: owner.identity });
  await phone.waitForFunction(() => !document.querySelector('.home-contact'));
  assert.equal([...owner.db.myContactLine.iter()].length, 0, 'STOP-style deletion removes assigned line');
  await phone.reload();
  await phone.locator('.heat-card').waitFor();
  assert.equal(await phone.locator('.home-contact').count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ acceptance: 'Assigned iMessage line PASS', uncheckedJoinHasNoStep: true, pendingSurvivesReload: true, ownScopedSdkView: true, assignmentAndReplacementLive: true, assignedLineSurvivesReload: true, smsHrefPrefillsStart: true, noLinkCodes: true, assignedNumberProminent: true, ownMapDotVisible: true, layouts: [360, 390, 430], heatControlsWork: true, stopRemovesStep: true, pageErrors: errors }));
} finally {
  if (owner) await owner.reducers.clearContact({}).catch(() => {});
  owner?.disconnect(); reader?.disconnect(); await browser.close();
}
