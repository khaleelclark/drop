import { test, expect, type Page, type Locator } from '@playwright/test'
import { createHash } from 'node:crypto'
const fullText = '  From the kitchen\n\t🦊 café\n\n  '
async function fixture(page: Page, many = false, authenticatedStart = false) {
  const now = new Date().toISOString(); let authenticated = authenticatedStart
  const bodies=new Map<string,string>();const edits:Record<string,unknown>[]=[];const sessions:string[]=[]
  let items = [
    { id:'text-one',kind:'text',name:'Kitchen note',size:Buffer.byteLength(fullText),createdAt:now,updatedAt:now,status:'ready',preview:'From the kitchen…',pinned:false,sourceDevice:'Kitchen Mac' },
    { id:'file-one',kind:'file',name:'weekend.zip',size:4096,createdAt:now,updatedAt:now,status:'ready',preview:'',pinned:false,sourceDevice:'Linux' },
  ]
  if (many) for (let n=0;n<6;n++) items.push({
    ...items[n%2],id:`long-${n}`,name:`${n}-`+'unbroken'.repeat(12)+(n%2?'.zip':''),
    preview:n%2?'':'UnbrokenPreview'.repeat(36),sourceDevice:'Device'.repeat(13),pinned:n===5,
  })
  let older: typeof items = []; let addressed = ['text-one']
  const devices=[{id:'22222222222222222222222222222222',label:'Kitchen Mac',platform:'macos',createdAt:now},{id:'33333333333333333333333333333333',label:'Pocket phone',platform:'android',createdAt:now}]
  const registrations: {id:string;label:string;platform:string}[]=[]; const routing: {sourceDeviceId?:string;targetDeviceIds?:string[]}[]=[]; const lists:string[]=[];const acknowledgements:string[]=[];const uploadMetadata:string[]=[]
  const posted: string[] = []; const chunks: number[] = []; const received: Buffer[] = []; let offset = 0; let length = 0
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method()
    const json = (data:unknown, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    if (url.pathname === '/api/session') {
      sessions.push(method)
      if (method === 'DELETE') { authenticated = false; return route.fulfill({status:204}) }
      if (request.postDataJSON().token !== 'test-household-token') return json({error:{message:'Token rejected'}},401)
      authenticated = true; return route.fulfill({status:204,headers:{'Set-Cookie':'household=fixture; HttpOnly; SameSite=Strict; Path=/'}})
    }
    if (!authenticated) return json({error:{message:'Connect first'}},401)
    if(url.pathname==='/api/devices/register'){const body=request.postDataJSON();registrations.push(body);let device=devices.find(device=>device.id===body.id);if(!device){device={...body,createdAt:now};devices.push(device!)}else if(!body.preserveExisting)Object.assign(device,{label:body.label,platform:body.platform});return json({device})}
    if(url.pathname==='/api/devices')return json({devices})
    if(url.pathname.endsWith('/notifications/ack')){acknowledgements.push(request.postDataJSON().through);return json({ackCursor:request.postDataJSON().through})}
    if(url.pathname.includes('/notifications'))return json({notifications:[],nextCursor:url.searchParams.get('after')||'0',ackCursor:'0',hasMore:false})
    if(url.pathname.startsWith('/api/devices/')&&method==='DELETE'){const index=devices.findIndex(device=>device.id===url.pathname.split('/').pop());if(index>=0)devices.splice(index,1);return route.fulfill({status:204})}
    if (url.pathname === '/api/items') {
      lists.push(url.search)
      const q = (url.searchParams.get('q') || '').toLowerCase()
      return json({items:(url.searchParams.has('before')?older:items).filter(item=>(!url.searchParams.has('forDevice')||addressed.includes(item.id))).filter(item => `${item.name} ${item.preview}`.toLowerCase().includes(q)),nextCursor:many&&!url.searchParams.has('before')?'older-fixture':null})
    }
    if (url.pathname === '/api/storage') return json({usedBytes:4096,freeBytes:128*1024**3,maxFileBytes:20*1024**3,maxTextBytes:32*1024**2,maxStorageBytes:null})
    if (url.pathname === '/api/events') return route.fulfill({status:200,contentType:'text/event-stream',body:': connected\n\n'})
    if (url.pathname === '/api/text') {
      const body = request.postDataJSON(); posted.push(body.text);routing.push({sourceDeviceId:body.sourceDeviceId,targetDeviceIds:body.targetDeviceIds})
      const item = {...items[0],id:`new-${posted.length}`,preview:body.text.slice(0,512),sourceDevice:body.sourceDevice,size:Buffer.byteLength(body.text)}
      items.unshift(item);bodies.set(item.id,body.text); return json({item},201)
    }
    if (url.pathname.endsWith('/text')) return route.fulfill({status:200,contentType:'text/plain; charset=utf-8',body:bodies.get(url.pathname.split('/').at(-2)!)??fullText})
    if (url.pathname.endsWith('/download')) return route.continue()
    if (url.pathname.startsWith('/api/uploads')) {
      if (method === 'POST') {
        uploadMetadata.push(request.headers()['upload-metadata']);length = Number(request.headers()['upload-length']); offset = 0
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
    if(method==='GET'&&url.pathname.startsWith('/api/items/'))return items.some(item=>item.id===id)?json({item:items.find(item=>item.id===id)}):json({error:{message:'Item not found'}},404)
    if (method === 'PATCH') {
      const patch=request.postDataJSON();edits.push(patch);const item=items.find(item=>item.id===id)
      if(!item)return json({error:{message:'Deleted'}},404)
      if(('name' in patch||'text' in patch)&&patch.expectedUpdatedAt!==item.updatedAt)return json({error:{code:'edit_conflict',message:'Changed on another device'}},409)
      if('text' in patch){bodies.set(id!,patch.text);item.preview=patch.text.slice(0,512);item.size=Buffer.byteLength(patch.text)}
      if('name' in patch)item.name=patch.name
      if('pinned' in patch)item.pinned=patch.pinned
      item.updatedAt=new Date(Math.max(Date.now(),Date.parse(item.updatedAt)+1)).toISOString();return json({item})
    }
    if (method === 'DELETE') { items = items.filter(item => item.id !== id); return route.fulfill({status:204}) }
    return json({error:{message:'Unexpected fixture request'}},404)
  })
  return {posted,chunks,received,registrations,routing,lists,acknowledgements,uploadMetadata,edits,sessions,bodies,setOlder:(rows:typeof items)=>{older=rows},setAddressed:(ids:string[])=>{addressed=ids},replace:(id:string,changes:Partial<(typeof items)[number]>)=>{items=items.map(item=>item.id===id?{...item,...changes}:item)},add:(item:(typeof items)[number]&{mimeType?:string})=>items.push(item),clear:()=>{items=[]}}
}
async function connect(page: Page) {
  await page.goto('/')
  await expect(page).toHaveTitle('Zing')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button',{name:'Advanced · Use app token'}).click()
  await page.getByLabel('App token (optional)').fill('test-household-token')
  await page.getByRole('dialog').getByRole('button',{name:'Connect household',exact:true}).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled()
  await expect(page.getByRole('link',{name:'Zing home'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Copy text',exact:true}).first()).toBeVisible()
}
async function uncovered(control: Locator) {
  await expect(control).toBeInViewport({ratio:1})
  expect(await control.evaluate(node => {
    const r=node.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)
    return node===hit || node.contains(hit)
  })).toBe(true)
}
test('connect, exact copy/paste, pins, search, direct download, and shared deletion', async ({page,context}) => {
  const {posted} = await fixture(page); await context.grantPermissions(['clipboard-read','clipboard-write']); await connect(page)
  await expect(page.getByRole('navigation',{name:'Feed filters',exact:true})).toBeVisible()
  await expect(page.getByRole('navigation',{name:'Mobile feed filters',includeHidden:true})).toBeHidden()
  await page.screenshot({animations:'disabled',path:'test-results/household-desktop.png',fullPage:true})
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
test('compact rows keep content and touch actions readable at every phone width', async ({page}) => {
  await fixture(page); await connect(page)
  const manifest = await (await page.request.get('/manifest.webmanifest')).json()
  expect(manifest).toMatchObject({name:'Zing',short_name:'Zing',id:'/',start_url:'/',scope:'/'})
  await page.screenshot({animations:'disabled',path:'test-results/household-compact-desktop.png',fullPage:true})
  const measurements: Record<string, unknown>[] = []
  for (const width of [320,360,390,412]) {
    await page.setViewportSize({width,height:844})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    const rows = page.getByRole('article')
    const heights = await rows.evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height))
    for (const height of heights) { expect(height).toBeGreaterThanOrEqual(80);expect(height).toBeLessThanOrEqual(125) }
    for (const action of await rows.getByRole('button').all()) {
      const box = (await action.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44)
      await uncovered(action)
    }
    expect(await page.locator('.text-preview').evaluate(node=>getComputedStyle(node).webkitLineClamp)).toBe('none')
    expect(await page.locator('.text-preview').evaluate(node=>node.scrollHeight<=node.clientHeight)).toBe(true)
    await expect(page.locator('.text-preview')).toHaveText(fullText.trimEnd())
    expect(await rows.first().getByRole('button',{name:'Copy text',exact:true}).evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    measurements.push({width,rows:heights,composer:(await page.locator('.composer').boundingBox())!.height})
    if (width === 390) await page.screenshot({animations:'disabled',path:'test-results/household-compact-mobile.png',fullPage:false})
  }
  console.log('Compact density:',JSON.stringify(measurements))
})
test('long text remains bounded and expandable with full-copy recovery and large text download', async ({page,context}) => {
  const data = await fixture(page)
  const body = '<script>inert()</script>\n' + 'long exact text 🦊\n'.repeat(20_000)
  const now = new Date().toISOString()
  data.add({id:'long-text',kind:'text',name:'Long note',size:Buffer.byteLength(body),createdAt:now,updatedAt:now,status:'ready',preview:body.slice(0,512),pinned:false,sourceDevice:'Kitchen Mac'})
  data.add({id:'huge-text',kind:'text',name:'Huge note',size:9*1024**2,createdAt:now,updatedAt:now,status:'ready',preview:'A very large stored note',pinned:false,sourceDevice:'Linux'})
  let requests = 0
  await page.route('**/api/items/long-text/text',route=>{requests++;return route.fulfill({status:200,contentType:'text/plain',body})})
  await context.grantPermissions(['clipboard-read','clipboard-write'])
  await page.setViewportSize({width:360,height:844});await connect(page)
  const row = page.getByRole('article',{name:'Text: Long note'})
  expect(await row.locator('.text-preview').evaluate(node=>node.getBoundingClientRect().height)).toBeLessThanOrEqual(132)
  expect(requests).toBe(0)
  await row.getByRole('button',{name:'Expand text',exact:true}).click()
  const expanded=row.locator('.text-preview.expanded')
  await expect(expanded).toContainText('<script>inert()</script>')
  await expect(row.getByText(/Showing the first 256 KiB/)).toBeVisible()
  expect(await expanded.evaluate(node=>new TextEncoder().encode(node.textContent || '').length)).toBeLessThanOrEqual(256*1024)
  expect(await expanded.evaluate(node=>node.scrollHeight>node.clientHeight)).toBe(true)
  await page.getByRole('button',{name:'Dismiss notification'}).click()
  await row.scrollIntoViewIfNeeded()
  await page.screenshot({animations:'disabled',path:'test-results/household-long-text.png',fullPage:false})
  await row.getByRole('button',{name:'Copy text',exact:true}).click()
  await expect(row.getByRole('button',{name:'Copied',exact:true})).toBeVisible()
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(body)
  await page.getByRole('button',{name:'Dismiss notification'}).click()
  await row.getByRole('button',{name:'Collapse text',exact:true}).click()
  await expect(row.locator('.text-preview.expanded')).toHaveCount(0)
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(260)
  const huge=page.getByRole('article',{name:'Text: Huge note'})
  await expect(huge.getByRole('button',{name:'Download .txt',exact:true})).toBeEnabled()
  await expect(huge.getByRole('button',{name:'Copy text'})).toBeDisabled()
  await expect(huge).toContainText('exceeds the 8 MiB copy budget')
  await huge.getByRole('button',{name:'More actions for Huge note',exact:true}).click()
  await expect(huge.getByRole('menuitem',{name:'Expand text',exact:true})).toHaveCount(0)
  await page.keyboard.press('Escape')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.evaluate(()=>Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{throw new Error('Clipboard unavailable. Try again.')}}))
  const short = page.getByRole('article',{name:'Text: Kitchen note'})
  await short.getByRole('button',{name:'Copy text',exact:true}).click()
  await expect(short.getByRole('alert')).toContainText('Clipboard unavailable. Try again.')
  await expect(short.getByRole('button',{name:'Copy text',exact:true})).toBeEnabled()
  await short.scrollIntoViewIfNeeded()
  await page.screenshot({animations:'disabled',path:'test-results/household-row-error.png',fullPage:false})
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
  await page.screenshot({animations:'disabled',path:'test-results/household-mobile.png',fullPage:false})
  await page.getByRole('button',{name:'Copy text',exact:true}).click()
  const notice=page.locator('.toast');await expect(notice).toBeVisible()
  const noticeBox=await notice.boundingBox();const tabBox=await page.getByRole('navigation',{name:'Mobile feed filters',includeHidden:true}).boundingBox()
  expect(noticeBox!.y+noticeBox!.height).toBeLessThan(tabBox!.y)
  await uncovered(page.getByRole('navigation',{name:'Mobile feed filters',includeHidden:true}).getByRole('button',{name:'Pinned',exact:true}))
  await notice.getByRole('button',{name:'Dismiss notification'}).click()
  for(const button of [page.getByRole('button',{name:'Copy text',exact:true}),page.getByRole('button',{name:'Download',exact:true}),page.getByRole('button',{name:'More actions for weekend.zip',exact:true})]) { const box=await button.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.width).toBeGreaterThanOrEqual(44) }
  await page.getByRole('button',{name:'More actions for Kitchen note',exact:true}).click()
  for (const name of ['Download .txt','Download .md','Edit entry','Pin item','Delete item']) { const box=await page.getByRole('menuitem',{name,exact:true}).boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.width).toBeGreaterThanOrEqual(44) }
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:/Connected|Reconnecting/}).click()
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible()
  await page.getByRole('button',{name:'Disconnect this browser'}).focus(); await page.keyboard.press('Tab')
  await expect(page.getByRole('button',{name:'Close connection settings'})).toBeFocused()
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible()
})
async function nativeFixture(page: Page,clickTarget: {baseUrl:string;itemId:string}|null=null,startup:'ready'|'offline'|401|403='ready',connection:'saved'|'missing'|'disconnected'='saved',desktop?:{platform:'macos'|'linux';label:string;canRenameDevice?:boolean}) {
  await page.addInitScript(({body,clickTarget,startup,connection,desktop}) => {
    let pendingTarget=clickTarget
    let feedFailure=startup
    let config=JSON.parse(localStorage.getItem('fixture.native.config')||'null') || {baseUrl:connection==='missing'?undefined:'https://household.example',connected:connection==='saved',sourceDevice:'Phone',deviceId:'11111111111111111111111111111111',platform:'android',...(desktop?{platform:desktop.platform,sourceDevice:desktop.label,canRenameDevice:desktop.canRenameDevice}:{})}
    let deleted=false;let deleteFailure=false;let localNameFailure=false;let registryNameFailure=false
    let registered=JSON.parse(localStorage.getItem('fixture.native.device')||'null')||{id:config.deviceId,label:config.sourceDevice,platform:config.platform,createdAt:new Date().toISOString()}
    localStorage.setItem('fixture.native.device',JSON.stringify(registered))
    ;(window as unknown as {setNativeNameFailure:(local:boolean,registry:boolean)=>void}).setNativeNameFailure=(local,registry)=>{localNameFailure=local;registryNameFailure=registry}
    ;(window as unknown as {setNativeDeleteFailure:(failed:boolean)=>void}).setNativeDeleteFailure=failed=>{deleteFailure=failed}
    ;(window as unknown as {setNativeFeedFailure:(failure:typeof startup)=>void}).setNativeFeedFailure=failure=>{feedFailure=failure}
    ;(window as unknown as {setNativeTarget:(target:typeof clickTarget)=>void}).setNativeTarget=target=>{pendingTarget=target}
    const calls: {command:string;args?:Record<string,unknown>}[] = []
    ;(window as unknown as {nativeCalls:unknown}).nativeCalls=calls
    window.__HOUSEHOLD_NATIVE__={platform:desktop?.platform||'android',invoke:async(command,args)=>{
      calls.push({command,args})
      if(command==='native_get_config') return config
      if(command==='native_rename_device'){if(localNameFailure)throw new Error('Device name storage unavailable');config={...config,sourceDevice:args?.sourceDevice};localStorage.setItem('fixture.native.config',JSON.stringify(config));return null}
      if(command==='native_configure'){config={...config,baseUrl:args?.baseUrl,sourceDevice:args?.sourceDevice,connected:true};localStorage.setItem('fixture.native.config',JSON.stringify(config));return null}
      if(command==='native_disconnect'){config={...config,connected:false};localStorage.setItem('fixture.native.config',JSON.stringify(config));return null}
      if(command==='native_get_arrival_settings')return {enabled:false,permission:'prompt',mode:'scheduled'}
      if(command==='native_set_arrival_enabled')return {enabled:args?.enabled,permission:'granted',mode:'scheduled'}
      if(command==='native_take_arrival_target'){const target=pendingTarget;pendingTarget=null;return target}
      if(command==='native_list_transfers') return [
        {id:'upload',direction:'upload',name:'Family videos.zip',size:2*1024**3,offset:1024**3,status:'running'},
        {id:'validation',direction:'upload',name:'Notes.txt',size:1024,offset:1024,status:'validating'},
        {id:'download',direction:'download',name:'Holiday photos.zip',size:2*1024**3,offset:512*1024**2,status:'paused'},
      ]
      if(command==='native_api') {
        if(!config.baseUrl||!config.connected)throw new Error('Native API must not run before connection is configured')
        const path=String(args?.path)
        if(path==='/api/items/native-note'&&args?.method==='DELETE'){if(deleteFailure)return {status:500,body:'{"error":{"message":"Delete unavailable; try again"}}'};deleted=true;return {status:204,body:''}}
        if(path.startsWith('/api/items?')){
          if(feedFailure==='offline')throw new Error('Network unavailable')
          if(feedFailure!=='ready')return {status:feedFailure,body:'{"error":{"message":"Access denied"}}'}
        }
        if(path==='/api/devices')return {status:200,body:JSON.stringify({devices:[registered,{id:'22222222222222222222222222222222',label:'Kitchen Mac',platform:'macos',createdAt:new Date().toISOString()}]})}
        if(path==='/api/devices/register'){const request=JSON.parse(String(args?.body));if(!request.preserveExisting){if(registryNameFailure)return {status:500,body:'{"error":{"message":"Household rename unavailable"}}'};registered={...registered,...request};localStorage.setItem('fixture.native.device',JSON.stringify(registered))};return {status:200,body:JSON.stringify({device:registered})}}
        if(path.startsWith('/api/items?')) return {status:200,body:JSON.stringify({items:deleted?[]:[{id:'native-note',kind:'text',name:'Native note',size:body.length,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'ready',preview:'native preview',pinned:false}],nextCursor:null})}
        if(path==='/api/items/native-note')return {status:200,body:JSON.stringify({item:{id:'native-note',kind:'text',name:'Native note',size:body.length,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'ready',preview:'native preview',pinned:false}})}
        if(path.endsWith('/text')) return {status:200,body}
        if(path==='/api/storage') return {status:200,body:JSON.stringify({usedBytes:1,freeBytes:100000,maxFileBytes:21474836480,maxTextBytes:33554432,maxStorageBytes:null})}
        return {status:200,body:'{"status":"ok"}'}
      }
    }}
  },{body:fullText,clickTarget,startup,connection,desktop})
}
for(const pointerBlur of [false,true])test(`native desktop delete confirmation, failure/retry and empty 204 (null pointer blur=${pointerBlur})`,async({page})=>{
  await nativeFixture(page,null,'ready','saved',{platform:'macos',label:'Kitchen Mac'})
  await page.goto('/')
  const row=page.getByRole('article',{name:'Text: Native note'})
  const more=row.getByRole('button',{name:'More actions for Native note'})
  const deletions=()=>page.evaluate(()=>(window as unknown as {nativeCalls:{command:string;args?:Record<string,unknown>}[]}).nativeCalls.filter(call=>call.command==='native_api'&&call.args?.method==='DELETE'))
  await expect(row.getByRole('button',{name:'Copy text',exact:true})).toBeEnabled()
  await page.evaluate(()=>{
    const events:unknown[]=[];(window as unknown as {menuEvents:unknown[]}).menuEvents=events
    for(const type of ['pointerdown','mousedown','focusout','focusin','pointerup','mouseup','click'])document.addEventListener(type,event=>{
      const target=event.target as HTMLElement;const related=(event as FocusEvent).relatedTarget as HTMLElement|null
      if(target.closest('.item-menu'))events.push({type,target:target.textContent,related:related?.outerHTML?.slice(0,200)??null})
    },true)
  })
  if(pointerBlur)await page.evaluate(()=>document.addEventListener('mousedown',event=>{if((event.target as Element).closest('[role=menuitem]'))(document.activeElement as HTMLElement)?.blur()},true))
  await more.click()
  await expect(more).toHaveAttribute('tabindex','0')
  for(const item of await row.getByRole('menuitem').all())await expect(item).toHaveAttribute('tabindex','0')
  const action=row.getByRole('menuitem',{name:'Delete item',exact:true})
  await uncovered(action)
  const box=await action.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.width).toBeGreaterThanOrEqual(44)
  await action.click()
  await test.info().attach('menu-pointer-focus-events',{body:JSON.stringify(await page.evaluate(()=>(window as unknown as {menuEvents:unknown[]}).menuEvents),null,2),contentType:'application/json'})
  const confirmation=row.getByRole('group',{name:'Confirm deletion'})
  await expect(confirmation).toBeVisible()
  await uncovered(confirmation.getByRole('button',{name:'Delete',exact:true}))
  await uncovered(confirmation.getByRole('button',{name:'Keep',exact:true}))
  await expect(confirmation.getByRole('button',{name:'Keep',exact:true})).toBeFocused()
  if(!pointerBlur)await page.screenshot({animations:'disabled',path:test.info().outputPath('delete-confirm.png'),fullPage:true})
  expect(await deletions()).toHaveLength(0)
  await confirmation.getByRole('button',{name:'Keep',exact:true}).click()
  await expect(confirmation).toHaveCount(0);await expect(row).toBeVisible();expect(await deletions()).toHaveLength(0)
  await more.click();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab');await expect(row.getByRole('menu')).toHaveCount(0)
  await more.click();await row.getByRole('menuitem',{name:'Delete item',exact:true}).click()
  await page.evaluate(()=>(window as unknown as {setNativeDeleteFailure:(failed:boolean)=>void}).setNativeDeleteFailure(true))
  await confirmation.getByRole('button',{name:'Delete',exact:true}).click()
  await expect(row.getByRole('alert')).toHaveText('Delete unavailable; try again')
  await uncovered(row.getByRole('alert'))
  await expect(row).toBeVisible();await expect(confirmation.getByRole('button',{name:'Delete',exact:true})).toBeEnabled()
  await expect(page.getByText('Item deleted.',{exact:true})).toHaveCount(0)
  if(!pointerBlur)await page.screenshot({animations:'disabled',path:test.info().outputPath('delete-failure.png'),fullPage:true})
  await page.evaluate(()=>(window as unknown as {setNativeDeleteFailure:(failed:boolean)=>void}).setNativeDeleteFailure(false))
  await page.evaluate(()=>(window as unknown as {setNativeFeedFailure:(failure:'offline'|'ready')=>void}).setNativeFeedFailure('offline'))
  await confirmation.getByRole('button',{name:'Delete',exact:true}).click()
  await expect(page.getByText('Item deleted.',{exact:true})).toBeVisible()
  await expect(page.locator('.error-banner')).toContainText('Check Tailscale')
  await page.evaluate(()=>(window as unknown as {setNativeFeedFailure:(failure:'offline'|'ready')=>void}).setNativeFeedFailure('ready'))
  await page.locator('.error-banner').getByRole('button',{name:'Retry',exact:true}).click()
  await expect(row).toHaveCount(0)
  const calls=await deletions();expect(calls).toHaveLength(2);expect(calls.every(call=>call.args?.path==='/api/items/native-note'&&!call.args?.body)).toBe(true)
  await page.screenshot({animations:'disabled',path:test.info().outputPath('delete-complete.png')})
})
test('native delete confirmation clears narrow-screen tabs, focuses Keep and exposes failure recovery',async({page})=>{
  await page.setViewportSize({width:390,height:600})
  await nativeFixture(page,null,'ready','saved',{platform:'macos',label:'Kitchen Mac'})
  await page.goto('/')
  const row=page.getByRole('article',{name:'Text: Native note'})
  await row.getByRole('button',{name:'More actions for Native note'}).click()
  await row.getByRole('menuitem',{name:'Delete item',exact:true}).click()
  const confirmation=row.getByRole('group',{name:'Confirm deletion'})
  for(const name of ['Delete','Keep'])await uncovered(confirmation.getByRole('button',{name,exact:true}))
  await expect(confirmation.getByRole('button',{name:'Keep',exact:true})).toBeFocused()
  expect(await page.evaluate(()=>(window as unknown as {nativeCalls:{command:string;args?:Record<string,unknown>}[]}).nativeCalls.filter(call=>call.command==='native_api'&&call.args?.method==='DELETE'))).toHaveLength(0)
  await page.keyboard.press('Enter')
  await expect(confirmation).toHaveCount(0)
  await expect(row).toBeVisible()
  await row.getByRole('button',{name:'More actions for Native note'}).click()
  await row.getByRole('menuitem',{name:'Delete item',exact:true}).click()
  await page.evaluate(()=>(window as unknown as {setNativeDeleteFailure:(failed:boolean)=>void}).setNativeDeleteFailure(true))
  await confirmation.getByRole('button',{name:'Delete',exact:true}).click()
  await expect(row.getByRole('alert')).toHaveText('Delete unavailable; try again')
  await uncovered(row.getByRole('alert'))
  for(const name of ['Delete','Keep'])await uncovered(confirmation.getByRole('button',{name,exact:true}))
  await expect(confirmation.getByRole('button',{name:'Delete',exact:true})).toBeEnabled()
  await expect(page.getByText('Item deleted.',{exact:true})).toHaveCount(0)
  await page.screenshot({animations:'disabled',path:test.info().outputPath('delete-phone-failure.png')})
})
for(const desktopPlatform of ['macos','linux'] as const)test(`native ${desktopPlatform} first-use name stays separate from connection and saves both names`,async({page})=>{
  await nativeFixture(page,null,'ready','saved',{platform:desktopPlatform,label:'Desktop',canRenameDevice:true})
  await page.goto('/')
  const prompt=page.getByRole('region',{name:'Name this device'})
  await expect(prompt).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled()
  await expect(page.getByRole('textbox',{name:'Text to share'})).toBeEditable()
  const name=prompt.getByRole('textbox',{name:'Device name',exact:true})
  await name.fill('Study computer 🖥')
  await page.evaluate(()=>(window as unknown as {setNativeNameFailure:(local:boolean,registry:boolean)=>void}).setNativeNameFailure(true,false))
  await prompt.getByRole('button',{name:'Save name',exact:true}).click()
  await expect(prompt.getByRole('alert')).toHaveText('Device name storage unavailable')
  await expect(name).toHaveValue('Study computer 🖥');await expect(prompt.getByRole('button',{name:'Save name',exact:true})).toBeEnabled()
  expect(await page.evaluate(()=>(window as unknown as {nativeCalls:{command:string;args?:Record<string,unknown>}[]}).nativeCalls.filter(call=>call.command==='native_api'&&call.args?.path==='/api/devices/register'&&!JSON.parse(String(call.args.body)).preserveExisting))).toHaveLength(0)
  await page.evaluate(()=>(window as unknown as {setNativeNameFailure:(local:boolean,registry:boolean)=>void}).setNativeNameFailure(false,true))
  await prompt.getByRole('button',{name:'Save name',exact:true}).click()
  await expect(prompt.getByRole('alert')).toContainText('Saved on this device, but the household name could not be updated')
  await expect(name).toHaveValue('Study computer 🖥');await expect(page.getByText('Device name saved.',{exact:true})).toHaveCount(0)
  await page.screenshot({animations:'disabled',path:`test-results/zing-device-name-${desktopPlatform}-partial.png`,fullPage:true})
  await page.getByRole('button',{name:'Refresh feed',exact:true}).click()
  await expect(name).toHaveValue('Study computer 🖥');await expect(prompt.getByRole('alert')).toContainText('Saved on this device')
  await page.reload();await expect(prompt).toBeVisible();await expect(name).toHaveValue('Study computer 🖥')
  await expect(prompt).toContainText('This name is saved on this device')
  await page.evaluate(()=>(window as unknown as {setNativeNameFailure:(local:boolean,registry:boolean)=>void}).setNativeNameFailure(false,false))
  await prompt.getByRole('button',{name:'Save name',exact:true}).click()
  await expect(prompt).toHaveCount(0);await expect(page.getByText('Device name saved.',{exact:true})).toBeVisible()
  const state=await page.evaluate(()=>({config:JSON.parse(localStorage.getItem('fixture.native.config')!),device:JSON.parse(localStorage.getItem('fixture.native.device')!),calls:(window as unknown as {nativeCalls:{command:string;args?:Record<string,unknown>}[]}).nativeCalls}))
  expect(state.config).toMatchObject({sourceDevice:'Study computer 🖥',baseUrl:'https://household.example',deviceId:'11111111111111111111111111111111',connected:true})
  expect(state.device).toMatchObject({label:'Study computer 🖥',id:state.config.deviceId})
  expect(state.calls.some(call=>['native_configure','native_disconnect','native_control'].includes(call.command))).toBe(false)
  await expect(page.getByRole('group',{name:'To household: Family videos.zip'})).toContainText('Uploading')
  await page.reload();await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled();await expect(prompt).toHaveCount(0)
  await page.getByRole('button',{name:'Connection and device settings'}).click()
  await expect(page.getByLabel('This device’s name')).toHaveValue('Study computer 🖥')
})
test('native desktop naming dismissal survives reload, stays per identity and leaves Settings rename available',async({page})=>{
  await nativeFixture(page,null,'ready','saved',{platform:'macos',label:'Desktop',canRenameDevice:true})
  await page.goto('/')
  const prompt=page.getByRole('region',{name:'Name this device'})
  await expect(prompt).toBeVisible()
  await page.screenshot({animations:'disabled',path:'test-results/zing-device-name-first-use.png',fullPage:true})
  await prompt.getByRole('button',{name:'Not now',exact:true}).click();await expect(prompt).toHaveCount(0)
  await page.reload();await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled();await expect(prompt).toHaveCount(0)
  // A different durable identity must get its own opportunity to choose a name.
  await page.evaluate(()=>{localStorage.setItem('fixture.native.config',JSON.stringify({baseUrl:'https://household.example',connected:true,sourceDevice:'Desktop',deviceId:'33333333333333333333333333333333',platform:'macos',canRenameDevice:true}));localStorage.removeItem('fixture.native.device')})
  await page.reload();await expect(prompt).toBeVisible();await prompt.getByRole('button',{name:'Not now',exact:true}).click()
  await page.getByRole('button',{name:'Connection and device settings'}).click()
  await page.getByLabel('This device’s name').fill('Kitchen Mac')
  await page.getByRole('button',{name:'Save device name',exact:true}).click()
  await expect(page.getByText('Device name saved.',{exact:true})).toBeVisible()
  const state=await page.evaluate(()=>({config:JSON.parse(localStorage.getItem('fixture.native.config')!),device:JSON.parse(localStorage.getItem('fixture.native.device')!),calls:(window as unknown as {nativeCalls:{command:string;args?:Record<string,unknown>}[]}).nativeCalls}))
  expect(state.config).toMatchObject({sourceDevice:'Kitchen Mac',deviceId:'33333333333333333333333333333333',baseUrl:'https://household.example'})
  expect(state.device).toMatchObject({label:'Kitchen Mac',id:state.config.deviceId})
  expect(state.calls.some(call=>['native_configure','native_disconnect','native_control'].includes(call.command))).toBe(false)
})
for(const desktop of [{platform:'macos',label:'Kitchen Mac',canRenameDevice:true},{platform:'linux',label:'Desktop'},{platform:'macos',label:'Desktop',canRenameDevice:false}] as const)test(`native naming skips custom or unsupported client ${desktop.platform}/${desktop.label}/${desktop.canRenameDevice}`,async({page})=>{
  await nativeFixture(page,null,'ready','saved',desktop);await page.goto('/')
  await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled()
  await expect(page.getByRole('region',{name:'Name this device'})).toHaveCount(0)
  expect(await page.evaluate(()=>(window as unknown as {nativeCalls:{command:string}[]}).nativeCalls.some(call=>call.command==='native_rename_device'))).toBe(false)
})
test('packaged native bridge is detected before the app renders', async ({page}) => {
  await nativeFixture(page)
  const browserApiRequests:string[]=[];page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))browserApiRequests.push(request.url())})
  await page.goto('/')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled()
  await page.screenshot({animations:'disabled',path:'test-results/zing-preconfigured-native-desktop.png',fullPage:true})
  await page.getByRole('button',{name:'Copy text',exact:true}).click()
  await expect(page.getByRole('button',{name:'Copied',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Dismiss notification'}).click()
  await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled()
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
  await page.screenshot({animations:'disabled',path:'test-results/household-transfers.png',fullPage:false})
})

for(const connection of ['missing','disconnected'] as const)test(`native ${connection} connection opens the inbox, saves explicit settings and preserves Disconnect`,async({page})=>{
  await page.setViewportSize({width:360,height:839});await nativeFixture(page,null,'ready',connection)
  const browserApiRequests:string[]=[]
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))browserApiRequests.push(request.url())})
  await page.goto('/')
  await expect(page.getByRole('heading',{name:'All shares'})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0)
  const configure=page.getByRole('button',{name:'Configure connection',exact:true}),tabs=page.getByRole('navigation',{name:'Mobile feed filters'})
  await uncovered(configure);await expect(page.getByRole('textbox',{name:'Text to share'})).toBeDisabled()
  for(const tab of await tabs.getByRole('button').all())await uncovered(tab)
  await tabs.getByRole('button',{name:'Pinned',exact:true}).click();await page.getByRole('combobox',{name:'Content type'}).selectOption('file')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(()=>(window as unknown as {nativeCalls:{command:string}[]}).nativeCalls.some(call=>call.command==='native_api'))).toBe(false)
  await page.screenshot({animations:'disabled',path:`test-results/zing-native-${connection}-inbox.png`})
  await configure.click()
  const dialog=page.getByRole('dialog',{name:'Connection settings'})
  await expect(dialog.getByLabel('Household server')).toHaveValue(connection==='missing'?'':'https://household.example')
  await expect(dialog.getByLabel('App token (optional)')).toHaveCount(0)
  await expect(dialog.getByRole('button',{name:'Advanced · Use app token'})).toBeEnabled()
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(configure).toBeFocused()
  await configure.click();await dialog.getByLabel('Household server').fill('https://chosen.example')
  await dialog.getByRole('button',{name:'Connect household',exact:true}).click();await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled()
  await expect(page.getByRole('combobox',{name:'Content type'})).toHaveValue('file')
  await expect(tabs.getByRole('button',{name:'Pinned',exact:true})).toHaveAttribute('aria-current','page')
  const configured=await page.evaluate(()=>(window as unknown as {nativeCalls:{command:string;args?:Record<string,unknown>}[]}).nativeCalls.filter(call=>call.command==='native_configure'))
  expect(configured).toEqual([{command:'native_configure',args:{baseUrl:'https://chosen.example',token:'',sourceDevice:'Phone'}}])
  await page.reload();await expect(page.getByRole('button',{name:'Copy text',exact:true})).toBeEnabled();await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(()=>(window as unknown as {nativeCalls:{command:string}[]}).nativeCalls.some(call=>call.command==='native_configure'))).toBe(false)
  await page.getByRole('button',{name:/Connected|Reconnecting/}).click()
  await expect(dialog.getByLabel('Household server')).toHaveValue('https://chosen.example')
  await dialog.getByRole('button',{name:'Disconnect this app',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(configure).toBeVisible()
  await page.reload();await expect(configure).toBeVisible();await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(()=>(window as unknown as {nativeCalls:{command:string}[]}).nativeCalls.some(call=>call.command==='native_api'||call.command==='native_configure'))).toBe(false)
  expect(browserApiRequests).toEqual([])
})

