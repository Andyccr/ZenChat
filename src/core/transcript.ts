import { MAX_SEEN_IDS } from '../config/app'
import { trimLines } from './cache'
import type { ChatLine } from './types'

export class Transcript {
  private lines: ChatLine[] = []
  private seen = new Set<string>()
  private seenOrder: string[] = []

  hydrate(lines: ChatLine[]): ChatLine[] {
    this.clear()
    this.lines = trimLines(lines)
    for (const line of this.lines) {
      if (line.kind === 'chat') this.remember(line.id)
    }
    return this.lines
  }

  snapshot(): ChatLine[] {
    return this.lines
  }

  has(id: string): boolean {
    return this.seen.has(id)
  }

  remember(id: string): void {
    if (this.seen.has(id)) return
    this.seen.add(id)
    this.seenOrder.push(id)
    while (this.seenOrder.length > MAX_SEEN_IDS) {
      const oldest = this.seenOrder.shift()
      if (oldest) this.seen.delete(oldest)
    }
  }

  append(line: ChatLine): ChatLine | null {
    if (line.kind === 'chat') {
      if (this.seen.has(line.id)) return null
      this.remember(line.id)
    }
    this.lines.push(line)
    this.lines = trimLines(this.lines)
    return line
  }

  clear(): void {
    this.lines = []
    this.seen.clear()
    this.seenOrder = []
  }
}

export function chatLine(input: {
  id: string
  fromId: string
  nick: string
  text: string
  ts: number
  self: boolean
}): ChatLine {
  return { kind: 'chat', ...input }
}

export function systemLine(id: string, text: string, ts: number): ChatLine {
  return { kind: 'system', id, text, ts }
}
