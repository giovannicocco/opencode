# Implementation Plan

## Objective

Turn the OpenCode fork into a prepaid, compute-time-based coding CLI where users pick from a limited set of open-source coding models, pay with credits, and are billed by active compute time instead of tokens.

The product keeps the OpenCode CLI experience and command surface, but replaces local/provider assumptions with a service-backed session runtime built on Cloudflare Workers, Durable Objects, R2, Neon, Stripe, and GPU workers.

---

## Product Thesis

The user should:

- open the CLI instantly
- see their current or last-used model
- not pay anything until compute is actually attached
- be able to switch models with `/model`
- resume sessions even after the GPU worker is gone
- top up credits and continue without token anxiety

The core idea is:

**session != GPU worker**

A session is durable and resumable.
A GPU worker is a temporary compute attachment.

---

## UX Principles

1. The CLI opens instantly with no GPU attached.
2. Compute is attached only on first real prompt or resume action.
3. The current model is always visible.
4. Cost and session state are always visible.
5. Model switching is explicit and restarts compute.
6. Resume works even if the old GPU no longer exists.
7. Billing is prepaid with Stripe credits.

---

## CLI UX

### Startup

```bash
$ opencode
```

```text
OpenCode CLI

Model: deepseek-coder (last used)
Status: no compute attached
Balance: $10.00

Type a prompt to start
Use /model to change model
Use /help for commands
```

At this stage there is no attached GPU and no billing.

### First prompt

```text
> refactor this function
```

```text
Attaching compute (deepseek-coder)...
→ allocating GPU
→ loading model

Connected (L4 • deepseek-coder • $0.016/min)
Session started
```

Prompt state example:

```text
[deepseek-coder | 3m | $0.05] >
```

### `/model`

```text
/model
```

```text
Available models:

1. deepseek-coder
2. qwen-coder
3. deepseek-coder-33b

Current: deepseek-coder

Select a model (1-3) or press enter to cancel
```

If the user switches:

```text
Switching model will restart your compute session.

Current session:
→ duration: 5m 12s
→ cost: $0.08

Continue? (y/n)
```

On confirm:

```text
Saving session state...
Detaching compute...

Attaching compute (deepseek-coder-33b)...
→ allocating GPU
→ loading model

Connected (L40S • deepseek-coder-33b)
```

### Idle pause

```text
No activity detected

Session will pause in 60s
```

Then:

```text
Session paused (idle)

Context saved
Total cost: $0.12

Type anything to resume
```

### Insufficient balance

```text
Insufficient balance

Your session has been paused

Add credits to continue
Press Enter to open billing
```

Pressing Enter opens the Stripe billing portal in the browser.

### Successful top-up

```text
Opening billing...
```

Then after confirmation:

```text
Payment received

Balance: $10.00

Resuming session...
```

### `/status`

```text
Session

Model: deepseek-coder
Compute: attached (L4)
Duration: 8m 21s
Cost: $0.14

Balance: $9.86
```

### `/help`

```text
Commands:

/model     change model
/status    show session info
/continue  resume last session
/fork      fork current session
/exit      end session
/help      show this menu
```

---

## Core Product Model

### Session

A session is the durable state of the user's work.

A session includes:

- user identity
- project fingerprint
- current model preference
- compact summary
- latest snapshot pointer
- event history
- billing state
- active compute attachment, if any

### Compute attachment

A compute attachment is a temporary runtime bound to a session.

It includes:

- model runtime
- worker id
- gpu type
- provider metadata
- start time
- status
- heartbeat

A session may have multiple compute attachments across its lifetime.

---

## Architecture Overview

### Components

1. **OpenCode fork**
   - existing CLI shell and command UX
   - primary CLI/runtime package remains in `packages/opencode`
   - modified to support service-backed session runtime

2. **Cloudflare Workers**
   - public API
   - auth
   - model catalog
   - billing portal URLs
   - session endpoints

3. **Durable Objects**
   - `SessionDO(session_id)` for per-session state and coordination
   - `SchedulerDO(pool_or_region)` for worker allocation and queueing

4. **R2**
   - session snapshots and serialized payloads

5. **Neon**
   - source of truth for sessions, users, wallet, ledger, events, snapshot metadata, workers, pricing rules, and pointers needed for resume

6. **Stripe**
   - credits and billing portal
   - wallet top-up via webhook

7. **GPU Provider**
   - initial target: Runpod
   - worker runs model server and agent runtime

8. **Inference Server**
   - initial target: vLLM

---

## Request Lifecycle

### 1. Start shell

- user runs `opencode`
- CLI loads last session and last model metadata remotely
- no compute is attached yet

### 2. First prompt

- CLI calls `POST /session/start`
- Worker validates auth and wallet
- Worker creates or resumes `SessionDO`
- `SessionDO` asks `SchedulerDO` for compute
- `SchedulerDO` tries to:
  1. reuse current warm worker for session
  2. reuse shared warm worker for model
  3. provision new GPU worker
