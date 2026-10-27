import {test,expect,type Page} from '@playwright/test'
import {mkdirSync,writeFileSync} from 'node:fs'
const out=process.env.QUICK_SHARE_EVIDENCE_DIR||'test-runs/quick-share',source='a'.repeat(32),target='b'.repeat(32)
mkdirSync(out,{recursive:true})
async function fixture(page:Page){
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(({source,target})=>{
    localStorage.setItem('zing.appearance','light')
    const state={calls:[] as {command:string;args:unknown}[],listeners:{} as Record<string,Set<(event:unknown)=>void>>,stale:false,login:false,failLogin:false}
    Object.assign(window,{quickFixture:state})
    const invoke=async(command:string,args?:Record<string,unknown>)=>{
      state.calls.push({command,args})
      if(command==='native_get_config')return{platform:'macos',canQuickShare:true,canOpenAtLogin:true,connected:false,sourceDevice:'Kitchen Mac'}
      if(command==='native_quick_context')return{baseUrl:'https://household.example',sourceDeviceId:source,sourceDevice:'Kitchen Mac',devices:[{id:source,label:'Kitchen Mac',platform:'macos'},...state.stale?[]:[{id:target,label:'Living room phone',platform:'android'},{id:'c'.repeat(32),label:'Office Linux',platform:'linux'},{id:'d'.repeat(32),label:'Bedroom Mac',platform:'macos'}]]}
      if(command==='native_quick_paste')return'\ufeff  A household note\r\n\tKeep this spacing. 🦊  '
      if(command==='native_quick_send_text')return{itemId:'e'.repeat(32)}
      if(command==='native_quick_pick')return{queued:1,cancelled:false}
      if(command==='native_quick_drop')return{queued:2,cancelled:false}
      if(command==='native_get_open_at_login')return{enabled:state.login}
      if(command==='native_set_open_at_login'){if(state.failLogin)throw Error('Move Drop to Applications, then try again.');state.login=args?.enabled===true;return{enabled:state.login}}
      if(command==='native_list_transfers')return[]
      return null
    }
    window.__TAURI__={core:{invoke},window:{getCurrentWindow:()=>({setTheme:async()=>{},setBackgroundColor:async()=>{},listen:async(event,receive)=>{const callback=receive as (event:unknown)=>void;(state.listeners[event]??=new Set()).add(callback);return()=>{state.listeners[event].delete(callback)}}})}}
  },{source,target})
  return errors
}
test('compact panel opens unfocused, reviews exact text, queues paths and retains stale draft',async({page})=>{
  const errors=await fixture(page);await page.setViewportSize({width:360,height:520});await page.goto('/?quick-share=1')
  const to=page.getByRole('combobox',{name:'To'}),editor=page.getByRole('textbox',{name:'Text to share'})
  await expect(to).toBeEnabled();await expect(to).toHaveValue('');await expect(editor).toBeVisible()
  await expect(page.getByRole('searchbox')).toHaveCount(0)
  await expect(page.getByRole('button',{name:/Open Drop|Quit|Refresh devices|Retry devices/})).toHaveCount(0)
  expect(await to.locator('option').allTextContents()).toEqual(['Everyone','Living room phone','Office Linux','Bedroom Mac'])
  const initialFocus=await page.evaluate(()=>({active:document.activeElement?.tagName,focusVisible:document.querySelectorAll(':focus-visible').length}))
  expect(initialFocus).toEqual({active:'BODY',focusVisible:0})
  expect(await page.evaluate(()=>(window as any).quickFixture.calls.filter((call:any)=>call.command==='native_quick_paste'))).toEqual([])
  await page.screenshot({path:`${out}/panel-compact-initial-light.png`,animations:'disabled'})
  await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Hide quick share'})).toBeFocused()
  await page.keyboard.press('Tab');await expect(to).toBeFocused()
  const keyboardFocus=await to.evaluate(element=>({visible:element.matches(':focus-visible'),outline:getComputedStyle(element).outlineWidth}))
  expect(keyboardFocus).toEqual({visible:true,outline:'3px'})
  await to.selectOption(target);await page.getByRole('button',{name:'Paste',exact:true}).click()
  await expect(editor).toHaveValue('\ufeff  A household note\n\tKeep this spacing. 🦊  ')
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled()
  await page.getByRole('heading',{name:'Quick send'}).click()
  const layout=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,contentHeight:document.querySelector('.quick-content')!.clientHeight,contentScrollHeight:document.querySelector('.quick-content')!.scrollHeight,dropBottom:document.querySelector('.quick-drop')!.getBoundingClientRect().bottom,sendHeight:document.querySelector('.quick-send .primary')!.getBoundingClientRect().height,selectHeight:document.querySelector('select')!.getBoundingClientRect().height}))
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);expect(layout.contentScrollHeight).toBeLessThanOrEqual(layout.contentHeight);expect(layout.dropBottom).toBeLessThanOrEqual(520);expect(layout.sendHeight).toBeGreaterThanOrEqual(44);expect(layout.selectHeight).toBeGreaterThanOrEqual(44)
  await page.screenshot({path:`${out}/panel-compact-light.png`,animations:'disabled'})
  await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Text shared to Living room phone.')
  const sent=await page.evaluate(()=>(window as any).quickFixture.calls.filter((call:any)=>call.command==='native_quick_send_text'))
  expect(sent).toEqual([{command:'native_quick_send_text',args:{baseUrl:'https://household.example',sourceDeviceId:source,targetDeviceIds:[target],text:'\ufeff  A household note\r\n\tKeep this spacing. 🦊  '}}])
  await page.evaluate(()=>{for(const receive of (window as any).quickFixture.listeners['tauri://drag-drop'])receive({payload:{paths:['/tmp/a.zip','/tmp/folder']}})})
  await expect(page.getByRole('status')).toContainText('2 selections queued to Living room phone.')
  await editor.fill('Keep this draft on dismissal and failure.')
  await page.keyboard.press('Escape')
  await page.evaluate(()=>{localStorage.setItem('zing.appearance','dark');window.dispatchEvent(new Event('focus'))})
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark')
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled()
  await expect(editor).toHaveValue('Keep this draft on dismissal and failure.')
  await expect(to).toHaveValue(target)
  await page.getByRole('heading',{name:'Quick send'}).click()
  await page.screenshot({path:`${out}/panel-compact-dark.png`,animations:'disabled'})
  await page.evaluate(()=>{(window as any).quickFixture.stale=true;window.dispatchEvent(new Event('focus'))})
  await expect(page.getByRole('alert')).toContainText('Choose a destination again')
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();await expect(to).toHaveValue('stale')
  await expect(editor).toHaveValue('Keep this draft on dismissal and failure.')
  expect(errors).toEqual([])
  const calls=await page.evaluate(()=>(window as any).quickFixture.calls)
  expect(calls.filter((call:any)=>call.command==='native_quick_paste')).toHaveLength(1)
  expect(calls.filter((call:any)=>call.command==='native_quick_resize').every((call:any)=>call.args.detail===false)).toBe(true)
  writeFileSync(`${out}/panel-browser-result.json`,JSON.stringify({errors,initialFocus,keyboardFocus,layout,sent,calls,checks:['direct composer without initial focus highlight','Everyone default and sender excluded','no search or footer or unconditional refresh','visible deliberate keyboard focus','one explicit clipboard read','exact reviewed send','native path-only drop','draft/destination retained across hide/focus','compact light/dark theme','stale target blocked']},null,2)+'\n')
})
test('Mac Settings shows persisted login state and retains it on error',async({page})=>{
  const errors=await fixture(page);await page.setViewportSize({width:1280,height:900});await page.goto('/')
  await page.getByRole('button',{name:'Configure connection'}).click()
  const toggle=page.getByRole('checkbox',{name:'Open at login'});await expect(toggle).toBeEnabled();await expect(toggle).not.toBeChecked()
  await toggle.check();await expect(toggle).toBeChecked()
  await page.evaluate(()=>{(window as any).quickFixture.failLogin=true})
  await toggle.click();await expect(page.getByRole('alert')).toContainText('Applications');await expect(toggle).toBeChecked()
  await page.screenshot({path:`${out}/settings-login-error.png`,animations:'disabled'})
  expect(errors).toEqual([])
  writeFileSync(`${out}/login-browser-result.json`,JSON.stringify({errors,persistedChecked:true,errorRetainsSavedState:true},null,2)+'\n')
})
