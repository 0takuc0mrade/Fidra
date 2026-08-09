# Fidra V1.5.1 Postgres migration map

Status: implementation checkpoint. This document maps the existing V1.4/V1.5
runtime state to Neon Postgres before the storage implementation is changed.
It does not authorize Circle or Arc writes.

## Safety boundary

- `SANDBOX_WRITES_ENABLED=false` and `WORKER_GAS_SEED_ENABLED=false` remain the
  required migration and integration-test posture.
- Circle user tokens, refresh tokens, OTPs, device encryption material, private
  keys, API keys, email addresses, session cookies, and `DATABASE_URL` are never
  persisted in Postgres.
- The existing in-memory `SessionStore` remains the only store for short-lived
  Circle authentication material.
- Circle users are represented durably only by the existing SHA-256 `userRef`.
- Arc receipts remain the source of truth for completed protocol actions.
- Hosted/production mode requires Postgres and fails closed when it is missing,
  unreachable, or behind the required schema version. It never silently falls
  back to JSON files.

## Current state and target tables

| Current owner | Current durable state | Postgres target | Concurrency rule |
| --- | --- | --- | --- |
| `DemoWorkflowStore` | workflow, task, claim, advance, settlement, error and timestamps | `workflows` | one non-terminal workflow per `user_ref`; row/advisory locking for transitions |
| `OperationStore` | Circle challenge/transaction correlation (currently memory, partially reconstructed from workflow JSON) | `operations` | unique idempotency key; one active purchase operation per workflow/claim |
| `WalletStore` | public Circle wallet metadata and gas-seed receipt | `wallets`, `gas_seeds` | unique wallet ID/address and one gas seed per wallet |
| `dailyCertifiedFaceTotal` | derived daily claim total | `budget_usage`, `budget_reservations` | atomic conditional reservation before an external write is authorized |
| `dailyConfirmedSeedTotal` | derived daily seed total | `budget_usage`, `budget_reservations` | atomic conditional reservation plus unique wallet reservation |
| `RequestLimiter` | process-local timestamps | `rate_limit_buckets` | atomic bounded increment per hashed key/window |
| migration runner | none | `schema_migrations` | checksum-protected, ordered, non-destructive migrations |

The `workflows.payload` and `operations.payload` JSONB columns retain the public
nested receipt shape used by the current API. Queryable identity, state,
correlation and uniqueness fields are also stored as typed columns; JSONB is not
used as a substitute for database constraints.

## Workflow states and recovery

Normal forward order is:

`wallet_ready -> gas_ready -> task_complete -> claim_created -> claim_certified
-> awaiting_approval -> arc_pending -> advance_confirmed -> complete`

`complete` and `cancelled` are terminal. Repeating the same state is idempotent.
An Arc/Circle verification failure may return `awaiting_approval` or
`arc_pending` to `claim_certified` so the already-certified claim can be retried;
it does not alter the claim or create a second one. Every transition is written
with a compare-and-update guard under a database advisory lock.

At restart, workflows and operations are read directly from Postgres. A Circle
operation stores only hashed ownership (`user_ref`) plus public operation and
receipt metadata. If Circle reports completion, Fidra still confirms the Arc
receipt and contract state before advancing the workflow.

## External-write authorization

Before a caller may reach an external write boundary, the repository creates a
durable reservation:

- Demo claim: `(budget_type, UTC day, workflow id)` is unique and atomically
  increments the daily amount only when the configured limit is not exceeded.
- Gas seed: the wallet row and gas-seed reservation are locked; a unique wallet
  seed and daily budget reservation are created atomically.
- Circle advance: an operation/idempotency row is reserved before challenge
  creation. Concurrent requests recover that row instead of creating another
  challenge. The Circle challenge ID is attached afterward.

Failed operations keep an auditable non-secret status. A reservation may be
released only before an external write is submitted; uncertain submissions are
recovered from Circle/Arc rather than retried blindly.

## Adapter and rollout rules

- `createStorage()` selects Postgres whenever `DATABASE_URL` is configured.
- JSON/memory adapters remain available only for explicit local/unit-test use.
- Production configuration without `DATABASE_URL` is invalid.
- Startup applies safe versioned migrations, verifies the required schema, then
  begins listening. Migration or connection failure stops startup.
- `/api/health` reports only process health and database
  configured/reachable/schema-ready booleans; it never returns connection data.
- Shutdown drains the HTTP server and then closes the bounded Postgres pool.

## Validation plan

1. Existing deterministic unit and browser-flow tests continue to use explicit
   JSON/memory adapters.
2. Repository tests exercise idempotency, state guards and budget behavior.
3. Opt-in Neon tests run migrations against the configured ignored environment,
   create only uniquely prefixed synthetic rows, and delete only those rows.
4. Two independent pools simulate a process restart and concurrent instances.
   They must recover the same workflow/operation and admit only one workflow,
   gas-seed reservation, Circle operation and budget reservation.
5. Integration tests never call Circle or submit an Arc transaction.