- once ready, the CLI attaches and billing starts

### 3. Active usage

- CLI sends prompts and heartbeats
- worker sends health heartbeats
- `SessionDO` tracks state, timers, and transitions
- important events are flushed to Neon
- latest snapshot payload is persisted to R2 when needed

### 4. Idle pause

- no heartbeat or prompt for configured timeout
- `SessionDO` alarm fires
- session moves to `idle`
- summary and snapshot are persisted
- compute is detached
- billing stops

### 5. Resume

- user types prompt or runs `/continue`
- session is rehydrated from Neon + R2
- `SchedulerDO` reattaches or reprovisions compute
- prompt flow continues

### 6. Switch model

- user runs `/model`
- CLI confirms restart of compute session
- `SessionDO` persists snapshot
- current compute is detached
- new model preference is saved
- `SchedulerDO` provisions or reuses compatible worker
- session resumes on new model

---

## Durable Objects Design

### `SessionDO`

Responsibilities:

- own the live state machine of one session
- serialize concurrent state changes
- handle attach, detach, pause, resume, switch-model
- track heartbeats and alarms
- decide when to flush snapshots and summaries
- maintain active compute attachment metadata

State examples:

- `requested`
- `queued`
- `provisioning`
- `ready`
- `active`
- `idle`
- `terminating`
- `ended`
- `failed`

### `SchedulerDO`

Responsibilities:

- keep an up-to-date registry of available workers
- decide reuse vs cold start
- apply reuse-first and cheapest-fit logic
- coordinate per-model or per-pool queues
- track worker occupancy and fallback options

Worker states:

- `provisioning`
- `warming`
- `ready`
- `busy`
- `draining`
- `terminating`
- `dead`

---

## Storage Strategy

### Neon is the source of truth

Store permanently in Neon:

- users
- wallets
- wallet ledger
- sessions
- compact summaries
- session events
- snapshot metadata
- resume pointers
- workers
- allocations
- pricing rules

### R2 stores snapshot payloads

Use R2 for:

- serialized long-form session payloads
- latest resumable session snapshot
- large tool outputs worth preserving
- future export/archive features

### Durable Objects keep hot coordination state

DOs should keep:

- active session state
- live timers
- heartbeat counters
- in-flight transitions
- locks and temporary event buffers

### Why KV is removed

KV is intentionally not part of the core architecture.

The design should remain simple unless a clear performance or operational advantage appears later.
For v1, DO + Neon + R2 is sufficient:

- DO for hot state and coordination
- Neon for canonical durable records
- R2 for larger snapshot payloads

If needed later, KV can be introduced only as an optimization layer, not as a required dependency.

---

## Session Persistence and Resume

Resume must work even when the old GPU is gone.

### Session persistence layers

1. **Compact summary in Neon**
   - the canonical recovery summary
2. **Resume pointer in Neon**
   - points to the latest snapshot metadata
3. **Snapshot payload in R2**
   - richer recovery payload when needed
4. **Live state in SessionDO**
   - current hot state only

### Resume strategy

On resume:

- resolve session by explicit id, project fingerprint, or user's last session
- recover metadata and summary from Neon
- recover latest snapshot reference from Neon
- load snapshot payload from R2 if needed
- recreate `SessionDO` if absent
- allocate new compute if needed
- inject compacted context into new runtime

---

## Billing Model

### Principles

- prepaid credits only
- no postpaid token billing
- cost starts only when compute is attached
- cost pauses when compute is detached
- model selection remains explicit

### Stripe behavior

- user adds credits via Stripe Billing Portal or hosted flow
- Stripe webhook updates wallet balance in Neon
- CLI polls wallet state after billing portal opens
- session resumes automatically after successful top-up

### Billing states

- `authorized`
- `metering`
- `paused`
- `closed`

### Insufficient balance behavior

When balance hits zero or below threshold:

- session pauses
- compute detaches
- CLI displays billing prompt
- user presses Enter to open billing
- wallet refresh triggers resume path

---

## Model Catalog Strategy

The product should expose a small curated set of coding models.

Initial suggestion:

- one lighter default model
- one strong mid-tier model
- one stronger large model

The user chooses models directly through `/model`.

Do not expose synthetic tiers like fast/pro/max in the CLI.
The CLI should remain model-first.

---

## GPU Scheduling Strategy

Initial scheduling rules:

1. reuse current session worker if alive
2. reuse warm shared worker of same model if possible
3. fallback to compatible GPU for same model
4. provision cold worker if needed

Initial constraints:

- keep model catalog small
- allow cold start in early versions
- use aggressive idle timeouts
- avoid visible GPU choice in the CLI

