import { describe, expect, it } from 'vitest'
import { createAckPayload, createHelloPayload, createTypingPayload } from './protocol'
import { createMemoryRuntime } from './runtime'
import { ChatSession } from './session'
import { chatLine } from './transcript'
import { FakeTransport } from './transports/fake'
import type { ChatLine, Member, SessionStatus } from './types'

const identity = { id: 'local', nick: '晚风' }
const spec = { name: '茶室', password: '', strategy: 'torrent' as const }

function harness() {
  const clock = createMemoryRuntime(1_700_000_000_000)
  const created: FakeTransport[] = []
  const lines: ChatLine[] = []
  const members: Member[][] = []
  const statuses: SessionStatus[] = []
  const session = new ChatSession(
    identity,
    {
      onLine: (line) => lines.push(line),
      onMembers: (list) => members.push(list),
      onStatus: (status) => statuses.push(status),
      onReset: () => undefined,
    },
    {
      runtime: clock.runtime,
      createTransport: (strategy) => {
        const fake = new FakeTransport(strategy)
        created.push(fake)
        return fake
      },
    },
  )
  return {
    session,
    clock,
    lines,
    members,
    statuses,
    transport: () => created.at(-1) as FakeTransport,
  }
}

describe('ChatSession', () => {
  it('joins, announces to a peer, and echos a local chat line', async () => {
    const { session, lines, transport, statuses } = harness()
    await session.join(spec)
    expect(session.isJoined()).toBe(true)
    expect(statuses.at(-1)?.detail).toBe('还没有同伴，把链接发给对方')
    expect(transport().sent.some((item) => (item.payload as { type: string }).type === 'hello' && item.target === undefined)).toBe(true)

    transport().peerJoin('peer-aa')
    expect(lines.some((line) => line.kind === 'system' && line.text.includes('加入'))).toBe(true)
    expect(transport().sent.some((item) => (item.payload as { type: string }).type === 'hello' && item.target === 'peer-aa')).toBe(true)

    await session.sendChat('你好')
    const self = lines.find((line) => line.kind === 'chat' && line.self)
    expect(self).toMatchObject({ text: '你好', nick: '晚风' })
    expect(transport().sent.some((item) => (item.payload as { type: string }).type === 'chat')).toBe(true)
  })

  it('acks remote chat and waits for ack-capable peers', async () => {
    const { session, clock, lines, transport } = harness()
    await session.join(spec)
    transport().payload('peer-b', createHelloPayload('青石'))
    const payload = { v: 1, type: 'chat', id: 'aabbccdd12345678', ts: 1, nick: '青石', text: '在吗' }
    transport().payload('peer-b', payload)
    expect(transport().sent.some((item) => (item.payload as { type: string }).type === 'ack' && item.target === 'peer-b')).toBe(true)

    await session.sendChat('回你')
    const pending = [...lines].reverse().find((line) => line.kind === 'chat' && line.self)
    expect(pending).toMatchObject({ delivery: 'pending' })
    transport().payload('peer-b', createAckPayload('青石', pending && pending.kind === 'chat' ? pending.id : ''))
    const acked = [...lines].reverse().find((line) => line.kind === 'chat' && line.self)
    expect(acked).toMatchObject({ delivery: 'acked' })

    await session.sendChat('第二句')
    clock.advance(8000)
    const failed = [...lines].reverse().find((line) => line.kind === 'chat' && line.self)
    expect(failed).toMatchObject({ delivery: 'failed' })
  })

  it('accepts remote chat once and ignores duplicates', async () => {
    const { session, lines, transport } = harness()
    await session.join(spec)
    const payload = { v: 1, type: 'chat', id: 'aabbccdd12345678', ts: 1, nick: '青石', text: '在吗' }
    transport().payload('peer-b', payload)
    transport().payload('peer-b', payload)
    expect(lines.filter((line) => line.kind === 'chat')).toHaveLength(1)
  })

  it('marks typing until the TTL elapses', async () => {
    const { session, clock, members, transport } = harness()
    await session.join(spec)
    transport().payload('peer-c', createTypingPayload('听雨'))
    expect(members.at(-1)?.some((member) => member.id === 'peer-c' && member.typing)).toBe(true)
    clock.advance(2500)
    expect(members.at(-1)?.some((member) => member.id === 'peer-c' && member.typing)).toBe(false)
  })

  it('records an error phase when the transport cannot join', async () => {
    const clock = createMemoryRuntime()
    const statuses: SessionStatus[] = []
    const fake = new FakeTransport()
    fake.failJoin = new Error('tracker down')
    const session = new ChatSession(identity, { onStatus: (status) => statuses.push(status) }, {
      runtime: clock.runtime,
      createTransport: () => fake,
    })
    await expect(session.join(spec)).rejects.toThrow('tracker down')
    expect(session.isJoined()).toBe(false)
    expect(statuses.at(-1)).toMatchObject({ phase: 'error', detail: '无法启动 P2P：tracker down' })
  })

  it('does not send chat after leave', async () => {
    const { session, transport } = harness()
    await session.join(spec)
    await session.leave()
    const sent = transport().sent.length
    expect(await session.sendChat('迟了')).toBe('closed')
    expect(transport().sent).toHaveLength(sent)
  })

  it('keeps whitespace-only messages and reports send failure', async () => {
    const { session, lines, transport } = harness()
    await session.join(spec)
    expect(await session.sendChat('   ')).toBe('empty')
    transport().failSend = new Error('dc closed')
    expect(await session.sendChat('你好')).toBe('failed')
    expect(lines.some((line) => line.kind === 'system' && line.text.includes('没发出去'))).toBe(true)
  })

  it('escalates when every tracker socket is closed', async () => {
    const { session, clock, statuses, transport } = harness()
    await session.join(spec)
    transport().relayStates = [{ url: 'wss://tracker.invalid', readyState: 3 }]
    clock.advance(5000)
    expect(statuses.at(-1)).toMatchObject({ phase: 'error', detail: 'Tracker 连不上，可改用 Nostr' })
  })

  it('resends a failed line and accepts a late ack', async () => {
    const { session, clock, lines, transport } = harness()
    await session.join(spec)
    transport().payload('peer-b', createHelloPayload('青石'))
    await session.sendChat('第一句')
    const pending = [...lines].reverse().find((line) => line.kind === 'chat' && line.self)
    expect(pending).toMatchObject({ delivery: 'pending' })
    clock.advance(8000)
    expect([...lines].reverse().find((line) => line.kind === 'chat' && line.self)).toMatchObject({ delivery: 'failed' })

    expect(await session.resend(pending && pending.kind === 'chat' ? pending.id : '')).toBe('sent')
    const again = [...lines].reverse().find((line) => line.kind === 'chat' && line.self)
    expect(again).toMatchObject({ delivery: 'pending' })
    transport().payload('peer-b', createAckPayload('青石', pending && pending.kind === 'chat' ? pending.id : ''))
    expect([...lines].reverse().find((line) => line.kind === 'chat' && line.self)).toMatchObject({ delivery: 'acked' })
  })

  it('prunes a ghost hello that is not in the transport peer set', async () => {
    const { session, clock, lines, transport } = harness()
    await session.join(spec)
    transport().payload('peer-gone', createHelloPayload('青石'))
    clock.advance(80_000)
    expect(lines.some((line) => line.kind === 'system' && line.text.includes('离开'))).toBe(true)
  })

  it('keeps a connected peer that went quiet', async () => {
    const { session, clock, lines, transport } = harness()
    await session.join(spec)
    transport().peerJoin('peer-live')
    transport().payload('peer-live', createHelloPayload('青石'))
    clock.advance(80_000)
    expect(lines.filter((line) => line.kind === 'system' && line.text.includes('离开'))).toHaveLength(0)
  })

  it('leaves the failed transport before a second join', async () => {
    const clock = createMemoryRuntime()
    const created: FakeTransport[] = []
    let fail = true
    const session = new ChatSession(identity, {}, {
      runtime: clock.runtime,
      createTransport: () => {
        const fake = new FakeTransport()
        if (fail) fake.failJoin = new Error('tracker down')
        created.push(fake)
        return fake
      },
    })
    await expect(session.join(spec)).rejects.toThrow('tracker down')
    expect(created.at(-1)?.handlers).toBeNull()
    fail = false
    await session.join(spec)
    expect(session.isJoined()).toBe(true)
  })

  it('resends a failed line restored from cache', async () => {
    const { session, lines, transport } = harness()
    session.hydrate([
      chatLine({
        id: 'aabbccdd12345678',
        fromId: 'local',
        nick: '晚风',
        text: '旧信',
        ts: 1,
        self: true,
        delivery: 'failed',
      }),
    ])
    await session.join(spec)
    transport().payload('peer-b', createHelloPayload('青石'))
    expect(await session.resend('aabbccdd12345678')).toBe('sent')
    expect(transport().sent.some((item) => (item.payload as { id?: string }).id === 'aabbccdd12345678')).toBe(true)
    expect(lines.some((line) => line.kind === 'chat' && line.id === 'aabbccdd12345678' && line.delivery === 'pending')).toBe(true)
  })
})
