import type { Env, Plan, RunType } from "./types"
import { requestId } from "./http"

const billingApiBase = "https://api.stripe.com/v1"

type CheckoutSession = {
  id: string
  url: string | null
  customer?: string
  subscription?: string
}

type PortalSession = {
  id: string
  url: string
}

export async function getPlan(env: Env, planId: string) {
  return env.DB.prepare(
    `SELECT id, name, monthly_power_runs, monthly_fast_runs, sponsor_enabled, monthly_price_cents, billing_price_id
     FROM plans WHERE id = ?`,
  ).bind(planId).first<Plan>()
}

export async function getUserPlan(env: Env, userId: string) {
  const user = await env.DB.prepare(
    `SELECT plan FROM users WHERE id = ?`,
  ).bind(userId).first<{ plan: string }>()

  return getPlan(env, user?.plan || "free")
}

export async function setUserPlan(env: Env, userId: string, planId: "free" | "pro") {
  await env.DB.prepare(
    `UPDATE users SET plan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).bind(planId, userId).run()
}

export async function grantMonthlyPlanCredits(env: Env, userId: string, planId: string, source: string, metadata?: unknown) {
  const plan = await getPlan(env, planId)
  if (!plan) return null

  await addPlanCredits(env, userId, "power", plan.monthly_power_runs, source, metadata)
  await addPlanCredits(env, userId, "fast", plan.monthly_fast_runs, source, metadata)

  return plan
}

async function addPlanCredits(env: Env, userId: string, runType: RunType, amount: number, source: string, metadata?: unknown) {
  if (amount <= 0) return

  if (runType === "power") {
    await env.DB.prepare(
      `UPDATE credit_balances SET power_runs_remaining = power_runs_remaining + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
    ).bind(amount, userId).run()
  } else {
    await env.DB.prepare(
      `UPDATE credit_balances SET fast_runs_remaining = fast_runs_remaining + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
    ).bind(amount, userId).run()
  }

  await env.DB.prepare(
    `INSERT INTO credit_ledger (id, user_id, run_type, amount, source, metadata) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(requestId("cred"), userId, runType, amount, source, metadata ? JSON.stringify(metadata) : null).run()
}

export async function createCheckoutSession(env: Env, input: {
  userId: string
  successUrl?: string
  cancelUrl?: string
}) {
  const secret = env.BILLING_PROVIDER_SECRET
  const priceId = env.BILLING_PRO_PRICE_ID

  if (!secret || !priceId) {
    throw new Error("Billing is not configured.")
  }

  const currentCustomer = await findBillingCustomer(env, input.userId)
  const successUrl = input.successUrl || env.BILLING_SUCCESS_URL || "https://openfrontier.ai/billing/success"
  const cancelUrl = input.cancelUrl || env.BILLING_CANCEL_URL || "https://openfrontier.ai/billing/cancel"

  const body = new URLSearchParams()
  body.set("mode", "subscription")
  body.set("line_items[0][price]", priceId)
  body.set("line_items[0][quantity]", "1")
  body.set("success_url", successUrl)
  body.set("cancel_url", cancelUrl)
  body.set("client_reference_id", input.userId)
  body.set("metadata[user_id]", input.userId)
  body.set("subscription_data[metadata][user_id]", input.userId)
  body.set("subscription_data[metadata][plan_id]", "pro")
  if (currentCustomer) body.set("customer", currentCustomer)

  const response = await fetch(`${billingApiBase}/checkout/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  })

  const data = await response.json<CheckoutSession & { error?: { message?: string } }>()
  if (!response.ok) throw new Error(data.error?.message || "Failed to create checkout session.")
  return data
}

export async function createPortalSession(env: Env, input: {
  userId: string
  returnUrl?: string
}) {
  const secret = env.BILLING_PROVIDER_SECRET
  if (!secret) throw new Error("Billing is not configured.")

  const customer = await findBillingCustomer(env, input.userId)
  if (!customer) throw new Error("No billing customer found for user.")

  const body = new URLSearchParams()
  body.set("customer", customer)
  body.set("return_url", input.returnUrl || env.BILLING_PORTAL_RETURN_URL || "https://openfrontier.ai/account/billing")

  const response = await fetch(`${billingApiBase}/billing_portal/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  })

  const data = await response.json<PortalSession & { error?: { message?: string } }>()
  if (!response.ok) throw new Error(data.error?.message || "Failed to create billing portal session.")
  return data
}

async function findBillingCustomer(env: Env, userId: string) {
  const sub = await env.DB.prepare(
    `SELECT provider_customer_id FROM subscriptions
     WHERE user_id = ? AND provider_customer_id IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1`,
  ).bind(userId).first<{ provider_customer_id: string }>()

  return sub?.provider_customer_id || null
}

