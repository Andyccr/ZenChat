import { CACHE_DEBOUNCE_MS } from '../config/app'
import { loadRoomLog, saveRoomLog } from './cache'
import { rememberRoom } from './recent'
import { canonicalizeSpec, sameRoom } from './room'
import { browserRuntime } from './runtime'
import { ChatSession, type SessionListener, type SessionOptions } from './session'
import type { Identity, RoomSpec, SendResult } from './types'

export class RoomManager {
  private identity: Identity
  private emit: SessionListener
  private options: SessionOptions
  private session: ChatSession | null = null
  private spec: RoomSpec | null = null
  private generation = 0
  private saveTimer: number | null = null

  constructor(identity: Identity, listeners: SessionListener, options: SessionOptions = {}) {
    this.identity = identity
    this.emit = listeners
    this.options = options
  }

  current(): RoomSpec | null {
    return this.spec
  }

  isJoined(): boolean {
    return this.session?.isJoined() ?? false
  }

  selfId(): string {
    return this.session?.selfId ?? this.identity.id
  }

  sendChat(text: string): Promise<SendResult> {
    return this.session?.sendChat(text) ?? Promise.resolve('closed')
  }

  resend(id: string): Promise<SendResult> {
    return this.session?.resend(id) ?? Promise.resolve('closed')
  }

  sendTyping(): void {
    this.session?.sendTyping()
  }

  retry(): Promise<boolean> {
    const spec = this.spec
    if (!spec) return Promise.resolve(false)
    return this.open(spec, true)
  }

  setIdentity(identity: Identity): void {
    this.identity = identity
    this.session?.setNick(identity.nick)
  }

  async open(spec: RoomSpec, force = false): Promise<boolean> {
    const clean = canonicalizeSpec(spec)
    if (!clean) return false
    if (!force && this.spec && this.session?.isJoined() && sameRoom(this.spec, clean)) {
      return true
    }

    const token = ++this.generation
    await this.snapshotAndClose()
    if (token !== this.generation) return false

    rememberRoom(clean)
    this.emit.onMembers?.([])
    const session = new ChatSession(this.identity, this.boundListeners(), this.options)
    const cached = loadRoomLog(clean)
    if (cached.length > 0) session.hydrate(cached)
    else this.emit.onReset?.([])

    this.session = session
    this.spec = clean
    try {
      await session.join(clean)
    } catch (error) {
      if (token !== this.generation) return false
      throw error
    }
    if (token !== this.generation) {
      await session.leave({ silent: true })
      return false
    }
    return session.isJoined()
  }

  async close(): Promise<void> {
    this.generation += 1
    await this.snapshotAndClose()
  }

  snapshot(): void {
    if (this.session && this.spec) saveRoomLog(this.spec, this.session.getLines())
  }

  private boundListeners(): SessionListener {
    return {
      onStatus: (status) => this.emit.onStatus?.(status),
      onMembers: (members) => this.emit.onMembers?.(members),
      onLine: (line) => {
        this.emit.onLine?.(line)
        this.scheduleSnapshot()
      },
      onReset: (lines) => this.emit.onReset?.(lines),
    }
  }

  private scheduleSnapshot(): void {
    if (this.saveTimer !== null || !this.spec) return
    const runtime = this.options.runtime ?? browserRuntime
    this.saveTimer = runtime.setTimeout(() => {
      this.saveTimer = null
      this.snapshot()
    }, CACHE_DEBOUNCE_MS)
  }

  private clearSaveTimer(): void {
    if (this.saveTimer === null) return
    const runtime = this.options.runtime ?? browserRuntime
    runtime.clearTimeout(this.saveTimer)
    this.saveTimer = null
  }

  private async snapshotAndClose(): Promise<void> {
    this.clearSaveTimer()
    if (this.session && this.spec) {
      saveRoomLog(this.spec, this.session.getLines())
      await this.session.leave({ silent: true })
    }
    this.session = null
    this.spec = null
  }
}
