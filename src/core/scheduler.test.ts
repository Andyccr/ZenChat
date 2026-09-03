import { describe, expect, it, vi } from 'vitest'
import { rafBatch, throttle } from './scheduler'

describe('scheduler', () => {
  it('throttles bursts to the first call in the window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const fn = vi.fn()
    const limited = throttle(fn, 100)
    limited('a')
    limited('b')
    vi.setSystemTime(99)
    limited('c')
    vi.setSystemTime(100)
    limited('d')
    expect(fn.mock.calls).toEqual([['a'], ['d']])
    vi.useRealTimers()
  })

  it('runs immediately when requestAnimationFrame is unavailable', () => {
    const fn = vi.fn()
    rafBatch(fn)('x')
    expect(fn).toHaveBeenCalledWith('x')
  })
})
