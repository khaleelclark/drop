import { describe, it, expect } from 'vitest'
import { chronological } from './feed-order'
import type { Item } from './types'
const item = (id: string, createdAt: string, name = id): Item => ({ id, createdAt, name, updatedAt: createdAt, kind: 'text', status: 'ready', size: 1, pinned: false })
describe('chronological loaded feed', () => {
  it('orders nanoseconds and equal-time IDs without mutating server pages', () => {
    const page = [item('z', '2026-10-24T12:00:00.000000002Z'), item('b', '2026-10-24T12:00:00Z'), item('a', '2026-10-24T12:00:00.000000000Z')]
    expect(chronological(page).map(row => row.id)).toEqual(['a', 'b', 'z'])
    expect(page[0].id).toBe('z')
  })
  it('preserves timestamp order beyond millisecond ties and puts new arrivals last', () => {
    const page=[item('old','2026-10-23T23:59:59.999999999Z'),item('same','2026-10-24T00:00:00Z'),item('new','2026-10-24T00:00:00.000000001Z')]
    expect(chronological([page[2],page[0],page[1]]).map(row=>row.id)).toEqual(['old','same','new'])
  })
})
