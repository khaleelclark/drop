import {act,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {TransferQueue} from './TransferQueue'
import type {Transfer,TransferStore} from './transfers'
afterEach(()=>vi.useRealTimers())
function fixture(){
  let rows:Transfer[]=[];let receive=()=>{}
  const store:TransferStore={getSnapshot:()=>rows,subscribe:fn=>{receive=fn;return()=>{receive=()=>{}}},enqueue:vi.fn(),pause:vi.fn(),resume:vi.fn(),cancel:vi.fn(),reattach:vi.fn(),clearCompleted:vi.fn()}
  return{store,set:(next:Transfer[])=>act(()=>{rows=next;receive()})}
}
const row=(id:string,state:Transfer['state']):Transfer=>({id,name:id,size:10,lastModified:1,kind:'file',sourceDevice:'Mac',destination:'https://home.example',state,confirmed:0,sent:0})
it('hides each success after its own three seconds across polls, preserves mixed states and never mutates the store',()=>{
  vi.useFakeTimers();const f=fixture();render(<TransferQueue store={f.store} onError={vi.fn()}/>);f.set([row('one','complete'),row('two','uploading'),...['failed','paused','needs-file','cancelling'].map(state=>row(state,state as Transfer['state']))])
  act(()=>vi.advanceTimersByTime(2000));f.set([...f.store.getSnapshot().map(r=>({...r})),row('three','complete')]);act(()=>vi.advanceTimersByTime(999));expect(screen.getByText('one')).toBeVisible()
  act(()=>vi.advanceTimersByTime(1));expect(screen.queryByText('one')).toBeNull();expect(screen.getByText('three')).toBeVisible()
  f.set(f.store.getSnapshot().map(r=>({...r})));act(()=>vi.advanceTimersByTime(2000));expect(screen.queryByText('three')).toBeNull()
  for(const name of ['two','failed','paused','needs-file','cancelling'])expect(screen.getByText(name)).toBeVisible()
  expect(f.store.cancel).not.toHaveBeenCalled();expect(f.store.clearCompleted).not.toHaveBeenCalled();expect(f.store.getSnapshot()).toHaveLength(7)
  f.set([row('one','complete'),row('three','complete')]);expect(screen.queryByRole('region')).toBeNull();expect(screen.queryByText('Transfers')).toBeNull()
})
it('cleans timers on store change/unmount, restores visible non-success rows and supports manual clear',()=>{
  vi.useFakeTimers();const a=fixture(),b=fixture(),view=render(<TransferQueue store={a.store} onError={vi.fn()}/>);a.set([row('same','complete')]);act(()=>vi.advanceTimersByTime(1000));view.rerender(<TransferQueue store={b.store} onError={vi.fn()}/>);b.set([row('same','paused')]);act(()=>vi.advanceTimersByTime(4000));expect(screen.getByText('same')).toBeVisible()
  b.set([row('same','complete')]);act(()=>vi.advanceTimersByTime(3000));expect(screen.queryByText('same')).toBeNull();b.set([row('same','failed')]);expect(screen.getByText('same')).toBeVisible()
  b.set([row('same','complete')]);fireEvent.click(screen.getByText('Clear finished'));expect(b.store.clearCompleted).toHaveBeenCalledOnce();view.unmount();expect(vi.getTimerCount()).toBe(0)
})
