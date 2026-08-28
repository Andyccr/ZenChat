import { loadRoomLog, saveRoomLog } from './cache'
import { rememberRoom } from './recent'
import { sameRoom } from './room'
import { ChatSession, type SessionListener } from './session'
import type { Identity, RoomSpec } from './types'

export class RoomManager {
  private identity: Identity
  private listeners: SessionListener
  private session: ChatSession | null = null
  private spec: RoomSpec | null = null
  private generation = 0

  constructor(identity: Identity, listeners: SessionListener) {
    this.identity = identity
    this.listeners = listeners
  }

  current(): RoomSpec | null {
    return this.spec
  }

  getSession(): ChatSession | null {
    return this.session
  }

  setIdentity(identity: Identity): void {
    this.identity = identity
    this.session?.setNick(identity.nick)
  }

  async open(spec: RoomSpec): Promise<ChatSession | null> {
    if (this.spec && this.session && sameRoom(this.spec, spec)) {
      return this.session
    }

    const token = ++this.generation
    await this.snapshotAndClose()
    if (token !== this.generation) return null

    rememberRoom(spec)
    this.listeners.onMembers?.([])
    const session = new ChatSession(this.identity, this.listeners)
    const cached = loadRoomLog(spec)
    if (cached.length > 0) session.hydrate(cached)
    else this.listeners.onReset?.([])

    this.session = session
    this.spec = spec
    await session.join(spec)
    if (token !== this.generation) {
      await session.leave({ silent: true })
      return null
    }
    return session
  }

  async close(): Promise<void> {
    this.generation += 1
    await this.snapshotAndClose()
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
