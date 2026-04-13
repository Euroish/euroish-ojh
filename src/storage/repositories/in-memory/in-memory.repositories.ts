import type { Account } from "../../../domain/entities/account";
import type { CollectionJob, CollectionJobStatus } from "../../../domain/entities/collection-job";
import type { Content } from "../../../domain/entities/content";
import type { MetricsSnapshot } from "../../../domain/entities/metrics-snapshot";
import type { MonitorTarget } from "../../../domain/entities/monitor-target";
import type { SubredditTrendPoint } from "../../../domain/entities/subreddit-trend-point";
import type { AccountRepository } from "../../../domain/repositories/account-repository";
import type {
  CollectionJobFailurePolicy,
  CollectionJobRepository,
} from "../../../domain/repositories/collection-job-repository";
import type { ContentRepository } from "../../../domain/repositories/content-repository";
import type { MetricsSnapshotRepository } from "../../../domain/repositories/metrics-snapshot-repository";
import type { MonitorTargetRepository } from "../../../domain/repositories/monitor-target-repository";
import type { RawEventRepository } from "../../../domain/repositories/raw-event-repository";
import type { SubredditTrendPointRepository } from "../../../domain/repositories/subreddit-trend-point-repository";
import type { RawEnvelope } from "../../../connectors/shared/connector.interface";

export class InMemoryAccountRepository implements AccountRepository {
  private readonly byExternalId = new Map<string, Account>();

  public async upsertMany(accounts: Account[]): Promise<void> {
    for (const account of accounts) {
      this.byExternalId.set(account.externalId, account);
    }
  }

  public async findByExternalId(externalId: string): Promise<Account | null> {
    return this.byExternalId.get(externalId) ?? null;
  }

  public all(): Account[] {
    return Array.from(this.byExternalId.values());
  }
}

export class InMemoryContentRepository implements ContentRepository {
  private readonly byExternalId = new Map<string, Content>();

  public async upsertMany(contents: Content[]): Promise<void> {
    for (const content of contents) {
      this.byExternalId.set(content.externalId, content);
    }
  }

  public async findRecentByTarget(targetId: string, limit: number): Promise<Content[]> {
    return Array.from(this.byExternalId.values())
      .filter((content) => content.targetId === targetId)
      .sort((a, b) => b.createdAtSource.localeCompare(a.createdAtSource))
      .slice(0, limit);
  }

  public all(): Content[] {
    return Array.from(this.byExternalId.values());
  }
}

export class InMemoryMetricsSnapshotRepository implements MetricsSnapshotRepository {
  private readonly byUniqueKey = new Map<string, MetricsSnapshot>();

  public async appendMany(snapshots: MetricsSnapshot[]): Promise<void> {
    for (const snapshot of snapshots) {
      const key = [
        snapshot.targetId,
        snapshot.contentId ?? "target-level",
        snapshot.granularity,
        snapshot.metricName,
        snapshot.snapshotAt,
      ].join("|");
      this.byUniqueKey.set(key, snapshot);
    }
  }

  public async listByTargetInRange(args: {
    targetId: string;
    from: string;
    to: string;
    metricNames: string[];
  }): Promise<MetricsSnapshot[]> {
    return Array.from(this.byUniqueKey.values()).filter((snapshot) => {
      return (
        snapshot.targetId === args.targetId &&
        snapshot.snapshotAt >= args.from &&
        snapshot.snapshotAt <= args.to &&
        args.metricNames.includes(snapshot.metricName)
      );
    });
  }

  public all(): MetricsSnapshot[] {
    return Array.from(this.byUniqueKey.values());
  }
}

export class InMemoryCollectionJobRepository implements CollectionJobRepository {
  private readonly byId = new Map<string, CollectionJob>();

  public async create(job: CollectionJob): Promise<CollectionJob> {
    if (!this.byId.has(job.id)) {
      this.byId.set(job.id, {
        ...job,
        nextRunAt: job.nextRunAt ?? job.scheduledAt,
      });
    }
    return this.byId.get(job.id)!;
  }

  public async updateStatus(
    jobId: string,
    status: CollectionJobStatus,
    errorMessage?: string,
  ): Promise<void> {
    const current = this.byId.get(jobId);
    if (!current) {
      return;
    }
    current.status = status;
    if (status === "running") {
      current.startedAt = new Date().toISOString();
      current.nextRunAt = undefined;
    }
    if (status === "succeeded" || status === "failed") {
      current.finishedAt = new Date().toISOString();
      current.nextRunAt = undefined;
    }
    if (status === "dead_letter") {
      const nowIso = new Date().toISOString();
      current.finishedAt = nowIso;
      current.deadLetteredAt = nowIso;
      current.nextRunAt = undefined;
    }
    current.errorMessage = errorMessage;
    this.byId.set(jobId, current);
  }

