import type { Env, RunType, ResolvedModel } from "./types"

export function requestId(prefix = "of") {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`
}

export async function sha256Short(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export function normalizeInput(body: any) {
  if (body.input) return body.input
  if (body.prompt) return body.prompt

  if (Array.isArray(body.messages)) {
    return body.messages
      .map((m: any) => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
      .join("\n\n")
  }

  return ""
}

export function resolveModel(requestedModel: string | undefined, env: Env): ResolvedModel | null {
  if (!requestedModel || requestedModel === "power" || requestedModel === "openfrontier/power") {
    return {
      alias: "power",
      runType: "power",
      providerModel: env.DEFAULT_POWER_MODEL || "openrouter/z-ai/glm-5.2",
    }
  }

  if (requestedModel === "fast" || requestedModel === "openfrontier/fast") {
    return {
      alias: "fast",
      runType: "fast",
      providerModel: env.DEFAULT_FAST_MODEL || "openrouter/qwen/qwen3-coder",
    }
  }

  return null
}

export function estimateRunCostUsd(runType: RunType) {
  return runType === "power" ? 0.032 : 0.014
}

export function resolveNotPixelOfferUrl(env: Env) {
  if (env.NOTPIXEL_OFFER_URL) return env.NOTPIXEL_OFFER_URL
  const base = env.NOTPIXEL_BASE_URL || "https://api.notpixel.ai"
  const path = env.NOTPIXEL_OFFER_PATH || "/v1/offer"
  return new URL(path, base).toString()
}
