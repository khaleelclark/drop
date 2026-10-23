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
    const empty = await adapter.request!(`${fixture.config.baseUrl}/api/items/note`,{method:'DELETE'})
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
