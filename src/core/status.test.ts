import { describe, expect, it } from 'vitest'
import { relaysAreDown, waitingOrDown } from './status'

describe('connection health', () => {
  it('treats a non-empty all-closed relay list as down', () => {
    expect(relaysAreDown([])).toBe(false)
    expect(relaysAreDown([{ url: 'wss://t', readyState: 3 }])).toBe(true)
    expect(waitingOrDown('torrent', [{ url: 'wss://t', readyState: 3 }])).toMatchObject({
      phase: 'error',
      detail: 'Tracker 连不上，可改用 Nostr',
    })
  })
})
