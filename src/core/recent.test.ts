import { beforeEach, describe, expect, it } from 'vitest'
import { loadRecentRooms, rememberRoom } from './recent'

beforeEach(() => {
  const memory = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
    },
  })
})

describe('recent rooms', () => {
  it('dedupes by strategy and name, keeping the latest visit first', () => {
    rememberRoom({ name: 'lobby', password: 'x', strategy: 'torrent' })
    rememberRoom({ name: 'other', password: '', strategy: 'nostr' })
    rememberRoom({ name: 'lobby', password: '', strategy: 'torrent' })
    const list = loadRecentRooms()
    expect(list[0]).toMatchObject({ name: 'lobby', strategy: 'torrent', hasPassword: false })
    expect(list).toHaveLength(2)
  })
})
