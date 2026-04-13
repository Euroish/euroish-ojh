# HANDOFF

## Current task
Move Reddit-only MVP from docs-prep into executable Phase-1 skeleton without over-engineering infra.

## Confirmed context
- Reddit only
- single-source MVP
- keep scope narrow
- prioritize model / collection / build order clarity

## Already done
- Added PostgreSQL baseline migration: `src/storage/schema/001_reddit_mvp_init.sql`
- Implemented Reddit connector shells:
  - `src/connectors/reddit/reddit-http.connector.ts`
  - `src/connectors/reddit/reddit-mock.connector.ts`
  - `src/connectors/reddit/reddit.mapper.ts`
- Implemented jobs:
  - `src/jobs/collect-subreddit-about.job.ts`
  - `src/jobs/collect-subreddit-new-posts.job.ts`
  - `src/jobs/build-subreddit-trend-points.job.ts`
- Implemented worker cycle:
  - `src/workers/reddit-phase1.worker.ts`
- Implemented smoke runner:
  - `src/workers/smoke-reddit-phase1.ts`
- Added in-memory repositories for local runnable flow:
  - `src/storage/repositories/in-memory/in-memory.repositories.ts`
- Implemented PostgreSQL repositories:
  - `src/storage/repositories/postgres/*.ts`
- Implemented PostgreSQL client and repository bundle:
  - `src/storage/postgres/postgres-client.ts`
  - `src/storage/postgres/postgres.constants.ts`
  - `src/storage/repositories/postgres/postgres-repository-bundle.ts`
- Added migration runner and PostgreSQL worker entry:
  - `src/storage/schema/run-migrations.ts`
  - `src/workers/run-reddit-phase1-once.postgres.ts`
- Added top-level execution skeleton:
  - `apps/api/src/server.ts`
  - `workers/reddit-phase1-once.ts`
  - `packages/contracts/src/http.ts`
  - `scripts/manual-phase1-run.ts`
  - `tests/integration/reddit-phase1-cycle.test.ts`
- Refactored API boot path for testability:
  - `apps/api/src/create-api-server.ts`
  - `apps/api/src/server.ts` (bootstrap-only entry)
- Added API integration tests (HTTP-level, deterministic in-memory):
  - `tests/integration/api-server.test.ts`
- Added deterministic PostgreSQL verification script:
  - `scripts/verify-phase1-postgres.ts`
  - command: `npm run verify:phase1:postgres`
- Refactored runtime helpers for script reuse:
  - `src/storage/schema/run-migrations.ts` exports `runMigrations`
  - `workers/reddit-phase1-once.ts` exports `runPhase1OnceWithPostgres`
  - `scripts/manual-phase1-run.ts` now calls internal functions directly (no shell spawn)
- Added Reddit HTTP connector runtime-policy unit tests:
  - `tests/unit/reddit-http.connector.test.ts`
  - coverage includes OAuth auth header, retry on `429` with `Retry-After`, retry on network `TypeError`, and non-retryable `400` behavior
- Closed five key product decisions:
  - `docs/open-questions.md`
- Added execution-level kickoff doc:
  - `docs/execution-kickoff.md`
- Added efficiency/precision hardening:
  - PostgreSQL batch write + dedupe in repositories
  - worker target-filtered run mode
  - API input validation + trend window alignment/range cap
- Added minimal TypeScript runtime setup:
  - `package.json`
  - `tsconfig.json`
- Validation done:
  - `npm run typecheck` passed
  - `npm run test` passed
  - `npm run smoke:reddit` passed (mock mode)
  - `npm run verify:phase1:postgres` passed on provided local PostgreSQL URL (mock mode)

## Current blocker
- No active blocker on live path.
- Environment note: previous Node-to-Reddit instability was caused by proxy routing behavior; enabling TUN mode in Sakuracat resolved it.

## Files to read next
- PROJECT.md
- context/current-status.md
- docs/open-questions.md
- docs/execution-kickoff.md
- apps/api/src/create-api-server.ts
- apps/api/src/server.ts
- workers/reddit-phase1-once.ts
- tests/integration/api-server.test.ts
- scripts/verify-phase1-postgres.ts
- src/storage/schema/run-migrations.ts
- tests/unit/reddit-http.connector.test.ts

## Expected next output
- Live API + worker verification on PostgreSQL, then Apify connector activation when external API contract is provided.
