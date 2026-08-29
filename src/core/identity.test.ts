import { describe, expect, it } from 'vitest'
import { colorFromId, defaultNick, sanitizeNick } from './identity'

describe('identity helpers', () => {
  it('strips control characters and caps length', () => {
    expect(sanitizeNick('  青\u0000石  ')).toBe('青石')
    expect(sanitizeNick('x'.repeat(40)).length).toBe(24)
  })

  it('maps ids to a stable fallback nick and earth-tone color', () => {
    expect(defaultNick('abcd')).toBe(defaultNick('abcd'))
    expect(colorFromId('peer-a')).toMatch(/^#[0-9a-f]{6}$/)
    expect(colorFromId('peer-a')).toBe(colorFromId('peer-a'))
    expect(new Set(['peer-a', 'peer-b', 'peer-c', 'peer-d', 'peer-e'].map(colorFromId)).size).toBeGreaterThan(1)
  })
})
