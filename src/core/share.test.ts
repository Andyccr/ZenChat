import { describe, expect, it } from 'vitest'
import { roomUrl } from './share'

describe('roomUrl', () => {
  it('omits the password unless asked', () => {
    const spec = { name: '禅', password: 'secret', strategy: 'nostr' as const }
    expect(roomUrl('https://example.com', '/ZenChat/', spec)).toBe('https://example.com/ZenChat/#/r/%E7%A6%85?s=nostr')
    expect(roomUrl('https://example.com', '/ZenChat/', spec, true)).toBe(
      'https://example.com/ZenChat/#/r/%E7%A6%85?s=nostr&k=secret',
    )
  })
})
