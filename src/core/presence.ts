import { TYPING_TTL_MS } from '../config/app'
import type { Runtime } from './runtime'
import type { Member } from './types'

export class Presence {
  private members = new Map<string, Member>()
  private typingTimers = new Map<string, number>()

  constructor(
    private runtime: Pick<Runtime, 'now' | 'setTimeout' | 'clearTimeout'>,
    private onTypingEnd: (peerId: string) => void = () => undefined,
    private typingTtl = TYPING_TTL_MS,
  ) {}

  upsert(id: string, nick: string): Member {
    const existing = this.members.get(id)
    const now = this.runtime.now()
    const member: Member = {
      id,
      nick,
      joinedAt: existing?.joinedAt ?? now,
      lastSeenAt: now,
      rttMs: existing?.rttMs ?? null,
      typing: existing?.typing ?? false,
    }
    this.members.set(id, member)
    return member
  }

  remove(id: string): Member | undefined {
    this.clearTypingTimer(id)
    const member = this.members.get(id)
    this.members.delete(id)
    return member
  }

  markTyping(peerId: string): boolean {
    const member = this.members.get(peerId)
    if (!member) return false
    member.typing = true
    this.clearTypingTimer(peerId)
    this.typingTimers.set(
      peerId,
      this.runtime.setTimeout(() => {
        const current = this.members.get(peerId)
        if (current) {
          current.typing = false
          this.onTypingEnd(peerId)
        }
      }, this.typingTtl),
    )
    return true
  }

  setRtt(peerId: string, rttMs: number): boolean {
    const member = this.members.get(peerId)
    if (!member) return false
    member.rttMs = rttMs
    return true
  }

  list(): Member[] {
    return [...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)
  }

  clear(): void {
    for (const id of this.typingTimers.keys()) this.clearTypingTimer(id)
    this.members.clear()
  }

  private clearTypingTimer(peerId: string): void {
    const previous = this.typingTimers.get(peerId)
    if (previous !== undefined) this.runtime.clearTimeout(previous)
    this.typingTimers.delete(peerId)
  }
}
