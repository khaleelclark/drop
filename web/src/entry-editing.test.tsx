import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiClient, COPY_LIMIT } from './api'
import { FeedCard } from './FeedCard'
import type { PlatformAdapter } from './platform'
import type { Item } from './types'
const version='2026-10-23T12:00:00.000000001Z',nextVersion='2026-10-23T12:00:00.000000002Z'
const item:Item={id:'note',kind:'text',name:'Note.md',size:100_000,createdAt:version,updatedAt:version,status:'ready',preview:'preview',pinned:false}
const full='\ufeff  exact\t\r\n家 🦊\n  '
function setup(override:Partial<Item>={}){
  let current={...item,...override};let stored=full;let conflict=false
  const patches:Record<string,unknown>[]=[];const refresh=vi.fn(),notify=vi.fn(),copyText=vi.fn().mockResolvedValue(undefined),download=vi.fn().mockResolvedValue(undefined)
  const request=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    if(init?.method==='PATCH'){
      const patch=JSON.parse(String(init.body));patches.push(patch)
      if(conflict)return new Response('{"error":{"code":"edit_conflict","message":"changed"}}',{status:409})
      current={...current,name:patch.name,size:Buffer.byteLength(patch.text??stored),updatedAt:nextVersion};stored=patch.text??stored
      return new Response(JSON.stringify({item:current}))
    }
    if(String(input).endsWith('/text'))return new Response(stored)
    return new Response(JSON.stringify({item:current}))
  })
  const api=new ApiClient('https://household.example',request)
  const platform={kind:'browser',copyText,download} as unknown as PlatformAdapter
  const props={api,platform,refresh,notify};const view=render(<FeedCard {...props} item={current}/>)
  const open=async()=>{fireEvent.click(screen.getByRole('button',{name:`More actions for ${current.name}`}));fireEvent.click(screen.getByRole('menuitem',{name:current.kind==='text'&&current.size<=COPY_LIMIT?'Edit entry':'Rename entry'}));await screen.findByLabelText('Entry name')}
  return {api,platform,view,props,request,open,patches,refresh,notify,copyText,download,conflict:()=>{conflict=true},update:(next:Item)=>{current=next;view.rerender(<FeedCard {...props} item={current}/>)} }
}
describe('shared board entry editing',()=>{
  it('keeps exact stored newlines and pasted Unicode, saves once to the same item, and cancels without mutation',async()=>{
    const data=setup();await data.open()
    expect(screen.getByLabelText('Entry name')).toHaveFocus()
    const text=screen.getByLabelText('Entry text') as HTMLTextAreaElement
    expect(text.value).toBe(full.replace(/\r\n/g,'\n'))
    text.setSelectionRange(text.value.length,text.value.length)
    fireEvent.paste(text,{clipboardData:{types:['text/plain'],getData:()=> '\r\n\tnew 家 🦊 '}})
    fireEvent.change(screen.getByLabelText('Entry name'),{target:{value:'Edited 家.md'}})
    expect(data.patches).toHaveLength(0)
    fireEvent.click(screen.getByRole('button',{name:'Save entry'}))
    await waitFor(()=>expect(data.refresh).toHaveBeenCalledOnce())
    expect(data.patches).toEqual([{name:'Edited 家.md',text:full+'\r\n\tnew 家 🦊 ',expectedUpdatedAt:version}])
    expect(data.notify).toHaveBeenCalledWith('Entry saved for your household.')
    data.view.unmount()
    const cancelled=setup();await cancelled.open();fireEvent.change(screen.getByLabelText('Entry text'),{target:{value:'discard'}})
    fireEvent.click(screen.getByRole('button',{name:'Cancel editing'}));expect(screen.queryByLabelText('Entry text')).not.toBeInTheDocument();expect(cancelled.patches).toHaveLength(0)
  })
  it('preserves an unsaved draft and original version through remote refresh, conflict, and explicit reload',async()=>{
    const data=setup();await data.open();fireEvent.change(screen.getByLabelText('Entry text'),{target:{value:'My draft 🦊'}})
    data.update({...item,updatedAt:nextVersion,name:'Remote name.md'})
    expect(screen.getByLabelText('Entry text')).toHaveValue('My draft 🦊')
    data.conflict();fireEvent.click(screen.getByRole('button',{name:'Save entry'}))
    await screen.findByRole('alert');expect(data.patches[0].expectedUpdatedAt).toBe(version)
    expect(screen.getByLabelText('Entry text')).toHaveValue('My draft 🦊');expect(data.refresh).not.toHaveBeenCalled();expect(data.notify).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'Reload latest entry (replace draft)'}))
    await waitFor(()=>expect(screen.getByLabelText('Entry name')).toHaveValue('Remote name.md'))
    fireEvent.click(screen.getByRole('button',{name:'Save entry'}));await waitFor(()=>expect(data.patches).toHaveLength(2))
    expect(data.patches[1].expectedUpdatedAt).toBe(nextVersion)
  })
  it('captures metadata before a racing full-body fetch and never advances its draft version',async()=>{
    let resolve!:(response:Response)=>void
    const request=vi.fn(()=>new Promise<Response>(done=>{resolve=done}))
    const api=new ApiClient('https://household.example',request);const platform={kind:'browser',copyText:vi.fn(),download:vi.fn()} as unknown as PlatformAdapter
    const props={api,platform,refresh:vi.fn(),notify:vi.fn()};const view=render(<FeedCard {...props} item={item}/>)
    fireEvent.click(screen.getByRole('button',{name:'More actions for Note.md'}));fireEvent.click(screen.getByRole('menuitem',{name:'Edit entry'}))
    view.rerender(<FeedCard {...props} item={{...item,updatedAt:nextVersion}}/>)
    await act(async()=>resolve(new Response('new server body')))
    expect(screen.getByLabelText('Entry text')).toHaveValue('new server body')
    fireEvent.click(screen.getByRole('button',{name:'Save entry'}))
    await waitFor(()=>expect(request).toHaveBeenCalledTimes(2))
    const init=request.mock.calls[1] as unknown as [string,RequestInit]
    expect(JSON.parse(String(init[1].body)).expectedUpdatedAt).toBe(version)
  })
  it.each([{kind:'file' as const,name:'Original.zip',size:20_000_000_000},{kind:'text' as const,name:'Huge note',size:COPY_LIMIT+1}])('renames $kind entries without loading large bodies',async override=>{
    const data=setup(override);await data.open();expect(screen.queryByLabelText('Entry text')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Entry name'),{target:{value:'Renamed 家'}});fireEvent.click(screen.getByRole('button',{name:'Save entry'}))
    await waitFor(()=>expect(data.refresh).toHaveBeenCalledOnce());expect(data.patches).toEqual([{name:'Renamed 家',expectedUpdatedAt:version}])
    expect(data.request.mock.calls.some(([url])=>String(url).endsWith('/text'))).toBe(false)
  })
  it('copies uploaded code only after explicit bounded preparation, retaining Download',async()=>{
    const data=setup({kind:'file',name:'script.ts',size:Buffer.byteLength(full),mimeType:'application/typescript'})
    expect(data.request).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Prepare copy'})).toHaveTextContent('Prepare copy');fireEvent.click(screen.getByRole('button',{name:'Prepare copy'}))
    fireEvent.click(await screen.findByRole('button',{name:'Copy text'}));await waitFor(()=>expect(data.copyText).toHaveBeenCalledWith(full))
    expect(screen.getByRole('button',{name:'Download'})).toBeEnabled()
  })
  it('saves original bytes as TXT or MD with safe suggested suffixes on both platforms',async()=>{
    const data=setup({name:'家.MD'})
    fireEvent.click(screen.getByRole('button',{name:'More actions for 家.MD'}));fireEvent.click(screen.getByRole('menuitem',{name:'Download .txt'}))
    expect(data.download).toHaveBeenCalledWith({url:'https://household.example/api/items/note/download?format=txt',name:'家.txt',itemId:'note'})
    data.platform.kind='native'
    fireEvent.click(screen.getByRole('button',{name:'More actions for 家.MD'}));fireEvent.click(screen.getByRole('menuitem',{name:'Download .md'}))
    expect(data.download).toHaveBeenLastCalledWith({url:'https://household.example/api/items/note/download?format=md',name:'家.md',itemId:'note'})
  })
})


it('retains existing kind=text preparation even when file metadata would be ineligible',async()=>{
  const data=setup({kind:'text',mimeType:'text/plain; charset=utf-16',size:Buffer.byteLength(full)})
  fireEvent.click(await screen.findByRole('button',{name:'Copy text'}))
  await waitFor(()=>expect(data.copyText).toHaveBeenCalledWith(full))
})
