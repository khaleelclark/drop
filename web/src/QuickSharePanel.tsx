import {useCallback,useEffect,useRef,useState} from 'react'
import {ArrowLeft,Clipboard,FileUp,FolderUp,Globe,Laptop,Monitor,Search,Send,Smartphone,UploadCloud,Users,X} from 'lucide-react'
import {useAppearance} from './Appearance'
import type {PlatformAdapter} from './platform'
import {checkQuickText,type QuickContext,type QuickDevice,type QuickRouting,type QuickShareAdapter} from './quick-share'
import {insertPlainText,preserveTextareaEdit,textareaText} from './text-editing'
import {errorMessage} from './types'
import {ZingMark} from './ZingMark'

type Destination={id:string;label:string;platform?:QuickDevice['platform'];baseUrl:string;sourceDeviceId:string}
function DeviceIcon({platform}:{platform?:QuickDevice['platform']}){
  const Icon=!platform?Users:platform==='android'?Smartphone:platform==='browser'?Globe:platform==='macos'?Laptop:Monitor
  return <Icon size={22} aria-hidden="true"/>
}
export function QuickSharePanel({platform,bridge}:{platform:PlatformAdapter;bridge:QuickShareAdapter}){
  const appearance=useAppearance(platform),appearanceChange=useRef(appearance.change);appearanceChange.current=appearance.change
  const [context,setContext]=useState<QuickContext>(),[ready,setReady]=useState(false),[refreshing,setRefreshing]=useState(false)
  const [selected,setSelected]=useState<Destination>(),[detail,setDetail]=useState(false),[query,setQuery]=useState(''),[draft,setDraft]=useState('')
  const [busy,setBusy]=useState(false),[dragging,setDragging]=useState(false),[error,setError]=useState(''),[contextError,setContextError]=useState(''),[status,setStatus]=useState('')
  const actionLock=useRef(false),generation=useRef(0),active=useRef(true),search=useRef<HTMLInputElement>(null),editor=useRef<HTMLTextAreaElement>(null)
  const refresh=useCallback(async()=>{
    const current=++generation.current;setRefreshing(true);setReady(false)
    try{
      const next=await bridge.context()
      if(!active.current||current!==generation.current)return
      setContext(next);setReady(true);setContextError('')
      setSelected(previous=>previous||{id:'',label:'Everyone',baseUrl:next.baseUrl,sourceDeviceId:next.sourceDeviceId})
    }catch(failure){if(active.current&&current===generation.current)setContextError(`Couldn’t refresh devices. ${errorMessage(failure)} Your draft and destination are retained.`)}
    finally{if(active.current&&current===generation.current)setRefreshing(false)}
  },[bridge])
  const dismiss=useCallback(()=>{setDragging(false);void bridge.hide().catch(failure=>setError(errorMessage(failure)))},[bridge])
  useEffect(()=>{
    active.current=true;void refresh()
    const focus=()=>{
      try{const choice=localStorage.getItem('zing.appearance');appearanceChange.current(choice==='light'||choice==='dark'?choice:'system')}catch{}
      void refresh()
    }
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();dismiss()}}
    const blur=()=>setDragging(false)
    const storage=(event:StorageEvent)=>{if(event.key==='zing.appearance'||event.key===null){const choice=event.newValue;appearanceChange.current(choice==='light'||choice==='dark'?choice:'system')}}
    window.addEventListener('focus',focus);window.addEventListener('keydown',key);window.addEventListener('blur',blur);window.addEventListener('storage',storage)
    return()=>{active.current=false;generation.current++;window.removeEventListener('focus',focus);window.removeEventListener('keydown',key);window.removeEventListener('blur',blur);window.removeEventListener('storage',storage)}
  },[refresh,dismiss])
  useEffect(()=>{void bridge.resize(detail).catch(failure=>setError(`Couldn’t size the panel. Use Open Drop. ${errorMessage(failure)}`));if(detail)editor.current?.focus();else search.current?.focus()},[detail,bridge])
  const destination=(device?:QuickDevice):Destination=>{
    if(!context||!ready)throw new Error('Refresh devices before choosing a destination.')
    return{id:device?.id||'',label:device?.label||'Everyone',platform:device?.platform,baseUrl:context.baseUrl,sourceDeviceId:context.sourceDeviceId}
  }
  const stale=Boolean(selected&&context&&(selected.baseUrl!==context.baseUrl||selected.sourceDeviceId!==context.sourceDeviceId||Boolean(selected.id&&(selected.id===context.sourceDeviceId||!context.devices.some(device=>device.id===selected.id)))))
  const routing=():QuickRouting=>{
    if(!selected||!context||!ready)throw new Error('Refresh devices before sending. Your draft is retained.')
    if(stale)throw new Error('The connection, sender or selected device changed. Choose a destination again; nothing was sent.')
    return{baseUrl:selected.baseUrl,sourceDeviceId:selected.sourceDeviceId,targetDeviceIds:selected.id?[selected.id]:[]}
  }
  const run=async(operation:()=>Promise<void>)=>{
    if(actionLock.current)return
    actionLock.current=true;setBusy(true);setError('');setStatus('');setDragging(false)
    try{await operation()}catch(failure){if(active.current)setError(errorMessage(failure))}
    finally{actionLock.current=false;if(active.current)setBusy(false)}
  }
  const choose=(device?:QuickDevice)=>{
    if(actionLock.current)return
    try{setSelected(destination(device));setDetail(true);setStatus('');setError('')}
    catch(failure){setError(errorMessage(failure))}
  }
  const paste=(device?:QuickDevice,fromList=false)=>void run(async()=>{
    if(draft.length)throw new Error('Your draft already contains text. Send or clear it before using Paste; nothing was replaced.')
    const next=fromList?destination(device):selected
    if(!next)throw new Error('Choose a destination before using Paste.')
    setSelected(next);setDetail(true)
    const text=await bridge.paste();checkQuickText(text);setDraft(text)
    requestAnimationFrame(()=>editor.current?.focus())
  })
  const send=()=>void run(async()=>{
    const snapshot=routing(),text=draft;checkQuickText(text)
    await bridge.sendText(snapshot,text)
    setDraft('');setStatus(`Text shared to ${selected!.label}.`)
  })
  const queue=(kind:'file'|'folder'|string[])=>void run(async()=>{
    const snapshot=routing(),label=selected!.label
    const receipt=Array.isArray(kind)?await bridge.drop(snapshot,kind):await bridge.pick(snapshot,kind)
    if(receipt.cancelled)return
    if(!receipt.queued)throw new Error('No files were queued. Use Send Files or Send Folder to try again.')
    setStatus(`${receipt.queued} ${receipt.queued===1?'selection':'selections'} queued to ${label}. Follow progress in Open Drop → Transfers.`)
  })
  const dropHandler=useRef((paths:string[])=>queue(paths));dropHandler.current=paths=>queue(paths)
  useEffect(()=>{
    if(!platform.onFileDrop)return
    let stopped=false,release:(()=>void|Promise<void>)|undefined
    void platform.onFileDrop(event=>{
      if(stopped)return
      if(event.type==='drop'){setDragging(false);dropHandler.current(event.paths)}else setDragging(event.type==='enter'||event.type==='over')
    }).then(stop=>{if(stopped)void Promise.resolve().then(stop).catch(()=>{});else release=stop}).catch(failure=>{if(!stopped)setError(errorMessage(failure))})
    return()=>{stopped=true;if(release)void Promise.resolve().then(release).catch(()=>{})}
  },[platform])
  const edit=(text:string)=>{
    if(text.length){try{checkQuickText(text)}catch(failure){setError(errorMessage(failure));return}}
    setDraft(text);setStatus('')
  }
  const receiving=context?.devices.filter(device=>device.id!==context.sourceDeviceId&&device.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))||[]
  const everyone='everyone'.includes(query.toLocaleLowerCase())
  const blocked=busy||!ready||stale||!selected
  const row=(device?:QuickDevice)=><div className="quick-device" key={device?.id||'everyone'}>
    <button className="quick-device-name" disabled={busy||!ready} onClick={()=>choose(device)}><DeviceIcon platform={device?.platform}/><span>{device?.label||'Everyone'}</span></button>
    <button className="icon-button" disabled={busy||!ready} aria-label={`Paste text to ${device?.label||'Everyone'}${device?` (${device.id.slice(-6)})`:''}`} onClick={()=>paste(device,true)}><Clipboard size={18}/></button>
  </div>
  return <main className={`quick-share ${detail?'quick-detail':''}`} aria-label="Drop quick share" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();setDragging(false);if(event.dataTransfer.files.length)setError('Use the installed file drop or Send Files. Browser file bytes cannot be queued here.')}}>
    <header className="quick-header">{detail?<button className="icon-button" disabled={busy} aria-label="Back to devices" onClick={()=>setDetail(false)}><ArrowLeft size={20}/></button>:<ZingMark/>}<h1>{detail?'Share to':'Quick share'}</h1><button className="icon-button" aria-label="Hide quick share" onClick={dismiss}><X size={20}/></button></header>
    <div className="quick-content">
      {detail?<>
        <div className="quick-recipient"><DeviceIcon platform={selected?.platform}/><h2>{selected?.label||'Everyone'}</h2></div>
        <div className="quick-actions"><button className="button secondary" disabled={busy} onClick={()=>paste()}><Clipboard size={16}/>Paste</button><button className="button secondary" disabled={blocked} onClick={()=>queue('file')}><FileUp size={16}/>Send Files</button><button className="button secondary" disabled={blocked} onClick={()=>queue('folder')}><FolderUp size={16}/>Send Folder</button></div>
      </>:<>
        <label className="quick-search"><Search size={18}/><span className="sr-only">Find a device</span><input ref={search} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Find a device" type="search"/></label>
        <div className="quick-devices" role="group" aria-label="Receiving devices">{everyone&&row()}{receiving.map(device=>row(device))}{!everyone&&!receiving.length&&<p className="field-note">No matching devices.</p>}</div>
        {draft.length>0&&<button className="text-button" disabled={busy} onClick={()=>{setDetail(true);setQuery('')}}>Review retained draft · {selected?.label||'Choose a destination'}</button>}
      </>}
      <div className={`quick-drop ${dragging?'is-dragging':''}`} role="region" aria-label={`Drop files or folders to ${selected?.label||'Everyone'}`}><UploadCloud size={25}/><span>Drop files or folders<span className="field-note">To {selected?.label||'Everyone'}</span></span></div>
      {detail&&<form className="quick-draft" onSubmit={event=>{event.preventDefault();if(!busy)send()}}><label htmlFor="quick-text">Text to share</label><textarea id="quick-text" ref={editor} disabled={busy} value={textareaText(draft)} onChange={event=>edit(preserveTextareaEdit(draft,event.target.value))} onPaste={event=>{event.preventDefault();const text=event.clipboardData.getData('text/plain');if(!text){setError('The clipboard has no plain text. Copy text or use Send Files.');return}edit(insertPlainText(draft,event.currentTarget.selectionStart,event.currentTarget.selectionEnd,text))}} placeholder="Paste or type text…"/><div className="quick-send"><span className="field-note">To {selected?.label||'Everyone'}</span><button className="button primary" disabled={blocked||!draft.length}><Send size={16}/>{busy?'Working…':'Send'}</button></div></form>}
      {stale&&<p className="inline-error" role="alert">The connection, sender or selected device changed. Go Back and choose a destination again. Your draft is retained.</p>}
      {error&&<p className="inline-error" role="alert">{error}</p>}
      {contextError&&<p className="inline-error" role="alert">{contextError}</p>}
      {appearance.nativeError&&<p className="inline-error" role="alert">{appearance.nativeError}</p>}
      {status&&<p className="quick-status" role="status">{status}</p>}
      {!ready&&<p className="field-note" role="status">{refreshing?'Refreshing devices…':'Devices unavailable.'}</p>}
      <button className="text-button quick-refresh" disabled={refreshing||busy} onClick={()=>void refresh()}>Refresh devices</button>
    </div>
    <footer className="quick-footer"><div><button className="text-button" onClick={()=>void bridge.open().catch(failure=>setError(errorMessage(failure)))}>Open Drop</button><button className="text-button" disabled={busy} onClick={()=>void run(()=>bridge.quit())}>Quit</button></div><small>More actions: right-click the menu-bar icon</small></footer>
  </main>
}
