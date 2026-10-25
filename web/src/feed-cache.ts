import type { FeedPage, Item } from './types'
import { compareShares, chronological } from './feed-order'

export interface FeedSnapshot extends FeedPage {
  scope: string
  kind: 'all'|'you'|'trash'
  query: string
  older: boolean
  boundary?: Item
  head: FeedPage
}

// Only bounded API metadata belongs here; FeedCard owns prepared text separately.
function metadata(item: Item): Item {
  const {id,kind,name,size,createdAt,updatedAt,status,preview,pinned,sourceDevice,mimeType,sourceDeviceId,targetDeviceIds,deletedAt}=item
  return {id,kind,name:name.slice(0,1024),size,createdAt,updatedAt,status,preview:preview?.slice(0,1024),pinned,sourceDevice:sourceDevice?.slice(0,512),mimeType:mimeType?.slice(0,256),sourceDeviceId,targetDeviceIds:targetDeviceIds?.slice(0,64),deletedAt}
}
export class FeedCache {
  private entries=new Map<string,FeedSnapshot>()
  get(scope:string) { return this.entries.get(scope) }
  put(snapshot:FeedSnapshot) {
    const returned=new Map(snapshot.items.map(item=>[item.id,metadata(item)]))
    const ordered=(item:Item)=>snapshot.kind==='trash'?{...item,createdAt:item.deletedAt!}:item
    const boundary=chronological(snapshot.items.map(ordered))[0]
    for(const [key,cached] of this.entries){
      const reconcile=(rows:Item[])=>rows.filter(item=>{
        if(snapshot.kind==='trash'&&cached.kind!=='trash')return !returned.has(item.id)
        if(snapshot.kind!=='trash'&&cached.kind==='trash')return !returned.has(item.id)
        if(!snapshot.query&&(snapshot.kind==='all'||snapshot.kind==='trash'&&cached.kind==='trash')&&!returned.has(item.id))return snapshot.nextCursor!==null&&(!boundary||compareShares(ordered(item),boundary)<0)
        if(cached.query&&returned.has(item.id))return false
        return true
      }).map(item=>cached.kind==='trash'||snapshot.kind==='trash'?item:returned.get(item.id)||item)
      this.entries.set(key,{...cached,items:reconcile(cached.items),head:{...cached.head,items:reconcile(cached.head.items)}})
    }
    // shortcut: very long inactive histories retain the newest page; re-page older history on return.
    const page=snapshot.items.length>200?snapshot.head:snapshot
    if(snapshot.query.length>1024)return
    const items=page.items.slice(0,200).map(metadata),head={items:snapshot.head.items.slice(0,50).map(metadata),nextCursor:snapshot.head.nextCursor}
    this.entries.delete(snapshot.scope)
    this.entries.set(snapshot.scope,{...snapshot,items,nextCursor:page.nextCursor,head,boundary:snapshot.boundary?metadata(snapshot.boundary):undefined,...(page===snapshot?{}:{older:false,boundary:undefined})})
    while(this.entries.size>6)this.entries.delete(this.entries.keys().next().value!)
  }
  remove(ids:Set<string>) {
    for(const [key,snapshot] of this.entries)this.entries.set(key,{...snapshot,items:snapshot.items.filter(item=>!ids.has(item.id)),head:{...snapshot.head,items:snapshot.head.items.filter(item=>!ids.has(item.id))}})
  }
  update(item:Item) {
    for(const [key,snapshot] of this.entries)this.entries.set(key,updateSnapshot(snapshot,metadata(item)))
  }
  clear() { this.entries.clear() }
}

export function updateSnapshot(snapshot:FeedSnapshot,item:Item):FeedSnapshot {
  // Search membership is server-owned; do not retain a now possibly mismatched row.
  const update=(rows:Item[])=>rows.filter(row=>row.id!==item.id||!snapshot.query).map(row=>row.id===item.id?item:row)
  return {...snapshot,items:update(snapshot.items),head:{...snapshot.head,items:update(snapshot.head.items)}}
}
