import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
const fullText = '  From the kitchen\n\t🦊 café\n\n  '
async function fixture(page: Page) {
  const now = new Date().toISOString(); let authenticated = false
  let items = [
    { id:'text-one',kind:'text',name:'Kitchen note',size:Buffer.byteLength(fullText),createdAt:now,updatedAt:now,status:'ready',preview:'From the kitchen…',pinned:false,sourceDevice:'Kitchen Mac' },
    { id:'file-one',kind:'file',name:'weekend.zip',size:4096,createdAt:now,updatedAt:now,status:'ready',preview:'',pinned:false,sourceDevice:'Linux' },
  ]
  const posted: string[] = []; const chunks: number[] = []; const received: Buffer[] = []; let offset = 0; let length = 0
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method()
    const json = (data:unknown, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    if (url.pathname === '/api/session') {
      if (method === 'DELETE') { authenticated = false; return route.fulfill({status:204}) }
      if (request.postDataJSON().token !== 'test-household-token') return json({error:{message:'Token rejected'}},401)
      authenticated = true; return route.fulfill({status:204,headers:{'Set-Cookie':'household=fixture; HttpOnly; SameSite=Strict; Path=/'}})
    }
    if (!authenticated) return json({error:{message:'Connect first'}},401)
    if (url.pathname === '/api/items') {
      const q = (url.searchParams.get('q') || '').toLowerCase()
      return json({items:items.filter(item => `${item.name} ${item.preview}`.toLowerCase().includes(q)),nextCursor:null})
    }
    if (url.pathname === '/api/storage') return json({usedBytes:4096,freeBytes:128*1024**3,maxFileBytes:20*1024**3,maxTextBytes:32*1024**2,maxStorageBytes:null})
    if (url.pathname === '/api/events') return route.fulfill({status:200,contentType:'text/event-stream',body:': connected\n\n'})
    if (url.pathname === '/api/text') {
      const body = request.postDataJSON(); posted.push(body.text)
      const item = {...items[0],id:`new-${posted.length}`,preview:body.text.slice(0,512),sourceDevice:body.sourceDevice,size:Buffer.byteLength(body.text)}
      items.unshift(item); return json({item},201)
    }
    if (url.pathname.endsWith('/text')) return route.fulfill({status:200,contentType:'text/plain; charset=utf-8',body:fullText})
    if (url.pathname.endsWith('/download')) return route.continue()
    if (url.pathname.startsWith('/api/uploads')) {
      if (method === 'POST') {
        length = Number(request.headers()['upload-length']); offset = 0
        items.unshift({...items[1],id:'upload-one',name:'bounded.bin',size:length,status:'uploading'})
        return route.fulfill({status:201,headers:{'Tus-Resumable':'1.0.0','Location':'/api/uploads/upload-one','Upload-Offset':'0','X-Item-ID':'upload-one'}})
      }
      if (method === 'HEAD') return route.fulfill({status:200,headers:{'Tus-Resumable':'1.0.0','Upload-Offset':String(offset),'Upload-Length':String(length)}})
      if (method === 'PATCH') {
        expect(Number(request.headers()['upload-offset'])).toBe(offset)
        const bytes = request.postDataBuffer()!; chunks.push(bytes.byteLength); received.push(bytes); offset += bytes.byteLength
        if (offset === length) items = items.map(item => item.id === 'upload-one' ? {...item,status:'ready'} : item)
        return route.fulfill({status:204,headers:{'Tus-Resumable':'1.0.0','Upload-Offset':String(offset)}})
      }
      if (method === 'DELETE') { items = items.filter(item => item.id !== 'upload-one'); return route.fulfill({status:204}) }
    }
    const id = url.pathname.split('/').pop()
    if (method === 'PATCH') { items = items.map(item => item.id === id ? {...item,pinned:request.postDataJSON().pinned} : item); return json({item:items.find(item => item.id === id)}) }
    if (method === 'DELETE') { items = items.filter(item => item.id !== id); return route.fulfill({status:204}) }
    return json({error:{message:'Unexpected fixture request'}},404)
  })
  return {posted,chunks,received,clear:()=>{items=[]}}
}
async function connect(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByLabel('App token').fill('test-household-token')
  await page.getByRole('dialog').getByRole('button',{name:'Connect household',exact:true}).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('button',{name:'Copy text',exact:true}).first()).toBeVisible()
}
test('connect, exact copy/paste, pins, search, direct download, and shared deletion', async ({page,context}) => {
  const {posted} = await fixture(page); await context.grantPermissions(['clipboard-read','clipboard-write']); await connect(page)
  await page.screenshot({path:'test-results/household-desktop.png',fullPage:true})
  await page.getByRole('button',{name:'Copy text',exact:true}).first().click()
  await expect(page.getByRole('button',{name:'Copied',exact:true})).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fullText)
  const pasted = '  exact\r\n\tUnicode 🦊\n\n  '
  await page.getByRole('textbox',{name:'Text to share'}).evaluate((node,text) => {
    const data = new DataTransfer(); data.setData('text/plain',text)
    node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))
  },pasted)
  await page.getByRole('button',{name:'Share text',exact:true}).click()
  await expect.poll(() => posted[0]).toBe(pasted)
  const file = page.getByRole('article',{name:'File: weekend.zip'})
  await file.getByRole('button',{name:'More actions for weekend.zip',exact:true}).click()
  await file.getByRole('menuitem',{name:'Pin item',exact:true}).click()
  await expect(file.getByText('Pinned',{exact:true})).toBeVisible()
  await page.getByRole('searchbox').fill('weekend')
  await expect(page.getByRole('article')).toHaveCount(1)
  const [download] = await Promise.all([page.waitForEvent('download'),file.getByRole('button',{name:'Download',exact:true}).click()])
  expect(download.suggestedFilename()).toBe('weekend.zip')
  const stream = await download.createReadStream(); const downloaded: Buffer[] = []
  for await (const bytes of stream) downloaded.push(bytes)
  expect(Buffer.concat(downloaded).toString()).toBe('downloaded fixture bytes')
  await file.getByRole('button',{name:'More actions for weekend.zip',exact:true}).click()
  await file.getByRole('menuitem',{name:'Delete item',exact:true}).click()
  await file.getByRole('button',{name:'Delete',exact:true}).click()
  await expect(page.getByRole('article')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-household-token')
})
test('real browser tus client sends a 9 MiB source in bounded chunks', async ({page}) => {
  const fixtureData = await fixture(page); await connect(page)
  const buffer = Buffer.alloc(9*1024**2,0x5a)
  await page.getByLabel('Choose files to upload',{exact:true}).setInputFiles({name:'bounded.bin',mimeType:'application/octet-stream',buffer})
  const completed=page.getByRole('group',{name:'To household: bounded.bin'})
  await expect(completed).toContainText('To household · Upload sent')
  await expect(completed.getByRole('progressbar')).toHaveAttribute('value','100')
  expect(fixtureData.chunks).toEqual([8*1024**2,1024**2])
  expect(createHash('sha256').update(Buffer.concat(fixtureData.received)).digest('hex')).toBe(createHash('sha256').update(buffer).digest('hex'))
  await expect(page.getByRole('article',{name:'File: bounded.bin'}).getByRole('button',{name:'Download',exact:true})).toBeEnabled()
})
test('phone layout fits and settings keep keyboard focus inside the dialog', async ({page}) => {
  await page.setViewportSize({width:390,height:844}); await fixture(page); await connect(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path:'test-results/household-mobile.png',fullPage:false})
  for(const button of [page.getByRole('button',{name:'Copy text',exact:true}),page.getByRole('button',{name:'Download',exact:true}),page.getByRole('button',{name:'More actions for weekend.zip',exact:true})]) { const box=await button.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.width).toBeGreaterThanOrEqual(44) }
  await page.getByRole('button',{name:'More actions for Kitchen note',exact:true}).click()
  for (const name of ['Expand text','Pin item','Delete item']) { const box=await page.getByRole('menuitem',{name,exact:true}).boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.width).toBeGreaterThanOrEqual(44) }
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:/Connected|Reconnecting/}).click()
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible()
  await page.getByRole('button',{name:'Disconnect this browser'}).focus(); await page.keyboard.press('Tab')
  await expect(page.getByRole('button',{name:'Close connection settings'})).toBeFocused()
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible()
})
test('packaged native bridge is detected before the app renders', async ({page}) => {
  await page.addInitScript(({body}) => {
    const calls: {command:string;args?:Record<string,unknown>}[] = []
    ;(window as unknown as {nativeCalls:unknown}).nativeCalls=calls
    window.__HOUSEHOLD_NATIVE__={platform:'android',invoke:async(command,args)=>{
      calls.push({command,args})
      if(command==='native_get_config') return {baseUrl:'https://household.example',sourceDevice:'Phone'}
      if(command==='native_list_transfers') return [
        {id:'upload',direction:'upload',name:'Family videos.zip',size:2*1024**3,offset:1024**3,status:'running'},
        {id:'validation',direction:'upload',name:'Notes.txt',size:1024,offset:1024,status:'validating'},
        {id:'download',direction:'download',name:'Holiday photos.zip',size:2*1024**3,offset:512*1024**2,status:'paused'},
      ]
      if(command==='native_api') {
        const path=String(args?.path)
        if(path.startsWith('/api/items?')) return {status:200,body:JSON.stringify({items:[{id:'native-note',kind:'text',name:'Native note',size:body.length,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'ready',preview:'native preview',pinned:false}],nextCursor:null})}
        if(path.endsWith('/text')) return {status:200,body}
        if(path==='/api/storage') return {status:200,body:JSON.stringify({usedBytes:1,freeBytes:100000,maxFileBytes:21474836480,maxTextBytes:33554432,maxStorageBytes:null})}
        return {status:200,body:'{"status":"ok"}'}
      }
    }}
  },{body:fullText})
  const browserApiRequests:string[]=[];page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))browserApiRequests.push(request.url())})
  await page.goto('/')
  await page.getByRole('button',{name:'Copy text',exact:true}).click()
  await expect(page.getByRole('button',{name:'Copied',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Dismiss notification'}).click()
  await page.getByRole('button',{name:'Add files',exact:true}).click()
  const calls=await page.evaluate(()=>(window as unknown as {nativeCalls:{command:string;args?:Record<string,unknown>}[]}).nativeCalls)
  expect(calls).toContainEqual({command:'native_copy_text',args:{text:fullText}})
  expect(calls.some(call=>call.command==='native_pick_uploads')).toBe(true)
  expect(browserApiRequests).toEqual([])
  const upload=page.getByRole('group',{name:'To household: Family videos.zip'})
  await expect(upload).toContainText('To household · Uploading')
  await expect(upload.getByRole('progressbar')).toHaveAttribute('value','50')
  const validation=page.getByRole('group',{name:'To household: Notes.txt'})
  await expect(validation).toContainText('Waiting for server validation')
  await expect(validation.getByRole('progressbar')).not.toHaveAttribute('value')
  const download=page.getByRole('group',{name:'To this device: Holiday photos.zip'})
  await expect(download).toContainText('To this device · Paused')
  await expect(download.getByRole('progressbar')).toHaveAttribute('value','25')
  await page.setViewportSize({width:360,height:740})
  await page.locator('.transfer-panel').scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const resume=download.getByRole('button',{name:'Resume Holiday photos.zip'})
  await expect(resume).toBeInViewport({ratio:1})
  const resumeBox=await resume.boundingBox()
  expect(resumeBox!.width).toBeGreaterThanOrEqual(44)
  expect(resumeBox!.height).toBeGreaterThanOrEqual(44)
  expect(await resume.evaluate(node=>{
    const r=node.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)
    return node===hit||node.contains(hit)
  })).toBe(true)
  await page.screenshot({path:'test-results/household-transfers.png',fullPage:false})
})

