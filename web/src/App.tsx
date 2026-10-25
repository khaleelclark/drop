import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, ArrowRight, Check, CircleHelp, Clipboard, FileText, HardDrive, Inbox, Link2, LoaderCircle, LogOut, Paperclip, Pin, Plus, RefreshCw, Search, Send, Settings2, ShieldCheck, Smartphone, UploadCloud, WifiOff, X, Trash2, Undo2 } from 'lucide-react'
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
import { chronological, compareShares } from './feed-order'
import { FeedCache, updateSnapshot, type FeedSnapshot } from './feed-cache'
import { ItemMenu } from './ItemMenu'
import { ZingMark } from './ZingMark'
import { insertPlainText, preserveTextareaEdit, textareaText } from './text-editing'
import { TransferQueue } from './TransferQueue'
import { droppedEntries, pickFolder, type FolderEntry } from './folders'
import { textFileAccept } from './text-files'
import { errorMessage, formatBytes, type Device, type SendRouting, type Item, type ItemAction, type ItemActionResult, type StorageInfo, type TrashSummary } from './types'
function stored(key: string, fallback: string) { try { return localStorage.getItem(key) || fallback } catch { return fallback } }
function save(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* Settings are optional. */ } }
type View = 'all' | 'you' | 'pinned' | 'trash'
type ContentKind = 'all' | Item['kind']
export function App() {
  const [refreshTick, setRefreshTick] = useState(0)
  const accessBlocked=useRef(false)
  const refresh = useCallback(() => {accessBlocked.current=false;setRefreshTick(value => value + 1)}, [])
  const platform = useMemo(() => window.householdPlatform || browserPlatform(window.location.origin, refresh), [refresh])
  const appearance=useAppearance(platform)
  const [origin, setOrigin] = useState(platform.baseURL || (platform.kind === 'native' ? 'http://127.0.0.1:8787' : window.location.origin))
  const [draftOrigin, setDraftOrigin] = useState(platform.kind === 'native' ? platform.baseURL || '' : origin)
  const accessEpoch=useRef(0),rejectAccessRef=useRef<(failure:unknown)=>boolean>(()=>false)
  const api = useMemo(() => {
    const client:ApiClient=new ApiClient(origin,async(...args)=>{
      const epoch=accessEpoch.current
      const response=await (platform.request||fetch)(...args)
      if([401,403].includes(response.status)&&currentApi.current===client&&epoch===accessEpoch.current)rejectAccessRef.current(new ApiError('Access was not accepted.',response.status))
      return response
    })
    return client
  }, [origin, platform])
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
  const [mobileEditing, setMobileEditing] = useState(false)
  const [nativeKeyboard,setNativeKeyboard]=useState(false)
  const [mobile,setMobile]=useState(()=>window.matchMedia?.('(max-width: 800px)').matches??false)
  const workspace=useRef<HTMLDivElement>(null),feedScroll=useRef<HTMLDivElement>(null)
  const feedPosition=useRef<{scope:string;nearEnd:boolean;anchor?:{id:string;top:number};newest?:Item}>({scope:'',nearEnd:true})
  const feedCache=useRef(new FeedCache())
  const [feed,setFeed]=useState<FeedSnapshot>()
  const feedScope=JSON.stringify([api.baseURL,search,view==='trash'?'trash':view==='you'?'you':'all',view==='you'?deviceId:''])
  const scopeRef=useRef(feedScope);scopeRef.current=feedScope
  const snapshot=feed?.scope===feedScope?feed:feedCache.current.get(feedScope)
  const items=snapshot?.items||[],cursor=snapshot?.nextCursor??null
  const commitFeed=(next:FeedSnapshot)=>{feedCache.current.put(next);setFeed(next)}
  const clearFeed=()=>{
    sequence.current++;accessEpoch.current++;feedCache.current.clear();setFeed(undefined);openedItem.current=null;pendingArrivalFocus.current='';setHighlight('');setArrivalTarget('')
    feedPosition.current={scope:'',nearEnd:true};setSelected([]);setSelecting(false);setActionErrors([]);setPurgeIds(null);setFolderSummary(null)
  }
  const removeCached=(ids:Set<string>)=>{
    sequence.current++;feedCache.current.remove(ids)
    setFeed(previous=>previous?{...previous,items:previous.items.filter(item=>!ids.has(item.id)),head:{...previous.head,items:previous.head.items.filter(item=>!ids.has(item.id))}}:previous)
    if(openedItem.current&&ids.has(openedItem.current.id)){openedItem.current=null;setHighlight('')}
  }
  const updateCached=(item:Item)=>{
    sequence.current++;feedCache.current.update(item)
    setFeed(previous=>previous?updateSnapshot(previous,item):previous)
    if(openedItem.current?.id===item.id)openedItem.current=item
  }
  const [newShares,setNewShares]=useState(false)
  const [unmeasuredKeyboard,setUnmeasuredKeyboard]=useState(false)
  const inputMode=useRef<'pointer'|'keyboard'>('pointer')
  const [pending,setPending]=useState(''); const [settled,setSettled]=useState('')
  const awaitingDevice=view==='you'&&!deviceId&&connected&&!deviceError
  const loading=awaitingDevice||pending===feedScope||(!snapshot&&settled!==feedScope&&!needsConnection)
  const [loadingMore, setLoadingMore] = useState(false); const [error, setError] = useState('')
  const [live, setLive] = useState(false); const [offline, setOffline] = useState(!navigator.onLine)
  const [toast, setToast] = useState(''); const [text, setText] = useState(''); const [sending, setSending] = useState(false)
  const [composerError, setComposerError] = useState(''); const [dragging, setDragging] = useState(false); const [helpOpen, setHelpOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null); const textFileInput = useRef<HTMLInputElement>(null); const composer = useRef<HTMLTextAreaElement>(null)
  const sequence = useRef(0)
  const rejectAccess=(failure:unknown)=>{
    if(!(failure instanceof ApiError)||![401,403].includes(failure.status))return false
    const message='Access was not accepted. Check Tailscale and this server’s access settings, or use an app token under Advanced.'
    accessBlocked.current=true
    clearFeed();setDeviceId('');setDevices([]);setTargets([])
    setConnected(false);setStorage(undefined);setError(message);setConnectionError(message)
    setPending('');setSettled(feedScope);setLoadingMore(false)
    if(!configuredNative)openConnection()
    return true
  }
  rejectAccessRef.current=rejectAccess
  const notify = useCallback((message: string) => setToast(message), [])
  const startMobileEditing = () => { if (window.matchMedia('(max-width: 800px)').matches) setMobileEditing(true) }
  const openComposer=()=>composer.current?.focus()
  const finishMobileEditing = useCallback(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest('.workspace') && ['INPUT','TEXTAREA'].includes(active.tagName)) active.blur()
    setMobileEditing(false)
  }, [])
  useEffect(()=>{
    const media=window.matchMedia?.('(max-width: 800px)');if(!media)return
    const change=()=>setMobile(media.matches)
    media.addEventListener('change',change);return()=>media.removeEventListener('change',change)
  },[])
  useLayoutEffect(()=>{
    const node=workspace.current,viewport=window.visualViewport
    if(!node)return
    const keyboard=(navigator as Navigator & {virtualKeyboard?:EventTarget & {boundingRect:DOMRect}}).virtualKeyboard
    const position=()=>{
      const top=viewport?.offsetTop??0,height=viewport?.height??innerHeight
      const keyboardTop=keyboard?.boundingRect.height?keyboard.boundingRect.top:Infinity
      const available=Math.min(height,keyboardTop-top)
      node.style.setProperty('--app-height',`${Math.max(160,available)}px`)
      node.style.setProperty('--app-top',`${top}px`)
      // The legacy native signal has no bounds; keep controls below the header if an IME overlays unchanged viewports.
      setUnmeasuredKeyboard(nativeKeyboard&&height>=innerHeight-80&&keyboardTop===Infinity)
    }
    position();window.addEventListener('resize',position);viewport?.addEventListener('resize',position);viewport?.addEventListener('scroll',position);keyboard?.addEventListener('geometrychange',position)
    return()=>{window.removeEventListener('resize',position);viewport?.removeEventListener('resize',position);viewport?.removeEventListener('scroll',position);keyboard?.removeEventListener('geometrychange',position)}
  },[nativeKeyboard])
  useLayoutEffect(()=>{
    const field=composer.current;if(!field)return
    const size=()=>{field.style.height='0px';field.style.height=`${Math.max(48,Math.min(field.scrollHeight,parseFloat(getComputedStyle(field).maxHeight)))}px`}
    size();const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(size);observer?.observe(field.parentElement!);window.addEventListener('resize',size)
    return()=>{observer?.disconnect();window.removeEventListener('resize',size)}
  },[text,mobile])
  useEffect(()=>{
    if(!highlight)return
    const clear=()=>{pendingArrivalFocus.current='';setHighlight('')}
    const timer=setTimeout(clear,5000)
    window.addEventListener('pointerdown',clear,{once:true});window.addEventListener('keydown',clear,{once:true})
    return()=>{clearTimeout(timer);window.removeEventListener('pointerdown',clear);window.removeEventListener('keydown',clear)}
  },[highlight])
  useEffect(() => {
    const leave = () => setMobileEditing(false)
    const visibility = () => { if (document.visibilityState === 'hidden') leave() }
    const keyboard = (event: Event) => {
      if (platform.kind !== 'native' || !document.documentElement.hasAttribute('data-native-android') || !(event instanceof CustomEvent) || typeof event.detail?.visible !== 'boolean') return
      setNativeKeyboard(event.detail.visible)
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
  useEffect(()=>{accessBlocked.current=false;clearFeed();setDeviceId('');setDevices([]);setTargets([])},[api])
  useEffect(() => {
    const number = ++sequence.current; let cancelled = false
    if (needsConnection||accessBlocked.current) { setPending(''); setSettled(feedScope); return }
    if(view==='you'&&!deviceId){setPending('');setSettled(feedScope);return}
    setPending(feedScope); setError('');setLoadingMore(false)
    const previous=feed?.scope===feedScope?feed:feedCache.current.get(feedScope)
    if(previous)setFeed(previous)
    void (view==='trash'?api.trashPage(search):api.list(search,undefined,view==='you'?deviceId:undefined)).then(async page => {
      if (cancelled || number !== sequence.current || scopeRef.current!==feedScope) return
      const head={items:[...page.items],nextCursor:page.nextCursor}
      const retain=view!=='trash'&&previous?.older
      if(retain&&previous.boundary){
        const boundary=previous.boundary,seen=new Set(page.items.map(item=>item.id)),cursors=new Set<string>()
        let oldest=chronological(page.items)[0]
        // Re-read through the loaded boundary so other devices' edits/deletes cannot leave stale older rows.
        while(page.nextCursor&&oldest&&compareShares(oldest,boundary)>0){
          if(cursors.has(page.nextCursor))throw new Error('The server repeated a feed cursor. Refresh to try again.')
          cursors.add(page.nextCursor)
          const older=await api.list(search,page.nextCursor,view==='you'?deviceId:undefined)
          if(cancelled||number!==sequence.current||scopeRef.current!==feedScope)return
          page.items.push(...older.items.filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true}))
          page.nextCursor=older.nextCursor;oldest=chronological(older.items)[0]||oldest
        }
      }
      const boundary=chronological(page.items)[0]
      const selected=openedItem.current
      if(view==='you'&&!search&&selected&&!page.items.some(item=>item.id===selected.id)){
        try{const fresh=await api.item(selected.id);if(fresh.item.status==='ready')page.items=[fresh.item,...page.items]}
        catch(error){if(cancelled||number!==sequence.current||scopeRef.current!==feedScope)return;if(error instanceof ApiError&&error.status===404){openedItem.current=null;setHighlight('')}else throw error}
      }
      if (cancelled || number !== sequence.current || scopeRef.current!==feedScope) return
      commitFeed({...page,scope:feedScope,kind:view==='trash'?'trash':view==='you'?'you':'all',query:search,head,older:Boolean(retain),boundary})
      setConnected(true); setChecked(true); setConnectionError('')
      if(view==='trash')setTrashSupport('supported')
    }).catch(error => {
      if (cancelled || number !== sequence.current || scopeRef.current!==feedScope) return
      setChecked(true)
      if (rejectAccess(error)) return
      else if(error instanceof ApiError&&error.code==='update_required')setTrashSupport('unsupported')
      else setError(`Couldn’t load shares. ${errorMessage(error)}`)
    }).finally(() => { if (!cancelled && number === sequence.current && scopeRef.current===feedScope) {setPending('');setSettled(feedScope)} })
    return () => { cancelled = true }
  }, [api, search, refreshTick, feedScope, configuredNative, needsConnection])
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
      refresh()
      openedItem.current=item;pendingArrivalFocus.current=item.id;setConnectionOpen(false);setHelpOpen(false);setMobileEditing(false);setView('you');setContentKind('all');setQuery('');setSearch('');setHighlight(item.id)
      // The validated alert target is explicit navigation, not inferred For you membership.
      setArrivalTarget('')
      const url=new URL(window.location.href);url.searchParams.delete('item');window.history.replaceState(null,'',url)
    }).catch(error=>{if(!cancelled)setTargetError(error instanceof ApiError&&error.status===404?'This share was deleted or is no longer available.':errorMessage(error))})
    return()=>{cancelled=true}
  },[api,connected,deviceId,arrivalTarget,refreshTick,refresh])
  useEffect(()=>{
    if(!highlight||loading||pendingArrivalFocus.current!==highlight)return
    const frame=requestAnimationFrame(()=>{
      const node=document.getElementById(`share-${highlight}`)
      if(node){pendingArrivalFocus.current='';node.scrollIntoView({block:'center'});node.focus({preventScroll:true})}
    })
    return()=>cancelAnimationFrame(frame)
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
      if(target.closest('dialog[open]'))return
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
    return () => { clearTimeout(timer); document.removeEventListener('keydown', trap); document.body.classList.remove('modal-open'); if(inputMode.current==='keyboard'&&previous?.isConnected)previous.focus({preventScroll:true}) }
  }, [connectionOpen, helpOpen])
  const connect = async (event: FormEvent) => {
    event.preventDefault(); setConnecting(true); setConnectionError('')
    try {
      const target = new ApiClient(draftOrigin, platform.request)
      if (platform.kind === 'browser' && target.baseURL !== window.location.origin) throw new Error('Open Drop at your server’s address to connect. Browser sessions use the server you opened.')
      if (platform.configureConnection) { await platform.configureConnection(target.baseURL, token, draftDevice); setOrigin(target.baseURL);setConnected(false); setStorage(undefined) }
      else if(token) await target.session(token)
      clearFeed()
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
    try { if (platform.disconnect) await platform.disconnect(); else { await Promise.all(platform.transfers.getSnapshot().filter(row => ['queued', 'checking', 'uploading'].includes(row.state)).map(row => platform.transfers.pause(row.id))); await api.logout() } clearFeed();setDeviceId('');setDevices([]);setTargets([]);openedItem.current=null;setHighlight('');setView('all'); setError(''); setNeedsConnection(true); setConnected(false); setStorage(undefined); setMobileEditing(false); setConnectionOpen(platform.kind === 'browser'); notify('Disconnected.') }
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
  const enqueueFolder=(folder:FolderEntry,selected:{routing:SendRouting;sourceDevice:string;origin:string})=>{
    if(selected.origin!==currentApi.current.baseURL)throw new Error('The server changed. Add the folder again for this server.')
    if(!storage)throw new Error('Wait for the server’s storage limits before adding a folder.')
    if(!platform.transfers.enqueueFolder)throw new Error('Folder sharing is unavailable in this app. Send a ZIP instead.')
    platform.transfers.enqueueFolder(folder,selected.sourceDevice,storage.maxFileBytes,selected.routing)
  }
  const browserDrop=(data:DataTransfer)=>{
    try{
      if(!connected){openConnection();return}
      const selected={routing:sendRouting(deviceId,targets,devices),sourceDevice:device,origin:api.baseURL}
      void droppedEntries(data).then(entries=>{
        if(selected.origin!==currentApi.current.baseURL)throw new Error('The server changed. Drop the sources again for this server.')
        for(const entry of entries)if(entry instanceof File)enqueue([entry],'file',selected);else enqueueFolder(entry,selected)
      }).catch(error=>setError(errorMessage(error)))
    }catch(error){setError(errorMessage(error))}
  }
  const choose = (kind: 'file' | 'text' | 'folder') => {
    if (!connected) { openConnection(); return }
    try{
      const routing=sendRouting(deviceId,targets,devices)
      pickerRouting.current={routing,sourceDevice:device,origin:api.baseURL}
      if (platform.chooseFiles) { void platform.chooseFiles(kind,device,routing.targetDeviceIds).catch(error => setError(errorMessage(error))); return }
      if(kind==='folder'){
        const selected=pickerRouting.current
        void pickFolder().then(folder=>enqueueFolder(folder,selected)).catch(error=>{if(!(error instanceof DOMException&&error.name==='AbortError'))setError(errorMessage(error))});return
      }
    }catch(error){setError(errorMessage(error));return}
    if (kind === 'text') textFileInput.current?.click(); else input.current?.click()
  }
  const loadMore = async () => {
    if (!cursor || loadingMore || !snapshot) return
    const current = sequence.current; setLoadingMore(true)
    try {
      const page = await (view==='trash'?api.trashPage(search,cursor):api.list(search,cursor,view==='you'?deviceId:undefined))
      if(current===sequence.current&&scopeRef.current===feedScope){
        const ids=new Set(snapshot.items.map(item=>item.id)),oldest=chronological(page.items)[0]
        commitFeed({...snapshot,items:[...snapshot.items,...page.items.filter(item=>!ids.has(item.id))],nextCursor:page.nextCursor,older:true,boundary:oldest||snapshot.boundary})
      }
    } catch(error){if(current===sequence.current&&scopeRef.current===feedScope&&!rejectAccess(error))setError(errorMessage(error))}
    finally{if(current===sequence.current&&scopeRef.current===feedScope)setLoadingMore(false)}
  }
  const filtered = items.filter(item => (view !== 'pinned' || item.pinned) && (contentKind === 'all' || item.kind === contentKind))
  const visible = view==='trash'?filtered:chronological(filtered)
  const positionScope=`${api.baseURL}:${view}:${search}:${contentKind}`
  const rememberPosition=()=>{
    const node=feedScroll.current;if(!node)return
    const nearEnd=node.scrollHeight-node.scrollTop-node.clientHeight<=64
    const top=node.getBoundingClientRect().top
    const anchor=Array.from(node.querySelectorAll<HTMLElement>('.share-entry')).find(row=>row.getBoundingClientRect().bottom>top)
    feedPosition.current={scope:positionScope,nearEnd,newest:visible.at(-1),anchor:anchor?{id:anchor.id,top:anchor.getBoundingClientRect().top-top}:undefined}
    if(nearEnd)setNewShares(false)
  }
  const jumpToNewest=()=>{const node=feedScroll.current;if(node){node.scrollTop=node.scrollHeight;rememberPosition()}setNewShares(false)}
  useLayoutEffect(()=>{
    const node=feedScroll.current;if(!node)return
    const previous=feedPosition.current
    if(view==='trash'){if(previous.scope!==positionScope)node.scrollTop=0}
    else if(pendingArrivalFocus.current){ /* The validated notification target owns this scroll. */ }
    else if(previous.scope!==positionScope||previous.nearEnd) {node.scrollTop=node.scrollHeight;setNewShares(false)}
    else {
      const anchor=previous.anchor&&document.getElementById(previous.anchor.id)
      if(anchor)node.scrollTop+=anchor.getBoundingClientRect().top-node.getBoundingClientRect().top-previous.anchor!.top
      const newest=visible.at(-1)
      if(newest&&previous.newest&&compareShares(newest,previous.newest)>0)setNewShares(true)
    }
    rememberPosition()
  },[items,view,search,contentKind,loading])
  useEffect(()=>{
    const node=feedScroll.current;if(!node||typeof ResizeObserver==='undefined')return
    const observer=new ResizeObserver(()=>{
      if(view!=='trash'&&feedPosition.current.nearEnd&&!pendingArrivalFocus.current)node.scrollTop=node.scrollHeight
      else if(view!=='trash'&&!pendingArrivalFocus.current){
        const saved=feedPosition.current.anchor,anchor=saved&&document.getElementById(saved.id)
        if(anchor)node.scrollTop+=anchor.getBoundingClientRect().top-node.getBoundingClientRect().top-saved!.top
      }
      rememberPosition()
    })
    observer.observe(node);const list=node.querySelector('.feed-list');if(list)observer.observe(list,{box:'border-box'})
    return()=>observer.disconnect()
  },[positionScope,items])
  const dropBlocked=()=>Boolean(document.querySelector('dialog[open], [role="dialog"], [role="menu"]'))
  const nativeDrop=(paths:string[])=>{
    try{
      if(!connected)throw new Error('Connect your household before dropping files.')
      const routing=sendRouting(deviceId,targets,devices)
      void platform.enqueuePaths!(paths,routing.targetDeviceIds).catch(error=>setError(errorMessage(error)))
    }catch(error){setError(errorMessage(error))}
  }
  const fileIntake=useRef({browserDrop,dropBlocked,nativeDrop});fileIntake.current={browserDrop,dropBlocked,nativeDrop}
  useEffect(()=>{
    let depth=0
    const clear=()=>{depth=0;setDragging(false)}
    const hasFiles=(event:globalThis.DragEvent)=>Array.from(event.dataTransfer?.types||[]).includes('Files')
    const allowed=(event:globalThis.DragEvent)=>hasFiles(event)&&!fileIntake.current.dropBlocked()
    const enter=(event:globalThis.DragEvent)=>{if(!allowed(event))return;event.preventDefault();depth++;setDragging(true)}
    const over=(event:globalThis.DragEvent)=>{if(!hasFiles(event))return;event.preventDefault();if(!allowed(event)){clear();return}if(event.dataTransfer)event.dataTransfer.dropEffect='copy';setDragging(true)}
    const leave=(event:globalThis.DragEvent)=>{if(!hasFiles(event))return;depth=Math.max(0,depth-1);if(!depth||!event.relatedTarget)clear()}
    const drop=(event:globalThis.DragEvent)=>{
      if(!hasFiles(event))return
      event.preventDefault();clear()
      if(!fileIntake.current.dropBlocked()&&!platform.onFileDrop&&event.dataTransfer)fileIntake.current.browserDrop(event.dataTransfer)
    }
    window.addEventListener('dragenter',enter);window.addEventListener('dragover',over);window.addEventListener('dragleave',leave);window.addEventListener('drop',drop);window.addEventListener('dragend',clear);window.addEventListener('blur',clear)
    let stopped=false,unlisten:(()=>void|Promise<void>)|undefined
    const release=(stop:()=>void|Promise<void>)=>{void Promise.resolve().then(stop).catch(()=>{})}
    if(platform.onFileDrop)void platform.onFileDrop(event=>{
      if(stopped)return
      if(event.type==='leave'){clear();return}
      if(fileIntake.current.dropBlocked()){clear();return}
      if(event.type!=='drop'){setDragging(true);return}
      clear()
      fileIntake.current.nativeDrop(event.paths)
    }).then(stop=>{if(stopped)release(stop);else unlisten=stop}).catch(error=>{if(!stopped){clear();setError(errorMessage(error))}})
    return()=>{stopped=true;if(unlisten)release(unlisten);window.removeEventListener('dragenter',enter);window.removeEventListener('dragover',over);window.removeEventListener('dragleave',leave);window.removeEventListener('drop',drop);window.removeEventListener('dragend',clear);window.removeEventListener('blur',clear)}
  },[platform])
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
      if(currentApi.current!==api)return
      removeCached(success)
      if(scope!==actionScope.current){refresh();return}
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
          removeCached(success)
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
  return <div className={`app-shell ${connected ? 'is-connected' : ''}`} onPointerDownCapture={()=>{inputMode.current='pointer'}} onKeyDownCapture={()=>{inputMode.current='keyboard'}}>
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
    <div ref={workspace} className={`workspace ${mobileEditing?'is-editing':''} ${unmeasuredKeyboard?'ime-unmeasured':''}`} inert={connectionOpen || helpOpen} onFocusCapture={event=>{if(event.target.matches('input:not([type=file]):not([type=checkbox]), textarea'))startMobileEditing()}} onBlurCapture={event=>{const next=event.relatedTarget;if(!(next instanceof HTMLElement) || (!next.matches('input:not([type=file]):not([type=checkbox]), textarea') && !next.closest('.composer, .entry-editor, .editing-toolbar, .finish-editing, .recipient-popover')))setMobileEditing(false)}}>
      <header className="topbar"><a className="mobile-brand" href="/" aria-label="Drop home"><ZingMark className="brand-mark" /><span className="brand-wordmark">Drop<span className="brand-signal" aria-hidden="true" /></span></a><h1 className="workspace-title">{nav.find(item=>item.id===view)?.label}</h1><button className={`connection-badge ${connected && live && !offline ? 'is-live' : ''}`} disabled={actionBusy} onClick={() => openConnection()}><span className="status-dot" />{nativeNeedsConnection ? 'Not connected' : offline ? 'Offline' : !connected ? configuredNative ? checked ? 'Connection issue' : 'Connecting…' : 'Connect household' : live ? 'Connected' : 'Reconnecting…'}<Settings2 size={15} /></button></header>
      <main id="main">
        {connected && deviceId && platform.renameDevice && device==='Desktop' && <DeviceNamePrompt key={`${api.baseURL}:${deviceId}`} identityKey={`${api.baseURL}:${deviceId}`} name={platform.defaultDeviceName||device} rename={renameDevice}/>}
        {offline && <div className="banner" role="status"><WifiOff size={17} /><span>You’re offline. Reconnect to resume transfers.</span></div>}
        {(nativeNeedsConnection || (checked && !connected && !connectionOpen && !configuredNative)) && <div className="banner"><Link2 size={17} /><span>{nativeNeedsConnection ? 'Choose a server in Settings.' : 'Connect to share items.'}</span><button className="text-button" disabled={actionBusy} onClick={() => openConnection()}>{nativeNeedsConnection ? 'Configure connection' : 'Connect'} <ArrowRight size={14} /></button></div>}
        {deviceError&&<div className="banner error-banner" role="alert"><span>{deviceError}</span><button className="text-button" onClick={()=>setIdentityTick(value=>value+1)}>Retry registration</button></div>}
        {targetError&&<div className="banner error-banner" role="alert"><span>{targetError}</span><button className="text-button" onClick={refresh}>Retry opening share</button><button className="icon-button" aria-label="Dismiss opening error" onClick={()=>{setTargetError('');setArrivalTarget('')}}><X size={15}/></button></div>}
        <nav className="mobile-tabs" hidden={mobileEditing} aria-label="Mobile feed filters"><div className="mobile-tab-list">{nav.map(({id,label,icon:Icon})=><button key={id} aria-current={view===id?'page':undefined} disabled={actionBusy} onClick={()=>setView(id)}><Icon size={21} aria-hidden="true"/><span>{label}</span></button>)}</div></nav>
        <section id="feed" tabIndex={-1} className="feed" aria-labelledby="feed-title"><div className="feed-toolbar" hidden={selecting}><div className="feed-title"><h2 id="feed-title">{view==='trash'?'Recently Deleted':search?'Search results':view==='you'?'Sent to this device':view==='pinned'?'Pinned shares':'Recent shares'}</h2></div><label className="kind-filter"><span className="sr-only">Content type</span><select disabled={actionBusy} value={contentKind} onChange={event=>setContentKind(event.target.value as ContentKind)}><option value="all">All types</option><option value="text">Text</option><option value="file">Files</option></select></label><button className="text-button select-toggle" aria-label="Select items" disabled={actionBusy||!eligible.length||trashSupport!=='supported'} onClick={()=>{setSelecting(true);setSelected([]);setActionErrors([])}}>Select</button><div className="feed-controls"><label className="search-field"><Search size={16} /><input id="feed-search" type="search" placeholder={view==='trash'?'Search Recently Deleted':'Search shares'} disabled={actionBusy} value={query} onChange={event => setQuery(event.target.value)} /><span className="search-shortcut">/</span><span className="sr-only">Search names and text previews</span></label>{mobileEditing?<button className="text-button finish-editing" onClick={finishMobileEditing}><Check size={16} aria-hidden="true"/>Done editing</button>:<button className="icon-button refresh-button" onClick={refresh} disabled={loading} aria-label="Refresh feed"><RefreshCw className={loading ? 'spin' : ''} size={17} /></button>}</div></div>
          {view==='trash'&&trashSupport==='supported'&&!folderUnsupported&&<div className="trash-folder-tools"><button className="button quiet text-danger" disabled={actionBusy||!connected} onClick={()=>void previewFolder()}>Delete all</button></div>}
          {folderProgress&&view==='trash'&&<p className="folder-progress" role="status">{folderProgress.running?'Deleting whole folder… ':''}{folderProgress.deleted} confirmed deleted · {folderProgress.failed} failed{folderProgress.failed>20?' (first 20 listed below)':''}{folderProgress.uncertain?' · One batch is unconfirmed. Refresh before choosing a new action.':''}</p>}
          {selecting&&<div className="selection-bar" role="region" aria-label="Selected items"><div><strong>{displayedSelected.length} selected</strong><span id="selection-scope">Of {eligible.length} displayed eligible items · limit 100</span></div><button className="text-button" disabled={actionBusy} aria-describedby="selection-scope" onClick={()=>setSelected(eligible.slice(0,100).map(item=>item.id))}>Select all</button><button className="text-button" disabled={actionBusy} onClick={()=>{setSelecting(false);setSelected([]);setActionErrors([])}}>Cancel selection</button><div className="selection-actions">{view==='trash'?<><button className="button quiet" disabled={actionBusy||!displayedSelected.length||trashSupport!=='supported'} onClick={()=>void perform('restore',displayedSelected)}><Undo2 size={16}/>Restore</button><button className="button text-danger" disabled={actionBusy||!displayedSelected.length||trashSupport!=='supported'} onClick={()=>setPurgeIds(displayedSelected)}><Trash2 size={16}/>Delete</button></>:<button className="button primary" disabled={actionBusy||!displayedSelected.length||trashSupport!=='supported'} onClick={()=>void perform('trash',displayedSelected)}><Trash2 size={16}/>Delete</button>}</div></div>}
          {actionErrors.length>0&&<div className="banner error-banner action-errors" role="alert" ref={actionErrorArea}><div><ul>{actionErrors.map(entry=><li key={entry.id}><strong>{entry.name}:</strong> {entry.message}</li>)}</ul></div><button className="text-button" disabled={actionBusy} onClick={refresh}>Refresh view</button></div>}
          {trashSupport==='unsupported'&&<div className="banner error-banner" role="alert">Update the household server to delete items.</div>}{trashSupport==='unavailable'&&view!=='trash'&&<div className="banner error-banner" role="alert"><span>Couldn’t check deletion support.</span><button className="text-button" onClick={refresh}>Retry</button></div>}{folderUnsupported&&view==='trash'&&trashSupport!=='unsupported'&&<div className="banner error-banner" role="alert">Update the household server to delete all items.</div>}
          {error && <div className="banner error-banner" role="alert"><span>{error}</span><button className="text-button" onClick={refresh}>Retry</button>{configuredNative && <button className="text-button" disabled={actionBusy} onClick={() => openConnection()}>Settings</button>}<button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
          <div className="feed-scroll" ref={feedScroll} onScroll={rememberPosition} tabIndex={0} role="region" aria-label="Shares">
          {cursor && view!=='trash' && <button className="load-more button secondary" onClick={() => void loadMore()} disabled={loadingMore || loading}>{loadingMore ? <LoaderCircle className="spin" size={15} /> : <ArrowUp size={15} />} Load older items</button>}
          {loading && !snapshot ? <div className="empty-state" role="status"><LoaderCircle className="spin" size={25} /><h3>Loading…</h3></div> : visible.length ? <div className="feed-list">{visible.map(item => <div key={item.id} id={`share-${item.id}`} tabIndex={-1} className={`share-entry ${highlight===item.id?'arrival-highlight':''} ${selecting?'is-selectable':''} ${selected.includes(item.id)?'is-selected':''}`}>
            {selecting&&<label className="item-selection"><input type="checkbox" aria-label={`Select ${item.name}`} checked={selected.includes(item.id)} disabled={actionBusy||item.status==='uploading'||(!selected.includes(item.id)&&selected.length>=100)} onChange={()=>toggleSelection(item.id)}/></label>}
            <div className="entry-body">{view==='trash'?<article className="feed-card trash-card" aria-label={`Deleted: ${item.name}`}><div><h3>{item.name}</h3><p>{formatBytes(item.size)} · {item.kind==='text'?'Text':'File'} · Moved {new Date(item.deletedAt!).toLocaleDateString()}</p>{item.kind==='text'&&<pre className="trash-preview">{item.preview}</pre>}</div><div className="trash-actions"><button className="button quiet" disabled={actionBusy||trashSupport!=='supported'} onClick={()=>void perform('restore',[item.id])}><Undo2 size={16}/>Restore</button><button className="button text-danger" tabIndex={0} disabled={actionBusy||trashSupport!=='supported'} onClick={()=>setPurgeIds([item.id])}><Trash2 size={17}/>Delete</button></div></article>:<FeedCard item={item} api={api} platform={platform} refresh={refresh} notify={notify} actionBusy={actionBusy} trashAvailable={trashSupport==='supported'} onUpdated={item=>{if(currentApi.current===api)updateCached(item)}} onTrash={()=>perform('trash',[item.id])}/>}</div></div>)}</div> : error||(view==='you'&&deviceError)||(view==='trash'&&trashSupport==='unsupported')?null:<div className="empty-state"><div className="empty-illustration"><Inbox size={35} strokeWidth={1.3} /></div><h3>{!connected ? nativeNeedsConnection ? 'No household connection yet' : configuredNative ? 'Your household is unavailable' : 'Connect your household' : view==='trash'?'Recently Deleted is empty':search ? 'No matching shares' : contentKind !== 'all' ? `No ${contentKind === 'text' ? 'text shares' : 'files'} in this view` : view === 'pinned' ? 'No pinned items' : view==='you'?'Nothing sent to you yet':'A fresh start'}</h3>{connected&&view!=='trash'&&<p>{search?'Try another search.':view==='pinned'?'Pin items to find them here.':view==='you'?'Shares sent to this device appear here.':'Paste text or add a file.'}</p>}{!connected ? platform.kind === 'browser' && <button className="button primary" disabled={actionBusy} onClick={() => openConnection()}><Link2 size={16} /> Connect household</button> : !search && contentKind === 'all' && view !== 'pinned' && view!=='trash' && <button className="button secondary" onClick={openComposer}><Plus size={16} /> Share something</button>}</div>}
          {cursor && view==='trash' && <button className="load-more button secondary" onClick={() => void loadMore()} disabled={loadingMore || loading}>{loadingMore ? <LoaderCircle className="spin" size={15} /> : <ArrowDown size={15} />} Load older items</button>}
          </div>
          {newShares&&view!=='trash'&&<button className="new-shares button secondary" onClick={jumpToNewest}><ArrowDown size={16}/>New shares</button>}
        </section>
        <div className="send-workspace">
        <TransferQueue store={platform.transfers} onError={setError} />
        <input className="sr-only" type="file" multiple ref={input} aria-label="Choose files to upload" onChange={event => { enqueue(Array.from(event.currentTarget.files || []), 'file',pickerRouting.current); event.currentTarget.value = '';pickerRouting.current=undefined }} /><input className="sr-only" type="file" multiple accept={textFileAccept} ref={textFileInput} aria-label="Choose plain text files to upload" onChange={event => { enqueue(Array.from(event.currentTarget.files || []), 'text',pickerRouting.current); event.currentTarget.value = '';pickerRouting.current=undefined }} />
        <section hidden={view==='trash'} className={`composer ${text.length ? 'has-draft' : ''}`} aria-labelledby="composer-title"><h2 id="composer-title" className="sr-only">Send</h2><textarea ref={composer} aria-label="Text to share" placeholder="Paste a note, a link, anything…" value={text} onChange={event => { const value = event.target.value; setText(previous => preserveTextareaEdit(previous, value)) }} onPaste={event => {
          if (!event.clipboardData.types.includes('text/plain')) return
          event.preventDefault()
          const pasted = event.clipboardData.getData('text/plain'); const start = event.currentTarget.selectionStart; const end = event.currentTarget.selectionEnd
          setText(previous => insertPlainText(previous, start, end, pasted))
          requestAnimationFrame(() => { const caret = start + textareaText(pasted).length; composer.current?.setSelectionRange(caret, caret) })
        }} onKeyDown={event => { if (!event.nativeEvent.isComposing && event.keyCode!==229 && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendText() } }} disabled={!connected || !deviceId || sending} /><div className="composer-bottom"><div className="composer-tools"><button className="button action-button add-files" aria-label="Add files" title="Add files" onClick={() => choose('file')}><Paperclip size={18} /><span className="add-files-label">Add files</span></button><ItemMenu name="sharing">{close => <><button role="menuitem" onClick={()=>{choose('folder');close()}}><UploadCloud size={17}/>Add folder</button><button role="menuitem" tabIndex={0} onClick={() => { choose('text'); close() }}><FileText size={17}/>Upload text file</button></>}</ItemMenu></div><RecipientPicker devices={devices} currentId={deviceId} targets={targets} onChange={setTargets} onRefresh={refresh} disabled={!connected||!deviceId}/><button className="button primary send-button" aria-label={sending?'Sharing…':'Share text'} title="Share text" disabled={!connected || !deviceId || !text.length || sending} onClick={() => void sendText()}>{sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}<span>Send</span></button>{mobile&&mobileEditing&&<button className="icon-button finish-editing" aria-label="Done editing" onClick={finishMobileEditing}><Check size={18}/></button>}</div>{composerError && <p role="alert" className="inline-error">{composerError}</p>}</section>
        </div>
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
