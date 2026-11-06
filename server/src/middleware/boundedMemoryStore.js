// A replaceable express-rate-limit store that keeps counters in this process's memory.
//
// Why not the library's MemoryStore: it never caps how many keys it holds. Two limiters
// are keyed on attacker-chosen values (an email address, a source IP), so a flood of
// unique keys could grow memory without bound. This store caps the key count.
//
// CAPACITY BEHAVIOR (important):
//  - Only EXPIRED counters are ever removed to make room. A live counter is never evicted,
//    because evicting it would let a flood of unique keys erase an active lockout.
//  - If the store is full of live counters, a request for a NEW key is refused: increment()
//    returns a hit count so large that the limiter answers 429 (with Retry-After set to when
//    the earliest counter expires). Existing counters are neither reset nor changed.
//  - Trade-off: during a unique-key flood that fills the store, brand-new keys are refused
//    (fail closed) until the oldest counters expire, at most one window. That sacrifices
//    availability for new keys to protect existing limits. Counters that fall back to zero
//    (a success after a counted attempt) are deleted immediately so legitimate traffic does
//    not fill the store. Each refusal is logged as `rate_limited` by the limiter.
//
// Limits of any in-memory store (documented in DEPLOYMENT.md):
//  - counters live only in this process: a restart or Render free-tier spin-down resets them;
//  - every backend instance has its own counters, so N instances allow roughly N times the limit.
//
// To move to a shared store later, replace the `createStore` function in rateLimiters.js.
// Nothing else depends on this class.

// Large enough that `totalHits > limit` for any configured limit, small enough to stay an integer.
const REFUSED_HITS = Number.MAX_SAFE_INTEGER

class BoundedMemoryStore {
  constructor({ maxKeys = 10000, now = Date.now, sweepIntervalMs = 60 * 1000 } = {}) {
    this.maxKeys = maxKeys
    this.now = now
    this.sweepIntervalMs = sweepIntervalMs
    this.windowMs = 0
    this.entries = new Map()
    this.timer = null
    this.refusedNewKeys = 0
    // Counters are per process, so the library's per-key duplicate-count check applies locally.
    this.localKeys = true
  }

  init(options) {
    this.windowMs = options.windowMs
    if (this.sweepIntervalMs > 0 && !this.timer) {
      this.timer = setInterval(() => this.sweepExpired(), this.sweepIntervalMs)
      // The sweep must never keep the process alive (tests, graceful shutdown).
      this.timer.unref()
    }
  }

  get size() {
    return this.entries.size
  }

  // Every entry shares one window length and is inserted when its window starts, so the
  // Map's insertion order is also expiry order: expired entries are always at the front.
  sweepExpired() {
    const now = this.now()
    for (const [key, entry] of this.entries) {
      if (entry.resetAt > now) break
      this.entries.delete(key)
    }
  }

  async get(key) {
    const entry = this.entries.get(key)
    if (!entry || entry.resetAt <= this.now()) return undefined
    return { totalHits: entry.totalHits, resetTime: new Date(entry.resetAt) }
  }

  async increment(key) {
    const now = this.now()
    let entry = this.entries.get(key)

    if (entry && entry.resetAt <= now) {
      this.entries.delete(key)
      entry = undefined
    }

    if (!entry) {
      // Reclaim expired counters first; they are the only thing that may be removed for room.
      if (this.entries.size >= this.maxKeys) this.sweepExpired()
      if (this.entries.size >= this.maxKeys) {
        this.refusedNewKeys += 1
        const earliestExpiry = this.entries.values().next().value.resetAt
        // Nothing is stored for the refused key, so no live counter is touched.
        return { totalHits: REFUSED_HITS, resetTime: new Date(earliestExpiry) }
      }
      entry = { totalHits: 0, resetAt: now + this.windowMs }
      this.entries.set(key, entry)
    }

    entry.totalHits += 1
    return { totalHits: entry.totalHits, resetTime: new Date(entry.resetAt) }
  }

  async decrement(key) {
    const entry = this.entries.get(key)
    if (!entry) return
    if (entry.totalHits > 1) {
      entry.totalHits -= 1
      return
    }
    // Back to zero: no history worth keeping, and keeping it would use up capacity.
    this.entries.delete(key)
  }

  async resetKey(key) {
    this.entries.delete(key)
  }

  async resetAll() {
    this.entries.clear()
  }

  shutdown() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.entries.clear()
  }
}

module.exports = { BoundedMemoryStore, REFUSED_HITS }
