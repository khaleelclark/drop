import {fireEvent,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {captureShares,sharesUnchanged,useShareDrag} from './share-drag'
import type {Item} from './types'
const row=(id:string):Item=>({id,kind:'file',name:id,size:1,status:'ready',createdAt:'2026-10-27T00:00:00Z',updatedAt:'2026-10-27T00:00:00Z',pinned:false})
const a=row('a'),b=row('b')
beforeEach(()=>{
  class Pointer extends MouseEvent {pointerId=1;isPrimary=true;constructor(type:string,init:PointerEventInit={}){super(type,init);Object.assign(this,{pointerId:init.pointerId??1,isPrimary:init.isPrimary??true})}}
  vi.stubGlobal('PointerEvent',Pointer)
  Object.defineProperty(HTMLButtonElement.prototype,'setPointerCapture',{configurable:true,value:vi.fn()})
  Object.defineProperty(HTMLButtonElement.prototype,'hasPointerCapture',{configurable:true,value:()=>false})
  Object.defineProperty(document,'elementFromPoint',{configurable:true,value:vi.fn(()=>screen.getByText('Pinned'))})
})
afterEach(()=>vi.unstubAllGlobals())
it('captures one row or exactly the selected ready rows, with the 100 item bound',()=>{
  expect(captureShares('a',[a,b],['b'])).toEqual([a])
  expect(captureShares('a',[a,b],['a','b'])).toEqual([a,b])
  for(const invalid of [{...b,status:'uploading' as const},{...b,status:'failed' as const},{...b,deletedAt:'today'}])expect(captureShares('a',[a,invalid],['a','b'])).toBeNull()
  expect(captureShares('a',[a],['a','missing'])).toBeNull()
  expect(captureShares('a',[a],['a','a'])).toBeNull()
  const rows=Array.from({length:101},(_,i)=>row(String(i)))
  expect(captureShares('0',rows,rows.slice(0,100).map(row=>row.id))).toHaveLength(100)
  expect(captureShares('0',rows,rows.map(row=>row.id))).toBeNull()
  expect(sharesUnchanged([a],[{...a,updatedAt:'later'}])).toBe(false)
  expect(sharesUnchanged([a],[{...a,pinned:true}])).toBe(false)
})
function Harness({scope='origin:device:all',rows=[a,b],selected=['a','b'],enabled=true,drop=vi.fn(),reject=vi.fn()}:{scope?:string;rows?:Item[];selected?:string[];enabled?:boolean;drop?:ReturnType<typeof vi.fn>;reject?:ReturnType<typeof vi.fn>}){
  const {start,drag}=useShareDrag({scope,rows,selected,enabled,onDrop:drop,onReject:reject})
  return <><button onPointerDown={event=>start(event,'a')}>Handle</button><button data-share-drop="pinned">Pinned</button><output>{drag?`${drag.count}:${drag.target}`:'idle'}</output></>
}
const down=()=>fireEvent.pointerDown(screen.getByText('Handle'),{button:0,clientX:10,clientY:10,isPrimary:true,pointerId:1})
const move=()=>fireEvent.pointerMove(window,{clientX:100,clientY:100,pointerId:1})
const up=()=>fireEvent.pointerUp(window,{clientX:100,clientY:100,pointerId:1})
it('uses the captured selection through pointerup, highlights a valid target and submits once',()=>{
  const drop=vi.fn();const view=render(<Harness drop={drop}/>);down()
  fireEvent.pointerMove(window,{clientX:12,clientY:12,pointerId:1});expect(screen.getByRole('status')).toHaveTextContent('idle')
  move();expect(screen.getByRole('status')).toHaveTextContent('2:pinned')
  view.rerender(<Harness drop={drop} selected={['b']}/>);up();up()
  expect(drop).toHaveBeenCalledExactlyOnceWith('pinned',[a,b],'origin:device:all')
})
it.each(['escape','cancel','blur','outside','scope','origin','device','query','disabled','stale','wrong-pointer'])('cancels safely: %s',reason=>{
  const drop=vi.fn(),reject=vi.fn();const view=render(<Harness drop={drop} reject={reject}/>);down();move()
  if(reason==='escape')fireEvent.keyDown(window,{key:'Escape'})
  if(reason==='cancel')fireEvent.pointerCancel(window,{pointerId:1})
  if(reason==='blur')fireEvent.blur(window)
  if(reason==='outside')vi.mocked(document.elementFromPoint).mockReturnValue(null)
  if(['scope','origin','device','query'].includes(reason))view.rerender(<Harness scope={reason==='origin'?'other:device:all':reason==='device'?'origin:other:all':reason==='query'?'origin:device:all:search':'origin:device:you'} drop={drop} reject={reject}/>)
  if(reason==='disabled')view.rerender(<Harness enabled={false} drop={drop} reject={reject}/>)
  if(reason==='stale')view.rerender(<Harness rows={[{...a,updatedAt:'later'},b]} drop={drop} reject={reject}/>)
  if(reason==='wrong-pointer'){fireEvent.pointerUp(window,{clientX:100,clientY:100,pointerId:2});expect(drop).not.toHaveBeenCalled();fireEvent.pointerCancel(window,{pointerId:1})}
  up();expect(drop).not.toHaveBeenCalled();expect(reject).toHaveBeenCalledTimes(reason==='stale'?1:0)
})
