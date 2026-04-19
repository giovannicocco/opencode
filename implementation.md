# Implementation Plan

## Objective

Turn the OpenCode fork into a prepaid, remote-compute coding CLI where users pick from a limited set of open-source coding models, pay with credits, and are billed by active compute time instead of tokens.

The product keeps the OpenCode CLI experience and command surface, but replaces local/provider assumptions with a remote session runtime backed by Cloudflare Workers, Durable Objects, KV/R2, Neon, Stripe, and GPU workers.

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
   - modified to support remote session runtime

2. **Cloudflare Workers**
   - public API
   - auth
   - model catalog
   - billing portal URLs
   - session endpoints

3. **Durable Objects**
   - `SessionDO(session_id)` for per-session state and coordination
   - `SchedulerDO(pool_or_region)` for worker allocation and queueing

4. **KV**
   - fast lookup cache
   - last session pointers
   - latest snapshot pointers
   - model catalog cache
   - pricing cache

5. **R2**
   - large snapshots and serialized payloads

6. **Neon**
   - source of truth for sessions, users, wallet, ledger, events, snapshots metadata, workers, pricing rules

7. **Stripe**
   - credits and billing portal
   - wallet top-up via webhook

8. **GPU Provider**
   - initial target: Runpod
   - worker runs model server and agent runtime

9. **Inference Server**
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
- latest snapshot pointer is updated in KV

### 4. Idle pause

- no heartbeat or prompt for configured timeout
- `SessionDO` alarm fires
- session moves to `idle`
- summary and snapshot are persisted
- compute is detached
- billing stops

### 5. Resume

- user types prompt or runs `/continue`
- session is rehydrated from Neon + KV/R2
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
- workers
- allocations
- pricing rules

### KV is a fast cache and pointer layer

Store in KV:

- `user:{id}:last_session`
- `project:{fingerprint}:last_session`
- `session:{id}:latest_snapshot_pointer`
- model catalog cache
- pricing cache

### R2 stores large snapshot payloads

Use R2 for:

- serialized long-form session payloads
- large tool outputs worth preserving
- future export/archive features

### Durable Objects keep hot coordination state

DOs should keep:

- active session state
- live timers
- heartbeat counters
- in-flight transitions
- locks and temporary event buffers

---

## Session Persistence and Resume

Resume must work even when the old GPU is gone.

### Session persistence layers

1. **Compact summary in Neon**
   - the canonical recovery summary
2. **Latest snapshot pointer in KV**
   - fast lookup for recovery path
3. **Optional large payload in R2**
   - richer recovery when needed
4. **Live state in SessionDO**
   - current hot state only

### Resume strategy

On resume:

- resolve session by explicit id, project fingerprint, or user's last session
- recover metadata and summary from Neon
- recover latest snapshot pointer from KV
- load large snapshot payload from R2 if needed
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

## Proposed Initial Roadmap

### Phase 1 — Remote session foundation

- fork OpenCode and preserve CLI UX
- add remote auth and remote session bootstrap
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

## Folder Strategy

Suggested logical separation inside the fork:

```text
/internal
  /core
  /commands
  /session
  /ui
  /providers

/internal/autocode
  /api
  /auth
  /billing
  /compute
  /resume
  /models
  /config
```

The OpenCode parts remain responsible for CLI ergonomics.
The new `autocode` namespace holds remote runtime, billing, resume, and scheduler integration.

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
- remote compute attach on demand
- durable session resume
- prepaid wallet flow
- pricing by active compute time

---

## Summary

This implementation should not be treated as a generic provider plugin.
It is a product fork of OpenCode with a new execution model:

- remote session state
- detachable compute runtime
- prepaid wallet billing
- resumable coding sessions independent of GPU lifecycle

The CLI remains familiar.
The infrastructure model changes completely.
