const openfrontierBaseUrl = process.env.OPENFRONTIER_BASE_URL || "https://api.openfrontier.ai/v1"

const openfrontierCatalog = {
  openfrontier: {
    id: "openfrontier",
    name: "OpenFrontier",
    api: openfrontierBaseUrl,
    env: ["OPENFRONTIER_TOKEN"],
    npm: "@ai-sdk/openai-compatible",
    models: {
      power: {
        id: "power",
        name: "OpenFrontier Power",
        family: "openfrontier",
        release_date: "2026-06-23",
        attachment: true,
        reasoning: true,
        temperature: true,
        tool_call: true,
        modalities: {
          input: ["text", "image", "pdf"],
          output: ["text"],
        },
        cost: {
          input: 0,
          output: 0,
          cache_read: 0,
          cache_write: 0,
        },
        limit: {
          context: 1000000,
          output: 32000,
        },
      },
      fast: {
        id: "fast",
        name: "OpenFrontier Fast",
        family: "openfrontier",
        release_date: "2026-06-23",
        attachment: true,
        reasoning: true,
        temperature: true,
        tool_call: true,
        modalities: {
          input: ["text", "image", "pdf"],
          output: ["text"],
        },
        cost: {
          input: 0,
          output: 0,
          cache_read: 0,
          cache_write: 0,
        },
        limit: {
          context: 128000,
          output: 16000,
        },
      },
    },
  },
}

export const modelsData = process.env.OPENFRONTIER_MODELS_JSON
  ? await Bun.file(process.env.OPENFRONTIER_MODELS_JSON).text()
  : JSON.stringify(openfrontierCatalog)

console.log(`Loaded OpenFrontier model snapshot from ${openfrontierBaseUrl}`)
