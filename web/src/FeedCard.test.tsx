import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ApiClient } from './api'
import { FeedCard } from './FeedCard'
import type { PlatformAdapter } from './platform'
import type { Item } from './types'
const item: Item = { id: 'note', kind: 'text', name: 'Text', size: 9, createdAt: '2026-10-22T18:00:00Z', updatedAt: '2026-10-22T18:00:00Z', status: 'ready', preview: 'TRUNCATED PREVIEW', pinned: false }
function setup(write: (text: string) => Promise<void>, fullText = '  all\ttext\r\n🦊\n  ', override: Partial<Item> = {}) {
  const api = new ApiClient('https://household.example', vi.fn().mockResolvedValue(new Response(fullText)))
  const notify = vi.fn(); const download = vi.fn().mockResolvedValue(undefined)
  const platform = { kind: 'browser', copyText: write, download } as unknown as PlatformAdapter
  render(<FeedCard item={{...item, ...override}} api={api} platform={platform} refresh={vi.fn()} notify={notify} />)
  return { notify, download }
}
describe('full text copy', () => {
  it('copies the full exact stored text and waits for clipboard completion before success', async () => {
    let resolve!: () => void
    const write = vi.fn().mockImplementation(() => new Promise<void>(r => { resolve = r }))
    const { notify } = setup(write)
    const copy = await screen.findByRole('button', { name: 'Copy text' })
    fireEvent.click(copy)
    expect(write).toHaveBeenCalledWith('  all\ttext\r\n🦊\n  ')
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument()
    expect(notify).not.toHaveBeenCalled()
    await act(async () => resolve())
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(notify).toHaveBeenCalledWith('Full text copied.')
  })
  it('keeps failed writes visibly failed and never announces success', async () => {
    const write = vi.fn().mockRejectedValue(new Error('Clipboard permission denied'))
    const { notify } = setup(write)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy text' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Clipboard permission denied')
    expect(screen.queryByText('Copied')).not.toBeInTheDocument(); expect(notify).not.toHaveBeenCalled()
  })
  it('requires a fresh Copy gesture after preparing larger text', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    setup(write, 'large complete body', { size: 100_000 })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare copy' }))
    const copy = await screen.findByRole('button', { name: 'Copy text' })
    expect(write).not.toHaveBeenCalled()
    fireEvent.click(copy); await waitFor(() => expect(write).toHaveBeenCalledWith('large complete body'))
  })
  it('passes a direct authenticated download URL, without fetching a whole-file Blob', async () => {
    const { download } = setup(vi.fn(), '', { kind: 'file', name: 'huge.zip', size: 20_000_000_000 })
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(download).toHaveBeenCalledWith({ url: 'https://household.example/api/items/note/download', name: 'huge.zip', itemId: 'note' })
  })
  it.each(['uploading','failed'] as const)('keeps file bytes unavailable while the item is %s', status => {
    const { download } = setup(vi.fn(), '', {kind:'file',name:'pending.zip',size:20_000_000_000,status})
    const button = screen.getByRole('button',{name:'Download'})
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(download).not.toHaveBeenCalled()
  })
  it('offers cancellation during preparation and does not announce a cancelled copy', async () => {
    let requestedSignal:AbortSignal|undefined
    const request=vi.fn((_url:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      requestedSignal=init?.signal as AbortSignal
      requestedSignal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})
    }))
    const notify=vi.fn();const api=new ApiClient('https://household.example',request)
    const platform={kind:'browser',copyText:vi.fn(),download:vi.fn()} as unknown as PlatformAdapter
    render(<FeedCard item={{...item,size:100_000}} api={api} platform={platform} refresh={vi.fn()} notify={notify}/>)
    fireEvent.click(screen.getByRole('button',{name:'Prepare copy'}))
    fireEvent.click(await screen.findByRole('button',{name:'Cancel preparation'}))
    expect(requestedSignal?.aborted).toBe(true)
    await waitFor(()=>expect(screen.getByRole('button',{name:'Prepare copy'})).toBeEnabled())
    expect(notify).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it.each(['unmount', 'replace'] as const)('aborts manual preparation on %s and ignores a late response', async action => {
    let signal!: AbortSignal
    let resolve!: (response: Response) => void
    const request = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>(done => {
      signal = init!.signal as AbortSignal; resolve = done
    }))
    const api = new ApiClient('https://household.example', request)
    const platform = {kind:'browser',copyText:vi.fn(),download:vi.fn()} as unknown as PlatformAdapter
    const notify = vi.fn()
    const props = {api,platform,refresh:vi.fn(),notify}
    const view = render(<FeedCard {...props} item={{...item,size:100_000}} />)
    fireEvent.click(screen.getByRole('button',{name:'Prepare copy'}))
    expect(signal.aborted).toBe(false)
    if (action === 'unmount') view.unmount()
    else view.rerender(<FeedCard {...props} item={{...item,id:'replacement',size:100_000}} />)
    expect(signal.aborted).toBe(true)
    await act(async () => { resolve(new Response('stale full text')) })
    expect(notify).not.toHaveBeenCalled()
    expect(screen.queryByRole('button',{name:'Copy text'})).not.toBeInTheDocument()
  })
  it('uses download instead of full Copy or Expand for text above the preparation budget', () => {
    setup(vi.fn(),'must not be requested',{size:8*1024**2+1})
    expect(screen.getByRole('button',{name:'Copy text'})).toBeDisabled()
    expect(screen.queryByRole('button',{name:'Expand text'})).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:/^Download \.txt$/})).toBeEnabled()
  })
  it('keeps secondary actions in a keyboard-accessible menu', async () => {
    setup(vi.fn())
    const trigger=screen.getByRole('button',{name:'More actions for Text'})
    fireEvent.keyDown(trigger,{key:'ArrowDown'})
    const expand=await screen.findByRole('menuitem',{name:'Download .txt'})
    expect(expand).toHaveFocus()
    fireEvent.keyDown(expand,{key:'ArrowDown'})
    expect(screen.getByRole('menuitem',{name:'Download .md'})).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menuitem',{name:'Pin item'}),{key:'End'})
    expect(screen.getByRole('menuitem',{name:'Delete item'})).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menuitem',{name:'Delete item'}),{key:'Escape'})
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();expect(trigger).toHaveFocus()
  })
  it('keeps the exact .txt download available in the secondary menu', async () => {
    const { download } = setup(vi.fn())
    await screen.findByRole('button', {name:'Copy text'})
    expect(screen.queryByRole('button', {name:'Download .txt'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name:'More actions for Text'}))
    fireEvent.click(screen.getByRole('menuitem', {name:'Download .txt'}))
    expect(download).toHaveBeenCalledWith({url:'https://household.example/api/items/note/download?format=txt',name:'Text.txt',itemId:'note'})
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
  it('starts keyboard navigation at the first enabled action for an unfinished text upload', () => {
    setup(vi.fn(), '', {status:'uploading'})
    const trigger=screen.getByRole('button',{name:'More actions for Text'})
    fireEvent.keyDown(trigger,{key:'ArrowDown'})
    expect(screen.getByRole('menuitem',{name:'Download .txt'})).toBeDisabled()
    expect(screen.getByRole('menuitem',{name:'Pin item'})).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menuitem',{name:'Pin item'}),{key:'ArrowUp'})
    expect(screen.getByRole('menuitem',{name:'Delete item'})).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menuitem',{name:'Delete item'}),{key:'Home'})
    expect(screen.getByRole('menuitem',{name:'Pin item'})).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menuitem',{name:'Pin item'}),{key:'Escape'})
    expect(trigger).toHaveFocus()
  })
  it('renders shared markup as inert text', async () => {
    setup(vi.fn(), '<img src=x onerror="alert(1)">', { preview: '<script>bad()</script>' })
    expect(screen.getByText('<script>bad()</script>')).toBeInTheDocument()
    expect(document.querySelector('script, img')).toBeNull()
  })
})
