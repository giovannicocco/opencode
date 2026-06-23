# OpenFrontier provider architecture

OpenFrontier is the only model provider that should be exposed by this fork.

## Runtime flow

```text
OpenCode Fork / CLI
  -> OpenFrontier Publisher Backend
  -> Auth + Quota + Usage Ledger + Rate Limit
  -> NotPixel SDK/API
  -> OpenRouter / Provider LLM
  -> Response + Sponsored/Organic Recommendation
```

## Public models

The CLI should expose only two model aliases:

- `openfrontier/power` or `power`
- `openfrontier/fast` or `fast`

The provider backend owns the real mapping:

- `power` -> frontier coding model, for example GLM 5.2
- `fast` -> faster coding model, for example Qwen Coder / DeepSeek Flash-class model

The CLI must not call OpenRouter directly. The CLI sends requests to the OpenFrontier backend, and the backend calls NotPixel, which then calls OpenRouter/provider infrastructure.

## Model catalog

`packages/opencode/script/generate.ts` embeds a static OpenFrontier model catalog instead of fetching `https://models.dev/api.json` by default.

This prevents the compiled CLI snapshot from exposing third-party model gateways by default.

## Remaining cleanup

The repo still contains upstream provider source files and dependencies. Remove them only after the static catalog path is validated with `bun run typecheck` and a local CLI smoke test.

Next cleanup targets:

1. Remove unused bundled provider dependencies from `packages/opencode/package.json`.
2. Reduce `packages/llm/src/providers/index.ts` exports to OpenFrontier/OpenAI-compatible only.
3. Remove direct OpenRouter provider usage from public config/auth flows.
4. Rename binary/package branding from `opencode` to `openfrontier` after provider routing is stable.
