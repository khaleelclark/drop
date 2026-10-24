import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Laptop, Search, Smartphone, Users, X } from 'lucide-react'
import type { Device } from './types'
export function RecipientPicker({devices,currentId,targets,onChange,onRefresh,disabled}:{devices:Device[];currentId:string;targets:string[];onChange:(ids:string[])=>void;onRefresh:()=>void;disabled:boolean}) {
  const [open,setOpen]=useState(false); const [query,setQuery]=useState(''); const trigger=useRef<HTMLButtonElement>(null); const search=useRef<HTMLInputElement>(null); const dialog=useRef<HTMLDialogElement>(null)
  const keyboard=useRef(false)
  const close=()=>{dialog.current?.close();setOpen(false);if(keyboard.current)trigger.current?.focus({preventScroll:true});else trigger.current?.blur()}
  useEffect(()=>{
    if (!open) return
    const sheet=dialog.current; if(!sheet)return
    const position=()=>{
      const anchor=trigger.current?.getBoundingClientRect();const viewport=window.visualViewport
      if(!anchor)return
      sheet.style.setProperty('--picker-left',`${Math.max(8,Math.min(anchor.left,innerWidth-346))}px`)
      sheet.style.setProperty('--picker-top',`${Math.max(8,Math.min(anchor.bottom+8,innerHeight-sheet.getBoundingClientRect().height-8))}px`)
      sheet.style.setProperty('--picker-height',`${Math.max(100,(viewport?.height??innerHeight)-24)}px`)
      sheet.style.setProperty('--picker-bottom',`${Math.max(0,innerHeight-(viewport?.height??innerHeight)-(viewport?.offsetTop??0))}px`)
    }
    position();sheet.showModal();position();search.current?.focus({preventScroll:true})
    document.body.classList.add('recipient-open')
    window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position)
    return()=>{sheet.close();document.body.classList.remove('recipient-open');window.removeEventListener('resize',position);window.visualViewport?.removeEventListener('resize',position)}
  },[open])
  const selected=targets.length===0?'Everyone':targets.length===1?(devices.find(device=>device.id===targets[0])?.label || 'Unavailable device'):`${targets.length} devices`
  return <div className="recipient-picker" onPointerDownCapture={()=>{keyboard.current=false}} onKeyDownCapture={()=>{keyboard.current=true}}>
    <button ref={trigger} className="recipient-trigger" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?'recipient-list':undefined} onClick={()=>{setOpen(!open);if(!open)onRefresh()}}><Users size={16}/><span>Send to <strong>{selected}</strong></span><ChevronDown size={14}/></button>
    {open&&<dialog ref={dialog} className="recipient-popover" id="recipient-list" aria-labelledby="recipient-title" onKeyDown={event=>{
      if(event.key!=='Tab')return
      const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
      const first=controls[0],last=controls.at(-1)
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    }} onCancel={event=>{event.preventDefault();close()}} onPointerDown={event=>{if(event.target!==event.currentTarget)return;const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close()}}>
      <div className="recipient-heading"><h2 id="recipient-title">Send to devices</h2><button className="icon-button" aria-label="Close device picker" onClick={close}><X size={18}/></button></div>
      <label className="recipient-search"><Search size={16}/><input ref={search} type="search" aria-label="Find devices" placeholder="Find devices" value={query} onChange={event=>setQuery(event.target.value)}/></label>
      <div className="recipient-options"><button className="recipient-row" aria-pressed={!targets.length} onClick={()=>onChange([])}><Users size={20}/><span><strong>Everyone</strong><small>Other registered devices</small></span>{!targets.length&&<Check size={17}/>}</button>
      {devices.filter(device=>device.id!==currentId&&device.label.toLowerCase().includes(query.toLowerCase())).map(device=><button key={device.id} className="recipient-row" aria-pressed={targets.includes(device.id)} onClick={()=>onChange(targets.includes(device.id)?targets.filter(id=>id!==device.id):[...targets,device.id])}>{device.platform==='android'?<Smartphone size={20}/>:<Laptop size={20}/>}<span><strong>{device.label}</strong><small>{device.platform} · {device.id.slice(-6)}</small></span>{targets.includes(device.id)&&<Check size={17}/>}</button>)}
      {!devices.some(device=>device.id!==currentId&&device.label.toLowerCase().includes(query.toLowerCase()))&&<p className="field-note">No matching devices. Open Drop on another device to register it.</p>}</div><div className="recipient-footer"><p className="field-note routing-note">All shares remains visible to your household.</p><button className="text-button recipient-done" onClick={close}>Done</button></div></dialog>}
  </div>
}
