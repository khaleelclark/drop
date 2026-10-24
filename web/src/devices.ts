import type { Device, SendRouting } from './types'
export const validDeviceId = (id: string) => typeof id==='string' && /^[a-f0-9]{32}$/.test(id)
export const validItemId = (id: string) => typeof id==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)

// A read/write transaction makes first registration and fallback notifier leases atomic across tabs.
export function deviceRecord<T>(key: string, update: (previous: T | undefined) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('household.devices.v1', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('state')
    open.onerror = () => reject(new Error('Device storage is unavailable. Allow browser storage and retry.'))
    open.onblocked = () => reject(new Error('Device storage is busy. Close older Drop tabs and retry.'))
    open.onsuccess = () => {
      const db = open.result; const transaction = db.transaction('state', 'readwrite'); const store = transaction.objectStore('state')
      let value: T
      const request = store.get(key)
      request.onsuccess = () => { try { value = update(request.result); store.put(value, key) } catch { transaction.abort() } }
      transaction.oncomplete = () => { db.close(); resolve(value) }
      transaction.onabort = transaction.onerror = () => { db.close(); reject(new Error('Device storage could not be saved. Allow browser storage and retry.')) }
    }
  })
}
export async function browserDeviceId(origin: string): Promise<string> {
  return deviceRecord<string>(`identity:${new URL(origin).origin}`, previous => {
    if (previous && validDeviceId(previous)) return previous
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2,'0')).join('')
  })
}
export function sendRouting(sourceDeviceId: string, targets: string[], devices: Device[]): SendRouting {
  if (!validDeviceId(sourceDeviceId)) throw new Error('Wait for this device to register before sending.')
  if (targets.length > 64 || new Set(targets).size !== targets.length || targets.some(id => !validDeviceId(id) || id === sourceDeviceId || !devices.some(device => device.id === id))) throw new Error('A selected device is no longer available. Choose recipients again.')
  return {sourceDeviceId,targetDeviceIds:[...targets]}
}
