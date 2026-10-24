import { describe, it, expect, vi } from 'vitest'
import { ApiClient, COPY_LIMIT } from './api'
describe('API contract', () => {
  it('posts exact Unicode, leading/trailing whitespace, tabs, and CRLF without trimming', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ item: { id: 'note' } })))
    const api = new ApiClient('https://household.example', request)
    const text = '  first\tline\r\n🦊 café\n\n   '
    await api.createText(text, 'Kitchen Mac')
    expect(request).toHaveBeenCalledWith('https://household.example/api/text', expect.objectContaining({ method: 'POST', credentials: 'include', cache: 'no-store', body: JSON.stringify({ text, sourceDevice: 'Kitchen Mac' }) }))
  })
  it('uses the returned cursor verbatim and URL-encodes query and IDs', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{"items":[],"nextCursor":null}'))
    const api = new ApiClient('https://household.example', request)
    const cursor = '2026-10-22T18:00:00.123456789Z+opaque/=='
    await api.list(' a & b ', cursor)
    const url = new URL(request.mock.calls[0][0]); expect(url.searchParams.get('before')).toBe(cursor); expect(url.searchParams.get('q')).toBe(' a & b ')
    expect(api.downloadURL('one/two?x')).toBe('https://household.example/api/items/one%2Ftwo%3Fx/download')
  })
  it('streams UTF-8 with exact newlines, including split multibyte characters', async () => {
    const bytes = new TextEncoder().encode('\ufeff  🦊\r\nhello\t\n ')
    const stream = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 3)); c.enqueue(bytes.slice(3, 5)); c.enqueue(bytes.slice(5)); c.close() } })
    const api = new ApiClient('https://household.example', vi.fn().mockResolvedValue(new Response(stream)))
    expect(await api.text('note')).toBe('\ufeff  🦊\r\nhello\t\n ')
  })
  it('refuses an oversized clipboard response before loading its body', async () => {
    const response = new Response('too big', { headers: { 'Content-Length': String(COPY_LIMIT + 1) } })
    const api = new ApiClient('https://household.example', vi.fn().mockResolvedValue(response))
    await expect(api.text('note')).rejects.toThrow('too large')
  })
  it('surfaces server errors and keeps tokens only in the session POST body', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{"error":{"code":"bad_token","message":"Token rejected"}}', { status: 401 }))
    const api = new ApiClient('https://household.example', request)
    await expect(api.session('private-token')).rejects.toThrow('Token rejected')
    const [url, init] = request.mock.calls[0]; expect(url).not.toContain('private-token'); expect(init.body).toBe('{"token":"private-token"}'); expect(localStorage.length).toBe(0)
  })
  it('rejects insecure remote origins and embedded credentials', () => {
    expect(() => new ApiClient('http://remote.example')).toThrow('HTTPS')
    expect(() => new ApiClient('https://token@household.example')).toThrow('password')
  })
})

describe('shared editing and text exports',()=>{
  it('sends the captured version with exact Unicode/control bytes, encodes IDs and format',async()=>{
    const request=vi.fn().mockImplementation(()=>Promise.resolve(new Response('{"item":{"id":"note"}}')))
    const api=new ApiClient('https://household.example',request)
    const changes={name:'家 🦊.md',text:'\ufeff  code\t\r\n<script>inert()</script>\n ',expectedUpdatedAt:'2026-10-23T10:00:00.000000001Z'}
    await api.edit('one/two',changes)
    expect(request).toHaveBeenCalledWith('https://household.example/api/items/one%2Ftwo',expect.objectContaining({method:'PATCH',body:JSON.stringify(changes)}))
    expect(api.downloadURL('one/two','md')).toBe('https://household.example/api/items/one%2Ftwo/download?format=md')
  })
  it('rejects decoded and encoded edit overflow before any request',()=>{
    const request=vi.fn();const api=new ApiClient('https://household.example',request)
    expect(()=>api.edit('note',{name:'note',text:'🦊'.repeat(COPY_LIMIT/4+1),expectedUpdatedAt:'version'})).toThrow('8 MiB')
    expect(()=>api.edit('note',{name:'note',text:'\u0001'.repeat(COPY_LIMIT),expectedUpdatedAt:'version'})).toThrow('40 MiB')
    expect(request).not.toHaveBeenCalled()
  })
  it('rejects non-UTF-8 and lengthless oversized text without repairing or truncating it',async()=>{
    let api=new ApiClient('https://household.example',vi.fn().mockResolvedValue(new Response(new Uint8Array([0xff,0xfe]))))
    await expect(api.text('binary')).rejects.toThrow()
    api=new ApiClient('https://household.example',vi.fn().mockResolvedValue(new Response(new Uint8Array(COPY_LIMIT+1))))
    await expect(api.text('large')).rejects.toThrow('too large')
  })
  it('preserves existing device metadata on startup and leaves explicit naming unguarded',async()=>{
    const request=vi.fn().mockImplementation(()=>Promise.resolve(new Response('{"device":{}}')))
    const api=new ApiClient('https://household.example',request);const device={id:'1'.repeat(32),label:'Old queued name',platform:'browser' as const}
    await api.register({...device,preserveExisting:true});await api.register({...device,label:'Explicit new name'})
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({preserveExisting:true})
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({...device,label:'Explicit new name'})
  })
})

