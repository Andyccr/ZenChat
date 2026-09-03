import { beforeEach, describe, expect, it } from 'vitest'
import { RoomManager } from './room-manager'
import { createMemoryRuntime } from './runtime'
import { FakeTransport } from './transports/fake'
import type { ChatLine } from './types'

const identity = { id: 'local', nick: '晚风' }

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: memoryStorage() })
})

function manager() {
  const clock = createMemoryRuntime()
  const created: FakeTransport[] = []
  const resets: ChatLine[][] = []
  const rm = new RoomManager(
    identity,
    { onReset: (lines) => resets.push(lines) },
    {
      runtime: clock.runtime,
      createTransport: (strategy) => {
        const fake = new FakeTransport(strategy)
        created.push(fake)
        return fake
      },
    },
  )
  return { rm, created, resets }
}

describe('RoomManager', () => {
  it('reuses the live session for the same room', async () => {
    const { rm } = manager()
    const spec = { name: 'lobby', password: '', strategy: 'torrent' as const }
    const first = await rm.open(spec)
    const second = await rm.open(spec)
    expect(second).toBe(first)
    expect(rm.getSession()?.isJoined()).toBe(true)
  })

  it('retries after a failed join instead of sticking on the dead session', async () => {
    const clock = createMemoryRuntime()
    let fail = true
    const rm = new RoomManager(identity, {}, {
      runtime: clock.runtime,
      createTransport: () => {
        const fake = new FakeTransport()
        if (fail) fake.failJoin = new Error('offline')
        return fake
      },
    })
    const spec = { name: 'lobby', password: '', strategy: 'torrent' as const }
    await expect(rm.open(spec)).rejects.toThrow('offline')
    expect(rm.getSession()?.isJoined()).toBe(false)
    fail = false
    await rm.open(spec)
    expect(rm.getSession()?.isJoined()).toBe(true)
  })

  it('drops a superseded join when switching rooms mid-handshake', async () => {
    const clock = createMemoryRuntime()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let builds = 0
    const rm = new RoomManager(identity, {}, {
      runtime: clock.runtime,
      createTransport: (strategy) => {
        const fake = new FakeTransport(strategy)
        builds += 1
        if (builds === 1) fake.joinGate = gate
        return fake
      },
    })
    const first = rm.open({ name: 'one', password: '', strategy: 'torrent' })
    await Promise.resolve()
    const second = rm.open({ name: 'two', password: '', strategy: 'torrent' })
    release()
    const [stale, live] = await Promise.all([first, second])
    expect(stale).toBeNull()
    expect(live?.isJoined()).toBe(true)
    expect(rm.current()?.name).toBe('two')
  })
})
