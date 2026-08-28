import { describe, expect, it } from 'vitest'
import { parseHash, toHash } from './router'
import { normalizeRoomName, roomNamespace } from './room'

describe('room routing', () => {
  it('normalizes room names', () => {
    expect(normalizeRoomName('  茶 室  ')).toBe('茶-室')
    expect(normalizeRoomName('a/b?c')).toBe('abc')
  })

  it('salts the swarm id with a password', () => {
    expect(roomNamespace({ name: 'lobby', password: '' })).toBe('lobby')
    expect(roomNamespace({ name: 'lobby', password: '密' })).toBe('lobby::密')
  })

  it('round-trips room hashes without leaking the password by default', () => {
    const route = parseHash('#/r/%E7%A6%85?s=nostr&k=secret')
    expect(route).toEqual({
      name: 'room',
      spec: { name: '禅', password: 'secret', strategy: 'nostr' },
    })
    expect(toHash(route)).toBe('#/r/%E7%A6%85?s=nostr')
    expect(toHash(route, true)).toBe('#/r/%E7%A6%85?s=nostr&k=secret')
  })

  it('falls back to lobby for empty or unknown hashes', () => {
    expect(parseHash('')).toEqual({ name: 'lobby' })
    expect(parseHash('#/nope')).toEqual({ name: 'lobby' })
  })
})
