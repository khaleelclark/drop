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
