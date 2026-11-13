import { describe, expect, it } from 'vitest'
import { formatUnreadTitle, shouldCountUnread } from './unread'

describe('unread title', () => {
  it('prefixes the base title once messages arrive in the background', () => {
    expect(formatUnreadTitle('禅聊 ZenChat', 0)).toBe('禅聊 ZenChat')
    expect(formatUnreadTitle('禅聊 ZenChat', 3)).toBe('(3) 禅聊 ZenChat')
    expect(formatUnreadTitle('禅聊 ZenChat', 120)).toBe('(99+) 禅聊 ZenChat')
  })

  it('counts only remote chat while the tab is hidden', () => {
    expect(shouldCountUnread({ kind: 'chat', self: false }, true)).toBe(true)
    expect(shouldCountUnread({ kind: 'chat', self: true }, true)).toBe(false)
    expect(shouldCountUnread({ kind: 'chat', self: false }, false)).toBe(false)
    expect(shouldCountUnread({ kind: 'system' }, true)).toBe(false)
  })
})
