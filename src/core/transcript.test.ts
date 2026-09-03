import { describe, expect, it } from 'vitest'
import { MAX_LOG_LINES, MAX_SEEN_IDS } from '../config/app'
import { chatLine, systemLine, Transcript } from './transcript'

function chat(id: string, text = id): ReturnType<typeof chatLine> {
  return chatLine({ id, fromId: 'a', nick: '晚风', text, ts: 1, self: false })
}

describe('Transcript', () => {
  it('hydrates, dedupes chat ids, and keeps system lines', () => {
    const log = new Transcript()
    log.hydrate([systemLine('s1', 'in', 1), chat('c1', 'hi')])
    expect(log.append(chat('c1', 'hi'))).toBeNull()
    expect(log.append(chat('c2', 'there'))?.id).toBe('c2')
    expect(log.append(systemLine('s2', 'out', 2))?.kind).toBe('system')
    expect(log.snapshot().map((line) => line.id)).toEqual(['s1', 'c1', 'c2', 's2'])
  })

  it('trims the live log and caps remembered ids', () => {
    const log = new Transcript()
    for (let i = 0; i < MAX_LOG_LINES + 5; i += 1) log.append(chat(`id-${i}`))
    expect(log.snapshot()).toHaveLength(MAX_LOG_LINES)
    expect(log.snapshot()[0]?.id).toBe('id-5')
    expect(log.has('id-0')).toBe(true)

    const ids = new Transcript()
    for (let i = 0; i < MAX_SEEN_IDS + 10; i += 1) ids.remember(`seen-${i}`)
    expect(ids.has('seen-0')).toBe(false)
    expect(ids.has(`seen-${MAX_SEEN_IDS + 9}`)).toBe(true)
  })
})
