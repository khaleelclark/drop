#!/usr/bin/env node
// Streamed native download/export check on the disposable emulator, not a phone benchmark.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { chromium } = createRequire(path.resolve(__dirname, '../web/package.json'))('@playwright/test');
const adb = process.env.HOUSEHOLD_ADB || '/home/phoenix/Android/Sdk/platform-tools/adb';
const serial = process.env.HOUSEHOLD_ANDROID_SERIAL || 'emulator-5580';
const root = path.resolve(__dirname, '..');
function shell(...args) { return execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8' }); }
async function connect() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19224', { noDefaults: true });
  const page = browser.contexts()[0].pages().find(p => p.url().startsWith('http://tauri.localhost'));
  if (!page) { await browser.close(); throw new Error('Tauri app page not found'); }
  return { browser, page };
}
async function main() {
  if (!serial.startsWith('emulator-')) throw new Error('This harness requires a disposable emulator.');
  shell('shell', 'pm', 'grant', 'net.household.share.mobile', 'android.permission.POST_NOTIFICATIONS');
  const upload = JSON.parse(await fs.readFile(process.env.HOUSEHOLD_ANDROID_UPLOAD_REPORT || path.join(root, '.tools/validation/android-upload.json'), 'utf8'));
  const source = path.join(root, '.tools/validation/android-source.bin');
  const digest = createHash('sha256');
  for await (const block of createReadStream(source)) digest.update(block);
  const expected = digest.digest('hex');
  if (expected !== upload.sha256) throw new Error('Source fixture changed');
  const name = `household-emulator-download-${Date.now()}.bin`;
  let { browser, page } = await connect();
  try {
    await page.evaluate(({ id, name }) => {
      window.__downloadResult = { state: 'pending' };
      void window.householdPlatform.download({ itemId: id, name, url: '' }).then(
        () => { window.__downloadResult = { state: 'accepted' }; },
        error => { window.__downloadResult = { state: 'error', error: String(error) }; });
    }, { id: upload.itemId, name });
  } finally { await browser.close(); }
  // Parse the current inspected Android Save control; never tap stale coordinates.
  const inspectSave = String.raw`import subprocess,xml.etree.ElementTree as E,re,sys
adb,serial=sys.argv[1:]
subprocess.run([adb,'-s',serial,'shell','uiautomator','dump','/sdcard/household-save.xml'],check=True,stdout=subprocess.DEVNULL)
xml=subprocess.check_output([adb,'-s',serial,'exec-out','cat','/sdcard/household-save.xml'])
for n in E.fromstring(xml).iter('node'):
    if n.get('resource-id')=='android:id/button1' and n.get('text','').lower()=='save':
        x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds','')))
        if n.get('enabled')!='true': raise RuntimeError('Save button disabled')
        print((x1+x2)//2,(y1+y2)//2);break
else: raise RuntimeError('Android Save dialog not found')
`;
  const [x, y] = execFileSync('python3', ['-c', inspectSave, adb, serial], { encoding: 'utf8' }).trim().split(' ');
  shell('shell', 'input', 'tap', x, y);
  for (let attempt = 0; attempt < 40; attempt++) {
    if (shell('shell', 'dumpsys', 'activity', 'activities').includes('topResumedActivity=ActivityRecord') && /topResumedActivity=.*net\.household\.share\.mobile\/\.MainActivity/.test(shell('shell', 'dumpsys', 'activity', 'activities'))) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  ({ browser, page } = await connect());
  let transfer;
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      const rows = await page.evaluate(() => window.__HOUSEHOLD_NATIVE__.invoke('native_list_transfers'));
      transfer = rows.find(row => row.direction === 'download' && row.name === name);
      if (transfer?.status === 'completed') break;
      if (['error', 'needs_source', 'cancelled'].includes(transfer?.status)) throw new Error(JSON.stringify(transfer));
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (transfer?.status !== 'completed') throw new Error('Download did not complete: ' + JSON.stringify(transfer));
    const file = '/sdcard/Download/' + name;
    const actual = shell('shell', 'sha256sum', file).trim().split(/\s+/)[0];
    const bytes = Number(shell('shell', 'stat', '-c', '%s', file).trim());
    if (bytes !== upload.bytes || actual !== expected) throw new Error('Native SAF export integrity mismatch');
    const report = { passed: true, bytes, sha256: actual, transfer, checks: ['actual Android Save dialog', 'unknown-length UIDT scheduling', 'native HTTP range download', 'private resumable file', 'completed SAF export', 'exported file matches original SHA256'], boundary: 'API36 x86_64 emulator, 32MiB fixture; not physical phone, screen-lock or 20GB evidence' };
    await fs.writeFile(path.join(root, '.tools/validation/android-download.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`PASS: native Android download/SAF export ${bytes} bytes, SHA256 ${actual}`);
    shell('shell', 'rm', file);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
