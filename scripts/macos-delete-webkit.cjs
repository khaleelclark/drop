// Actual macOS WebKit input, with the shared synthetic bridge and immutable assets.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { webkit } = require(path.resolve('baseline-src/web/node_modules/@playwright/test'))
const [dist, output, mode] = process.argv.slice(2)
if (process.platform !== 'darwin' || !dist || !output || !['baseline', 'tabindex', 'fixed'].includes(mode)) throw Error('Usage on macOS: DIST NEW_OUTPUT baseline|tabindex|fixed')
const root = fs.realpathSync(dist), out = path.resolve(output)
if (out.startsWith(root + path.sep) || out === root || fs.existsSync(out)) throw Error('Output must be fresh and outside frontend assets')
fs.mkdirSync(out, { recursive: true })
const checks = [], cases = []
const check = (condition, name) => { checks.push({ case: scenario, name, passed: !!condition }); console.log(condition ? 'PASS' : 'OBSERVED FAILURE', scenario, name) }
let scenario = '', browser, infrastructureError = ''
const server = http.createServer((req, res) => {
  let file
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)
    file = fs.realpathSync(path.resolve(root, '.' + (name === '/' ? '/index.html' : name)))
    if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile() || req.method !== 'GET') throw Error('Invalid static request')
  } catch { res.writeHead(404).end(); return }
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream')
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res)
})
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    browser = await webkit.launch({ headless: true })
    for (scenario of ['default', 'last']) {
      const context = await browser.newContext({ viewport: { width: 1100, height: 800 } })
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
      await context.addInitScript({ path: 'integrations/macos/delete-webview-fixture.js' })
      const page = await context.newPage()
      const snapshot = () => page.evaluate(() => window.__deleteDiagnostic.snapshot())
      let error = ''
      try {
        await page.goto(`${origin}/?case=${scenario}&diagnostic=${mode}`)
        await page.waitForFunction(() => window.__deleteDiagnostic?.snapshot().queueRows === 3)
        const row = page.locator(`#share-${scenario === 'last' ? 'native-last' : 'native-note'}`)
        const more = row.getByRole('button', { name: /^More actions for / })
        const confirm = row.getByRole('group', { name: 'Confirm deletion', exact: true })
        const open = async () => {
          await more.click()
          if (mode === 'tabindex') await page.evaluate(() => window.__deleteDiagnostic.applyTabindex())
          const events = await page.evaluate(() => window.__deleteDiagnostic.state.events)
          if (!events.some(event => event.type === 'mousedown' && event.trusted)) throw Error('Infrastructure: trusted mouse input missing')
          await row.getByRole('menuitem', { name: 'Delete item', exact: true }).click({ timeout: 4000 })
          const current = await snapshot()
          check(!!current.confirmation, 'Delete item opens confirmation')
          check(current.confirmation?.visible && current.keep?.visible && current.deleteButton?.visible, 'Confirmation and both controls visible before recovery scrolling')
          check(current.keepFocused, 'Safe Keep receives focus')
          check(current.deleteCount === 0, 'No DELETE before explicit confirmation')
          await page.screenshot({ path: path.join(out, `${scenario}-confirmation.png`) })
          return current
        }
        const first = await open()
        if (first.confirmation) {
          if (mode === 'fixed' && (!first.keep?.visible || !first.deleteButton?.visible)) throw Error('Fixed confirmation is offscreen')
          await confirm.getByRole('button', { name: 'Keep', exact: true }).click()
          let current = await snapshot()
          check(!current.confirmation && current.rowPresent && current.deleteCount === 0, 'Keep retains item with zero mutations')
          await more.click(); await page.keyboard.press('Escape')
          current = await snapshot(); check(!current.menu && current.moreFocused, 'Escape closes menu and restores trigger focus')
          await open()
          await page.evaluate(() => { window.__deleteDiagnostic.state.deleteFailure = true })
          await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
          await page.waitForFunction(() => window.__deleteDiagnostic.snapshot().errorVisible)
          current = await snapshot()
          check(current.rowPresent && current.deleteEnabled && !current.success && current.deleteCount === 1, '500 keeps item and explicit retry without false success')
          await page.evaluate(() => { window.__deleteDiagnostic.state.deleteFailure = false; window.__deleteDiagnostic.state.feedFailure = true })
          await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
          await page.waitForFunction(() => window.__deleteDiagnostic.snapshot().feedError)
          current = await snapshot(); check(current.success && current.deleteCount === 2, 'Bodyless 204 succeeds while failed feed refresh remains recoverable')
          await page.evaluate(() => { window.__deleteDiagnostic.state.feedFailure = false })
          await page.getByRole('button', { name: 'Retry', exact: true }).click()
          await page.waitForFunction(() => !window.__deleteDiagnostic.snapshot().rowPresent)
          current = await snapshot(); check(!current.rowPresent && current.deleteCount === 2, 'Feed Retry removes item without repeating DELETE')
        }
      } catch (failure) {
        error = String(failure)
        check(false, error)
        if (error.includes('Infrastructure:')) infrastructureError = error
      }
      const observations = await page.evaluate(() => window.__deleteDiagnostic?.report()).catch(() => null)
      if (!observations) infrastructureError = 'Diagnostic fixture did not load'
      cases.push({ name: scenario, error, observations })
      await page.screenshot({ path: path.join(out, `${scenario}-final.png`) }).catch(() => {})
      await context.close()
    }
  } catch (error) { infrastructureError = String(error) }
  finally {
    if (browser) await browser.close()
    server.close()
    const failed = checks.filter(check => !check.passed).length
    const result = infrastructureError ? 'infrastructure_failure' : failed ? mode === 'fixed' ? 'failed' : 'observed_failures' : 'passed'
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ mode, driver: 'Playwright WebKit on macOS; real browser input; no forced DOM focus/events', platform: process.platform, architecture: process.arch, result, infrastructureError, checks, cases }, null, 2))
    const assets = []
    function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (entry.isFile()) assets.push({ path: path.relative(root, file), bytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }); else throw Error('Non-regular frontend asset') } }
    walk(root)
    fs.writeFileSync(path.join(out, 'assets.json'), JSON.stringify(assets, null, 2))
    if (infrastructureError || (mode === 'fixed' && failed)) process.exitCode = 1
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1 })
