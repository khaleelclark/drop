import {test,expect,type Page} from '@playwright/test'
import {mkdirSync,writeFileSync} from 'node:fs'
import type {Item} from '../src/types'
const out='release-evidence/tab-switch',now='2026-10-25T12:00:00Z',device='1'.repeat(32)
const note=(id:string,pinned=false):Item=>({id,kind:'file',name:id+'.bin',size:20,preview:'bounded preview',createdAt:now,updatedAt:now,status:'ready',pinned,sourceDevice:'Same device label'})
const ids=(page:Page)=>page.locator('.share-entry').evaluateAll(rows=>rows.map(row=>row.id.replace('share-','')))
async function setup(page:Page,native=false,holdRegistration=false){
  await page.setViewportSize(native?{width:390,height:844}:{width:1440,height:900})
  await page.addInitScript(({native,device})=>{
    localStorage.setItem('household.device','Household laptop')
    const state={refresh:()=>{},subscriptions:0,unsubscriptions:0,eventStarts:0,eventStops:0}
    Object.assign(window,{tabFixture:state})
    const rows=[{id:'saved',name:'Queued archive.zip',size:100,lastModified:1,kind:'file' as const,sourceDevice:'Household laptop',destination:location.origin,state:'paused' as const,confirmed:0,sent:0}]
    window.householdPlatform={kind:native?'native':'browser',baseURL:location.origin,defaultDeviceName:'Household laptop',...(native?{deviceIdentity:{id:device,platform:'android' as const},configureConnection:async()=>{},disconnect:async()=>{}}:{}),request:(...args)=>fetch(...args),copyText:async()=>{},download:async()=>{},openEvents:(refresh,status)=>{state.refresh=refresh;state.eventStarts++;status(true);return()=>{state.eventStops++}},transfers:{getSnapshot:()=>rows,subscribe:()=>{state.subscriptions++;return()=>{state.unsubscriptions++}},enqueue:()=>{},pause:async()=>{},resume:()=>{},cancel:async()=>{},reattach:async()=>{},clearCompleted:()=>{}}}
  },{native,device})
  const items=[note('all-only',true),note('routed'),{...note('trashed'),deletedAt:now}]
  const routed=new Set(['routed']),errors:string[]=[],requests:string[]=[],pending:{key:string;release:()=>void}[]=[]
  let hold=false,failure=0,storageFailure=0,emptyYou=false,registeredId=''
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method()
    const json=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
    if(path==='/api/items'||path==='/api/trash'){
      const key=path==='/api/trash'?'trash':url.searchParams.has('forDevice')?'you':'all',q=url.searchParams.get('q')||''
      requests.push(`${url.origin}:${key}:${q}`)
      const status=failure
      const rows=structuredClone(items.filter(item=>Boolean(item.deletedAt)===(key==='trash')&&(key!=='you'||(!emptyYou&&url.searchParams.get('forDevice')===(native?device:registeredId)&&routed.has(item.id)))&&item.name.includes(q)))
      if(hold)await new Promise<void>(release=>pending.push({key:`${key}:${q}`,release}))
      return status?json({error:{message:`Delayed failure ${status}`}},status):json({items:rows,nextCursor:null})
    }
    const action=path.match(/^\/api\/items\/([^/]+)\/(trash|restore|purge)$/)
    if(action){const item=items.find(item=>item.id===action[1])!;if(action[2]==='purge')items.splice(items.indexOf(item),1);else item.deletedAt=action[2]==='trash'?now:undefined;return action[2]==='restore'?json({item}):route.fulfill({status:204})}
    if(path.startsWith('/api/items/')&&method==='PATCH'){const item=items.find(item=>item.id===path.split('/')[3])!;Object.assign(item,req.postDataJSON());return json({item})}
    if(path==='/api/devices/register'){if(holdRegistration)await new Promise<void>(release=>pending.push({key:'register',release}));registeredId=req.postDataJSON().id;return json({device:{...req.postDataJSON(),createdAt:now}})}
    if(path==='/api/devices')return json({devices:[]})
    if(path.includes('/notifications'))return json({notifications:[],nextCursor:'0',ackCursor:'0',hasMore:false})
    if(path==='/api/storage'&&storageFailure)return json({error:{message:'Storage access denied'}},storageFailure)
    if(path==='/api/storage')return json({usedBytes:50,freeBytes:1e12,maxFileBytes:20*1024**3,maxTextBytes:32*1024**2,maxStorageBytes:null})
    if(path==='/api/settings/trash')return json({retentionDays:30})
    if(path==='/api/session')return route.fulfill({status:204})
    return json({error:{message:'Unexpected fixture route'}},404)
  })
  await page.goto('/');if(!holdRegistration)await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled();await expect.poll(()=>ids(page)).toEqual(['all-only','routed'])
  const nav=page.getByRole('navigation',{name:native?'Mobile feed filters':'Feed filters',exact:true})
  const tab=async(name:string)=>nav.getByRole('button',{name,exact:true}).click()
  const release=(key?:string)=>{for(let i=pending.length-1;i>=0;i--)if(!key||pending[i].key===key)pending.splice(i,1)[0].release()}
  const refresh=()=>page.evaluate(()=>(window as any).tabFixture.refresh())
  return{items,routed,errors,requests,pending,tab,release,refresh,registerNow:()=>{holdRegistration=false;release('register')},hold:(value=true)=>{hold=value},fail:(status:number)=>{failure=status},denyStorage:()=>{storageFailure=403},empty:()=>{emptyYou=true}}
}
async function settled(page:Page){await expect(page.locator('.refresh-button')).toBeEnabled()}
async function save(name:string,data:unknown){mkdirSync(out,{recursive:true});writeFileSync(`${out}/${name}.json`,JSON.stringify(data,null,2)+'\n')}
for(const native of [false,true])test(`repeated delayed tabs retain scoped rows and mounted draft/queue (${native?'mobile native adapter':'desktop'})`,async({page})=>{
  const data=await setup(page,native)
  await data.tab('For you');await expect.poll(()=>ids(page)).toEqual(['routed']);await settled(page)
  await data.tab('Recently Deleted');await expect.poll(()=>ids(page)).toEqual(['trashed']);await settled(page)
  await data.tab('All shares');await settled(page)
  const draft=page.getByRole('textbox',{name:'Text to share'});await draft.fill('Keep this draft');await page.keyboard.press('Escape')
  await page.evaluate(()=>{document.querySelector('.composer')!.setAttribute('data-identity','retained');document.querySelector('.transfer-panel')!.setAttribute('data-identity','retained')})
  await page.evaluate(()=>{
    const violations:unknown[]=[];Object.assign(window,{tabPaintViolations:violations})
    new MutationObserver(()=>{const scope=document.querySelector('.workspace-title')?.textContent||'',rows=[...document.querySelectorAll('.share-entry')].map(row=>row.id.replace('share-','')),expected:Record<string,string[]>={'All shares':['all-only','routed'],'Pinned':['all-only'],'For you':['routed'],'Recently Deleted':['trashed']};if(JSON.stringify(rows)!==JSON.stringify(expected[scope]))violations.push({scope,rows})}).observe(document.querySelector('.workspace')!,{childList:true,subtree:true})
  })
  data.hold()
  const samples=[]
  for(let n=0;n<3;n++)for(const [tab,expected] of [['For you',['routed']],['Recently Deleted',['trashed']],['All shares',['all-only','routed']],['Pinned',['all-only']]] as const){
    await data.tab(tab);expect(await ids(page)).toEqual(expected);await expect(page.getByRole('heading',{name:'Loading…',exact:true})).toHaveCount(0);samples.push({tab,rows:await ids(page)})
  }
  await data.tab('All shares');expect(await ids(page)).toEqual(['all-only','routed'])
  await expect(draft).toHaveValue('Keep this draft');await expect(page.locator('.composer')).toHaveAttribute('data-identity','retained');await expect(page.locator('.transfer-panel')).toHaveAttribute('data-identity','retained')
  const continuity=await page.evaluate(()=>{const s=(window as any).tabFixture;return{subscriptions:s.subscriptions-s.unsubscriptions,eventSubscriptions:s.eventStarts-s.eventStops}})
  expect(continuity).toEqual({subscriptions:1,eventSubscriptions:1});expect(await page.evaluate(()=>(window as any).tabPaintViolations)).toEqual([])
  await page.screenshot({path:`${out}/${native?'phone':'desktop'}-pending.png`})
  data.hold(false);data.release();await settled(page);expect(await ids(page)).toEqual(['all-only','routed']);expect(data.errors).toEqual([])
  await save(native?'mobile-delayed':'desktop-delayed',{samples,continuity,requests:data.requests,errors:data.errors,limit:'Chromium with injected adapter; no installed client or device latency measurement'})
})
test('unknown scopes, out-of-order queries, and loaded empty tabs stay distinct',async({page})=>{
  const data=await setup(page)
  data.empty();data.hold();await data.tab('For you');await expect(page.getByRole('heading',{name:'Loading…',exact:true})).toBeVisible();expect(await ids(page)).toEqual([])
  await data.tab('All shares');expect(await ids(page)).toEqual(['all-only','routed']);data.release('you:');expect(await ids(page)).toEqual(['all-only','routed'])
  data.hold(false);data.release();await settled(page);await data.tab('For you');await expect(page.getByRole('heading',{name:'Nothing sent to you yet'})).toBeVisible();await settled(page)
  data.hold();await data.tab('All shares');await data.tab('For you');await expect(page.getByRole('heading',{name:'Nothing sent to you yet'})).toBeVisible();await expect(page.getByRole('heading',{name:'Loading…'})).toHaveCount(0)
  await data.tab('All shares');const search=page.getByRole('searchbox');await search.fill('all-only');await expect.poll(()=>data.pending.some(row=>row.key==='all:all-only')).toBe(true);expect(await ids(page)).toEqual([])
  await search.fill('routed');await expect.poll(()=>data.pending.some(row=>row.key==='all:routed')).toBe(true);data.release('all:routed');await expect.poll(()=>ids(page)).toEqual(['routed']);data.release('all:all-only');expect(await ids(page)).toEqual(['routed'])
  data.hold(false);data.release();expect(data.errors).toEqual([]);await save('scope-ordering',{requests:data.requests,errors:data.errors,emptyCached:true,outOfOrderIgnored:true,unknownScopeCleared:true})
})
test('background errors retain rows and retry/live refresh reconcile metadata',async({page})=>{
  const data=await setup(page)
  await data.tab('For you');await expect.poll(()=>ids(page)).toEqual(['routed']);await settled(page);await data.tab('All shares');await settled(page)
  data.fail(503);await data.refresh();await expect(page.getByRole('alert').filter({hasText:'Couldn’t load shares'})).toContainText('Delayed failure 503');expect(await ids(page)).toEqual(['all-only','routed']);await settled(page)
  data.fail(0);data.items[0].name='Remote rename.bin';data.items[1].deletedAt=now
  await page.getByRole('alert').filter({hasText:'Couldn’t load shares'}).getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>ids(page)).toEqual(['all-only']);await expect(page.getByRole('article',{name:'File: Remote rename.bin'})).toBeVisible();await settled(page)
  data.hold();await data.tab('For you');expect(await ids(page)).toEqual([]);await expect(page.getByRole('heading',{name:'Nothing sent to you yet'})).toBeVisible();data.hold(false);data.release();await settled(page)
  expect(data.errors).toEqual([]);await save('refresh-errors',{retainedOn503:true,retryUpdated:true,remoteTrashPrunedFromCachedYou:true,requests:data.requests,errors:data.errors})
})
test('local trash restore purge and pin remain coherent across retained scopes and stale responses',async({page})=>{
  const data=await setup(page)
  await data.tab('For you');await expect.poll(()=>ids(page)).toEqual(['routed']);await settled(page);await data.tab('Recently Deleted');await expect.poll(()=>ids(page)).toEqual(['trashed']);await settled(page);await data.tab('All shares');await settled(page)
  const row=page.getByRole('article',{name:'File: routed.bin'});data.hold();await data.refresh();await expect.poll(()=>data.pending.some(row=>row.key==='all:')).toBe(true)
  await row.getByRole('button',{name:'More actions for routed.bin'}).click();await row.getByRole('menuitem',{name:'Delete',exact:true}).click();await expect(row).toHaveCount(0)
  await data.tab('For you');expect(await ids(page)).toEqual([]);data.hold(false);data.release();await settled(page);expect(await ids(page)).toEqual([])
  await data.tab('Recently Deleted');await expect.poll(()=>ids(page)).toEqual(['routed','trashed']);await settled(page)
  await page.getByRole('article',{name:'Deleted: routed.bin'}).getByRole('button',{name:'Restore',exact:true}).click();await expect.poll(()=>ids(page)).toEqual(['trashed']);await settled(page)
  data.hold();await data.tab('All shares');expect(await ids(page)).not.toContain('routed');data.hold(false);data.release();await expect.poll(()=>ids(page)).toEqual(['all-only','routed']);await settled(page)
  await data.tab('For you');await expect.poll(()=>ids(page)).toEqual(['routed']);await settled(page);await data.tab('All shares');await settled(page)
  await row.getByRole('button',{name:'More actions for routed.bin'}).click();await row.getByRole('menuitem',{name:'Rename entry'}).click();await page.getByRole('textbox',{name:'Entry name'}).fill('Renamed share.bin');data.hold();await page.getByRole('button',{name:'Save entry'}).click();await expect(page.getByRole('article',{name:'File: Renamed share.bin'})).toHaveCount(1)
  await data.tab('For you');expect(await ids(page)).toEqual(['routed']);await expect(page.getByRole('article',{name:'File: Renamed share.bin'})).toBeVisible();data.hold(false);data.release();await settled(page)
  await data.tab('Recently Deleted');await settled(page);await page.getByRole('article',{name:'Deleted: trashed.bin'}).getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();await expect.poll(()=>ids(page)).toEqual([]);await settled(page)
  data.hold();await data.tab('All shares');await data.tab('Recently Deleted');expect(await ids(page)).toEqual([]);data.hold(false);data.release();await settled(page)
  await data.tab('All shares');await settled(page);const pinned=page.getByRole('article',{name:'File: all-only.bin'});await pinned.getByRole('button',{name:'More actions for all-only.bin'}).click();await pinned.getByRole('menuitem',{name:'Unpin item'}).click();await data.tab('Pinned');expect(await ids(page)).toEqual([])
  expect(data.errors).toEqual([]);await save('mutations',{trashRestorePurgeCoherent:true,oldResponseDidNotResurrect:true,pinnedSharedSnapshot:true,requests:data.requests,errors:data.errors})
})
for(const status of [401,403])test(`rejected access ${status} clears every retained tab`,async({page})=>{
  const data=await setup(page,true);await data.tab('For you');await expect.poll(()=>ids(page)).toEqual(['routed']);await settled(page);await data.tab('All shares');await settled(page)
  data.fail(status);await data.refresh();await expect(page.getByRole('alert').filter({hasText:'Access was not accepted'})).toContainText('Access was not accepted');expect(await ids(page)).toEqual([])
  data.hold();const blockedRequests=data.requests.length;await data.tab('Recently Deleted');expect(await ids(page)).toEqual([]);await data.tab('All shares');expect(await ids(page)).toEqual([]);expect(data.requests.length).toBe(blockedRequests);data.hold(false);data.release();data.fail(0);await page.getByRole('alert').filter({hasText:'Access was not accepted'}).getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>ids(page)).toEqual(['all-only','routed']);await settled(page);expect(data.errors).toEqual([])
  await save(`auth-${status}`,{clearedAllSnapshots:true,requests:data.requests,errors:data.errors})
})
test('native disconnect fences delayed requests and reconnect scopes server and device',async({page})=>{
  const data=await setup(page,true);await data.tab('For you');await expect.poll(()=>ids(page)).toEqual(['routed']);await settled(page)
  data.fail(401);data.hold();await data.refresh();await expect.poll(()=>data.pending.some(row=>row.key==='you:')).toBe(true)
  await page.locator('.connection-badge').click();await page.getByRole('button',{name:'Disconnect this app'}).click();expect(await ids(page)).toEqual([]);data.fail(0);data.hold(false);data.release();await expect(page.getByRole('heading',{name:'No household connection yet'})).toBeVisible()
  await data.tab('For you');await data.tab('All shares');expect(await ids(page)).toEqual([])
  await page.getByRole('button',{name:'Configure connection',exact:true}).click();await page.getByRole('textbox',{name:'Household server'}).fill('https://other-household.example');await page.evaluate(()=>{window.householdPlatform!.deviceIdentity!.id='2'.repeat(32)})
  data.hold();await page.getByRole('button',{name:'Connect household',exact:true}).click();await expect.poll(()=>data.requests.some(key=>key.startsWith('https://other-household.example:all:'))).toBe(true);expect(await ids(page)).toEqual([])
  data.hold(false);data.release();await expect(page.getByRole('dialog')).toHaveCount(0);await expect.poll(()=>ids(page)).toEqual(['all-only','routed']);await settled(page)
  data.hold();await data.tab('For you');expect(await ids(page)).toEqual([]);await expect(page.getByRole('heading',{name:'Loading…',exact:true})).toBeVisible();data.hold(false);data.release();await expect(page.getByRole('heading',{name:'Nothing sent to you yet'})).toBeVisible()
  expect(data.errors).toEqual([]);await save('disconnect-scopes',{disconnectedCacheCleared:true,oldResponseFenced:true,newOriginAndIdentityIsolated:true,requests:data.requests,errors:data.errors})
})