The user chooses the model.
The backend chooses the worker and GPU.

---

## Monorepo Strategy

The repository already uses workspaces and Turbo, so the implementation should extend the existing monorepo instead of creating a second monorepo structure.

### Recommended package structure

```text
packages/
  opencode/
  service/
  shared/
  sdk/
    js/
```

### Package responsibilities

#### `packages/opencode`

This remains the primary CLI/runtime package.
It should own:

- CLI shell and command UX
- attach-on-first-prompt behavior
- `/model`, `/status`, `/continue`, `/fork`, `/exit`
- billing portal launch behavior
- session and cost display

It should consume the service client instead of embedding backend orchestration logic directly.

#### `packages/service`

This should contain the service runtime:

- Hono API
- Durable Objects
- session lifecycle orchestration
- scheduler
- billing integration
- Neon integration
- R2 integration
- GPU provider integration

Suggested internal structure:

```text
packages/service/
  src/
    index.ts
    routes/
    durable/
      session-do.ts
      scheduler-do.ts
    lib/
      neon.ts
      r2.ts
      stripe.ts
      runpod.ts
      auth.ts
      billing.ts
      snapshots.ts
      models.ts
```

#### `packages/shared`

This should contain only shared contracts and schemas:

- session states
- billing types
- model catalog types
- API contracts
- zod schemas
- reusable enums

Suggested internal structure:

```text
packages/shared/
  src/
    session.ts
    billing.ts
    models.ts
    api.ts
    enums.ts
    schemas/
```

`packages/shared` must remain disciplined and should not become a dumping ground for unrelated logic.

#### `packages/sdk/js`

The existing SDK package should be extended instead of creating a parallel client package.

Suggested namespace inside the SDK:

```text
packages/sdk/js/src/service/
  client.ts
  session.ts
  billing.ts
  models.ts
  types.ts
```

This service namespace should expose the client APIs used by `packages/opencode`, such as:

- `startSession`
- `resumeSession`
- `switchModel`
- `getSessionStatus`
- `getModels`
- `openBilling` or equivalent flow

### `infra/` usage

`infra/` should remain a support/configuration layer, not the main runtime package.

Use it for:

- Worker deployment config
- SQL migrations
- environment examples
- deployment scripts

Suggested structure:

```text
infra/
  workers/
    wrangler.jsonc
  sql/
    0001_init.sql
    0002_wallets.sql
    0003_sessions.sql
    0004_snapshots.sql
  env/
    example.dev.env
```

Do not place the main Worker application code in `infra/`.
That code belongs in `packages/service`.

### `specs/` usage

`specs/` should be used for architecture and product design docs.

Suggested structure:

```text
specs/
  service-runtime/
    implementation.md
    cli-ux.md
    session-lifecycle.md
    billing-flow.md
    scheduler.md
```

Moving `implementation.md` there can happen later once the repo structure is ready.

---

## Proposed Initial Roadmap

### Phase 1 — Service-backed session foundation

- fork OpenCode and preserve CLI UX
- add service auth and service-backed session bootstrap
- show last model, balance, and no-compute state on startup
- attach compute only on first prompt

### Phase 2 — Scheduler and compute attachments

- implement Worker API for session start/status/resume
- implement `SessionDO` and `SchedulerDO`
- integrate first GPU provider
- run one or two curated models remotely

### Phase 3 — Resume and snapshots

- implement compact summary persistence
- implement snapshot metadata + payload separation
- support `/continue`, `/session`, `/fork`
- add project fingerprint detection

### Phase 4 — Billing and wallet

- add wallet tables in Neon
- integrate Stripe portal and webhooks
- add insufficient balance pause flow
- add automatic resume after top-up

### Phase 5 — Production hardening

- observability and tracing
- worker health and stale session cleanup
- crash-safe transitions
- retry logic for provider operations
- pricing controls and model feature flags

---

## Minimal Neon Schema

Core tables:

- `users`
- `wallets`
- `wallet_ledger`
- `models`
- `gpu_pools`
- `model_pool_mapping`
- `workers`
- `sessions`
- `session_snapshots`
- `session_events`
- `worker_allocations`
- `pricing_rules`

This schema has already been defined conceptually and should be added in migrations in a follow-up step.

---

## Non-Goals for v1

Do not optimize early for:

- many providers
- many models
- enterprise private deployments
- complex plan packaging
- token-based pricing
- visible GPU selection in the CLI

v1 should prove:

- curated model selection
- compute attach on demand
- durable session resume
- prepaid wallet flow
- pricing by active compute time

---

## Summary

This implementation should not be treated as a generic provider plugin.
It is a product fork of OpenCode with a new execution model:

- service-backed session state
- detachable compute runtime
- prepaid wallet billing
- resumable coding sessions independent of GPU lifecycle

The CLI remains familiar.
The infrastructure model changes completely.
