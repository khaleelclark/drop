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
  return {posted,chunks,received}
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
  await expect(page.getByText('Sent · server is finalizing')).toBeVisible()
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
      if(command==='native_list_transfers') return []
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
  await page.getByRole('button',{name:'Add files',exact:true}).click()
  const calls=await page.evaluate(()=>(window as unknown as {nativeCalls:{command:string;args?:Record<string,unknown>}[]}).nativeCalls)
  expect(calls).toContainEqual({command:'native_copy_text',args:{text:fullText}})
  expect(calls.some(call=>call.command==='native_pick_uploads')).toBe(true)
  expect(browserApiRequests).toEqual([])
})
