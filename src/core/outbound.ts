import type { Runtime } from './runtime'

export class Outbound<T = unknown> {
  private timers = new Map<string, number>()
  private payloads = new Map<string, T>()

  constructor(
    private runtime: Pick<Runtime, 'setTimeout' | 'clearTimeout'>,
    private timeoutMs: number,
    private onExpire: (id: string) => void,
  ) {}

  expect(id: string, payload?: T): void {
    this.cancelTimer(id)
    if (payload !== undefined) this.payloads.set(id, payload)
    this.timers.set(
      id,
      this.runtime.setTimeout(() => {
        this.timers.delete(id)
        this.onExpire(id)
      }, this.timeoutMs),
    )
  }

  ack(id: string): boolean {
    if (!this.timers.has(id) && !this.payloads.has(id)) return false
    this.cancel(id)
    return true
  }

  payload(id: string): T | undefined {
    return this.payloads.get(id)
  }

  cancel(id: string): void {
    this.cancelTimer(id)
    this.payloads.delete(id)
  }

  clear(): void {
    for (const id of [...this.timers.keys(), ...this.payloads.keys()]) this.cancel(id)
  }

  private cancelTimer(id: string): void {
    const timer = this.timers.get(id)
    if (timer !== undefined) this.runtime.clearTimeout(timer)
    this.timers.delete(id)
  }
}
