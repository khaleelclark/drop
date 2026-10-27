import {test,expect,type Page,type Locator} from '@playwright/test'
import {mkdirSync,writeFileSync} from 'node:fs'
import type {Item} from '../src/types'
const out='release-evidence/inbox-drag',now='2026-10-27T12:00:00Z',device='1'.repeat(32)
const row=(id:string):Item=>({id,kind:'file',name:id+'.bin',size:20,createdAt:now,updatedAt:now,status:'ready',pinned:false,sourceDevice:'Kitchen Mac'})
async function setup(page:Page,phone=false){
  await page.setViewportSize(phone?{width:390,height:844}:{width:1440,height:900})
  await page.addInitScript(({phone,device})=>{
    localStorage.setItem('household.device','Household laptop')
    const state={refresh:()=>{},drop:(_event:unknown)=>{},uploads:[] as unknown[],folders:[] as string[],nativeDrops:[] as unknown[],subscriptions:0,eventSubscriptions:0,copied:'',arrivalEnabled:false}
    Object.assign(window,{inboxFixture:state})
    const transfers=[{id:'saved',name:'Queued archive.zip',size:100,lastModified:1,kind:'file' as const,sourceDevice:'Household laptop',destination:location.origin,state:'paused' as const,confirmed:0,sent:0}]
    window.householdPlatform={kind:phone?'native':'browser',baseURL:location.origin,defaultDeviceName:'Household laptop',...(phone?{deviceIdentity:{id:device,platform:'android' as const},configureConnection:async()=>{},disconnect:async()=>{},getArrivalSettings:async()=>({enabled:state.arrivalEnabled,permission:'denied' as const,mode:'periodic' as const}),setArrivalEnabled:async()=>{throw new Error('Notifications are blocked. Allow them in Android Settings, then try again.')},onFileDrop:async receive=>{state.drop=receive as typeof state.drop;return()=>{}},enqueuePaths:async(paths,targets)=>{state.nativeDrops.push({paths,targets})}}:{}),request:(...args)=>fetch(...args),copyText:async text=>{state.copied=text},download:async()=>{},openEvents:(refresh,status)=>{state.refresh=refresh;state.eventSubscriptions++;status(true);return()=>{state.eventSubscriptions--}},transfers:{getSnapshot:()=>transfers,subscribe:()=>{state.subscriptions++;return()=>{state.subscriptions--}},enqueue:files=>{state.uploads.push(files.map(file=>file.name))},enqueueFolder:folder=>{state.folders.push(folder.name);return'stub-folder'},pause:async()=>{},resume:()=>{},cancel:async()=>{},reattach:async()=>{},clearCompleted:()=>{}}}
  },{phone,device})
  const text='  exact full text\r\n🦊\tend  '
  const items=[{...row('note'),kind:'text' as const,name:'Kitchen note',preview:'exact full text',size:new TextEncoder().encode(text).length},row('archive'),row('photo'),{...row('incoming'),status:'uploading' as const},{...row('failed'),status:'failed' as const},{...row('deleted'),deletedAt:now}]
  const calls:{method:string;path:string;body:unknown}[]=[],errors:string[]=[],pending:{kind:string;release:()=>void}[]=[]
  let holdWrites=false,holdLists=false,holdMetadata=false,failId='',failName=false,failRetention=false,retention:number|null=30,version=0
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method(),body=req.postData()?req.postDataJSON():undefined
    const json=(value:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)})
    const wait=async(kind:string)=>{if(kind==='write'?holdWrites:kind==='metadata'?holdMetadata:holdLists)await new Promise<void>(release=>pending.push({kind,release}))}
    if(path==='/api/items'||path==='/api/trash'){
      const rows=structuredClone(items.filter(item=>Boolean(item.deletedAt)===(path==='/api/trash')&&(!url.searchParams.has('forDevice')||['note','archive'].includes(item.id))&&item.name.toLowerCase().includes((url.searchParams.get('q')||'').toLowerCase())))
      await wait('list');return json({items:rows,nextCursor:null})
    }
    const single=path.match(/^\/api\/items\/([^/]+)(?:\/(text|trash|restore|purge))?$/)
    if(single&&single[1]!=='actions'){
      const item=items.find(item=>item.id===single[1]);if(!item)return json({error:{message:'Missing item'}},404)
      if(method==='GET'){if(item.deletedAt)return json({error:{message:'Trashed'}},404);const snapshot=structuredClone(item);if(!single[2])await wait('metadata');return single[2]==='text'?route.fulfill({contentType:'text/plain',body:text}):json({item:snapshot})}
      calls.push({method,path,body});await wait('write')
      if(item.id===failId)return json({error:{message:'This share could not be changed.'}},409)
      if(method==='PATCH'){Object.assign(item,body,{updatedAt:new Date(Date.parse(now)+ ++version*1000).toISOString()});return json({item})}
      if(single[2]==='trash'){item.deletedAt=now;return route.fulfill({status:204})}
      if(single[2]==='restore'){delete item.deletedAt;return json({item})}
    }
    if(path==='/api/items/actions'){
      calls.push({method,path,body});await wait('write')
      return json({results:body.ids.map((id:string)=>{const item=items.find(item=>item.id===id)!;if(id===failId)return{id,ok:false,error:{status:409,code:'busy',message:'This share could not be changed.'}};item.deletedAt=body.action==='trash'?now:undefined;return{id,ok:true}})})
    }
    if(path==='/api/devices/register'){if(!body.preserveExisting){calls.push({method,path,body});await wait('write');if(failName)return json({error:{message:'Name was not saved. Try again.'}},503)}return json({device:{...body,createdAt:now}})}
    if(path==='/api/devices')return json({devices:[{id:device,label:'Household laptop',platform:'android',createdAt:now},{id:'2'.repeat(32),label:'Kitchen Mac',platform:'macos',createdAt:now}]})
    if(path.includes('/notifications'))return json({notifications:[],nextCursor:'0',ackCursor:'0',hasMore:false})
    if(path==='/api/storage')return json({usedBytes:256*1024**2,freeBytes:2*1024**4,maxFileBytes:20*1024**3,maxTextBytes:32*1024**2,maxStorageBytes:null})
    if(path==='/api/settings/trash'){if(method==='PATCH'){calls.push({method,path,body});await wait('write');if(failRetention)return json({error:{message:'Storage setting was not saved.'}},503);retention=body.retentionDays}return json({retentionDays:retention})}
    if(path==='/api/session')return route.fulfill({status:204})
    return json({error:{message:'Unexpected fixture route '+path}},404)
  })
  await page.goto('/');await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled();await expect(page.locator('.share-entry')).toHaveCount(5);await settled(page)
  const nav=page.getByRole('navigation',{name:phone?'Mobile feed filters':'Feed filters',exact:true})
  const tab=async(name:string)=>{await nav.getByRole('button',{name,exact:true}).click();await settled(page)}
  const release=()=>{for(const row of pending.splice(0))row.release()}
  return{items,calls,errors,pending,nav,tab,text,refresh:()=>page.evaluate(()=>(window as any).inboxFixture.refresh()),holdWrites:(value=true)=>{holdWrites=value},holdLists:(value=true)=>{holdLists=value},holdMetadata:(value=true)=>{holdMetadata=value},release,fail:(id:string)=>{failId=id},failName:(value=true)=>{failName=value},failRetention:(value=true)=>{failRetention=value}}
}
async function settled(page:Page){await expect(page.locator('.refresh-button')).toBeEnabled()}
async function mouseDrag(page:Page,handle:Locator,target:Locator,release=true){
  await handle.scrollIntoViewIfNeeded();const a=(await handle.boundingBox())!,b=(await target.boundingBox())!
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8})
  if(release)await page.mouse.up()
}
async function screenshot(page:Page,name:string){mkdirSync(out,{recursive:true});await page.screenshot({path:`${out}/${name}.png`})}
async function save(name:string,data:unknown){writeFileSync(`${out}/${name}.json`,JSON.stringify(data,null,2)+'\n')}
const handle=(page:Page,id:string)=>page.locator(`#share-${id} .share-drag-handle`)
const ids=(page:Page)=>page.locator('.share-entry').evaluateAll(rows=>rows.map(row=>row.id))
async function preserve(page:Page){await page.getByRole('textbox',{name:'Text to share'}).fill('  Keep draft\n\tand queue.');await page.keyboard.press('Escape');await page.evaluate(()=>{document.querySelector('.composer')!.setAttribute('data-continuity','composer');document.querySelector('.transfer-panel')!.setAttribute('data-continuity','queue')})}
async function continuity(page:Page){await expect(page.getByRole('textbox',{name:'Text to share'})).toHaveValue('  Keep draft\n\tand queue.');await expect(page.locator('.composer')).toHaveAttribute('data-continuity','composer');await expect(page.locator('.transfer-panel')).toHaveAttribute('data-continuity','queue');expect(await page.evaluate(()=>{const s=(window as any).inboxFixture;return[s.subscriptions,s.eventSubscriptions]})).toEqual([1,1])}

