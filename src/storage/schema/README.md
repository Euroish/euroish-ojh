# Schema Migrations

- `001_reddit_mvp_init.sql` is the baseline PostgreSQL migration for Reddit-only MVP.
- `002_repository_query_indexes.sql` adds read-path indexes for active target lookup, recent content reads, and metrics trend-range reads.
- `003_trend_algorithm_upgrade.sql` extends trend scoring schema with explainable components and an experiment table for multi-version scoring output.
- `metrics_snapshot` uses two partial unique indexes to correctly dedupe target-level rows when `content_id` is `NULL`.
- `metric_name` is enforced by PostgreSQL enum (`metric_name_enum`) and scope check:
  - target-level metrics require `content_id IS NULL`
  - content-level metrics require `content_id IS NOT NULL`
- Keep enum/check values synchronized with domain unions in `src/domain/entities`.
