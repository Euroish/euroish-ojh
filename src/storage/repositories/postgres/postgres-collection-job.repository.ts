import type {
  CollectionJob,
  CollectionJobStatus,
} from "../../../domain/entities/collection-job";
import type {
  CollectionJobFailurePolicy,
  CollectionJobRepository,
} from "../../../domain/repositories/collection-job-repository";
import type { SqlQueryable } from "../../postgres/postgres-client";
import { SOURCE_IDS } from "../../postgres/postgres.constants";
import { mapCollectionJob, type CollectionJobRow } from "./postgres-row-mappers";

export class PostgresCollectionJobRepository implements CollectionJobRepository {
  constructor(private readonly db: SqlQueryable) {}

  public async create(job: CollectionJob): Promise<CollectionJob> {
    const inserted = await this.db.query<CollectionJobRow>(
      `
      INSERT INTO collection_job (
        id, source_id, target_id, job_type, status, scheduled_at, started_at, finished_at, cursor,
        dedupe_key, retry_count, next_run_at, dead_lettered_at, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (job_type, target_id, dedupe_key) DO NOTHING
      RETURNING id, target_id, job_type, status, scheduled_at, started_at, finished_at, cursor,
                dedupe_key, retry_count, next_run_at, dead_lettered_at, error_message
      `,
      [
        job.id,
        SOURCE_IDS[job.source],
        job.targetId,
        job.jobType,
        job.status,
        job.scheduledAt,
        job.startedAt ?? null,
        job.finishedAt ?? null,
        job.cursor ?? null,
        job.dedupeKey,
        job.retryCount,
        job.nextRunAt ?? job.scheduledAt,
        job.deadLetteredAt ?? null,
        job.errorMessage ?? null,
      ],
    );

    if (inserted.rows.length > 0) {
      return mapCollectionJob(inserted.rows[0]);
    }

    const existing = await this.db.query<CollectionJobRow>(
      `
      SELECT id, target_id, job_type, status, scheduled_at, started_at, finished_at, cursor,
             dedupe_key, retry_count, next_run_at, dead_lettered_at, error_message
      FROM collection_job
      WHERE job_type = $1
        AND target_id = $2
        AND dedupe_key = $3
      LIMIT 1
      `,
      [job.jobType, job.targetId, job.dedupeKey],
    );

    if (existing.rows.length === 0) {
      throw new Error("Collection job create failed and no conflict row found");
    }

    return mapCollectionJob(existing.rows[0]);
  }

  public async updateStatus(
    jobId: string,
    status: CollectionJobStatus,
    errorMessage?: string,
  ): Promise<void> {
    await this.db.query(
      `
      UPDATE collection_job
      SET status = $2,
          error_message = $3,
          started_at = CASE
            WHEN $2 = 'running' THEN COALESCE(started_at, NOW())
            ELSE started_at
          END,
          finished_at = CASE
            WHEN $2 IN ('succeeded', 'failed') THEN NOW()
            ELSE finished_at
          END,
          next_run_at = CASE
            WHEN $2 IN ('running', 'succeeded', 'failed', 'dead_letter') THEN NULL
            ELSE next_run_at
          END,
          dead_lettered_at = CASE
            WHEN $2 = 'dead_letter' THEN COALESCE(dead_lettered_at, NOW())
            ELSE dead_lettered_at
          END
      WHERE id = $1
      `,
      [jobId, status, errorMessage ?? null],
    );
  }

  public async fail(
    jobId: string,
    errorMessage: string,
    policy: CollectionJobFailurePolicy,
  ): Promise<CollectionJob> {
    const nextRunAtIso = new Date(
      new Date(policy.nowIso).getTime() + Math.max(0, policy.retryDelayMs),
    ).toISOString();

    const updated = await this.db.query<CollectionJobRow>(
      `
      UPDATE collection_job
      SET retry_count = retry_count + 1,
          error_message = $2,
          status = CASE
            WHEN retry_count + 1 > $3 THEN 'dead_letter'
            ELSE 'retrying'
          END,
          next_run_at = CASE
            WHEN retry_count + 1 > $3 THEN NULL
            ELSE $4
          END,
          dead_lettered_at = CASE
            WHEN retry_count + 1 > $3 THEN COALESCE(dead_lettered_at, NOW())
            ELSE NULL
          END,
          finished_at = CASE
            WHEN retry_count + 1 > $3 THEN NOW()
            ELSE NULL
          END
      WHERE id = $1
      RETURNING id, target_id, job_type, status, scheduled_at, started_at, finished_at, cursor,
                dedupe_key, retry_count, next_run_at, dead_lettered_at, error_message
      `,
      [jobId, errorMessage, policy.maxRetries, nextRunAtIso],
    );

    if (updated.rows.length === 0) {
      throw new Error(`Collection job not found: ${jobId}`);
    }
    return mapCollectionJob(updated.rows[0]);
  }

  public async saveCursor(jobId: string, cursor: string): Promise<void> {
    await this.db.query(
      `
      UPDATE collection_job
      SET cursor = $2
      WHERE id = $1
      `,
      [jobId, cursor],
    );
  }

  public async findRunnableJobs(nowIso: string, limit: number): Promise<CollectionJob[]> {
    const result = await this.db.query<CollectionJobRow>(
      `
      SELECT id, target_id, job_type, status, scheduled_at, started_at, finished_at, cursor,
             dedupe_key, retry_count, next_run_at, dead_lettered_at, error_message
      FROM collection_job
      WHERE status IN ('queued', 'retrying')
        AND COALESCE(next_run_at, scheduled_at) <= $1
      ORDER BY COALESCE(next_run_at, scheduled_at) ASC
      LIMIT $2
      `,
      [nowIso, limit],
    );

    return result.rows.map(mapCollectionJob);
  }
}
