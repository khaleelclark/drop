#!/usr/bin/env node
// Installed Zing integration against the explicitly configured disposable loopback server.
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
  const created = [];
  const requests = [];
  const api = (method, route, body) => page.evaluate(args => window.__HOUSEHOLD_NATIVE__.invoke('native_api', args), { method, path: route, ...(body === undefined ? {} : { body }) });
  const invoke = (command, args) => page.evaluate(({ command, args }) => window.__HOUSEHOLD_NATIVE__.invoke(command, args), { command, args });
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  try {
    await page.reload();
    await page.waitForFunction(() => window.householdPlatform?.kind === 'native');
    const config = await invoke('native_get_config');
    expect(config.baseUrl).toBe(process.env.HOUSEHOLD_ANDROID_URL);
    expect(config.deviceId).toMatch(/^[a-f0-9]{32}$/);
    expect(config.token).toBeUndefined();
    const settings = await invoke('native_get_arrival_settings');
    expect(settings.enabled).toBe(false);
    await expect.poll(async () => JSON.parse((await api('GET', '/api/devices')).body).devices.map(row => row.id)).toContain(config.deviceId);
    const sender = '7'.repeat(32);
    expect((await api('POST', '/api/devices/register', { id: sender, label: 'Integration sender', platform: 'linux' })).status).toBe(200);
    const original = '\ufeff  Native Markdown 家 🏠\r\n```js\r\nconst value = "café";\r\n```\r\n';
    const result = await api('POST', '/api/text', { name: 'Installed shared board.md', text: original, sourceDeviceId: sender, targetDeviceIds: [config.deviceId] });
    expect(result.status).toBe(201);
    const item = JSON.parse(result.body).item;
    created.push(item.id);
    const tabs = page.getByRole('navigation', { name: 'Mobile feed filters' });
    await tabs.getByRole('button', { name: 'For you', exact: true }).click();
    const card = page.locator('#share-' + item.id).getByRole('article');
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.getByRole('button', { name: /^More actions for / }).click();
    await card.getByRole('menuitem', { name: 'Edit entry', exact: true }).click();
    const edited = original + 'Saved on Android.\n';
    await card.getByLabel('Entry text').fill(edited.replace(/\r\n/g, '\n'));
    await card.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(card.getByLabel('Entry text')).toHaveCount(0);
    expect((await api('GET', `/api/items/${item.id}/text`)).body).toBe(edited);
    await card.getByRole('button', { name: 'Copy text', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
    const composer = page.getByRole('textbox', { name: 'Text to share', exact: true });
    await composer.fill('');
    await composer.focus();
    shell('shell', 'input', 'keyevent', '279');
    await expect(composer).toHaveValue(edited.replace(/\r\n/g, '\n'));
    await composer.fill('');
    await page.getByRole('button', { name: 'Done editing', exact: true }).click();
    await card.getByRole('button', { name: /^More actions for / }).click();
    await card.getByRole('menuitem', { name: 'Edit entry', exact: true }).click();
    await card.getByLabel('Entry text').fill('Unsaved installed draft');
    const current = JSON.parse((await api('GET', `/api/items/${item.id}`)).body).item;
    expect((await api('PATCH', `/api/items/${item.id}`, { text: 'Concurrent household edit', expectedUpdatedAt: current.updatedAt })).status).toBe(200);
    await card.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(card.getByRole('alert')).toContainText('Your draft is kept');
    await expect(card.getByLabel('Entry text')).toHaveValue('Unsaved installed draft');
    await page.screenshot({ path: path.join(output, 'android-shared-conflict.png') });
    await card.getByRole('button', { name: 'Cancel editing', exact: true }).click();
    const before = JSON.parse((await api('GET', `/api/devices/${config.deviceId}/notifications`)).body);
    expect(before.notifications.map(row => row.itemId)).toEqual([item.id]);
    expect((await api('POST', `/api/devices/${config.deviceId}/notifications/ack`, { through: before.nextCursor })).status).toBe(200);
    await page.reload();
    await tabs.getByRole('button', { name: 'For you', exact: true }).click();
    await expect(card).toBeVisible();
    expect((await invoke('native_get_config')).deviceId).toBe(config.deviceId);
    expect(requests).toEqual([]);
    await fs.writeFile(path.join(output, 'android-shared-board.json'), JSON.stringify({ passed: true, platform: 'Installed API36 x86_64 Tauri APK', checks: ['retained origin-scoped native identity', 'arrival checks default off', 'real native API registration and recipient routing', 'For you displays targeted shared entry', 'UI Save preserves BOM/CRLF/Unicode in server bytes', 'native Copy followed by actual Android Paste', 'concurrent Save retains unsaved draft', 'editing adds no arrival', 'For you history survives ACK and WebView reload', 'no browser API transport'], limits: ['Android textarea normalizes CRLF on pasted input; server bytes checked separately', 'no OS notification permission/presentation or background acceptance', 'no physical phone, Mac or 20 GB test'] }, null, 2) + '\n');
    console.log('PASS: installed native routing, shared Save, exact server bytes/clipboard, conflict draft and For you after ACK/reload');
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'android-shared-failure.png') }).catch(() => {});
    throw error;
  } finally {
    for (const id of created) await api('DELETE', `/api/items/${id}`).catch(() => {});
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
