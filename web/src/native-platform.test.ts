import { describe, it, expect, vi } from 'vitest'
import { ApiClient } from './api'
import { nativePlatform, nativeTransferStatus, type NativeInvoke } from './native-platform'
import fixture from './native-contract.test-helper'
describe('native adapter contract', () => {
  it('matches the shared fixture for every visible desktop and Android lifecycle state',()=>{
    for (const [native, shared] of Object.entries(fixture.states)) {
      if (shared !== null) expect(nativeTransferStatus(native).state, native).toBe(shared)
    }
    expect(nativeTransferStatus('unrecognized-state').state).toBe('failed')
  })
  it('requires pairing when a saved server has disconnected credentials', async () => {
    const paired = await nativePlatform(vi.fn().mockResolvedValue(fixture.config))
    const unpaired = await nativePlatform(vi.fn().mockResolvedValue(fixture.unpairedConfig))
    expect(paired.requiresConnection).toBe(false)
    expect(unpaired.requiresConnection).toBe(true)
    expect(unpaired.baseURL).toBe(fixture.unpairedConfig.baseUrl)
    expect(unpaired.defaultDeviceName).toBe(fixture.unpairedConfig.sourceDevice)
    expect((await nativePlatform(vi.fn().mockResolvedValue({...fixture.config,baseUrl:''}))).requiresConnection).toBe(true)
  })
  it('blocks API calls without a configured connection and again after explicit disconnect', async () => {
    let config: Record<string,unknown> = {}
    const invoke=vi.fn<NativeInvoke>(async(command,args)=>{
      if(command==='native_get_config')return config
      if(command==='native_configure'){config={...fixture.config,baseUrl:args?.baseUrl};return null}
      if(command==='native_disconnect')return null
      if(command==='native_api')return {status:200,body:'{}'}
    })
    const adapter=await nativePlatform(invoke)
    expect(adapter.baseURL).toBeUndefined()
    await expect(adapter.request!('http://127.0.0.1:8787/api/items')).rejects.toThrow('Settings')
    expect(invoke.mock.calls.some(([command])=>command==='native_api')).toBe(false)
    await adapter.configureConnection!('https://chosen.example','','Phone')
    expect(adapter.requiresConnection).toBe(false)
    await adapter.request!('https://chosen.example/api/items')
    await adapter.disconnect!()
    expect(adapter.requiresConnection).toBe(true)
    await expect(adapter.request!('https://chosen.example/api/items')).rejects.toThrow('Settings')
    expect(invoke.mock.calls.filter(([command])=>command==='native_api')).toHaveLength(1)
  })
  it('preserves native response headers, exact fixture text, and empty HTTP responses', async () => {
    const invoke = vi.fn<NativeInvoke>(async command => command === 'native_get_config' ? fixture.config : fixture.apiResponse)
    const adapter = await nativePlatform(invoke)
    const api = new ApiClient(adapter.baseURL,adapter.request)
    expect(await api.text('note')).toBe(fixture.apiResponse.body)
    invoke.mockResolvedValueOnce({...fixture.apiResponse,headers:{...fixture.apiResponse.headers,'content-length':'123','etag':'"fixture"'}})
    const response = await adapter.request!(`${fixture.config.baseUrl}${fixture.apiRequest.path}`)
    expect(response.headers.get('content-type')).toBe(fixture.apiResponse.headers['content-type'])
    expect(response.headers.get('content-length')).toBe('123')
    expect(response.headers.get('etag')).toBe('"fixture"')
    invoke.mockResolvedValueOnce(fixture.noContentResponse)
    const empty = await adapter.request!(`${fixture.config.baseUrl}/api/items/note/trash`,{method:'POST'})
    expect(empty.status).toBe(204)
    expect(empty.body).toBeNull()
  })
  it('uses bounded native API and preserves full text without browser fetch or cookies', async () => {
    const raw = '\ufeff  native\r\n🦊\t\n  '
    const invoke = vi.fn(async (command: string) => command === 'native_get_config' ? {baseUrl:'https://private.example',sourceDevice:'Mac'} : {status:200,body:raw})
    const adapter = await nativePlatform(invoke)
    const api = new ApiClient(adapter.baseURL,adapter.request)
    expect(await api.text('note')).toBe(raw)
    expect(invoke).toHaveBeenCalledWith('native_api',expect.objectContaining({method:'GET',path:'/api/items/note/text',requestId:expect.any(String)}))
    await expect(adapter.request!('https://other.example/api/items')).rejects.toThrow('configured household')
    await expect(adapter.request!('https://private.example/not-api')).rejects.toThrow('configured household')
  })
  it('cancels preparation through the native request identifier without waiting for a full response', async () => {
    const invoke=vi.fn(async(command:string)=>{
      if(command==='native_get_config')return {baseUrl:'https://private.example'}
      if(command==='native_api')return new Promise(()=>{})
    })
    const adapter=await nativePlatform(invoke)
    const controller=new AbortController()
    const pending=adapter.request!('https://private.example/api/items/note/text',{signal:controller.signal})
    controller.abort()
    await expect(pending).rejects.toHaveProperty('name','AbortError')
    expect(invoke).toHaveBeenCalledWith('native_cancel_api',expect.objectContaining({requestId:expect.any(String)}))
  })
  it('uses native pickers and queue downloads without sending file bytes through JS', async () => {
    const invoke = vi.fn(async (command:string) => command === 'native_get_config' ? {baseUrl:'https://private.example'} : undefined)
    const adapter = await nativePlatform(invoke)
    await adapter.chooseFiles!('text','Kitchen Mac')
    expect(invoke).toHaveBeenCalledWith('native_pick_uploads',{kind:'text',sourceDevice:'Kitchen Mac'})
    await adapter.download({url:'https://private.example/api/items/file/download',name:'huge.zip',itemId:'file'})
    expect(invoke).toHaveBeenCalledWith('native_download',{itemId:'file',name:'huge.zip'})
    expect(() => adapter.transfers.enqueue([new File([],'file')],'file','Mac',1)).toThrow('Add files')
  })
  it('propagates native clipboard rejection and configures without a browser session', async () => {
    const invoke = vi.fn(async (command:string) => {
      if(command === 'native_get_config') return {baseUrl:'https://private.example'}
      if(command === 'native_copy_text') throw new Error('OS clipboard rejected write')
    })
    const adapter = await nativePlatform(invoke as NativeInvoke)
    await expect(adapter.copyText('exact text')).rejects.toThrow('clipboard rejected')
    await adapter.configureConnection!('https://second.example','native-token','Android')
    expect(invoke).toHaveBeenCalledWith('native_configure',{baseUrl:'https://second.example',token:'native-token',sourceDevice:'Android'})
    expect(JSON.stringify(localStorage)).not.toContain('native-token')
  })
})

