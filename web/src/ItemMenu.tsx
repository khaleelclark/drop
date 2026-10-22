import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Ellipsis } from 'lucide-react'
export function ItemMenu({ children, name }: {children: (close: () => void) => ReactNode; name: string}) {
  const [open,setOpen]=useState(false)
  const root=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLButtonElement>(null)
  const id=useId()
  const close=()=>{setOpen(false);trigger.current?.focus()}
  useEffect(()=>{
    if(!open)return
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)}
    document.addEventListener('pointerdown',outside)
    return()=>document.removeEventListener('pointerdown',outside)
  },[open])
  return <div className="item-menu" ref={root} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false)}}>
    <button className="icon-button more-actions" ref={trigger} aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(!open)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setOpen(true)}}}><Ellipsis size={20}/></button>
    {open&&<div className="item-menu-popover" role="menu" id={id} aria-label={`Actions for ${name}`} onKeyDown={event=>{
      const elements=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
      const current=elements.indexOf(document.activeElement as HTMLButtonElement)
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();elements[(current+(event.key==='ArrowDown'?1:-1)+elements.length)%elements.length]?.focus()}
      if(event.key==='Home'){event.preventDefault();elements[0]?.focus()}
      if(event.key==='End'){event.preventDefault();elements.at(-1)?.focus()}
    }}>{children(close)}</div>}
  </div>
}
