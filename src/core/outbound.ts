import type { Runtime } from './runtime'

type Clock = Pick<Runtime, 'now' | 'hidden' | 'setTimeout' | 'clearTimeout' | 'onVisibilityChange'>

export class Outbound<T = unknown> {
  private timers = new Map<string, number>()
  private payloads = new Map<string, T>()
  private deadlines = new Map<string, number>()
  private remaining = new Map<string, Set<string>>()
  private ackedBy = new Map<string, number>()
  private unbindVisibility: (() => void) | null = null

  constructor(
    private runtime: Clock,
    private timeoutMs: number,
    private onExpire: (id: string) => void,
  ) {
    this.unbindVisibility = this.runtime.onVisibilityChange(this.onVisibility)
  }

  expect(id: string, payload?: T, waitFor?: Iterable<string>): void {
    this.cancelTimer(id)
    if (payload !== undefined) this.payloads.set(id, payload)
    this.deadlines.set(id, this.runtime.now() + this.timeoutMs)
    if (waitFor) {
      this.remaining.set(id, new Set(waitFor))
      this.ackedBy.set(id, 0)
    } else {
      this.remaining.delete(id)
      this.ackedBy.delete(id)
    }
    this.arm(id)
  }

  ack(id: string, from?: string): boolean {
    if (!this.deadlines.has(id) && !this.payloads.has(id)) return false
    const wait = this.remaining.get(id)
    if (wait) {
      if (from) {
        wait.delete(from)
        this.ackedBy.set(id, (this.ackedBy.get(id) ?? 0) + 1)
      } else if (wait.size > 0) {
        return false
      }
      if (wait.size > 0) return false
      if ((this.ackedBy.get(id) ?? 0) < 1) return false
    }
    this.cancel(id)
    return true
  }

  dropPeer(peerId: string): string[] {
    const settled: string[] = []
    for (const [id, wait] of [...this.remaining]) {
      if (!wait.has(peerId)) continue
      wait.delete(peerId)
      if (wait.size === 0 && (this.ackedBy.get(id) ?? 0) > 0) {
        this.cancel(id)
        settled.push(id)
      }
    }
    return settled
  }

  payload(id: string): T | undefined {
    return this.payloads.get(id)
  }

  cancel(id: string): void {
    this.cancelTimer(id)
    this.deadlines.delete(id)
    this.payloads.delete(id)
    this.remaining.delete(id)
    this.ackedBy.delete(id)
  }

  clear(): void {
    for (const id of new Set([...this.deadlines.keys(), ...this.payloads.keys(), ...this.remaining.keys()])) {
      this.cancel(id)
    }
  }

  dispose(): void {
    this.clear()
    this.unbindVisibility?.()
    this.unbindVisibility = null
  }

  private onVisibility = (): void => {
    if (this.runtime.hidden()) {
      for (const id of [...this.timers.keys()]) this.cancelTimer(id)
      return
    }
    for (const id of [...this.deadlines.keys()]) this.arm(id)
  }

  private arm(id: string): void {
    const deadline = this.deadlines.get(id)
    if (deadline === undefined) return
    this.cancelTimer(id)
    if (this.runtime.hidden()) return
    const wait = deadline - this.runtime.now()
    if (wait <= 0) {
      this.deadlines.delete(id)
      this.onExpire(id)
      return
    }
    this.timers.set(
      id,
      this.runtime.setTimeout(() => {
        this.timers.delete(id)
        this.arm(id)
      }, wait),
    )
  }

  private cancelTimer(id: string): void {
    const timer = this.timers.get(id)
    if (timer !== undefined) this.runtime.clearTimeout(timer)
    this.timers.delete(id)
  }
}
