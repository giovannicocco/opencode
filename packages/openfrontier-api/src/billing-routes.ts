import { Hono } from "hono"
import type { AuthedUser, Env } from "./types"
import { authMiddleware } from "./auth"
import { createCheckoutSession, createPortalSession, getPlan } from "./billing"

type Variables = {
  user: AuthedUser
}

export const billingRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()

billingRoutes.get("/billing/status", authMiddleware, async (c) => {
  const user = c.get("user")
  const plan = await getPlan(c.env, user.plan)

  const subscription = await c.env.DB.prepare(
    `SELECT id, plan_id, provider_customer_id, provider_subscription_id, status, current_period_start,
            current_period_end, cancel_at_period_end, updated_at
     FROM subscriptions
     WHERE user_id = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
  ).bind(user.id).first()

  return c.json({
    user_id: user.id,
    plan,
    sponsor_enabled: plan ? Boolean(plan.sponsor_enabled) : user.plan !== "pro",
    subscription,
  })
})

billingRoutes.post("/billing/checkout", authMiddleware, async (c) => {
  const user = c.get("user")
  const body = await c.req.json().catch(() => ({}))

  try {
    const session = await createCheckoutSession(c.env, {
      userId: user.id,
      successUrl: typeof body.successUrl === "string" ? body.successUrl : undefined,
      cancelUrl: typeof body.cancelUrl === "string" ? body.cancelUrl : undefined,
    })

    return c.json({ id: session.id, url: session.url })
  } catch (error) {
    return c.json({
      error: {
        message: error instanceof Error ? error.message : "Unable to create checkout session.",
        type: "billing_error",
      },
    }, 400)
  }
})

billingRoutes.post("/billing/portal", authMiddleware, async (c) => {
  const user = c.get("user")
  const body = await c.req.json().catch(() => ({}))

  try {
    const session = await createPortalSession(c.env, {
      userId: user.id,
      returnUrl: typeof body.returnUrl === "string" ? body.returnUrl : undefined,
    })

    return c.json({ id: session.id, url: session.url })
  } catch (error) {
    return c.json({
      error: {
        message: error instanceof Error ? error.message : "Unable to create billing portal session.",
        type: "billing_error",
      },
    }, 400)
  }
})
