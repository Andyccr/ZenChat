import { describe, expect, it } from 'vitest'
import { createTypingPayload } from './protocol'
import { createMemoryRuntime } from './runtime'
import { ChatSession } from './session'
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
    expect(statuses.at(-1)?.detail).toBe('已宣布，等待对等节点')

    transport().peerJoin('peer-aa')
    expect(lines.some((line) => line.kind === 'system' && line.text.includes('加入'))).toBe(true)
    expect(transport().sent.some((item) => (item.payload as { type: string }).type === 'hello' && item.target === 'peer-aa')).toBe(true)

    await session.sendChat('你好')
    const self = lines.find((line) => line.kind === 'chat' && line.self)
    expect(self).toMatchObject({ text: '你好', nick: '晚风' })
    expect(transport().sent.some((item) => (item.payload as { type: string }).type === 'chat')).toBe(true)
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
    await session.sendChat('迟了')
    expect(transport().sent).toHaveLength(sent)
  })
})
