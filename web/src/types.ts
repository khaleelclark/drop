export interface Item {
  id: string; kind: 'text' | 'file'; name: string; size: number;
  createdAt: string; updatedAt: string; status: 'uploading' | 'ready' | 'failed';
  preview?: string; pinned: boolean; sourceDevice?: string; mimeType?: string;
  sourceDeviceId?: string; targetDeviceIds?: string[]; deletedAt?: string;
}
export type DevicePlatform = 'macos' | 'linux' | 'android' | 'browser'
export interface Device { id: string; label: string; platform: DevicePlatform; createdAt: string }
export interface SendRouting { sourceDeviceId: string; targetDeviceIds: string[] }
export interface ArrivalSettings { enabled: boolean; permission: 'granted'|'denied'|'prompt'|'unknown'|'unavailable'; mode: 'resident'|'scheduled'; lastCheckedAt?: string; lastError?: string }
export interface ArrivalPage { notifications: {sequence: string; itemId: string; createdAt: string}[]; nextCursor: string; ackCursor: string; hasMore: boolean }
export interface FeedPage { items: Item[]; nextCursor: string | null }
export interface StorageInfo { usedBytes: number; freeBytes: number; maxFileBytes: number; maxTextBytes: number; maxStorageBytes: number | null }
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const unit = Math.min(Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1024)), 4)
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit > 0 ? 1 : 0 })} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]}`
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'

export type ItemAction = 'trash' | 'restore' | 'purge'
export type ItemActionResult = {id:string;ok:true} | {id:string;ok:false;error:{status:number;code:string;message:string}}
export interface TrashSettings {retentionDays:number|null}
export interface TrashSummary {count:number;cutoff:string;names:string[]}
export interface TrashPurgePage {results:ItemActionResult[];nextCursor:string|null}
