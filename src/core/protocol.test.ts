import { describe, expect, it } from 'vitest'
import { createAckPayload, createChatPayload, createHelloPayload, createSyncPayload, parsePayload } from './protocol'

describe('parsePayload', () => {
  it('accepts a well-formed chat message', () => {
    const payload = createChatPayload('晚风', 'hello 禅', 'aabbccddeeff0011', 1_700_000_000_000)
    expect(parsePayload(payload)).toEqual(payload)
  })

  it('rejects unknown versions and empty text', () => {
    expect(parsePayload({ v: 99, type: 'chat', id: 'aabbccdd', ts: 1, nick: 'a', text: 'x' })).toBeNull()
    expect(parsePayload({ v: 1, type: 'chat', id: 'aabbccdd', ts: 1, nick: 'a', text: '   ' })).toBeNull()
    expect(parsePayload({ v: 1, type: 'hello', nick: '' })).toBeNull()
    expect(parsePayload(null)).toBeNull()
  })

  it('sanitizes nick and truncates text', () => {
    const parsed = parsePayload({
      v: 1,
      type: 'hello',
      nick: '  甲\n乙  ',
    })
    expect(parsed).toMatchObject({ type: 'hello', nick: '甲 乙' })
  })

  it('accepts typing payloads', () => {
    expect(parsePayload({ v: 1, type: 'typing', nick: '听雨' })).toEqual({
      v: 1,
      type: 'typing',
      nick: '听雨',
    })
  })

  it('reads hello features and ack ids, ignoring unknown types', () => {
    expect(parsePayload(createHelloPayload('晚风'))).toEqual({
      v: 1,
      type: 'hello',
      nick: '晚风',
      features: ['ack', 'sync'],
    })
    expect(parsePayload({ v: 1, type: 'hello', nick: '晚风' })).toMatchObject({ features: [] })
    expect(parsePayload(createAckPayload('晚风', 'aabbccdd12345678'))).toEqual({
      v: 1,
      type: 'ack',
      id: 'aabbccdd12345678',
      nick: '晚风',
    })
    expect(parsePayload({ v: 1, type: 'leave', nick: '晚风' })).toBeNull()
  })

  it('parses a sync payload and drops malformed lines', () => {
    const payload = createSyncPayload('晚风', [
      { id: 'aabbccdd12345678', fromId: 'peer-a', nick: '青石', text: '在吗', ts: 2 },
    ])
    expect(parsePayload(payload)).toEqual(payload)
    expect(
      parsePayload({
        v: 1,
        type: 'sync',
        nick: '晚风',
        lines: [{ id: 'bad', fromId: 'x', nick: '青石', text: 'x', ts: 1 }, payload.lines[0]],
      }),
    ).toMatchObject({ type: 'sync', lines: [payload.lines[0]] })
  })
})
