import { describe, expect, it } from 'vitest'
import { Outbound } from './outbound'
import { createMemoryRuntime } from './runtime'

describe('Outbound', () => {
  it('expires pending ids and ignores a late ack', () => {
    const clock = createMemoryRuntime(0)
    const expired: string[] = []
    const outbound = new Outbound(clock.runtime, 100, (id) => expired.push(id))
    outbound.expect('msg-1')
    clock.advance(99)
    expect(expired).toEqual([])
    clock.advance(1)
    expect(expired).toEqual(['msg-1'])
    expect(outbound.ack('msg-1')).toBe(false)
  })

  it('clears a timer when the ack arrives first', () => {
    const clock = createMemoryRuntime(0)
    const expired: string[] = []
    const outbound = new Outbound(clock.runtime, 100, (id) => expired.push(id))
    outbound.expect('msg-2')
    expect(outbound.ack('msg-2')).toBe(true)
    clock.advance(100)
    expect(expired).toEqual([])
  })
})
