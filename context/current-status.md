# CURRENT STATUS

## Project state

- Main line: Reddit monitoring product MVP
- Current priority: run executable Phase-1 skeleton through API + worker entrypoints
- Known constraints:
  - keep scope narrow
  - prefer data model + collection plan before heavy implementation
  - avoid mixing GEO operations with product building
  - keep modular monolith + async worker + connector boundary

## Last aligned

- Date: 2026-04-11
- Scope lock confirmed:
  - source: Reddit only
  - monitored object: subreddit
  - primary value: trend change

## Strict review-fix decisions

- [x] PostgreSQL `metrics_snapshot` uniqueness behavior fixed and documented
- [x] `metric_name` control fixed via enum + scope check
- [x] `stableUuidFromString` allowed scope decided, enforced, and documented
- [x] live connector runtime policy finalized and documented
- [x] fixed Reddit source seed ID policy documented for MVP
- [x] no SQL repository expansion performed before the above decisions
- [x] five open questions closed in `docs/open-questions.md`
- [x] top-level execution skeleton created (`apps/workers/packages/scripts/tests`)
- [x] PostgreSQL write path optimized to batch SQL + pre-deduplication
- [x] API input guardrails and trend window alignment implemented
- [x] worker supports precise target-filtered run
- [x] API server logic extracted to dependency-injected module (`create-api-server`)
- [x] API integration tests added (real HTTP flow with in-memory repositories)
- [x] PostgreSQL one-command verification script added (`npm run verify:phase1:postgres`)
- [x] migration runner refactored for reusable function call (`runMigrations`)
- [x] Reddit HTTP connector runtime policy covered by unit tests (retry/backoff/auth header/status behavior)

## Open choices

### First monitored object
- [x] subreddit
- [ ] keyword
- [ ] account
- [ ] post

### First core value
- [x] trend change
- [ ] growth ranking
- [ ] anomaly alert

## Missing docs
- [x] mvp-brief.md
- [x] data-model.md
- [x] collection-strategy.md
- [x] architecture-sketch.md
- [x] architecture.md
- [x] reddit-mvp-phase1-plan.md
- [x] repo-structure.md

## Repo implementation status (actual)

- [x] initial `src/` skeleton created
- [x] domain entity interfaces created
- [x] repository interfaces created
- [x] reddit connector contracts created
- [x] use-case orchestration implemented (`sync-subreddit-trend`)
- [x] storage migration baseline added (`001_reddit_mvp_init.sql`)
- [x] connector HTTP shell implemented (`reddit-http.connector.ts`)
- [x] mapper implementation added (`reddit.mapper.ts`)
- [x] worker cycle runner implemented (`reddit-phase1.worker.ts`)
- [x] collection job implemented (`collect_subreddit_about`)
- [x] collection job implemented (`collect_subreddit_new_posts`)
- [x] trend aggregation job implemented (`build_subreddit_trend_points`)
- [x] deterministic smoke pipeline added (`smoke-reddit-phase1.ts`, default mock mode)
- [x] PostgreSQL repository adapters implemented (`src/storage/repositories/postgres/*`)
- [x] PostgreSQL client + repository bundle implemented (`src/storage/postgres/*`)
- [x] migration runner implemented (`npm run db:migrate`)
- [x] trend algorithm schema upgrade migration added (`003_trend_algorithm_upgrade.sql`)
- [x] PostgreSQL worker one-shot entry added (`npm run worker:reddit:once`)
- [x] local typecheck passing (`npm run typecheck`)
- [x] local test suite passing with API integration coverage (`npm run test`)
- [x] smoke run passing in mock mode (`npm run smoke:reddit`)
- [x] PostgreSQL verification chain passing with provided `DATABASE_URL` in mock mode (`npm run verify:phase1:postgres`)
- [x] PostgreSQL connected with provided `DATABASE_URL`
- [x] migrations applied on real PostgreSQL (`npm run db:migrate`)
- [x] live worker path succeeded (`npm run worker:reddit:once`)
- [x] key tables received live data:
  - `raw_reddit_event`
  - `content`
  - `metrics_snapshot`
  - `subreddit_trend_point`
- [x] skill cleanup completed for algorithm phase:
  - quarantined low-trust external skill package (`code-quality-analyzer`)
  - added project-local `skills/reddit-trend-algo/SKILL.md`

## Live connectivity conclusion

- Live Reddit path is verified as working.
- Prior instability root cause was environment/runtime proxy routing behavior.
- Enabling TUN mode in Sakuracat resolved inconsistent Node-to-Reddit connectivity.
- This issue is:
  - not a PostgreSQL issue
  - not an architecture issue
  - not a core connector design failure

## MVP design readiness check (docs)

### architecture
- Status: pass (enough for MVP start)
- Notes: module boundaries/read-write flow are clear and aligned with modular monolith + async worker + connector boundary.

### data-model
- Status: pass (fixed)
- Notes: migration now uses partial unique indexes + `metric_name_enum` + metric scope check.

### collection-strategy
- Status: pass (fixed)
- Notes: canonical 15m UTC window, default `limit=50`, max pages per run=1, and live connector runtime policy are documented.

## Current next step

Proceed with live verification and connector-provider progression:
- keep using `verify:phase1:postgres` as the deterministic DB-path acceptance command
- run `worker:phase1:once` in live mode on target PostgreSQL
- start `app:api` and verify `GET /v1/trends/subreddit/:subreddit` with live-written data
- when Apify API contract is available, replace `RedditApifyConnector` placeholder with real mapping/runtime call path