for(const failure of ['offline',401,403] as const)test(`configured native startup ${failure} keeps the feed open with Retry and Settings`,async({page})=>{
  await page.setViewportSize({width:412,height:839})
  await nativeFixture(page,null,failure)
  const browserApiRequests:string[]=[]
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))browserApiRequests.push(request.url())})
  await page.goto('/')
  const alert=page.getByRole('alert')
  await expect(alert).toContainText(failure==='offline'?'Check Tailscale':'Access was not accepted')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading',{name:'Your household is unavailable'})).toBeVisible()
  await expect(page.getByRole('textbox',{name:'Text to share'})).toBeDisabled()
  await alert.scrollIntoViewIfNeeded()
  await page.screenshot({animations:'disabled',path:`test-results/zing-configured-native-${failure}-phone.png`,fullPage:true})
  await alert.getByRole('button',{name:'Settings',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Connection settings'})
  await expect(dialog.getByLabel('Household server')).toHaveValue('https://household.example')
  await expect(dialog.getByRole('button',{name:'Advanced · Use app token'})).toBeEnabled()
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0)
  await page.evaluate(()=>(window as unknown as {setNativeFeedFailure:(failure:'ready')=>void}).setNativeFeedFailure('ready'))
  await alert.getByRole('button',{name:'Retry',exact:true}).click()
  await expect(page.getByRole('button',{name:'Copy text',exact:true})).toBeEnabled()
  await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(alert).toHaveCount(0)
  const calls=await page.evaluate(()=>(window as unknown as {nativeCalls:{command:string}[]}).nativeCalls)
  expect(calls.some(call=>call.command==='native_configure')).toBe(false)
  expect(browserApiRequests).toEqual([])
})

