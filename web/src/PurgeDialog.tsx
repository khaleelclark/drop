import {useEffect,useRef} from 'react'
import {Trash2} from 'lucide-react'
export function PurgeDialog({count,names,busy,wholeFolder=false,progress,onCancel,onConfirm}:{count:number;names:string[];busy:boolean;wholeFolder?:boolean;progress?:string;onCancel:()=>void;onConfirm:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null)
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();cancel.current?.focus({preventScroll:true});return()=>{dialog.current?.close();if(previous?.isConnected)previous.focus({preventScroll:true})}},[])
  return <dialog ref={dialog} className="modal purge-dialog" aria-labelledby="purge-title" aria-describedby="purge-description" onCancel={event=>{event.preventDefault();if(!busy)onCancel()}}>
    <div className="purge-content"><span className="modal-icon danger-icon"><Trash2 size={24}/></span><h2 id="purge-title">Permanently delete {count} {count===1?'item':'items'}?</h2>
    <p id="purge-description">{wholeFolder?`All ${count} items in Recently Deleted, including unloaded items and items hidden by filters,`:(count===1?'This item':`These ${count} items`)} will be permanently deleted for everyone and cannot be restored.{wholeFolder&&' New items moved here after this preview are excluded. Restored items are skipped.'}</p>
    <ul className="purge-names">{names.slice(0,5).map((name,index)=><li key={index}>{name}</li>)}{count>names.slice(0,5).length&&<li>And {count-names.slice(0,5).length} more</li>}</ul></div>
    {progress&&<p className="folder-progress" role="status">{progress}</p>}
    <div className="purge-actions"><button className="button quiet" ref={cancel} disabled={busy} onClick={onCancel}>Cancel</button><button className="button quiet text-danger" disabled={busy} onClick={onConfirm}>{busy?'Deleting…':'Delete'}</button></div>
  </dialog>
}
