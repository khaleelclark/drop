import {useEffect,useRef,useState,type FormEvent} from 'react'
import type {ApiClient} from './api'
import {errorMessage} from './types'

export function TrashSettings({api}:{api:ApiClient}) {
  const [choice,setChoice]=useState('30'),[custom,setCustom]=useState('30')
  const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('')
  const lock=useRef(false),generation=useRef(0)
  const apply=(days:number|null)=>{setChoice(days===null?'never':[30,60,90].includes(days)?String(days):'custom');if(days!==null)setCustom(String(days))}
  const load=async()=>{
    if(lock.current)return
    const current=generation.current;lock.current=true;setBusy(true);setError('');setSaved('')
    try{const settings=await api.trashSettings();if(current===generation.current){apply(settings.retentionDays);setLoaded(true)}}
    catch(error){if(current===generation.current)setError(errorMessage(error))}
    finally{if(current===generation.current){lock.current=false;setBusy(false)}}
  }
  useEffect(()=>{void load();return()=>{generation.current++;lock.current=false}},[api])
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(lock.current||!loaded)return
    const days=choice==='never'?null:choice==='custom'?Number(custom):Number(choice)
    if(days!==null&&(!/^\d+$/.test(choice==='custom'?custom:choice)||!Number.isInteger(days)||days<1||days>36500)){setError('Enter whole days from 1 through 36500.');return}
    const current=generation.current;lock.current=true;setBusy(true);setError('');setSaved('')
    try{const settings=await api.trashSettings(days);if(current===generation.current){apply(settings.retentionDays);setSaved(settings.retentionDays===null?'Saved. Automatic expiration is off for this household.':`Saved. This household keeps deleted items for ${settings.retentionDays} days.`)}}
    catch(error){if(current===generation.current)setError(`${errorMessage(error)} Your choice is kept here. Check the saved setting before explicitly trying Save again.`)}
    finally{if(current===generation.current){lock.current=false;setBusy(false)}}
  }
  return <form className="trash-settings" onSubmit={event=>void submit(event)} aria-labelledby="retention-title">
    <h3 id="retention-title">Recently Deleted</h3>
    <p className="field-note">Shared by the whole household. Automatic expiration starts from the most recent move here; restoring an item cancels it.</p>
    <label>Automatically delete after<select value={choice} disabled={busy||!loaded} onChange={event=>{setChoice(event.target.value);setSaved('')}}><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option><option value="never">Don’t delete</option><option value="custom">Custom days</option></select></label>
    {choice==='custom'&&<label>Custom days<input type="number" min="1" max="36500" step="1" required value={custom} disabled={busy} onChange={event=>{setCustom(event.target.value);setSaved('')}}/></label>}
    <p className="field-note">Shortening this setting also affects items already here at the next server cleanup. Expiration permanently removes their files and text. Retained items still use storage.</p>
    {error&&<p role="alert" className="inline-error">{error}</p>}{saved&&<p role="status" className="field-note">{saved}</p>}
    <div className="retention-actions"><button className="button secondary" type="submit" disabled={busy||!loaded}>{busy?'Please wait…':'Save retention'}</button><button className="text-button" type="button" disabled={busy} onClick={()=>void load()}>Refresh saved setting</button></div>
  </form>
}
