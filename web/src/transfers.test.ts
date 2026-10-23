import { describe, it, expect, vi } from 'vitest'
import { File as NodeFile } from 'node:buffer'
import { createHash } from 'node:crypto'
import { waitFor } from '@testing-library/react'
import { DetailedError, type UploadOptions } from 'tus-js-client'
import { BrowserTransfers, safeUploadURL, type UploadLike } from './transfers'
const origin = 'https://household.example'
describe('resumable browser queue', () => {
  it('uses bounded chunks, correct metadata, credentials, and pause/resume URL', async () => {
    let options!: UploadOptions
    const abort = vi.fn().mockResolvedValue(undefined); const start = vi.fn()
    const factory = vi.fn((_file: File, opts: UploadOptions): UploadLike => { options = opts; return { abort, start, url: `${origin}/api/uploads/one` } })
    const queue = new BrowserTransfers(origin, vi.fn(), factory)
    queue.enqueue([new File([], 'empty.txt', { type: 'text/plain', lastModified: 99 })], 'text', 'My Mac', 20 * 1024 ** 3)
    await waitFor(() => expect(start).toHaveBeenCalled())
    expect(options.chunkSize).toBe(8 * 1024 ** 2)
    const lost=new DetailedError('lost response');lost.originalRequest={getMethod:()=> 'POST'} as never
    expect(options.onShouldRetry?.(lost,0,options)).toBe(false)
    lost.originalRequest={getMethod:()=> 'PATCH'} as never;expect(options.onShouldRetry?.(lost,0,options)).toBe(true)
    expect(options.metadata).toEqual({ filename: 'empty.txt', filetype: 'text/plain', kind: 'text', sourceDevice: 'My Mac' })
    const xhr = { withCredentials: false }; options.onBeforeRequest?.({ getUnderlyingObject: () => xhr } as never)
    expect(xhr.withCredentials).toBe(true)
    options.onUploadUrlAvailable?.()
    const id = queue.getSnapshot()[0].id
    await queue.pause(id); expect(abort).toHaveBeenCalledWith(false); expect(queue.getSnapshot()[0].state).toBe('paused')
    queue.resume(id)
    await waitFor(() => expect(factory).toHaveBeenCalledTimes(2))
    expect(options.uploadUrl).toBe(`${origin}/api/uploads/one`)
    expect(JSON.parse(localStorage.getItem('household.transfers.v1')!)[0].uploadURL).toBe(`${origin}/api/uploads/one`)
  })
  it('restores incomplete records as needs-file and refuses a different source', async () => {
    localStorage.setItem('household.transfers.v1', JSON.stringify([{ id:'one',name:'original.txt',size:9,lastModified:10,kind:'file',sourceDevice:'Mac',destination:origin,state:'uploading',confirmed:4,sent:8,uploadURL:`${origin}/api/uploads/one` }]))
    const queue = new BrowserTransfers(origin)
    expect(queue.getSnapshot()[0]).toMatchObject({ state: 'needs-file', sent: 4 })
    await expect(queue.reattach('one', new File(['different'], 'original.txt', {lastModified:11}))).rejects.toThrow('original file')
  })
  it('cancels a running upload on the server and removes its saved state', async () => {
    const abort = vi.fn().mockResolvedValue(undefined)
    const queue = new BrowserTransfers(origin, vi.fn(), () => ({ abort, start:vi.fn(),url:`${origin}/api/uploads/one` }))
    queue.enqueue([new File([], 'empty')], 'file', 'Mac', 1)
    await waitFor(() => expect(queue.getSnapshot()[0].state).toBe('uploading'))
    await queue.cancel(queue.getSnapshot()[0].id)
    expect(abort).toHaveBeenCalledWith(true); expect(queue.getSnapshot()).toEqual([])
    expect(JSON.parse(localStorage.getItem('household.transfers.v1')!)).toEqual([])
  })
  it.each([404,410])('clears an active upload already removed from the server (%s)', async status => {
    const error = new DetailedError('Upload no longer exists')
    error.originalResponse = {getStatus:()=>status} as NonNullable<DetailedError['originalResponse']>
    const abort = vi.fn().mockRejectedValue(error)
    const changed = vi.fn()
    const queue = new BrowserTransfers(origin, changed, () => ({abort,start:vi.fn(),url:`${origin}/api/uploads/one`}))
    queue.enqueue([new File([], 'empty')], 'file', 'Mac', 1)
    await waitFor(() => expect(queue.getSnapshot()[0].state).toBe('uploading'))
    await queue.cancel(queue.getSnapshot()[0].id)
    expect(abort).toHaveBeenCalledWith(true)
    expect(queue.getSnapshot()).toEqual([])
    expect(JSON.parse(localStorage.getItem('household.transfers.v1')!)).toEqual([])
    expect(changed).toHaveBeenCalledOnce()
  })
  it.each([409,500])('retains a recoverable active cancellation failure (%s)', async status => {
    const error = new DetailedError('Server could not terminate upload')
    error.originalResponse = {getStatus:()=>status} as NonNullable<DetailedError['originalResponse']>
    const abort = vi.fn().mockRejectedValue(error)
    const queue = new BrowserTransfers(origin, vi.fn(), () => ({abort,start:vi.fn(),url:`${origin}/api/uploads/one`}))
    queue.enqueue([new File([], 'empty')], 'file', 'Mac', 1)
    await waitFor(() => expect(queue.getSnapshot()[0].state).toBe('uploading'))
    await expect(queue.cancel(queue.getSnapshot()[0].id)).rejects.toThrow('could not terminate')
    expect(queue.getSnapshot()[0]).toMatchObject({state:'failed',error:expect.stringContaining('could not terminate')})
    expect(JSON.parse(localStorage.getItem('household.transfers.v1')!)).toHaveLength(1)
  })
  it('rejects changed bytes in the middle even when name, size, and modified time match', async () => {
    const prefix='p'.repeat(128*1024); const suffix='s'.repeat(128*1024)
    const original=prefix+'A'+suffix; const changed=prefix+'B'+suffix
    localStorage.setItem('household.transfers.v1',JSON.stringify([{id:'one',name:'source.bin',size:original.length,lastModified:10,kind:'file',sourceDevice:'Mac',destination:origin,state:'uploading',confirmed:1,sent:1,uploadURL:`${origin}/api/uploads/one`,hash:createHash('sha256').update(original).digest('hex')}]))
    const factory=vi.fn(); const queue=new BrowserTransfers(origin,vi.fn(),factory)
    await queue.reattach('one',new NodeFile([changed],'source.bin',{lastModified:10}) as unknown as File)
    await waitFor(()=>expect(queue.getSnapshot()[0].state).toBe('failed'))
    expect(queue.getSnapshot()[0].error).toContain('bytes differ')
    expect(factory).not.toHaveBeenCalled()
  })
  it('never resumes a stored upload against another origin or a non-upload route', () => {
    expect(() => safeUploadURL('https://evil.example/api/uploads/one', origin)).toThrow('server')
    expect(() => safeUploadURL(`${origin}/api/items/one`, origin)).toThrow('server')
    expect(() => safeUploadURL(`${origin}/api/uploads/one?secret=x`, origin)).toThrow('server')
  })
})

