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
const output = path.resolve(process.env.HOUSEHOLD_ANDROID_OUTPUT || path.resolve(__dirname, '../.tools/ui-zing/android'));
const shell = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8' });
const inset = type => shell('shell', 'dumpsys', 'window').match(new RegExp(`type=${type} frame=\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\].*visible=true`));
const screenshot = async name => fs.writeFile(path.join(output, name), execFileSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p']));

async function main() {
  if (!serial.startsWith('emulator-')) throw new Error('This check requires a disposable emulator.');
  await fs.mkdir(output, { recursive: true });
  const config = JSON.parse(await fs.readFile(path.resolve(__dirname, '../clients/android/src-tauri/tauri.conf.json'), 'utf8'));
  const version = config.version;
  const versionCode = config.bundle.android.versionCode;
  const installed = shell('shell', 'dumpsys', 'package', 'net.household.share.mobile');
  if (!installed.includes(`versionName=${version}`) || !installed.includes(`versionCode=${versionCode} `)) throw new Error(`Install the final ${version}/code${versionCode} APK first.`);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19224', { noDefaults: true });
  const page = browser.contexts()[0].pages().find(row => row.url().startsWith('http://tauri.localhost'));
  if (!page) { await browser.close(); throw new Error('Installed Tauri page not found'); }
  const browserApi = [];
  let fixtureId;
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) browserApi.push(request.url()); });
  const composer = page.getByRole('textbox', { name: 'Text to share', exact: true });
  const search = page.getByRole('searchbox');
  const tabs = page.getByRole('navigation', { name: 'Mobile feed filters', includeHidden: true });
  const kind = page.getByRole('combobox', { name: 'Content type', exact: true });
  const done = page.getByRole('button', { name: 'Done editing', exact: true });
  const originalDraft = await composer.inputValue();
  const originalSearch = await search.inputValue();
  const originalKind = await kind.inputValue();
  const navNode = await tabs.elementHandle();
  const draft = 'Bottom tabs preserve my draft: café 🏠\n  Spaces stay.';
  const measurements = [];
  async function checkTargets(boundary, stage) {
    const rows = await tabs.locator('.mobile-tab-list').getByRole('button').evaluateAll(buttons => buttons.map(button => {
      const rect = button.getBoundingClientRect();
      return { label: button.textContent, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height,
        uncovered: button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
    }));
    expect(rows.map(row => row.label)).toEqual(['All shares', 'For you', 'Pinned']);
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
    await page.evaluate(() => {
      window.__householdImeEvidence = [];
      window.addEventListener('household-keyboard-visibility', event => {
        window.__householdImeEvidence.push(event.detail);
      });
    });
    const connection = await page.evaluate(() => window.__HOUSEHOLD_NATIVE__.invoke('native_get_config'));
    expect(connection.baseUrl).toBe(process.env.HOUSEHOLD_ANDROID_URL || 'http://127.0.0.1:18877');
    const fixture = await page.evaluate(() => window.__HOUSEHOLD_NATIVE__.invoke('native_api', {
      method: 'POST', path: '/api/text', body: { text: 'Installed navigation fixture: café 🏠', name: 'Navigation fixture' },
    }));
    expect(fixture.status).toBe(201);
    fixtureId = JSON.parse(fixture.body).item.id;
    if (inset('ime')) shell('shell', 'input', 'keyevent', '4');
    await expect.poll(() => Boolean(inset('ime'))).toBe(false);
    if (await done.count()) await done.click();
    await expect(tabs).toHaveCount(1);
    await expect.poll(() => tabs.evaluate(node => getComputedStyle(node).position)).toBe('fixed');
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: visualViewport.scale, dpr: devicePixelRatio, contentWidth: document.documentElement.scrollWidth }));
    expect(viewport.scale).toBeCloseTo(1, 2);
    expect(viewport.contentWidth).toBeLessThanOrEqual(viewport.width + 1);
    const safeArea = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return { android: document.documentElement.hasAttribute('data-native-android'),
        values: ['top', 'right', 'bottom', 'left'].map(side => styles.getPropertyValue(`--safe-area-${side}`).trim()),
        headerHeight: document.querySelector('.topbar').getBoundingClientRect().height,
        tabBarHeight: document.querySelector('.mobile-tabs').getBoundingClientRect().height };
    });
    expect(safeArea.android).toBe(true);
    expect(safeArea.values).toEqual(['0px', '0px', '0px', '0px']);
    expect(safeArea.headerHeight).toBeCloseTo(64, 0);
    expect(safeArea.tabBarHeight).toBeCloseTo(72, 0);
    shell('shell', 'rm', '-f', '/sdcard/household-tabs-bounds.xml');
    try { shell('shell', 'uiautomator', 'dump', '/sdcard/household-tabs-bounds.xml'); }
    catch (error) {
      // Some emulator runs kill the dump process after it has written the complete XML.
      if (error.status !== 137 || !String(error.stdout).includes('UI hierchary dumped to: /sdcard/household-tabs-bounds.xml')) throw error;
    }
    const nativeBounds = shell('exec-out', 'cat', '/sdcard/household-tabs-bounds.xml').match(/class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!nativeBounds) throw new Error('Inspected native WebView bounds unavailable');
    const webViewBounds = { left: Number(nativeBounds[1]), top: Number(nativeBounds[2]), right: Number(nativeBounds[3]), bottom: Number(nativeBounds[4]) };
    const systemBar = inset('navigationBars');
    if (!systemBar) throw new Error('Visible Android navigation-bar bounds unavailable');
    const safeBottom = (Number(systemBar[2]) - webViewBounds.top) / viewport.dpr;
    await checkTargets(safeBottom, 'docked above Android navigation area');
    const heading = await page.locator('.feed-title').boundingBox();
    const filter = await kind.boundingBox();
    const searchRow = await page.locator('.search-field').boundingBox();
    const toolbar = await page.locator('.feed-toolbar').boundingBox();
    expect(searchRow.y).toBeGreaterThanOrEqual(Math.max(heading.y + heading.height, filter.y + filter.height));
    expect(searchRow.width).toBeGreaterThanOrEqual(toolbar.width - 1);
    await screenshot('android-tabs-docked.png');

    await composer.fill(draft);
    await composer.click();
    await expect.poll(() => Boolean(inset('ime'))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__householdImeEvidence.at(-1)?.visible)).toBe(true);
    const keyboardTop = (Number(inset('ime')[2]) - webViewBounds.top) / viewport.dpr;
    await expect(tabs).toBeHidden();
    const doneBounds = await done.boundingBox();
    expect(doneBounds.y + doneBounds.height).toBeLessThanOrEqual(keyboardTop + 1);
    const shareBounds = await page.getByRole('button', { name: 'Share text', exact: true }).boundingBox();
    expect(shareBounds.y + shareBounds.height).toBeLessThanOrEqual(keyboardTop + 1);
    await screenshot('android-tabs-keyboard.png');
    shell('shell', 'input', 'keyevent', '4');
    await expect.poll(() => Boolean(inset('ime'))).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__householdImeEvidence.at(-1)?.visible)).toBe(false);
    await expect(tabs).toBeVisible();
    await expect(composer).toHaveValue(draft);
    expect(await tabs.evaluate((node, original) => node === original, navNode)).toBe(true);
    await expect.poll(() => tabs.evaluate(node => getComputedStyle(node).position)).toBe('fixed');
    await checkTargets(safeBottom, 'redocked after Android Back without Done');
    await screenshot('android-tabs-after-back.png');

    await kind.selectOption('file');
    await tabs.getByRole('button', { name: 'For you', exact: true }).click();
    await expect(tabs.getByRole('button', { name: 'For you', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(kind).toHaveValue('file');
    await expect(composer).toHaveValue(draft);
    shell('shell', 'input', 'keyevent', '3');
    shell('shell', 'am', 'start', '-W', '-n', 'net.household.share.mobile/.MainActivity');
    if (inset('ime')) shell('shell', 'input', 'keyevent', '4');
    await expect.poll(() => Boolean(inset('ime'))).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__householdImeEvidence.at(-1)?.visible)).toBe(false);
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'For you', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(kind).toHaveValue('file');
    await expect(composer).toHaveValue(draft);
    await checkTargets(safeBottom, 'visible after background and resume with keyboard closed');
    await screenshot('android-tabs-after-resume.png');
    await search.fill('Browser integration');
    await search.click();
    await expect(tabs).toBeHidden();
    await expect.poll(() => Boolean(inset('ime'))).toBe(true);
    const searchKeyboardTop = (Number(inset('ime')[2]) - webViewBounds.top) / viewport.dpr;
    const searchDone = await done.boundingBox();
    expect(searchDone.y + searchDone.height).toBeLessThanOrEqual(searchKeyboardTop + 1);
    await done.click();
    await expect(search).toHaveValue('Browser integration');
    await expect(composer).toHaveValue(draft);
    await expect(kind).toHaveValue('file');
    await search.fill(originalSearch);
    await done.click();
    await tabs.getByRole('button', { name: 'All shares', exact: true }).click();
    await kind.selectOption('all');
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
    const keyboardEvents = await page.evaluate(() => window.__householdImeEvidence);
    const report = { passed: true, version: `${version}/code${versionCode}`, apkSHA256: createHash('sha256').update(apk).digest('hex'), viewport, safeArea, webViewBounds, keyboardTop, safeBottom, measurements, keyboardEvents,
      checks: ['native bootstrap and no browser API traffic', 'three scope tabs above actual Android navigation area, at least 44px and uncovered', 'content-kind filter beside heading and full-width search below', 'actual OS keyboard and native visibility event hide feed tabs while leaving Share/Done visible', 'Android Back restores the same nav without Done and preserves draft', 'background/resume with closed keyboard restores nav, draft, scope and kind', 'content kind and For you scope preserve draft', 'search/Done preserves search, kind and draft', 'final feed action and item menu remain above bottom tabs'],
      limits: ['API36 x86_64 emulator only', 'not a physical phone or physical gesture check', 'not a background or20GB transfer check'] };
    await fs.writeFile(path.join(output, 'android-tabs.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: installed bottom tabs, actual keyboard/Back, navigation safe area, focus and draft/search preservation');
  } finally {
    if (fixtureId) await page.evaluate(id => window.__HOUSEHOLD_NATIVE__.invoke('native_api', { method: 'DELETE', path: `/api/items/${id}` }), fixtureId).catch(() => {});
    await composer.fill(originalDraft).catch(() => {});
    await search.fill(originalSearch).catch(() => {});
    if (await done.count()) await done.click().catch(() => {});
    await kind.selectOption(originalKind).catch(() => {});
    await tabs.getByRole('button', { name: 'All shares', exact: true }).click().catch(() => {});
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
