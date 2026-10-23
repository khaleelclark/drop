import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { ApiClient } from './api'
import { arrivalKey, enableBrowserArrivals, processArrivals } from './arrivals'
import { sendRouting, validItemId } from './devices'
import type { Device } from './types'
const source='1'.repeat(32),target='2'.repeat(32)
const devices:Device[]=[{id:target,label:'Phone',platform:'android',createdAt:''}]
describe('recipient and arrival boundaries',()=>{
  it('snapshots explicit targets, preserves Everyone and rejects stale/self/duplicate targets',()=>{
    const ids=[target];const saved=sendRouting(source,ids,devices);ids.length=0
    expect(saved).toEqual({sourceDeviceId:source,targetDeviceIds:[target]})
    expect(sendRouting(source,[],devices).targetDeviceIds).toEqual([])
    for(const selected of [[source],[target,target],['3'.repeat(32)]])expect(()=>sendRouting(source,selected,devices)).toThrow('selected device')
    expect(()=>sendRouting('',[],devices)).toThrow('register')
  })
  it('uses exact routing JSON and applies For you to search and opaque pagination',async()=>{
    const request=vi.fn().mockImplementation(()=>Promise.resolve(new Response('{"items":[],"nextCursor":null}')))
    const api=new ApiClient('https://household.example',request)
    await api.createText(' exact\r\n ','Kitchen Mac',sendRouting(source,[target],devices))
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({text:' exact\r\n ',sourceDeviceId:source,targetDeviceIds:[target]})
    await api.list(' a & b ','opaque/+==',source)
    const url=new URL(request.mock.calls[1][0]);expect(url.searchParams.get('q')).toBe(' a & b ');expect(url.searchParams.get('before')).toBe('opaque/+==');expect(url.searchParams.get('forDevice')).toBe(source)
  })
  it('persists exact 64-bit progress before ACK and retries ACK without reposting',async()=>{
    const key=arrivalKey('https://household.example',source);let fail=true
    const api={arrivals:vi.fn(async(_id:string,after?:string)=>({notifications:after?[]:[{sequence:'9007199254740993',itemId:target,createdAt:''}],nextCursor:'9007199254740993',ackCursor:'0',hasMore:false})),acknowledge:vi.fn(async()=>{expect(localStorage.getItem(`${key}:cursor`)).toBe('9007199254740993');if(fail)throw new Error('offline');return {ackCursor:'9007199254740993'}})}
    const show=vi.fn().mockResolvedValue(undefined)
    await expect(processArrivals(api as unknown as ApiClient,source,key,show,()=>true)).rejects.toThrow('offline')
    expect(show).toHaveBeenCalledWith('Zing',expect.objectContaining({body:'New share available',tag:`${key}:9007199254740993`,data:{itemId:target}}))
    expect(JSON.stringify(show.mock.calls)).not.toContain('Phone')
    fail=false;await processArrivals(api as unknown as ApiClient,source,key,show,()=>true)
    expect(show).toHaveBeenCalledOnce();expect(api.arrivals).toHaveBeenLastCalledWith(source,'9007199254740993')
  })
  it('batches catch-up without dropping For you history or losing preceding cursors',async()=>{
    const api={arrivals:vi.fn(async()=>({notifications:[{sequence:'1',itemId:'first',createdAt:''},{sequence:'2',itemId:'last',createdAt:''}],nextCursor:'2',ackCursor:'0',hasMore:false})),acknowledge:vi.fn(async()=>({ackCursor:'2'}))}
    const show=vi.fn().mockResolvedValue(undefined);const key=arrivalKey('https://household.example',source)
    await processArrivals(api as unknown as ApiClient,source,key,show,()=>true)
    expect(show).toHaveBeenCalledOnce();expect(show).toHaveBeenCalledWith('Zing',expect.objectContaining({data:{itemId:'last'},tag:`${key}:2`}))
    expect(api.acknowledge).toHaveBeenCalledWith(source,'2');expect(localStorage.getItem(`${key}:cursor`)).toBe('2')
  })
  it('does not ACK a failed OS post, malformed cursor or unsafe click target',async()=>{
    const api={arrivals:vi.fn(async()=>({notifications:[{sequence:'1',itemId:target,createdAt:''}],nextCursor:'1',ackCursor:'0',hasMore:false})),acknowledge:vi.fn()}
    const key=arrivalKey('https://household.example',source)
    await expect(processArrivals(api as unknown as ApiClient,source,key,vi.fn().mockRejectedValue(new Error('permission denied')),()=>true)).rejects.toThrow('permission denied')
    expect(api.acknowledge).not.toHaveBeenCalled();expect(localStorage.getItem(`${key}:cursor`)).toBeNull()
    api.arrivals.mockResolvedValueOnce({notifications:[],nextCursor:'9223372036854775808',ackCursor:'0',hasMore:false})
    await expect(processArrivals(api as unknown as ApiClient,source,key,vi.fn(),()=>true)).rejects.toThrow('Invalid arrival')
    for(const id of ['https://evil.example','../file','a?token=x','<script>',''])expect(validItemId(id)).toBe(false)
  })
  it('requires explicit supported permission and leaves notifications off after denial',async()=>{
    vi.stubGlobal('isSecureContext',true)
    const permission=vi.fn().mockResolvedValue('denied')
    vi.stubGlobal('Notification',{requestPermission:permission,permission:'denied'})
    const descriptor=Object.getOwnPropertyDescriptor(navigator,'serviceWorker')
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:vi.fn()}})
    try {
      const key=arrivalKey('https://household.example',source)
      expect(permission).not.toHaveBeenCalled()
      await expect(enableBrowserArrivals(key,true)).rejects.toThrow('For you still works')
      expect(localStorage.getItem(`${key}:enabled`)).toBeNull()
      await enableBrowserArrivals(key,false);expect(localStorage.getItem(`${key}:enabled`)).toBe('false')
    }finally{if(descriptor)Object.defineProperty(navigator,'serviceWorker',descriptor);else Reflect.deleteProperty(navigator,'serviceWorker');vi.unstubAllGlobals()}
  })
  it('service worker clicks open only internal same-origin targets and do not cache private responses',async()=>{
    const handlers:Record<string,(event:unknown)=>void>={};const openWindow=vi.fn().mockResolvedValue(undefined)
    const self={location:{origin:'https://household.example'},addEventListener:(name:string,fn:(event:unknown)=>void)=>{handlers[name]=fn},clients:{matchAll:vi.fn().mockResolvedValue([]),openWindow}}
    runInNewContext(readFileSync('public/sw.js','utf8'),{self,URL})
    let pending:Promise<void>|undefined
    const click=(itemId:string)=>handlers.notificationclick({notification:{data:{itemId},close:vi.fn()},waitUntil:(promise:Promise<void>)=>{pending=promise}})
    click('https://evil.example');expect(openWindow).not.toHaveBeenCalled()
    click(target);await pending;expect(openWindow).toHaveBeenCalledWith(`https://household.example/?item=${target}`)
    const respondWith=vi.fn();handlers.fetch({request:{url:'https://household.example/api/items',method:'GET'},respondWith});expect(respondWith).not.toHaveBeenCalled()
    const focus=vi.fn().mockResolvedValue(undefined),postMessage=vi.fn();self.clients.matchAll.mockResolvedValueOnce([{url:'https://household.example/',focus,postMessage}] as never)
    click(target);await pending;expect(focus).toHaveBeenCalled();expect(postMessage).toHaveBeenCalledWith({type:'zing-arrival',itemId:target})
  })
})
