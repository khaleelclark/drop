import {useEffect,useRef,useState,type FormEvent} from 'react'
import {ApiError,type ApiClient} from './api'
import {errorMessage} from './types'

export function TrashSettings({api,onBusyChange}:{api:ApiClient;onBusyChange?:(busy:boolean)=>void}) {
  const [choice,setChoice]=useState(''),[custom,setCustom]=useState('')
  const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('')
  const [unsupported,setUnsupported]=useState(false)
  const lock=useRef(false),generation=useRef(0)
  const apply=(days:number|null)=>{setChoice(days===null?'never':[30,60,90].includes(days)?String(days):'custom');if(days!==null)setCustom(String(days))}
  const load=async()=>{
    if(lock.current)return
    const current=generation.current;lock.current=true;setBusy(true);setError('');setSaved('')
    try{const settings=await api.trashSettings();if(current===generation.current){apply(settings.retentionDays);setLoaded(true);setUnsupported(false)}}
    catch(error){if(current===generation.current){if(error instanceof ApiError&&error.code==='update_required')setUnsupported(true);else setError(errorMessage(error))}}
    finally{if(current===generation.current){lock.current=false;setBusy(false)}}
  }
  useEffect(()=>{void load();return()=>{generation.current++;lock.current=false}},[api])
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(lock.current||!loaded||unsupported)return
    const days=choice==='never'?null:choice==='custom'?Number(custom):Number(choice)
    if(days!==null&&(!/^\d+$/.test(choice==='custom'?custom:choice)||!Number.isInteger(days)||days<1||days>36500)){setError('Enter whole days from 1 through 36500.');return}
    const current=generation.current;lock.current=true;setBusy(true);onBusyChange?.(true);setError('');setSaved('')
    try{const settings=await api.trashSettings(days);if(current===generation.current){apply(settings.retentionDays);setSaved(settings.retentionDays===null?'Saved. Automatic expiration is off.':`Saved. Deleted items are kept for ${settings.retentionDays} days.`)}}
    catch(error){if(current===generation.current){if(error instanceof ApiError&&error.code==='update_required')setUnsupported(true);else setError(`${errorMessage(error)} Your choice is kept. Refresh the saved setting before saving again.`)}}
    finally{onBusyChange?.(false);if(current===generation.current){lock.current=false;setBusy(false)}}
  }
  return <form className="trash-settings" onSubmit={event=>void submit(event)} aria-labelledby="retention-title">
    <h3 id="retention-title">Recently Deleted</h3>
    {unsupported?<p className="field-note" role="alert">Update the household server to change automatic deletion.</p>:<>
    {loaded&&<><label>Automatically delete after<select value={choice} disabled={busy} onChange={event=>{setChoice(event.target.value);setSaved('')}}><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option><option value="never">Don’t delete</option><option value="custom">Custom days</option></select></label>
    {choice==='custom'&&<label>Custom days<input type="number" min="1" max="36500" step="1" required value={custom} disabled={busy} onChange={event=>{setCustom(event.target.value);setSaved('')}}/></label>}
    <p className="field-note">Applies to everyone. Shorter periods can permanently delete items already here.</p></>}
    {busy&&!loaded&&<p className="field-note" role="status">Loading…</p>}
    {error&&<p role="alert" className="inline-error">{error}</p>}{saved&&<p role="status" className="field-note">{saved}</p>}
    <div className="retention-actions">{loaded&&<button className="button secondary" type="submit" disabled={busy}>{busy?'Please wait…':'Save retention'}</button>}<button className="text-button" type="button" disabled={busy} onClick={()=>void load()}>{loaded?'Refresh saved setting':'Retry'}</button></div></>}
  </form>
}
