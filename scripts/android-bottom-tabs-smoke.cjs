#!/usr/bin/env node
// Installed API36 check: real OS IME/Back and navigation-bar bounds, not a browser keyboard fixture.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { chromium, expect } = createRequire(path.resolve(__dirname, '../web/package.json'))('@playwright/test');
const adb = process.env.HOUSEHOLD_ADB || '/home/phoenix/Android/Sdk/platform-tools/adb';
const serial = process.env.HOUSEHOLD_ANDROID_SERIAL || 'emulator-5580';
const output = path.resolve(__dirname, '../.tools/ui-bottom-tabs');
const shell = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8' });
const inset = type => shell('shell', 'dumpsys', 'window').match(new RegExp(`type=${type} frame=\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\].*visible=true`));
const screenshot = async name => fs.writeFile(path.join(output, name), execFileSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p']));

async function main() {
  if (!serial.startsWith('emulator-')) throw new Error('This check requires a disposable emulator.');
  await fs.mkdir(output, { recursive: true });
  const installed = shell('shell', 'dumpsys', 'package', 'net.household.share.mobile');
  if (!installed.includes('versionName=0.1.2') || !installed.includes('versionCode=1002 ')) throw new Error('Install the final 0.1.2/code1002 APK first.');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19224', { noDefaults: true });
  const page = browser.contexts()[0].pages().find(row => row.url().startsWith('http://tauri.localhost'));
  if (!page) { await browser.close(); throw new Error('Installed Tauri page not found'); }
  const browserApi = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) browserApi.push(request.url()); });
  const composer = page.getByRole('textbox', { name: 'Text to share', exact: true });
  const search = page.getByRole('searchbox');
  const tabs = page.getByRole('navigation', { name: 'Mobile feed filters' });
  const done = page.getByRole('button', { name: 'Done editing', exact: true });
  const originalDraft = await composer.inputValue();
  const originalSearch = await search.inputValue();
  const navNode = await tabs.elementHandle();
  const draft = 'Bottom tabs preserve my draft: café 🏠\n  Spaces stay.';
  const measurements = [];
  async function checkTargets(boundary, stage) {
    const rows = await tabs.locator('.mobile-tab-list').getByRole('button').evaluateAll(buttons => buttons.map(button => {
      const rect = button.getBoundingClientRect();
      return { label: button.textContent, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height,
        uncovered: button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
    }));
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.height).toBeGreaterThanOrEqual(44);
      expect(row.top).toBeGreaterThanOrEqual(0);
      expect(row.bottom).toBeLessThanOrEqual(boundary + 1);
      expect(row.uncovered).toBe(true);
    }
    measurements.push({ stage, boundary, rows });
  }
  try {
    expect(await page.evaluate(() => window.householdPlatform.kind)).toBe('native');
    if (inset('ime')) shell('shell', 'input', 'keyevent', '4');
    await expect.poll(() => Boolean(inset('ime'))).toBe(false);
    if (await done.count()) await done.click();
    await expect(tabs).toHaveCount(1);
    await expect.poll(() => tabs.evaluate(node => getComputedStyle(node).position)).toBe('fixed');
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: visualViewport.scale, dpr: devicePixelRatio, contentWidth: document.documentElement.scrollWidth }));
    expect(viewport.scale).toBeCloseTo(1, 2);
    expect(viewport.contentWidth).toBeLessThanOrEqual(viewport.width + 1);
    shell('shell', 'uiautomator', 'dump', '/sdcard/household-tabs-bounds.xml');
    const nativeBounds = shell('exec-out', 'cat', '/sdcard/household-tabs-bounds.xml').match(/class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!nativeBounds) throw new Error('Inspected native WebView bounds unavailable');
    const webViewBounds = { left: Number(nativeBounds[1]), top: Number(nativeBounds[2]), right: Number(nativeBounds[3]), bottom: Number(nativeBounds[4]) };
    const systemBar = inset('navigationBars');
    if (!systemBar) throw new Error('Visible Android navigation-bar bounds unavailable');
    const safeBottom = (Number(systemBar[2]) - webViewBounds.top) / viewport.dpr;
    await checkTargets(safeBottom, 'docked above Android navigation area');
    await screenshot('android-tabs-docked.png');

    await composer.fill(draft);
    await composer.click();
    await expect.poll(() => Boolean(inset('ime'))).toBe(true);
    const keyboardTop = (Number(inset('ime')[2]) - webViewBounds.top) / viewport.dpr;
    await expect(tabs).toHaveClass(/is-editing/);
    await checkTargets(keyboardTop, 'editing with actual OS keyboard');
    const doneBounds = await done.boundingBox();
    expect(doneBounds.y + doneBounds.height).toBeLessThanOrEqual(keyboardTop + 1);
    const shareBounds = await page.getByRole('button', { name: 'Share text', exact: true }).boundingBox();
    expect(shareBounds.y + shareBounds.height).toBeLessThanOrEqual(keyboardTop + 1);
    await screenshot('android-tabs-keyboard.png');
    shell('shell', 'input', 'keyevent', '4');
    await expect.poll(() => Boolean(inset('ime'))).toBe(false);
    await expect(tabs).toBeVisible();
    expect(await tabs.evaluate((node, original) => node === original, navNode)).toBe(true);
    await expect(composer).toHaveValue(draft);
    await done.click();
    await expect.poll(() => tabs.evaluate(node => getComputedStyle(node).position)).toBe('fixed');
    await checkTargets(safeBottom, 'redocked after Back and Done');

    await tabs.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(tabs.getByRole('button', { name: 'Files', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(composer).toHaveValue(draft);
    await search.fill('Browser integration');
    await search.click();
    await expect(tabs).toHaveClass(/is-editing/);
    await expect.poll(() => Boolean(inset('ime'))).toBe(true);
    await tabs.scrollIntoViewIfNeeded();
    const searchKeyboardTop = (Number(inset('ime')[2]) - webViewBounds.top) / viewport.dpr;
    await checkTargets(searchKeyboardTop, 'search with actual OS keyboard');
    const searchDone = await done.boundingBox();
    expect(searchDone.y + searchDone.height).toBeLessThanOrEqual(searchKeyboardTop + 1);
    await done.click();
    await expect(search).toHaveValue('Browser integration');
    await expect(composer).toHaveValue(draft);
    await search.fill(originalSearch);
    await done.click();
    await tabs.getByRole('button', { name: 'All shares', exact: true }).click();
    const lastItem = page.getByRole('article').last();
    await expect(lastItem).toBeVisible();
    await lastItem.scrollIntoViewIfNeeded();
    const lastAction = lastItem.getByRole('button', { name: /^(Copy text|Prepare copy|Download|Download \.txt)$/ }).first();
    const barTop = await tabs.evaluate(node => node.getBoundingClientRect().top);
    const actionBounds = await lastAction.boundingBox();
    expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(barTop + 1);
    expect(await lastAction.evaluate(button => {
      const rect = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    await lastItem.getByRole('button', { name: /^More actions for / }).click();
    const menuBounds = await lastItem.getByRole('menu').boundingBox();
    expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(barTop + 1);
    await screenshot('android-tabs-last-item.png');
    await page.keyboard.press('Escape');
    await expect(lastItem.getByRole('menu')).toHaveCount(0);
    expect(browserApi).toEqual([]);
    const apk = await fs.readFile(path.resolve(__dirname, '../clients/android/build/outputs/household-share-tauri-x86_64-debug.apk'));
    const report = { passed: true, version: '0.1.2/code1002', apkSHA256: createHash('sha256').update(apk).digest('hex'), viewport, webViewBounds, keyboardTop, safeBottom, measurements,
      checks: ['native bootstrap and no browser API traffic', 'one accessible bottom tab bar above actual Android navigation area', 'all four tab targets at least 44px and uncovered', 'actual OS keyboard leaves Share/tabs/Done visible', 'Android Back dismisses keyboard without losing navigation/draft', 'Done redocks same nav DOM', 'Files selection preserves draft', 'search/Done preserves search and draft', 'final feed action and item menu remain above bottom tabs'],
      limits: ['API36 x86_64 emulator only', 'not a physical phone or physical gesture check', 'not a background or20GB transfer check'] };
    await fs.writeFile(path.join(output, 'android-tabs.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: installed bottom tabs, actual keyboard/Back, navigation safe area, focus and draft/search preservation');
  } finally {
    await composer.fill(originalDraft).catch(() => {});
    await search.fill(originalSearch).catch(() => {});
    if (await done.count()) await done.click().catch(() => {});
    await tabs.getByRole('button', { name: 'All shares', exact: true }).click().catch(() => {});
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
