import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { ArrowDown, ArrowRight, Check, CircleHelp, Clipboard, FileText, FolderOpen, HardDrive, House, Inbox, Link2, LoaderCircle, LockKeyhole, LogOut, Paperclip, Pin, Plus, RefreshCw, Search, Send, Settings2, ShieldCheck, Smartphone, UploadCloud, WifiOff, X } from 'lucide-react'
import { ApiClient, ApiError } from './api'
import { browserPlatform } from './platform'
import { FeedCard } from './FeedCard'
import { ItemMenu } from './ItemMenu'
import { insertPlainText, preserveTextareaEdit, textareaText } from './text-editing'
import { TransferQueue } from './TransferQueue'
import { errorMessage, formatBytes, type Item, type StorageInfo } from './types'
function stored(key: string, fallback: string) { try { return localStorage.getItem(key) || fallback } catch { return fallback } }
function save(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* Settings are optional. */ } }
type View = 'all' | 'text' | 'file' | 'pinned'
export function App() {
  const [refreshTick, setRefreshTick] = useState(0)
  const refresh = useCallback(() => setRefreshTick(value => value + 1), [])
  const platform = useMemo(() => window.householdPlatform || browserPlatform(window.location.origin, refresh), [refresh])
  const [origin, setOrigin] = useState(platform.baseURL || window.location.origin)
  const [draftOrigin, setDraftOrigin] = useState(origin)
  const api = useMemo(() => new ApiClient(origin, platform.request), [origin, platform])
  const [connected, setConnected] = useState(false); const [checked, setChecked] = useState(false)
  const [connectionOpen, setConnectionOpen] = useState(Boolean(platform.requiresConnection)); const [token, setToken] = useState('')
  const [connecting, setConnecting] = useState(false); const [connectionError, setConnectionError] = useState('')
  const [device, setDevice] = useState(() => stored('household.device', platform.defaultDeviceName || (/Android/i.test(navigator.userAgent) ? 'My Android' : /Mac/i.test(navigator.userAgent) ? 'My Mac' : 'My computer')))
  const [items, setItems] = useState<Item[]>([]); const [cursor, setCursor] = useState<string | null>(null)
  const [storage, setStorage] = useState<StorageInfo>(); const [storageError, setStorageError] = useState('')
  const [query, setQuery] = useState(''); const [search, setSearch] = useState(''); const [view, setView] = useState<View>('all')
  const [loading, setLoading] = useState(true); const [loadingMore, setLoadingMore] = useState(false); const [error, setError] = useState('')
  const [live, setLive] = useState(false); const [offline, setOffline] = useState(!navigator.onLine)
  const [toast, setToast] = useState(''); const [text, setText] = useState(''); const [sending, setSending] = useState(false)
  const [composerError, setComposerError] = useState(''); const [dragging, setDragging] = useState(false); const [helpOpen, setHelpOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null); const textFileInput = useRef<HTMLInputElement>(null); const composer = useRef<HTMLTextAreaElement>(null)
  const sequence = useRef(0); const dragDepth = useRef(0)
  const notify = useCallback((message: string) => setToast(message), [])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4000); return () => clearTimeout(timer) }, [toast])
  useEffect(() => { const timer = setTimeout(() => setSearch(query), 300); return () => clearTimeout(timer) }, [query])
  useEffect(() => {
    const on = () => { setOffline(false); refresh() }; const off = () => setOffline(true)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [refresh])
  useEffect(() => {
    const number = ++sequence.current; let cancelled = false
    setLoading(true); setError('')
    void api.list(search).then(page => {
      if (cancelled || number !== sequence.current) return
      setItems(page.items); setCursor(page.nextCursor); setConnected(true); setChecked(true); setConnectionError('')
    }).catch(error => {
      if (cancelled || number !== sequence.current) return
      setChecked(true)
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) { setConnected(false); setItems([]); setStorage(undefined); setConnectionOpen(true) }
      else setError(errorMessage(error))
    }).finally(() => { if (!cancelled && number === sequence.current) setLoading(false) })
    return () => { cancelled = true }
  }, [api, search, refreshTick])
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
      const target = event.target as HTMLElement
      if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(target.tagName) && !target.isContentEditable) { event.preventDefault(); document.getElementById('feed-search')?.focus() }
      if (event.key === 'Escape') { setConnectionOpen(false); setHelpOpen(false) }
    }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [])
  useEffect(() => {
    if (!connectionOpen && !helpOpen) return
    const previous = document.activeElement as HTMLElement | null
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') || [])
    const timer = setTimeout(() => { if (!dialog?.contains(document.activeElement)) focusable()[0]?.focus() }, 0)
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const elements = focusable(); const first = elements[0]; const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap)
    document.body.classList.add('modal-open')
    return () => { clearTimeout(timer); document.removeEventListener('keydown', trap); document.body.classList.remove('modal-open'); previous?.focus() }
  }, [connectionOpen, helpOpen])
  const connect = async (event: FormEvent) => {
    event.preventDefault(); setConnecting(true); setConnectionError('')
    try {
      const target = new ApiClient(draftOrigin, platform.request)
      if (platform.kind === 'browser' && target.baseURL !== window.location.origin) throw new Error('Open Household at your server’s address to connect. Browser sessions use the server you opened.')
      if (platform.configureConnection) { await platform.configureConnection(target.baseURL, token, device); setOrigin(target.baseURL); setConnected(false); setItems([]); setStorage(undefined) }
      else await target.session(token)
      await target.list()
      setOrigin(target.baseURL); setConnected(true); setChecked(true); setConnectionOpen(false); setToken(''); save('household.device', device); refresh()
    } catch (error) { setConnectionError(errorMessage(error)) } finally { setConnecting(false) }
  }
  const logout = async () => {
    try { if (platform.disconnect) await platform.disconnect(); else { await Promise.all(platform.transfers.getSnapshot().filter(row => ['queued', 'checking', 'uploading'].includes(row.state)).map(row => platform.transfers.pause(row.id))); await api.logout() } sequence.current++; setError(''); setConnected(false); setItems([]); setStorage(undefined); setConnectionOpen(true); notify('Disconnected.') }
    catch (error) { setConnectionError(errorMessage(error)) }
  }
  const sendText = async () => {
    if (!text.length || sending) return
    setSending(true); setComposerError('')
    try {
      const maxTextBytes = storage?.maxTextBytes || 32 * 1024 ** 2
      if (text.length > maxTextBytes || new TextEncoder().encode(text).length > maxTextBytes) throw new Error(`Use “Upload text file” for text larger than ${formatBytes(maxTextBytes)}.`)
      await api.createText(text, device); setText(''); refresh(); notify('Text shared with your household.')
    } catch (error) { setComposerError(errorMessage(error)) } finally { setSending(false) }
  }
  const enqueue = (files: File[], kind: 'file' | 'text') => {
    if (!connected) { setConnectionOpen(true); return }
    if (!storage) { setError('Wait for the server’s storage limits before adding files, then try again.'); refresh(); return }
    try { platform.transfers.enqueue(files, kind, device, storage.maxFileBytes) } catch (error) { setError(errorMessage(error)) }
  }
  const choose = (kind: 'file' | 'text') => {
    if (!connected) { setConnectionOpen(true); return }
    if (platform.chooseFiles) { void platform.chooseFiles(kind, device).catch(error => setError(errorMessage(error))); return }
    if (kind === 'text') textFileInput.current?.click(); else input.current?.click()
  }
  const loadMore = async () => {
    if (!cursor || loadingMore) return
    const current = sequence.current; setLoadingMore(true)
    try { const page = await api.list(search, cursor); if (current === sequence.current) { setItems(previous => { const ids = new Set(previous.map(item => item.id)); return [...previous, ...page.items.filter(item => !ids.has(item.id))] }); setCursor(page.nextCursor) } }
    catch (error) { setError(errorMessage(error)) } finally { setLoadingMore(false) }
  }
  const drag = (event: DragEvent, entering: boolean) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current + (entering ? 1 : -1)); setDragging(dragDepth.current > 0)
  }
  const drop = (event: DragEvent) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); enqueue(Array.from(event.dataTransfer.files), 'file') }
  const visible = items.filter(item => view === 'all' || (view === 'pinned' ? item.pinned : item.kind === view))
  const nav = [{ id: 'all', label: 'All shares', icon: Inbox }, { id: 'text', label: 'Text', icon: FileText }, { id: 'file', label: 'Files', icon: FolderOpen }, { id: 'pinned', label: 'Pinned', icon: Pin }] as const
  return <div className={`app-shell ${connected ? 'is-connected' : ''}`} onDragEnter={event => drag(event, true)} onDragLeave={event => drag(event, false)} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault() }} onDrop={drop}>
    <a className="skip-link" href="#main">Skip to feed</a>
    <aside className="sidebar" inert={connectionOpen || helpOpen}>
      <a className="brand" href="/" aria-label="Household home"><span className="brand-mark"><House size={24} strokeWidth={1.8} /></span><span>Household</span></a>
      <span className="sidebar-caption">Your space</span><nav aria-label="Feed filters">{nav.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? 'selected' : ''}`} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined}><Icon size={18} /><span>{label}</span>{connected && <span className="nav-count">{items.filter(item => id === 'all' || (id === 'pinned' ? item.pinned : item.kind === id)).length}</span>}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="storage-card"><div><HardDrive size={17} /><strong>Household storage</strong></div>{storage ? <><p>{formatBytes(storage.usedBytes)} <span>stored</span></p><meter className="storage-bar" aria-label="Storage used" min={0} max={Math.max(1, storage.maxStorageBytes || storage.usedBytes + storage.freeBytes)} value={storage.usedBytes}>{formatBytes(storage.usedBytes)} stored</meter><small>{formatBytes(storage.freeBytes)} disk space free{storage.maxStorageBytes ? ` · ${formatBytes(storage.maxStorageBytes)} app budget` : ''}</small></> : <p className="storage-wait">{storageError ? 'Storage status unavailable' : connected ? 'Checking storage…' : 'Connect to view storage'}</p>}</div>
        <button className="sidebar-link" onClick={() => setHelpOpen(true)}><CircleHelp size={17} /> Help & tips</button>
        <div className="device-card"><span className="device-avatar"><Smartphone size={18} /></span><div><strong>{device}</strong><span>{platform.kind === 'native' ? 'Installed client' : 'Browser client'}</span></div><button className="icon-button" onClick={() => setConnectionOpen(true)} aria-label="Connection and device settings"><Settings2 size={16} /></button></div>
      </div>
    </aside>
    <div className="workspace" inert={connectionOpen || helpOpen}>
      <header className="topbar"><a className="mobile-brand" href="/" aria-label="Household home"><span className="brand-mark"><House size={20}/></span>Household</a><span className="topbar-caption"><LockKeyhole size={13}/> Your private shared space</span><button className={`connection-badge ${connected && live && !offline ? 'is-live' : ''}`} onClick={() => setConnectionOpen(true)}><span className="status-dot" />{offline ? 'Offline' : !connected ? 'Connect household' : live ? 'Connected' : 'Reconnecting…'}<Settings2 size={15} /></button></header>
      <main id="main">
        <div className="page-heading"><div><h1>{view === 'all' ? 'Shared inbox' : nav.find(item=>item.id===view)?.label}</h1></div><button className="button secondary compose-jump" onClick={()=>{composer.current?.scrollIntoView({block:'center'});composer.current?.focus({preventScroll:true})}}><Plus size={18}/>New share</button></div>
        <nav className="mobile-filters" aria-label="Mobile feed filters">{nav.map(({id,label,icon:Icon})=><button key={id} aria-current={view===id?'page':undefined} onClick={()=>setView(id)}><Icon size={16}/>{label}</button>)}</nav>
        {offline && <div className="banner" role="status"><WifiOff size={17} /> You’re offline. Your saved transfers can resume when you reconnect.</div>}
        {checked && !connected && !connectionOpen && <div className="banner"><Link2 size={17} /><span>Connect to your household to see and share items.</span><button className="text-button" onClick={() => setConnectionOpen(true)}>Connect <ArrowRight size={14} /></button></div>}
        <section className="composer" aria-labelledby="composer-title"><div className="composer-top"><h2 id="composer-title">Send to your household</h2><span className="composer-shortcut">⌘ / Ctrl + Enter</span></div><textarea ref={composer} aria-label="Text to share" placeholder="Paste a note, a link, anything…" value={text} onChange={event => { const value = event.target.value; setText(previous => preserveTextareaEdit(previous, value)) }} onPaste={event => {
          if (!event.clipboardData.types.includes('text/plain')) return
          event.preventDefault()
          const pasted = event.clipboardData.getData('text/plain'); const start = event.currentTarget.selectionStart; const end = event.currentTarget.selectionEnd
          setText(previous => insertPlainText(previous, start, end, pasted))
          requestAnimationFrame(() => { const caret = start + textareaText(pasted).length; composer.current?.setSelectionRange(caret, caret) })
        }} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void sendText() } }} disabled={!connected || sending} /><div className="composer-bottom"><div className="composer-tools"><button className="button secondary" onClick={() => choose('file')}><Paperclip size={16} /> Add files</button><ItemMenu name="sharing">{close => <button role="menuitem" onClick={() => { choose('text'); close() }}><FileText size={17}/>Upload text file</button>}</ItemMenu><span className="drop-hint">or drop them here</span></div><button className="button primary send-button" disabled={!connected || !text.length || sending} onClick={() => void sendText()}>{sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}<span>{sending ? 'Sharing…' : 'Share text'}</span></button></div>{text.length > 0 && <div className="composer-footnote"><span>{text.length.toLocaleString()} characters · whitespace preserved</span></div>}{composerError && <p role="alert" className="inline-error">{composerError}</p>}</section>
        <input className="sr-only" type="file" multiple ref={input} aria-label="Choose files to upload" onChange={event => { enqueue(Array.from(event.currentTarget.files || []), 'file'); event.currentTarget.value = '' }} /><input className="sr-only" type="file" multiple accept="text/plain,.txt,.md,.csv,.json,.log" ref={textFileInput} aria-label="Choose plain text files to upload" onChange={event => { enqueue(Array.from(event.currentTarget.files || []), 'text'); event.currentTarget.value = '' }} />
        <div className="transfer-note"><span>{storage ? `Up to ${formatBytes(storage.maxFileBytes)} per file` : 'Resumable file transfers'}</span><button onClick={()=>setHelpOpen(true)}>{platform.kind==='browser'?'Keep this tab open while sending':'About transfers'}<CircleHelp size={13}/></button></div>
        <TransferQueue store={platform.transfers} onError={setError} />
        <section className="feed" aria-labelledby="feed-title"><div className="feed-toolbar"><div className="feed-title"><h2 id="feed-title">{search ? 'Search results' : 'Recent shares'}</h2><span className="count-pill">{visible.length}</span></div><div className="feed-controls"><label className="search-field"><Search size={16} /><input id="feed-search" type="search" placeholder="Search shares" value={query} onChange={event => setQuery(event.target.value)} /><span className="search-shortcut">/</span><span className="sr-only">Search names and text previews</span></label><button className="icon-button refresh-button" onClick={refresh} disabled={loading} aria-label="Refresh feed"><RefreshCw className={loading ? 'spin' : ''} size={17} /></button></div></div><div className="feed-subheading"><span>{search ? 'Matching names and text previews' : view === 'pinned' ? 'Pins from loaded shares' : 'Newest first'}</span></div>
          {error && <div className="banner error-banner" role="alert"><span>{error}</span><button className="text-button" onClick={refresh}>Retry</button><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
          {loading && !items.length ? <div className="empty-state" role="status"><LoaderCircle className="spin" size={25} /><h3>Opening your household…</h3></div> : visible.length ? <div className="feed-list">{visible.map(item => <FeedCard key={item.id} item={item} api={api} platform={platform} refresh={refresh} notify={notify} />)}</div> : <div className="empty-state"><div className="empty-illustration"><Inbox size={35} strokeWidth={1.3} /></div><h3>{!connected ? 'Connect your household' : search ? 'No matching shares' : view === 'pinned' ? 'No pinned items' : 'A fresh start'}</h3><p>{!connected ? 'Connect to your private server to bring your devices together.' : search ? 'Try another name or a phrase from the text preview.' : view === 'pinned' ? 'Pin an item to find it here. Load more to include older pins.' : 'Paste something above or add a file. It’ll be here when you pick up your next device.'}</p>{!connected ? <button className="button primary" onClick={() => setConnectionOpen(true)}><Link2 size={16} /> Connect household</button> : !search && view !== 'pinned' && <button className="button secondary" onClick={() => composer.current?.focus()}><Plus size={16} /> Share something</button>}</div>}
          {cursor && <button className="load-more button secondary" onClick={() => void loadMore()} disabled={loadingMore || loading}>{loadingMore ? <LoaderCircle className="spin" size={15} /> : <ArrowDown size={15} />} Load older items</button>}
          {connected && visible.length > 0 && !cursor && <p className="feed-end"><span /> You’re all caught up <span /></p>}
        </section><footer className="workspace-footer"><LockKeyhole size={13} /><span>Private household space</span><button onClick={() => setHelpOpen(true)}>{platform.kind === 'native' ? 'About native transfers' : 'About browser transfers'}</button></footer>
      </main>
    </div>
    {dragging && <div className="drop-overlay"><div><UploadCloud size={52} strokeWidth={1.3} /><h2>Drop files to share</h2><p>Upload to your household server.</p></div></div>}
    {toast && <div className="toast" role="status"><Check size={17} />{toast}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></button></div>}
    {connectionOpen && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && connected) setConnectionOpen(false) }}><section className="modal connection-modal" role="dialog" aria-modal="true" aria-labelledby="connection-title"><button className="icon-button modal-close" aria-label="Close connection settings" onClick={() => setConnectionOpen(false)}><X size={20} /></button><div className="connection-heading"><span className="modal-icon"><House size={20} /></span><h2 id="connection-title">{connected ? 'Connection settings' : 'Connect to Household'}</h2></div><p>{connected ? 'Manage this device’s connection.' : 'Connect this device to your private household.'}</p>{connected && storage && <div className="settings-storage"><span><HardDrive size={16}/>Storage</span><p><strong>{formatBytes(storage.usedBytes)}</strong> stored · <strong>{formatBytes(storage.freeBytes)}</strong> free</p><small>Up to {formatBytes(storage.maxFileBytes)} per file</small></div>}<form onSubmit={event => void connect(event)}><label>Household server<input autoFocus type="url" required value={draftOrigin} onChange={event => setDraftOrigin(event.target.value)} spellCheck={false} autoCapitalize="none" /></label>{platform.kind === 'browser' && <p className="field-note">Use your private Tailscale HTTPS address.</p>}<label>App token<input type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" placeholder={connected ? 'Enter token to reconnect' : 'Your household’s configured token'} /></label><label>This device’s name<input required maxLength={80} value={device} onChange={event => { setDevice(event.target.value); save('household.device', event.target.value) }} autoComplete="off" /></label><p className="field-note">Shown beside your shares, e.g. “Kitchen Mac”.</p>{connectionError && <p className="inline-error" role="alert">{connectionError}</p>}<button className="button primary connect-button" disabled={connecting}>{connecting ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />}{connecting ? 'Connecting…' : 'Connect household'}</button></form>{connected && <button className="text-button disconnect-button" onClick={() => void logout()}><LogOut size={14} /> {platform.kind === 'native' ? 'Disconnect this app' : 'Disconnect this browser'}</button>}<div className="modal-footnote"><LockKeyhole size={13} />{platform.kind === 'native' ? 'Credentials are stored by your installed client.' : 'Your token isn’t saved in browser storage.'}</div></section></div>}
    {helpOpen && <div className="modal-backdrop"><section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><button className="icon-button modal-close" aria-label="Close help" onClick={() => setHelpOpen(false)} autoFocus><X size={20} /></button><span className="modal-icon"><CircleHelp size={27} /></span><h2 id="help-title">Using Household</h2><div className="help-entry"><UploadCloud size={20} /><div><h3>{platform.kind === 'native' ? 'Your native queue keeps transfer state.' : 'Keep this browser open while sending.'}</h3><p>{platform.kind === 'native' ? 'The native transfer engine owns your queue outside this interface. Sleep, shutdown, explicit Quit, or OS restrictions can pause work. Reopen the app to inspect and resume transfers.' : 'Browser uploads can pause when the tab closes or the device sleeps. Reopen the app and reselect the original file to resume. Source verification reads the file in bounded chunks.'}</p></div></div><div className="help-entry"><Clipboard size={20} /><div><h3>Copy means the whole text.</h3><p>Small notes prepare automatically. For text up to 8 MiB, press Prepare copy, then Copy text. Expanded previews show at most 256 KiB. Clipboard limits vary by device; Download .txt is always available once ready.</p></div></div><div className="help-entry"><HardDrive size={20} /><div><h3>Ready when the server says so.</h3><p>Completed transfers are checked by your server before becoming downloadable. Files stay until someone deletes them. Deleting an item removes it for everyone.</p></div></div><div className="help-entry"><ShieldCheck size={20} /><div><h3>Your household, privately connected.</h3><p>Use your private Tailscale HTTPS address. Your server stores the content and must be online to send or retrieve it.{platform.kind === 'browser' && ' Install this page from your browser’s app menu where available.'}</p></div></div><button className="button primary connect-button" onClick={() => setHelpOpen(false)}>Got it</button></section></div>}
  </div>
}
