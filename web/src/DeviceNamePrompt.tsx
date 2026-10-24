import { useId, useState } from 'react'
import { errorMessage } from './types'
export function DeviceNamePrompt({identityKey,name,rename}:{identityKey:string;name:string;rename:(name:string)=>Promise<void>}) {
  const key=`household.device-name:${identityKey}`
  const [dismissed,setDismissed]=useState(()=>{try{return localStorage.getItem(key)==='done'}catch{return false}})
  const [draft,setDraft]=useState(name);const [busy,setBusy]=useState(false);const [error,setError]=useState('')
  const id=useId()
  const dismiss=()=>{try{localStorage.setItem(key,'done');setDismissed(true)}catch{setError('Could not remember this choice. Allow app storage and try again.')}}
  const submit=async()=>{setBusy(true);setError('');try{await rename(draft);dismiss()}catch(error){setError(errorMessage(error))}finally{setBusy(false)}}
  if(dismissed)return null
  return <section className="device-name-prompt" aria-labelledby={id}>
    <h2 id={id}>Name this device</h2><p className="field-note">{name==='Desktop'?'Choose a name you’ll recognize, like “Kitchen Mac”. You can change it later in Settings.':'This name is saved on this device. Save it to update its household name. You can keep using the inbox.'}</p>
    <form onSubmit={event=>{event.preventDefault();void submit()}}><label>Device name<input required maxLength={80} value={draft} disabled={busy} onChange={event=>setDraft(event.target.value)} autoComplete="off"/></label><button className="button primary" disabled={busy}>{busy?'Saving…':'Save name'}</button><button className="text-button" type="button" disabled={busy} onClick={dismiss}>Not now</button></form>
    {error&&<p className="inline-error" role="alert">{error}</p>}
  </section>
}