for (const runtime of ['browser', 'android'] as const) test(`${runtime} applies safe areas once with nonzero Chromium insets`, async ({page,context}) => {
  await page.setViewportSize({width:412,height:806})
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {insets:{top:36,right:28,bottom:48,left:24}})
  if (runtime === 'android') { await nativeFixture(page); await page.goto('/') }
  else { await fixture(page); await connect(page) }
  await expect(page.getByRole('button',{name:'Copy text',exact:true})).toBeVisible()
  expect(await page.locator('html').evaluate(node=>node.hasAttribute('data-native-android'))).toBe(runtime === 'android')
  const android = runtime === 'android'
  const header = page.locator('.topbar'); const tabs = page.locator('.mobile-tabs')
  expect((await header.boundingBox())!.height).toBe(android ? 56 : 92)
  const bar = (await tabs.boundingBox())!
  expect(bar.height).toBe(android ? 72 : 120); expect(bar.y+bar.height).toBe(806)
  const styles = await page.evaluate(() => {
    const style = (selector:string) => getComputedStyle(document.querySelector(selector)!)
    return {
      header:[style('.topbar').paddingTop,style('.topbar').paddingLeft,style('.topbar').paddingRight],
      main:[style('main').paddingBottom,style('main').paddingLeft,style('main').paddingRight],
      tabs:[style('.mobile-tabs').paddingBottom,style('.mobile-tabs').paddingLeft,style('.mobile-tabs').paddingRight],
      scroll:style('html').scrollPaddingBottom, card:style('.feed-card').scrollMarginBottom,
    }
  })
  expect(styles).toEqual(android ? {
    header:['0px','16px','16px'],main:['96px','16px','16px'],tabs:['8px','12px','12px'],scroll:'88px',card:'88px',
  } : {
    header:['36px','24px','28px'],main:['144px','24px','28px'],tabs:['56px','24px','28px'],scroll:'136px',card:'136px',
  })
  for (const tab of await tabs.locator('.mobile-tab-list button').all()) {
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);await uncovered(tab)
  }
  await page.getByRole('button',{name:'Copy text',exact:true}).click()
  await expect(page.locator('.toast')).toBeVisible()
  expect(await page.locator('.toast').evaluate(node=>getComputedStyle(node).bottom)).toBe(android ? '88px' : '136px')
  for (const tab of await tabs.locator('.mobile-tab-list button').all()) await uncovered(tab)
  await page.getByRole('button',{name:'Dismiss notification'}).click()
  await page.getByRole('textbox',{name:'Text to share'}).focus()
  const composer = page.getByRole('textbox',{name:'Text to share'})
  await composer.fill('Keep this draft')
  await expect(tabs).toBeHidden()
  expect(await page.locator('.editing-toolbar').evaluate(node=>getComputedStyle(node).top)).toBe(android ? '8px' : '36px')
  await page.getByRole('button',{name:'Done editing',exact:true}).click()
  expect(await tabs.evaluate(node=>getComputedStyle(node).position)).toBe('fixed')
  await expect(tabs.getByRole('button',{name:'All shares',exact:true})).toBeFocused()
  await expect(composer).toHaveValue('Keep this draft')
  await page.getByRole('button',{name:/Connected|Reconnecting/}).click()
  expect(await page.locator('.modal-backdrop').evaluate(node=>{
    const s=getComputedStyle(node);return [s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft]
  })).toEqual(android ? ['12px','12px','12px','12px'] : ['36px','28px','48px','24px'])
  await cdp.detach()
})

