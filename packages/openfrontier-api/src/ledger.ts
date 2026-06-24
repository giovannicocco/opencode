import type { Env, Reservation, ResolvedModel, RunType } from "./types"
import { estimateRunCostUsd, requestId } from "./http"

const columnByRunType = {
  power: "power_runs_remaining",
  fast: "fast_runs_remaining",
} as const

export async function getBalance(env: Env, userId: string) {
  return env.DB.prepare(
    `SELECT user_id, power_runs_remaining, fast_runs_remaining, updated_at FROM credit_balances WHERE user_id = ?`,
  ).bind(userId).first<{
    user_id: string
    power_runs_remaining: number
    fast_runs_remaining: number
    updated_at: string
  }>()
}

export async function reserveRun(env: Env, userId: string, model: ResolvedModel): Promise<Reservation | null> {
  const reservationId = requestId("res")
  const estimatedCostUsd = estimateRunCostUsd(model.runType)

  const debit =
    model.runType === "power"
      ? await env.DB.prepare(
          `UPDATE credit_balances
           SET power_runs_remaining = power_runs_remaining - 1, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND power_runs_remaining > 0`,
        ).bind(userId).run()
      : await env.DB.prepare(
          `UPDATE credit_balances
           SET fast_runs_remaining = fast_runs_remaining - 1, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND fast_runs_remaining > 0`,
        ).bind(userId).run()

  if (!debit.meta?.changes) return null

  await env.DB.prepare(
    `INSERT INTO usage_ledger
      (id, user_id, run_type, status, model_alias, provider_model, estimated_cost_usd)
     VALUES (?, ?, ?, 'reserved', ?, ?, ?)`,
  ).bind(
    reservationId,
    userId,
    model.runType,
    model.alias,
    model.providerModel,
    estimatedCostUsd,
  ).run()

  return {
    id: reservationId,
    userId,
    runType: model.runType,
    modelAlias: model.alias,
    providerModel: model.providerModel,
    estimatedCostUsd,
  }
}

export async function completeRun(env: Env, reservationId: string, usage?: {
  inputTokens?: number
  outputTokens?: number
  notpixelImpressionId?: string
}) {
  await env.DB.prepare(
    `UPDATE usage_ledger
     SET status = 'completed',
         input_tokens = COALESCE(?, input_tokens),
         output_tokens = COALESCE(?, output_tokens),
         notpixel_impression_id = COALESCE(?, notpixel_impression_id),
         completed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).bind(
    usage?.inputTokens ?? null,
    usage?.outputTokens ?? null,
    usage?.notpixelImpressionId ?? null,
    reservationId,
  ).run()
}

export async function refundRun(env: Env, reservation: Reservation, errorMessage?: string) {
  await env.DB.prepare(
    `UPDATE usage_ledger
     SET status = 'refunded', error_message = ?, completed_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'reserved'`,
  ).bind(errorMessage || null, reservation.id).run()

  if (reservation.runType === "power") {
    await env.DB.prepare(
      `UPDATE credit_balances
       SET power_runs_remaining = power_runs_remaining + 1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
    ).bind(reservation.userId).run()
    return
  }

  await env.DB.prepare(
    `UPDATE credit_balances
     SET fast_runs_remaining = fast_runs_remaining + 1, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`,
  ).bind(reservation.userId).run()
}

export async function addCredits(env: Env, userId: string, runType: RunType, amount: number, source: string, metadata?: unknown) {
  const id = requestId("cred")

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
  ).bind(id, userId, runType, amount, source, metadata ? JSON.stringify(metadata) : null).run()

  return { id, userId, runType, amount, source }
}
