import {afterEach,describe,expect,it,vi} from 'vitest'
import {nativePlatform,type NativeInvoke} from './native-platform'
import {nativeQuickShare,QUICK_TEXT_LIMIT} from './quick-share'
const source='a'.repeat(32),target='b'.repeat(32)
const context={baseUrl:'https://home.example',sourceDeviceId:source,sourceDevice:'My Mac',devices:[{id:source,label:'My Mac',platform:'macos'},{id:target,label:'Phone',platform:'android'}]}
const routing={baseUrl:context.baseUrl,sourceDeviceId:source,targetDeviceIds:[target]}
afterEach(()=>{delete window.__TAURI__;delete window.__HOUSEHOLD_NATIVE__})
describe('Mac quick-share and login bridge',()=>{
  it('exposes only explicit Mac capabilities, without reading clipboard or login state',async()=>{
    for(const config of [{platform:'macos'},{platform:'linux',canQuickShare:true,canOpenAtLogin:true},{platform:'android',canQuickShare:true,canOpenAtLogin:true},{platform:'macos',canQuickShare:'true',canOpenAtLogin:'true'}]){
      const invoke=vi.fn<NativeInvoke>().mockResolvedValue(config),platform=await nativePlatform(invoke)
      expect(platform.quickShare).toBeUndefined();expect(platform.getOpenAtLogin).toBeUndefined();expect(platform.setOpenAtLogin).toBeUndefined();expect(invoke).toHaveBeenCalledTimes(1)
    }
    const invoke=vi.fn<NativeInvoke>().mockResolvedValue({platform:'macos',canQuickShare:true,canOpenAtLogin:true})
    const platform=await nativePlatform(invoke)
    expect(platform.quickShare).toBeDefined();expect(platform.getOpenAtLogin).toBeDefined();expect(invoke.mock.calls).toEqual([['native_get_config']])
  })
  it('checks persisted boolean login receipts and propagates errors without retry',async()=>{
    const invoke=vi.fn<NativeInvoke>().mockResolvedValueOnce({platform:'macos',canOpenAtLogin:true})
    const platform=await nativePlatform(invoke)
    invoke.mockResolvedValueOnce({enabled:true});expect(await platform.getOpenAtLogin!()).toEqual({enabled:true})
    invoke.mockResolvedValueOnce({enabled:false});expect(await platform.setOpenAtLogin!(false)).toEqual({enabled:false})
    expect(invoke).toHaveBeenLastCalledWith('native_set_open_at_login',{enabled:false})
    for(const value of [null,{}, {enabled:'true'},{enabled:false}]){
      invoke.mockResolvedValueOnce(value);await expect(platform.setOpenAtLogin!(true)).rejects.toThrow('could not be confirmed')
    }
    invoke.mockRejectedValueOnce(new Error('Move Drop to Applications'))
    await expect(platform.setOpenAtLogin!(true)).rejects.toThrow('Applications')
    expect(invoke.mock.calls.filter(([cmd])=>cmd==='native_set_open_at_login')).toHaveLength(6)
  })
  it('uses only dedicated commands and copied intake snapshots, with exact text and honest receipts',async()=>{
    const invoke=vi.fn<NativeInvoke>(async(command)=>{
      if(command==='native_quick_context')return context
      if(command==='native_quick_paste')return '\ufeff  <script>\r\n🐈\t  '
      if(command==='native_quick_send_text')return{itemId:'ready_note'}
      if(command==='native_quick_pick')return{queued:0,cancelled:true}
      if(command==='native_quick_drop')return{queued:2,cancelled:false}
    }),bridge=nativeQuickShare(invoke)
    expect(await bridge.context()).toEqual(context)
    const text=await bridge.paste();expect(await bridge.sendText(routing,text)).toEqual({itemId:'ready_note'})
    expect(invoke).toHaveBeenLastCalledWith('native_quick_send_text',{...routing,text})
    const targets=[target],snapshot={...routing,targetDeviceIds:targets},paths=['/one','/two']
    const picking=bridge.pick(snapshot,'folder');targets.length=0;expect(await picking).toEqual({queued:0,cancelled:true})
    expect(invoke).toHaveBeenLastCalledWith('native_quick_pick',{...routing,kind:'folder'})
    const dropping=bridge.drop(routing,paths);paths.length=0;expect(await dropping).toEqual({queued:2,cancelled:false})
    expect(invoke).toHaveBeenLastCalledWith('native_quick_drop',{...routing,paths:['/one','/two']})
    await bridge.resize(true);await bridge.hide();await bridge.open();await bridge.quit()
    expect(invoke.mock.calls.slice(-4)).toEqual([['native_quick_resize',{detail:true}],['native_quick_hide'],['native_quick_open'],['native_quick_quit']])
  })
  it('rejects malformed or oversized registries, clipboard and receipts without a mutation retry',async()=>{
    const invoke=vi.fn<NativeInvoke>(),bridge=nativeQuickShare(invoke)
    for(const invalid of [null,{...context,devices:Array(65).fill(context.devices[0])},{...context,devices:[context.devices[0],context.devices[0]]},{...context,devices:[{...context.devices[0],label:'bad\nname'}]},{...context,baseUrl:'https://home.example/path'},{...context,sourceDeviceId:'bad'}]){
      invoke.mockResolvedValueOnce(invalid);await expect(bridge.context()).rejects.toThrow()
    }
    for(const invalid of ['',null,'🐈'.repeat(QUICK_TEXT_LIMIT/4+1)]){
      invoke.mockResolvedValueOnce(invalid);await expect(bridge.paste()).rejects.toThrow(/plain text|8 MiB/)
    }
    for(const invalid of [null,{itemId:''}]){
      invoke.mockResolvedValueOnce(invalid);await expect(bridge.sendText(routing,'keep')).rejects.toThrow('may already be shared')
    }
    for(const invalid of [null,{queued:-1,cancelled:false},{queued:101,cancelled:false},{queued:1,cancelled:true},{queued:0}]){
      invoke.mockResolvedValueOnce(invalid);await expect(bridge.pick(routing,'file')).rejects.toThrow('could not be confirmed')
    }
    invoke.mockRejectedValueOnce(new Error('Outcome unknown'))
    await expect(bridge.sendText(routing,'keep')).rejects.toThrow('Outcome unknown')
    expect(invoke.mock.calls.filter(([cmd])=>cmd==='native_quick_send_text')).toHaveLength(3)
  })
})
