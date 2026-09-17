export function throttle<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number,
  now: () => number = Date.now,
): (...args: T) => void {
  let last = Number.NEGATIVE_INFINITY
  return (...args: T) => {
    const at = now()
    if (at - last < ms) return
    last = at
    fn(...args)
  }
}

export function rafBatch<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
  if (typeof requestAnimationFrame !== 'function') {
    return (...args: T) => fn(...args)
  }
  let token = 0
  let pending: T | null = null
  return (...args: T) => {
    pending = args
    if (token) return
    token = requestAnimationFrame(() => {
      token = 0
      const next = pending
      pending = null
      if (next) fn(...next)
    })
  }
}

