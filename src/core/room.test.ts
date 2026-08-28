import { describe, expect, it } from 'vitest'
import { sameRoom, sessionKey } from './room'

describe('room identity', () => {
  it('treats the same name, strategy and password as one room', () => {
    const a = { name: '茶 室', password: '密', strategy: 'torrent' as const }
    const b = { name: '茶-室', password: '密', strategy: 'torrent' as const }
    expect(sameRoom(a, b)).toBe(true)
    expect(sessionKey(a)).not.toBe(sessionKey({ ...a, password: '' }))
  })
})
