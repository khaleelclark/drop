import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
const dir='test-results/ui-refresh'
const phase=process.env.ZING_UI_PHASE || 'after'
const now='2026-10-24T02:00:00Z'
const notes=['The spare keys are in the kitchen drawer.','Movie night at 8? 🍿','  Keep the spaces.\n\tAnd this tab.\n','Remember to water the plants 🌱']
async function setup(page:Page,{empty=false,queue=false,long=false}={}) {
  await page.addInitScript(({queue})=>{
    localStorage.setItem('household.device','Living room Mac');localStorage.removeItem('household.transfers.v1')
    if(queue)localStorage.setItem('household.transfers.v1',JSON.stringify([{id:'saved',name:'Family holiday — original footage.mp4',size:20_000_000_000,lastModified:1,kind:'file',sourceDevice:'Phone',destination:location.origin,state:'uploading',confirmed:8*1024**2,sent:8*1024**2}]))
  },{queue})
  const bodies=new Map<string,string>()
  const items=notes.map((text,n)=>{bodies.set(`note-${n}`,text);return{id:`note-${n}`,kind:'text',name:['Kitchen note','Tonight','Whitespace','Reminder'][n],size:Buffer.byteLength(text),createdAt:now,updatedAt:now,status:'ready',preview:text,pinned:n===1,sourceDevice:n%2?'Pocket phone':'Kitchen Mac'}})
  items.splice(1,0,{id:'archive',kind:'file',name:'Weekend photos.zip',size:428_500_000,createdAt:now,updatedAt:now,status:'ready',preview:'',pinned:false,sourceDevice:'Home Linux'})
  if(long){const text=Array.from({length:80},(_,n)=>`const example${n} = '<b>inert text & exact whitespace</b>';`).join('\n');bodies.set('long-note',text);items.unshift({...items[0],id:'long-note',name:'A long code note from '+ 'Kitchen Mac '.repeat(8),preview:text.slice(0,512),size:Buffer.byteLength(text)});items.unshift({...items[1],id:'long-file',kind:'file',name:'Original_family_archive_'+ 'very-long-name-'.repeat(12)+'.zip'})}
  if(empty)items.length=0
  let failSend=false
  const devices=[{id:'22222222222222222222222222222222',label:'Kitchen Mac',platform:'macos',createdAt:now},{id:'33333333333333333333333333333333',label:long?'Pocket phone with a very long recognizable family device name':'Pocket phone',platform:'android',createdAt:now}]
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method();const json=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
    if(url.pathname==='/api/items')return json({items:items.filter(item=>(!url.searchParams.has('forDevice')||item.id==='note-1')&&(`${item.name} ${item.preview}`.toLowerCase().includes((url.searchParams.get('q')||'').toLowerCase()))),nextCursor:null})
    if(url.pathname==='/api/storage')return json({usedBytes:12_000_000_000,freeBytes:128*1024**3,maxFileBytes:20*1024**3,maxTextBytes:32*1024**2,maxStorageBytes:null})
    if(url.pathname==='/api/devices/register'){const body=req.postDataJSON();return json({device:{...body,createdAt:now}})}
    if(url.pathname==='/api/devices')return json({devices})
    if(url.pathname.includes('/notifications'))return json({notifications:[],nextCursor:'0',ackCursor:'0',hasMore:false})
    if(url.pathname==='/api/events')return route.fulfill({status:200,contentType:'text/event-stream',body:': connected\n\n'})
    if(url.pathname==='/api/text')return failSend?json({error:{message:'Storage is full. Free some space and try again.'}},507):json({item:items[0]},201)
    const id=url.pathname.split('/').at(-2)!
    if(url.pathname.endsWith('/text'))return route.fulfill({status:200,contentType:'text/plain;charset=utf-8',body:bodies.get(id)||''})
    return json({error:{message:'Fixture endpoint not configured'}},404)
  })
  await page.goto('/');await expect(page.getByRole('button',{name:'Send to Everyone',exact:true})).toBeEnabled()
  if(!empty)await expect(page.getByRole('button',{name:'Copy text',exact:true}).first()).toBeVisible()
  return {failSend:()=>{failSend=true}}
}
async function capture(page:Page,name:string){mkdirSync(dir,{recursive:true});await page.screenshot({path:`${dir}/${phase}-${name}.png`,animations:'disabled'})}
test('reference composition desktop and phone',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await setup(page)
  const results=[]
  for(const size of [{width:1440,height:900},{width:390,height:844}]){
    await page.setViewportSize(size);await page.evaluate(()=>scrollTo(0,0));await capture(page,size.width===390?'phone':'desktop')
    const result=await page.evaluate(()=>{const r=(s:string)=>{const b=document.querySelector(s)!.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom}};const tabs=document.querySelector('.mobile-tabs')!.getBoundingClientRect();return{viewport:{width:innerWidth,height:innerHeight},composer:r('.composer'),header:r('.topbar'),toolbar:r('.feed-toolbar'),firstShare:r('.feed-card'),visibleRows:[...document.querySelectorAll('.feed-card')].filter(node=>node.getBoundingClientRect().bottom<=Math.min(innerHeight,tabs.height?tabs.top:innerHeight)).length,overflow:document.documentElement.scrollWidth>innerWidth}})
    results.push(result)
    if(phase==='after'){expect(result.overflow).toBe(false);if(size.width===390){expect(result.firstShare.y).toBeLessThanOrEqual(320);expect(result.visibleRows).toBeGreaterThanOrEqual(4)}}
  }
  writeFileSync(`${dir}/${phase}-composition.json`,JSON.stringify(results,null,2))
  if(phase==='before')return
  for(const width of [320,360,412,1024]){
    await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    for(const control of [page.getByRole('button',{name:'Share text',exact:true}),page.getByRole('button',{name:'Send to Everyone',exact:true}),page.getByRole('button',{name:'Add files',exact:true}),page.getByRole('button',{name:'Download',exact:true})]){const b=(await control.boundingBox())!;expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44)}
  }
})
test('reference picker sheet, focus, dismissal and retained destination',async({page})=>{
  await page.setViewportSize({width:390,height:844});await setup(page,{long:true})
  await page.getByRole('button',{name:'Send to Everyone',exact:true}).click()
  await expect(page.getByRole('searchbox',{name:'Find devices'})).toBeFocused()
  await capture(page,'picker-phone')
  if(phase==='after'){
    await expect(page.getByRole('dialog',{name:'Send to devices'})).toBeVisible()
    await page.getByRole('button',{name:/Pocket phone with/}).click();await page.getByRole('button',{name:'Done',exact:true}).click()
    await expect(page.getByRole('button',{name:/Send to Pocket phone/})).toBeFocused()
    await page.getByRole('button',{name:/Send to Pocket phone/}).click();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeHidden()
    await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:/Send to Pocket phone/}).click();await capture(page,'picker-desktop')
  }
})
test('reference empty, transfers offline, focused error, settings and long content',async({page,context})=>{
  await page.setViewportSize({width:390,height:844});const data=await setup(page,{long:true,queue:true})
  await context.setOffline(true);await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await capture(page,'transfers-offline');await context.setOffline(false)
  const composer=page.getByRole('textbox',{name:'Text to share'});await composer.fill('Keep this draft when sending fails.');data.failSend();await page.getByRole('button',{name:'Share text',exact:true}).click();await expect(page.getByText('Storage is full. Free some space and try again.',{exact:true})).toBeVisible();await expect(composer).toHaveValue('Keep this draft when sending fails.');await composer.focus();await capture(page,'focused-error')
  await page.keyboard.press('Escape');await page.getByRole('article').first().scrollIntoViewIfNeeded();await capture(page,'long-content')
  await page.locator('.connection-badge').click();await expect(page.getByRole('dialog')).toBeVisible();await capture(page,'settings-phone')
  const empty=await context.newPage();await empty.setViewportSize({width:390,height:844});await setup(empty,{empty:true});await capture(empty,'empty-phone');await empty.close()
})
test('reference constrained picker, larger text and reduced motion remain usable',async({page})=>{
  await page.setViewportSize({width:320,height:480});await page.emulateMedia({reducedMotion:'reduce'});await setup(page,{long:true})
  await page.addStyleTag({content:'html { font-size: 125%; } .text-preview, .file-name, .recipient-row strong { font-size: 20px; }'})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.getByRole('button',{name:'Send to Everyone',exact:true}).click()
  const picker=page.getByRole('dialog',{name:'Send to devices'})
  await expect(picker.getByRole('searchbox')).toBeFocused()
  await page.setViewportSize({width:320,height:300})
  const done=picker.getByRole('button',{name:'Done',exact:true})
  await expect(done).toBeInViewport({ratio:1})
  await done.focus();await page.keyboard.press('Tab');expect(await picker.evaluate(node=>node.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape');await expect(picker).toBeHidden()
  await page.setViewportSize({width:1024,height:768});await page.getByRole('button',{name:'Send to Everyone',exact:true}).click();await page.mouse.click(10,10);await expect(picker).toBeHidden()
  expect(await page.getByRole('button',{name:'Share text',exact:true}).evaluate(node=>getComputedStyle(node).transitionDuration)).toBe('0s')
})
