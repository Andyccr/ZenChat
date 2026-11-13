import { describe, expect, it } from 'vitest'
import { isNearBottom } from './scroll'

describe('isNearBottom', () => {
  it('is true at the bottom and false after scrolling up', () => {
    expect(isNearBottom(904, 1000, 80)).toBe(true)
    expect(isNearBottom(0, 1000, 80)).toBe(false)
    expect(isNearBottom(800, 1000, 80, 96)).toBe(false)
  })
})