test('narrow layouts keep long shares, recovery controls, and the composer usable', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('household.transfers.v1', JSON.stringify([{
      id:'saved-upload', name:'Family holiday — '+ 'long-filename-'.repeat(18)+'.mp4',
      size:20_000_000_000,lastModified:1,kind:'file',sourceDevice:'Phone',
      destination:location.origin,state:'uploading',confirmed:8*1024**2,sent:8*1024**2,
    }]))
  })
  await fixture(page,true); await connect(page)
  for (const width of [320,360,390,412]) {
    await page.setViewportSize({width,height:740})
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),`${width}px page width`).toBe(true)
    for (const control of [page.getByRole('textbox',{name:'Text to share'}),page.getByRole('searchbox')]) {
      expect(await control.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16)
    }
    const filters = page.getByRole('navigation',{name:'Mobile feed filters',includeHidden:true})
    await expect(page.getByRole('navigation')).toHaveCount(1)
    const bar = await filters.boundingBox()
    expect(bar!.y+bar!.height).toBe(740)
    expect(bar!.y).toBeGreaterThan(640)
    const tabs=filters.locator('.mobile-tab-list').getByRole('button')
    await expect(tabs).toHaveCount(3)
    for (const tab of await tabs.all()) {
      const box=await tab.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.width).toBeGreaterThanOrEqual(44)
      await expect(tab.locator('svg')).toBeVisible();await uncovered(tab)
    }
    await page.getByRole('combobox',{name:'Content type'}).selectOption('file')
    await expect(page.getByRole('article')).toHaveCount(4)
    await expect(page.getByRole('combobox',{name:'Content type'})).toHaveValue('file')
    await page.getByRole('combobox',{name:'Content type'}).selectOption('all')
    await filters.getByRole('button',{name:'All shares',exact:true}).click()
    await expect(page.getByRole('article')).toHaveCount(8)
    const recovery=page.getByRole('button',{name:'Reselect',exact:true})
    await recovery.scrollIntoViewIfNeeded();await uncovered(recovery)
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
    const last=page.getByRole('article').last()
    const more=last.getByRole('button',{name:/More actions/})
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight))
    await more.scrollIntoViewIfNeeded();await uncovered(more);await more.click()
    for(const action of await last.getByRole('menuitem').all()) {await action.scrollIntoViewIfNeeded();await uncovered(action)}
    await page.keyboard.press('Escape');await expect(more).toBeFocused()
    const older=page.getByRole('button',{name:'Load older items',exact:true})
    await older.scrollIntoViewIfNeeded();await uncovered(older)
    await page.getByRole('textbox',{name:'Text to share'}).focus()
    const composer=page.getByRole('textbox',{name:'Text to share'})
    await expect(composer).toBeFocused()
    expect(await page.locator('.composer').evaluate(node => getComputedStyle(node).position)).toBe('static')
    await expect(filters).toBeHidden()
    await composer.fill('A draft that must survive an error')
    await page.route('**/api/text',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":{"message":"Try sharing again"}}'}),{times:1})
    const share=page.getByRole('button',{name:'Share text',exact:true})
    await share.click();await expect(page.locator('.composer').getByRole('alert')).toContainText('Try sharing again')
    await expect(composer).toHaveValue('A draft that must survive an error')
    await composer.focus()
    await share.scrollIntoViewIfNeeded();await uncovered(share)
    // Each width also has to work when the available layout height is short.
    await page.setViewportSize({width,height:420})
    await share.scrollIntoViewIfNeeded();await uncovered(share)
    const done=page.getByRole('button',{name:'Done editing',exact:true})
    await done.scrollIntoViewIfNeeded();await uncovered(done);await done.click()
    await expect(filters.getByRole('button',{name:'All shares',exact:true})).toBeFocused()
    expect(await filters.evaluate(node=>getComputedStyle(node).position)).toBe('fixed')
    await filters.getByRole('button',{name:'Pinned',exact:true}).focus();await page.keyboard.press('Enter')
    await expect(filters.getByRole('button',{name:'Pinned',exact:true})).toHaveAttribute('aria-current','page')
    await filters.getByRole('button',{name:'All shares',exact:true}).focus();await page.keyboard.press('Space')
  }
  // A shorter viewport approximates available layout after keyboard appearance.
  // This verifies reflow/visibility only; it does not simulate a device keyboard.
  await page.setViewportSize({width:320,height:420})
  await page.getByRole('textbox',{name:'Text to share'}).focus()
  await page.getByRole('textbox',{name:'Text to share'}).fill('Ready on my other device')
  const send = page.getByRole('button',{name:'Share text',exact:true})
  await send.scrollIntoViewIfNeeded(); await uncovered(send)
  await expect(page.locator('[style]')).toHaveCount(0)
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
  expect(viewport).toContain('width=device-width'); expect(viewport).toContain('viewport-fit=cover')
  expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/)
  await page.screenshot({animations:'disabled',path:'test-results/household-narrow-keyboard-layout.png',fullPage:false})
  await page.getByRole('button',{name:'Done editing',exact:true}).click()
  await page.setViewportSize({width:390,height:740})
  await page.locator('.feed-card.file').last().scrollIntoViewIfNeeded()
  await page.screenshot({animations:'disabled',path:'test-results/household-long-file.png',fullPage:false})
})


