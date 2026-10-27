import {act,screen} from '@testing-library/react'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {startApplication} from './bootstrap'
import type {NativeInvoke} from './native-platform'
afterEach(()=>{delete window.__TAURI__;delete window.__HOUSEHOLD_NATIVE__;delete window.householdPlatform;window.history.replaceState(null,'','/');vi.unstubAllGlobals()})
describe('bundled Mac quick-share bootstrap',()=>{
  it.each([
    {platform:'macos',canQuickShare:true,query:'?quick-share=1',quick:true},
    {platform:'macos',canQuickShare:true,query:'',quick:false},
    {platform:'macos',canQuickShare:false,query:'?quick-share=1',quick:false},
    {platform:'linux',canQuickShare:true,query:'?quick-share=1',quick:false},
    {platform:'android',canQuickShare:true,query:'?quick-share=1',quick:false},
    {platform:'browser',canQuickShare:false,query:'?quick-share=1',quick:false},
  ])('renders only the capability-gated local panel: $platform $query capability=$canQuickShare',async runtime=>{
    window.history.replaceState(null,'',`/${runtime.query}`)
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:401})))
    const invoke=vi.fn<NativeInvoke>(async command=>{
      if(command==='native_get_config')return{platform:runtime.platform,canQuickShare:runtime.canQuickShare,connected:false}
      if(command==='native_quick_context')return{baseUrl:'https://home.example',sourceDeviceId:'a'.repeat(32),sourceDevice:'Mac',devices:[]}
      if(command==='native_list_transfers')return[]
      return null
    })
    if(runtime.platform!=='browser')window.__HOUSEHOLD_NATIVE__={platform:runtime.platform,invoke}
    const element=document.createElement('div');document.body.append(element)
    let root!:Awaited<ReturnType<typeof startApplication>>
    try{
      await act(async()=>{root=await startApplication(element)})
      if(runtime.quick){
        expect(screen.getByRole('main',{name:'Drop quick share'})).toBeInTheDocument()
        expect(screen.queryByRole('heading',{name:'All shares'})).not.toBeInTheDocument()
        expect(invoke.mock.calls.some(([cmd])=>cmd==='native_list_transfers'||cmd==='native_api'||cmd==='native_quick_paste')).toBe(false)
      }else{
        expect(screen.queryByRole('main',{name:'Drop quick share'})).not.toBeInTheDocument()
        expect(screen.getByRole('heading',{name:'All shares'})).toBeInTheDocument()
        expect(invoke.mock.calls.some(([cmd])=>cmd.startsWith('native_quick_'))).toBe(false)
      }
    }finally{await act(async()=>root.unmount());element.remove()}
  })
})