describe('native Zing device extension',()=>{
  it('refreshes redacted identity after configure and routes pickers with flat copied targets',async()=>{
    const invoke=vi.fn<NativeInvoke>().mockResolvedValueOnce(fixture.config).mockResolvedValueOnce(null).mockResolvedValueOnce({...fixture.config,baseUrl:'https://second.example',deviceId:'4'.repeat(32),platform:'linux'})
    const adapter=await nativePlatform(invoke)
    expect(adapter.deviceIdentity).toEqual({id:fixture.config.deviceId,platform:fixture.config.platform})
    await adapter.configureConnection!('https://second.example','secret','Desk')
    expect(adapter.deviceIdentity).toEqual({id:'4'.repeat(32),platform:'linux'});expect(adapter.baseURL).toBe('https://second.example')
    const targets=[...fixture.sendRouting.targetDeviceIds];await adapter.chooseFiles!('file','Desk',targets);targets.length=0
    expect(invoke).toHaveBeenCalledWith('native_pick_uploads',{kind:'file',sourceDevice:'Desk',targetDeviceIds:fixture.sendRouting.targetDeviceIds})
    invoke.mockResolvedValueOnce(fixture.arrivalSettings);expect(await adapter.getArrivalSettings!()).toEqual(fixture.arrivalSettings)
    invoke.mockResolvedValueOnce({...fixture.arrivalSettings,enabled:false});await adapter.setArrivalEnabled!(false)
    expect(invoke).toHaveBeenCalledWith('native_set_arrival_enabled',{enabled:false})
    invoke.mockResolvedValueOnce(fixture.arrivalTarget);expect(await adapter.takeArrivalTarget!()).toEqual(fixture.arrivalTarget)
    expect(JSON.stringify(localStorage)).not.toContain('secret')
  })
})

