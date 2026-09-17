import { beforeEach, describe, expect, it } from 'vitest'
import { loadRecentRooms, rememberRoom, specFromRecent } from './recent'

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
  const session = new Map<string, string>()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => {
        session.set(key, value)
      },
      removeItem: (key: string) => {
        session.delete(key)
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

  it('stores a canonical room name', () => {
    rememberRoom({ name: '  茶 室  ', password: '', strategy: 'torrent' })
    expect(loadRecentRooms()[0]).toMatchObject({ name: '茶-室', strategy: 'torrent' })
  })

  it('asks for a password when a locked recent room has no stored secret', () => {
    rememberRoom({ name: 'vault', password: 'x', strategy: 'torrent' })
    expect(specFromRecent(loadRecentRooms()[0]!)).toBe('need-password')
  })
})
