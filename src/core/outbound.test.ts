import { describe, expect, it } from 'vitest'
import { Outbound } from './outbound'
import { createMemoryRuntime } from './runtime'

describe('Outbound', () => {
  it('expires pending ids but keeps the payload for a late ack or resend', () => {
    const clock = createMemoryRuntime(0)
    const expired: string[] = []
    const outbound = new Outbound<{ text: string }>(clock.runtime, 100, (id) => expired.push(id))
    outbound.expect('msg-1', { text: 'hi' })
    clock.advance(99)
    expect(expired).toEqual([])
    clock.advance(1)
    expect(expired).toEqual(['msg-1'])
    expect(outbound.payload('msg-1')).toEqual({ text: 'hi' })
    expect(outbound.ack('msg-1')).toBe(true)
    expect(outbound.payload('msg-1')).toBeUndefined()
    outbound.dispose()
  })

  it('clears a timer when the ack arrives first', () => {
    const clock = createMemoryRuntime(0)
    const expired: string[] = []
    const outbound = new Outbound(clock.runtime, 100, (id) => expired.push(id))
    outbound.expect('msg-2', { text: 'yo' })
    expect(outbound.ack('msg-2')).toBe(true)
    clock.advance(100)
    expect(expired).toEqual([])
    expect(outbound.payload('msg-2')).toBeUndefined()
    outbound.dispose()
  })

  it('does not expire while the tab is hidden, then settles remaining time on resume', () => {
    const clock = createMemoryRuntime(0)
    const expired: string[] = []
    const outbound = new Outbound(clock.runtime, 100, (id) => expired.push(id))
    outbound.expect('msg-3', { text: 'bg' })
    clock.setHidden(true)
    clock.advance(250)
    expect(expired).toEqual([])
    clock.setHidden(false)
    expect(expired).toEqual(['msg-3'])
    outbound.dispose()
  })

  it('waits for every remaining peer before settling, and drops leavers', () => {
    const clock = createMemoryRuntime(0)
    const expired: string[] = []
    const outbound = new Outbound(clock.runtime, 100, (id) => expired.push(id))
    outbound.expect('msg-q', { text: 'hi' }, ['peer-a', 'peer-b'])
    expect(outbound.ack('msg-q', 'peer-a')).toBe(false)
    expect(outbound.payload('msg-q')).toEqual({ text: 'hi' })
    expect(outbound.dropPeer('peer-b')).toEqual(['msg-q'])
    expect(outbound.payload('msg-q')).toBeUndefined()
    expect(expired).toEqual([])
    outbound.dispose()
  })

  it('does not mark delivered if every waiter leaves without acking', () => {
    const clock = createMemoryRuntime(0)
    const expired: string[] = []
    const outbound = new Outbound(clock.runtime, 100, (id) => expired.push(id))
    outbound.expect('msg-q2', { text: 'hi' }, ['peer-a'])
    expect(outbound.dropPeer('peer-a')).toEqual([])
    clock.advance(100)
    expect(expired).toEqual(['msg-q2'])
    outbound.dispose()
  })
})
