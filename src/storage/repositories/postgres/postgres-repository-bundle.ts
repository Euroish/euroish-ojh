import type { AccountRepository } from "../../../domain/repositories/account-repository";
import type { CollectionJobRepository } from "../../../domain/repositories/collection-job-repository";
import type { ContentRepository } from "../../../domain/repositories/content-repository";
import type { MetricsSnapshotRepository } from "../../../domain/repositories/metrics-snapshot-repository";
import type { MonitorTargetRepository } from "../../../domain/repositories/monitor-target-repository";
import type { RawEventRepository } from "../../../domain/repositories/raw-event-repository";
import type { SubredditTrendPointRepository } from "../../../domain/repositories/subreddit-trend-point-repository";
import { PostgresClient } from "../../postgres/postgres-client";
import { PostgresAccountRepository } from "./postgres-account.repository";
import { PostgresCollectionJobRepository } from "./postgres-collection-job.repository";
import { PostgresContentRepository } from "./postgres-content.repository";
import { PostgresMetricsSnapshotRepository } from "./postgres-metrics-snapshot.repository";
import { PostgresMonitorTargetRepository } from "./postgres-monitor-target.repository";
import { PostgresRawEventRepository } from "./postgres-raw-event.repository";
import { PostgresSubredditTrendPointRepository } from "./postgres-subreddit-trend-point.repository";

export interface RepositoryBundle {
  monitorTargetRepository: MonitorTargetRepository;
  collectionJobRepository: CollectionJobRepository;
  rawEventRepository: RawEventRepository;
  accountRepository: AccountRepository;
  contentRepository: ContentRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
}

export function createPostgresRepositoryBundle(db: PostgresClient): RepositoryBundle {
  return {
    monitorTargetRepository: new PostgresMonitorTargetRepository(db),
    collectionJobRepository: new PostgresCollectionJobRepository(db),
    rawEventRepository: new PostgresRawEventRepository(db),
    accountRepository: new PostgresAccountRepository(db),
    contentRepository: new PostgresContentRepository(db),
    metricsSnapshotRepository: new PostgresMetricsSnapshotRepository(db),
    subredditTrendPointRepository: new PostgresSubredditTrendPointRepository(db),
  };
}