test('narrow layouts keep long shares, recovery controls, and the composer usable', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('household.transfers.v1', JSON.stringify([{
      id:'saved-upload', name:'Family holiday — '+ 'long-filename-'.repeat(18)+'.mp4',
      size:20_000_000_000,lastModified:1,kind:'file',sourceDevice:'Phone',
      destination:location.origin,state:'uploading',confirmed:8*1024**2,sent:8*1024**2,
    }]))
  })
  await fixture(page); await connect(page)
  for (const width of [320,360,390,412]) {
    await page.setViewportSize({width,height:740})
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),`${width}px page width`).toBe(true)
    for (const control of [page.getByRole('textbox',{name:'Text to share'}),page.getByRole('searchbox')]) {
      expect(await control.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16)
    }
    const filters = page.getByRole('navigation',{name:'Mobile feed filters'})
    await filters.getByRole('button',{name:'Files',exact:true}).click()
    await expect(page.getByRole('article')).toHaveCount(1)
    await filters.getByRole('button',{name:'All shares',exact:true}).click()
    await expect(page.getByRole('article')).toHaveCount(2)
    await expect(page.getByRole('button',{name:'Reselect',exact:true})).toBeVisible()
    await page.getByRole('button',{name:'More actions for sharing',exact:true}).click()
    const menu = page.getByRole('menu',{name:'Actions for sharing'})
    const menuBox = await menu.boundingBox()
    expect(menuBox!.x).toBeGreaterThanOrEqual(0)
    expect(menuBox!.x+menuBox!.width).toBeLessThanOrEqual(width)
    await expect(menu.getByRole('menuitem',{name:'Upload text file'})).toBeFocused()
    await page.keyboard.press('Escape')

    for (const name of ['Copy text','Download']) {
      const button = page.getByRole('button',{name,exact:true}).first()
      await button.scrollIntoViewIfNeeded()
      expect(await button.evaluate(node => {
        const r=node.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)
        return node===hit || node.contains(hit)
      }),`${name} is uncovered at ${width}px`).toBe(true)
    }
    await page.getByRole('button',{name:'New share',exact:true}).click()
    await expect(page.getByRole('textbox',{name:'Text to share'})).toBeFocused()
    expect(await page.locator('.composer').evaluate(node => getComputedStyle(node).position)).toBe('static')
  }
  // A shorter viewport approximates available layout after keyboard appearance.
  // This verifies reflow/visibility only; it does not simulate a device keyboard.
  await page.setViewportSize({width:320,height:420})
  await page.getByRole('button',{name:'New share',exact:true}).click()
  await page.getByRole('textbox',{name:'Text to share'}).fill('Ready on my other device')
  const send = page.getByRole('button',{name:'Share text',exact:true})
  await send.scrollIntoViewIfNeeded(); await expect(send).toBeInViewport()
  await expect(page.locator('[style]')).toHaveCount(0)
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
  expect(viewport).toContain('width=device-width'); expect(viewport).toContain('viewport-fit=cover')
  expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/)
  await page.screenshot({path:'test-results/household-narrow-keyboard-layout.png',fullPage:false})
})

