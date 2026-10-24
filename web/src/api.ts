import { validDeviceId, validItemId } from './devices'
import type { ArrivalPage, Device, FeedPage, Item, ItemAction, ItemActionResult, SendRouting, StorageInfo, TrashSettings, TrashSummary, TrashPurgePage } from './types'
export const COPY_LIMIT = 8 * 1024 * 1024
export const REQUEST_LIMIT = 40 * 1024 * 1024
const validRetention=(days:unknown)=>days===null||(Number.isInteger(days)&&Number(days)>=1&&Number(days)<=36500)
const validCutoff=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19)
const validCursor=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=2048
function validActionResult(result:ItemActionResult) {
  return result&&validItemId(result.id)&&(result.ok===true||(result.ok===false&&result.error&&Number.isInteger(result.error.status)&&result.error.status>=400&&result.error.status<=599&&typeof result.error.code==='string'&&result.error.code.length<=128&&typeof result.error.message==='string'&&result.error.message.length<=4096))
}
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); this.name = 'ApiError' }
}
export class ApiClient {
  constructor(public baseURL = window.location.origin, private request: typeof fetch = (...args) => fetch(...args)) {
    const url = new URL(baseURL)
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Use a server origin without a path, password, or query.')
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS, or HTTP on loopback for local development.')
    this.baseURL = url.origin
  }
  url(path: string) { return `${this.baseURL}/api${path}` }
  async response(path: string, init: RequestInit = {}) {
    const response = await this.request(this.url(path), { ...init, credentials: 'include', cache: 'no-store', headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } })
    if (!response.ok) {
      let message = `Request failed (${response.status}).`; let code
      try { const data = await response.json(); message = data.error?.message || message; code = data.error?.code } catch { /* Non-JSON reverse-proxy error. */ }
      throw new ApiError(message, response.status, code)
    }
    return response
  }
  async json<T>(path: string, init?: RequestInit): Promise<T> { return (await this.response(path, init)).json() }
  session(token: string) { return this.response('/session', { method: 'POST', body: JSON.stringify({ token }) }) }
  logout() { return this.response('/session', { method: 'DELETE' }) }
  list(query = '', before?: string, forDevice?: string) {
    const params = new URLSearchParams({ limit: '50' }); if (query) params.set('q', query); if (before) params.set('before', before)
    if (forDevice) params.set('forDevice', forDevice)
    return this.json<FeedPage>(`/items?${params}`)
  }
  storage() { return this.json<StorageInfo>('/storage') }
  createText(text: string, sourceDevice: string, routing?: SendRouting) { return this.json<{item: Item}>('/text', { method: 'POST', body: JSON.stringify({ text, sourceDevice, ...routing }) }) }
  item(id: string) { return this.json<{item: Item}>(`/items/${encodeURIComponent(id)}`) }
  register(device: Pick<Device,'id'|'label'|'platform'> & {preserveExisting?:boolean}) { return this.json<{device:Device}>('/devices/register', {method:'POST',body:JSON.stringify(device)}) }
  async devices() {
    const page=await this.json<{devices:Device[]}>('/devices')
    if(!Array.isArray(page.devices)||page.devices.length>64||page.devices.some(device=>!validDeviceId(device.id)||typeof device.label!=='string'||!['macos','linux','android','browser'].includes(device.platform)))throw new Error('Invalid device registry response. Retry after updating your server.')
    return page
  }
  forgetDevice(id: string) { return this.response(`/devices/${encodeURIComponent(id)}`, {method:'DELETE'}) }
  arrivals(id: string, after?: string) { return this.json<ArrivalPage>(`/devices/${encodeURIComponent(id)}/notifications?${new URLSearchParams({limit:'50',...(after ? {after} : {})})}`) }
  acknowledge(id: string, through: string) { return this.json<{ackCursor:string}>(`/devices/${encodeURIComponent(id)}/notifications/ack`, {method:'POST',body:JSON.stringify({through})}) }
  pin(id: string, pinned: boolean) { return this.json<{item: Item}>(`/items/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ pinned }) }) }
  edit(id: string, changes: {name:string;text?:string;expectedUpdatedAt:string}) {
    if (changes.text !== undefined && new TextEncoder().encode(changes.text).length > COPY_LIMIT) throw new Error('This edit exceeds the 8 MiB preparation budget. Keep the draft and shorten it, or download the original.')
    const body = JSON.stringify(changes)
    if (new TextEncoder().encode(body).length > REQUEST_LIMIT) throw new Error('This encoded edit exceeds the 40 MiB request budget. Keep the draft and shorten it before saving.')
    return this.json<{item: Item}>(`/items/${encodeURIComponent(id)}`, { method: 'PATCH', body })
  }
  async trashPage(query = '', before?: string) {
    const params = new URLSearchParams({limit:'50'}); if (query) params.set('q',query); if (before) params.set('before',before)
    const page = await this.recoverable(() => this.json<FeedPage>(`/trash?${params}`))
    if (!Array.isArray(page.items) || page.items.length > 50 || page.items.some(item => !validItemId(item.id) || !item.deletedAt || !Number.isFinite(Date.parse(item.deletedAt))) || !(page.nextCursor === null || typeof page.nextCursor === 'string')) throw new Error('Invalid Recently Deleted response. Update your household server and retry; active shares have not been changed.')
    return page
  }
  private async recoverable<T>(request:()=>Promise<T>,missingRoute=true):Promise<T> {
    try { return await request() }
    catch(error) {
      if(error instanceof ApiError && ([405,501].includes(error.status)||(missingRoute&&error.status===404))) throw new ApiError('Update the household server to delete items.',error.status,'update_required')
      if(error instanceof ApiError && error.status===404&&!missingRoute) throw new ApiError('This item is no longer available.',404,error.code)
      if(error instanceof ApiError && error.code==='upload_active') throw new ApiError('This upload is still active. Use Cancel in Transfers instead.',error.status,error.code)
      throw error
    }
  }
  itemAction(action:ItemAction,id:string) {
    if(!['trash','restore','purge'].includes(action)||!validItemId(id)) throw new Error('Invalid item ID.')
    return this.recoverable(()=>this.response(`/items/${encodeURIComponent(id)}/${action}`,{method:'POST'}),false)
  }
  async itemActions(action:ItemAction,ids:string[]) {
    if(!['trash','restore','purge'].includes(action) || ids.length<1 || ids.length>100 || new Set(ids).size!==ids.length || ids.some(id=>!validItemId(id))) throw new Error('Select 1–100 unique displayed items.')
    const page=await this.recoverable(()=>this.json<{results:ItemActionResult[]}>('/items/actions',{method:'POST',body:JSON.stringify({action,ids})}))
    if(!Array.isArray(page.results) || page.results.length!==ids.length || page.results.some((result,index)=>!validActionResult(result)||result.id!==ids[index])) throw new Error('The server returned incomplete action results. Check the folder before explicitly retrying; some items may have changed.')
    return page.results
  }
  async trashSettings(retentionDays?:number|null):Promise<TrashSettings> {
    if(retentionDays!==undefined&&!validRetention(retentionDays))throw new Error('Choose whole days from 1 through 36500, or Don’t delete.')
    const settings=await this.recoverable(()=>this.json<TrashSettings>('/settings/trash',retentionDays===undefined?undefined:{method:'PATCH',body:JSON.stringify({retentionDays})}))
    if(!settings||!validRetention(settings.retentionDays)||(retentionDays!==undefined&&settings.retentionDays!==retentionDays))throw new Error('Invalid trash retention response. Refresh settings before saving again.')
    return settings
  }
  async trashSummary():Promise<TrashSummary> {
    const summary=await this.recoverable(()=>this.json<TrashSummary>('/trash/summary'))
    if(!summary||!Number.isSafeInteger(summary.count)||summary.count<0||!validCutoff(summary.cutoff)||!Array.isArray(summary.names)||summary.names.length>Math.min(5,summary.count)||summary.names.some(name=>typeof name!=='string'||name.length>4096))throw new Error('Invalid folder summary. Refresh Recently Deleted before deleting anything.')
    return summary
  }
  async purgeTrash(cutoff:string,before?:string):Promise<TrashPurgePage> {
    if(!validCutoff(cutoff)||(before!==undefined&&!validCursor(before)))throw new Error('Invalid folder deletion cursor. Preview the folder again.')
    const page=await this.recoverable(()=>this.json<TrashPurgePage>('/trash/purge',{method:'POST',body:JSON.stringify({cutoff,...(before===undefined?{}:{before})})}))
    if(!page||!Array.isArray(page.results)||page.results.length>100||page.results.some(result=>!validActionResult(result))||new Set(page.results.map(result=>result.id)).size!==page.results.length||!(page.nextCursor===null||validCursor(page.nextCursor))||page.nextCursor===before)throw new Error('The server returned invalid folder deletion results. Some items may already be permanently deleted. Refresh before an explicit new action.')
    return page
  }
  downloadURL(id: string, format?: 'txt'|'md') { return this.url(`/items/${encodeURIComponent(id)}/download${format ? `?format=${format}` : ''}`) }
  async text(id: string, signal?: AbortSignal): Promise<string> {
    const response = await this.response(`/items/${encodeURIComponent(id)}/text`, { signal })
    if (Number(response.headers.get('Content-Length')) > COPY_LIMIT) { await response.body?.cancel(); throw new Error('This text is too large to prepare here. Download the full .txt file instead.') }
    if (!response.body) return ''
    const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }); const parts: string[] = []; let bytes = 0
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break
        bytes += value.byteLength
        if (bytes > COPY_LIMIT) throw new Error('This text is too large to copy here. Download the full .txt file instead.')
        parts.push(decoder.decode(value, { stream: true }))
      }
      parts.push(decoder.decode()); return parts.join('')
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  }
}
