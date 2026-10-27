import {act,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {OpenAtLogin} from './OpenAtLogin'
import {App} from './App'
import {nativePlatform,type NativeInvoke} from './native-platform'
import type {PlatformAdapter} from './platform'
import type {TransferStore} from './transfers'
const base:PlatformAdapter={kind:'native',copyText:vi.fn(),download:vi.fn(),transfers:{} as TransferStore}
afterEach(()=>{delete window.householdPlatform})
describe('real Mac login preference',()=>{
  it('hides the control for an unsupported platform',()=>{
    render(<OpenAtLogin platform={base} disabled={false} onBusyChange={vi.fn()}/>)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
  it('reads actual state without enabling, then waits for persistence and guards repeated toggles',async()=>{
    let resolve!:(value:{enabled:boolean})=>void
    const set=vi.fn(()=>new Promise<{enabled:boolean}>(done=>{resolve=done})),get=vi.fn().mockResolvedValue({enabled:false}),busy=vi.fn()
    render(<OpenAtLogin platform={{...base,getOpenAtLogin:get,setOpenAtLogin:set}} disabled={false} onBusyChange={busy}/>)
    const toggle=screen.getByRole('checkbox',{name:'Open at login'})
    await waitFor(()=>expect(toggle).toBeEnabled());expect(toggle).not.toBeChecked();expect(set).not.toHaveBeenCalled()
    fireEvent.click(toggle);fireEvent.click(toggle)
    expect(set).toHaveBeenCalledTimes(1);expect(set).toHaveBeenCalledWith(true)
    expect(toggle).toBeDisabled();expect(toggle).not.toBeChecked();expect(busy).toHaveBeenLastCalledWith(true)
    await act(async()=>resolve({enabled:true}))
    expect(toggle).toBeChecked();expect(toggle).toBeEnabled();expect(busy).toHaveBeenLastCalledWith(false)
  })
  it('keeps saved state on failure and rechecks instead of inventing success',async()=>{
    const get=vi.fn().mockResolvedValueOnce({enabled:true}).mockResolvedValueOnce({enabled:false}),set=vi.fn().mockRejectedValue(new Error('Move Drop to Applications and try again'))
    render(<OpenAtLogin platform={{...base,getOpenAtLogin:get,setOpenAtLogin:set}} disabled={false} onBusyChange={vi.fn()}/>)
    const toggle=screen.getByRole('checkbox',{name:'Open at login'})
    await waitFor(()=>expect(toggle).toBeChecked());fireEvent.click(toggle)
    expect(await screen.findByRole('alert')).toHaveTextContent('Applications');expect(toggle).toBeChecked()
    fireEvent.click(screen.getByRole('button',{name:'Check login setting again'}))
    await waitFor(()=>expect(toggle).not.toBeChecked());expect(set).toHaveBeenCalledTimes(1);expect(get).toHaveBeenCalledTimes(2)
  })
  it('makes an initial read failure actionable and respects an unrelated settings mutation',async()=>{
    const get=vi.fn().mockRejectedValueOnce(new Error('Disk unavailable')).mockResolvedValueOnce({enabled:false}),set=vi.fn()
    const platform={...base,getOpenAtLogin:get,setOpenAtLogin:set},busy=vi.fn()
    const view=render(<OpenAtLogin platform={platform} disabled={false} onBusyChange={busy}/>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk unavailable')
    expect(screen.getByRole('checkbox')).toBeDisabled()
    fireEvent.click(screen.getByRole('button',{name:'Check login setting again'}))
    await waitFor(()=>expect(screen.getByRole('checkbox')).toBeEnabled())
    view.rerender(<OpenAtLogin platform={platform} disabled onBusyChange={busy}/>)
    expect(screen.getByRole('checkbox')).toBeDisabled();expect(set).not.toHaveBeenCalled()
  })
  it('holds Settings open and protects connection controls while native persistence is pending',async()=>{
    let resolve!:(value:{enabled:boolean})=>void
    const invoke=vi.fn<NativeInvoke>(async(command)=>{
      if(command==='native_get_config')return{platform:'macos',canOpenAtLogin:true,connected:false}
      if(command==='native_list_transfers')return[]
      if(command==='native_get_open_at_login')return{enabled:false}
      if(command==='native_set_open_at_login')return new Promise(done=>{resolve=done})
      return null
    })
    window.householdPlatform=await nativePlatform(invoke)
    render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Configure connection'}))
    const toggle=screen.getByRole('checkbox',{name:'Open at login'})
    await waitFor(()=>expect(toggle).toBeEnabled());fireEvent.click(toggle)
    expect(screen.getByRole('button',{name:'Close connection settings'})).toBeDisabled()
    expect(screen.getByRole('button',{name:'Connect household'})).toBeDisabled()
    fireEvent.keyDown(toggle,{key:'Escape'});expect(screen.getByRole('dialog',{name:'Connection settings'})).toBeInTheDocument()
    await act(async()=>resolve({enabled:true}))
    expect(toggle).toBeChecked();expect(screen.getByRole('button',{name:'Close connection settings'})).toBeEnabled()
    expect(invoke.mock.calls.filter(([command])=>command==='native_set_open_at_login')).toHaveLength(1)
  })
})
