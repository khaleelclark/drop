import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { ArrowDown, ArrowRight, Check, CircleHelp, Clipboard, FileText, HardDrive, Inbox, Link2, LoaderCircle, LockKeyhole, LogOut, Paperclip, Pin, Plus, RefreshCw, Search, Send, Settings2, ShieldCheck, Smartphone, UploadCloud, WifiOff, X } from 'lucide-react'
import { ApiClient, ApiError } from './api'
import { browserPlatform } from './platform'
import { browserDeviceId, sendRouting, validDeviceId, validItemId } from './devices'
import { BrowserArrivals } from './arrivals'
import { RecipientPicker } from './RecipientPicker'
import { DeviceSettings } from './DeviceSettings'
import { DeviceNamePrompt } from './DeviceNamePrompt'
import { FeedCard } from './FeedCard'
import { ItemMenu } from './ItemMenu'
import { ZingMark } from './ZingMark'
import { insertPlainText, preserveTextareaEdit, textareaText } from './text-editing'
import { TransferQueue } from './TransferQueue'
import { textFileAccept } from './text-files'
import { errorMessage, formatBytes, type Device, type SendRouting, type Item, type StorageInfo } from './types'
function stored(key: string, fallback: string) { try { return localStorage.getItem(key) || fallback } catch { return fallback } }
function save(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* Settings are optional. */ } }
type View = 'all' | 'you' | 'pinned'
type ContentKind = 'all' | Item['kind']
export function App() {
  const [refreshTick, setRefreshTick] = useState(0)
  const refresh = useCallback(() => setRefreshTick(value => value + 1), [])
  const platform = useMemo(() => window.householdPlatform || browserPlatform(window.location.origin, refresh), [refresh])
  const [origin, setOrigin] = useState(platform.baseURL || (platform.kind === 'native' ? 'http://127.0.0.1:8787' : window.location.origin))
  const [draftOrigin, setDraftOrigin] = useState(platform.kind === 'native' ? platform.baseURL || '' : origin)
  const api = useMemo(() => new ApiClient(origin, platform.request), [origin, platform])
  const [connected, setConnected] = useState(false); const [checked, setChecked] = useState(false)
  const [needsConnection, setNeedsConnection] = useState(Boolean(platform.requiresConnection))
  const configuredNative = platform.kind === 'native' && !needsConnection
  const nativeNeedsConnection = platform.kind === 'native' && needsConnection
  const [connectionOpen, setConnectionOpen] = useState(false); const [token, setToken] = useState('')
  const connectionTrigger = useRef<HTMLElement | null>(null)
  const openConnection = useCallback(() => { connectionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setConnectionOpen(true) }, [])
  const [advancedToken,setAdvancedToken]=useState(false)
  const [connecting, setConnecting] = useState(false); const [connectionError, setConnectionError] = useState('')
  const [device, setDevice] = useState(() => platform.kind==='native' ? platform.defaultDeviceName||'My device' : stored('household.device', (/Android/i.test(navigator.userAgent) ? 'My Android' : /Mac/i.test(navigator.userAgent) ? 'My Mac' : 'My computer')))
  const [draftDevice,setDraftDevice]=useState(device)
  const openedItem=useRef<Item|null>(null);const pendingArrivalFocus=useRef('')
  const [deviceId,setDeviceId]=useState(''); const [devices,setDevices]=useState<Device[]>([]); const [deviceError,setDeviceError]=useState(''); const [targets,setTargets]=useState<string[]>([])
  const [identityTick,setIdentityTick]=useState(0); const [arrivalTick,setArrivalTick]=useState(0); const [arrivalError,setArrivalError]=useState('')
  const arrivalProcessor=useRef<BrowserArrivals|null>(null)
  const [arrivalTarget,setArrivalTarget]=useState(''); const [targetError,setTargetError]=useState(''); const [highlight,setHighlight]=useState('')
  const pickerRouting=useRef<{routing:SendRouting;sourceDevice:string;origin:string} | undefined>(undefined)
  const [items, setItems] = useState<Item[]>([]); const [cursor, setCursor] = useState<string | null>(null)
  const [storage, setStorage] = useState<StorageInfo>(); const [storageError, setStorageError] = useState('')
  const [query, setQuery] = useState(''); const [search, setSearch] = useState(''); const [view, setView] = useState<View>('all')
  const [contentKind,setContentKind]=useState<ContentKind>('all')
  const [mobileEditing, setMobileEditing] = useState(false); const mobileNav = useRef<HTMLElement>(null)
  const [loading, setLoading] = useState(true); const [loadingMore, setLoadingMore] = useState(false); const [error, setError] = useState('')
  const [live, setLive] = useState(false); const [offline, setOffline] = useState(!navigator.onLine)
  const [toast, setToast] = useState(''); const [text, setText] = useState(''); const [sending, setSending] = useState(false)
  const [composerError, setComposerError] = useState(''); const [dragging, setDragging] = useState(false); const [helpOpen, setHelpOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null); const textFileInput = useRef<HTMLInputElement>(null); const composer = useRef<HTMLTextAreaElement>(null)
  const sequence = useRef(0); const dragDepth = useRef(0)
  const notify = useCallback((message: string) => setToast(message), [])
  const startMobileEditing = () => { if (window.matchMedia('(max-width: 800px)').matches) setMobileEditing(true) }
  const finishMobileEditing = useCallback(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest('.workspace') && ['INPUT','TEXTAREA'].includes(active.tagName)) active.blur()
    setMobileEditing(false)
    requestAnimationFrame(() => mobileNav.current?.querySelector<HTMLButtonElement>('[aria-current]')?.focus({preventScroll:true}))
  }, [])
  useEffect(() => {
    const leave = () => setMobileEditing(false)
    const visibility = () => { if (document.visibilityState === 'hidden') leave() }
    const keyboard = (event: Event) => {
      if (platform.kind !== 'native' || !document.documentElement.hasAttribute('data-native-android') || !(event instanceof CustomEvent) || typeof event.detail?.visible !== 'boolean') return
      if (!event.detail.visible) leave()
      else if (document.activeElement?.closest('.workspace') && document.activeElement.matches('input, textarea') && window.matchMedia('(max-width: 800px)').matches) setMobileEditing(true)
    }
    window.addEventListener('blur', leave); document.addEventListener('visibilitychange', visibility)
    window.addEventListener('household-keyboard-visibility', keyboard)
    return () => { window.removeEventListener('blur', leave); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('household-keyboard-visibility', keyboard) }
  }, [platform])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4000); return () => clearTimeout(timer) }, [toast])
  useEffect(() => { const timer = setTimeout(() => setSearch(query), 300); return () => clearTimeout(timer) }, [query])
  useEffect(() => {
    const on = () => { setOffline(false); refresh() }; const off = () => setOffline(true)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [refresh])
  useEffect(() => {
    const number = ++sequence.current; let cancelled = false
    if (nativeNeedsConnection) { setLoading(false); return }
    setLoading(true); setError('')
    if(view==='you'&&!deviceId){setLoading(false);return}
    void api.list(search,undefined,view==='you'?deviceId:undefined).then(async page => {
      if (cancelled || number !== sequence.current) return
      const selected=openedItem.current
      if(view==='you'&&!search&&selected&&!page.items.some(item=>item.id===selected.id)){
        try{const fresh=await api.item(selected.id);if(fresh.item.status==='ready')page.items=[fresh.item,...page.items]}
        catch(error){if(error instanceof ApiError&&error.status===404){openedItem.current=null;setHighlight('')}else throw error}
      }
      if (cancelled || number !== sequence.current) return
      setItems(page.items); setCursor(page.nextCursor); setConnected(true); setChecked(true); setConnectionError('')
    }).catch(error => {
      if (cancelled || number !== sequence.current) return
      setChecked(true)
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        const message = 'Access was not accepted. Check Tailscale and this server’s access settings, or use an app token under Advanced.'
        setConnected(false); setItems([]); setStorage(undefined); setError(message); setConnectionError(message)
        if (!configuredNative) openConnection()
      }
      else setError(`Couldn’t reach your household. Check Tailscale and that the server is running. ${errorMessage(error)}`)
    }).finally(() => { if (!cancelled && number === sequence.current) setLoading(false) })
    return () => { cancelled = true }
  }, [api, search, refreshTick, view==='you', deviceId, configuredNative, nativeNeedsConnection])
  useEffect(()=>{
    if(!connected)return
    let cancelled=false; setDeviceId('');setDeviceError('')
    void(async()=>{
      const identity=platform.kind==='native'?platform.deviceIdentity:{id:await browserDeviceId(api.baseURL),platform:'browser' as const}
      if(!identity||!validDeviceId(identity.id))throw new Error('This installed client needs the Zing device update before sending. Your feed remains available.')
      const registered=await api.register({...identity,label:device,preserveExisting:true})
      if(!cancelled){setDevice(registered.device.label);setDraftDevice(registered.device.label)}
      const page=await api.devices()
      if(!cancelled){setDeviceId(identity.id);setDevices(page.devices)}
    })().catch(error=>{if(!cancelled)setDeviceError(errorMessage(error))})
    return()=>{cancelled=true}
  },[api,platform,connected,device,identityTick])
  useEffect(()=>{
    if(!connected||!deviceId)return
    let cancelled=false
    void api.devices().then(page=>{if(!cancelled)setDevices(page.devices)}).catch(error=>{if(!cancelled)setDeviceError(errorMessage(error))})
    return()=>{cancelled=true}
  },[api,connected,deviceId,refreshTick])
  useEffect(()=>{
    if(!connected||!deviceId||platform.kind!=='browser')return
    const processor=new BrowserArrivals(api,deviceId,setArrivalError);arrivalProcessor.current=processor
    void processor.check();const timer=setInterval(()=>void processor.check(),15_000)
    const check=()=>void processor.check();window.addEventListener('focus',check);window.addEventListener('online',check)
    return()=>{processor.stop();arrivalProcessor.current=null;clearInterval(timer);window.removeEventListener('focus',check);window.removeEventListener('online',check)}
  },[api,connected,deviceId,platform,arrivalTick])
  useEffect(()=>{void arrivalProcessor.current?.check()},[refreshTick])
  useEffect(()=>{
    const item=new URL(window.location.href).searchParams.get('item')
    if(item){if(validItemId(item))setArrivalTarget(item);else setTargetError('This notification link is invalid.')}
    const message=(event:MessageEvent)=>{if(event.data?.type==='zing-arrival'&&validItemId(event.data.itemId)){const url=new URL(window.location.href);url.searchParams.set('item',event.data.itemId);window.history.replaceState(null,'',url);setArrivalTarget(event.data.itemId)}}
    navigator.serviceWorker?.addEventListener('message',message)
    return()=>navigator.serviceWorker?.removeEventListener('message',message)
  },[])
  useEffect(()=>{
    if(!connected||platform.kind!=='native'||!platform.takeArrivalTarget)return
    let cancelled=false;let pending=false
    const take=()=>{if(pending)return;pending=true;void platform.takeArrivalTarget!().then(target=>{
      if(cancelled||!target)return
      if(target.baseUrl!==api.baseURL||!validItemId(target.itemId)){setTargetError('This alert belongs to a different server or is invalid.');return}
      setArrivalTarget(target.itemId)
    }).catch(error=>{if(!cancelled)setArrivalError(errorMessage(error))}).finally(()=>{pending=false})}
    take();const timer=setInterval(take,5000);window.addEventListener('focus',take);return()=>{cancelled=true;clearInterval(timer);window.removeEventListener('focus',take)}
  },[api,connected,platform,identityTick])
  useEffect(()=>{
    if(!connected||!deviceId||!arrivalTarget)return
    let cancelled=false;setTargetError('')
    void api.item(arrivalTarget).then(({item})=>{
      if(cancelled)return
      if(item.status!=='ready')throw new Error('This share is not ready. Try again later.')
      openedItem.current=item;pendingArrivalFocus.current=item.id;setConnectionOpen(false);setHelpOpen(false);setMobileEditing(false);setView('you');setContentKind('all');setQuery('');setSearch('');setHighlight(item.id)
      setItems(previous=>[item,...previous.filter(row=>row.id!==item.id)])
      setArrivalTarget('')
      const url=new URL(window.location.href);url.searchParams.delete('item');window.history.replaceState(null,'',url)
    }).catch(error=>{if(!cancelled)setTargetError(error instanceof ApiError&&error.status===404?'This share was deleted or is no longer available.':errorMessage(error))})
    return()=>{cancelled=true}
  },[api,connected,deviceId,arrivalTarget,refreshTick])
  useEffect(()=>{
    if(!highlight||loading||pendingArrivalFocus.current!==highlight)return
    const node=document.getElementById(`share-${highlight}`)
    if(node){pendingArrivalFocus.current='';node.scrollIntoView({block:'center'});node.focus({preventScroll:true})}
  },[highlight,items,loading])
  useEffect(() => {
    if (!connected) return
    let cancelled = false
    void api.storage().then(data => { if (!cancelled) { setStorage(data); setStorageError('') } }).catch(error => { if (!cancelled) setStorageError(errorMessage(error)) })
    return () => { cancelled = true }
  }, [api, connected, refreshTick])
  useEffect(() => {
    if (!connected) return
    if (platform.openEvents) return platform.openEvents(refresh, setLive)
    const events = new EventSource(api.url('/events'), { withCredentials: true })
    events.onopen = () => { setLive(true); refresh() }
    events.addEventListener('items', refresh)
    events.onerror = () => setLive(false)
    // EventSource reconnects automatically; a reconnect always refreshes bounded metadata.
    return () => { events.close(); setLive(false) }
  }, [api, connected, platform, refresh])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
      const target = event.target as HTMLElement
      if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(target.tagName) && !target.isContentEditable) { event.preventDefault(); document.getElementById('feed-search')?.focus() }
      if (event.key === 'Escape') { setConnectionOpen(false); setHelpOpen(false); if (mobileEditing && target.closest('.workspace')) finishMobileEditing() }
    }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [mobileEditing, finishMobileEditing])
  useEffect(() => {
    if (!connectionOpen && !helpOpen) return
    const previous = connectionOpen ? connectionTrigger.current : document.activeElement as HTMLElement | null
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, a[href], [tabindex="0"]') || []).filter(node=>!node.closest('details:not([open])')||node.tagName==='SUMMARY')
    const timer = setTimeout(() => { if (!dialog?.contains(document.activeElement)) focusable()[0]?.focus() }, 0)
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const elements = focusable(); const first = elements[0]; const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap)
    document.body.classList.add('modal-open')
    return () => { clearTimeout(timer); document.removeEventListener('keydown', trap); document.body.classList.remove('modal-open'); if(previous?.isConnected)previous.focus() }
  }, [connectionOpen, helpOpen])
  const connect = async (event: FormEvent) => {
    event.preventDefault(); setConnecting(true); setConnectionError('')
    try {
      const target = new ApiClient(draftOrigin, platform.request)
      if (platform.kind === 'browser' && target.baseURL !== window.location.origin) throw new Error('Open Zing at your server’s address to connect. Browser sessions use the server you opened.')
      if (platform.configureConnection) { await platform.configureConnection(target.baseURL, token, draftDevice); setOrigin(target.baseURL); setConnected(false); setItems([]); setStorage(undefined) }
      else if(token) await target.session(token)
      await target.list()
      const identity=platform.kind==='native'?platform.deviceIdentity:{id:await browserDeviceId(target.baseURL),platform:'browser' as const}
      if(identity&&draftDevice!==device)await target.register({...identity,label:draftDevice})
      setOrigin(target.baseURL); setConnected(true); setChecked(true); setNeedsConnection(false); setConnectionOpen(false); setToken(''); setTargets([]);setIdentityTick(value=>value+1); setDevice(draftDevice);save('household.device', draftDevice); refresh()
    } catch (error) { setConnectionError(error instanceof ApiError&&(error.status===401||error.status===403)?'Access was not accepted. Check Tailscale and server access, or use an app token under Advanced.':`Couldn’t reach your household. Check Tailscale and that the server is running. ${errorMessage(error)}`) } finally { setConnecting(false) }
  }
  const renameDevice = async (name: string) => {
    const identity=platform.kind==='native'?platform.deviceIdentity:{id:deviceId,platform:'browser' as const}
    if(!identity||!validDeviceId(identity.id))throw new Error('Register this device before renaming it.')
    let localSaved=false
    try {
      if(platform.renameDevice){await platform.renameDevice(name);localSaved=true}
      const result=await api.register({...identity,label:name})
      setDevice(result.device.label);setDraftDevice(result.device.label);save('household.device',result.device.label);refresh();notify('Device name saved.')
    }catch(error){throw new Error(`${errorMessage(error)}${localSaved?' Saved on this device, but the household name could not be updated. Your input is kept; retry to finish.':''}`)}
  }
  const saveDeviceName = async () => {
    setConnecting(true);setConnectionError('')
    try { await renameDevice(draftDevice) }
    catch(error){setConnectionError(errorMessage(error))}finally{setConnecting(false)}
  }
  const logout = async () => {
    try { if (platform.disconnect) await platform.disconnect(); else { await Promise.all(platform.transfers.getSnapshot().filter(row => ['queued', 'checking', 'uploading'].includes(row.state)).map(row => platform.transfers.pause(row.id))); await api.logout() } sequence.current++;setDeviceId('');setDevices([]);setTargets([]);openedItem.current=null;setHighlight('');setView('all'); setError(''); setNeedsConnection(true); setConnected(false); setItems([]); setStorage(undefined); setMobileEditing(false); setConnectionOpen(platform.kind === 'browser'); notify('Disconnected.') }
    catch (error) { setConnectionError(errorMessage(error)) }
  }
  const sendText = async () => {
    if (!text.length || sending) return
    setSending(true); setComposerError('')
    try {
      const maxTextBytes = storage?.maxTextBytes || 32 * 1024 ** 2
      if (text.length > maxTextBytes || new TextEncoder().encode(text).length > maxTextBytes) throw new Error(`Use “Upload text file” for text larger than ${formatBytes(maxTextBytes)}.`)
      const routing=sendRouting(deviceId,targets,devices)
      await api.createText(text, device,routing); setText(''); refresh(); notify('Text shared with your household.')
    } catch (error) { setComposerError(errorMessage(error)) } finally { setSending(false) }
  }
  const enqueue = (files: File[], kind: 'file' | 'text', selected?:{routing:SendRouting;sourceDevice:string;origin:string}) => {
    if (!connected) { openConnection(); return }
    if (!storage) { setError('Wait for the server’s storage limits before adding files, then try again.'); refresh(); return }
    try {
      if(selected&&selected.origin!==api.baseURL)throw new Error('The server changed while choosing files. Choose them again for this server.')
      platform.transfers.enqueue(files, kind, selected?.sourceDevice||device, storage.maxFileBytes,selected?.routing||sendRouting(deviceId,targets,devices))
    } catch (error) { setError(errorMessage(error)) }
  }
  const choose = (kind: 'file' | 'text') => {
    if (!connected) { openConnection(); return }
    try{
      const routing=sendRouting(deviceId,targets,devices)
      pickerRouting.current={routing,sourceDevice:device,origin:api.baseURL}
      if (platform.chooseFiles) { void platform.chooseFiles(kind,device,routing.targetDeviceIds).catch(error => setError(errorMessage(error))); return }
    }catch(error){setError(errorMessage(error));return}
    if (kind === 'text') textFileInput.current?.click(); else input.current?.click()
  }
  const loadMore = async () => {
    if (!cursor || loadingMore) return
    const current = sequence.current; setLoadingMore(true)
    try { const page = await api.list(search, cursor,view==='you'?deviceId:undefined); if (current === sequence.current) { setItems(previous => { const ids = new Set(previous.map(item => item.id)); return [...previous, ...page.items.filter(item => !ids.has(item.id))] }); setCursor(page.nextCursor) } }
    catch (error) { setError(errorMessage(error)) } finally { setLoadingMore(false) }
  }
  const drag = (event: DragEvent, entering: boolean) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current + (entering ? 1 : -1)); setDragging(dragDepth.current > 0)
  }
  const drop = (event: DragEvent) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); enqueue(Array.from(event.dataTransfer.files), 'file') }
  const visible = items.filter(item => (view !== 'pinned' || item.pinned) && (contentKind === 'all' || item.kind === contentKind))
  const nav = [{ id: 'all', label: 'All shares', icon: Inbox }, {id:'you',label:'For you',icon:Smartphone}, { id: 'pinned', label: 'Pinned', icon: Pin }] as const
  return <div className={`app-shell ${connected ? 'is-connected' : ''}`} onDragEnter={event => drag(event, true)} onDragLeave={event => drag(event, false)} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault() }} onDrop={drop}>
    <a className="skip-link" href="#main">Skip to feed</a>
    <aside className="sidebar" inert={connectionOpen || helpOpen}>
      <a className="brand" href="/" aria-label="Zing home"><ZingMark className="brand-mark" /><span className="brand-wordmark">Zing<span className="brand-signal" aria-hidden="true" /></span></a>
      <nav aria-label="Feed filters">{nav.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? 'selected' : ''}`} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined}><Icon size={18} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom">
        <div className="storage-card"><div><HardDrive size={17} /><strong>Household storage</strong></div>{storage ? <><p>{formatBytes(storage.usedBytes)} <span>stored</span></p><meter className="storage-bar" aria-label="Storage used" min={0} max={Math.max(1, storage.maxStorageBytes || storage.usedBytes + storage.freeBytes)} value={storage.usedBytes}>{formatBytes(storage.usedBytes)} stored</meter><small>{formatBytes(storage.freeBytes)} disk space free{storage.maxStorageBytes ? ` · ${formatBytes(storage.maxStorageBytes)} app budget` : ''}</small></> : <p className="storage-wait">{storageError ? 'Storage status unavailable' : connected ? 'Checking storage…' : 'Connect to view storage'}</p>}</div>
        <button className="sidebar-link" onClick={() => setHelpOpen(true)}><CircleHelp size={17} /> Help & tips</button>
        <div className="device-card"><span className="device-avatar"><Smartphone size={18} /></span><div><strong>{device}</strong><span>{platform.kind === 'native' ? 'Installed client' : 'Browser client'}</span></div><button className="icon-button" onClick={() => openConnection()} aria-label="Connection and device settings"><Settings2 size={16} /></button></div>
      </div>
    </aside>
    <div className="workspace" inert={connectionOpen || helpOpen} onFocusCapture={event=>{if(event.target.matches('input:not([type=file]), textarea'))startMobileEditing()}} onBlurCapture={event=>{const next=event.relatedTarget;if(!(next instanceof HTMLElement) || (!next.matches('input:not([type=file]), textarea') && !next.closest('.composer, .entry-editor, .editing-toolbar, .recipient-popover')))setMobileEditing(false)}}>
      <header className="topbar"><a className="mobile-brand" href="/" aria-label="Zing home"><ZingMark className="brand-mark" /><span className="brand-wordmark">Zing<span className="brand-signal" aria-hidden="true" /></span></a><h1 className="workspace-title">{nav.find(item=>item.id===view)?.label}</h1><button className={`connection-badge ${connected && live && !offline ? 'is-live' : ''}`} onClick={() => openConnection()}><span className="status-dot" />{nativeNeedsConnection ? 'Not connected' : offline ? 'Offline' : !connected ? configuredNative ? checked ? 'Connection issue' : 'Connecting…' : 'Connect household' : live ? 'Connected' : 'Reconnecting…'}<Settings2 size={15} /></button></header>
      <main id="main">
        {connected && deviceId && platform.renameDevice && device==='Desktop' && <DeviceNamePrompt key={`${api.baseURL}:${deviceId}`} identityKey={`${api.baseURL}:${deviceId}`} name={platform.defaultDeviceName||device} rename={renameDevice}/>}
        {offline && <div className="banner" role="status"><WifiOff size={17} /><span>You’re offline. Your saved transfers can resume when you reconnect.</span></div>}
        {(nativeNeedsConnection || (checked && !connected && !connectionOpen && !configuredNative)) && <div className="banner"><Link2 size={17} /><span>{nativeNeedsConnection ? 'Choose your household server in Settings. This app will remember the connection.' : 'Connect to your household to see and share items.'}</span><button className="text-button" onClick={() => openConnection()}>{nativeNeedsConnection ? 'Configure connection' : 'Connect'} <ArrowRight size={14} /></button></div>}
        {deviceError&&<div className="banner error-banner" role="alert"><span>{deviceError}</span><button className="text-button" onClick={()=>setIdentityTick(value=>value+1)}>Retry registration</button></div>}
        {targetError&&<div className="banner error-banner" role="alert"><span>{targetError}</span><button className="text-button" onClick={refresh}>Retry opening share</button><button className="icon-button" aria-label="Dismiss opening error" onClick={()=>{setTargetError('');setArrivalTarget('')}}><X size={15}/></button></div>}
        <section className={`composer ${text.length ? 'has-draft' : ''}`} aria-labelledby="composer-title"><h2 id="composer-title" className="sr-only">Send to your household</h2><textarea ref={composer} aria-label="Text to share" placeholder="Paste a note, a link, anything…" value={text} onChange={event => { const value = event.target.value; setText(previous => preserveTextareaEdit(previous, value)) }} onPaste={event => {
          if (!event.clipboardData.types.includes('text/plain')) return
          event.preventDefault()
          const pasted = event.clipboardData.getData('text/plain'); const start = event.currentTarget.selectionStart; const end = event.currentTarget.selectionEnd
          setText(previous => insertPlainText(previous, start, end, pasted))
          requestAnimationFrame(() => { const caret = start + textareaText(pasted).length; composer.current?.setSelectionRange(caret, caret) })
        }} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void sendText() } }} disabled={!connected || !deviceId || sending} /><div className="composer-bottom"><div className="composer-tools"><button className="button action-button add-files" aria-label="Add files" title="Add files" onClick={() => choose('file')}><Paperclip size={18} /><span className="add-files-label">Add files</span></button><ItemMenu name="sharing">{close => <button role="menuitem" onClick={() => { choose('text'); close() }}><FileText size={17}/>Upload text file</button>}</ItemMenu></div><RecipientPicker devices={devices} currentId={deviceId} targets={targets} onChange={setTargets} onRefresh={refresh} disabled={!connected||!deviceId}/><button className="button primary send-button" aria-label={sending?'Sharing…':'Share text'} title="Share text" disabled={!connected || !deviceId || !text.length || sending} onClick={() => void sendText()}>{sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}<span>Send</span></button></div>{platform.kind==='browser'&&<p className="composer-context">Keep this tab open while sending.</p>}{text.length > 0 && <div className="composer-footnote"><span>{text.length.toLocaleString()} characters · whitespace preserved</span></div>}{composerError && <p role="alert" className="inline-error">{composerError}</p>}</section>
        {mobileEditing && <div className="editing-toolbar"><button className="finish-editing" onClick={finishMobileEditing}><Check size={16} aria-hidden="true"/>Done editing</button></div>}
        <nav ref={mobileNav} className="mobile-tabs" hidden={mobileEditing} aria-label="Mobile feed filters"><div className="mobile-tab-list">{nav.map(({id,label,icon:Icon})=><button key={id} aria-current={view===id?'page':undefined} onClick={()=>setView(id)}><Icon size={21} aria-hidden="true"/><span>{label}</span></button>)}</div></nav>
        <input className="sr-only" type="file" multiple ref={input} aria-label="Choose files to upload" onChange={event => { enqueue(Array.from(event.currentTarget.files || []), 'file',pickerRouting.current); event.currentTarget.value = '';pickerRouting.current=undefined }} /><input className="sr-only" type="file" multiple accept={textFileAccept} ref={textFileInput} aria-label="Choose plain text files to upload" onChange={event => { enqueue(Array.from(event.currentTarget.files || []), 'text',pickerRouting.current); event.currentTarget.value = '';pickerRouting.current=undefined }} />
        <TransferQueue store={platform.transfers} onError={setError} />
        <section className="feed" aria-labelledby="feed-title"><div className="feed-toolbar"><div className="feed-title"><h2 id="feed-title">{search ? 'Search results' : view==='you'?'Sent to this device':'Recent shares'}</h2></div><label className="kind-filter"><span className="sr-only">Content type</span><select value={contentKind} onChange={event=>setContentKind(event.target.value as ContentKind)}><option value="all">All types</option><option value="text">Text</option><option value="file">Files</option></select></label><div className="feed-controls"><label className="search-field"><Search size={16} /><input id="feed-search" type="search" placeholder="Search shares" value={query} onChange={event => setQuery(event.target.value)} /><span className="search-shortcut">/</span><span className="sr-only">Search names and text previews</span></label><button className="icon-button refresh-button" onClick={refresh} disabled={loading} aria-label="Refresh feed"><RefreshCw className={loading ? 'spin' : ''} size={17} /></button></div></div>
          {error && <div className="banner error-banner" role="alert"><span>{error}</span><button className="text-button" onClick={refresh}>Retry</button>{configuredNative && <button className="text-button" onClick={() => openConnection()}>Settings</button>}<button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
          {loading && !items.length ? <div className="empty-state" role="status"><LoaderCircle className="spin" size={25} /><h3>Opening your household…</h3></div> : visible.length ? <div className="feed-list">{visible.map(item => <div key={item.id} id={`share-${item.id}`} tabIndex={-1} className={highlight===item.id?'arrival-highlight':undefined}><FeedCard item={item} api={api} platform={platform} refresh={refresh} notify={notify} /></div>)}</div> : <div className="empty-state"><div className="empty-illustration"><Inbox size={35} strokeWidth={1.3} /></div><h3>{!connected ? nativeNeedsConnection ? 'No household connection yet' : configuredNative ? 'Your household is unavailable' : 'Connect your household' : search ? 'No matching shares' : contentKind !== 'all' ? `No ${contentKind === 'text' ? 'text shares' : 'files'} in this view` : view === 'pinned' ? 'No pinned items' : view==='you'?'Nothing sent to you yet':'A fresh start'}</h3><p>{!connected ? nativeNeedsConnection ? 'Save your server address using Configure connection above, or open connection settings at any time.' : configuredNative ? 'Retry when Tailscale and the server are available, or check connection settings.' : 'Connect to your private server to bring your devices together.' : search ? 'Try another name or a phrase from the text preview.' : contentKind !== 'all' ? 'Choose All types or load older items to include more shares.' : view === 'pinned' ? 'Pin an item to find it here. Load more to include older pins.' : view==='you'?'New shares addressed to this device or Everyone appear here. All shares shows the whole household.':'Paste something above or add a file. It’ll be here when you pick up your next device.'}</p>{!connected ? platform.kind === 'browser' && <button className="button primary" onClick={() => openConnection()}><Link2 size={16} /> Connect household</button> : !search && contentKind === 'all' && view !== 'pinned' && <button className="button secondary" onClick={() => composer.current?.focus()}><Plus size={16} /> Share something</button>}</div>}
          {cursor && <button className="load-more button secondary" onClick={() => void loadMore()} disabled={loadingMore || loading}>{loadingMore ? <LoaderCircle className="spin" size={15} /> : <ArrowDown size={15} />} Load older items</button>}
        </section>
      </main>
    </div>
    {dragging && <div className="drop-overlay"><div><UploadCloud size={52} strokeWidth={1.3} /><h2>Drop files to share</h2><p>Upload to your household server.</p></div></div>}
    {toast && <div className="toast" role="status"><Check size={17} />{toast}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></button></div>}
    {connectionOpen && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && connected) setConnectionOpen(false) }}><section className="modal connection-modal" role="dialog" aria-modal="true" aria-labelledby="connection-title"><button className="icon-button modal-close" aria-label="Close connection settings" onClick={() => setConnectionOpen(false)}><X size={20} /></button><div className="connection-heading"><ZingMark className="modal-icon" /><h2 id="connection-title">{connected || platform.kind === 'native' ? 'Connection settings' : 'Connect to Zing'}</h2></div><p>{connected || platform.kind === 'native' ? 'Manage this device’s connection. Your server address is remembered on this device.' : 'Connect through Tailscale. Installed apps remember your server address.'}</p>{connected && storage && <div className="settings-storage"><span><HardDrive size={16}/>Storage</span><p><strong>{formatBytes(storage.usedBytes)}</strong> stored · <strong>{formatBytes(storage.freeBytes)}</strong> free</p><small>Up to {formatBytes(storage.maxFileBytes)} per file</small></div>}<form onSubmit={event => void connect(event)}><label>Household server<input autoFocus type="url" required value={draftOrigin} onChange={event => setDraftOrigin(event.target.value)} spellCheck={false} autoCapitalize="none" /></label>{platform.kind === 'browser' && <p className="field-note">Use your private Tailscale HTTPS address.</p>}<button type="button" className="text-button advanced-token" aria-expanded={advancedToken} onClick={()=>setAdvancedToken(!advancedToken)}>Advanced · Use app token</button>{advancedToken&&<label>App token (optional)<input type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" placeholder="For token servers or local development" /></label>}<label>This device’s name<input required maxLength={80} value={draftDevice} onChange={event => setDraftDevice(event.target.value)} autoComplete="off" /></label><p className="field-note">Shown beside your shares, e.g. “Kitchen Mac”.</p>{connectionError && <p className="inline-error" role="alert">{connectionError}</p>}<button className="button primary connect-button" disabled={connecting}>{connecting ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />}{connecting ? 'Connecting…' : 'Connect household'}</button></form>{connected&&<button className="button secondary save-device-name" disabled={draftDevice===device||connecting} onClick={()=>void saveDeviceName()}>Save device name</button>}
      <button className="text-button settings-help" onClick={()=>{setConnectionOpen(false);setHelpOpen(true)}}><CircleHelp size={17}/>Help & tips</button>
      {connected&&deviceError&&<p className="inline-error" role="alert">{deviceError}</p>}
      {connected&&<DeviceSettings api={api} platform={platform} deviceId={deviceId} devices={devices} refresh={refresh} onArrivalChange={()=>setArrivalTick(value=>value+1)} arrivalError={arrivalError}/>}
      {(connected || configuredNative) && <button className="text-button disconnect-button" onClick={() => void logout()}><LogOut size={14} /> {platform.kind === 'native' ? 'Disconnect this app' : 'Disconnect this browser'}</button>}<p className="field-note">Disconnect clears this app’s connection state. It does not revoke Tailscale access.</p><div className="modal-footnote"><LockKeyhole size={13} />{platform.kind === 'native' ? 'Server settings are stored by your installed client.' : 'Optional tokens aren’t saved in browser storage.'}</div></section></div>}
    {helpOpen && <div className="modal-backdrop"><section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><button className="icon-button modal-close" aria-label="Close help" onClick={() => setHelpOpen(false)} autoFocus><X size={20} /></button><span className="modal-icon"><CircleHelp size={27} /></span><h2 id="help-title">Using Zing</h2><div className="help-entry"><UploadCloud size={20} /><div><h3>{platform.kind === 'native' ? 'Your native queue keeps transfer state.' : 'Keep this browser open while sending.'}</h3><p>{platform.kind === 'native' ? 'The native transfer engine owns your queue outside this interface. Sleep, shutdown, explicit Quit, or OS restrictions can pause work. Reopen the app to inspect and resume transfers.' : 'Browser uploads can pause when the tab closes or the device sleeps. Reopen the app and reselect the original file to resume. Source verification reads the file in bounded chunks.'}</p></div></div><div className="help-entry"><Clipboard size={20} /><div><h3>Copy means the whole text.</h3><p>Small notes prepare automatically. For text up to 8 MiB, press Prepare copy, then Copy text. Expanded previews show at most 256 KiB. Clipboard limits vary by device; Download .txt is always available once ready.</p></div></div><div className="help-entry"><HardDrive size={20} /><div><h3>Ready when the server says so.</h3><p>Completed transfers are checked by your server before becoming downloadable. Files stay until someone deletes them. Deleting an item removes it for everyone.</p></div></div><div className="help-entry"><ShieldCheck size={20} /><div><h3>Your household, privately connected.</h3><p>Use your private Tailscale HTTPS address. Your server stores the content and must be online to send or retrieve it.{platform.deviceIdentity?.platform==='android'&&' Reopen Zing after reboot or force-stop to resume arrival checks; Android may delay background checks.'}{platform.kind === 'browser' && ' Install this page from your browser’s app menu where available.'}</p></div></div><button className="button primary connect-button" onClick={() => setHelpOpen(false)}>Got it</button></section></div>}
  </div>
}