for(const runtime of ['browser','android'] as const)test(`${runtime} hides feed tabs while editing above a non-resizing keyboard fixture`,async({page})=>{
  if(runtime==='browser')await page.addInitScript(()=>localStorage.setItem('household.transfers.v1',JSON.stringify(Array.from({length:10},(_,n)=>({
    id:`saved-${n}`,name:`Queued source ${n}.zip`,size:20_000_000_000,lastModified:1,kind:'file',sourceDevice:'Phone',
    destination:location.origin,state:'uploading',confirmed:8*1024**2,sent:8*1024**2,
  })))))
  await page.setViewportSize({width:360,height:915})
  if(runtime==='android'){await nativeFixture(page);await page.goto('/');await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled()}
  else{await fixture(page);await connect(page)}
  const initial=await page.evaluate(()=>({inner:innerHeight,visual:visualViewport!.height}))
  const composer=page.getByRole('textbox',{name:'Text to share'})
  const tabs=page.getByRole('navigation',{name:'Mobile feed filters',includeHidden:true})
  const sameNav=await tabs.elementHandle()
  const kind=page.getByRole('combobox',{name:'Content type'})
  await kind.selectOption('file');await tabs.getByRole('button',{name:'Pinned',exact:true}).click()
  await page.getByRole('button',{name:'Send to Everyone',exact:true}).click()
  const picker=page.getByRole('dialog',{name:'Send to devices'})
  await picker.getByRole('searchbox',{name:'Find devices'}).fill('kitchen');await expect(tabs).toBeHidden()
  await picker.getByRole('button',{name:/Kitchen Mac/}).click();await picker.getByRole('button',{name:'Done',exact:true}).click()
  await composer.fill('Keep my draft, scope, kind, recipients and identity')
  await page.addStyleTag({content:'#keyboard-occlusion {position:fixed;inset:577.9px 0 0;background:#dce1d6;z-index:9999} '})
  const overlay=()=>page.evaluate(()=>{const node=document.createElement('div');node.id='keyboard-occlusion';document.body.append(node)})
  await overlay()
  expect(await page.evaluate(()=>({inner:innerHeight,visual:visualViewport!.height}))).toEqual(initial)
  await expect(composer).toBeFocused();await expect(tabs).toBeHidden()
  const share=page.getByRole('button',{name:'Share text',exact:true}),done=page.getByRole('button',{name:'Done editing',exact:true})
  await uncovered(share);await uncovered(done)
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('household-keyboard-visibility',{detail:{visible:'false'}})))
  await expect(tabs).toBeHidden()
  expect(await tabs.evaluate(node=>node.contains(document.activeElement))).toBe(false)
  await page.screenshot({animations:'disabled',path:`test-results/zing-editing-${runtime}-keyboard.png`,fullPage:false})
  await page.locator('#keyboard-occlusion').evaluate(node=>node.remove())
  // A native IME-hidden signal restores tabs even with unchanged viewports and field focus.
  if(runtime==='android'){
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('household-keyboard-visibility',{detail:{visible:false}})))
    await expect(composer).toBeFocused()
  }else{
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('household-keyboard-visibility',{detail:{visible:false}})))
    await expect(tabs).toBeHidden()
    await composer.blur()
  }
  await expect(tabs).toBeVisible();await expect(done).toHaveCount(0)
  for(const tab of await tabs.getByRole('button').all())await uncovered(tab)
  expect(await page.evaluate(()=>({inner:innerHeight,visual:visualViewport!.height}))).toEqual(initial)
  await expect(composer).toHaveValue('Keep my draft, scope, kind, recipients and identity')
  await composer.focus()
  if(runtime==='android')await page.evaluate(()=>window.dispatchEvent(new CustomEvent('household-keyboard-visibility',{detail:{visible:true}})))
  await expect(tabs).toBeHidden()
  await page.addStyleTag({content:'.composer.has-draft textarea {height:180px}'})
  await overlay();await share.evaluate(node=>node.scrollIntoView({block:'center'}));await uncovered(share)
  await done.evaluate(node=>node.scrollIntoView({block:'start'}));await uncovered(done)
  await page.locator('#keyboard-occlusion').evaluate(node=>node.remove());await done.click()
  expect(await sameNav!.evaluate(node=>node.isConnected)).toBe(true)
  await expect(tabs.getByRole('button',{name:'Pinned',exact:true})).toBeFocused()
  await expect(kind).toHaveValue('file');await expect(composer).toHaveValue('Keep my draft, scope, kind, recipients and identity')
  await expect(page.getByRole('button',{name:'Send to Kitchen Mac',exact:true})).toBeVisible()
  const search=page.getByRole('searchbox',{name:'Search names and text previews'})
  await search.fill('weekend');await expect(tabs).toBeHidden();await uncovered(search);await uncovered(done)
  await done.click();await expect(search).toHaveValue('weekend');await expect(tabs.getByRole('button',{name:'Pinned',exact:true})).toBeFocused()
  await composer.focus();await composer.dispatchEvent('keydown',{key:'Escape',isComposing:true,bubbles:true})
  await expect(composer).toBeFocused();await expect(done).toBeVisible()
  await page.getByRole('button',{name:'More actions for sharing',exact:true}).click()
  await uncovered(page.getByRole('menuitem',{name:'Upload text file',exact:true}))
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'More actions for sharing',exact:true})).toBeFocused();await expect(done).toBeVisible()
  await composer.focus();await page.keyboard.press('Tab');await page.keyboard.press('Tab');await page.keyboard.press('Tab');await page.keyboard.press('Tab');await page.keyboard.press('Tab')
  await expect(done).toBeFocused();await page.keyboard.press('Escape')
  await expect(tabs.getByRole('button',{name:'Pinned',exact:true})).toBeFocused();await expect(done).toHaveCount(0)
  await composer.focus();await expect(tabs).toBeHidden()
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'))})
  await expect(tabs).toBeVisible();await expect(done).toHaveCount(0)
  await expect(composer).toBeFocused();await expect(composer).toHaveValue('Keep my draft, scope, kind, recipients and identity')
  await expect(kind).toHaveValue('file');await expect(tabs.getByRole('button',{name:'Pinned',exact:true})).toHaveAttribute('aria-current','page')
  await expect(page.getByRole('button',{name:'Send to Kitchen Mac',exact:true})).toBeVisible()
})

for (const many of [false,true]) test(`last five-action text menu stays above bottom tabs on a ${many?'long':'short'} feed`, async ({page}) => {
  const data=await fixture(page,many)
  data.add({id:'last-text',kind:'text',name:'Last text',size:Buffer.byteLength(fullText),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'ready',preview:'A final note',pinned:false,sourceDevice:'Phone'})
  await page.setViewportSize({width:412,height:839});await connect(page)
  const row=page.getByRole('article').last()
  await expect(row).toHaveAccessibleName('Text: Last text')
  const more=row.getByRole('button',{name:'More actions for Last text',exact:true})
  const menu=row.getByRole('menu')
  const names=['Download .txt','Download .md','Edit entry','Pin item','Delete item']
  for(const size of [{width:412,height:839},{width:320,height:420},{width:320,height:240}]) {
    await page.setViewportSize(size)
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight))
    await more.scrollIntoViewIfNeeded();await uncovered(more);await more.click()
    const bounds=await menu.boundingBox()
    const tabs=await page.getByRole('navigation',{name:'Mobile feed filters',includeHidden:true}).boundingBox()
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(tabs!.y)
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(size.width)
    await expect(menu.getByRole('menuitem')).toHaveText(names)
    for(const name of names) {
      const action=menu.getByRole('menuitem',{name,exact:true})
      await expect(action).toBeFocused();await uncovered(action)
      expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await page.keyboard.press('ArrowDown')
    }
    await expect(menu.getByRole('menuitem',{name:names[0],exact:true})).toBeFocused()
    await page.keyboard.press('End');await uncovered(menu.getByRole('menuitem',{name:'Delete item',exact:true}))
    if(size.height===839) await page.screenshot({animations:'disabled',path:`test-results/zing-last-text-menu-${many?'long':'short'}-phone.png`})
    if(size.height===240) await page.screenshot({animations:'disabled',path:`test-results/zing-last-text-menu-${many?'long':'short'}-scroll.png`})
    await page.keyboard.press('Home');await uncovered(menu.getByRole('menuitem',{name:names[0],exact:true}))
    await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(more).toBeFocused()
  }
})

test('secondary text and sharing actions stay keyboard accessible without crowding the feed', async ({page}) => {
  await fixture(page); await connect(page)
  const text = page.getByRole('article',{name:'Text: Kitchen note'})
  await expect(text.getByRole('button',{name:'Copy text',exact:true})).toBeVisible()
  await expect(text.getByRole('button',{name:'Download .txt',exact:true})).toHaveCount(0)
  await text.getByRole('button',{name:'More actions for Kitchen note'}).click()
  const menu = text.getByRole('menu')
  await expect(menu.getByRole('menuitem',{name:'Download .txt',exact:true})).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem',{name:'Download .md',exact:true})).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(text.getByRole('button',{name:'More actions for Kitchen note'})).toBeFocused()
  await expect(menu).toHaveCount(0)
  await page.getByRole('button',{name:'More actions for sharing',exact:true}).click()
  await expect(page.getByRole('menuitem',{name:'Upload text file',exact:true})).toBeVisible()
})

