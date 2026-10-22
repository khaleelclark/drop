import type { FeedPage, Item, StorageInfo } from './types'
export const COPY_LIMIT = 8 * 1024 * 1024
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
  list(query = '', before?: string) {
    const params = new URLSearchParams({ limit: '50' }); if (query) params.set('q', query); if (before) params.set('before', before)
    return this.json<FeedPage>(`/items?${params}`)
  }
  storage() { return this.json<StorageInfo>('/storage') }
  createText(text: string, sourceDevice: string) { return this.json<{item: Item}>('/text', { method: 'POST', body: JSON.stringify({ text, sourceDevice }) }) }
  pin(id: string, pinned: boolean) { return this.json<{item: Item}>(`/items/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ pinned }) }) }
  delete(id: string) { return this.response(`/items/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  downloadURL(id: string) { return this.url(`/items/${encodeURIComponent(id)}/download`) }
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
