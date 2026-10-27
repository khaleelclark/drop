import {useEffect,useRef,useState} from 'react'
import type {PlatformAdapter} from './platform'
import {errorMessage} from './types'
export function OpenAtLogin({platform,disabled,onBusyChange}:{platform:PlatformAdapter;disabled:boolean;onBusyChange:(busy:boolean)=>void}){
  const [enabled,setEnabled]=useState<boolean>(),[busy,setBusy]=useState(false),[reading,setReading]=useState(false),[error,setError]=useState('')
  const lock=useRef(false),generation=useRef(0)
  useEffect(()=>{
    const current=++generation.current
    if(platform.getOpenAtLogin)void platform.getOpenAtLogin().then(value=>{if(generation.current===current){setEnabled(value.enabled);setError('')}}).catch(failure=>{if(generation.current===current)setError(errorMessage(failure))})
    return()=>{generation.current++}
  },[platform])
  if(!platform.getOpenAtLogin||!platform.setOpenAtLogin)return null
  const toggle=async()=>{
    if(lock.current||disabled||enabled===undefined)return
    lock.current=true;setBusy(true);setReading(false);onBusyChange(true);setError('')
    try{const receipt=await platform.setOpenAtLogin!(!enabled);setEnabled(receipt.enabled)}
    catch(failure){setError(errorMessage(failure))}
    finally{lock.current=false;setBusy(false);onBusyChange(false)}
  }
  const retry=async()=>{
    if(lock.current||disabled)return
    lock.current=true;setBusy(true);setReading(true);onBusyChange(true);setError('')
    try{setEnabled((await platform.getOpenAtLogin!()).enabled)}catch(failure){setError(errorMessage(failure))}
    finally{lock.current=false;setBusy(false);onBusyChange(false)}
  }
  return <section className="settings-section" aria-labelledby="login-title"><h3 id="login-title">Open at login</h3><p className="field-note">Start Drop quietly in the menu bar when you sign in to this Mac.</p><label className="login-control"><input type="checkbox" checked={enabled===true} disabled={disabled||busy||enabled===undefined} onChange={()=>void toggle()}/>Open at login</label>{busy&&<p className="field-note" role="status">{reading?'Checking login setting…':'Saving login setting…'}</p>}{enabled===undefined&&!error&&!busy&&<p className="field-note">Checking login setting…</p>}{error&&<div><p className="inline-error" role="alert">{error}</p><button className="text-button" disabled={disabled||busy} onClick={()=>void retry()}>Check login setting again</button></div>}</section>
}
