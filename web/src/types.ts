export interface Item {
  id: string; kind: 'text' | 'file'; name: string; size: number;
  createdAt: string; updatedAt: string; status: 'uploading' | 'ready' | 'failed';
  preview?: string; pinned: boolean; sourceDevice?: string; mimeType?: string;
}
export interface FeedPage { items: Item[]; nextCursor: string | null }
export interface StorageInfo { usedBytes: number; freeBytes: number; maxFileBytes: number; maxTextBytes: number; maxStorageBytes: number | null }
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const unit = Math.min(Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1024)), 4)
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit > 0 ? 1 : 0 })} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]}`
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'
