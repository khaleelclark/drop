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
