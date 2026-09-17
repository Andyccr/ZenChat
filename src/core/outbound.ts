import type { Runtime } from './runtime'

type Clock = Pick<Runtime, 'now' | 'hidden' | 'setTimeout' | 'clearTimeout' | 'onVisibilityChange'>

export class Outbound<T = unknown> {
  private timers = new Map<string, number>()
  private payloads = new Map<string, T>()
  private deadlines = new Map<string, number>()
  private unbindVisibility: (() => void) | null = null

  constructor(
    private runtime: Clock,
    private timeoutMs: number,
    private onExpire: (id: string) => void,
  ) {
    this.unbindVisibility = this.runtime.onVisibilityChange(this.onVisibility)
  }

  expect(id: string, payload?: T): void {
    this.cancelTimer(id)
    if (payload !== undefined) this.payloads.set(id, payload)
    this.deadlines.set(id, this.runtime.now() + this.timeoutMs)
    this.arm(id)
  }

  ack(id: string): boolean {
    if (!this.deadlines.has(id) && !this.payloads.has(id)) return false
    this.cancel(id)
    return true
  }

  payload(id: string): T | undefined {
    return this.payloads.get(id)
  }

  cancel(id: string): void {
    this.cancelTimer(id)
    this.deadlines.delete(id)
    this.payloads.delete(id)
  }

  clear(): void {
    for (const id of new Set([...this.deadlines.keys(), ...this.payloads.keys()])) this.cancel(id)
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
