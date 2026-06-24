export type Env = {
  DB: D1Database
  USER_GATE: DurableObjectNamespace
  PUBLISHER_ID: string
  DEFAULT_POWER_MODEL: string
  DEFAULT_FAST_MODEL: string
  NOTPIXEL_BASE_URL: string
  NOTPIXEL_OFFER_PATH: string
  NOTPIXEL_OFFER_URL?: string
  NOTPIXEL_API_KEY?: string
  OPENROUTER_API_KEY?: string
  FREE_MONTHLY_POWER_RUNS?: string
  FREE_MONTHLY_FAST_RUNS?: string
  RATE_LIMIT_PER_MINUTE?: string
  USER_LOCK_TIMEOUT_MS?: string
}

export type AuthedUser = {
  id: string
  bearerHash: string
  plan: string
}

export type RunType = "power" | "fast"

export type ResolvedModel = {
  alias: RunType
  runType: RunType
  providerModel: string
}

export type Reservation = {
  id: string
  userId: string
  runType: RunType
  modelAlias: string
  providerModel: string
  estimatedCostUsd: number
}

export type GateAcquireResult =
  | { ok: true; leaseId: string; inFlight: number; remaining: number; resetAt: number }
  | { ok: false; reason: "rate_limited" | "concurrency_limited"; retryAfterMs: number; limit?: number }