test('desktop captured drops confirm pin/trash, reconcile retained scopes and preserve browser intake',async({page})=>{
  const data=await setup(page);await preserve(page)
  await data.tab('For you');await data.tab('Recently Deleted');await data.tab('All shares')
  await page.getByRole('searchbox').fill('archive');await expect(page.locator('.share-entry')).toHaveCount(1);await settled(page);await page.getByRole('searchbox').fill('');await expect(page.locator('.share-entry')).toHaveCount(5);await settled(page)
  const pin=data.nav.locator('[data-share-drop="pinned"]'),trash=data.nav.locator('[data-share-drop="trash"]')
  const bounds=(await handle(page,'archive').boundingBox())!;expect(bounds.width).toBeGreaterThanOrEqual(44);expect(bounds.height).toBeGreaterThanOrEqual(44)
  await mouseDrag(page,handle(page,'archive'),pin,false);await expect(pin).toHaveAttribute('data-drop-active','true');await expect(pin.locator('.drop-count')).toHaveText('1');await expect(page.locator('.drop-overlay')).toHaveCount(0);await screenshot(page,'desktop-drag');data.holdWrites();await page.mouse.up()
  await expect.poll(()=>data.calls.length).toBe(1);expect(data.calls[0]).toMatchObject({method:'PATCH',path:'/api/items/archive',body:{pinned:true}});await expect(page.locator('#share-archive article')).not.toHaveClass(/is-pinned/);await expect(handle(page,'archive')).toBeDisabled()
  data.holdWrites(false);data.release();await expect(page.locator('#share-archive article')).toHaveClass(/is-pinned/);await settled(page)
  await mouseDrag(page,handle(page,'archive'),pin);await expect.poll(()=>data.calls.length).toBe(2);expect(data.calls[1].body).toEqual({pinned:true});await settled(page)
  data.holdLists();await mouseDrag(page,handle(page,'archive'),trash);await expect(page.locator('#share-archive')).toHaveCount(0);expect(data.calls[2]).toMatchObject({method:'POST',path:'/api/items/archive/trash'})
  for(const name of ['For you','All shares','Pinned']){await data.nav.getByRole('button',{name,exact:true}).click();await expect(page.locator('#share-archive')).toHaveCount(0)}
  await data.nav.getByRole('button',{name:'All shares',exact:true}).click();await page.getByRole('searchbox').fill('archive');await expect(page.locator('#share-archive')).toHaveCount(0)
  data.holdLists(false);data.release();await settled(page);await page.getByRole('searchbox').fill('');await expect(page.locator('.share-entry')).toHaveCount(4);await settled(page)
  await data.tab('Recently Deleted');await expect(page.locator('#share-archive')).toBeVisible();await page.locator('#share-archive').getByRole('button',{name:'Restore',exact:true}).click();await expect(page.locator('#share-archive')).toHaveCount(0);await settled(page);await data.tab('All shares');await expect(page.locator('#share-archive article')).toHaveClass(/is-pinned/)
  await page.evaluate(()=>{const data=new DataTransfer();data.items.add(new File(['test'],'external.bin'));window.dispatchEvent(new DragEvent('dragenter',{dataTransfer:data,cancelable:true}));window.dispatchEvent(new DragEvent('drop',{dataTransfer:data,cancelable:true}))})
  await expect.poll(()=>page.evaluate(()=>(window as any).inboxFixture.uploads)).toEqual([['external.bin']]);await continuity(page);expect(data.errors).toEqual([])
  await save('desktop-result',{calls:data.calls,errors:data.errors,confirmedBeforeUpdate:true,retainedScopesReconciled:true,continuity:true,browserExternalFileIntake:true})
})

