import { describe, expect, it } from 'vitest'
import { Heartbeat } from './heartbeat'
import { createMemoryRuntime } from './runtime'

describe('Heartbeat', () => {
  it('polls and hellos on interval, pauses while hidden, and resumes with a burst', () => {
    const clock = createMemoryRuntime(0)
    const hellos: number[] = []
    const polls: number[] = []
    const beat = new Heartbeat(clock.runtime, 25, 10, {
      onHello: () => hellos.push(clock.runtime.now()),
      onPoll: () => polls.push(clock.runtime.now()),
    })

    beat.start()
    clock.advance(25)
    expect(hellos).toEqual([25])
    expect(polls).toEqual([10, 20])

    clock.setHidden(true)
    clock.advance(40)
    expect(hellos).toEqual([25])
    expect(polls).toEqual([10, 20])

    clock.setHidden(false)
    expect(hellos.at(-1)).toBe(65)
    expect(polls.at(-1)).toBe(65)
    clock.advance(10)
    expect(polls.at(-1)).toBe(75)

    beat.stop()
    clock.advance(50)
    expect(hellos).toHaveLength(2)
    expect(polls.filter((at) => at > 75)).toEqual([])
  })
})
