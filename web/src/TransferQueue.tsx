import { useRef, useSyncExternalStore } from 'react'
import { Check, FileUp, LoaderCircle, Pause, Play, RotateCcw, X } from 'lucide-react'
import type { TransferStore } from './transfers'
import { errorMessage, formatBytes } from './types'
export function TransferQueue({ store, onError }: {store: TransferStore; onError: (error: string) => void}) {
  const rows = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const picker = useRef<HTMLInputElement>(null); const target = useRef<string | undefined>(undefined)
  if (!rows.length) return null
  const run = (action: Promise<void>) => { void action.catch(error => onError(errorMessage(error))) }
  return <section className="transfer-panel" aria-labelledby="transfer-title">
    <div className="section-title"><h2 id="transfer-title"><FileUp size={17} /> Transfers <span className="count-pill">{rows.filter(row => row.state !== 'complete').length}</span></h2>{rows.some(row => row.state === 'complete') && <button className="text-button" onClick={() => store.clearCompleted()}>Clear finished</button>}</div>
    <input className="sr-only" type="file" ref={picker} aria-label="Reselect original file" onChange={event => { const file = event.currentTarget.files?.[0]; if (file && target.current) run(store.reattach(target.current, file)); event.currentTarget.value = '' }} />
    <div className="transfer-list">{rows.map(row => {
      const percent = row.size > 0 ? Math.min(100, Math.round((row.state === 'checking' ? row.checked || 0 : row.sent) / row.size * 100)) : row.state === 'complete' ? 100 : 0
      const state = row.phase || { queued: 'Waiting', checking: 'Checking source', uploading: row.direction === 'download' ? 'Downloading' : 'Uploading', paused: 'Paused', 'needs-file': 'Select original file to resume', failed: 'Needs attention', complete: row.direction === 'download' ? 'Saved on this device' : 'Sent · server is finalizing', cancelling: 'Cancelling' }[row.state]
      return <div className={`transfer-row ${row.state}`} key={row.id}>
        <div className="transfer-icon">{row.state === 'complete' ? <Check size={19} /> : ['checking', 'uploading', 'cancelling'].includes(row.state) ? <LoaderCircle className="spin" size={19} /> : <FileUp size={19} />}</div>
        <div className="transfer-main"><strong>{row.name}</strong><div className="transfer-meta"><span>{state}</span><span>{row.state === 'checking' ? row.checked === undefined ? row.size >= 0 ? formatBytes(row.size) : 'Size pending' : `${percent}%` : row.size >= 0 ? `${formatBytes(row.confirmed)} / ${formatBytes(row.size)}` : 'Size pending'}</span></div><progress max="100" value={row.state==='checking'&&row.checked===undefined ? undefined : percent} aria-label={`${row.name}: ${state}`} />{row.error && <span className="inline-error">{row.error}</span>}</div>
        <div className="transfer-actions">
          {['queued', 'checking', 'uploading'].includes(row.state) && <button className="icon-button" aria-label={`Pause ${row.name}`} onClick={() => run(store.pause(row.id))}><Pause size={16} /></button>}
          {['paused', 'failed'].includes(row.state) && <button className="icon-button" aria-label={`Resume ${row.name}`} onClick={() => store.resume(row.id)}><Play size={16} /></button>}
          {(row.state === 'needs-file' || (row.state === 'failed' && row.uploadURL && !store.reselect)) && <button className="button compact secondary" onClick={() => { if (store.reselect) run(store.reselect(row.id)); else { target.current = row.id; picker.current?.click() } }}><RotateCcw size={14} /> Reselect</button>}
          {row.state !== 'complete' && <button className="icon-button" aria-label={`Cancel ${row.name}`} disabled={row.state === 'cancelling'} onClick={() => run(store.cancel(row.id))}><X size={16} /></button>}
        </div>
      </div>
    })}</div>
  </section>
}
