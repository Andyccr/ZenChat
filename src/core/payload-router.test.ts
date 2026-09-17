import { describe, expect, it } from 'vitest'
import { applyIncoming, decodeIncoming } from './payload-router'
import { createAckPayload, createChatPayload, createHelloPayload, createTypingPayload } from './protocol'

describe('decodeIncoming', () => {
  it('drops invalid payloads and marks duplicate chats', () => {
    expect(decodeIncoming({ v: 1, type: 'leave', nick: '晚风' }, () => false)).toBeNull()
    expect(decodeIncoming(createHelloPayload('晚风'), () => false)).toEqual({
      type: 'hello',
      nick: '晚风',
      features: ['ack'],
    })
    expect(decodeIncoming(createTypingPayload('听雨'), () => false)).toEqual({ type: 'typing', nick: '听雨' })
    expect(decodeIncoming(createAckPayload('青石', 'aabbccdd12345678'), () => false)).toEqual({
      type: 'ack',
      nick: '青石',
      id: 'aabbccdd12345678',
    })

    const chat = createChatPayload('青石', '在吗', 'aabbccdd12345678', 1)
    expect(decodeIncoming(chat, () => false)).toMatchObject({ type: 'chat', duplicate: false, text: '在吗' })
    expect(decodeIncoming(chat, (id) => id === chat.id)).toMatchObject({ type: 'chat', duplicate: true })
  })

  it('dispatches decoded payloads to the matching handler', () => {
    const seen: string[] = []
    applyIncoming('peer-a', createHelloPayload('晚风'), () => false, {
      hello: (peerId, nick, features) => seen.push(`${peerId}:${nick}:${features.join(',')}`),
      typing: () => seen.push('typing'),
      ack: () => seen.push('ack'),
      chat: () => seen.push('chat'),
    })
    expect(seen).toEqual(['peer-a:晚风:ack'])
  })
})
