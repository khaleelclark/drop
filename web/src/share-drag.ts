import {useEffect,useLayoutEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react'
import type {Item} from './types'

export type ShareDestination='pinned'|'trash'
export function captureShares(id:string,rows:Item[],selected:string[]):Item[]|null {
  const ids=selected.includes(id)?selected:[id]
  if(!ids.length||ids.length>100||new Set(ids).size!==ids.length)return null
  const captured=ids.map(id=>rows.find(row=>row.id===id))
  if(captured.some(row=>!row||row.status!=='ready'||row.deletedAt))return null
  return captured.map(row=>({...row!}))
}
export function sharesUnchanged(captured:Item[],rows:Item[]) {
  return captured.every(item=>rows.some(row=>row.id===item.id&&row.status==='ready'&&!row.deletedAt&&row.updatedAt===item.updatedAt&&row.pinned===item.pinned))
}

export function useShareDrag({scope,rows,selected,enabled,onDrop,onReject}:{scope:string;rows:Item[];selected:string[];enabled:boolean;onDrop:(destination:ShareDestination,items:Item[],scope:string)=>void;onReject:()=>void}) {
  const latest=useRef({scope,rows,enabled,onDrop,onReject});latest.current={scope,rows,enabled,onDrop,onReject}
  const gesture=useRef<{pointer:number;x:number;y:number;scope:string;items:Item[];handle:HTMLButtonElement;active:boolean}|undefined>(undefined)
  const [drag,setDrag]=useState<{count:number;target:ShareDestination|null}|null>(null)
  const cancel=()=>{
    const pending=gesture.current;gesture.current=undefined;setDrag(null)
    if(pending?.handle.hasPointerCapture?.(pending.pointer))pending.handle.releasePointerCapture(pending.pointer)
  }
  useLayoutEffect(()=>{cancel()},[scope,enabled])
  useEffect(()=>{
    const target=(event:PointerEvent):ShareDestination|null=>{
      const node=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLButtonElement>('[data-share-drop]')
      return node&&!node.disabled&&(node.dataset.shareDrop==='pinned'||node.dataset.shareDrop==='trash')?node.dataset.shareDrop:null
    }
    const move=(event:PointerEvent)=>{
      const pending=gesture.current;if(!pending||event.pointerId!==pending.pointer)return
      if(!latest.current.enabled||pending.scope!==latest.current.scope){cancel();return}
      if(!pending.active&&Math.hypot(event.clientX-pending.x,event.clientY-pending.y)<6)return
      pending.active=true;event.preventDefault();setDrag({count:pending.items.length,target:target(event)})
    }
    const up=(event:PointerEvent)=>{
      const pending=gesture.current;if(!pending||event.pointerId!==pending.pointer)return
      const destination=pending.active?target(event):null
      cancel()
      if(!destination)return
      if(!latest.current.enabled||pending.scope!==latest.current.scope||!sharesUnchanged(pending.items,latest.current.rows)){latest.current.onReject();return}
      latest.current.onDrop(destination,pending.items,pending.scope)
    }
    const abortPointer=(event:PointerEvent)=>{if(event.pointerId===gesture.current?.pointer)cancel()}
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&gesture.current){event.preventDefault();event.stopImmediatePropagation();cancel()}}
    const hidden=()=>{if(document.visibilityState==='hidden')cancel()}
    window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',abortPointer);window.addEventListener('blur',cancel);window.addEventListener('keydown',key,true);document.addEventListener('visibilitychange',hidden)
    return()=>{cancel();window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',abortPointer);window.removeEventListener('blur',cancel);window.removeEventListener('keydown',key,true);document.removeEventListener('visibilitychange',hidden)}
  },[])
  const start=(event:ReactPointerEvent<HTMLButtonElement>,id:string)=>{
    if(!enabled||gesture.current||!event.isPrimary||event.button!==0)return
    const items=captureShares(id,rows,selected)
    if(!items||items.some(item=>document.getElementById(`share-${item.id}`)?.querySelector('.entry-editor'))){onReject();return}
    event.preventDefault();event.currentTarget.focus({preventScroll:true})
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current={pointer:event.pointerId,x:event.clientX,y:event.clientY,scope,items,handle:event.currentTarget,active:false}
  }
  return{drag,start,cancel}
}
