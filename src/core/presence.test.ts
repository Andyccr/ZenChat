import { describe, expect, it } from 'vitest'
import { Presence } from './presence'
import { createMemoryRuntime } from './runtime'

describe('Presence', () => {
  it('upserts members, tracks typing until TTL, and reports RTT', () => {
    const clock = createMemoryRuntime(1_000)
    const ended: string[] = []
    const presence = new Presence(clock.runtime, (id) => ended.push(id), 100)

    presence.upsert('p1', '访客')
    presence.upsert('p1', '晚风')
    expect(presence.list()).toEqual([
      expect.objectContaining({ id: 'p1', nick: '晚风', typing: false, rttMs: null }),
    ])

    expect(presence.markTyping('p1')).toBe(true)
    expect(presence.list()[0]?.typing).toBe(true)
    clock.advance(99)
    expect(presence.list()[0]?.typing).toBe(true)
    clock.advance(1)
    expect(presence.list()[0]?.typing).toBe(false)
    expect(ended).toEqual(['p1'])

    expect(presence.setRtt('p1', 18)).toBe(true)
    expect(presence.remove('p1')?.nick).toBe('晚风')
    expect(presence.list()).toEqual([])
  })
})