  public async fail(
    jobId: string,
    errorMessage: string,
    policy: CollectionJobFailurePolicy,
  ): Promise<CollectionJob> {
    const current = this.byId.get(jobId);
    if (!current) {
      throw new Error(`Collection job not found: ${jobId}`);
    }

    const nextRetryCount = current.retryCount + 1;
    current.retryCount = nextRetryCount;
    current.errorMessage = errorMessage;

    if (nextRetryCount > policy.maxRetries) {
      current.status = "dead_letter";
      current.deadLetteredAt = policy.nowIso;
      current.finishedAt = policy.nowIso;
      current.nextRunAt = undefined;
    } else {
      current.status = "retrying";
      current.nextRunAt = new Date(
        new Date(policy.nowIso).getTime() + Math.max(0, policy.retryDelayMs),
      ).toISOString();
      current.finishedAt = undefined;
      current.deadLetteredAt = undefined;
    }

    this.byId.set(jobId, current);
    return { ...current };
  }

  public async saveCursor(jobId: string, cursor: string): Promise<void> {
    const current = this.byId.get(jobId);
    if (!current) {
      return;
    }
    current.cursor = cursor;
    this.byId.set(jobId, current);
  }

  public async findRunnableJobs(nowIso: string, limit: number): Promise<CollectionJob[]> {
    return Array.from(this.byId.values())
      .filter((job) => {
        return (
          (job.status === "queued" || job.status === "retrying") &&
          (job.nextRunAt ?? job.scheduledAt) <= nowIso
        );
      })
      .sort((a, b) => (a.nextRunAt ?? a.scheduledAt).localeCompare(b.nextRunAt ?? b.scheduledAt))
      .slice(0, limit);
  }

  public all(): CollectionJob[] {
    return Array.from(this.byId.values());
  }
}

export class InMemoryRawEventRepository implements RawEventRepository {
  private readonly events: Array<{
    collectionJobId: string;
    targetId: string;
    envelope: RawEnvelope;
  }> = [];

  public async append<TPayload>(event: {
    collectionJobId: string;
    targetId: string;
    envelope: RawEnvelope<TPayload>;
  }): Promise<void> {
    this.events.push(event);
  }

  public all(): Array<{
    collectionJobId: string;
    targetId: string;
    envelope: RawEnvelope;
  }> {
    return [...this.events];
  }
}

export class InMemoryMonitorTargetRepository implements MonitorTargetRepository {
  private readonly byCanonicalName = new Map<string, MonitorTarget>();

  public async findActiveSubreddits(): Promise<MonitorTarget[]> {
    return Array.from(this.byCanonicalName.values()).filter(
      (target) => target.targetType === "subreddit" && target.status === "active",
    );
  }

  public async findByCanonicalName(canonicalName: string): Promise<MonitorTarget | null> {
    return this.byCanonicalName.get(canonicalName) ?? null;
  }

  public async upsert(target: MonitorTarget): Promise<MonitorTarget> {
    this.byCanonicalName.set(target.canonicalName, target);
    return target;
  }

  public all(): MonitorTarget[] {
    return Array.from(this.byCanonicalName.values());
  }
}

export class InMemorySubredditTrendPointRepository implements SubredditTrendPointRepository {
  private readonly points = new Map<string, SubredditTrendPoint>();

  public async upsertMany(points: SubredditTrendPoint[]): Promise<void> {
    for (const point of points) {
      const key = `${point.targetId}|${point.windowStart}|${point.windowEnd}`;
      this.points.set(key, point);
    }
  }

  public async listByTargetInRange(args: {
    targetId: string;
    from: string;
    to: string;
  }): Promise<SubredditTrendPoint[]> {
    return Array.from(this.points.values())
      .filter((point) => {
        return (
          point.targetId === args.targetId &&
          point.windowStart >= args.from &&
          point.windowEnd <= args.to
        );
      })
      .sort((a, b) => a.windowStart.localeCompare(b.windowStart));
  }

  public all(): SubredditTrendPoint[] {
    return Array.from(this.points.values());
  }
}
