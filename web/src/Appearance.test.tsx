import {StrictMode} from 'react'
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {Appearance,useAppearance} from './Appearance'
import {nativePlatform,type NativeInvoke} from './native-platform'
import type {PlatformAdapter,ResolvedTheme} from './platform'
const styles=document.createElement('style')
function media(initial=false){
  let dark=initial;const listeners=new Set<()=>void>(),reads=vi.fn()
  vi.stubGlobal('matchMedia',vi.fn(()=>({get matches(){reads();return dark},addEventListener:(_type:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_type:string,fn:()=>void)=>listeners.delete(fn)})))
  return{reads,change:(next:boolean)=>{dark=next;listeners.forEach(fn=>fn())}}
}
function fixture(platform:PlatformAdapter){
  styles.textContent=':root{--canvas:#F7F8FA;background:#F7F8FA}:root[data-theme=dark]{--canvas:#101B26;background:#101B26}.topbar{background:#18334a}.mobile-tabs{background:#ffffff}'
  document.head.append(styles)
  function Harness(){const appearance=useAppearance(platform);return <><header className="topbar"/><Appearance {...appearance}/><textarea aria-label="Draft" defaultValue="Unsent exact draft"/><nav className="mobile-tabs"/></>}
  return render(<StrictMode><Harness/></StrictMode>)
}
function signal(theme:unknown){window.dispatchEvent(new CustomEvent('household-system-appearance',{detail:{theme}}))}
afterEach(()=>{styles.remove();document.documentElement.removeAttribute('data-theme');delete window.__TAURI__;delete window.__HOUSEHOLD_NATIVE__;vi.unstubAllGlobals()})
describe('optional native appearance resolution',()=>{
  it('prefers independent Android OS signals only in System and deduplicates unchanged signals/resizes',async()=>{
    const system=media(false);let nativeTheme:ResolvedTheme='dark'
    const setAppearance=vi.fn().mockImplementation(async()=>({systemTheme:nativeTheme}))
    fixture({kind:'native',deviceIdentity:{id:'1'.repeat(32),platform:'android'},setAppearance} as unknown as PlatformAdapter)
    await waitFor(()=>expect(document.documentElement.dataset.theme).toBe('dark'))
    expect(setAppearance).toHaveBeenLastCalledWith({appearance:'system',resolvedTheme:'dark',canvas:'#101B26',header:'#18334a',navigation:'#ffffff'})
    const count=setAppearance.mock.calls.length
    act(()=>{signal('dark');signal('invalid');window.dispatchEvent(new Event('resize'));system.change(false)})
    await act(async()=>{});expect(setAppearance).toHaveBeenCalledTimes(count)
    fireEvent.click(screen.getByRole('radio',{name:'Light'}));await waitFor(()=>expect(setAppearance).toHaveBeenLastCalledWith(expect.objectContaining({appearance:'light'})))
    nativeTheme='light';act(()=>signal('light'));expect(document.documentElement.dataset.theme).toBe('light')
    const fixedCount=setAppearance.mock.calls.length;act(()=>{nativeTheme='dark';signal('dark')});await act(async()=>{});expect(setAppearance).toHaveBeenCalledTimes(fixedCount)
    fireEvent.click(screen.getByRole('radio',{name:'System'}));await waitFor(()=>expect(document.documentElement.dataset.theme).toBe('dark'));expect(screen.getByRole('textbox',{name:'Draft'})).toHaveValue('Unsent exact draft')
  })
  it('keeps CSS usable and reports a rejected old-shell cosmetic capability without command retries',async()=>{
    media(true)
    const invoke=vi.fn<NativeInvoke>(async command=>{if(command==='native_get_config')return{platform:'android'};if(command==='native_set_appearance')throw new Error('Unknown command native_set_appearance');throw new Error('Unexpected native operation')})
    const platform=await nativePlatform(invoke);fixture(platform)
    await waitFor(()=>expect(document.documentElement.dataset.theme).toBe('dark'));await screen.findByText(/Native window appearance could not be updated/)
    act(()=>{window.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('resize'))});await act(async()=>{})
    expect(screen.getByText(/Native window appearance could not be updated/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio',{name:'Light'}));await waitFor(()=>expect(document.documentElement.dataset.theme).toBe('light'))
    expect(invoke.mock.calls.filter(([command])=>command==='native_set_appearance')).toHaveLength(1)
    expect(invoke.mock.calls.some(([command])=>command==='native_api')).toBe(false)
  })
  it('releases a forced desktop theme before reading System media and never forces the resolved OS choice',async()=>{
    const system=media(false);localStorage.setItem('zing.appearance','dark');let release!:()=>void
    const setTheme=vi.fn((value:ResolvedTheme|null)=>value===null?new Promise<void>(resolve=>{release=resolve}):Promise.resolve()),setBackgroundColor=vi.fn().mockResolvedValue(undefined)
    window.__TAURI__={core:{invoke:vi.fn()},window:{getCurrentWindow:()=>({setTheme,setBackgroundColor})}}
    const platform=await nativePlatform(vi.fn().mockResolvedValue({platform:'macos'}));fixture(platform)
    await waitFor(()=>expect(setBackgroundColor).toHaveBeenCalledWith('#101B26'));expect(system.reads).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio',{name:'System'}));await waitFor(()=>expect(setTheme).toHaveBeenLastCalledWith(null));expect(document.documentElement.dataset.theme).toBe('dark');expect(system.reads).not.toHaveBeenCalled()
    await act(async()=>release());await waitFor(()=>expect(document.documentElement.dataset.theme).toBe('light'));await waitFor(()=>expect(setBackgroundColor).toHaveBeenLastCalledWith('#F7F8FA'))
    act(()=>system.change(true));await waitFor(()=>expect(setBackgroundColor).toHaveBeenLastCalledWith('#101B26'));expect(setTheme.mock.calls).toEqual([['dark'],[null]])
  })
  it('ignores an older Android command preference when a newer native OS event arrived first',async()=>{
    media(false);let finish!:(result:{systemTheme:ResolvedTheme})=>void
    const setAppearance=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockResolvedValue({systemTheme:'dark'})
    fixture({kind:'native',deviceIdentity:{id:'1'.repeat(32),platform:'android'},setAppearance} as unknown as PlatformAdapter)
    await waitFor(()=>expect(setAppearance).toHaveBeenCalledTimes(1));act(()=>signal('dark'));await act(async()=>finish({systemTheme:'light'}));await waitFor(()=>expect(document.documentElement.dataset.theme).toBe('dark'));expect(setAppearance).toHaveBeenLastCalledWith(expect.objectContaining({resolvedTheme:'dark'}))
  })
  it('serializes rapid explicit changes so a late old native call cannot win',async()=>{
    media(false);localStorage.setItem('zing.appearance','dark');let finish!:()=>void
    const setAppearance=vi.fn().mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve})).mockResolvedValue(undefined)
    fixture({kind:'native',setAppearance} as unknown as PlatformAdapter);await waitFor(()=>expect(setAppearance).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('radio',{name:'Light'}));expect(document.documentElement.dataset.theme).toBe('light');expect(setAppearance).toHaveBeenCalledTimes(1)
    await act(async()=>finish());await waitFor(()=>expect(setAppearance).toHaveBeenCalledTimes(2));expect(setAppearance.mock.calls.map(([request])=>request.appearance)).toEqual(['dark','light']);expect(document.documentElement.dataset.theme).toBe('light')
  })
})
