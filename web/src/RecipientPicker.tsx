import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Laptop, Search, Smartphone, Users, X } from 'lucide-react'
import type { Device } from './types'
export function RecipientPicker({devices,currentId,targets,onChange,onRefresh,disabled}:{devices:Device[];currentId:string;targets:string[];onChange:(ids:string[])=>void;onRefresh:()=>void;disabled:boolean}) {
  const [open,setOpen]=useState(false); const [query,setQuery]=useState(''); const container=useRef<HTMLDivElement>(null); const trigger=useRef<HTMLButtonElement>(null); const search=useRef<HTMLInputElement>(null)
  useEffect(()=>{
    if (!open) return
    search.current?.focus()
    const outside=(event:PointerEvent)=>{if(!container.current?.contains(event.target as Node))setOpen(false)}
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)
  },[open])
  const close=()=>{setOpen(false);trigger.current?.focus()}
  const selected=targets.length===0?'Everyone':targets.length===1?(devices.find(device=>device.id===targets[0])?.label || 'Unavailable device'):`${targets.length} devices`
  return <div className="recipient-picker" ref={container} onKeyDown={event=>{if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.preventDefault();event.stopPropagation();close()}}}>
    <button ref={trigger} className="recipient-trigger" disabled={disabled} aria-expanded={open} aria-controls="recipient-list" onClick={()=>{setOpen(!open);if(!open)onRefresh()}}><Users size={16}/><span>Send to <strong>{selected}</strong></span><ChevronDown size={14}/></button>
    {open&&<div className="recipient-popover" id="recipient-list" role="group" aria-label="Send to devices"><div className="recipient-search"><Search size={16}/><input ref={search} type="search" aria-label="Find devices" placeholder="Find devices" value={query} onChange={event=>setQuery(event.target.value)}/><button className="icon-button" aria-label="Close device picker" onClick={close}><X size={16}/></button></div>
      <div className="recipient-options"><button className="recipient-row" aria-pressed={!targets.length} onClick={()=>onChange([])}><Users size={18}/><span><strong>Everyone</strong><small>Other registered devices</small></span>{!targets.length&&<Check size={17}/>}</button>
      {devices.filter(device=>device.id!==currentId&&device.label.toLowerCase().includes(query.toLowerCase())).map(device=><button key={device.id} className="recipient-row" aria-pressed={targets.includes(device.id)} onClick={()=>onChange(targets.includes(device.id)?targets.filter(id=>id!==device.id):[...targets,device.id])}>{device.platform==='android'?<Smartphone size={18}/>:<Laptop size={18}/>}<span><strong>{device.label}</strong><small>{device.platform} · {device.id.slice(-6)}</small></span>{targets.includes(device.id)&&<Check size={17}/>}</button>)}
      {!devices.some(device=>device.id!==currentId&&device.label.toLowerCase().includes(query.toLowerCase()))&&<p className="field-note">No matching devices. Open Zing on another device to register it.</p>}</div><p className="field-note routing-note">All shares remains visible to your household.</p><button className="text-button recipient-done" onClick={close}>Done</button></div>}
  </div>
}
