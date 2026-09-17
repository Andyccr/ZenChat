import { loadRoomLog, saveRoomLog } from './cache'
import { rememberRoom } from './recent'
import { sameRoom } from './room'
import { ChatSession, type SessionListener, type SessionOptions } from './session'
import type { Identity, RoomSpec, SendResult } from './types'

export class RoomManager {
  private identity: Identity
  private listeners: SessionListener
  private options: SessionOptions
  private session: ChatSession | null = null
  private spec: RoomSpec | null = null
  private generation = 0

  constructor(identity: Identity, listeners: SessionListener, options: SessionOptions = {}) {
    this.identity = identity
    this.listeners = listeners
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
    if (!force && this.spec && this.session?.isJoined() && sameRoom(this.spec, spec)) {
      return true
    }

    const token = ++this.generation
    await this.snapshotAndClose()
    if (token !== this.generation) return false

    rememberRoom(spec)
    this.listeners.onMembers?.([])
    const session = new ChatSession(this.identity, this.listeners, this.options)
    const cached = loadRoomLog(spec)
    if (cached.length > 0) session.hydrate(cached)
    else this.listeners.onReset?.([])

    this.session = session
    this.spec = spec
    try {
      await session.join(spec)
    } catch (error) {
      if (token !== this.generation) {
        await session.leave({ silent: true })
        return false
      }
      throw error
    }
    if (token !== this.generation) {
      await session.leave({ silent: true })
      return false
    }
    return true
  }

  async close(): Promise<void> {
    this.generation += 1
    await this.snapshotAndClose()
  }

  snapshot(): void {
    if (this.session && this.spec) saveRoomLog(this.spec, this.session.getLines())
  }

  private async snapshotAndClose(): Promise<void> {
    if (this.session && this.spec) {
      saveRoomLog(this.spec, this.session.getLines())
      await this.session.leave({ silent: true })
    }
    this.session = null
    this.spec = null
  }
}
