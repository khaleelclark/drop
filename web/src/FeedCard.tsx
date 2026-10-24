import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, Check, ChevronDown, ChevronUp, Copy, File, FileArchive, FileImage, LoaderCircle, Pencil, Pin, Save, Trash2 } from 'lucide-react'
import { ApiClient, ApiError, COPY_LIMIT } from './api'
import { ItemMenu } from './ItemMenu'
import { boundedPreview } from './text-preview'
import { isTextFileCandidate, textDownloadName } from './text-files'
import { insertPlainText, preserveTextareaEdit, textareaText } from './text-editing'
import { copyExactText, type PlatformAdapter } from './platform'
import { errorMessage, formatBytes, type Item } from './types'
interface Props { item: Item; api: ApiClient; platform: PlatformAdapter; refresh: () => void; notify: (message: string) => void }
export function FeedCard({ item, api, platform, refresh, notify }: Props) {
  const preparation = useRef<AbortController | undefined>(undefined)
  const [body, setBody] = useState<string | undefined>(); const [loading, setLoading] = useState(false)
  const previewElement=useRef<HTMLPreElement>(null);const [clipped,setClipped]=useState(false)
  const confirmation=useRef<HTMLDivElement>(null);const keep=useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false); const [copied, setCopied] = useState(false)
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [deleting, setDeleting] = useState(false)
  const [editor, setEditor] = useState<{name:string;text?:string;version:string}|null>(null)
  const [editLoading, setEditLoading] = useState(false); const [saving, setSaving] = useState(false); const [editError, setEditError] = useState('')
  const editPreparation = useRef<AbortController | undefined>(undefined); const nameInput = useRef<HTMLInputElement>(null)
  const textInput = useRef<HTMLTextAreaElement>(null)
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
  useEffect(() => () => editPreparation.current?.abort(), [api, item.id])
  useEffect(() => { if (editor) nameInput.current?.focus({preventScroll:true}) }, [Boolean(editor)])
  useEffect(() => { if (deleting) keep.current?.focus({preventScroll:true}) }, [deleting])
  useEffect(() => { if (deleting) confirmation.current?.scrollIntoView({block:'nearest'}) }, [deleting,error])
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
  const download = async (format?: 'txt'|'md') => {
    try { await platform.download({ url: api.downloadURL(item.id, format), name: format ? textDownloadName(item.name,format) : item.name, itemId: item.id }) }
    catch (error) { setError(errorMessage(error)) }
  }
  const pin = async () => { setBusy(true); try { await api.pin(item.id, !item.pinned); refresh() } catch (error) { setError(errorMessage(error)) } finally { setBusy(false) } }
  const remove = async () => { setBusy(true); setError(''); try { await api.delete(item.id); notify('Item deleted.'); refresh() } catch (error) { setError(errorMessage(error)); setBusy(false) } }
  const openEditor = async (reload = false) => {
    // Capture the version before fetching bytes. A racing edit must conflict, not overwrite it.
    const controller = new AbortController(); editPreparation.current?.abort(); editPreparation.current = controller
    setEditLoading(true); setEditError('')
    try {
      const snapshot = reload ? (await api.item(item.id)).item : item
      if (snapshot.status !== 'ready') throw new Error('This entry is not ready to edit.')
      const version = snapshot.updatedAt
      const text = snapshot.kind === 'text' && snapshot.size <= COPY_LIMIT ? await api.text(snapshot.id,controller.signal) : undefined
      if (!controller.signal.aborted) setEditor({name:snapshot.name,text,version})
    } catch (error) { if (!controller.signal.aborted) setEditError(errorMessage(error)) }
    finally { if (editPreparation.current === controller) { setEditLoading(false);editPreparation.current=undefined } }
  }
  const cancelEdit = () => { editPreparation.current?.abort();editPreparation.current=undefined;setEditLoading(false);setEditor(null);setEditError('') }
  const saveEdit = async () => {
    if (!editor || saving) return
    setSaving(true);setEditError('')
    try {
      await api.edit(item.id,{name:editor.name,...(editor.text !== undefined ? {text:editor.text} : {}),expectedUpdatedAt:editor.version})
      setEditor(null);setBody(undefined);setCopied(false);notify('Entry saved for your household.');refresh()
    } catch (error) { setEditError(error instanceof ApiError && error.status === 409 ? 'This entry changed or is no longer ready. Your draft is kept. Reload the latest entry to replace this draft, or keep it and copy your changes.' : `${errorMessage(error)} Your draft is kept. The save may have reached the server; reload to check before saving again.`) }
    finally { setSaving(false) }
  }
  const fullPreview = boundedPreview(body ?? item.preview ?? '',1200)
  const lines = fullPreview.text.replace(/\s+$/, '').split('\n'); const collapsed = lines.slice(0,6).join('\n')
  useEffect(()=>{
    const node=previewElement.current;if(!node)return
    const measure=()=>setClipped(node.scrollHeight>node.clientHeight+1)
    measure();const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(measure):undefined;observer?.observe(node);window.addEventListener('resize',measure)
    return()=>{observer?.disconnect();window.removeEventListener('resize',measure)}
  },[collapsed,expanded,Boolean(editor)])
  const canExpand = item.kind==='text' && item.status==='ready' && item.size<=COPY_LIMIT && (clipped || fullPreview.truncated || lines.length>6 || (body===undefined && item.size>new TextEncoder().encode(item.preview||'').length))
  const rendered = expanded && body !== undefined ? boundedPreview(body) : undefined
  const when = new Date(item.createdAt)
  const FileIcon = item.mimeType?.startsWith('image/') ? FileImage : /zip|tar|gzip/.test(item.mimeType || '') ? FileArchive : File
  const textual = item.kind==='text' || (item.size<=COPY_LIMIT && isTextFileCandidate(item))
  return <article className={`feed-card ${item.kind} ${item.pinned ? 'is-pinned' : ''}`} aria-label={`${item.kind === 'text' ? 'Text' : 'File'}: ${item.name}`}>
    {editor ? <form className="entry-editor" aria-label={`Edit ${item.name}`} onSubmit={event=>{event.preventDefault();void saveEdit()}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();(document.activeElement as HTMLElement)?.blur()}}}>
      <label>Entry name<input ref={nameInput} required maxLength={255} value={editor.name} disabled={saving||editLoading} onChange={event=>setEditor({...editor,name:event.target.value})}/></label>
      {editor.text !== undefined ? <label>Entry text<textarea ref={textInput} value={editor.text} disabled={saving||editLoading} onChange={event=>{const value=event.target.value;setEditor({...editor,text:preserveTextareaEdit(editor.text!,value)})}} onPaste={event=>{
        if(!event.clipboardData.types.includes('text/plain'))return
        event.preventDefault();const pasted=event.clipboardData.getData('text/plain');const start=event.currentTarget.selectionStart;const end=event.currentTarget.selectionEnd
        setEditor({...editor,text:insertPlainText(editor.text!,start,end,pasted)})
        requestAnimationFrame(()=>{const caret=start+textareaText(pasted).length;textInput.current?.setSelectionRange(caret,caret)})
      }}/></label> : <p className="field-note">{item.kind==='text'?'This entry exceeds the 8 MiB editor budget. You can rename it or download the full text.':'Rename this file. Its original bytes stay the same.'}</p>}
      <div className="editor-actions"><button className="button secondary" disabled={saving||editLoading}><Save size={16}/>{saving?'Saving…':'Save entry'}</button><button type="button" className="text-button" disabled={saving} onClick={cancelEdit}>Cancel editing</button><button type="button" className="text-button" onClick={()=>{(document.activeElement as HTMLElement)?.blur()}}>Done typing</button></div>
    </form> : <div className={`feed-row ${expanded ? 'is-expanded' : ''}`}>
      <div className="row-content">
        {item.kind === 'text' ? <><pre ref={previewElement} tabIndex={expanded ? 0 : undefined} className={`text-preview ${expanded ? 'expanded' : ''}`}>{rendered ? rendered.text : collapsed || (item.status === 'ready' ? 'Empty text' : 'Text is being uploaded…')}</pre>{(canExpand||expanded)&&<button className="text-button expand-text" aria-expanded={expanded} onClick={()=>{if(!expanded&&body===undefined)void prepare();setExpanded(!expanded)}}>{expanded?<ChevronUp size={15}/>:<ChevronDown size={15}/>} {expanded?'Collapse text':'Expand text'}</button>}</> : <h3 className="file-name"><FileIcon size={17} aria-hidden="true" />{item.name}</h3>}
      </div>
      <div className="row-footer"><div className={`row-metadata status-${item.status}`}>
        {item.pinned && <span className="pin-label"><Pin size={12} aria-hidden="true" /><span className="sr-only">Pinned</span></span>}
        <span className="row-source" title={item.kind==='text'?`${item.name} · ${item.sourceDevice || 'Household'}`:item.sourceDevice || 'Household'}>{item.kind==='text'?`${item.name} · ${item.sourceDevice || 'Household'}`:item.sourceDevice || 'Household'}</span>
        <span aria-hidden="true">·</span><span>{formatBytes(item.size)}</span>
        <span aria-hidden="true">·</span><time dateTime={item.createdAt} title={when.toLocaleString()}>{when.toDateString() === new Date().toDateString() ? when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
      </div><div className="card-actions">
        {textual && <button className={`button action-button ${copied ? 'copied' : ''}`} aria-label={copied?'Copied':body===undefined&&item.size<=COPY_LIMIT?'Prepare copy':'Copy text'} title={item.size>COPY_LIMIT?'Exceeds 8 MiB copy budget; download the full text':body===undefined?'Prepare the full text before copying':'Copy the full text'} onClick={() => void copy()} disabled={item.status !== 'ready' || item.size>COPY_LIMIT || loading || busy}>{loading || busy ? <LoaderCircle className="spin" size={16} /> : copied ? <Check size={16} /> : <Copy size={16} />}<span>{copied?'Copied':item.kind==='file'&&body===undefined?'Prepare copy':'Copy'}</span></button>}
        {item.kind==='file' && <button className="button action-button download-action" aria-label="Download" title="Download file" onClick={()=>void download()} disabled={item.status!=='ready'}><ArrowDownToLine size={16}/><span>Download</span></button>}
        {item.kind==='text' && item.size>COPY_LIMIT && <button className="button action-button download-action" aria-label="Download .txt" title="Download .txt" onClick={()=>void download('txt')} disabled={item.status!=='ready'}><ArrowDownToLine size={16}/><span>Download</span></button>}
        <ItemMenu name={item.name}>{close=><>
          {item.kind==='text'&&(['txt','md'] as const).map(format=><button key={format} role="menuitem" tabIndex={0} onClick={()=>{void download(format);close()}} disabled={item.status!=='ready'}><ArrowDownToLine size={17}/>Download .{format}</button>)}
          <button role="menuitem" tabIndex={0} disabled={item.status!=='ready'||editLoading} onClick={()=>{void openEditor();close()}}><Pencil size={17}/>{item.kind==='text'&&item.size<=COPY_LIMIT?'Edit entry':'Rename entry'}</button>
          <button role="menuitem" tabIndex={0} onClick={()=>{void pin();close()}} disabled={busy}><Pin size={17}/>{item.pinned?'Unpin item':'Pin item'}</button>
          <button role="menuitem" tabIndex={0} className="menu-danger" onClick={()=>{setDeleting(!deleting);close()}}><Trash2 size={17}/>Delete item</button>
        </>}</ItemMenu>
      </div></div>
      {item.status !== 'ready' && <span className={`item-status status-${item.status}`}>{item.status === 'failed' ? 'Upload failed' : <><LoaderCircle className="spin" size={12} /> Uploading — not ready yet</>}</span>}
    </div>}
    {(loading||editLoading)&&<button className="text-button" onClick={()=>{preparation.current?.abort();setLoading(false);editPreparation.current?.abort();setEditLoading(false)}}>Cancel preparation</button>}
    {expanded && rendered?.truncated && <p className="inline-note">Showing the first 256 KiB. Copy text uses the full prepared body; download .txt or .md to read everything.</p>}
    {textual && item.size > COPY_LIMIT && <p className="inline-note">This text exceeds the 8 MiB copy budget. Download {item.kind==='text'?'.txt or .md':'the file'} to open or copy the full text in another app.</p>}
    {deleting && <div className="delete-confirm" ref={confirmation} role="group" aria-label="Confirm deletion"><span>Delete for everyone? This cannot be undone.</span><button className="button compact danger" onClick={() => void remove()} disabled={busy}>Delete</button><button className="button compact secondary" ref={keep} onClick={() => setDeleting(false)}>Keep</button>{error && <p className="inline-error" role="alert">{error}</p>}</div>}
    {editError && <div className="edit-recovery"><p className="inline-error" role="alert">{editError}</p><button className="text-button" disabled={saving||editLoading} onClick={()=>void openEditor(true)}>Reload latest entry (replace draft)</button></div>}
    {error && !deleting && <p className="inline-error" role="alert">{error}</p>}
  </article>
}
