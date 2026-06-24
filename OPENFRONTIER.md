# OpenFrontier provider architecture

OpenFrontier is the only model provider that should be exposed by this fork.

## Runtime flow

```text
OpenCode Fork / CLI
  -> OpenFrontier Publisher Backend
  -> Durable Object UserGate
  -> D1 Auth + Quota + Usage Ledger
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

## Backend API connection

The static model catalog is wired to the OpenFrontier Publisher Backend.

Default API base URL:

```bash
https://api.openfrontier.ai/v1
```

To point a build at a different Worker URL, build with:

```bash
OPENFRONTIER_BASE_URL="https://<your-worker-or-domain>/v1" bun run --cwd packages/opencode build --single --skip-embed-web-ui
```

The CLI user token is read from:

```bash
OPENFRONTIER_TOKEN="..."
```

This token belongs to the OpenFrontier Publisher Backend. It is sent to the backend as the provider bearer token and is used there for:

- auth
- quota checks
- Power/Fast Run reservation
- usage ledger
- rate limit
- refund on upstream failure

The CLI should never receive or store:

- OpenRouter provider keys
- NotPixel server keys
- publisher ledger credentials

## OpenAI-compatible endpoint contract

The OpenFrontier backend must expose an OpenAI-compatible API:

```text
GET  /v1/models
POST /v1/chat/completions
GET  /v1/me/usage
```

The important path for the CLI is:

```text
POST /v1/chat/completions
Authorization: Bearer <OPENFRONTIER_TOKEN>
```

The request model should be one of:

```text
power
fast
```

The Worker backend maps those aliases internally to the NotPixel/OpenRouter provider model.

## Durable Object gate

The backend package lives in:

```text
packages/openfrontier-api
```

It defines a Durable Object class:

```text
UserGate
```

`UserGate` is keyed by `userId` and runs before D1 credit reservation:

```text
POST /v1/chat/completions
  -> authMiddleware
  -> UserGate.acquire(userId)
  -> reserveRun() in D1
  -> callNotPixel()
  -> completeRun() or refundRun() in D1
  -> UserGate.release(userId)
```

The Durable Object is responsible for:

- serializing concurrent calls per user
- blocking double-spend races before D1 reservation
- enforcing a per-minute request window
- returning 409 when another request is already running for the same user
- returning 429 when the user hits the minute limit

D1 remains the source of truth for:

- users
- credit balances
- usage ledger
- credit ledger
- refunds

## Durable Object binding

`packages/openfrontier-api/wrangler.toml` includes:

```toml
[[durable_objects.bindings]]
name = "USER_GATE"
class_name = "UserGate"

[[migrations]]
tag = "v1_user_gate"
new_sqlite_classes = ["UserGate"]
```

## Local/dev commands

```bash
bun install
bun run --cwd packages/openfrontier-api typecheck
bun run --cwd packages/openfrontier-api dev
```

D1 migrations:

```bash
wrangler d1 migrations apply openfrontier --local
wrangler d1 migrations apply openfrontier --remote
```

Deploy:

```bash
bun run --cwd packages/openfrontier-api wrangler deploy
```

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
