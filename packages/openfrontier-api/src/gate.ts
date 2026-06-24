import type { Env, GateAcquireResult } from "./types"

export async function acquireUserGate(env: Env, input: {
  userId: string
  leaseId: string
  limitPerMinute?: number
  lockTimeoutMs?: number
  maxConcurrent?: number
}) {
  const objectId = env.USER_GATE.idFromName(input.userId)
  const stub = env.USER_GATE.get(objectId)

  const response = await stub.fetch("https://user-gate/acquire", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      leaseId: input.leaseId,
      limitPerMinute: input.limitPerMinute,
      lockTimeoutMs: input.lockTimeoutMs,
      maxConcurrent: input.maxConcurrent ?? 1,
    }),
  })

  return response.json<GateAcquireResult>()
}

export async function releaseUserGate(env: Env, input: {
  userId: string
  leaseId: string
}) {
  const objectId = env.USER_GATE.idFromName(input.userId)
  const stub = env.USER_GATE.get(objectId)

  await stub.fetch("https://user-gate/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ leaseId: input.leaseId }),
  }).catch(() => undefined)
}
