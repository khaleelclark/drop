#!/usr/bin/env node
// Real-server browser round trip. Uses the frontend's installed Playwright dependency.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const requireWeb = createRequire(path.resolve(__dirname, '../web/package.json'));
const { chromium, expect } = requireWeb('@playwright/test');

async function main() {
  const baseURL = process.env.HOUSEHOLD_BROWSER_URL || 'http://127.0.0.1:18877';
  const tokenPath = process.env.HOUSEHOLD_BROWSER_TOKEN_FILE || path.resolve(__dirname, '../.tools/ui-preview/token');
  const token = (await fs.readFile(tokenPath, 'utf8')).trim();
  const output = path.resolve(__dirname, '../.tools/validation');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const failures = [];
  let primaryPage;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    primaryPage = page;
    page.on('pageerror', error => failures.push(error.message));
    await page.goto(baseURL);
    await page.getByRole('textbox', { name: 'App token', exact: true }).fill(token);
    await page.getByRole('button', { name: 'Connect household', exact: true }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const text = `Browser integration ${Date.now()}\n\n  Keep indentation and Unicode: café 🏠 日本語.\n`;
    await page.getByRole('textbox', { name: 'Text to share', exact: true }).fill(text);
    await page.getByRole('button', { name: 'Share text', exact: true }).click();
    const card = page.getByRole('article').filter({ hasText: text.split('\n')[0] });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
    await card.getByRole('button', { name: 'Copy text', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    if (copied !== text) throw new Error('Browser clipboard did not preserve the full text');
    const [textDownload] = await Promise.all([
      page.waitForEvent('download'),
      card.getByRole('button', { name: 'Download .txt', exact: true }).click(),
    ]);
    const textPath = path.join(output, 'browser-text.txt');
    await textDownload.saveAs(textPath);
    if (await fs.readFile(textPath, 'utf8') !== text) throw new Error('Text attachment differs from sent text');

    const payload = Buffer.alloc(1024 * 1024 + 137);
    for (let index = 0; index < payload.length; index++) payload[index] = index % 251;
    const fileName = `browser-integrity-${Date.now()}.bin`;
    await page.getByLabel('Choose files to upload', { exact: true }).setInputFiles({ name: fileName, mimeType: 'application/octet-stream', buffer: payload });
    const fileCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: fileName, exact: true }) });
    await expect(fileCard.getByRole('button', { name: 'Download', exact: true })).toBeEnabled({ timeout: 30_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      fileCard.getByRole('button', { name: 'Download', exact: true }).click(),
    ]);
    const filePath = path.join(output, 'browser-file.bin');
    await download.saveAs(filePath);
    const expected = createHash('sha256').update(payload).digest('hex');
    const actual = createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
    if (actual !== expected) throw new Error('Browser file upload/download failed integrity verification');
    await page.screenshot({ path: path.join(output, 'browser-desktop.png'), fullPage: true });

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, storageState: await context.storageState() });
    const mobile = await phone.newPage();
    mobile.on('pageerror', error => failures.push(error.message));
    await mobile.goto(baseURL);
    await expect(mobile.getByRole('article').filter({ hasText: text.split('\n')[0] })).toHaveCount(1);
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) throw new Error('Phone layout overflows horizontally');
    await mobile.screenshot({ path: path.join(output, 'browser-phone.png'), fullPage: true });
    if (failures.length) throw new Error('Browser runtime errors: ' + failures.join('; '));
    console.log('PASS: real browser pairing, text send/copy/.txt download, file upload/download SHA256, shared second client, phone layout, no runtime errors');
    console.log('Screenshots: .tools/validation/browser-desktop.png and browser-phone.png');
    await phone.close();
    await context.close();
  } catch (error) {
    if (primaryPage && !primaryPage.isClosed()) {
      await primaryPage.screenshot({ path: path.join(output, 'browser-failure.png'), fullPage: true }).catch(() => {});
      const visible = await primaryPage.locator('body').innerText().catch(() => '');
      console.error('Visible UI at failure:\n' + visible.slice(-3500));
    }
    throw error;
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
