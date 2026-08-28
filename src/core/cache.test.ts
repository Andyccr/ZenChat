import { beforeEach, describe, expect, it } from 'vitest'
import { loadRoomLog, saveRoomLog } from './cache'

const memory = new Map<string, string>()

beforeEach(() => {
  memory.clear()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
    },
  })
})

describe('room log cache', () => {
  it('round-trips chat lines in sessionStorage', () => {
    const spec = { name: 'lobby', password: '', strategy: 'torrent' as const }
    const lines = [
      { kind: 'system' as const, id: 's1', text: 'joined', ts: 1 },
      { kind: 'chat' as const, id: 'c1', fromId: 'me', nick: '晚风', text: 'hi', ts: 2, self: true },
    ]
    saveRoomLog(spec, lines)
    expect(loadRoomLog(spec)).toEqual(lines)
  })
})