test('stale, unfinished, outside and changed-scope gestures never mutate or substitute selection',async({page})=>{
  const data=await setup(page),pin=data.nav.locator('[data-share-drop="pinned"]')
  await expect(handle(page,'incoming')).toBeDisabled();await expect(handle(page,'failed')).toBeDisabled()
  for(const cancel of ['Escape','blur','pointercancel','outside','scope','stale-local','stale-server']){
    await mouseDrag(page,handle(page,'archive'),pin,false)
    if(cancel==='Escape')await page.keyboard.press('Escape')
    if(cancel==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')))
    if(cancel==='pointercancel')await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1})))
    if(cancel==='outside')await page.mouse.move(1000,20)
    if(cancel==='scope')await page.evaluate(()=>{const nav=document.querySelector('nav[aria-label="Feed filters"]')!;(nav.querySelector('button') as HTMLButtonElement).click()});
    if(cancel==='scope'){await page.getByRole('combobox',{name:'Content type'}).selectOption('file')}
    if(cancel.startsWith('stale')){data.items.find(item=>item.id==='archive')!.updatedAt=new Date(Date.parse(now)+(cancel==='stale-local'?1000:2000)).toISOString();if(cancel==='stale-local'){await data.refresh();await settled(page)}}
    await page.mouse.up();await expect(page.locator('.share-drag-status')).toHaveCount(0);expect(data.calls).toHaveLength(0)
    if(cancel==='stale-server')await expect(page.getByRole('alert')).toContainText('No move was sent')
    await page.getByRole('combobox',{name:'Content type'}).selectOption('all');await data.refresh();await settled(page)
  }
  await page.getByRole('button',{name:'Select items',exact:true}).click();await page.getByRole('checkbox',{name:'Select archive.bin'}).check();await page.getByRole('checkbox',{name:'Select failed.bin'}).check();await mouseDrag(page,handle(page,'archive'),pin);expect(data.calls).toHaveLength(0);await expect(page.getByRole('alert')).toContainText('not ready')
  await save('cancellation-result',{mutations:data.calls,errors:data.errors,checked:['Escape','blur','pointercancel','outside','filter-scope','stale-local','stale-server','failed-selected','unfinished-handle']});expect(data.errors).toEqual([])
})

