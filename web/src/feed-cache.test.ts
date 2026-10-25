import {describe,it,expect} from 'vitest'
import {FeedCache,type FeedSnapshot} from './feed-cache'
import type {Item} from './types'
const item=(id:string):Item=>({id,kind:'file',name:id,size:10,createdAt:'2026-10-25T12:00:00Z',updatedAt:'2026-10-25T12:00:00Z',status:'ready',pinned:false})
const snapshot=(scope:string,items=[item('a')]):FeedSnapshot=>({scope,kind:'all',query:'',items,nextCursor:null,head:{items:items.slice(0,50),nextCursor:'opaque==first'},older:false})
describe('bounded session feed metadata',()=>{
  it('retains six most recently committed scopes and excludes body data',()=>{
    const cache=new FeedCache()
    for(let n=0;n<7;n++)cache.put({...snapshot('scope'+n),query:'query'+n,items:[{...item('a'),body:'full secret text',preview:'p'.repeat(2000)} as Item]})
    expect(cache.get('scope0')).toBeUndefined();expect(cache.get('scope6')?.items[0]).not.toHaveProperty('body');expect(cache.get('scope6')?.items[0].preview).toHaveLength(1024)
    cache.clear();expect(cache.get('scope6')).toBeUndefined()
  })
  it('keeps at most 200 history rows or falls back to the newest page with its exact cursor',()=>{
    const cache=new FeedCache(),rows=Array.from({length:200},(_,n)=>item('row'+n))
    cache.put({...snapshot('history',rows),older:true});expect(cache.get('history')?.items).toHaveLength(200)
    cache.put({...snapshot('history',[...rows,item('extra')]),older:true})
    expect(cache.get('history')?.items).toHaveLength(50);expect(cache.get('history')?.nextCursor).toBe('opaque==first');expect(cache.get('history')?.older).toBe(false)
  })
  it('removes successful actions from head and history without inserting For you membership',()=>{
    const cache=new FeedCache();cache.put(snapshot('all',[item('a'),item('b')]));cache.put({...snapshot('you',[item('b')]),kind:'you'})
    cache.remove(new Set(['b']));expect(cache.get('all')?.items.map(row=>row.id)).toEqual(['a']);expect(cache.get('you')?.head.items).toEqual([])
    cache.update({...item('a'),pinned:true});expect(cache.get('all')?.items[0].pinned).toBe(true);expect(cache.get('you')?.items).toEqual([])
  })
  it('reconciles only the authoritative All range and never infers For you from sender metadata',()=>{
    const cache=new FeedCache(),older={...item('older'),createdAt:'2026-10-24T12:00:00Z'}
    cache.put({...snapshot('you',[item('a'),older]),kind:'you'})
    cache.put({...snapshot('all',[item('new')]),nextCursor:'opaque'})
    expect(cache.get('you')?.items.map(row=>row.id)).toEqual(['a','older']) // same timestamp: ID a is before new.
    cache.put(snapshot('all',[item('new')]))
    expect(cache.get('you')?.items).toEqual([])
  })
  it('prunes restored and purged rows across cached trash searches',()=>{
    const cache=new FeedCache(),trashed={...item('deleted'),deletedAt:'2026-10-25T12:00:00Z'}
    cache.put({...snapshot('trash-search',[trashed]),kind:'trash',query:'deleted'})
    cache.put({...snapshot('trash',[]),kind:'trash'})
    expect(cache.get('trash-search')?.items).toEqual([])
    cache.put({...snapshot('trash-search',[trashed]),kind:'trash',query:'deleted'})
    cache.put(snapshot('all',[item('deleted')]))
    expect(cache.get('trash-search')?.items).toEqual([])
  })
})
