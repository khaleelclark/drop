import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import fixture from './native-contract.test-helper'
import { App } from './App'
import { nativePlatform, type NativeInvoke } from './native-platform'
import { TransferQueue } from './TransferQueue'

afterEach(() => { delete window.householdPlatform; vi.unstubAllGlobals() })

describe('shared native fixture at the interface boundary', () => {
  it('opens pairing for disconnected saved configuration and calls native disconnect before returning to setup', async () => {
    let connected = false
    const browserFetch = vi.fn().mockRejectedValue(new Error('Native UI must not use browser fetch'))
    vi.stubGlobal('fetch',browserFetch)
    const invoke = vi.fn<NativeInvoke>(async (command,args) => {
      if (command === 'native_get_config') return connected ? fixture.config : fixture.unpairedConfig
      if (command === 'native_configure') { connected = true; return null }
      if (command === 'native_disconnect') { connected = false; return null }
      if (command === 'native_list_transfers') return []
      if (command === 'native_get_arrival_settings') return fixture.arrivalSettings
      if (command === 'native_take_arrival_target') return null
      if (command === 'native_api') {
        if (!connected) return {status:401,body:'{"error":{"message":"Connect first"}}'}
        if (String(args?.path).startsWith('/api/items?')) return {status:200,body:'{"items":[],"nextCursor":null}'}
        if (args?.path === '/api/devices')return {status:200,body:JSON.stringify({devices:[fixture.device]})}
        if (args?.path === '/api/devices/register')return {status:200,body:JSON.stringify({device:fixture.device})}
        if (args?.path === '/api/storage') return {status:200,body:JSON.stringify({usedBytes:0,freeBytes:100000,maxFileBytes:21474836480,maxTextBytes:33554432,maxStorageBytes:null})}
        return {status:200,body:'{"status":"ok"}'}
      }
      throw new Error(`Unexpected command: ${command}`)
    })
    window.householdPlatform = await nativePlatform(invoke)
    render(<App />)
    const dialog = screen.getByRole('dialog',{name:'Connect to Zing'})
    expect(within(dialog).getByLabelText('Household server')).toHaveValue(fixture.unpairedConfig.baseUrl)
    fireEvent.click(within(dialog).getByRole('button',{name:'Advanced · Use app token'}))
    fireEvent.change(within(dialog).getByLabelText('App token (optional)'),{target:{value:'pairing-token'}})
    fireEvent.click(within(dialog).getByRole('button',{name:'Connect household'}))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(invoke).toHaveBeenCalledWith('native_configure',{baseUrl:fixture.unpairedConfig.baseUrl,token:'pairing-token',sourceDevice:fixture.unpairedConfig.sourceDevice})
    fireEvent.click(screen.getByRole('button',{name:'Connection and device settings'}))
    fireEvent.click(await screen.findByRole('button',{name:'Disconnect this app'}))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('native_disconnect'))
    expect(await screen.findByRole('dialog',{name:'Connect to Zing'})).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Disconnect this app'})).not.toBeInTheDocument()
    expect((await nativePlatform(invoke)).requiresConnection).toBe(true)
    expect(browserFetch).not.toHaveBeenCalled()
    expect(JSON.stringify(localStorage)).not.toContain('pairing-token')
  })

  it('keeps validation pausable, retry resumable, completion clearable, and reselection in native control', async () => {
    const queue = [...fixture.queue,
      {...fixture.queue[0],id:'retry',name:'retry.bin',status:'retry_wait'},
      {...fixture.queue[0],id:'cancelled',name:'cancelled.bin',status:'cancelled'},
    ]
    const invoke = vi.fn<NativeInvoke>(async command => {
      if (command === 'native_get_config') return fixture.config
      if (command === 'native_list_transfers') return queue
      if (command === 'native_control') return null
      throw new Error(`Unexpected command: ${command}`)
    })
    const adapter = await nativePlatform(invoke)
    const onError = vi.fn()
    render(<TransferQueue store={adapter.transfers} onError={onError} />)
    expect(await screen.findByRole('button',{name:'Pause text.txt'})).toBeEnabled()
    expect(screen.getByRole('button',{name:'Resume retry.bin'})).toBeEnabled()
    expect(screen.queryByRole('button',{name:'Pause retry.bin'})).not.toBeInTheDocument()
    expect(screen.getByText('Saved on this device')).toBeInTheDocument()
    const upload = screen.getByRole('group',{name:'To household: 20GiB.bin'})
    expect(within(upload).getByText('To household ·')).toBeInTheDocument()
    expect(within(upload).getByRole('progressbar')).toHaveAttribute('value','42')
    const validation = screen.getByRole('group',{name:'To household: text.txt'})
    expect(within(validation).getByText('Waiting for server validation')).toBeInTheDocument()
    expect(within(validation).getByRole('progressbar')).not.toHaveAttribute('value')
    const download = screen.getByRole('group',{name:'To this device: saved.bin'})
    expect(within(download).getByText('To this device ·')).toBeInTheDocument()
    expect(within(download).getByText('Saved on this device')).toBeInTheDocument()
    expect(within(download).getByRole('progressbar')).toHaveAttribute('value','100')
    const retry = screen.getByRole('group',{name:'To household: retry.bin'})
    expect(within(retry).getByText('To household ·')).toBeInTheDocument()
    expect(within(retry).getByText('Waiting to retry')).toBeInTheDocument()
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument()
    expect(screen.queryByText('cancelled.bin')).not.toBeInTheDocument()
    const filePicker = screen.getByLabelText('Reselect original file') as HTMLInputElement
    const browserPickerClick = vi.spyOn(filePicker,'click')
    fireEvent.click(screen.getByRole('button',{name:'Reselect'}))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('native_control',{id:'needs-source',action:'resume'}))
    expect(browserPickerClick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'Resume retry.bin'}))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('native_control',{id:'retry',action:'resume'}))
    fireEvent.click(screen.getByRole('button',{name:'Pause text.txt'}))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('native_control',{id:'validating',action:'pause'}))
    fireEvent.click(screen.getByRole('button',{name:'Clear finished'}))
    expect(screen.queryByText('saved.bin')).not.toBeInTheDocument()
    // Native snapshots may retain completed rows. A refresh must keep a cleared row hidden.
    await adapter.transfers.reselect!('needs-source')
    expect(screen.queryByText('saved.bin')).not.toBeInTheDocument()
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('URL-only installed connection',()=>{
  it.each(['ready','offline',401,403] as const)('uses saved native configuration at startup (%s), with explicit recovery and settings',async startup=>{
    let failure:typeof startup|'ready'=startup
    const browserFetch=vi.fn().mockRejectedValue(new Error('No browser transport'))
    vi.stubGlobal('fetch',browserFetch)
    const invoke=vi.fn<NativeInvoke>(async(command,args)=>{
      if(command==='native_get_config')return fixture.config
      if(command==='native_list_transfers')return []
      if(command==='native_take_arrival_target')return null
      if(command==='native_get_arrival_settings')return fixture.arrivalSettings
      if(command==='native_api'){
        const path=String(args?.path)
        if(path.startsWith('/api/items?')){
          if(failure==='offline')throw new Error('Network unavailable')
          if(failure!=='ready')return {status:failure,body:'{"error":{"message":"Access denied"}}'}
          return {status:200,body:'{"items":[],"nextCursor":null}'}
        }
        if(path==='/api/devices/register')return {status:200,body:JSON.stringify({device:fixture.device})}
        if(path==='/api/devices')return {status:200,body:JSON.stringify({devices:[fixture.device]})}
        if(path==='/api/storage')return {status:200,body:'{"usedBytes":0,"freeBytes":1000,"maxFileBytes":21474836480,"maxTextBytes":33554432,"maxStorageBytes":null}'}
        return {status:200,body:'{}'}
      }
      throw new Error(`Unexpected command ${command}`)
    })
    window.householdPlatform=await nativePlatform(invoke);render(<App/>)
    if(startup!=='ready'){
      const alert=await screen.findByRole('alert')
      expect(alert).toHaveTextContent(startup==='offline'?'Check Tailscale':'Access was not accepted')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('button',{name:'Send to Everyone'})).toBeDisabled()
      fireEvent.click(within(alert).getByRole('button',{name:'Settings'}))
      const dialog=screen.getByRole('dialog',{name:'Connection settings'})
      expect(within(dialog).getByLabelText('Household server')).toHaveValue(fixture.config.baseUrl)
      expect(within(dialog).getByRole('button',{name:'Advanced · Use app token'})).toBeEnabled()
      fireEvent.click(within(dialog).getByRole('button',{name:'Close connection settings'}))
      failure='ready'
      fireEvent.click(screen.getByRole('button',{name:'Retry'}))
    }
    await waitFor(()=>expect(screen.getByRole('button',{name:'Send to Everyone'})).toBeEnabled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    if(startup==='ready'){
      failure=403
      await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh feed'})).toBeEnabled())
      fireEvent.click(screen.getByRole('button',{name:'Refresh feed'}))
      expect(await screen.findByRole('alert')).toHaveTextContent('Access was not accepted')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      failure='ready';fireEvent.click(screen.getByRole('button',{name:'Retry'}))
      await waitFor(()=>expect(screen.getByRole('button',{name:'Send to Everyone'})).toBeEnabled())
    }
    fireEvent.click(screen.getByRole('button',{name:'Connection and device settings'}))
    expect(screen.getByRole('dialog',{name:'Connection settings'})).toBeInTheDocument()
    expect(invoke.mock.calls.some(([command])=>command==='native_configure')).toBe(false)
    expect(browserFetch).not.toHaveBeenCalled()
  })

  it.each([false,true])('verifies a protected native fetch before connected (failed=%s), without browser fallback',async fail=>{
    let configured=false
    let denied=fail
    const browserFetch=vi.fn().mockRejectedValue(new Error('No browser transport'))
    vi.stubGlobal('fetch',browserFetch)
    const invoke=vi.fn<NativeInvoke>(async(command,args)=>{
      if(command==='native_get_config')return configured?fixture.config:fixture.unpairedConfig
      if(command==='native_configure'){configured=true;return null}
      if(command==='native_list_transfers')return []
      if(command==='native_take_arrival_target')return null
      if(command==='native_api'){
        const path=String(args?.path)
        if(!configured||(denied&&path.startsWith('/api/items?')))return {status:401,body:'{"error":{"message":"Access denied"}}'}
        if(path.startsWith('/api/items?'))return {status:200,body:'{"items":[],"nextCursor":null}'}
        if(path==='/api/devices/register')return {status:200,body:JSON.stringify({device:fixture.device})}
        if(path==='/api/devices')return {status:200,body:JSON.stringify({devices:[fixture.device]})}
        if(path==='/api/storage')return {status:200,body:'{"usedBytes":0,"freeBytes":1000,"maxFileBytes":21474836480,"maxTextBytes":33554432,"maxStorageBytes":null}'}
        return {status:200,body:'{}'}
      }
      throw new Error(`Unexpected command ${command}`)
    })
    window.householdPlatform=await nativePlatform(invoke);render(<App/>)
    const dialog=screen.getByRole('dialog',{name:'Connect to Zing'})
    expect(within(dialog).queryByLabelText('App token (optional)')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button',{name:'Connect household'}))
    expect(await waitFor(()=>{expect(invoke).toHaveBeenCalledWith('native_configure',{baseUrl:fixture.unpairedConfig.baseUrl,token:'',sourceDevice:fixture.unpairedConfig.sourceDevice});return true})).toBe(true)
    if(fail){
      await waitFor(()=>expect(within(dialog).getByRole('alert')).toHaveTextContent('Access was not accepted'))
      expect(dialog).toBeInTheDocument();expect(within(dialog).getByRole('button',{name:'Advanced · Use app token'})).toBeEnabled()
      expect(screen.getByRole('button',{name:'Send to Everyone'})).toBeDisabled()
    }else{
      await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await waitFor(()=>expect(screen.getByRole('button',{name:'Send to Everyone'})).toBeEnabled())
      expect(invoke.mock.calls.some(([command,args])=>command==='native_api'&&args?.path==='/api/devices/register'&&JSON.parse(String(args.body)).preserveExisting===true)).toBe(true)
      denied=true
      await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh feed'})).toBeEnabled())
      fireEvent.click(screen.getByRole('button',{name:'Refresh feed'}))
      expect(await screen.findByRole('alert')).toHaveTextContent('Access was not accepted')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      denied=false;fireEvent.click(screen.getByRole('button',{name:'Retry'}))
      await waitFor(()=>expect(screen.getByRole('button',{name:'Send to Everyone'})).toBeEnabled())
    }
    expect(browserFetch).not.toHaveBeenCalled();expect(JSON.stringify(localStorage)).not.toContain('token')
  })
})
