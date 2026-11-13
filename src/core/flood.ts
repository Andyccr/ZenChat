export class FloodGate {
  private hits = new Map<string, number[]>()

  allow(key: string, now: number, limit: number, windowMs: number): boolean {
    const cutoff = now - windowMs
    const recent = (this.hits.get(key) ?? []).filter((at) => at > cutoff)
    if (recent.length >= limit) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    return true
  }

  clear(): void {
    this.hits.clear()
  }
}
