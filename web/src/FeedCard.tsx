import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, Check, CheckCheck, ChevronDown, ChevronUp, Copy, File, FileArchive, FileImage, FileText, LoaderCircle, Pin, Trash2 } from 'lucide-react'
import { ApiClient, COPY_LIMIT } from './api'
import { ItemMenu } from './ItemMenu'
import { boundedPreview } from './text-preview'
import { copyExactText, type PlatformAdapter } from './platform'
import { errorMessage, formatBytes, type Item } from './types'
interface Props { item: Item; api: ApiClient; platform: PlatformAdapter; refresh: () => void; notify: (message: string) => void }
export function FeedCard({ item, api, platform, refresh, notify }: Props) {
  const preparation = useRef<AbortController | undefined>(undefined)
  const [body, setBody] = useState<string | undefined>(); const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false); const [copied, setCopied] = useState(false)
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    preparation.current?.abort(); setLoading(false); setBody(undefined); setCopied(false)
    let controller: AbortController | undefined
    if (item.kind === 'text' && item.status === 'ready' && item.size <= 64 * 1024) {
      controller = new AbortController()
      const signal = controller.signal
      void api.text(item.id, signal).then(full => { if (!signal.aborted) setBody(full) }).catch(() => {})
    }
    return () => { controller?.abort(); preparation.current?.abort(); preparation.current = undefined }
  }, [api, item.id, item.updatedAt, item.kind, item.status, item.size])
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2500); return () => clearTimeout(timer) }, [copied])
  const prepare = async () => {
    if(item.size>COPY_LIMIT) return
    const controller=new AbortController();preparation.current?.abort();preparation.current=controller
    setLoading(true); setError('')
    try { const full=await api.text(item.id,controller.signal); if(!controller.signal.aborted) { setBody(full); notify('Full text is ready. Press Copy text to copy it.') } }
    catch (error) { if(!controller.signal.aborted) setError(errorMessage(error)) } finally { if(preparation.current===controller) { setLoading(false);preparation.current=undefined } }
  }
  const copy = async () => {
    if (body === undefined) { await prepare(); return }
    setBusy(true); setError(''); setCopied(false)
    try { await copyExactText(platform, body); setCopied(true); notify('Full text copied.') }
    catch (error) { setError(errorMessage(error)) } finally { setBusy(false) }
  }
  const download = async () => { try { await platform.download({ url: api.downloadURL(item.id), name: item.kind === 'text' && !item.name.endsWith('.txt') ? `${item.name}.txt` : item.name, itemId: item.id }) } catch (error) { setError(errorMessage(error)) } }
  const pin = async () => { setBusy(true); try { await api.pin(item.id, !item.pinned); refresh() } catch (error) { setError(errorMessage(error)) } finally { setBusy(false) } }
  const remove = async () => { setBusy(true); try { await api.delete(item.id); notify('Item deleted.'); refresh() } catch (error) { setError(errorMessage(error)); setBusy(false) } }
  const rendered = body === undefined ? undefined : boundedPreview(body)
  const when = new Date(item.createdAt)
  const fileExtension = item.name.split('.').pop()?.toUpperCase().slice(0, 7) || 'FILE'
  const FileIcon = item.mimeType?.startsWith('image/') ? FileImage : /zip|tar|gzip/.test(item.mimeType || '') ? FileArchive : File
  return <article className={`feed-card ${item.kind} ${item.pinned ? 'is-pinned' : ''}`} aria-label={`${item.kind === 'text' ? 'Text' : 'File'}: ${item.name}`}>
    <div className="card-heading">
      <span className={`type-icon ${item.kind}`} aria-hidden="true">{item.kind === 'text' ? <FileText size={17} /> : <FileIcon size={18} />}</span>
      <div className="card-origin"><span>{item.sourceDevice || 'Household'}</span><span className="metadata"><time dateTime={item.createdAt} title={when.toLocaleString()}>{when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time></span></div>
      {item.pinned && <span className="pin-label"><Pin size={12} /> Pinned</span>}
      <ItemMenu name={item.name}>{close=><>
        {item.kind==='text'&&item.status==='ready'&&item.size<=COPY_LIMIT&&<button role="menuitem" disabled={loading} onClick={()=>{if(!expanded&&body===undefined)void prepare();setExpanded(!expanded);close()}}>{expanded?<ChevronUp size={17}/>:<ChevronDown size={17}/>} {expanded?'Collapse text':'Expand text'}</button>}
        <button role="menuitem" onClick={()=>{void pin();close()}} disabled={busy}><Pin size={17}/>{item.pinned?'Unpin item':'Pin item'}</button>
        <button role="menuitem" className="menu-danger" onClick={()=>{setDeleting(!deleting);close()}}><Trash2 size={17}/>Delete item</button>
      </>}</ItemMenu>
    </div>
    {item.kind === 'text' ? <>
      <pre tabIndex={expanded ? 0 : undefined} className={`text-preview ${expanded ? 'expanded' : ''}`}>{expanded && rendered !== undefined ? rendered.text : item.preview || (item.status === 'ready' ? 'Empty text' : 'Text is being uploaded…')}</pre>
      {expanded && rendered?.truncated && <p className="inline-note">Showing the first 256 KiB. Copy text uses the full prepared body; download .txt to read everything.</p>}

    </> : <div className="file-content"><div className="file-tile"><FileIcon size={30} strokeWidth={1.4} /><span>{fileExtension}</span></div><div className="file-details"><h3>{item.name}</h3><span>{formatBytes(item.size)}<span className="meta-dot">·</span>{item.status === 'ready' ? 'Ready to download' : item.status === 'failed' ? 'Upload failed' : 'Uploading — not ready yet'}</span></div></div>}
    <div className="card-footer">
      <span className={`metadata status-${item.status}`}>{item.status === 'uploading' ? <><LoaderCircle className="spin" size={13} /> Uploading</> : item.status === 'failed' ? 'Upload failed' : <>{item.kind === 'text' ? `${formatBytes(item.size)} of text` : <><CheckCheck size={14} /> Available to everyone</>}</>}</span>
      <div className="card-actions">
        {loading && <button className="button compact secondary" onClick={() => { preparation.current?.abort(); setLoading(false) }}>Cancel preparation</button>}
        {item.kind === 'text' && <button className={`button compact ${copied ? 'copied' : 'primary'}`} onClick={() => void copy()} disabled={item.status !== 'ready' || loading || busy || item.size > COPY_LIMIT}>{loading || busy ? <LoaderCircle className="spin" size={15} /> : copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : body === undefined ? 'Prepare copy' : 'Copy text'}</button>}
        <button className={`button compact ${item.kind === 'file' || item.size > COPY_LIMIT ? 'primary' : 'secondary'}`} onClick={() => void download()} disabled={item.status !== 'ready'}><ArrowDownToLine size={15} />{item.kind === 'text' ? 'Download .txt' : 'Download'}</button>
      </div>
    </div>
    {item.kind === 'text' && item.size > COPY_LIMIT && <p className="inline-note">This text exceeds the 8 MiB copy budget. Download .txt to open or copy the full text in another app.</p>}
    {deleting && <div className="delete-confirm" role="group" aria-label="Confirm deletion"><span>Delete for everyone? This cannot be undone.</span><button className="button compact danger" onClick={() => void remove()} disabled={busy}>Delete</button><button className="button compact secondary" onClick={() => setDeleting(false)}>Keep</button></div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </article>
}
