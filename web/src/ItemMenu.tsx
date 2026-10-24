import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Ellipsis } from 'lucide-react'
export function ItemMenu({ children, name }: {children: (close: () => void) => ReactNode; name: string}) {
  const [open,setOpen]=useState(false)
  const root=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLButtonElement>(null)
  const menu=useRef<HTMLDivElement>(null);const pointerInside=useRef(false)
  const keyboard=useRef(false)
  const id=useId()
  const close=()=>{setOpen(false);if(keyboard.current)trigger.current?.focus({preventScroll:true})}
  useLayoutEffect(()=>{
    if(!open)return
    const viewport=window.visualViewport
    const position=()=>{
      if(!root.current||!menu.current)return
      const anchor=root.current.getBoundingClientRect()
      const tabs=document.querySelector<HTMLElement>('.mobile-tabs')
      const top=(viewport?.offsetTop??0)+8
      const bottom=Math.min((viewport?.offsetTop??0)+(viewport?.height??innerHeight),
        tabs&&!tabs.hidden&&getComputedStyle(tabs).position==='fixed'?tabs.getBoundingClientRect().top:Infinity)-8
      menu.current.style.maxHeight=`${Math.max(0,bottom-top)}px`
      const height=menu.current.getBoundingClientRect().height
      const below=anchor.bottom+4
      const preferred=below+height<=bottom?below:anchor.top-4-height
      menu.current.style.top=`${Math.max(top,Math.min(preferred,bottom-height))-anchor.top}px`
    }
    position()
    if(keyboard.current)menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({preventScroll:true})
    const outside=(event:PointerEvent)=>{pointerInside.current=Boolean(root.current?.contains(event.target as Node));if(!pointerInside.current)setOpen(false)}
    const endPointer=()=>{pointerInside.current=false}
    document.addEventListener('pointerdown',outside)
    document.addEventListener('pointerup',endPointer)
    document.addEventListener('pointercancel',endPointer)
    window.addEventListener('resize',position)
    window.addEventListener('scroll',position,true)
    viewport?.addEventListener('resize',position)
    viewport?.addEventListener('scroll',position)
    return()=>{
      document.removeEventListener('pointerdown',outside)
      document.removeEventListener('pointerup',endPointer)
      document.removeEventListener('pointercancel',endPointer)
      endPointer()
      window.removeEventListener('resize',position)
      window.removeEventListener('scroll',position,true)
      viewport?.removeEventListener('resize',position)
      viewport?.removeEventListener('scroll',position)
    }
  },[open])
  return <div className="item-menu" ref={root} onPointerDownCapture={()=>{keyboard.current=false}} onKeyDownCapture={()=>{keyboard.current=true}} onBlur={event=>{
    // Keep pointer activation through a null-focus blur until its click arrives.
    if(!event.currentTarget.contains(event.relatedTarget as Node)&&!(event.relatedTarget===null&&pointerInside.current))setOpen(false)
  }}>
    <button className="icon-button more-actions" tabIndex={0} ref={trigger} aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(!open)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setOpen(true)}}}><Ellipsis size={20}/></button>
    {open&&<div className="item-menu-popover" ref={menu} role="menu" id={id} aria-label={`Actions for ${name}`} onKeyDown={event=>{
      const elements=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
      const current=elements.indexOf(document.activeElement as HTMLButtonElement)
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();elements[(current+(event.key==='ArrowDown'?1:-1)+elements.length)%elements.length]?.focus()}
      if(event.key==='Home'){event.preventDefault();elements[0]?.focus()}
      if(event.key==='End'){event.preventDefault();elements.at(-1)?.focus()}
    }}>{children(close)}</div>}
  </div>
}