describe('native shared editing compatibility',()=>{
  it('routes versioned exact-text PATCH and TXT/MD saves through existing commands, retaining conflict status',async()=>{
    const invoke=vi.fn<NativeInvoke>(async(command,args)=>{
      if(command==='native_get_config')return fixture.config
      if(command==='native_api'&&args?.method==='PATCH')return {status:409,body:'{"error":{"code":"edit_conflict","message":"Changed elsewhere"}}'}
      if(command==='native_download')return null
      return fixture.apiResponse
    })
    const adapter=await nativePlatform(invoke);const api=new ApiClient(adapter.baseURL,adapter.request)
    const edit={name:'家.md',text:fixture.apiResponse.body,expectedUpdatedAt:'2026-10-23T12:00:00.000000001Z'}
    await expect(api.edit('note',edit)).rejects.toMatchObject({status:409,code:'edit_conflict'})
    expect(invoke).toHaveBeenCalledWith('native_api',expect.objectContaining({method:'PATCH',path:'/api/items/note',body:JSON.stringify(edit)}))
    for(const format of ['txt','md'] as const)await adapter.download({url:api.downloadURL('note',format),name:`家.${format}`,itemId:'note'})
    expect(invoke).toHaveBeenCalledWith('native_download',{itemId:'note',name:'家.txt'})
    expect(invoke).toHaveBeenCalledWith('native_download',{itemId:'note',name:'家.md'})
    expect(invoke.mock.calls.filter(([command])=>command==='native_api')).toHaveLength(1)
  })
})

describe('optional desktop naming',()=>{
  it.each(['macos','linux'] as const)('renames a capable %s installation without reconfiguring credentials or identity',async platform=>{
    const config={...fixture.config,sourceDevice:'Desktop',platform,canRenameDevice:true}
    const invoke=vi.fn<NativeInvoke>(async command=>command==='native_get_config'?config:null)
    const adapter=await nativePlatform(invoke)
    await adapter.renameDevice!('Kitchen computer')
    expect(invoke).toHaveBeenLastCalledWith('native_rename_device',{sourceDevice:'Kitchen computer'})
    expect(adapter.defaultDeviceName).toBe('Kitchen computer')
    expect(adapter.deviceIdentity).toEqual({id:config.deviceId,platform})
    expect(adapter.baseURL).toBe(config.baseUrl);expect(adapter.requiresConnection).toBe(false)
    expect(invoke.mock.calls.map(([command])=>command)).toEqual(['native_get_config','native_rename_device'])
    invoke.mockRejectedValueOnce(new Error('Disk unavailable'))
    await expect(adapter.renameDevice!('New draft')).rejects.toThrow('Disk unavailable')
    expect(adapter.defaultDeviceName).toBe('Kitchen computer')
  })
  it('does not expose desktop rename for legacy, nonboolean or Android capability metadata',async()=>{
    for(const config of [{...fixture.config,platform:'macos'},{...fixture.config,platform:'linux',canRenameDevice:'true'},{...fixture.config,platform:'android',canRenameDevice:true}]){
      const invoke=vi.fn<NativeInvoke>().mockResolvedValue(config)
      expect((await nativePlatform(invoke)).renameDevice).toBeUndefined()
      expect(invoke).toHaveBeenCalledTimes(1)
    }
  })
})

describe('optional local appearance dispatch',()=>{
  const settings={appearance:'system' as const,resolvedTheme:'light' as const,canvas:'#F7F8FA',header:'#18334A',navigation:'#FFFFFF'}
  it('uses the exact Android flat command, validates independent OS preference and never uses HTTP',async()=>{
    const invoke=vi.fn<NativeInvoke>(async command=>command==='native_get_config'?{platform:'android'}:{systemTheme:'dark'})
    const adapter=await nativePlatform(invoke);expect(await adapter.setAppearance!(settings)).toEqual({systemTheme:'dark'});expect(invoke).toHaveBeenLastCalledWith('native_set_appearance',settings)
    for(const invalid of [{...settings,header:'transparent'},{...settings,canvas:'#abc'},{...settings,appearance:'os'},{...settings,resolvedTheme:'system'},{...settings,appearance:'dark',resolvedTheme:'light'}])await expect(adapter.setAppearance!(invalid as typeof settings)).rejects.toThrow('Invalid native appearance')
    expect(invoke).toHaveBeenCalledTimes(2);invoke.mockResolvedValueOnce({systemTheme:'invalid'});await expect(adapter.setAppearance!(settings)).rejects.toThrow('invalid system appearance')
  })
  it('leaves older desktops without a global window setter as CSS-only',async()=>{
    const invoke=vi.fn<NativeInvoke>().mockResolvedValue({platform:'macos'});expect((await nativePlatform(invoke)).setAppearance).toBeUndefined();expect(invoke).toHaveBeenCalledTimes(1)
    window.__TAURI__={core:{invoke},window:{getCurrentWindow(){throw new Error('No window namespace')}}};try{expect((await nativePlatform(invoke)).setAppearance).toBeUndefined()}finally{delete window.__TAURI__}
  })
})