test('pairing failures, empty inbox, and temporary server errors offer a usable next action', async ({page}) => {
  const data = await fixture(page)
  await page.setViewportSize({width:360,height:740}); await page.goto('/')
  const dialog = page.getByRole('dialog',{name:'Connect to Zing'})
  await expect(dialog).toBeVisible()
  await page.getByRole('button',{name:'Advanced · Use app token'}).click()
  await page.getByLabel('App token (optional)').fill('incorrect-token')
  await dialog.getByRole('button',{name:'Connect household',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('Access was not accepted')
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
  await page.screenshot({animations:'disabled',path:'test-results/household-pairing.png',fullPage:false})
  // Reduced available height checks internal scrolling, not an OS keyboard.
  await page.setViewportSize({width:360,height:420})
  expect(await dialog.evaluate(node=>node.scrollHeight>node.clientHeight)).toBe(true)
  await connectButton.scrollIntoViewIfNeeded()
  await expect(connectButton).toBeInViewport({ratio:1})
  await page.setViewportSize({width:360,height:740})
  await page.getByLabel('App token (optional)').fill('test-household-token')
  await dialog.getByRole('button',{name:'Connect household',exact:true}).click()
  await expect(dialog).not.toBeVisible()
  data.clear()
  await page.setViewportSize({width:1280,height:900})
  await page.getByRole('button',{name:'Refresh feed'}).click()
  await expect(page.getByRole('heading',{name:'A fresh start'})).toBeVisible()
  for(const width of [320,360,390,412]) {
    await page.setViewportSize({width,height:740})
    const bar=page.getByRole('navigation',{name:'Mobile feed filters',includeHidden:true})
    await expect(page.getByRole('navigation')).toHaveCount(1)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    const box=await bar.boundingBox();expect(box!.y+box!.height).toBe(740)
    for(const tab of await bar.locator('.mobile-tab-list').getByRole('button').all()) await uncovered(tab)
  }
  await page.setViewportSize({width:360,height:740})
  await page.screenshot({animations:'disabled',path:'test-results/household-empty.png',fullPage:true})
  await page.getByRole('button',{name:'Share something',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Text to share'})).toBeFocused()
  await page.getByRole('button',{name:'Done editing',exact:true}).click()
  await page.getByRole('navigation',{name:'Mobile feed filters',includeHidden:true}).getByRole('button',{name:'Pinned'}).click()
  await expect(page.getByRole('heading',{name:'No pinned items'})).toBeVisible()
  await expect(page.getByRole('navigation',{name:'Mobile feed filters',includeHidden:true}).getByRole('button',{name:'Pinned'})).toBeFocused()
  await page.getByRole('searchbox').fill('missing item')
  await expect(page.getByRole('heading',{name:'No matching shares'})).toBeVisible()
  await page.route('**/api/items?**', route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'unavailable',message:'The household server is temporarily unavailable.'}})}), {times:1})
  await page.getByRole('searchbox').fill('another search')
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
  await page.getByRole('button',{name:'Retry',exact:true}).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('registered devices route exact text and snapshot browser picker destinations across changed selection',async({page})=>{
  const data=await fixture(page);await connect(page)
  const source=data.registrations[0].id
  expect(source).toMatch(/^[a-f0-9]{32}$/)
  await page.getByRole('button',{name:'Send to Everyone',exact:true}).click()
  const picker=page.getByRole('dialog',{name:'Send to devices'})
  await expect(picker.getByRole('searchbox',{name:'Find devices'})).toBeFocused()
  await picker.getByRole('searchbox').fill('pocket')
  await expect(picker.getByRole('button',{name:/Kitchen Mac/})).toHaveCount(0)
  await picker.getByRole('button',{name:/Pocket phone/}).click()
  await picker.getByRole('searchbox').fill('')
  await picker.getByRole('button',{name:/Kitchen Mac/}).click()
  await expect(picker.getByRole('button',{name:/Pocket phone/})).toHaveAttribute('aria-pressed','true')
  await picker.getByRole('button',{name:'Done',exact:true}).click()
  await page.getByRole('textbox',{name:'Text to share'}).fill('  routed 🦊\n')
  await page.getByRole('button',{name:'Share text',exact:true}).click()
  await expect.poll(()=>data.routing[0]).toEqual({sourceDeviceId:source,targetDeviceIds:['33333333333333333333333333333333','22222222222222222222222222222222']})
  const chooserPromise=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Add files',exact:true}).click();const chooser=await chooserPromise
  await page.getByRole('button',{name:'Send to 2 devices',exact:true}).click()
  await picker.getByRole('button',{name:/Everyone/}).click();await picker.getByRole('button',{name:'Done',exact:true}).click()
  await chooser.setFiles({name:'bounded.bin',mimeType:'application/octet-stream',buffer:Buffer.from('immutable recipients')})
  await expect.poll(()=>data.uploadMetadata.length).toBe(1)
  const metadata=Object.fromEntries(data.uploadMetadata[0].split(',').map(field=>{const [key,value]=field.trim().split(' ');return [key,Buffer.from(value,'base64').toString()]}))
  expect(metadata.sourceDeviceId).toBe(source);expect(JSON.parse(metadata.targetDeviceIds)).toEqual(['33333333333333333333333333333333','22222222222222222222222222222222'])
  await page.reload();await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled()
  expect(data.registrations.at(-1)?.id).toBe(source)
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Send to Everyone',exact:true}).click()
  for(const control of await picker.getByRole('button').all()){const box=(await control.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(44)}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({animations:'disabled',path:'test-results/zing-device-picker-phone.png',fullPage:false})
  await page.setViewportSize({width:1280,height:900});await page.screenshot({animations:'disabled',path:'test-results/zing-device-picker-desktop.png',fullPage:false})
})

test('For you keeps device search and pagination while All shares retains the household',async({page})=>{
  const data=await fixture(page,true);await connect(page)
  const source=data.registrations[0].id
  await page.getByRole('navigation',{name:'Feed filters',exact:true}).getByRole('button',{name:'For you',exact:true}).click()
  await expect(page.getByRole('article')).toHaveCount(1)
  await expect(page.locator('.sidebar .nav-count')).toHaveCount(0)
  await page.getByRole('searchbox',{name:'Search names and text previews'}).fill('kitchen')
  await expect.poll(()=>data.lists.some(query=>{const params=new URLSearchParams(query);return params.get('q')==='kitchen'&&params.get('forDevice')===source})).toBe(true)
  await page.getByRole('button',{name:'Load older items',exact:true}).click()
  await expect.poll(()=>data.lists.some(query=>{const params=new URLSearchParams(query);return params.get('q')==='kitchen'&&params.get('forDevice')===source&&params.get('before')==='older-fixture'})).toBe(true)
  await page.getByRole('searchbox',{name:'Search names and text previews'}).fill('')
  await expect(page.getByRole('heading',{name:'Sent to this device',exact:true})).toBeVisible()
  await page.screenshot({animations:'disabled',path:'test-results/zing-for-you-desktop.png',fullPage:false})
  await page.setViewportSize({width:390,height:844});await page.screenshot({animations:'disabled',path:'test-results/zing-for-you-phone.png',fullPage:false})
  await page.getByRole('navigation',{name:'Mobile feed filters',includeHidden:true}).getByRole('button',{name:'All shares',exact:true}).click()
  await expect(page.getByRole('article')).toHaveCount(8)
})

async function notificationDouble(page:Page,permission:'granted'|'denied',withoutLocks=false) {
  await page.addInitScript(({permission,withoutLocks})=>{
    if(withoutLocks)Object.defineProperty(navigator,'locks',{configurable:true,value:undefined})
    const posted:{title:string;options:NotificationOptions}[]=[]
    ;(window as unknown as {alerts:unknown}).alerts=posted
    ;(window as unknown as {permissionRequests:number}).permissionRequests=0
    Object.defineProperty(Notification,'permission',{configurable:true,get:()=>permission})
    Object.defineProperty(Notification,'requestPermission',{configurable:true,value:async()=>{(window as unknown as {permissionRequests:number}).permissionRequests++;return permission}})
    ServiceWorkerRegistration.prototype.showNotification=async function(title,options){posted.push({title,options:options||{}})}
  },{permission,withoutLocks})
}

test('arrival denial is explicit, recoverable, and leaves For you and copy working',async({page})=>{
  await notificationDouble(page,'denied');await fixture(page);await connect(page)
  expect(await page.evaluate(()=>(window as unknown as {permissionRequests:number}).permissionRequests)).toBe(0)
  await page.getByRole('button',{name:/Connected|Reconnecting/}).click()
  await page.getByRole('button',{name:'Enable notifications',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('For you still works')
  expect(await page.evaluate(()=>(window as unknown as {permissionRequests:number}).permissionRequests)).toBe(1)
  expect(await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.endsWith(':enabled')).length)).toBe(0)
  await page.screenshot({animations:'disabled',path:'test-results/zing-arrival-denied.png',fullPage:false})
  await page.keyboard.press('Escape');await page.getByRole('navigation',{name:'Feed filters',exact:true}).getByRole('button',{name:'For you',exact:true}).click()
  await expect(page.getByRole('button',{name:'Copy text',exact:true})).toBeEnabled()
})

for(const election of ['locks','lease'])test(`browser tabs share identity, elect one generic notifier, preserve ACK history and recover a notification link (${election})`,async({page,context})=>{
  await notificationDouble(page,'granted',election==='lease');const data=await fixture(page);await connect(page)
  const source=data.registrations[0].id
  const second=await context.newPage();await notificationDouble(second,'granted',election==='lease');const other=await fixture(second);await connect(second)
  expect(other.registrations[0].id).toBe(source)
  let ack='0';let ready=false;const returned:string[]=[]
  for(const tab of [page,second])await tab.route('**/api/devices/*/notifications**',async route=>{
    const request=route.request(),url=new URL(request.url())
    if(url.pathname.endsWith('/ack')){ack=request.postDataJSON().through;return route.fulfill({contentType:'application/json',body:JSON.stringify({ackCursor:ack})})}
    const after=url.searchParams.get('after')||ack;returned.push(after)
    return route.fulfill({contentType:'application/json',body:JSON.stringify({notifications:ready&&after==='0'?[{sequence:'9007199254740993',itemId:'text-one',createdAt:new Date().toISOString()}]:[],nextCursor:ready?'9007199254740993':after,ackCursor:ack,hasMore:false})})
  })
  await second.getByRole('button',{name:/Connected|Reconnecting/}).click()
  await expect(second.getByText('Off · permission granted',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:/Connected|Reconnecting/}).click();await page.getByRole('button',{name:'Enable notifications',exact:true}).click()
  await expect(page.getByText('Enabled · permission granted',{exact:true})).toBeVisible()
  await expect(second.getByText('Enabled · permission granted',{exact:true})).toBeVisible()
  await expect.poll(()=>returned.length).toBeGreaterThan(0)
  ready=true
  await Promise.all([page.evaluate(()=>window.dispatchEvent(new Event('online'))),second.evaluate(()=>window.dispatchEvent(new Event('online')))])
  const alerts=async()=>[...await page.evaluate(()=>(window as unknown as {alerts:unknown[]}).alerts),...await second.evaluate(()=>(window as unknown as {alerts:unknown[]}).alerts)]
  await expect.poll(async()=>(await alerts()).length).toBe(1)
  expect(await alerts()).toEqual([{title:'Zing',options:{body:'New share available',tag:`household.arrivals:${new URL(page.url()).origin}:${source}:9007199254740993`,data:{itemId:'text-one'},icon:'/icon-192.png'}}])
  await expect.poll(()=>ack).toBe('9007199254740993')
  await Promise.all([page.evaluate(()=>window.dispatchEvent(new Event('online'))),second.evaluate(()=>window.dispatchEvent(new Event('online')))])
  await expect.poll(()=>returned.includes('9007199254740993')).toBe(true);expect((await alerts()).length).toBe(1)
  await page.getByRole('button',{name:'Disable notifications',exact:true}).click()
  await expect(second.getByText('Off · permission granted',{exact:true})).toBeVisible()
  await page.setViewportSize({width:1280,height:900});await page.getByText('Arrival notifications',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:'test-results/zing-arrival-settings-desktop.png',fullPage:false})
  await page.setViewportSize({width:390,height:844});await page.getByText('Arrival notifications',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:'test-results/zing-arrival-settings-phone.png',fullPage:false})
  await page.evaluate(()=>navigator.serviceWorker.dispatchEvent(new MessageEvent('message',{data:{type:'zing-arrival',itemId:'text-one'}})))
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('#share-text-one')).toHaveClass('arrival-highlight')
  await page.goto('/?item=text-one')
  await expect(page.getByRole('navigation',{name:'Mobile feed filters',includeHidden:true}).getByRole('button',{name:'For you',exact:true})).toHaveAttribute('aria-current','page')
  await expect(page.locator('#share-text-one')).toHaveClass('arrival-highlight')
  await uncovered(page.getByRole('button',{name:'Copy text',exact:true}));expect(page.url()).not.toContain('?item=')
  const draft=page.getByRole('textbox',{name:'Text to share'});await draft.fill('Keep my focus and draft after opening an alert')
  const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/items')
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await refreshed;await expect(page.locator('.refresh-button')).toBeEnabled()
  await expect(draft).toBeFocused();await expect(draft).toHaveValue('Keep my focus and draft after opening an alert')
  await page.goto('/?item=deleted-share');await expect(page.getByRole('alert')).toContainText('deleted or is no longer available')
  await expect(page.getByRole('button',{name:'Retry opening share',exact:true})).toBeVisible()
  await second.close()
})

test('native routing and arrival settings stay on the native bridge without browser notifications',async({page})=>{
  await nativeFixture(page);await page.goto('/')
  await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'Send to Everyone',exact:true}).click();const picker=page.getByRole('dialog',{name:'Send to devices'})
  await picker.getByRole('button',{name:/Kitchen Mac/}).click();await picker.getByRole('button',{name:'Done',exact:true}).click()
  await page.getByRole('button',{name:'Add files',exact:true}).click()
  await page.getByRole('navigation',{name:'Feed filters',exact:true}).getByRole('button',{name:'For you',exact:true}).click()
  await page.getByRole('button',{name:/Connected|Reconnecting/}).click();await page.getByRole('button',{name:'Enable notifications',exact:true}).click()
  await expect(page.getByText('Enabled · permission granted',{exact:true})).toBeVisible()
  await expect(page.getByText(/Background checks run periodically/)).toBeVisible()
  await expect(page.getByText(/After reboot or force-stop, reopen Zing/)).toBeVisible()
  const calls=await page.evaluate(()=>(window as unknown as {nativeCalls:{command:string;args?:Record<string,unknown>}[]}).nativeCalls)
  expect(calls).toContainEqual({command:'native_pick_uploads',args:{kind:'file',sourceDevice:'Phone',targetDeviceIds:['22222222222222222222222222222222']}})
  expect(calls).toContainEqual({command:'native_set_arrival_enabled',args:{enabled:true}})
  expect(calls.some(call=>call.command==='native_api'&&String(call.args?.path).includes('forDevice=11111111111111111111111111111111'))).toBe(true)
  expect(calls.some(call=>call.command==='native_api'&&String(call.args?.path).includes('/notifications'))).toBe(false)
  expect(await page.evaluate(async()=>navigator.serviceWorker? (await navigator.serviceWorker.getRegistrations()).length:0)).toBe(0)
  await page.getByText('Arrival notifications',{exact:true}).scrollIntoViewIfNeeded()
  await page.screenshot({animations:'disabled',path:'test-results/zing-arrival-settings-native.png',fullPage:false})
  await page.getByRole('button',{name:'Close connection settings'}).click()
  await page.getByRole('button',{name:'Help & tips',exact:true}).click()
  await expect(page.getByText(/Reopen Zing after reboot or force-stop/)).toBeVisible()
})

test('native cold-start clicks refetch and highlight ready content without automatic copy or download',async({page})=>{
  await nativeFixture(page,{baseUrl:'https://household.example',itemId:'native-note'});await page.goto('/')
  await expect(page.getByRole('navigation',{name:'Feed filters',exact:true}).getByRole('button',{name:'For you',exact:true})).toHaveAttribute('aria-current','page')
  await expect(page.locator('#share-native-note')).toHaveClass('arrival-highlight')
  const calls=await page.evaluate(()=>(window as unknown as {nativeCalls:{command:string;args?:Record<string,unknown>}[]}).nativeCalls)
  expect(calls.some(call=>call.command==='native_api'&&call.args?.path==='/api/items/native-note')).toBe(true)
  expect(calls.filter(call=>['native_copy_text','native_download'].includes(call.command))).toEqual([])
})

