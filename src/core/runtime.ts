export type Runtime = {
  now(): number
  hidden(): boolean
  setTimeout(handler: () => void, ms: number): number
  clearTimeout(id: number): void
  setInterval(handler: () => void, ms: number): number
  clearInterval(id: number): void
  onVisibilityChange(handler: () => void): () => void
}

export const browserRuntime: Runtime = {
  now: () => Date.now(),
  hidden: () => document.hidden,
  setTimeout: (handler, ms) => window.setTimeout(handler, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  setInterval: (handler, ms) => window.setInterval(handler, ms),
  clearInterval: (id) => window.clearInterval(id),
  onVisibilityChange(handler) {
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  },
}

type Timer = {
  id: number
  at: number
  fn: () => void
  interval?: number
}

export function createMemoryRuntime(start = 0): {
  runtime: Runtime
  advance(ms: number): void
  setHidden(hidden: boolean): void
} {
  let now = start
  let seq = 1
  let hidden = false
  const timers = new Map<number, Timer>()
  const visibility = new Set<() => void>()

  const runtime: Runtime = {
    now: () => now,
    hidden: () => hidden,
    setTimeout(handler, ms) {
      const id = seq++
      timers.set(id, { id, at: now + ms, fn: handler })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    setInterval(handler, ms) {
      const id = seq++
      timers.set(id, { id, at: now + ms, fn: handler, interval: ms })
      return id
    },
    clearInterval(id) {
      timers.delete(id)
    },
    onVisibilityChange(handler) {
      visibility.add(handler)
      return () => {
        visibility.delete(handler)
      }
    },
  }

  return {
    runtime,
    advance(ms: number) {
      const target = now + ms
      while (true) {
        let next: Timer | undefined
        for (const timer of timers.values()) {
          if (timer.at > target) continue
          if (!next || timer.at < next.at) next = timer
        }
        if (!next) {
          now = target
          return
        }
        now = next.at
        if (next.interval !== undefined) {
          next.fn()
          if (timers.has(next.id)) next.at = now + next.interval
        } else {
          timers.delete(next.id)
          next.fn()
        }
      }
    },
    setHidden(value: boolean) {
      hidden = value
      for (const handler of visibility) handler()
    },
  }
}
