import type { Env, Reservation } from "./types"
import { normalizeInput, resolveNotPixelOfferUrl } from "./http"

export async function callNotPixel(params: {
  env: Env
  body: any
  userId: string
  reservation: Reservation
  placement?: string
}) {
  const { env, body, userId, reservation } = params
  const offerUrl = resolveNotPixelOfferUrl(env)

  const payload = {
    publisherId: env.PUBLISHER_ID || "pub_openfrontier",
    userId,
    model: reservation.providerModel,
    input: normalizeInput(body),
    messages: body.messages || undefined,
    stream: Boolean(body.stream),
    placement: params.placement || body.placement || "cli_response_footer",
    metadata: {
      publisher: "openfrontier",
      modelAlias: reservation.modelAlias,
      runType: reservation.runType,
      reservationId: reservation.id,
      estimatedCostUsd: reservation.estimatedCostUsd,
      source: "openfrontier-cli",
    },
  }

  return fetch(offerUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.NOTPIXEL_API_KEY ? { authorization: `Bearer ${env.NOTPIXEL_API_KEY}` } : {}),
      ...(env.OPENROUTER_API_KEY ? { "x-openrouter-api-key": env.OPENROUTER_API_KEY } : {}),
      "x-openfrontier-reservation-id": reservation.id,
    },
    body: JSON.stringify(payload),
  })
}
