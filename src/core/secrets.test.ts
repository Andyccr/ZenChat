import { beforeEach, describe, expect, it } from 'vitest'
import { recallSecret, rememberSecret, withSecret } from './secrets'

beforeEach(() => {
  const memory = new Map<string, string>()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
      removeItem: (key: string) => {
        memory.delete(key)
      },
    },
  })
})

describe('room secrets', () => {
  it('recalls a password for the same room and strategy', () => {
    const spec = { name: '茶 室', password: '密', strategy: 'torrent' as const }
    rememberSecret(spec)
    expect(recallSecret({ name: '茶-室', strategy: 'torrent' })).toBe('密')
    expect(withSecret({ name: '茶-室', password: '', strategy: 'torrent' }).password).toBe('密')
  })

  it('does not leak a password across strategies', () => {
    rememberSecret({ name: 'lobby', password: 'x', strategy: 'torrent' })
    expect(recallSecret({ name: 'lobby', strategy: 'nostr' })).toBe('')
  })
})
