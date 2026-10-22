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
      if (command === 'native_api') {
        if (!connected) return {status:401,body:'{"error":{"message":"Connect first"}}'}
        if (String(args?.path).startsWith('/api/items?')) return {status:200,body:'{"items":[],"nextCursor":null}'}
        if (args?.path === '/api/storage') return {status:200,body:JSON.stringify({usedBytes:0,freeBytes:100000,maxFileBytes:21474836480,maxTextBytes:33554432,maxStorageBytes:null})}
        return {status:200,body:'{"status":"ok"}'}
      }
      throw new Error(`Unexpected command: ${command}`)
    })
    window.householdPlatform = await nativePlatform(invoke)
    render(<App />)
    const dialog = screen.getByRole('dialog',{name:'Connect to Household'})
    expect(within(dialog).getByLabelText('Household server')).toHaveValue(fixture.unpairedConfig.baseUrl)
    fireEvent.change(within(dialog).getByLabelText('App token'),{target:{value:'pairing-token'}})
    fireEvent.click(within(dialog).getByRole('button',{name:'Connect household'}))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(invoke).toHaveBeenCalledWith('native_configure',{baseUrl:fixture.unpairedConfig.baseUrl,token:'pairing-token',sourceDevice:fixture.unpairedConfig.sourceDevice})
    fireEvent.click(screen.getByRole('button',{name:'Connection and device settings'}))
    fireEvent.click(await screen.findByRole('button',{name:'Disconnect this app'}))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('native_disconnect'))
    expect(await screen.findByRole('dialog',{name:'Connect to Household'})).toBeInTheDocument()
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
