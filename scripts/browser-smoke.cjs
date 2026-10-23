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
  const output = path.resolve(process.env.HOUSEHOLD_BROWSER_OUTPUT || path.resolve(__dirname, '../.tools/validation'));
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
    await page.getByRole('button', { name: 'Advanced · Use app token', exact: true }).click();
    await page.getByRole('textbox', { name: 'App token (optional)', exact: true }).fill(token);
    await page.getByRole('button', { name: 'Connect household', exact: true }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled();
    const recipient='8'.repeat(32);
    expect((await context.request.post(baseURL+'/api/devices/register',{headers:{Origin:baseURL},data:{id:recipient,label:'Integration recipient',platform:'linux'}})).status()).toBe(200);
    await page.getByRole('button',{name:'Send to Everyone',exact:true}).click();
    await page.getByRole('button',{name:/Integration recipient/}).click();
    await page.getByRole('group',{name:'Send to devices'}).getByRole('button',{name:'Done',exact:true}).click();
    const text = `Browser integration ${Date.now()}\n\n  Keep indentation and Unicode: café 🏠 日本語.\n`;
    await page.getByRole('textbox', { name: 'Text to share', exact: true }).fill(text);
    await page.getByRole('button', { name: 'Share text', exact: true }).click();
    let card = page.getByRole('article').filter({ hasText: text.split('\n')[0] });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
    await card.getByRole('button', { name: 'Copy text', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    if (copied !== text) throw new Error('Browser clipboard did not preserve the full text');
    await card.getByRole('button', { name: /^More actions for / }).click();
    const [textDownload] = await Promise.all([
      page.waitForEvent('download'),
      card.getByRole('menuitem', { name: 'Download .txt', exact: true }).click(),
    ]);
    const textPath = path.join(output, 'browser-text.txt');
    await textDownload.saveAs(textPath);
    if (await fs.readFile(textPath, 'utf8') !== text) throw new Error('Text attachment differs from sent text');

    const sent = (await (await context.request.get(baseURL+'/api/items')).json()).items.find(item => item.preview.includes(text.split('\n')[0]));
    card = page.locator('#share-'+sent.id).getByRole('article');
    expect(sent.sourceDeviceId).toMatch(/^[a-f0-9]{32}$/);
    expect(sent.targetDeviceIds).toEqual([recipient]);
    const initialArrivals=await (await context.request.get(baseURL+'/api/devices/'+recipient+'/notifications')).json();
    expect(initialArrivals.notifications.map(row=>row.itemId)).toEqual([sent.id]);
    await card.getByRole('button', { name: /^More actions for / }).click();
    await card.getByRole('menuitem', { name: 'Edit entry', exact: true }).click();
    const edited = '\ufeff  Edited Markdown\n```js\nconsole.log("家 🏠");\n```\n';
    await card.getByLabel('Entry name', {exact:true}).fill('Integration.md');
    await card.getByLabel('Entry text').fill(edited);
    await card.getByRole('button', {name:'Save entry',exact:true}).click();
    await expect(card.getByLabel('Entry text')).toHaveCount(0);
    const editedCard = page.getByRole('article',{name:'Text: Integration.md',exact:true});
    expect(await (await context.request.get(baseURL+'/api/items/'+sent.id+'/text')).text()).toBe(edited);
    await editedCard.getByRole('button', { name: /^More actions for / }).click();
    const [markdown] = await Promise.all([page.waitForEvent('download'),editedCard.getByRole('menuitem', {name:'Download .md',exact:true}).click()]);
    expect(markdown.suggestedFilename()).toBe('Integration.md');
    const markdownPath = path.join(output,'browser-text.md'); await markdown.saveAs(markdownPath);
    expect(await fs.readFile(markdownPath,'utf8')).toBe(edited);
    await editedCard.getByRole('button', { name: /^More actions for / }).click();
    await editedCard.getByRole('menuitem', { name: 'Edit entry', exact: true }).click();
    await editedCard.getByLabel('Entry text').fill('My unsaved draft');
    const latest = (await (await context.request.get(baseURL+'/api/items/'+sent.id)).json()).item;
    const concurrent = await context.request.patch(baseURL+'/api/items/'+sent.id,{headers:{Origin:baseURL},data:{text:'Another household edit',expectedUpdatedAt:latest.updatedAt}});
    expect(concurrent.status()).toBe(200);
    await editedCard.getByRole('button', {name:'Save entry',exact:true}).click();
    await expect(editedCard.getByRole('alert')).toContainText('Your draft is kept');
    await expect(editedCard.getByLabel('Entry text')).toHaveValue('My unsaved draft');
    await page.screenshot({path:path.join(output,'browser-edit-conflict.png'),fullPage:true});
    await editedCard.getByRole('button',{name:'Cancel editing',exact:true}).click();
    const afterEdits=await (await context.request.get(baseURL+'/api/devices/'+recipient+'/notifications')).json();
    expect(afterEdits.notifications.map(row=>row.itemId)).toEqual([sent.id]);

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
    await expect(mobile.getByRole('article',{name:'Text: Integration.md',exact:true})).toHaveCount(1);
    await expect(mobile.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled();
    const registry=(await (await context.request.get(baseURL+'/api/devices')).json()).devices;
    const phoneDevice=registry.find(device=>device.id!==recipient&&device.id!==sent.sourceDeviceId);
    expect(phoneDevice).toBeTruthy();
    const incoming=await context.request.post(baseURL+'/api/text',{headers:{Origin:baseURL},data:{text:'A share for this phone',sourceDeviceId:sent.sourceDeviceId,targetDeviceIds:[phoneDevice.id]}});
    expect(incoming.status()).toBe(201);
    const incomingId=(await incoming.json()).item.id;
    await mobile.getByRole('navigation',{name:'Mobile feed filters'}).getByRole('button',{name:'For you',exact:true}).click();
    await expect(mobile.locator('#share-'+incomingId)).toBeVisible();
    await expect(mobile.getByRole('article',{name:'Text: Integration.md',exact:true})).toHaveCount(0);
    const phoneArrivals=await (await context.request.get(baseURL+'/api/devices/'+phoneDevice.id+'/notifications')).json();
    expect((await context.request.post(baseURL+'/api/devices/'+phoneDevice.id+'/notifications/ack',{headers:{Origin:baseURL},data:{through:phoneArrivals.nextCursor}})).status()).toBe(200);
    await mobile.reload();
    await mobile.getByRole('navigation',{name:'Mobile feed filters'}).getByRole('button',{name:'For you',exact:true}).click();
    await expect(mobile.locator('#share-'+incomingId)).toBeVisible();
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) throw new Error('Phone layout overflows horizontally');
    await mobile.screenshot({ path: path.join(output, 'browser-phone.png'), fullPage: true });
    if (failures.length) throw new Error('Browser runtime errors: ' + failures.join('; '));
    const report={date:new Date().toISOString(),scope:'Real Chromium and disposable loopback server, no API mocks. No OS alerts, installed native or 20 GB validation.',checks:['Advanced token connection','Registered browser source and selected recipient','Exact text copy/TXT download','Shared Save/exact MD export','Concurrent edit conflict retains draft without new arrivals','File upload/download SHA256','Shared second browser identity','For you filtering and history after ACK/reload','Phone layout'],fileBytes:payload.length,fileSha256:actual,failures};
    await fs.writeFile(path.join(output,'zing-browser.json'),JSON.stringify(report,null,2)+'\n');
    console.log('PASS: real browser auth, exact copy/TXT/MD, Save/conflict, file integrity, shared second client and phone layout');
    console.log('Screenshots saved in '+output);
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
