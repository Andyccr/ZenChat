import { describe, expect, it } from 'vitest'
import { idleLife, isJoined, reduceLife, uiPhase } from './session-machine'

describe('session machine', () => {
  it('joins to waiting, then live, then waiting when the last peer leaves', () => {
    let life = reduceLife(idleLife(), { type: 'join' })
    expect(life.state).toBe('joining')
    expect(uiPhase(life)).toBe('connecting')
    life = reduceLife(life, { type: 'join_ok' })
    expect(life.state).toBe('waiting')
    life = reduceLife(life, { type: 'peers', count: 1 })
    expect(life.state).toBe('live')
    expect(uiPhase(life)).toBe('connected')
    life = reduceLife(life, { type: 'peers', count: 0 })
    expect(life.state).toBe('waiting')
  })

  it('marks failed joins as not joined and maps closed relays to error', () => {
    let life = reduceLife(idleLife(), { type: 'join' })
    life = reduceLife(life, { type: 'join_err' })
    expect(life.state).toBe('failed')
    expect(isJoined(life)).toBe(false)
    expect(uiPhase(life)).toBe('error')

    life = reduceLife(idleLife(), { type: 'join' })
    life = reduceLife(life, { type: 'join_ok' })
    life = reduceLife(life, { type: 'relays', down: true })
    expect(life.state).toBe('relay_down')
    expect(uiPhase(life)).toBe('error')
  })
})
