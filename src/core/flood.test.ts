import { describe, expect, it } from 'vitest'
import { FloodGate } from './flood'

describe('FloodGate', () => {
  it('allows a burst up to the limit, then rejects until the window slides', () => {
    const gate = new FloodGate()
    expect(gate.allow('peer-a:chat', 1000, 2, 100)).toBe(true)
    expect(gate.allow('peer-a:chat', 1010, 2, 100)).toBe(true)
    expect(gate.allow('peer-a:chat', 1020, 2, 100)).toBe(false)
    expect(gate.allow('peer-b:chat', 1020, 2, 100)).toBe(true)
    expect(gate.allow('peer-a:chat', 1110, 2, 100)).toBe(true)
  })

  it('clears tracked hits', () => {
    const gate = new FloodGate()
    gate.allow('peer-a:chat', 1, 1, 100)
    expect(gate.allow('peer-a:chat', 2, 1, 100)).toBe(false)
    gate.clear()
    expect(gate.allow('peer-a:chat', 3, 1, 100)).toBe(true)
  })
})