test('a non-feed authorization rejection fences a delayed successful feed response',async({page})=>{
  const data=await setup(page,true);await data.tab('For you');await expect.poll(()=>ids(page)).toEqual(['routed']);await settled(page);await data.tab('All shares');await settled(page)
  data.hold();data.denyStorage();await data.refresh();await expect(page.getByRole('alert').filter({hasText:'Access was not accepted'})).toBeVisible();expect(await ids(page)).toEqual([])
  data.hold(false);data.release();await data.tab('For you');expect(await ids(page)).toEqual([]);await data.tab('All shares');expect(await ids(page)).toEqual([]);expect(data.errors).toEqual([])
  await save('non-feed-auth',{storage403ClearedAllSnapshots:true,delayed200Fenced:true,errors:data.errors})
})

test('For you waits for the receiving identity instead of announcing an unresolved empty tab',async({page})=>{
  const data=await setup(page,true,true);await expect.poll(()=>data.pending.some(row=>row.key==='register')).toBe(true)
  await data.tab('For you');await expect(page.getByRole('heading',{name:'Loading…',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Nothing sent to you yet'})).toHaveCount(0);expect(await ids(page)).toEqual([])
  data.registerNow();await expect.poll(()=>ids(page)).toEqual(['routed']);await settled(page);expect(data.errors).toEqual([])
  await save('device-registration-wait',{unresolvedIdentityUsesLoading:true,serverMembershipAfterRegistration:true,errors:data.errors})
})
