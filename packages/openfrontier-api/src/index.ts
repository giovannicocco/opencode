import { Hono } from "hono"
import { cors } from "hono/cors"
import type { AuthedUser, Env } from "./types"
import { UserGate } from "./user-gate"
import { authMiddleware } from "./auth"
import { resolveModel, requestId } from "./http"
import { addCredits, completeRun, getBalance, refundRun, reserveRun } from "./ledger"
import { acquireUserGate, releaseUserGate } from "./gate"
import { callNotPixel } from "./notpixel"

export { UserGate }

type Variables = {
  user: AuthedUser
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["authorization", "content-type", "x-openfrontier-user-id"],
}))

app.get("/", (c) => {
  return c.json({
    name: "openfrontier",
    role: "publisher-backend",
    status: "ok",
    storage: {
      ledger: "D1",
      concurrency_and_rate_limit: "DurableObject/UserGate",
    },
    routes: [
      "GET /",
      "GET /v1/models",
      "GET /v1/me/usage",
      "POST /v1/chat/completions",
      "POST /v1/credits/claim",
    ],
  })
})

app.get("/v1/models", (c) => {
  return c.json({
    object: "list",
    data: [
      {
        id: "power",
        object: "model",
        owned_by: "openfrontier",
        provider_model: c.env.DEFAULT_POWER_MODEL || "openrouter/z-ai/glm-5.2",
      },
      {
        id: "fast",
        object: "model",
        owned_by: "openfrontier",
        provider_model: c.env.DEFAULT_FAST_MODEL || "openrouter/qwen/qwen3-coder",
      },
    ],
  })
})

app.get("/v1/me/usage", authMiddleware, async (c) => {
  const user = c.get("user")
  const balance = await getBalance(c.env, user.id)

  return c.json({
    user_id: user.id,
    plan: user.plan,
    balances: {
      power_runs_remaining: balance?.power_runs_remaining ?? 0,
      fast_runs_remaining: balance?.fast_runs_remaining ?? 0,
    },
  })
})

app.post("/v1/credits/claim", authMiddleware, async (c) => {
  const user = c.get("user")
  const body = await c.req.json().catch(() => ({}))
  const runType = body.runType === "fast" ? "fast" : "power"
  const amount = Math.max(1, Math.min(Number(body.amount || 3), 20))
  const source = body.source || "manual_claim"

  const credit = await addCredits(c.env, user.id, runType, amount, source, body.metadata)
  const balance = await getBalance(c.env, user.id)

  return c.json({ credit, balance })
})

app.post("/v1/chat/completions", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: { message: "Invalid JSON body.", type: "invalid_request_error" } }, 400)

  const user = c.get("user")
  const model = resolveModel(body.model, c.env)

  if (!model) {
    return c.json({
      error: { message: "Unsupported model. Use model=power or model=fast.", type: "invalid_model" },
      supported_models: ["power", "fast"],
    }, 400)
  }

  const leaseId = requestId("lease")
  const gate = await acquireUserGate(c.env, {
    userId: user.id,
    leaseId,
    limitPerMinute: Number(c.env.RATE_LIMIT_PER_MINUTE || "20"),
    lockTimeoutMs: Number(c.env.USER_LOCK_TIMEOUT_MS || "120000"),
    maxConcurrent: 1,
  })

  if (!gate.ok) {
    return c.json({
      error: {
        message: gate.reason === "rate_limited" ? "Too many requests." : "Another request is already running for this user.",
        type: gate.reason,
        retry_after_ms: gate.retryAfterMs,
      },
    }, gate.reason === "rate_limited" ? 429 : 409)
  }

  let reservation = null

  try {
    reservation = await reserveRun(c.env, user.id, model)
    if (!reservation) {
      return c.json({
        error: { message: `No ${model.runType} runs remaining.`, type: "quota_exceeded" },
      }, 402)
    }

    const upstream = await callNotPixel({ env: c.env, body, userId: user.id, reservation })

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "")
      await refundRun(c.env, reservation, text || `NotPixel returned ${upstream.status}`)
      return c.json({
        error: {
          message: text || `NotPixel returned ${upstream.status}`,
          type: "upstream_error",
          upstream_status: upstream.status,
        },
      }, 502)
    }

    await completeRun(c.env, reservation)

    const headers = new Headers(upstream.headers)
    headers.set("x-openfrontier-reservation-id", reservation.id)
    headers.set("x-openfrontier-model-alias", model.alias)
    headers.set("x-openfrontier-provider-model", model.providerModel)
    headers.set("x-openfrontier-gate-lease-id", leaseId)

    return new Response(upstream.body, { status: upstream.status, headers })
  } catch (error) {
    if (reservation) {
      await refundRun(c.env, reservation, error instanceof Error ? error.message : "Unknown upstream error")
    }

    return c.json({
      error: {
        message: error instanceof Error ? error.message : "Unexpected upstream error.",
        type: "upstream_error",
      },
    }, 502)
  } finally {
    await releaseUserGate(c.env, { userId: user.id, leaseId })
  }
})

export default app
