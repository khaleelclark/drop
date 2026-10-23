import { DetailedError, Upload, type UploadOptions } from 'tus-js-client'
import { createSHA256 } from 'hash-wasm'
import { errorMessage } from './types'
import type { SendRouting } from './types'
export type TransferState = 'queued' | 'checking' | 'uploading' | 'paused' | 'needs-file' | 'failed' | 'complete' | 'cancelling'
export interface Transfer {
  id: string; direction?: 'upload' | 'download'; name: string; size: number; lastModified: number; kind: 'file' | 'text'; sourceDevice: string;
  destination: string; state: TransferState; confirmed: number; sent: number;
  phase?: string; hash?: string; uploadURL?: string; itemId?: string; error?: string; checked?: number;
  sourceDeviceId?: string; targetDeviceIds?: string[];
}
export interface TransferStore {
  getSnapshot(): Transfer[];
  subscribe(listener: () => void): () => void;
  enqueue(files: File[], kind: 'file' | 'text', sourceDevice: string, maxBytes: number, routing?: SendRouting): void;
  pause(id: string): Promise<void>;
  resume(id: string): void;
  cancel(id: string): Promise<void>;
  reattach(id: string, file: File): Promise<void>;
  clearCompleted(): void;
  reselect?(id: string): Promise<void>;
}
export type UploadLike = Pick<Upload, 'start' | 'abort' | 'url'>
export type UploadFactory = (file: File, options: UploadOptions) => UploadLike
const STORAGE_KEY = 'household.transfers.v1'
const CHUNK = 8 * 1024 * 1024
export function safeUploadURL(url: string, destination: string) {
  const parsed = new URL(url, destination)
  if (parsed.origin !== new URL(destination).origin || !/^\/api\/uploads\/[^/]+\/?$/.test(parsed.pathname) || parsed.search || parsed.hash || parsed.username || parsed.password) throw new Error('The saved upload URL does not belong to this server.')
  return parsed.href
}
// Incremental SHA-256 verifies the entire reselected source, including changes in the middle.
// Only one bounded slice is read at a time; the source is never loaded as a whole-file buffer.
export async function hashFile(file: File, progress: (bytes: number) => void, active: () => boolean): Promise<string> {
  const hasher = await createSHA256(); hasher.init()
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    if (!active()) throw new DOMException('Source check paused', 'AbortError')
    hasher.update(new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer()))
    progress(Math.min(offset + CHUNK, file.size))
  }
  if (!active()) throw new DOMException('Source check paused', 'AbortError')
  return hasher.digest('hex')
}
export class BrowserTransfers implements TransferStore {
  private rows: Transfer[] = []
  private listeners = new Set<() => void>()
  private files = new Map<string, File>()
  private uploads = new Map<string, UploadLike>()
  private running = new Set<string>()
  private storageWarning = false
  constructor(private destination: string, private changed: () => void = () => {}, private factory: UploadFactory = (file, opts) => new Upload(file, opts)) {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
      if (Array.isArray(saved)) this.rows = saved.filter((r: Transfer) => r.destination === destination && typeof r.id === 'string' && typeof r.name === 'string' && Number.isSafeInteger(r.size) && r.size >= 0 && r.state !== 'complete').slice(0, 200).map((r: Transfer) => ({ ...r, state: 'needs-file', sent: r.confirmed || 0, error: undefined }))
    } catch { this.storageWarning = true }
  }
  getSnapshot = () => this.rows
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private notify() {
    try {
      // Preserve saved entries for other explicitly selected servers.
      const stored: Transfer[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...stored.filter(r => r.destination !== this.destination), ...this.rows.filter(r => r.state !== 'complete')]))
    } catch {
      this.storageWarning = true
      this.rows = this.rows.map(row => row.state === 'complete' || row.error ? row : {...row,error:'Browser storage is unavailable; keep this tab open to retain progress.'})
    }
    this.listeners.forEach(fn => fn())
  }
  private patch(id: string, patch: Partial<Transfer>) { this.rows = this.rows.map(r => r.id === id ? { ...r, ...patch } : r); this.notify() }
  enqueue(files: File[], kind: 'file' | 'text', sourceDevice: string, maxBytes: number, routing?: SendRouting) {
    const savedRouting = routing ? {sourceDeviceId:routing.sourceDeviceId,targetDeviceIds:[...routing.targetDeviceIds]} : {}
    const additions = files.map(file => {
      const id = crypto.randomUUID(); this.files.set(id, file)
      return { id, name: file.name, size: file.size, lastModified: file.lastModified, kind, sourceDevice, ...savedRouting, destination: this.destination, state: file.size > maxBytes ? 'failed' as const : 'queued' as const, confirmed: 0, sent: 0, error: file.size > maxBytes ? 'This file exceeds the server’s per-file limit.' : this.storageWarning ? 'Browser storage is unavailable; keep this tab open to retain progress.' : undefined }
    })
    this.rows = [...this.rows, ...additions]; this.notify(); this.schedule()
  }
  private schedule() {
    for (const row of this.rows) {
      if (this.running.size >= 2) break
      if (row.state === 'queued' && !this.running.has(row.id)) { this.running.add(row.id); void this.start(row.id) }
    }
  }
  private release(id: string) { this.running.delete(id); this.schedule() }
  private async start(id: string) {
    const initial = this.rows.find(r => r.id === id); const file = this.files.get(id)
    if (!initial || !file) { this.patch(id, { state: 'needs-file' }); this.release(id); return }
    try {
      if (!initial.hash || initial.state === 'queued') {
        this.patch(id, { state: 'checking', checked: 0, error: undefined })
        const digest = await hashFile(file, checked => this.patch(id, { checked }), () => this.rows.find(r => r.id === id)?.state === 'checking')
        if (initial.hash && digest !== initial.hash) throw new Error('This file’s bytes differ from the original. Select the original file, or cancel and send this as a new file.')
        this.patch(id, { hash: digest })
      }
      const row = this.rows.find(r => r.id === id)
      if (!row || row.state !== 'checking') { this.release(id); return }
      this.patch(id, { state: 'uploading', error: undefined })
      const options: UploadOptions = {
        endpoint: `${this.destination}/api/uploads/`, chunkSize: CHUNK,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        // Creating a new item is not idempotent if its response is lost.
        onShouldRetry: error => error.originalRequest?.getMethod() !== 'POST' && (!error.originalResponse || [0,408,409,423,429].includes(error.originalResponse.getStatus()) || error.originalResponse.getStatus() >= 500),
        storeFingerprintForResuming: false,
        uploadUrl: row.uploadURL ? safeUploadURL(row.uploadURL, this.destination) : undefined,
        metadata: { filename: file.name, filetype: row.kind === 'text' ? 'text/plain' : (file.type || 'application/octet-stream'), kind: row.kind, sourceDevice: row.sourceDevice, ...(row.sourceDeviceId ? {sourceDeviceId:row.sourceDeviceId,targetDeviceIds:JSON.stringify(row.targetDeviceIds || [])} : {}) },
        onBeforeRequest: request => { const xhr = request.getUnderlyingObject(); if (xhr && 'withCredentials' in xhr) xhr.withCredentials = true },
        onAfterResponse: (_request, response) => {
          const itemId = response.getHeader('X-Item-ID'); const upload = this.uploads.get(id)
          this.patch(id, { ...(itemId ? { itemId } : {}), ...(upload?.url ? { uploadURL: safeUploadURL(upload.url, this.destination) } : {}) })
        },
        onUploadUrlAvailable: () => { const url = this.uploads.get(id)?.url; if (url) this.patch(id, { uploadURL: safeUploadURL(url, this.destination) }) },
        onProgress: sent => { if (this.rows.find(r => r.id === id)?.state === 'uploading') this.patch(id, { sent }) },
        onChunkComplete: (_chunk, confirmed) => this.patch(id, { confirmed }),
        onError: error => { this.patch(id, { state: 'failed', error: errorMessage(error) }); this.release(id) },
        onSuccess: () => { this.patch(id, { state: 'complete', confirmed: file.size, sent: file.size }); this.files.delete(id); this.uploads.delete(id); this.changed(); this.release(id) },
      }
      const upload = this.factory(file, options); this.uploads.set(id, upload); upload.start()
    } catch (error) {
      if (this.rows.find(r => r.id === id)?.state === 'checking' || this.rows.find(r => r.id === id)?.state === 'uploading') this.patch(id, { state: 'failed', error: errorMessage(error) })
      this.release(id)
    }
  }
  async pause(id: string) {
    const row = this.rows.find(r => r.id === id); if (!row || !['queued', 'checking', 'uploading'].includes(row.state)) return
    this.patch(id, { state: 'paused', sent: row.confirmed })
    await this.uploads.get(id)?.abort(false)
    this.uploads.delete(id)
    // Hashing releases its slot after the current bounded read returns.
    if (row.state !== 'checking') this.release(id)
  }
  resume(id: string) {
    const row = this.rows.find(r => r.id === id); if (!row || !['paused', 'failed'].includes(row.state)) return
    if (!this.files.has(id)) { this.patch(id, { state: 'needs-file' }); return }
    this.patch(id, { state: 'queued', error: undefined }); this.schedule()
  }
  async reattach(id: string, file: File) {
    const row = this.rows.find(r => r.id === id); if (!row || !['needs-file', 'failed', 'paused'].includes(row.state)) return
    if (file.name !== row.name || file.size !== row.size || file.lastModified !== row.lastModified) throw new Error('Choose the original file: name, size, and modified time must match.')
    this.files.set(id, file); this.patch(id, { state: 'queued', error: undefined }); this.schedule()
  }
  async cancel(id: string) {
    const row = this.rows.find(r => r.id === id); if (!row) return
    this.patch(id, { state: 'cancelling' })
    try {
      const active = this.uploads.get(id)
      if (active) {
        try { await active.abort(true) }
        catch (error) {
          const status = error instanceof DetailedError ? error.originalResponse?.getStatus() : undefined
          if (status !== 404 && status !== 410) throw error
        }
      }
      else if (row.uploadURL) {
        const response = await fetch(safeUploadURL(row.uploadURL, this.destination), { method: 'DELETE', headers: { 'Tus-Resumable': '1.0.0' }, credentials: 'include' })
        if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error('Could not cancel on the server. Retry when connected.')
      }
      this.rows = this.rows.filter(r => r.id !== id); this.files.delete(id); this.uploads.delete(id); this.notify(); this.changed()
    } catch (error) { this.patch(id, { state: 'failed', error: errorMessage(error) }); throw error }
    finally { if (row.state !== 'checking') this.release(id) }
  }
  clearCompleted() { this.rows = this.rows.filter(r => r.state !== 'complete'); this.notify() }
}