describe('desktop path-only file drop',()=>{
  it('binds the existing Tauri window drop API and enqueues unique native paths with a routing snapshot',async()=>{
    const receives=new Map<string,(event:{payload:any})=>void>()
    const unlisten=vi.fn(),bind=vi.fn(async(event:string,callback:(event:{payload:any})=>void)=>{receives.set(event,callback);return unlisten})
    window.__TAURI__={core:{invoke:vi.fn()},window:{getCurrentWindow:()=>({setTheme:async()=>{},listen:bind})}}
    try{
      const invoke=vi.fn<NativeInvoke>(async command=>command==='native_get_config'?{...fixture.config,platform:'linux'}:null)
      const adapter=await nativePlatform(invoke),events:any[]=[]
      const stop=await adapter.onFileDrop!(event=>events.push(event))
      receives.get('tauri://drag-enter')!({payload:{}});receives.get('tauri://drag-drop')!({payload:{paths:['/home/me/20GB.zip']}});expect(events).toEqual([{type:'enter'},{type:'drop',paths:['/home/me/20GB.zip']}])
      await adapter.enqueuePaths!(['/home/me/20GB.zip','/home/me/20GB.zip','/home/me/other.bin'],['2'.repeat(32)])
      expect(invoke.mock.calls.filter(([command])=>command==='native_enqueue_upload')).toEqual([
        ['native_enqueue_upload',{path:'/home/me/20GB.zip',kind:'file',targetDeviceIds:['2'.repeat(32)]}],
        ['native_enqueue_upload',{path:'/home/me/other.bin',kind:'file',targetDeviceIds:['2'.repeat(32)]}],
      ])
      await stop();expect(unlisten).toHaveBeenCalledTimes(4)
      await expect(adapter.enqueuePaths!(['bad\0path'],[])).rejects.toThrow('valid file paths')
      await adapter.disconnect!();await expect(adapter.enqueuePaths!(['/home/me/new.bin'],[])).rejects.toThrow('Remaining dropped files were not queued')
    }finally{delete window.__TAURI__}
  })
  it('stops after an ambiguous native enqueue failure without repeating accepted paths or falling back to JS',async()=>{
    window.__TAURI__={core:{invoke:vi.fn()},window:{getCurrentWindow:()=>({setTheme:async()=>{},listen:async()=>()=>{}})}}
    try{
      const calls:string[]=[]
      const invoke=vi.fn<NativeInvoke>(async(command,args)=>{if(command==='native_get_config')return {...fixture.config,platform:'macos'};if(command==='native_enqueue_upload'){calls.push(String(args?.path));if(calls.length===2)throw Error('Native enqueue outcome unknown')}})
      const adapter=await nativePlatform(invoke)
      await expect(adapter.enqueuePaths!(['/one','/two','/three'],[])).rejects.toThrow('outcome unknown')
      expect(calls).toEqual(['/one','/two'])
    }finally{delete window.__TAURI__}
  })
  it('rolls back partial listener setup and attempts every async unlisten even when one fails',async()=>{
    const first=vi.fn(async()=>{throw Error('cleanup failed')}),second=vi.fn(async()=>{}),callbacks:((event:{payload:{paths?:string[]}})=>void)[]=[]
    const listen=vi.fn(async(_event:string,callback:(event:{payload:{paths?:string[]}})=>void)=>{callbacks.push(callback);if(callbacks.length===3)throw Error('listen denied');return callbacks.length===1?first:second})
    window.__TAURI__={core:{invoke:vi.fn()},window:{getCurrentWindow:()=>({setTheme:async()=>{},listen})}}
    try{
      const adapter=await nativePlatform(vi.fn(async()=>({...fixture.config,platform:'linux'}))),events:any[]=[]
      await expect(adapter.onFileDrop!(event=>events.push(event))).rejects.toThrow('Use Add files')
      expect(first).toHaveBeenCalledOnce();expect(second).toHaveBeenCalledOnce();callbacks[0]({payload:{}});expect(events).toEqual([])
      listen.mockImplementation(async()=>first)
      const stop=await adapter.onFileDrop!(event=>events.push(event));await expect(stop()).rejects.toThrow('release file drop listeners');expect(first).toHaveBeenCalledTimes(5)
    }finally{delete window.__TAURI__}
  })
  it('does not attach desktop file drop to Android or older shells',async()=>{
    const invoke=vi.fn<NativeInvoke>(async()=>({...fixture.config,platform:'android'}))
    expect((await nativePlatform(invoke)).onFileDrop).toBeUndefined()
    expect((await nativePlatform(vi.fn(async()=>fixture.config))).onFileDrop).toBeUndefined()
  })
})
