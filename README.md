# Reddit Monitoring Lean Kit

This kit is intentionally small.

It follows the principle from your workflow notes:
- short standing rules
- short skill files
- externalized context
- minimal mode separation
- no heavy persona setup

Use this when you want Codex to stay focused instead of being buried under too many files.

## Local commands

- `npm install`
- `npm run typecheck`
- `npm run test`
- `npm run smoke:reddit` (default mock mode, deterministic)
- `npm run smoke:reddit:live` (attempts live Reddit fetch; may fail in restricted networks)
- `npm run db:migrate` (requires `DATABASE_URL`)
- `npm run worker:reddit:once` (requires `DATABASE_URL`, optional `REDDIT_ACCESS_TOKEN`)
- `npm run worker:phase1:once` (new top-level worker entry)
- `npm run worker:phase1:scheduler` (continuous collection loop, default 60s tick)
- `npm run app:api` (start minimal Phase-1 API)
- `npm run phase1:manual-run` (manual migration + one worker run)
- `npm run verify:phase1:postgres` (migrate + run + DB count summary, default `REDDIT_RUN_MODE=mock`)
- `npm run trend:board:summary` (CLI trend board summary from PostgreSQL read model)

## Runtime env

- `DATABASE_URL`: PostgreSQL connection string (required for migration/worker PostgreSQL path)
- `REDDIT_ACCESS_TOKEN`: optional; when set, connector uses OAuth endpoint
- `REDDIT_USER_AGENT`: optional custom User-Agent for Reddit requests
- `REDDIT_LIVE_PROVIDER`: live provider selector (`http` default, `apify` optional)
- `APIFY_REDDIT_ACTOR_RUN_ENDPOINT`: optional endpoint used when `REDDIT_LIVE_PROVIDER=apify`
- `APIFY_TOKEN`: optional Apify token used when `REDDIT_LIVE_PROVIDER=apify`
- `REDDIT_RUN_SUBREDDIT`: optional target for one-shot worker, default `machinelearning`
- `REDDIT_RUN_SUBREDDITS`: optional comma-separated targets for scheduler bootstrap, e.g. `machinelearning,datascience`
- `PHASE1_SCHEDULER_INTERVAL_MS`: scheduler polling interval, default `60000` (minimum `5000`)
- `PHASE1_SCHEDULER_RUN_ON_START`: run one cycle immediately on boot (`true`/`false`)
- `COLLECTION_JOB_MAX_RETRIES`: per-job retry ceiling before dead-letter, default `3`
- `COLLECTION_JOB_RETRY_BASE_MS`: base backoff delay, default `30000`
- `COLLECTION_JOB_RETRY_MAX_MS`: max backoff delay, default `600000`
- `API_BEARER_TOKEN`: required for `npm run app:api`; protects `/v1/*` routes
- `API_CORS_ALLOW_ORIGINS`: comma-separated CORS allowlist, default `*`
- `API_CORS_MAX_AGE_SECONDS`: preflight cache seconds, default `300`

## Docs

- SQL review: `docs/sql-repository-review.md`
- operations runbook: `docs/operations-runbook.md`
- API acceptance examples: `docs/phase1-api-acceptance-examples.md`
- open questions (closed): `docs/open-questions.md`
- execution kickoff: `docs/execution-kickoff.md`

## Phase-1 API boundary

- `GET /healthz`
- `POST /v1/targets/subreddit`
- `POST /v1/runs/reddit-phase1`
- `GET /v1/trends/subreddit/:subreddit`

Response quality defaults:
- every response includes `requestId` (also mirrored in `x-request-id` header)
- trend response includes `timeline`, `summary`, `topMovers`, `recentAnomalies`, and per-point `scoreComponents`
- errors include stable `errorCode` for acceptance checks

Input guardrails:
- subreddit format: letters/numbers/underscore, length 3-21
- trend `from/to` range max: 24h
- trend `from/to` are aligned to 15-minute UTC windows on read
- trend `recentPostsLimit` range: 1-50