test('bulk drops keep failed rows selected and locks cover menu pins and edits',async({page})=>{
  const data=await setup(page),trash=data.nav.locator('[data-share-drop="trash"]'),pin=data.nav.locator('[data-share-drop="pinned"]')
  await page.getByRole('button',{name:'Select items',exact:true}).click();for(const name of ['archive.bin','photo.bin'])await page.getByRole('checkbox',{name:'Select '+name}).check()
  data.fail('photo');await mouseDrag(page,handle(page,'archive'),trash);await expect(page.locator('#share-archive')).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('photo.bin');await expect(page.getByRole('checkbox',{name:'Select photo.bin'})).toBeChecked();expect(data.calls[0].body).toEqual({action:'trash',ids:['archive','photo']});await settled(page)
  data.fail('');await mouseDrag(page,handle(page,'photo'),pin);await expect(page.locator('#share-photo article')).toHaveClass(/is-pinned/);expect(data.calls[1]).toMatchObject({path:'/api/items/photo',body:{pinned:true}});await settled(page);await page.getByRole('button',{name:'Cancel selection'}).click()
  data.holdWrites();await page.locator('#share-photo').getByRole('button',{name:/More actions for/}).click();await page.getByRole('menuitem',{name:'Unpin item',exact:true}).click();await expect.poll(()=>data.pending.length).toBe(1);await expect(handle(page,'note')).toBeDisabled();await expect(data.nav.getByRole('button',{name:'Recently Deleted',exact:true})).toBeDisabled();expect(data.calls).toHaveLength(3);data.holdWrites(false);data.release();await settled(page);await expect(handle(page,'note')).toBeEnabled()
  await page.locator('#share-note').getByRole('button',{name:/More actions for/}).click();await page.getByRole('menuitem',{name:'Edit entry',exact:true}).click();await page.getByRole('textbox',{name:'Entry name',exact:true}).fill('Edited note');data.holdWrites();await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect.poll(()=>data.pending.length).toBe(1);await expect(handle(page,'photo')).toBeDisabled();data.holdWrites(false);data.release();await expect(page.getByRole('form',{name:'Edit Kitchen note'})).toHaveCount(0);await settled(page);expect(data.calls).toHaveLength(4)
  expect(data.errors).toEqual([]);await save('bulk-result',{calls:data.calls,failedSelectionKept:true,retryOnlyFailed:true,sharedPinEditLock:true,errors:data.errors})
})