describe('saved upload destinations',()=>{
  it('retains copied target IDs across selection changes, pause, reload and source reselection',async()=>{
    const targets=['2'.repeat(32)];let options!:UploadOptions
    const queue=new BrowserTransfers(origin,vi.fn(),(_file,opts)=>{options=opts;return {start:vi.fn(),abort:vi.fn(),url:`${origin}/api/uploads/one`}})
    const file=new File([],'empty.txt',{lastModified:99})
    queue.enqueue([file],'text','My Mac',100,{sourceDeviceId:'1'.repeat(32),targetDeviceIds:targets})
    targets[0]='3'.repeat(32)
    await waitFor(()=>expect(options?.metadata).toBeDefined())
    expect(options.metadata).toMatchObject({sourceDeviceId:'1'.repeat(32),targetDeviceIds:JSON.stringify(['2'.repeat(32)])})
    const id=queue.getSnapshot()[0].id;await queue.pause(id)
    const factory=vi.fn((_file:File,opts:UploadOptions)=>{options=opts;return {start:vi.fn(),abort:vi.fn(),url:`${origin}/api/uploads/one`}})
    const restored=new BrowserTransfers(origin,vi.fn(),factory)
    await restored.reattach(id,file);await waitFor(()=>expect(factory).toHaveBeenCalled())
    expect(options.metadata).toMatchObject({sourceDeviceId:'1'.repeat(32),targetDeviceIds:JSON.stringify(['2'.repeat(32)])})
  })
})