export async function verifyBillingWebhook(env: Env, rawBody: string, signatureHeader: string | null) {
  const secret = env.BILLING_WEBHOOK_SECRET
  if (!secret) throw new Error("Billing webhook is not configured.")
  if (!signatureHeader) throw new Error("Missing billing signature header.")

  const timestamp = signatureHeader.split(",").find((part) => part.startsWith("t="))?.slice(2)
  const signatures = signatureHeader
    .split(",")
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))

  if (!timestamp || signatures.length === 0) throw new Error("Invalid billing signature header.")

  const signedPayload = `${timestamp}.${rawBody}`
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload))
  const expected = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")

  if (!signatures.some((sig) => timingSafeEqual(sig, expected))) {
    throw new Error("Invalid billing signature.")
  }

  return JSON.parse(rawBody)
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}

export async function processBillingEvent(env: Env, event: any) {
  const eventId = String(event.id || "")
  if (!eventId) throw new Error("Billing event is missing id.")

  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO billing_events (id, event_type, payload) VALUES (?, ?, ?)`,
  ).bind(eventId, event.type || "unknown", JSON.stringify(event)).run()

  if (!inserted.meta?.changes) return { ok: true, deduped: true }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(env, event.data.object)
      break
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(env, event.data.object)
      break
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(env, event.data.object)
      break
    case "invoice.paid":
      await handleInvoicePaid(env, event.data.object)
      break
  }

  return { ok: true, deduped: false }
}

async function handleCheckoutCompleted(env: Env, session: any) {
  const userId = session.client_reference_id || session.metadata?.user_id
  if (!userId) return

  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id

  await upsertSubscription(env, {
    userId,
    subscriptionId,
    customerId,
    status: "active",
    priceId: env.BILLING_PRO_PRICE_ID || null,
    periodStart: null,
    periodEnd: null,
    cancelAtPeriodEnd: false,
  })

  await setUserPlan(env, userId, "pro")
}

async function handleSubscriptionUpdated(env: Env, subscription: any) {
  const userId = subscription.metadata?.user_id || (await findUserBySubscription(env, subscription.id))
  if (!userId) return

  const status = String(subscription.status || "unknown")
  const isPro = status === "active" || status === "trialing"
  const item = subscription.items?.data?.[0]
  const priceId = item?.price?.id || null

  await upsertSubscription(env, {
    userId,
    subscriptionId: subscription.id,
    customerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
    status,
    priceId,
    periodStart: subscription.current_period_start ? new Date(subscription.current_period_start * 1000).toISOString() : null,
    periodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  })

  await setUserPlan(env, userId, isPro ? "pro" : "free")
}

async function handleSubscriptionDeleted(env: Env, subscription: any) {
  const userId = subscription.metadata?.user_id || (await findUserBySubscription(env, subscription.id))
  if (!userId) return
  await upsertSubscription(env, {
    userId,
    subscriptionId: subscription.id,
    customerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
    status: "canceled",
    priceId: null,
    periodStart: null,
    periodEnd: null,
    cancelAtPeriodEnd: false,
  })
  await setUserPlan(env, userId, "free")
}

async function handleInvoicePaid(env: Env, invoice: any) {
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id
  if (!subscriptionId) return

  const userId = await findUserBySubscription(env, subscriptionId)
  if (!userId) return

  await setUserPlan(env, userId, "pro")
  await grantMonthlyPlanCredits(env, userId, "pro", "billing_invoice_paid", {
    invoiceId: invoice.id,
    subscriptionId,
  })
}

async function findUserBySubscription(env: Env, subscriptionId: string) {
  const sub = await env.DB.prepare(
    `SELECT user_id FROM subscriptions WHERE provider_subscription_id = ? ORDER BY updated_at DESC LIMIT 1`,
  ).bind(subscriptionId).first<{ user_id: string }>()

  return sub?.user_id || null
}

async function upsertSubscription(env: Env, input: {
  userId: string
  subscriptionId?: string | null
  customerId?: string | null
  status: string
  priceId?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  cancelAtPeriodEnd?: boolean
}) {
  const id = input.subscriptionId || requestId("sub")

  await env.DB.prepare(
    `INSERT INTO subscriptions (
      id, user_id, plan_id, provider, provider_customer_id, provider_subscription_id,
      provider_price_id, status, current_period_start, current_period_end, cancel_at_period_end
    ) VALUES (?, ?, 'pro', 'stripe', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider_customer_id = excluded.provider_customer_id,
      provider_subscription_id = excluded.provider_subscription_id,
      provider_price_id = excluded.provider_price_id,
      status = excluded.status,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    id,
    input.userId,
    input.customerId || null,
    input.subscriptionId || null,
    input.priceId || null,
    input.status,
    input.periodStart || null,
    input.periodEnd || null,
    input.cancelAtPeriodEnd ? 1 : 0,
  ).run()
}