for(const phone of [false,true])test(`friendly settings retain failed drafts, focus, permissions and scrolling (${phone?'phone native adapter':'desktop'})`,async({page})=>{
  const data=await setup(page,phone);await preserve(page);if(phone)await page.emulateMedia({colorScheme:'dark'})
  await page.locator('.connection-badge').focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Connection settings'});await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Close connection settings'})).toBeFocused()
  await expect(dialog.locator('.connection-advanced')).not.toHaveAttribute('open','');await expect(dialog.getByLabel('Household server')).not.toBeVisible();await expect(dialog.getByText('Disconnect does not revoke Tailscale access.',{exact:true})).toHaveCount(0)
  for(const name of ['Device & connection','Appearance','Arrival notifications','Storage','Recently Deleted'])await expect(dialog.getByText(name,{exact:true})).toBeVisible()
  await expect(dialog).toContainText('sent to this device or to Everyone');await expect(dialog).toContainText('sender and a text preview or filename')
  await screenshot(page,phone?'phone-settings-top':'desktop-settings-top')
  data.failName();await dialog.getByLabel('This device’s name').fill('My unsaved name');data.holdWrites();await dialog.getByRole('button',{name:'Save device name',exact:true}).click();await expect(dialog.getByRole('button',{name:'Close connection settings'})).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeVisible();data.holdWrites(false);data.release();await expect(dialog.getByRole('alert')).toContainText('Name was not saved');await expect(dialog.getByLabel('This device’s name')).toHaveValue('My unsaved name');expect(data.calls.filter(call=>call.path==='/api/devices/register')).toHaveLength(1)
  if(phone){await dialog.getByRole('button',{name:'Enable notifications',exact:true}).click();await expect(dialog.getByRole('alert').filter({hasText:'Notifications are blocked'})).toContainText('Android Settings')}
  const retention=dialog.getByLabel('Automatically delete after');await retention.scrollIntoViewIfNeeded();await retention.selectOption('custom');await dialog.getByRole('spinbutton',{name:'Custom days'}).fill('45');data.failRetention();data.holdWrites();await dialog.getByRole('button',{name:'Save retention',exact:true}).click();await expect(dialog.getByRole('button',{name:'Close connection settings'})).toBeDisabled();await expect(dialog.getByRole('button',{name:phone?'Disconnect this app':'Disconnect this browser',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeVisible();data.holdWrites(false);data.release();await expect(dialog.getByRole('alert').filter({hasText:'Your choice is kept'})).toBeVisible();await expect(dialog.getByRole('spinbutton',{name:'Custom days'})).toHaveValue('45')
  const saveButton=dialog.getByRole('button',{name:'Save retention',exact:true});await saveButton.scrollIntoViewIfNeeded();await expect(saveButton).toBeInViewport();expect(await saveButton.evaluate(node=>{const box=node.getBoundingClientRect();return node.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2))})).toBe(true);await screenshot(page,phone?'phone-settings-retention':'desktop-settings-retention');const close=dialog.getByRole('button',{name:'Close connection settings'});await expect(close).toBeInViewport();const closeBox=(await close.boundingBox())!;expect(closeBox.width).toBeGreaterThanOrEqual(44);expect(closeBox.height).toBeGreaterThanOrEqual(44)
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);await close.focus();await page.keyboard.press('Shift+Tab');expect(await dialog.evaluate(node=>node.contains(document.activeElement))).toBe(true);await close.focus();await page.keyboard.press('Enter');await expect(page.locator('.connection-badge')).toBeFocused();await continuity(page);expect(data.errors).toEqual([])
  await save(phone?'phone-settings-result':'desktop-settings-result',{calls:data.calls,failedDraftsRetained:true,closeReachable:true,focusContainedAndRestored:true,errors:data.errors})
})

