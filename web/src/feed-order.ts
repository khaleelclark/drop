import type { Item } from './types'

// Keep sub-millisecond server timestamps and ID tie breaks intact.
function key(item: Item) { return item.createdAt.replace(/(?:\.(\d+))?Z$/, (_match, fraction: string | undefined) => `.${(fraction || '').padEnd(9, '0')}Z`) + ':' + item.id }
export function compareShares(a: Item, b: Item) { return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0 }
export function chronological(items: Item[]) { return [...items].sort(compareShares) }
