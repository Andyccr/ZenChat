import { describe, expect, it } from 'vitest'
import { isStamp } from '../ui/stickers'

describe('stamps', () => {
  it('recognizes curated kaomoji and emoji', () => {
    expect(isStamp('(´・ω・`)')).toBe(true)
    expect(isStamp('🍵')).toBe(true)
    expect(isStamp('hello world')).toBe(false)
  })
})
