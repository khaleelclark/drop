import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { ArrowDown, ArrowRight, Check, CircleHelp, Clipboard, FileText, HardDrive, Inbox, Link2, LoaderCircle, LogOut, Paperclip, Pin, Plus, RefreshCw, Search, Send, Settings2, ShieldCheck, Smartphone, UploadCloud, WifiOff, X, Trash2, Undo2 } from 'lucide-react'
import { ApiClient, ApiError } from './api'
import { browserPlatform } from './platform'
import { browserDeviceId, sendRouting, validDeviceId, validItemId } from './devices'
import { BrowserArrivals } from './arrivals'
import { RecipientPicker } from './RecipientPicker'
import { DeviceSettings } from './DeviceSettings'
import { DeviceNamePrompt } from './DeviceNamePrompt'
import { Appearance, useAppearance } from './Appearance'
import { PurgeDialog } from './PurgeDialog'
import { TrashSettings } from './TrashSettings'
import { FeedCard } from './FeedCard'
import { ItemMenu } from './ItemMenu'
import { ZingMark } from './ZingMark'
import { insertPlainText, preserveTextareaEdit, textareaText } from './text-editing'
import { TransferQueue } from './TransferQueue'
import { textFileAccept } from './text-files'
import { errorMessage, formatBytes, type Device, type SendRouting, type Item, type ItemAction, type ItemActionResult, type StorageInfo, type TrashSummary } from './types'
function stored(key: string, fallback: string) { try { return localStorage.getItem(key) || fallback } catch { return fallback } }
function save(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* Settings are optional. */ } }
type View = 'all' | 'you' | 'pinned' | 'trash'
type ContentKind = 'all' | Item['kind']
export function App() {
  const [refreshTick, setRefreshTick] = useState(0)
  const refresh = useCallback(() => setRefreshTick(value => value + 1), [])
  const platform = useMemo(() => window.householdPlatform || browserPlatform(window.location.origin, refresh), [refresh])
  const appearance=useAppearance(platform)
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
  const [selecting,setSelecting]=useState(false),[selected,setSelected]=useState<string[]>([])
  const [actionBusy,setActionBusy]=useState(false),[actionErrors,setActionErrors]=useState<{id:string;name:string;message:string}[]>([])
  const [trashSupport,setTrashSupport]=useState<'checking'|'supported'|'unsupported'|'unavailable'>('checking')
  const [folderUnsupported,setFolderUnsupported]=useState(false)
  const actionErrorArea=useRef<HTMLDivElement>(null)
  useEffect(()=>{if(actionErrors.length)actionErrorArea.current?.scrollIntoView({block:'nearest'})},[actionErrors])
  const actionLock=useRef(false);const [purgeIds,setPurgeIds]=useState<string[]|null>(null)
  const [folderSummary,setFolderSummary]=useState<TrashSummary|null>(null)
  const [folderProgress,setFolderProgress]=useState<{deleted:number;failed:number;running:boolean;uncertain:boolean}|null>(null)
  const currentApi=useRef(api);currentApi.current=api
  useEffect(()=>setFolderProgress(null),[api])
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
      else if (document.activeElement?.closest('.workspace') && document.activeElement.matches('input:not([type=checkbox]):not([type=file]), textarea') && window.matchMedia('(max-width: 800px)').matches) setMobileEditing(true)
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
    void (view==='trash'?api.trashPage(search):api.list(search,undefined,view==='you'?deviceId:undefined)).then(async page => {
      if (cancelled || number !== sequence.current) return
      const selected=openedItem.current
      if(view==='you'&&!search&&selected&&!page.items.some(item=>item.id===selected.id)){
        try{const fresh=await api.item(selected.id);if(fresh.item.status==='ready')page.items=[fresh.item,...page.items]}
        catch(error){if(error instanceof ApiError&&error.status===404){openedItem.current=null;setHighlight('')}else throw error}
      }
      if (cancelled || number !== sequence.current) return
      setItems(page.items); setCursor(page.nextCursor); setConnected(true); setChecked(true); setConnectionError('')
      if(view==='trash')setTrashSupport('supported')
    }).catch(error => {
      if (cancelled || number !== sequence.current) return
      setChecked(true)
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        const message = 'Access was not accepted. Check Tailscale and this server’s access settings, or use an app token under Advanced.'
        setConnected(false); setItems([]); setStorage(undefined); setError(message); setConnectionError(message)
        if (!configuredNative) openConnection()
      }
      else if(error instanceof ApiError&&error.code==='update_required')setTrashSupport('unsupported')
      else setError(`Couldn’t load shares. ${errorMessage(error)}`)
    }).finally(() => { if (!cancelled && number === sequence.current) setLoading(false) })
    return () => { cancelled = true }
  }, [api, search, refreshTick, view==='you', view==='trash', deviceId, configuredNative, nativeNeedsConnection])
  useEffect(()=>{setTrashSupport('checking');setFolderUnsupported(false)},[api])
  useEffect(()=>{
    if(!connected||view==='trash')return
    let cancelled=false
    void api.trashPage().then(()=>{if(!cancelled)setTrashSupport('supported')}).catch(error=>{
      if(!cancelled)setTrashSupport(error instanceof ApiError&&error.code==='update_required'?'unsupported':'unavailable')
    })
    return()=>{cancelled=true}
  },[api,connected,refreshTick,view==='trash'])
  useEffect(()=>{setSelecting(false);setSelected([]);if(!actionLock.current){setActionErrors([]);setPurgeIds(null);setFolderSummary(null)}},[view,search,contentKind,api])
  useEffect(()=>{setItems([])},[api,search,view==='trash',view==='you'])
  useEffect(()=>{
    if(!connected)return
    let cancelled=false; setDeviceId('');setDeviceError('')
    void(async()=>{
      const identity=platform.kind==='native'?platform.deviceIdentity:{id:await browserDeviceId(api.baseURL),platform:'browser' as const}
      if(!identity||!validDeviceId(identity.id))throw new Error('This installed client needs the Drop device update before sending. Your feed remains available.')
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
      if (platform.kind === 'browser' && target.baseURL !== window.location.origin) throw new Error('Open Drop at your server’s address to connect. Browser sessions use the server you opened.')
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
      await api.createText(text, device,routing); setText(''); refresh(); notify('Sent.')
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
    try { const page = await (view==='trash'?api.trashPage(search,cursor):api.list(search, cursor,view==='you'?deviceId:undefined)); if (current === sequence.current) { setItems(previous => { const ids = new Set(previous.map(item => item.id)); return [...previous, ...page.items.filter(item => !ids.has(item.id))] }); setCursor(page.nextCursor) } }
    catch (error) { setError(errorMessage(error)) } finally { setLoadingMore(false) }
  }
  const drag = (event: DragEvent, entering: boolean) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current + (entering ? 1 : -1)); setDragging(dragDepth.current > 0)
  }
  const drop = (event: DragEvent) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); enqueue(Array.from(event.dataTransfer.files), 'file') }
  const visible = items.filter(item => (view !== 'pinned' || item.pinned) && (contentKind === 'all' || item.kind === contentKind))
  const nav = [{ id: 'all', label: 'All shares', icon: Inbox }, {id:'you',label:'For you',icon:Smartphone}, { id: 'pinned', label: 'Pinned', icon: Pin }, {id:'trash',label:'Recently Deleted',icon:Trash2}] as const
  const actionScope=useRef('');actionScope.current=`${api.baseURL}:${view}:${search}:${contentKind}`
  const eligible=visible.filter(item=>item.status!=='uploading')
  const displayedSelected=selected.filter(id=>eligible.some(item=>item.id===id))
  const toggleSelection=(id:string)=>setSelected(previous=>previous.includes(id)?previous.filter(value=>value!==id):previous.length<100?[...previous,id]:previous)
  const perform=async(action:ItemAction,ids:string[])=>{
    if(actionLock.current||!ids.length||trashSupport!=='supported')return
    actionLock.current=true;setActionBusy(true);setActionErrors([]);setFolderProgress(null)
    const scope=actionScope.current;const names=new Map(items.map(item=>[item.id,item.name]))
    try{
      let results:ItemActionResult[]
      if(ids.length===1){await api.itemAction(action,ids[0]);results=[{id:ids[0],ok:true}]}
      else results=await api.itemActions(action,ids)
      const success=new Set(results.filter(result=>result.ok).map(result=>result.id))
      const failed=results.filter((result):result is Extract<ItemActionResult,{ok:false}>=>!result.ok)
      if(scope!==actionScope.current){refresh();return}
      sequence.current++;setItems(previous=>previous.filter(item=>!success.has(item.id)))
      setSelected(previous=>previous.filter(id=>!success.has(id)))
      setActionErrors(failed.map(result=>({id:result.id,name:names.get(result.id)||result.id,message:result.error.code==='upload_active'?'This upload is still active. Use Cancel in Transfers instead.':`${result.error.message}${action==='purge'&&result.error.status>=500?' It may already be permanently deleted. Refresh to check.':''}`})))
      if(success.size)notify(`${success.size} ${success.size===1?'item':'items'} ${action==='trash'?'moved to Recently Deleted':action==='restore'?'restored':'permanently deleted'}.`)
      refresh()
    }catch(error){if(scope===actionScope.current){
      if(error instanceof ApiError&&error.code==='update_required')setTrashSupport('unsupported')
      else setActionErrors([{id:'action',name:ids.map(id=>names.get(id)||id).join(', '),message:error instanceof ApiError&&error.status<500?errorMessage(error):`${errorMessage(error)} Outcome unconfirmed. ${action==='purge'?'Items may already be permanently deleted. ':''}Refresh before retrying.`}])
    }}
    finally{setActionBusy(false);actionLock.current=false;setPurgeIds(null)}
  }
  const previewFolder=async()=>{
    if(actionLock.current||trashSupport!=='supported'||folderUnsupported)return
    actionLock.current=true;setActionBusy(true);setActionErrors([]);setFolderProgress(null)
    try{const summary=await api.trashSummary();if(currentApi.current===api){if(summary.count)setFolderSummary(summary);else notify('Recently Deleted is empty.')}}
    catch(error){if(currentApi.current===api){if(error instanceof ApiError&&error.code==='update_required')setFolderUnsupported(true);else setActionErrors([{id:'folder-preview',name:'Recently Deleted',message:errorMessage(error)}])}}
    finally{actionLock.current=false;setActionBusy(false)}
  }
  const purgeFolder=async()=>{
    if(actionLock.current||!folderSummary)return
    actionLock.current=true;setActionBusy(true);setActionErrors([])
    let deleted=0,failed=0,before:string|undefined,uncertain=false
    const failures:{id:string;name:string;message:string}[]=[]
    const names=new Map(items.map(item=>[item.id,item.name]))
    setFolderProgress({deleted,failed,running:true,uncertain})
    try{
      do{
        if(currentApi.current!==api)throw new Error('The household connection changed. Further batches were stopped.')
        const page=await api.purgeTrash(folderSummary.cutoff,before)
        const success=new Set(page.results.filter(result=>result.ok).map(result=>result.id))
        const errors=page.results.filter((result):result is Extract<ItemActionResult,{ok:false}>=>!result.ok)
        deleted+=success.size;failed+=errors.length
        // Keep only bounded failure details, not every ID in the whole folder.
        for(const result of errors)if(failures.length<20)failures.push({id:result.id,name:names.get(result.id)||result.id,message:`${result.error.message}${result.error.status>=500?' It may already be permanently deleted. Refresh to check.':''}`})
        if(currentApi.current===api){
          sequence.current++;setItems(previous=>previous.filter(item=>!success.has(item.id)))
          setSelected(previous=>[...new Set([...previous.filter(id=>!success.has(id)),...errors.filter(result=>names.has(result.id)).map(result=>result.id)])].slice(0,100))
          setActionErrors([...failures]);setFolderProgress({deleted,failed,running:true,uncertain})
        }
        before=page.nextCursor===null?undefined:page.nextCursor
      }while(before!==undefined)
    }catch(error){
      uncertain=true
      failures.push({id:'folder-unknown',name:'Unconfirmed batch',message:`${errorMessage(error)} This batch’s outcome is unconfirmed. Items may already be permanently deleted. Refresh before a new action.`})
    }finally{
      if(currentApi.current===api){setFolderProgress({deleted,failed,running:false,uncertain});setActionErrors([...failures]);if(failures.length)setSelecting(true);notify(`${deleted} ${deleted===1?'item':'items'} confirmed permanently deleted.${failed?` ${failed} failed.`:''}${uncertain?' One batch is unconfirmed.':''}`);refresh()}
      setFolderSummary(null);setActionBusy(false);actionLock.current=false
    }
  }
  return <div className={`app-shell ${connected ? 'is-connected' : ''}`} onDragEnter={event => drag(event, true)} onDragLeave={event => drag(event, false)} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault() }} onDrop={drop}>
    <a className="skip-link" href="#feed">Skip to feed</a>
    <aside className="sidebar" inert={connectionOpen || helpOpen}>
      <a className="brand" href="/" aria-label="Drop home"><ZingMark className="brand-mark" /><span className="brand-wordmark">Drop<span className="brand-signal" aria-hidden="true" /></span></a>
      <nav aria-label="Feed filters">{nav.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? 'selected' : ''}`} disabled={actionBusy} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined}><Icon size={18} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom">
        <div className="storage-card"><div><HardDrive size={17} /><strong>Storage</strong></div>{storage ? <><p>{formatBytes(storage.usedBytes)} <span>stored</span></p><meter className="storage-bar" aria-label="Storage used" min={0} max={Math.max(1, storage.maxStorageBytes || storage.usedBytes + storage.freeBytes)} value={storage.usedBytes}>{formatBytes(storage.usedBytes)} stored</meter><small>{formatBytes(storage.freeBytes)} disk space free{storage.maxStorageBytes ? ` · ${formatBytes(storage.maxStorageBytes)} app budget` : ''}</small></> : <p className="storage-wait">{storageError ? 'Storage status unavailable' : connected ? 'Checking storage…' : 'Connect to view storage'}</p>}</div>
        <button className="sidebar-link" onClick={() => setHelpOpen(true)}><CircleHelp size={17} /> Help & tips</button>
        <div className="device-card"><span className="device-avatar"><Smartphone size={18} /></span><div><strong>{device}</strong><span>{platform.kind === 'native' ? 'Installed client' : 'Browser client'}</span></div><button className="icon-button" disabled={actionBusy} onClick={() => openConnection()} aria-label="Connection and device settings"><Settings2 size={16} /></button></div>
      </div>
    </aside>
    <div className="workspace" inert={connectionOpen || helpOpen} onFocusCapture={event=>{if(event.target.matches('input:not([type=file]):not([type=checkbox]), textarea'))startMobileEditing()}} onBlurCapture={event=>{const next=event.relatedTarget;if(!(next instanceof HTMLElement) || (!next.matches('input:not([type=file]):not([type=checkbox]), textarea') && !next.closest('.composer, .entry-editor, .editing-toolbar, .finish-editing, .recipient-popover')))setMobileEditing(false)}}>
      <header className="topbar"><a className="mobile-brand" href="/" aria-label="Drop home"><ZingMark className="brand-mark" /><span className="brand-wordmark">Drop<span className="brand-signal" aria-hidden="true" /></span></a><h1 className="workspace-title">{nav.find(item=>item.id===view)?.label}</h1><button className={`connection-badge ${connected && live && !offline ? 'is-live' : ''}`} disabled={actionBusy} onClick={() => openConnection()}><span className="status-dot" />{nativeNeedsConnection ? 'Not connected' : offline ? 'Offline' : !connected ? configuredNative ? checked ? 'Connection issue' : 'Connecting…' : 'Connect household' : live ? 'Connected' : 'Reconnecting…'}<Settings2 size={15} /></button></header>
      <main id="main">
        {connected && deviceId && platform.renameDevice && device==='Desktop' && <DeviceNamePrompt key={`${api.baseURL}:${deviceId}`} identityKey={`${api.baseURL}:${deviceId}`} name={platform.defaultDeviceName||device} rename={renameDevice}/>}
        {offline && <div className="banner" role="status"><WifiOff size={17} /><span>You’re offline. Reconnect to resume transfers.</span></div>}
        {(nativeNeedsConnection || (checked && !connected && !connectionOpen && !configuredNative)) && <div className="banner"><Link2 size={17} /><span>{nativeNeedsConnection ? 'Choose a server in Settings.' : 'Connect to share items.'}</span><button className="text-button" disabled={actionBusy} onClick={() => openConnection()}>{nativeNeedsConnection ? 'Configure connection' : 'Connect'} <ArrowRight size={14} /></button></div>}
        {deviceError&&<div className="banner error-banner" role="alert"><span>{deviceError}</span><button className="text-button" onClick={()=>setIdentityTick(value=>value+1)}>Retry registration</button></div>}
        {targetError&&<div className="banner error-banner" role="alert"><span>{targetError}</span><button className="text-button" onClick={refresh}>Retry opening share</button><button className="icon-button" aria-label="Dismiss opening error" onClick={()=>{setTargetError('');setArrivalTarget('')}}><X size={15}/></button></div>}
        <nav ref={mobileNav} className="mobile-tabs" hidden={mobileEditing} aria-label="Mobile feed filters"><div className="mobile-tab-list">{nav.map(({id,label,icon:Icon})=><button key={id} aria-current={view===id?'page':undefined} disabled={actionBusy} onClick={()=>setView(id)}><Icon size={21} aria-hidden="true"/><span>{label}</span></button>)}</div></nav>
        <input className="sr-only" type="file" multiple ref={input} aria-label="Choose files to upload" onChange={event => { enqueue(Array.from(event.currentTarget.files || []), 'file',pickerRouting.current); event.currentTarget.value = '';pickerRouting.current=undefined }} /><input className="sr-only" type="file" multiple accept={textFileAccept} ref={textFileInput} aria-label="Choose plain text files to upload" onChange={event => { enqueue(Array.from(event.currentTarget.files || []), 'text',pickerRouting.current); event.currentTarget.value = '';pickerRouting.current=undefined }} />
        <div className="send-workspace"><section hidden={view==='trash'} className={`composer ${text.length ? 'has-draft' : ''}`} aria-labelledby="composer-title"><h2 id="composer-title" className="composer-heading">Send</h2><textarea ref={composer} aria-label="Text to share" placeholder="Paste a note, a link, anything…" value={text} onChange={event => { const value = event.target.value; setText(previous => preserveTextareaEdit(previous, value)) }} onPaste={event => {
          if (!event.clipboardData.types.includes('text/plain')) return
          event.preventDefault()
          const pasted = event.clipboardData.getData('text/plain'); const start = event.currentTarget.selectionStart; const end = event.currentTarget.selectionEnd
          setText(previous => insertPlainText(previous, start, end, pasted))
          requestAnimationFrame(() => { const caret = start + textareaText(pasted).length; composer.current?.setSelectionRange(caret, caret) })
        }} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void sendText() } }} disabled={!connected || !deviceId || sending} /><div className="composer-bottom"><div className="composer-tools"><button className="button action-button add-files" aria-label="Add files" title="Add files" onClick={() => choose('file')}><Paperclip size={18} /><span className="add-files-label">Add files</span></button><ItemMenu name="sharing">{close => <button role="menuitem" tabIndex={0} onClick={() => { choose('text'); close() }}><FileText size={17}/>Upload text file</button>}</ItemMenu></div><RecipientPicker devices={devices} currentId={deviceId} targets={targets} onChange={setTargets} onRefresh={refresh} disabled={!connected||!deviceId}/><button className="button primary send-button" aria-label={sending?'Sharing…':'Share text'} title="Share text" disabled={!connected || !deviceId || !text.length || sending} onClick={() => void sendText()}>{sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}<span>Send</span></button></div>{platform.kind==='browser'&&<p className="composer-context">Keep this tab open while sending.</p>}{text.length > 0 && <div className="composer-footnote"><span>{text.length.toLocaleString()} characters</span></div>}{composerError && <p role="alert" className="inline-error">{composerError}</p>}</section>
        {mobileEditing && view!=='trash' && <div className="editing-toolbar"><button className="finish-editing" onClick={finishMobileEditing}><Check size={16} aria-hidden="true"/>Done editing</button></div>}
        <TransferQueue store={platform.transfers} onError={setError} /></div>
        <section id="feed" tabIndex={-1} className="feed" aria-labelledby="feed-title"><div className="feed-toolbar" hidden={selecting}><div className="feed-title"><h2 id="feed-title">{view==='trash'?'Recently Deleted':search?'Search results':view==='you'?'Sent to this device':view==='pinned'?'Pinned shares':'Recent shares'}</h2></div><label className="kind-filter"><span className="sr-only">Content type</span><select disabled={actionBusy} value={contentKind} onChange={event=>setContentKind(event.target.value as ContentKind)}><option value="all">All types</option><option value="text">Text</option><option value="file">Files</option></select></label><button className="text-button select-toggle" aria-label="Select items" disabled={actionBusy||!eligible.length||trashSupport!=='supported'} onClick={()=>{setSelecting(true);setSelected([]);setActionErrors([])}}>Select</button><div className="feed-controls"><label className="search-field"><Search size={16} /><input id="feed-search" type="search" placeholder={view==='trash'?'Search Recently Deleted':'Search shares'} disabled={actionBusy} value={query} onChange={event => setQuery(event.target.value)} /><span className="search-shortcut">/</span><span className="sr-only">Search names and text previews</span></label>{view==='trash'&&mobileEditing?<button className="text-button finish-editing" onClick={finishMobileEditing}><Check size={16} aria-hidden="true"/>Done editing</button>:<button className="icon-button refresh-button" onClick={refresh} disabled={loading} aria-label="Refresh feed"><RefreshCw className={loading ? 'spin' : ''} size={17} /></button>}</div></div>
          {view==='trash'&&trashSupport==='supported'&&!folderUnsupported&&<div className="trash-folder-tools"><button className="button quiet text-danger" disabled={actionBusy||!connected} onClick={()=>void previewFolder()}>Delete all</button></div>}
          {folderProgress&&view==='trash'&&<p className="folder-progress" role="status">{folderProgress.running?'Deleting whole folder… ':''}{folderProgress.deleted} confirmed deleted · {folderProgress.failed} failed{folderProgress.failed>20?' (first 20 listed below)':''}{folderProgress.uncertain?' · One batch is unconfirmed. Refresh before choosing a new action.':''}</p>}
          {selecting&&<div className="selection-bar" role="region" aria-label="Selected items"><div><strong>{displayedSelected.length} selected</strong><span id="selection-scope">Of {eligible.length} displayed eligible items · limit 100</span></div><button className="text-button" disabled={actionBusy} aria-describedby="selection-scope" onClick={()=>setSelected(eligible.slice(0,100).map(item=>item.id))}>Select all</button><button className="text-button" disabled={actionBusy} onClick={()=>{setSelecting(false);setSelected([]);setActionErrors([])}}>Cancel selection</button><div className="selection-actions">{view==='trash'?<><button className="button quiet" disabled={actionBusy||!displayedSelected.length||trashSupport!=='supported'} onClick={()=>void perform('restore',displayedSelected)}><Undo2 size={16}/>Restore</button><button className="button text-danger" disabled={actionBusy||!displayedSelected.length||trashSupport!=='supported'} onClick={()=>setPurgeIds(displayedSelected)}><Trash2 size={16}/>Delete</button></>:<button className="button primary" disabled={actionBusy||!displayedSelected.length||trashSupport!=='supported'} onClick={()=>void perform('trash',displayedSelected)}><Trash2 size={16}/>Move to Recently Deleted</button>}</div></div>}
          {actionErrors.length>0&&<div className="banner error-banner action-errors" role="alert" ref={actionErrorArea}><div><ul>{actionErrors.map(entry=><li key={entry.id}><strong>{entry.name}:</strong> {entry.message}</li>)}</ul></div><button className="text-button" disabled={actionBusy} onClick={refresh}>Refresh view</button></div>}
          {trashSupport==='unsupported'&&<div className="banner error-banner" role="alert">Update the household server to delete items.</div>}{trashSupport==='unavailable'&&view!=='trash'&&<div className="banner error-banner" role="alert"><span>Couldn’t check deletion support.</span><button className="text-button" onClick={refresh}>Retry</button></div>}{folderUnsupported&&view==='trash'&&trashSupport!=='unsupported'&&<div className="banner error-banner" role="alert">Update the household server to delete all items.</div>}
          {error && <div className="banner error-banner" role="alert"><span>{error}</span><button className="text-button" onClick={refresh}>Retry</button>{configuredNative && <button className="text-button" disabled={actionBusy} onClick={() => openConnection()}>Settings</button>}<button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
          {loading && !items.length ? <div className="empty-state" role="status"><LoaderCircle className="spin" size={25} /><h3>Loading…</h3></div> : visible.length ? <div className="feed-list">{visible.map(item => <div key={item.id} id={`share-${item.id}`} tabIndex={-1} className={`share-entry ${highlight===item.id?'arrival-highlight':''} ${selecting?'is-selectable':''} ${selected.includes(item.id)?'is-selected':''}`}>
            {selecting&&<label className="item-selection"><input type="checkbox" aria-label={`Select ${item.name}`} checked={selected.includes(item.id)} disabled={actionBusy||item.status==='uploading'||(!selected.includes(item.id)&&selected.length>=100)} onChange={()=>toggleSelection(item.id)}/></label>}
            <div className="entry-body">{view==='trash'?<article className="feed-card trash-card" aria-label={`Deleted: ${item.name}`}><div><h3>{item.name}</h3><p>{formatBytes(item.size)} · {item.kind==='text'?'Text':'File'} · Moved {new Date(item.deletedAt!).toLocaleDateString()}</p>{item.kind==='text'&&<pre className="trash-preview">{item.preview}</pre>}</div><div className="trash-actions"><button className="button quiet" disabled={actionBusy||trashSupport!=='supported'} onClick={()=>void perform('restore',[item.id])}><Undo2 size={16}/>Restore</button><button className="button text-danger" tabIndex={0} disabled={actionBusy||trashSupport!=='supported'} onClick={()=>setPurgeIds([item.id])}><Trash2 size={17}/>Delete</button></div></article>:<FeedCard item={item} api={api} platform={platform} refresh={refresh} notify={notify} actionBusy={actionBusy} trashAvailable={trashSupport==='supported'} onTrash={()=>perform('trash',[item.id])}/>}</div></div>)}</div> : error||(view==='trash'&&trashSupport==='unsupported')?null:<div className="empty-state"><div className="empty-illustration"><Inbox size={35} strokeWidth={1.3} /></div><h3>{!connected ? nativeNeedsConnection ? 'No household connection yet' : configuredNative ? 'Your household is unavailable' : 'Connect your household' : view==='trash'?'Recently Deleted is empty':search ? 'No matching shares' : contentKind !== 'all' ? `No ${contentKind === 'text' ? 'text shares' : 'files'} in this view` : view === 'pinned' ? 'No pinned items' : view==='you'?'Nothing sent to you yet':'A fresh start'}</h3>{connected&&view!=='trash'&&<p>{search?'Try another search.':view==='pinned'?'Pin items to find them here.':view==='you'?'Shares sent to this device appear here.':'Paste text or add a file.'}</p>}{!connected ? platform.kind === 'browser' && <button className="button primary" disabled={actionBusy} onClick={() => openConnection()}><Link2 size={16} /> Connect household</button> : !search && contentKind === 'all' && view !== 'pinned' && view!=='trash' && <button className="button secondary" onClick={() => composer.current?.focus()}><Plus size={16} /> Share something</button>}</div>}
          {cursor && <button className="load-more button secondary" onClick={() => void loadMore()} disabled={loadingMore || loading}>{loadingMore ? <LoaderCircle className="spin" size={15} /> : <ArrowDown size={15} />} Load older items</button>}
        </section>
      </main>
    </div>
    {folderSummary&&<PurgeDialog wholeFolder names={folderSummary.names} count={folderSummary.count} busy={actionBusy} progress={folderProgress?.running?`${folderProgress.deleted} confirmed deleted · ${folderProgress.failed} failed. Continuing…`:undefined} onCancel={()=>setFolderSummary(null)} onConfirm={()=>void purgeFolder()}/>}
    {purgeIds&&<PurgeDialog names={purgeIds.map(id=>items.find(item=>item.id===id)?.name||id)} count={purgeIds.length} busy={actionBusy} onCancel={()=>setPurgeIds(null)} onConfirm={()=>void perform('purge',purgeIds)}/>}
    {dragging && <div className="drop-overlay"><div><UploadCloud size={52} strokeWidth={1.3} /><h2>Drop files to share</h2></div></div>}
    {toast && <div className="toast" role="status"><Check size={17} />{toast}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></button></div>}
    {connectionOpen && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && connected) setConnectionOpen(false) }}><section className="modal connection-modal" role="dialog" aria-modal="true" aria-labelledby="connection-title"><button className="icon-button modal-close" aria-label="Close connection settings" onClick={() => setConnectionOpen(false)}><X size={20} /></button><div className="connection-heading"><ZingMark className="modal-icon" /><h2 id="connection-title">{connected || platform.kind === 'native' ? 'Connection settings' : 'Connect to Drop'}</h2></div>{connected && storage && <div className="settings-storage"><span><HardDrive size={16}/>Storage</span><p><strong>{formatBytes(storage.usedBytes)}</strong> stored · <strong>{formatBytes(storage.freeBytes)}</strong> free</p><small>Up to {formatBytes(storage.maxFileBytes)} per file</small></div>}<form onSubmit={event => void connect(event)}><label>Household server<input autoFocus type="url" required value={draftOrigin} onChange={event => setDraftOrigin(event.target.value)} spellCheck={false} autoCapitalize="none" /></label>{platform.kind === 'browser' && <p className="field-note">Use your private Tailscale HTTPS address.</p>}<button type="button" className="text-button advanced-token" aria-expanded={advancedToken} onClick={()=>setAdvancedToken(!advancedToken)}>Advanced · Use app token</button>{advancedToken&&<label>App token (optional)<input type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" placeholder="For token servers or local development" /></label>}<label>This device’s name<input required maxLength={80} value={draftDevice} onChange={event => setDraftDevice(event.target.value)} autoComplete="off" /></label>{connectionError && <p className="inline-error" role="alert">{connectionError}</p>}<button className="button primary connect-button" disabled={connecting}>{connecting ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />}{connecting ? 'Connecting…' : 'Connect household'}</button></form>{connected&&<button className="button secondary save-device-name" disabled={draftDevice===device||connecting} onClick={()=>void saveDeviceName()}>Save device name</button>}
      <Appearance {...appearance}/>
      {connected&&<TrashSettings key={api.baseURL} api={api}/>}
      <button className="text-button settings-help" onClick={()=>{setConnectionOpen(false);setHelpOpen(true)}}><CircleHelp size={17}/>Help & tips</button>
      {connected&&deviceError&&<p className="inline-error" role="alert">{deviceError}</p>}
      {connected&&<DeviceSettings api={api} platform={platform} deviceId={deviceId} devices={devices} refresh={refresh} onArrivalChange={()=>setArrivalTick(value=>value+1)} arrivalError={arrivalError}/>}
      {(connected || configuredNative) && <button className="text-button disconnect-button" onClick={() => void logout()}><LogOut size={14} /> {platform.kind === 'native' ? 'Disconnect this app' : 'Disconnect this browser'}</button>}<p className="field-note">Disconnect does not revoke Tailscale access.</p></section></div>}
    {helpOpen && <div className="modal-backdrop"><section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><button className="icon-button modal-close" aria-label="Close help" onClick={() => setHelpOpen(false)} autoFocus><X size={20} /></button><span className="modal-icon"><CircleHelp size={27} /></span><h2 id="help-title">Using Drop</h2><div className="help-entry"><UploadCloud size={20} /><div><h3>{platform.kind === 'native' ? 'Transfers' : 'Keep this browser open while sending.'}</h3><p>{platform.kind === 'native' ? 'Closing the window keeps transfers running. Quit, sleep or OS restrictions can pause them. Reopen Drop to resume.' : 'Keep the tab open. After closing it or sleeping, reselect the original file to resume.'}</p></div></div><div className="help-entry"><Clipboard size={20} /><div><h3>Copy text</h3><p>Copy uses the full text. If it’s too large for the clipboard, download .txt instead.</p></div></div><div className="help-entry"><HardDrive size={20} /><div><h3>Recently Deleted</h3><p>Restore items before they expire or are permanently deleted. Change automatic deletion in Settings. Cancel active uploads in Transfers.</p></div></div><div className="help-entry"><ShieldCheck size={20} /><div><h3>Connection</h3><p>Keep Tailscale connected and the server online.{platform.deviceIdentity?.platform==='android'&&' Reopen Drop after reboot or force-stop to resume arrival checks; Android may delay background checks.'}{platform.kind === 'browser' && ' Install this page from your browser’s app menu where available.'}</p></div></div><button className="button primary connect-button" onClick={() => setHelpOpen(false)}>Got it</button></section></div>}
  </div>
}