test('notification links recover offline and reject remote targets while keeping the feed usable',async({page})=>{
  await fixture(page)
  await page.route('**/api/items/text-one',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":{"message":"Server unavailable while opening share"}}'}),{times:1})
  await connect(page);await page.goto('/?item=text-one')
  await expect(page.getByRole('alert')).toContainText('Server unavailable while opening share')
  await page.getByRole('button',{name:'Retry opening share',exact:true}).click()
  await expect(page.locator('#share-text-one')).toHaveClass('arrival-highlight')
  await expect(page.getByRole('button',{name:'Copy text',exact:true})).toBeEnabled()
  await page.goto('/?item=https%3A%2F%2Fevil.example')
  await expect(page.getByRole('alert')).toContainText('notification link is invalid')
  await expect(page.getByRole('button',{name:'Copy text',exact:true})).toBeEnabled()
})

test('device settings forget stale recipients without redirecting them to Everyone and keep browser identity on rename',async({page})=>{
  const data=await fixture(page);await connect(page);const source=data.registrations[0].id
  await page.getByRole('button',{name:'Send to Everyone',exact:true}).click()
  await page.getByRole('dialog',{name:'Send to devices'}).getByRole('button',{name:/Pocket phone/}).click()
  await page.getByRole('dialog',{name:'Send to devices'}).getByRole('button',{name:'Done',exact:true}).click()
  await page.getByRole('button',{name:/Connected|Reconnecting/}).click()
  await page.getByText('Registered devices (3)',{exact:true}).click()
  await page.getByRole('button',{name:'Forget Pocket phone (333333)',exact:true}).click()
  await page.getByRole('button',{name:'Forget device',exact:true}).click()
  await expect(page.getByText('Registered devices (2)',{exact:true})).toBeVisible()
  await page.getByLabel('This device’s name').fill('Study browser')
  await page.getByRole('button',{name:'Save device name',exact:true}).click()
  await expect.poll(()=>data.registrations.at(-1)?.label).toBe('Study browser');expect(data.registrations.at(-1)?.id).toBe(source)
  await page.keyboard.press('Escape')
  await page.getByRole('textbox',{name:'Text to share'}).fill('Do not redirect this')
  await page.getByRole('button',{name:'Share text',exact:true}).click()
  await expect(page.locator('.composer').getByRole('alert')).toContainText('selected device is no longer available')
  expect(data.posted).toEqual([])
  await expect(page.getByRole('button',{name:'Send to Unavailable device',exact:true})).toBeVisible()
  const beforeReload=data.registrations.length
  await page.evaluate(()=>localStorage.setItem('household.device','Stale configured name'))
  await page.reload();await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled()
  expect(data.registrations.slice(beforeReload).some(device=>device.label==='Stale configured name'&&(device as {preserveExisting?:boolean}).preserveExisting===true)).toBe(true)
  await page.getByRole('button',{name:/Connected|Reconnecting/}).click()
  await expect(page.getByLabel('This device’s name')).toHaveValue('Study browser')
})

test('registration failure is recoverable without losing feed access or regenerating identity',async({page})=>{
  const data=await fixture(page);let attempted=''
  await page.route('**/api/devices/register',route=>{attempted=route.request().postDataJSON().id;return route.fulfill({status:409,contentType:'application/json',body:'{"error":{"code":"device_limit","message":"Forget an unused device before registering"}}'})},{times:1})
  await page.goto('/');await page.getByRole('button',{name:'Advanced · Use app token'}).click()
  await page.getByLabel('App token (optional)').fill('test-household-token');await page.getByRole('dialog').getByRole('button',{name:'Connect household',exact:true}).click()
  await expect(page.getByRole('button',{name:'Copy text',exact:true})).toBeEnabled()
  await expect(page.getByRole('alert')).toContainText('Forget an unused device')
  await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'Retry registration',exact:true}).click()
  await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled()
  expect(data.registrations.at(-1)?.id).toBe(attempted)
})

test('Tailscale browser opens directly after a protected fetch and retries network failure without a token prompt',async({page})=>{
  const data=await fixture(page,false,true)
  await page.goto('/')
  await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(data.sessions).toEqual([])
  expect(data.registrations[0]).toMatchObject({preserveExisting:true})
  await expect(page.getByRole('button',{name:'Copy text',exact:true})).toBeEnabled()
  await page.reload();await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled()
  expect(data.sessions).toEqual([])
  await page.getByRole('button',{name:/Connected|Reconnecting/}).click()
  await expect(page.getByLabel('App token (optional)')).toHaveCount(0)
  await expect(page.getByText(/does not revoke Tailscale access/)).toBeVisible()
  await page.screenshot({animations:'disabled',path:'test-results/zing-tailscale-settings.png',fullPage:false})
  await page.keyboard.press('Escape')
  await page.route('**/api/items?**',route=>route.abort('connectionfailed'),{times:1})
  await page.getByRole('button',{name:'Refresh feed'}).click()
  await expect(page.getByRole('alert')).toContainText('Check Tailscale')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('token')
})

test('shared board edits save exact text, cancel, preserve conflicts and reload explicitly without resending',async({page,context})=>{
  const data=await fixture(page);await context.grantPermissions(['clipboard-read','clipboard-write']);await connect(page)
  await page.getByRole('textbox',{name:'Text to share'}).fill('Composer draft stays here')
  const open=async(name:string)=>{const row=page.getByRole('article',{name:`Text: ${name}`});await row.getByRole('button',{name:`More actions for ${name}`}).click();await row.getByRole('menuitem',{name:'Edit entry',exact:true}).click();return row}
  let row=await open('Kitchen note')
  await expect(row.getByLabel('Entry name')).toBeFocused()
  await expect(row.getByLabel('Entry text')).toHaveValue(fullText)
  const draft='\ufeff  const 家 = "🦊";\r\n\t<script>inert()</script>\n  '
  await row.getByLabel('Entry text').evaluate((node,text)=>{
    const area=node as HTMLTextAreaElement;area.select();const data=new DataTransfer();data.setData('text/plain',text);area.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))
  },draft)
  await row.getByLabel('Entry name').fill('Shared code.md')
  expect(data.edits).toEqual([])
  await row.getByRole('button',{name:'Save entry',exact:true}).click()
  row=page.getByRole('article',{name:'Text: Shared code.md'})
  await expect(row.getByLabel('Entry text')).toHaveCount(0)
  expect(data.edits).toHaveLength(1);expect(data.edits[0].text).toBe(draft)
  await row.getByRole('button',{name:'Copy text',exact:true}).click()
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(draft)
  await expect(page.getByRole('textbox',{name:'Text to share'})).toHaveValue('Composer draft stays here')
  expect(data.posted).toEqual([]);expect(data.acknowledgements).toEqual([])
  await page.getByRole('button',{name:'Dismiss notification'}).click()
  row=await open('Shared code.md');await row.getByLabel('Entry text').fill('Discard this change');await row.getByRole('button',{name:'Cancel editing'}).click();expect(data.edits).toHaveLength(1)
  row=await open('Shared code.md');await row.getByLabel('Entry text').fill('Unsaved local draft 🦊')
  const remoteVersion='2099-01-01T00:00:00Z';data.replace('text-one',{updatedAt:remoteVersion,name:'Shared code.md'});data.bodies.set('text-one','Remote household edit')
  await page.getByRole('button',{name:'Refresh feed'}).click();await expect(row.getByLabel('Entry text')).toHaveValue('Unsaved local draft 🦊')
  await row.getByRole('button',{name:'Save entry',exact:true}).click()
  await expect(row.getByRole('alert')).toContainText('Your draft is kept')
  await expect(row.getByLabel('Entry text')).toHaveValue('Unsaved local draft 🦊')
  await page.screenshot({animations:'disabled',path:'test-results/zing-entry-conflict-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844});await row.scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:'test-results/zing-entry-conflict-phone.png',fullPage:false})
  await row.getByRole('button',{name:'Reload latest entry (replace draft)'}).click()
  await expect(row.getByLabel('Entry text')).toHaveValue('Remote household edit')
  await row.getByLabel('Entry text').fill('Resolved explicitly');await row.getByRole('button',{name:'Save entry',exact:true}).click()
  await expect(row.getByLabel('Entry text')).toHaveCount(0)
  expect(data.edits.at(-1)?.expectedUpdatedAt).toBe(remoteVersion)
  expect(data.posted).toEqual([])
})

test('text exports download exact TXT and MD bytes and textual files retain Copy and filename wrapping',async({page,context})=>{
  const data=await fixture(page);await context.grantPermissions(['clipboard-read','clipboard-write']);await connect(page)
  const row=page.getByRole('article',{name:'Text: Kitchen note'})
  for(const format of ['txt','md']){
    await row.getByRole('button',{name:'More actions for Kitchen note'}).click()
    const [download]=await Promise.all([page.waitForEvent('download'),row.getByRole('menuitem',{name:`Download .${format}`,exact:true}).click()])
    expect(download.suggestedFilename()).toBe(`Kitchen note.${format}`)
    const stream=await download.createReadStream();const chunks:Buffer[]=[];for await(const bytes of stream)chunks.push(bytes)
    expect(Buffer.concat(chunks).toString()).toBe(fullText)
  }
  const name='household-shared-unbroken-code-file-'.repeat(5)+'.ts';const now=new Date().toISOString()
  data.add({id:'code-file',kind:'file',name,size:Buffer.byteLength(fullText),createdAt:now,updatedAt:now,status:'ready',preview:'',pinned:false,sourceDevice:'Mac'})
  await page.getByRole('button',{name:'Refresh feed'}).click();const file=page.getByRole('article',{name:`File: ${name}`})
  await file.getByRole('button',{name:'Prepare copy',exact:true}).click();await file.getByRole('button',{name:'Copy text',exact:true}).click()
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(fullText)
  await expect(file.getByRole('button',{name:'Download',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'Dismiss notification'}).click()
  for(const width of [320,360,390,412]){
    await page.setViewportSize({width,height:844});await file.scrollIntoViewIfNeeded()
    expect(await file.locator('.file-name').evaluate(node=>node.scrollHeight<=node.clientHeight)).toBe(true)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await uncovered(file.getByRole('button',{name:'Download',exact:true}))
  }
  await page.screenshot({animations:'disabled',path:'test-results/zing-text-file-phone.png',fullPage:false})
})

test('native notification click is consumed while the app remains focused',async({page})=>{
  await nativeFixture(page);await page.goto('/');await expect(page.getByRole('button',{name:'Copy text',exact:true})).toBeEnabled()
  await page.evaluate(()=>(window as unknown as {setNativeTarget:(target:{baseUrl:string;itemId:string})=>void}).setNativeTarget({baseUrl:'https://household.example',itemId:'native-note'}))
  await expect(page.locator('#share-native-note')).toHaveClass('arrival-highlight',{timeout:8000})
  const calls=await page.evaluate(()=>(window as unknown as {nativeCalls:{command:string}[]}).nativeCalls)
  expect(calls.filter(call=>call.command==='native_take_arrival_target').length).toBeGreaterThan(1)
  expect(calls.filter(call=>['native_copy_text','native_download'].includes(call.command))).toEqual([])
})

test('text-file metadata is only a candidate until validated preparation succeeds, and files keep ordinary Download',async({page,context})=>{
  const data=await fixture(page);await context.grantPermissions(['clipboard-read','clipboard-write'])
  const now=new Date().toISOString();const base={kind:'file',size:20,createdAt:now,updatedAt:now,status:'ready',preview:'',pinned:false,sourceDevice:'Phone'}
  data.add({...base,id:'candidate-file',name:'code.md',mimeType:'application/octet-stream'})
  data.add({...base,id:'charset-file',name:'wrong-charset.md',mimeType:'text/plain; charset=utf-16'})
  data.add({...base,id:'large-candidate',name:'large-code.py',mimeType:'text/plain',size:8*1024**2+1})
  let preparations=0
  const exact='\ufeff  const 家 = "🦊";\r\n\t\n  '
  await page.route('**/api/items/candidate-file/text',route=>{
    preparations++
    if(preparations===1)return route.fulfill({status:415,contentType:'application/json',body:'{"error":{"code":"not_text","message":"This file is not validated UTF-8 text; use Download."}}'})
    if(preparations===2)return route.fulfill({status:200,contentType:'text/plain',body:Buffer.from([0xff,0xfe])})
    return route.fulfill({status:200,contentType:'text/plain; charset=utf-8',body:exact})
  })
  await page.setViewportSize({width:390,height:844});await connect(page)
  const row=page.getByRole('article',{name:'File: code.md'});await row.scrollIntoViewIfNeeded()
  expect(preparations).toBe(0)
  const prepare=row.getByRole('button',{name:'Prepare copy',exact:true})
  await expect(prepare).toHaveText('Prepare copy');await expect(row.getByRole('button',{name:'Copy text',exact:true})).toHaveCount(0)
  await prepare.click();await expect(row.getByRole('alert')).toContainText('use Download')
  await expect(prepare).toBeEnabled();await expect(row.getByRole('button',{name:'Copy text',exact:true})).toHaveCount(0)
  await expect(row.getByRole('button',{name:'Download',exact:true})).toBeEnabled()
  await row.scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:'test-results/zing-text-candidate-recovery-phone.png',fullPage:false})
  await prepare.click();await expect(row.getByRole('alert')).toBeVisible();await expect(prepare).toBeEnabled()
  await expect(row.getByRole('button',{name:'Copy text',exact:true})).toHaveCount(0)
  await prepare.click();await row.getByRole('button',{name:'Copy text',exact:true}).click()
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(exact)
  for(const name of ['wrong-charset.md','large-code.py']){
    const file=page.getByRole('article',{name:`File: ${name}`})
    await expect(file.getByRole('button',{name:/Prepare copy|Copy text/})).toHaveCount(0)
    await expect(file.getByRole('button',{name:'Download',exact:true})).toBeEnabled()
  }
  await row.getByRole('button',{name:'More actions for code.md',exact:true}).click()
  await expect(row.getByRole('menuitem',{name:/Download \.(txt|md)/})).toHaveCount(0)
  await expect(row.getByRole('menuitem',{name:'Rename entry',exact:true})).toBeEnabled()
})


