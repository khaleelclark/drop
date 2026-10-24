import { ApiClient } from './api'
import { deviceRecord, validItemId } from './devices'
import type { ArrivalPage } from './types'
export const arrivalKey = (origin: string, deviceId: string) => `household.arrivals:${origin}:${deviceId}`
export function browserArrivalPermission() { return typeof Notification === 'undefined' ? 'unavailable' : Notification.permission }
export function browserArrivalsEnabled(key: string) { return localStorage.getItem(`${key}:enabled`) === 'true' }
export async function enableBrowserArrivals(key: string, enabled: boolean) {
  if (!enabled) { localStorage.setItem(`${key}:enabled`,'false'); return }
  if (!window.isSecureContext || !('serviceWorker' in navigator) || typeof Notification === 'undefined') throw new Error('Notifications need HTTPS and a browser with service worker notifications.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications are not allowed. For you still works; allow notifications in browser settings to retry.')
  await navigator.serviceWorker.register('/sw.js')
  const registration = await navigator.serviceWorker.ready
  if (!registration.showNotification) throw new Error('This browser cannot show arrival notifications.')
  localStorage.setItem(`${key}:enabled`,'true')
}
const sequence = (value: string) => typeof value==='string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n
export async function processArrivals(api: ApiClient, deviceId: string, key: string, show: (title: string, options: NotificationOptions) => Promise<void>, active: () => boolean) {
  const saved = localStorage.getItem(`${key}:cursor`)
  let after = saved && sequence(saved) ? saved : undefined
  for (let pageIndex = 0; pageIndex < 10 && active(); pageIndex++) {
    const page: ArrivalPage = await api.arrivals(deviceId,after)
    if (!sequence(page.nextCursor) || !sequence(page.ackCursor) || !Array.isArray(page.notifications) || page.notifications.length > 50) throw new Error('Invalid arrival response.')
    let previous = after || page.ackCursor
    for (const row of page.notifications) {
      if (!sequence(row.sequence) || BigInt(row.sequence) <= BigInt(previous) || !validItemId(row.itemId)) throw new Error('Invalid arrival response.')
      previous = row.sequence
    }
    if (page.nextCursor !== previous) throw new Error('Invalid arrival cursor.')
    const latest=page.notifications.at(-1)
    if(latest){
      if (!active()) return
      // Batch catch-up into one generic banner; all items remain in For you.
      await show('Drop', {body:'New share available',tag:`${key}:${latest.sequence}`,data:{itemId:latest.itemId},icon:'/icon-192.png'})
      // OS posting and local persistence are not atomic; stable tags reduce duplicate banners after a crash.
      localStorage.setItem(`${key}:cursor`,page.nextCursor)
    }
    if (!active()) return
    await api.acknowledge(deviceId,page.nextCursor)
    localStorage.setItem(`${key}:cursor`,page.nextCursor)
    after = page.nextCursor
    if (!page.hasMore) return
  }
}
export class BrowserArrivals {
  private stopped = false
  private running = false
  constructor(private api: ApiClient, private deviceId: string, private onError: (message: string) => void) {}
  stop() { this.stopped = true }
  async check() {
    if (this.running || this.stopped) return
    this.running = true
    const key = arrivalKey(this.api.baseURL,this.deviceId)
    const active = () => !this.stopped && browserArrivalsEnabled(key) && browserArrivalPermission() === 'granted'
    const process = async () => {
      if (!active()) return
      const registration = await navigator.serviceWorker.ready
      await processArrivals(this.api,this.deviceId,key,(title,options) => registration.showNotification(title,options),active)
    }
    try {
      if (!active()) return
      if (navigator.locks) await navigator.locks.request(key,{ifAvailable:true},async lock => { if (lock) await process() })
      else {
        const owner = crypto.randomUUID(); let owned = true
        const lease = () => deviceRecord<{owner:string;expires:number}>(`lease:${key}`, prior => !prior || prior.expires < Date.now() || prior.owner === owner ? {owner,expires:Date.now()+30_000} : prior)
        if ((await lease()).owner !== owner) return
        const renew = setInterval(() => { void lease().then(value => { if (value.owner !== owner) owned=false }).catch(() => {owned=false}) },5000)
        try { if (owned) await processArrivals(this.api,this.deviceId,key,async(title,options) => { if (!owned) throw new Error('Arrival ownership changed; retrying later.'); const registration=await navigator.serviceWorker.ready; await registration.showNotification(title,options) },() => owned && active()) }
        finally { clearInterval(renew); await deviceRecord<{owner:string;expires:number}>(`lease:${key}`,prior => prior?.owner === owner ? {owner,expires:0} : prior!) }
      }
      if (!this.stopped) this.onError('')
    } catch (error) { if (!this.stopped) this.onError(error instanceof Error ? error.message : 'Arrivals could not be checked. Retry while online.') }
    finally { this.running = false }
  }
}
