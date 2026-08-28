import { describe, expect, it } from 'vitest'
import { createChatPayload, parsePayload } from './protocol'

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
})
