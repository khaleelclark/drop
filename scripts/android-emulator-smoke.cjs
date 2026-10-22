#!/usr/bin/env node
// Uses an already-installed debug Tauri APK and explicitly forwarded disposable server.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { chromium, expect } = createRequire(path.resolve(__dirname, '../web/package.json'))('@playwright/test');
const adb = process.env.HOUSEHOLD_ADB || '/home/phoenix/Android/Sdk/platform-tools/adb';
const serial = process.env.HOUSEHOLD_ANDROID_SERIAL || 'emulator-5580';
function shell(...args) { return execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8' }); }

async function main() {
  const output = path.resolve(__dirname, '../.tools/validation');
  await fs.mkdir(output, { recursive: true });
  const token = (await fs.readFile(path.resolve(__dirname, '../.tools/ui-preview/token'), 'utf8')).trim();
  const coldLaunch = process.argv.includes('--cold-launch');
  if (coldLaunch) {
    if (!serial.startsWith('emulator-')) throw new Error('Cold-launch validation is limited to a disposable emulator.');
    shell('shell', 'am', 'force-stop', 'net.household.share.mobile');
    shell('shell', 'input', 'keyevent', '224');
    shell('shell', 'wm', 'dismiss-keyguard');
    shell('shell', 'am', 'start', '-n', 'net.household.share.mobile/.MainActivity');
    let processId;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { processId = shell('shell', 'pidof', 'net.household.share.mobile').trim(); } catch { processId = ''; }
      const sockets = shell('shell', 'cat', '/proc/net/unix');
      if (processId && sockets.includes(`@webview_devtools_remote_${processId}`)) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('No debuggable Android app page after launch');
    shell('forward', 'tcp:19224', `localabstract:webview_devtools_remote_${processId}`);
  }
  const browser = await chromium.connectOverCDP(process.env.HOUSEHOLD_ANDROID_CDP || 'http://127.0.0.1:19224', { noDefaults: true });
  const page = browser.contexts()[0].pages()[0];
  const browserApi = [];
  const runtimeErrors = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) browserApi.push(request.url()); });
  page.on('pageerror', error => runtimeErrors.push(error.message));
  let itemId;
  try {
    await expect.poll(() => page.evaluate(() => window.householdPlatform?.kind)).toBe('native');
    const initialConfig = await page.evaluate(() => window.__HOUSEHOLD_NATIVE__.invoke('native_get_config'));
    if (initialConfig.baseUrl !== 'http://127.0.0.1:18877' || !initialConfig.connected) {
      if (coldLaunch) throw new Error('Pair this disposable emulator once without --cold-launch before checking a cold launch.');
      await page.evaluate(async ({ token }) => {
        await window.__HOUSEHOLD_NATIVE__.invoke('native_configure', { baseUrl: 'http://127.0.0.1:18877', token, sourceDevice: 'Android emulator', allowInsecureLoopback: true });
      }, { token });
      await page.reload();
      await expect.poll(() => page.evaluate(() => window.householdPlatform?.kind)).toBe('native');
      // A test-driven reload can race a callback to the previous WebView document.
      // The following check measures the active workflow after pairing, not that reload.
      runtimeErrors.length = 0;
    }
    const config = await page.evaluate(() => window.__HOUSEHOLD_NATIVE__.invoke('native_get_config'));
    expect(config.connected).toBe(true);
    expect(config.token).toBeUndefined();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      contentWidth: document.documentElement.scrollWidth,
      scale: visualViewport.scale,
      inputs: [...document.querySelectorAll('input:not([type=file]), textarea')]
        .filter(element => element.getClientRects().length)
        .map(element => ({ name: element.getAttribute('aria-label'), fontSize: parseFloat(getComputedStyle(element).fontSize) })),
    }));
    expect(viewport.scale).toBeCloseTo(1, 2);
    expect(viewport.contentWidth).toBeLessThanOrEqual(viewport.width + 1);
    for (const input of viewport.inputs) expect(input.fontSize).toBeGreaterThanOrEqual(16);
    const text = `Android native integration ${Date.now()}\n\n  Keep Unicode: café 🏠 日本語.\n\t  `;
    await page.getByRole('textbox', { name: 'Text to share', exact: true }).fill(text);
    await page.getByRole('button', { name: 'Share text', exact: true }).click();
    const card = page.getByRole('article').filter({ hasText: text.split('\n')[0] });
    await expect(card.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
    const result = await page.evaluate(async ({ first }) => {
      const invoke = window.__HOUSEHOLD_NATIVE__.invoke;
      const feed = await invoke('native_api', { method: 'GET', path: '/api/items?limit=50' });
      const item = JSON.parse(feed.body).items.find(row => row.preview.startsWith(first));
      const body = await invoke('native_api', { method: 'GET', path: `/api/items/${item.id}/text`, requestId: 'emulator-exact-text' });
      return { id: item.id, ...body };
    }, { first: text.split('\n')[0] });
    itemId = result.id;
    expect(result.status).toBe(200);
    expect(result.body).toBe(text);
    expect(new Headers(result.headers).get('content-type')).toContain('text/plain');
    await card.getByRole('button', { name: 'Copy text', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
    const composer = page.getByRole('textbox', { name: 'Text to share', exact: true });
    await composer.fill('');
    await composer.focus();
    shell('shell', 'input', 'keyevent', '279'); // Android KEYCODE_PASTE uses the real native clipboard.
    await expect(composer).toHaveValue(text);
    await composer.fill('');
    await composer.tap();
    await expect.poll(() => page.evaluate(() => innerHeight)).toBeLessThan(viewport.height);
    const keyboard = await page.getByRole('button', { name: 'Share text', exact: true }).evaluate(button => {
      const rect = button.getBoundingClientRect();
      return { height: innerHeight, scale: visualViewport.scale, contentWidth: document.documentElement.scrollWidth,
        submit: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } };
    });
    expect(keyboard.scale).toBeCloseTo(1, 2);
    expect(keyboard.contentWidth).toBeLessThanOrEqual(viewport.width + 1);
    expect(keyboard.submit.top).toBeGreaterThanOrEqual(0);
    expect(keyboard.submit.bottom).toBeLessThanOrEqual(keyboard.height + 1);
    expect(keyboard.submit.left).toBeGreaterThanOrEqual(0);
    expect(keyboard.submit.right).toBeLessThanOrEqual(viewport.width + 1);
    expect(browserApi).toEqual([]);
    expect(runtimeErrors).toEqual([]);
    await page.screenshot({ path: path.join(output, 'android-emulator.png'), fullPage: false });
    const report = { passed: true, platform: 'Android API36 x86_64 disposable emulator', coldLaunch, viewport, keyboard, checks: ['automatic native bootstrap', 'explicit loopback development pairing', 'redacted config', 'UI text submit through real Kotlin API bridge', 'exact native text and headers', 'native clipboard write and Android paste', 'no browser API requests', 'initial scale 1 and no horizontal overflow', 'visible inputs at least 16 CSS px', 'OS keyboard resizes viewport and keeps Share action visible'], binaryTransfers: 'separate smoke; not implied by this text check', limitations: ['not a physical phone', 'not a 20 GB Android transfer', 'not screen-lock/OS-job lifecycle proof', 'not a physical pinch-gesture test'] };
    await fs.writeFile(path.join(output, 'android-emulator.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: installed Tauri Android bootstrap, real-server native text API, UI send, exact native clipboard/paste, response headers, zero browser API fetches');
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'android-emulator-failure.png'), fullPage: true }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(-1800));
    throw error;
  } finally {
    if (itemId) await page.evaluate(id => window.__HOUSEHOLD_NATIVE__.invoke('native_api', { method: 'DELETE', path: `/api/items/${id}` }), itemId).catch(() => {});
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
