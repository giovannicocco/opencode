import type { Env, GateAcquireResult } from "./types"

type InFlightLease = {
  createdAt: number
  expiresAt: number
}

export class UserGate {
  private inFlight = new Map<string, InFlightLease>()
  private windowStart = 0
  private count = 0

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request) {
    const url = new URL(request.url)

    if (url.pathname === "/acquire") {
      const body = await request.json<{
        leaseId?: string
        limitPerMinute?: number
        lockTimeoutMs?: number
        maxConcurrent?: number
      }>().catch(() => ({}))

      return Response.json(this.acquire(body))
    }

    if (url.pathname === "/release") {
      const body = await request.json<{ leaseId?: string }>().catch(() => ({}))
      if (body.leaseId) this.inFlight.delete(body.leaseId)
      return Response.json({ ok: true })
    }

    if (url.pathname === "/status") {
      this.pruneExpiredLeases(Date.now())
      return Response.json({
        inFlight: this.inFlight.size,
        windowStart: this.windowStart,
        count: this.count,
      })
    }

    return new Response("Not found", { status: 404 })
  }

  private acquire(input: {
    leaseId?: string
    limitPerMinute?: number
    lockTimeoutMs?: number
    maxConcurrent?: number
  }): GateAcquireResult {
    const now = Date.now()
    this.pruneExpiredLeases(now)

    const limitPerMinute = Math.max(1, Number(input.limitPerMinute || this.env.RATE_LIMIT_PER_MINUTE || 20))
    const lockTimeoutMs = Math.max(10_000, Number(input.lockTimeoutMs || this.env.USER_LOCK_TIMEOUT_MS || 120_000))
    const maxConcurrent = Math.max(1, Number(input.maxConcurrent || 1))

    if (!this.windowStart || now - this.windowStart >= 60_000) {
      this.windowStart = now
      this.count = 0
    }

    if (this.count >= limitPerMinute) {
      return {
        ok: false,
        reason: "rate_limited",
        retryAfterMs: Math.max(1_000, this.windowStart + 60_000 - now),
        limit: limitPerMinute,
      }
    }

    if (this.inFlight.size >= maxConcurrent) {
      const oldestExpiry = Math.min(...Array.from(this.inFlight.values()).map((lease) => lease.expiresAt))
      return {
        ok: false,
        reason: "concurrency_limited",
        retryAfterMs: Math.max(1_000, oldestExpiry - now),
      }
    }

    const leaseId = input.leaseId || crypto.randomUUID()
    this.inFlight.set(leaseId, {
      createdAt: now,
      expiresAt: now + lockTimeoutMs,
    })
    this.count++

    return {
      ok: true,
      leaseId,
      inFlight: this.inFlight.size,
      remaining: Math.max(0, limitPerMinute - this.count),
      resetAt: this.windowStart + 60_000,
    }
  }

  private pruneExpiredLeases(now: number) {
    for (const [leaseId, lease] of this.inFlight.entries()) {
      if (lease.expiresAt <= now) this.inFlight.delete(leaseId)
    }
  }
}
