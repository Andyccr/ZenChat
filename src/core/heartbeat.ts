import type { Runtime } from './runtime'

export type HeartbeatHandlers = {
  onHello: () => void
  onPoll: () => void
}

export class Heartbeat {
  private helloTimer: number | null = null
  private pollTimer: number | null = null
  private unbindVisibility: (() => void) | null = null

  constructor(
    private runtime: Pick<Runtime, 'hidden' | 'setInterval' | 'clearInterval' | 'onVisibilityChange'>,
    private helloMs: number,
    private pollMs: number,
    private handlers: HeartbeatHandlers,
  ) {}

  start(): void {
    this.stop()
    this.unbindVisibility = this.runtime.onVisibilityChange(this.onVisibility)
    this.startTimers()
  }

  stop(): void {
    this.unbindVisibility?.()
    this.unbindVisibility = null
    this.stopTimers()
  }

  private onVisibility = (): void => {
    if (this.runtime.hidden()) {
      this.stopTimers()
      return
    }
    this.startTimers()
    this.handlers.onHello()
    this.handlers.onPoll()
  }

  private startTimers(): void {
    this.stopTimers()
    this.helloTimer = this.runtime.setInterval(() => this.handlers.onHello(), this.helloMs)
    this.pollTimer = this.runtime.setInterval(() => this.handlers.onPoll(), this.pollMs)
  }

  private stopTimers(): void {
    if (this.helloTimer !== null) {
      this.runtime.clearInterval(this.helloTimer)
      this.helloTimer = null
    }
    if (this.pollTimer !== null) {
      this.runtime.clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }
}