describe('recoverable deletion safety',()=>{
  it('uses only explicit POST actions and a dedicated trash cursor; never legacy DELETE',async()=>{
    const request=vi.fn().mockImplementation((url:string)=>Promise.resolve(new Response(url.includes('/trash?')?JSON.stringify({items:[],nextCursor:null}):null,{status:url.includes('/trash?')?200:204})))
    const api=new ApiClient('https://household.example',request)
    await api.trashPage('old notes','deleted+cursor/=');for(const action of ['trash','restore','purge'] as const)await api.itemAction(action,'note')
    const url=new URL(request.mock.calls[0][0]);expect(url.pathname).toBe('/api/trash');expect(url.searchParams.get('before')).toBe('deleted+cursor/=')
    expect(request.mock.calls.slice(1).map(([url,init])=>[url,init.method])).toEqual(['trash','restore','purge'].map(action=>[`https://household.example/api/items/note/${action}`,'POST']))
  })
  it('rejects old-server active-feed envelopes and unsupported routes without another request',async()=>{
    const request=vi.fn().mockResolvedValue(new Response(JSON.stringify({items:[{id:'active'}],nextCursor:null})))
    const api=new ApiClient('https://household.example',request)
    await expect(api.trashPage()).rejects.toThrow('Invalid Recently Deleted')
    request.mockResolvedValue(new Response('not found',{status:404}))
    await expect(api.trashPage()).rejects.toMatchObject({code:'update_required'})
    await expect(api.itemAction('trash','note')).rejects.toMatchObject({status:404,message:'This item is no longer available.'})
    request.mockResolvedValue(new Response('not allowed',{status:405}))
    await expect(api.itemAction('trash','note')).rejects.toMatchObject({code:'update_required'})
    expect(request).toHaveBeenCalledTimes(4);expect(request.mock.calls.every(([,init])=>init.method!=='DELETE')).toBe(true)
  })
  it('validates the whole bounded batch before requesting and keeps ordered partial errors',async()=>{
    const results=[{id:'a',ok:true},{id:'b',ok:false,error:{status:409,code:'upload_active',message:'Use transfer Cancel'}}]
    const request=vi.fn().mockResolvedValue(new Response(JSON.stringify({results})))
    const api=new ApiClient('https://household.example',request)
    for(const ids of [[],['a','a'],['bad/id'],Array.from({length:101},(_,i)=>String(i))])await expect(api.itemActions('trash',ids)).rejects.toThrow('1–100')
    expect(request).not.toHaveBeenCalled();expect(await api.itemActions('trash',['a','b'])).toEqual(results)
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({action:'trash',ids:['a','b']})
  })
  it('treats malformed action receipts as unknown instead of reporting success',async()=>{
    const request=vi.fn().mockResolvedValue(new Response(JSON.stringify({results:[{id:'b',ok:true},{id:'a',ok:true}]})))
    await expect(new ApiClient('https://household.example',request).itemActions('purge',['a','b'])).rejects.toThrow('some items may have changed')
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('shared retention and whole-folder deletion',()=>{
  it('reads and explicitly persists the shared setting, rejects invalid days before requesting',async()=>{
    const request=vi.fn().mockImplementation((_url,init)=>Promise.resolve(new Response(init.body||'{"retentionDays":30}')))
    const api=new ApiClient('https://household.example',request)
    expect(await api.trashSettings()).toEqual({retentionDays:30})
    for(const days of [60,null,1,36500])expect(await api.trashSettings(days)).toEqual({retentionDays:days})
    for(const days of [0,-1,36501,1.5,NaN,'30',true])await expect(api.trashSettings(days as number)).rejects.toThrow('whole days')
    expect(request).toHaveBeenCalledTimes(5)
    expect(request.mock.calls.slice(1).map(([,init])=>init.method)).toEqual(['PATCH','PATCH','PATCH','PATCH'])
    request.mockResolvedValueOnce(new Response('{"retentionDays":60}'))
    await expect(api.trashSettings(30)).rejects.toThrow('Refresh settings before saving again')
  })
  it('validates folder counts and bounded names, and keeps the exact nanosecond cutoff/cursor',async()=>{
    const cutoff='2026-10-24T02:00:00.123456789Z',before='deleted+cursor/=='
    const request=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({count:201,cutoff,names:['one','two']}))).mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({results:[{id:'a',ok:true},{id:'b',ok:false,error:{status:409,code:'not_trashed',message:'Restored elsewhere'}}],nextCursor:null}))))
    const api=new ApiClient('https://household.example',request)
    expect((await api.trashSummary()).count).toBe(201)
    const page=await api.purgeTrash(cutoff,before);expect(page.results[1].ok).toBe(false)
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({cutoff,before});expect(request.mock.calls[1][1].method).toBe('POST')
  })
  it('stops on malformed or oversized receipts without retry or compatibility DELETE',async()=>{
    const request=vi.fn(),api=new ApiClient('https://household.example',request),cutoff='2026-10-24T02:00:00Z'
    for(const data of [{count:-1,cutoff,names:[]},{count:1,cutoff,names:Array(6).fill('x')},{count:2**54,cutoff,names:[]},{count:1,cutoff:'2026-02-30T02:00:00Z',names:[]},{count:1,cutoff:'2026-10-24T02:00:00+01:00',names:[]}]){request.mockResolvedValueOnce(new Response(JSON.stringify(data)));await expect(api.trashSummary()).rejects.toThrow('Invalid folder summary')}
    for(const data of [{results:Array.from({length:101},(_,n)=>({id:`n${n}`,ok:true})),nextCursor:null},{results:[{id:'a',ok:true},{id:'a',ok:true}],nextCursor:null},{results:[{id:'a',ok:false,error:{status:200,code:'bad',message:'bad'}}],nextCursor:null},{results:[],nextCursor:'same'}]){request.mockResolvedValueOnce(new Response(JSON.stringify(data)));await expect(api.purgeTrash(cutoff,'same')).rejects.toThrow('invalid folder deletion results')}
    expect(request).toHaveBeenCalledTimes(9);expect(request.mock.calls.every(([,init])=>init.method!=='DELETE')).toBe(true)
  })
  it('reports old settings/summary/purge routes as update-required without another request',async()=>{
    const request=vi.fn().mockImplementation(()=>Promise.resolve(new Response('missing',{status:404}))),api=new ApiClient('https://household.example',request)
    await expect(api.trashSettings()).rejects.toThrow('Update the household server')
    await expect(api.trashSummary()).rejects.toThrow('Update the household server')
    await expect(api.purgeTrash('2026-10-24T02:00:00Z')).rejects.toThrow('Update the household server')
    expect(request).toHaveBeenCalledTimes(3)
  })
})


describe('bounded item metadata',()=>{
  it('passes cancellation, preserves exact metadata, and rejects oversized or invalid UTF-8 JSON',async()=>{
    const controller=new AbortController(),request=vi.fn().mockResolvedValue(new Response(JSON.stringify({item:{id:'note',preview:'𐐀 exact\r\n'}})))
    const api=new ApiClient('https://household.example',request)
    expect(await api.item('note',controller.signal)).toEqual({item:{id:'note',preview:'𐐀 exact\r\n'}})
    expect(request.mock.calls[0][1].signal).toBe(controller.signal)
    request.mockResolvedValueOnce(new Response('x'.repeat(65537)))
    await expect(api.item('note')).rejects.toThrow('metadata is too large')
    request.mockResolvedValueOnce(new Response(new Uint8Array([0xff])))
    await expect(api.item('note')).rejects.toThrow()
  })
})
