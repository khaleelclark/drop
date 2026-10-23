#!/usr/bin/env node
// Actual arrival posting and SystemUI click on a disposable, already-permitted emulator.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { chromium, expect } = createRequire(path.resolve(__dirname, '../web/package.json'))('@playwright/test');
const adb = process.env.HOUSEHOLD_ADB || '/home/phoenix/Android/Sdk/platform-tools/adb';
const serial = process.env.HOUSEHOLD_ANDROID_SERIAL || 'emulator-5580';
const shell = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8' });

async function main() {
  if (!serial.startsWith('emulator-') || !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.HOUSEHOLD_ANDROID_URL || '')) throw Error('Use a disposable emulator and explicit loopback test origin.');
  const output = path.resolve(process.env.HOUSEHOLD_ANDROID_OUTPUT || '.tools/validation/zing-android');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19224', { noDefaults: true });
  const page = browser.contexts()[0].pages().find(p => p.url().startsWith('http://tauri.localhost'));
  const invoke = (command, args) => page.evaluate(({ command, args }) => window.__HOUSEHOLD_NATIVE__.invoke(command, args), { command, args });
  const api = (method, route, body) => invoke('native_api', { method, path: route, ...(body === undefined ? {} : { body }) });
  let itemId;
  let enabledByTest = false;
  try {
    await page.reload();
    await page.waitForFunction(() => window.householdPlatform?.kind === 'native');
    const config = await invoke('native_get_config');
    expect(config.baseUrl).toBe(process.env.HOUSEHOLD_ANDROID_URL);
    await expect.poll(async () => JSON.parse((await api('GET', '/api/devices')).body).devices.map(row => row.id)).toContain(config.deviceId);
    const initial = await invoke('native_get_arrival_settings');
    expect(initial.enabled).toBe(false);
    expect(initial.permission).toBe('granted');
    const sender = '6'.repeat(32);
    expect((await api('POST', '/api/devices/register', { id: sender, label: 'Private sender label', platform: 'linux' })).status).toBe(200);
    const prior = JSON.parse((await api('GET', `/api/devices/${config.deviceId}/notifications`)).body);
    expect(prior.notifications).toEqual([]);
    const sent = await api('POST', '/api/text', { text: 'PRIVATE_ARRIVAL_CONTENT', name: 'PRIVATE_ARRIVAL_NAME.md', sourceDeviceId: sender, targetDeviceIds: [config.deviceId] });
    expect(sent.status).toBe(201);
    itemId = JSON.parse(sent.body).item.id;
    const before = JSON.parse((await api('GET', `/api/devices/${config.deviceId}/notifications`)).body);
    expect(before.notifications.map(row => row.itemId)).toEqual([itemId]);
    expect(before.ackCursor).toBe(prior.ackCursor);
    expect(BigInt(before.nextCursor) > BigInt(before.ackCursor)).toBe(true);
    const transfers = await invoke('native_list_transfers');
    await invoke('native_copy_text', { text: 'Arrival click must leave my clipboard alone.' });
    enabledByTest = true;
    const enabled = await invoke('native_set_arrival_enabled', { enabled: true });
    expect(enabled.enabled).toBe(true);
    expect(enabled.permission).toBe('granted');
    await expect.poll(async () => JSON.parse((await api('GET', `/api/devices/${config.deviceId}/notifications`)).body).ackCursor, { timeout: 20000 }).toBe(before.nextCursor);
    const dump = shell('shell', 'dumpsys', 'notification', '--noredact');
    const record = dump.split(/(?=NotificationRecord\()/).find(block => block.includes('pkg=net.household.share.mobile') && block.includes('channel=zing-arrivals'));
    expect(record).toBeTruthy();
    expect(record).toContain('New share available');
    expect(record).not.toContain('PRIVATE_ARRIVAL_CONTENT');
    expect(record).not.toContain('PRIVATE_ARRIVAL_NAME');
    expect(record).not.toContain('Private sender label');
    shell('shell', 'cmd', 'statusbar', 'expand-notifications');
    const dumpUI = () => {
      try { shell('shell', 'uiautomator', 'dump', '/sdcard/zing-arrival-check.xml'); }
      catch (error) { if (error.status !== 137 || !String(error.stdout).includes('UI hierchary dumped to: /sdcard/zing-arrival-check.xml')) throw error; }
      return shell('exec-out', 'cat', '/sdcard/zing-arrival-check.xml');
    };
    const xml = dumpUI();
    const node = xml.match(/<node\b[^>]*text="New share available"[^>]*>/);
    expect(node).toBeTruthy();
    const bounds = node[0].match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    expect(bounds).toBeTruthy();
    await fs.writeFile(path.join(output, 'android-arrival-system-ui.png'), execFileSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p']));
    shell('shell', 'input', 'tap', String(Math.round((Number(bounds[1]) + Number(bounds[3])) / 2)), String(Math.round((Number(bounds[2]) + Number(bounds[4])) / 2)));
    await expect(page.locator('#share-' + itemId)).toHaveClass(/arrival-highlight/, { timeout: 15000 });
    await expect(page.getByRole('navigation', { name: 'Mobile feed filters' }).getByRole('button', { name: 'For you', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(await invoke('native_list_transfers')).toEqual(transfers);
    const composer = page.getByRole('textbox', { name: 'Text to share', exact: true });
    await composer.fill('');
    await composer.focus();
    shell('shell', 'input', 'keyevent', '279');
    await expect(composer).toHaveValue('Arrival click must leave my clipboard alone.');
    await composer.fill('');
    await page.getByRole('button', { name: 'Done editing', exact: true }).click();
    await fs.writeFile(path.join(output, 'android-arrivals.json'), JSON.stringify({ passed: true, scope: 'Actual API36 x86_64 installed Tauri app, disposable Go API and Android SystemUI', checks: ['default-off settings and unacknowledged ready arrival', 'explicit visible Enable with previously granted OS permission', 'actual NotificationManager record and durable server ACK', 'generic notification text without sender/name/content', 'visible SystemUI notification and actual coordinate click', 'click opens and highlights exact For you item', 'no automatic download or clipboard replacement'], limits: ['does not test initial permission prompt or denial-to-grant', 'foreground arrival then notification-shade click; no cold-process launch claim', 'no periodic background scheduling, lock-screen, reboot, Doze, physical phone or 20 GB validation'] }, null, 2) + '\n');
    console.log('PASS: actual Android arrival notification, generic SystemUI content, ACK and click to For you without automatic Copy/Download');
  } finally {
    shell('shell', 'cmd', 'statusbar', 'collapse');
    if (enabledByTest) await invoke('native_set_arrival_enabled', { enabled: false }).catch(() => {});
    if (itemId) await api('DELETE', `/api/items/${itemId}`).catch(() => {});
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
