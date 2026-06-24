import type { Context, MiddlewareHandler } from "hono"
import type { AuthedUser, Env } from "./types"
import { sha256Short } from "./http"

type Variables = {
  user: AuthedUser
}

function getBearer(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const header = c.req.header("authorization") || ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] || null
}

export async function ensureUser(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const bearer = getBearer(c)
  if (!bearer) return null

  const bearerHash = await sha256Short(bearer)
  const explicitUserId = c.req.header("x-openfrontier-user-id")
  const userId = explicitUserId || `usr_${bearerHash}`

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, bearer_hash, plan) VALUES (?, ?, 'free')`,
  ).bind(userId, bearerHash).run()

  const existing = await c.env.DB.prepare(
    `SELECT id, bearer_hash, plan FROM users WHERE id = ?`,
  ).bind(userId).first<{ id: string; bearer_hash: string; plan: string }>()

  if (!existing) return null

  const power = Number(c.env.FREE_MONTHLY_POWER_RUNS || "10")
  const fast = Number(c.env.FREE_MONTHLY_FAST_RUNS || "40")

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO credit_balances (user_id, power_runs_remaining, fast_runs_remaining) VALUES (?, ?, ?)`,
  ).bind(userId, power, fast).run()

  return {
    id: existing.id,
    bearerHash: existing.bearer_hash,
    plan: existing.plan,
  }
}

export const authMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const user = await ensureUser(c)
  if (!user) {
    return c.json({ error: { message: "Missing Authorization bearer token.", type: "auth_error" } }, 401)
  }

  c.set("user", user)
  await next()
}