test('phone touch and pen use visible tabs and preserve native external drops',async({page})=>{
  const data=await setup(page,true);await preserve(page)
  const session=await page.context().newCDPSession(page)
  async function touch(id:string,destination:Locator,release=true){await handle(page,id).scrollIntoViewIfNeeded();const a=(await handle(page,id).boundingBox())!,b=(await destination.boundingBox())!;await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+22,y:a.y+22}]});await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});if(release)await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
  const pin=data.nav.locator('[data-share-drop="pinned"]'),trash=data.nav.locator('[data-share-drop="trash"]')
  await touch('archive',pin,false);await expect(pin).toHaveAttribute('data-drop-active','true');await screenshot(page,'phone-drag');await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(page.locator('#share-archive article')).toHaveClass(/is-pinned/);await settled(page)
  await handle(page,'photo').scrollIntoViewIfNeeded();const a=(await handle(page,'photo').boundingBox())!,b=(await trash.boundingBox())!
  await session.send('Input.dispatchMouseEvent',{type:'mousePressed',pointerType:'pen',button:'left',buttons:1,x:a.x+22,y:a.y+22});await session.send('Input.dispatchMouseEvent',{type:'mouseMoved',pointerType:'pen',button:'left',buttons:1,x:b.x+b.width/2,y:b.y+b.height/2});await expect(trash).toHaveAttribute('data-drop-active','true');await session.send('Input.dispatchMouseEvent',{type:'mouseReleased',pointerType:'pen',button:'left',buttons:0,x:b.x+b.width/2,y:b.y+b.height/2});await expect(page.locator('#share-photo')).toHaveCount(0);await settled(page)
  await page.evaluate(()=>{const state=(window as any).inboxFixture;state.drop({type:'enter'});state.drop({type:'drop',paths:['/private/Folder','/private/file.bin']})});await expect.poll(()=>page.evaluate(()=>(window as any).inboxFixture.nativeDrops)).toEqual([{paths:['/private/Folder','/private/file.bin'],targets:[]}]);await continuity(page);expect(data.errors).toEqual([])
  await save('phone-drag-result',{calls:data.calls,touchAndPen:true,nativeDropPathsPreserved:true,errors:data.errors,limit:'Chromium CDP touch and pen; injected native adapter, no installed device'})
})


test('partial multi-pin keeps failures explicit and browser folder drops keep their intake path',async({page})=>{
  const data=await setup(page),pin=data.nav.locator('[data-share-drop="pinned"]')
  await page.getByRole('button',{name:'Select items',exact:true}).click();for(const name of ['archive.bin','photo.bin'])await page.getByRole('checkbox',{name:'Select '+name}).check()
  data.fail('photo');await mouseDrag(page,handle(page,'archive'),pin);await expect(page.locator('#share-archive article')).toHaveClass(/is-pinned/);await expect(page.locator('#share-photo article')).not.toHaveClass(/is-pinned/);await expect(page.getByRole('checkbox',{name:'Select photo.bin'})).toBeChecked();await expect(page.getByRole('checkbox',{name:'Select archive.bin'})).not.toBeChecked();await expect(page.getByRole('alert')).toContainText('photo.bin');expect(data.calls.map(call=>call.body)).toEqual([{pinned:true},{pinned:true}]);await settled(page)
  await page.getByRole('button',{name:'Cancel selection'}).click()
  await handle(page,'photo').focus();await page.keyboard.press('Enter');await expect(page.getByRole('checkbox',{name:'Select photo.bin'})).toBeChecked();await expect(page.getByRole('button',{name:'Pin',exact:true})).toBeFocused();await page.getByRole('button',{name:'Cancel selection'}).click()
  await page.evaluate(()=>{
    const event=new Event('drop',{cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{types:['Files'],files:[],items:[{kind:'file',getAsFileSystemHandle:async()=>({kind:'directory',name:'Household folder',async *values(){}}),getAsFile:()=>null}]}});window.dispatchEvent(event)
  });await expect.poll(()=>page.evaluate(()=>(window as any).inboxFixture.folders)).toEqual(['Household folder']);expect(data.calls).toHaveLength(2);expect(data.errors).toEqual([])
  await save('partial-pin-folder-result',{calls:data.calls,partialPinConfirmed:true,failedSelectionKept:true,browserFolderIntake:true,errors:data.errors,limit:'Folder intake recorded by injected transfer store; archive creation is unchanged and not retested here'})
})


test('held drop preflight fences a refreshed stale row and offline transition before writes',async({page})=>{
  const data=await setup(page),pin=data.nav.locator('[data-share-drop="pinned"]')
  for(const reason of ['stale','offline']){
    data.holdMetadata();await mouseDrag(page,handle(page,'archive'),pin);await expect.poll(()=>data.pending.some(entry=>entry.kind==='metadata')).toBe(true)
    if(reason==='stale'){data.items.find(item=>item.id==='archive')!.updatedAt='2026-10-27T13:00:00Z';await data.refresh();await settled(page)}else await page.evaluate(()=>window.dispatchEvent(new Event('offline')))
    data.holdMetadata(false);data.release();await expect(page.getByRole('alert').filter({hasText:'No move was sent'})).toBeVisible();expect(data.calls).toHaveLength(0)
    if(reason==='offline'){await page.evaluate(()=>window.dispatchEvent(new Event('online')));await settled(page)}
  }
  expect(data.errors).toEqual([]);await save('preflight-result',{calls:data.calls,staleRefreshFenced:true,offlineFenced:true,errors:data.errors})
})
