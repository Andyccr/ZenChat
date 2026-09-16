import type { Runtime } from './runtime'

export class Outbound {
  private timers = new Map<string, number>()

  constructor(
    private runtime: Pick<Runtime, 'setTimeout' | 'clearTimeout'>,
    private timeoutMs: number,
    private onExpire: (id: string) => void,
  ) {}

  expect(id: string): void {
    this.cancel(id)
    this.timers.set(
      id,
      this.runtime.setTimeout(() => {
        this.timers.delete(id)
        this.onExpire(id)
      }, this.timeoutMs),
    )
  }

  ack(id: string): boolean {
    if (!this.timers.has(id)) return false
    this.cancel(id)
    return true
  }

  cancel(id: string): void {
    const timer = this.timers.get(id)
    if (timer !== undefined) this.runtime.clearTimeout(timer)
    this.timers.delete(id)
  }

  clear(): void {
    for (const id of [...this.timers.keys()]) this.cancel(id)
  }
}