// These are real browser layout/focus checks; the API and keyboard occlusion remain fixtures.
test('content kind sits beside Recent shares with full-width phone search and no composing feed tabs',async({page})=>{
  const data=await fixture(page);await connect(page)
  const identity=data.registrations[0].id
  const tabs=page.getByRole('navigation',{name:'Mobile feed filters',includeHidden:true})
  const kind=page.getByRole('combobox',{name:'Content type'})
  const composer=page.getByRole('textbox',{name:'Text to share'})
  const search=page.getByRole('searchbox',{name:'Search names and text previews'})
  for(const width of [320,360,412]){
    await page.setViewportSize({width,height:839})
    await expect(tabs.getByRole('button')).toHaveCount(3)
    await expect(tabs.getByRole('button',{name:'Text',exact:true})).toHaveCount(0)
    await expect(tabs.getByRole('button',{name:'Files',exact:true})).toHaveCount(0)
    await kind.selectOption('text');await expect(page.getByRole('article')).toHaveCount(1)
    await kind.selectOption('file');await expect(page.getByRole('article',{name:'File: weekend.zip'})).toBeVisible()
    const heading=(await page.locator('.feed-title').boundingBox())!,filter=(await kind.boundingBox())!,searchBox=(await page.locator('.search-field').boundingBox())!,feed=(await page.locator('.feed').boundingBox())!
    expect(filter.x).toBeGreaterThanOrEqual(heading.x+heading.width)
    expect(filter.height).toBeGreaterThanOrEqual(44)
    expect(searchBox.y).toBeGreaterThanOrEqual(Math.max(heading.y+heading.height,filter.y+filter.height))
    expect(searchBox.x).toBeCloseTo(feed.x,0);expect(searchBox.width).toBeCloseTo(feed.width,0)
    expect(await kind.evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16)
    await page.screenshot({animations:'disabled',path:`test-results/zing-feed-controls-${width}.png`,fullPage:false})
    await composer.fill('Keep the same draft and selection')
    await expect(tabs).toBeHidden();expect(await tabs.evaluate(node=>node.contains(document.activeElement))).toBe(false)
    await expect(page.getByRole('button',{name:'Add files',exact:true})).toBeVisible()
    await expect(page.getByRole('button',{name:'Share text',exact:true})).toBeEnabled()
    await page.getByRole('button',{name:'More actions for sharing',exact:true}).click()
    await uncovered(page.getByRole('menuitem',{name:'Upload text file',exact:true}))
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button',{name:'More actions for sharing',exact:true})).toBeFocused()
    await expect(tabs).toBeHidden()
    await page.getByRole('button',{name:'Done editing',exact:true}).click()
    await expect(tabs.getByRole('button',{name:'All shares',exact:true})).toBeFocused()
    await expect(composer).toHaveValue('Keep the same draft and selection');await expect(kind).toHaveValue('file')
    await search.fill('weekend');await expect(tabs).toBeHidden()
    await page.getByRole('button',{name:'Done editing',exact:true}).click()
    await expect(search).toHaveValue('weekend');await expect(kind).toHaveValue('file')
    await search.fill('');await page.keyboard.press('Escape');await kind.selectOption('all')
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  }
  expect(data.registrations.at(-1)?.id).toBe(identity)
})

test('content kind intersects pinned and For you scopes across search and older pages',async({page})=>{
  const data=await fixture(page,true)
  data.replace('file-one',{pinned:true})
  const now=new Date().toISOString()
  const older=[
    {id:'older-text',kind:'text',name:'Older recipe',size:12,createdAt:now,updatedAt:now,status:'ready',preview:'Older recipe',pinned:true,sourceDevice:'Kitchen Mac'},
    {id:'older-file',kind:'file',name:'Older recipe.zip',size:12,createdAt:now,updatedAt:now,status:'ready',preview:'',pinned:false,sourceDevice:'Kitchen Mac'},
  ]
  data.setOlder(older);data.setAddressed(['text-one','file-one','older-text','older-file'])
  await connect(page)
  const kind=page.getByRole('combobox',{name:'Content type'})
  const scope=page.getByRole('navigation',{name:'Feed filters',exact:true})
  await kind.selectOption('text');await scope.getByRole('button',{name:'Pinned',exact:true}).click()
  await expect(page.getByRole('article')).toHaveCount(0)
  await expect(page.getByRole('heading',{name:'No text shares in this view'})).toBeVisible()
  await page.getByRole('button',{name:'Load older items'}).click()
  await expect(page.getByRole('article',{name:'Text: Older recipe'})).toBeVisible()
  await kind.selectOption('file');await expect(page.getByRole('article')).toHaveCount(2)
  await expect(page.getByRole('article',{name:'File: Older recipe.zip'})).toHaveCount(0)
  await scope.getByRole('button',{name:'For you',exact:true}).click()
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.getByRole('searchbox').fill('recipe')
  await expect(page.getByRole('article')).toHaveCount(0)
  await page.getByRole('button',{name:'Load older items'}).click()
  await expect(page.getByRole('article',{name:'File: Older recipe.zip'})).toBeVisible()
  const source=data.registrations[0].id
  expect(data.lists.some(query=>{const params=new URLSearchParams(query);return params.get('q')==='recipe'&&params.get('forDevice')===source&&params.get('before')==='older-fixture'})).toBe(true)
  await kind.selectOption('text');await expect(page.getByRole('article',{name:'Text: Older recipe'})).toBeVisible()
  await page.screenshot({animations:'disabled',path:'test-results/zing-kind-scope-desktop.png',fullPage:false})
})


test('Navy nautical theme keeps shared branding, readable placeholders/statuses and visible focus',async({page,context})=>{
  const data=await fixture(page);const now=new Date().toISOString()
  data.add({id:'incoming',kind:'file',name:'Incoming.zip',size:100,createdAt:now,updatedAt:now,status:'uploading',preview:'',pinned:false,sourceDevice:'Kitchen Mac'})
  await context.grantPermissions(['clipboard-read','clipboard-write'])
  await connect(page)
  const signal=page.locator('.brand-signal:visible');await expect(signal).toHaveCount(1);await expect(signal).toHaveAttribute('aria-hidden','true')
  expect(await signal.evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(180, 35, 54)')
  const colors=await page.evaluate(()=>{
    const root=getComputedStyle(document.documentElement)
    const css=(selector:string,pseudo?:string)=>getComputedStyle(document.querySelector(selector)!,pseudo)
    return {canvas:root.backgroundColor,ink:root.color,placeholder:css('.composer textarea','::placeholder').color,surface:css('.composer').backgroundColor,uploading:css('.item-status.status-uploading').color,download:css('.card-actions button[aria-label="Download"]').color,copy:css('.card-actions .action-button').color,metadata:css('.row-metadata').color,boundary:css('.composer').borderColor,searchBoundary:css('.search-field').borderColor}
  })
  expect(colors).toEqual({canvas:'rgb(247, 248, 250)',ink:'rgb(24, 51, 74)',placeholder:'rgb(94, 107, 120)',surface:'rgb(255, 255, 255)',uploading:'rgb(36, 76, 106)',download:'rgb(36, 76, 106)',copy:'rgb(36, 76, 106)',metadata:'rgb(94, 107, 120)',boundary:'rgb(120, 135, 149)',searchBoundary:'rgb(120, 135, 149)'})
  const luminance=(color:string)=>color.match(/\d+/g)!.slice(0,3).map(n=>Number(n)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,index)=>sum+c*[.2126,.7152,.0722][index],0)
  const contrast=(a:string,b:string)=>{const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05)}
  for(const [foreground,background] of [[colors.ink,colors.canvas],[colors.placeholder,colors.surface],[colors.metadata,colors.canvas],[colors.uploading,colors.canvas],[colors.download,colors.canvas],[colors.copy,colors.canvas]])expect(contrast(foreground,background)).toBeGreaterThanOrEqual(4.5)
  for(const boundary of [colors.boundary,colors.searchBoundary])expect(contrast(boundary,colors.surface)).toBeGreaterThanOrEqual(3)
  const scope=page.getByRole('navigation',{name:'Feed filters',exact:true}),pinned=scope.getByRole('button',{name:'Pinned',exact:true})
  await expect(pinned).not.toHaveClass(/selected/);await expect(pinned.locator('.nav-count')).toHaveCount(0)
  await pinned.hover();await expect(pinned).toHaveCSS('background-color','rgb(234, 240, 245)')
  const navColors=await pinned.evaluate(node=>({foreground:getComputedStyle(node).color,background:getComputedStyle(node).backgroundColor}))
  expect(contrast(navColors.foreground,navColors.background)).toBeGreaterThanOrEqual(4.5)
  await expect(scope.getByRole('button',{name:'All shares',exact:true})).toHaveCSS('background-color','rgb(234, 240, 245)')
  await page.getByRole('button',{name:'Copy text',exact:true}).click()
  const toast=page.locator('.toast'),dismiss=toast.getByRole('button',{name:'Dismiss notification'})
  await expect(toast).toHaveText('Full text copied.')
  await page.getByRole('article').last().getByRole('button').last().focus();await page.keyboard.press('Tab')
  await expect(dismiss).toBeFocused();expect(await dismiss.evaluate(node=>node.matches(':focus-visible'))).toBe(true)
  const toastFocus=await dismiss.evaluate(node=>{const css=getComputedStyle(node);return {color:css.outlineColor,width:css.outlineWidth,offset:css.outlineOffset,style:css.outlineStyle,background:getComputedStyle(node.parentElement!).backgroundColor}})
  expect(toastFocus).toEqual({color:colors.surface,width:'3px',offset:'3px',style:'solid',background:colors.ink})
  expect(contrast(toastFocus.color,toastFocus.background)).toBeGreaterThanOrEqual(3)
  const dismissBox=(await dismiss.boundingBox())!;expect(dismissBox.width).toBeGreaterThanOrEqual(44);expect(dismissBox.height).toBeGreaterThanOrEqual(44)
  await uncovered(dismiss);await page.keyboard.press('Enter');await expect(toast).toHaveCount(0)
  await page.getByRole('searchbox').focus()
  expect(await page.locator('.search-field').evaluate(node=>{const css=getComputedStyle(node);return [css.outlineWidth,css.outlineColor]})).toEqual(['3px','rgb(36, 76, 106)'])
  await page.getByRole('combobox',{name:'Content type'}).focus()
  expect(await page.getByRole('combobox',{name:'Content type'}).evaluate(node=>getComputedStyle(node).outlineWidth)).toBe('3px')
  expect(await page.locator('.brand img').evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const svg=await (await page.request.get('/icon.svg')).text();expect(svg).toContain('M6 6.5H18L6 17.5H18');expect(svg).toContain('#244c6a')
  const manifest=await(await page.request.get('/manifest.webmanifest')).json();expect(manifest).toMatchObject({theme_color:'#f7f8fa',background_color:'#f7f8fa'})
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content','#f7f8fa')
  await page.screenshot({animations:'disabled',path:'test-results/zing-navy-desktop.png',fullPage:true})
  await page.setViewportSize({width:360,height:839});await page.getByRole('textbox',{name:'Text to share'}).focus()
  expect(await page.locator('.composer').evaluate(node=>getComputedStyle(node).outlineWidth)).toBe('3px')
  await page.getByRole('button',{name:'Done editing',exact:true}).click()
  await expect(page.locator('.brand-signal:visible')).toHaveCount(1)
  expect(await page.getByRole('navigation',{name:'Mobile feed filters',includeHidden:true}).getByRole('button',{name:'All shares',exact:true}).evaluate(node=>getComputedStyle(node).color)).toBe('rgb(24, 51, 74)')
  await page.screenshot({animations:'disabled',path:'test-results/zing-navy-phone.png',fullPage:false})
})