test('secondary text and sharing actions stay keyboard accessible without crowding the feed', async ({page}) => {
  await fixture(page); await connect(page)
  const text = page.getByRole('article',{name:'Text: Kitchen note'})
  await expect(text.getByRole('button',{name:'Copy text',exact:true})).toBeVisible()
  await expect(text.getByRole('button',{name:'Download .txt',exact:true})).toHaveCount(0)
  await text.getByRole('button',{name:'More actions for Kitchen note'}).click()
  const menu = text.getByRole('menu')
  await expect(menu.getByRole('menuitem',{name:'Expand text',exact:true})).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem',{name:'Download .txt',exact:true})).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(text.getByRole('button',{name:'More actions for Kitchen note'})).toBeFocused()
  await expect(menu).toHaveCount(0)
  await page.getByRole('button',{name:'More actions for sharing',exact:true}).click()
  await expect(page.getByRole('menuitem',{name:'Upload text file',exact:true})).toBeVisible()
})

test('pairing failures, empty inbox, and temporary server errors offer a usable next action', async ({page}) => {
  const data = await fixture(page)
  await page.setViewportSize({width:360,height:740}); await page.goto('/')
  const dialog = page.getByRole('dialog',{name:'Connect to Household'})
  await expect(dialog).toBeVisible()
  await page.getByLabel('App token').fill('incorrect-token')
  await dialog.getByRole('button',{name:'Connect household',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('Token rejected')
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(12)
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(348)
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const connectButton = dialog.getByRole('button',{name:'Connect household',exact:true})
  await dialog.evaluate(node=>{node.scrollTop=0})
  await expect(connectButton).toBeInViewport({ratio:1})
  expect((await connectButton.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  for (const input of await dialog.locator('input').all()) {
    expect(await input.evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16)
  }
  await page.screenshot({path:'test-results/household-pairing.png',fullPage:false})
  // Reduced available height checks internal scrolling, not an OS keyboard.
  await page.setViewportSize({width:360,height:420})
  expect(await dialog.evaluate(node=>node.scrollHeight>node.clientHeight)).toBe(true)
  await connectButton.scrollIntoViewIfNeeded()
  await expect(connectButton).toBeInViewport({ratio:1})
  await page.setViewportSize({width:360,height:740})
  await page.getByLabel('App token').fill('test-household-token')
  await dialog.getByRole('button',{name:'Connect household',exact:true}).click()
  await expect(dialog).not.toBeVisible()
  data.clear()
  await page.setViewportSize({width:1280,height:900})
  await page.getByRole('button',{name:'Refresh feed'}).click()
  await expect(page.getByRole('heading',{name:'A fresh start'})).toBeVisible()
  await page.setViewportSize({width:360,height:740})
  await page.screenshot({path:'test-results/household-empty.png',fullPage:true})
  await page.getByRole('button',{name:'Share something',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Text to share'})).toBeFocused()
  await page.getByRole('navigation',{name:'Mobile feed filters'}).getByRole('button',{name:'Pinned'}).click()
  await expect(page.getByRole('heading',{name:'No pinned items'})).toBeVisible()
  await page.getByRole('searchbox').fill('missing item')
  await expect(page.getByRole('heading',{name:'No matching shares'})).toBeVisible()
  await page.route('**/api/items?**', route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'unavailable',message:'The household server is temporarily unavailable.'}})}), {times:1})
  await page.getByRole('searchbox').fill('another search')
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
  await page.getByRole('button',{name:'Retry',exact:true}).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
