import { describe, expect, it } from 'vitest'
import { cycleTheme, resolveTheme } from '../ui/theme'

describe('theme', () => {
  it('cycles system → light → dark → system', () => {
    expect(cycleTheme('system')).toBe('light')
    expect(cycleTheme('light')).toBe('dark')
    expect(cycleTheme('dark')).toBe('system')
  })

  it('resolves system preference from the OS', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
  })
})
