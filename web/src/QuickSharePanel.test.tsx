import {act,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {describe,expect,it,vi} from 'vitest'
import {QuickSharePanel} from './QuickSharePanel'
import type {PlatformAdapter,FileDrop} from './platform'
import {QUICK_TEXT_LIMIT,type QuickContext,type QuickShareAdapter} from './quick-share'
import type {TransferStore} from './transfers'
const source='a'.repeat(32),phone='b'.repeat(32),linux='c'.repeat(32)
const initial:QuickContext={baseUrl:'https://home.example',sourceDeviceId:source,sourceDevice:'My Mac',devices:[{id:source,label:'My Mac',platform:'macos'},{id:phone,label:'Phone',platform:'android'},{id:linux,label:'Desk <script>',platform:'linux'}]}
function setup(){
  const bridge:QuickShareAdapter={context:vi.fn().mockResolvedValue(initial),paste:vi.fn().mockResolvedValue('  exact\r\n🐈\t  '),sendText:vi.fn().mockResolvedValue({itemId:'ready'}),pick:vi.fn().mockResolvedValue({queued:1,cancelled:false}),drop:vi.fn().mockResolvedValue({queued:2,cancelled:false}),resize:vi.fn().mockResolvedValue(undefined),hide:vi.fn().mockResolvedValue(undefined),open:vi.fn().mockResolvedValue(undefined),quit:vi.fn().mockResolvedValue(undefined)}
  let receive:((event:FileDrop)=>void)|undefined
  const release=vi.fn(),onFileDrop=vi.fn(async(callback:(event:FileDrop)=>void)=>{receive=callback;return release})
  const platform:PlatformAdapter={kind:'native',copyText:vi.fn(),download:vi.fn(),transfers:{} as TransferStore,onFileDrop}
  const view=render(<QuickSharePanel platform={platform} bridge={bridge}/>)
  return{bridge,platform,view,release,onFileDrop,drop:(event:FileDrop)=>act(()=>receive!(event))}
}
async function choosePhone(){const name=await screen.findByRole('button',{name:'Phone'});await waitFor(()=>expect(name).toBeEnabled());fireEvent.click(name)}
const editor=()=>screen.getByRole('textbox',{name:'Text to share'})
describe('retained Mac quick-share view',()=>{
  it('lists Everyone and registered receivers, filters locally and never reads clipboard on mount/focus/hover',async()=>{
    const{bridge}=setup()
    const phoneRow=await screen.findByRole('button',{name:'Phone'})
    expect(screen.queryByRole('button',{name:'My Mac'})).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Everyone'})).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Desk <script>'})).toBeInTheDocument()
    fireEvent.mouseOver(phoneRow);fireEvent.focus(phoneRow);fireEvent(window,new Event('focus'))
    await waitFor(()=>expect(bridge.context).toHaveBeenCalledTimes(2))
    fireEvent.change(screen.getByRole('searchbox',{name:'Find a device'}),{target:{value:'desk'}})
    expect(screen.queryByRole('button',{name:'Phone'})).not.toBeInTheDocument()
    expect(bridge.paste).not.toHaveBeenCalled();expect(bridge.sendText).not.toHaveBeenCalled()
    expect(bridge.resize).toHaveBeenCalledWith(false)
  })
  it('reads only explicit Paste, reviews exact inert text and announces success only after confirmation',async()=>{
    const{bridge}=setup();let resolve!:(value:{itemId:string})=>void
    vi.mocked(bridge.sendText).mockImplementation(()=>new Promise(done=>{resolve=done}))
    fireEvent.click(await screen.findByRole('button',{name:/Paste text to Phone/}))
    await waitFor(()=>expect(editor()).toHaveValue('  exact\n🐈\t  '))
    expect(bridge.paste).toHaveBeenCalledTimes(1);expect(bridge.sendText).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'Send'}));fireEvent.submit(editor().closest('form')!)
    expect(bridge.sendText).toHaveBeenCalledTimes(1)
    expect(bridge.sendText).toHaveBeenCalledWith({baseUrl:initial.baseUrl,sourceDeviceId:source,targetDeviceIds:[phone]},'  exact\r\n🐈\t  ')
    expect(editor()).toHaveValue('  exact\n🐈\t  ');expect(screen.queryByText('Text shared to Phone.')).not.toBeInTheDocument()
    await act(async()=>resolve({itemId:'ready'}))
    expect(editor()).toHaveValue('');expect(screen.getByRole('status')).toHaveTextContent('Text shared to Phone.')
  })
  it('retains draft and destination on failure and Escape dismissal without retrying ambiguous text',async()=>{
    const{bridge}=setup();await choosePhone()
    fireEvent.change(editor(),{target:{value:'retain me'}})
    vi.mocked(bridge.sendText).mockRejectedValue(new Error('Text may already be shared. Check Open Drop.'))
    fireEvent.click(screen.getByRole('button',{name:'Send'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('may already be shared')
    fireEvent.keyDown(window,{key:'Escape',isComposing:true});expect(bridge.hide).not.toHaveBeenCalled()
    fireEvent.keyDown(window,{key:'Escape'});await waitFor(()=>expect(bridge.hide).toHaveBeenCalledTimes(1))
    fireEvent(window,new Event('focus'));await waitFor(()=>expect(bridge.context).toHaveBeenCalledTimes(2))
    expect(editor()).toHaveValue('retain me');expect(screen.getByRole('heading',{name:'Phone'})).toBeInTheDocument()
    expect(bridge.sendText).toHaveBeenCalledTimes(1)
  })
  it('never overwrites a retained draft or switches its destination through a row clipboard action',async()=>{
    const{bridge}=setup();await choosePhone();fireEvent.change(editor(),{target:{value:'keep'}})
    fireEvent.click(screen.getByRole('button',{name:'Back to devices'}));fireEvent.click(screen.getByRole('button',{name:'Paste text to Everyone'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('nothing was replaced')
    expect(bridge.paste).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'Review retained draft · Phone'}))
    expect(editor()).toHaveValue('keep');expect(screen.getByRole('heading',{name:'Phone'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Back to devices'}));fireEvent.click(screen.getByRole('button',{name:'Everyone'}))
    expect(editor()).toHaveValue('keep');expect(screen.getByRole('heading',{name:'Everyone'})).toBeInTheDocument()
    expect(bridge.sendText).not.toHaveBeenCalled()
  })
  it.each(['target','origin','sender'])('blocks a refreshed stale %s snapshot without a broadcast fallback',async change=>{
    const{bridge}=setup();await choosePhone();fireEvent.change(editor(),{target:{value:'keep'}})
    const next={...initial,...(change==='target'?{devices:[initial.devices[0]]}:change==='origin'?{baseUrl:'https://other.example'}:{sourceDeviceId:linux})}
    vi.mocked(bridge.context).mockResolvedValue(next)
    fireEvent(window,new Event('focus'))
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('choose a destination again'))
    expect(editor()).toHaveValue('keep');expect(screen.getByRole('button',{name:'Send'})).toBeDisabled()
    expect(bridge.sendText).not.toHaveBeenCalled();expect(bridge.drop).not.toHaveBeenCalled()
  })
  it('captures routing before pick/drop and reports queue acceptance separately from sending',async()=>{
    const{bridge,drop,onFileDrop,release,view}=setup();await choosePhone();fireEvent.change(editor(),{target:{value:'not sent'}})
    let resolve!:(value:{queued:number;cancelled:boolean})=>void
    vi.mocked(bridge.pick).mockImplementation(()=>new Promise(done=>{resolve=done}))
    fireEvent.click(screen.getByRole('button',{name:'Send Folder'}))
    expect(bridge.pick).toHaveBeenCalledWith({baseUrl:initial.baseUrl,sourceDeviceId:source,targetDeviceIds:[phone]},'folder')
    drop({type:'drop',paths:['/ignored-while-picker-active']});expect(bridge.drop).not.toHaveBeenCalled()
    await act(async()=>resolve({queued:1,cancelled:false}))
    expect(screen.getByRole('status')).toHaveTextContent('1 selection queued to Phone.')
    expect(editor()).toHaveValue('not sent');expect(bridge.sendText).not.toHaveBeenCalled()
    drop({type:'enter'});expect(screen.getByRole('region',{name:'Drop files or folders to Phone'})).toHaveClass('is-dragging')
    drop({type:'leave'});expect(screen.getByRole('region')).not.toHaveClass('is-dragging')
    drop({type:'drop',paths:['/folder','/huge.bin']})
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('2 selections queued'))
    expect(bridge.drop).toHaveBeenCalledWith({baseUrl:initial.baseUrl,sourceDeviceId:source,targetDeviceIds:[phone]},['/folder','/huge.bin'])
    expect(onFileDrop).toHaveBeenCalledTimes(1);view.unmount();await waitFor(()=>expect(release).toHaveBeenCalledTimes(1))
  })
  it('retains draft on picker cancellation/partial failure and shows actionable empty/unsupported clipboard errors',async()=>{
    const{bridge}=setup();await choosePhone()
    vi.mocked(bridge.paste).mockRejectedValueOnce(new Error('Copy plain text first'))
    fireEvent.click(screen.getByRole('button',{name:'Paste'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('Copy plain text first')
    fireEvent.change(editor(),{target:{value:'keep'}})
    vi.mocked(bridge.pick).mockResolvedValueOnce({queued:0,cancelled:true})
    fireEvent.click(screen.getByRole('button',{name:'Send Files'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Send Files'})).toBeEnabled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument();expect(editor()).toHaveValue('keep')
    vi.mocked(bridge.pick).mockRejectedValueOnce(new Error('1 earlier selection queued; next may already be queued. Open Transfers.'))
    fireEvent.click(screen.getByRole('button',{name:'Send Files'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('may already be queued');expect(editor()).toHaveValue('keep')
  })
  it('preserves CRLF/BOM during normal paste and rejects oversized insertion without truncation',async()=>{
    const{bridge}=setup();await choosePhone()
    const raw='\ufeff<script>inert</script>\r\n\t  '
    fireEvent.paste(editor(),{clipboardData:{getData:()=>raw}})
    expect(editor()).toHaveValue(raw.replace(/\r\n/g,'\n'))
    fireEvent.paste(editor(),{clipboardData:{getData:()=>'x'.repeat(QUICK_TEXT_LIMIT+1)}})
    expect(screen.getByRole('alert')).toHaveTextContent('nothing was truncated')
    expect(editor()).toHaveValue(raw.replace(/\r\n/g,'\n'))
    fireEvent.click(screen.getByRole('button',{name:'Send'}))
    await waitFor(()=>expect(bridge.sendText).toHaveBeenCalledWith(expect.anything(),raw))
    expect(bridge.paste).not.toHaveBeenCalled()
  })
  it('refresh failure retains destination and draft, disables send and recovers only after an explicit refresh',async()=>{
    const{bridge}=setup();await choosePhone();fireEvent.change(editor(),{target:{value:'keep'}})
    vi.mocked(bridge.context).mockRejectedValueOnce(new Error('Server offline'))
    fireEvent(window,new Event('focus'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Server offline')
    expect(editor()).toHaveValue('keep');expect(screen.getByRole('button',{name:'Send'})).toBeDisabled()
    fireEvent.click(screen.getByRole('button',{name:'Refresh devices'}))
    await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('button',{name:'Send'})).toBeEnabled()
    fireEvent.click(screen.getByRole('button',{name:'Open Drop'}));expect(bridge.open).toHaveBeenCalledTimes(1)
  })
})
