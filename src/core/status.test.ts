import { describe, expect, it } from 'vitest'
import { idleLife, reduceLife } from './session-machine'
import { deriveStatus, relaysAreDown, sameStatus, waitingOrDown } from './status'

describe('connection health', () => {
  it('treats a non-empty all-closed relay list as down', () => {
    expect(relaysAreDown([])).toBe(false)
    expect(relaysAreDown([{ url: 'wss://t', readyState: 3 }])).toBe(true)
    expect(waitingOrDown('torrent', [{ url: 'wss://t', readyState: 3 }])).toMatchObject({
      phase: 'error',
      detail: 'Tracker 连不上，可改用 Nostr',
    })
  })

  it('derives waiting, live, and relay-down copy from the life machine', () => {
    let life = reduceLife(idleLife(), { type: 'join' })
    expect(deriveStatus({ life, strategy: 'torrent', peerCount: 0, relays: [] })).toMatchObject({
      phase: 'connecting',
      detail: '正在连接 Tracker…',
    })

    life = reduceLife(life, { type: 'join_ok' })
    expect(deriveStatus({ life, strategy: 'torrent', peerCount: 0, relays: [] })).toMatchObject({
      phase: 'connecting',
      detail: '还没有同伴，把链接发给对方',
    })

    life = reduceLife(life, { type: 'peers', count: 1 })
    expect(deriveStatus({ life, strategy: 'torrent', peerCount: 1, relays: [] })).toMatchObject({
      phase: 'connected',
      detail: '已直连 1 人',
    })

    life = reduceLife(life, { type: 'peers', count: 0 })
    life = reduceLife(life, { type: 'force_down' })
    expect(deriveStatus({ life, strategy: 'torrent', peerCount: 0, relays: [] })).toMatchObject({
      phase: 'error',
      detail: 'Tracker 连不上，可改用 Nostr',
    })

    const failed = reduceLife(reduceLife(idleLife(), { type: 'join' }), { type: 'join_err' })
    expect(deriveStatus({ life: failed, strategy: 'torrent', peerCount: 0, relays: [] })).toBeNull()
  })

  it('treats identical statuses as unchanged', () => {
    const status = { phase: 'connected' as const, detail: '已直连 1 人', relays: [{ url: 'wss://t', readyState: 1 }], peerCount: 1 }
    expect(sameStatus(status, { ...status, relays: [{ url: 'wss://t', readyState: 1 }] })).toBe(true)
    expect(sameStatus(status, { ...status, peerCount: 2 })).toBe(false)
  })
})
