import type { RedditConnector } from "../connectors/reddit/reddit-connector.interface";
import type { RedditMapper } from "../connectors/reddit/reddit-mapper.interface";
import type { AccountRepository } from "../domain/repositories/account-repository";
import type { CollectionJobRepository } from "../domain/repositories/collection-job-repository";
import type { ContentRepository } from "../domain/repositories/content-repository";
import type { MetricsSnapshotRepository } from "../domain/repositories/metrics-snapshot-repository";
import type { MonitorTargetRepository } from "../domain/repositories/monitor-target-repository";
import type { RawEventRepository } from "../domain/repositories/raw-event-repository";
import type { SubredditTrendPointRepository } from "../domain/repositories/subreddit-trend-point-repository";
import { buildSubredditTrendPointsJob } from "../jobs/build-subreddit-trend-points.job";
import { collectSubredditAboutJob } from "../jobs/collect-subreddit-about.job";
import { collectSubredditNewPostsJob } from "../jobs/collect-subreddit-new-posts.job";

export interface RedditPhase1WorkerDependencies {
  monitorTargetRepository: MonitorTargetRepository;
  collectionJobRepository: CollectionJobRepository;
  rawEventRepository: RawEventRepository;
  accountRepository: AccountRepository;
  contentRepository: ContentRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
  redditConnector: RedditConnector;
  redditMapper: RedditMapper;
}

export interface RedditPhase1CycleOptions {
  targetCanonicalNames?: string[];
  postLimit?: number;
  trendLookbackMinutes?: number;
}

export interface RedditPhase1CycleResult {
  processedCanonicalNames: string[];
  requestedCanonicalNames: string[];
}

function toCanonicalSubredditName(value: string): string {
  const normalized = value.trim().replace(/^r\//i, "").toLowerCase();
  return `r/${normalized}`;
}

export async function runRedditPhase1Cycle(
  deps: RedditPhase1WorkerDependencies,
  nowIso: string,
  options: RedditPhase1CycleOptions = {},
): Promise<RedditPhase1CycleResult> {
  const postLimit = options.postLimit ?? 50;
  const trendLookbackMinutes = options.trendLookbackMinutes ?? 120;
  const requestedCanonicalNames = Array.from(
    new Set((options.targetCanonicalNames ?? []).map(toCanonicalSubredditName)),
  );

  const targets =
    requestedCanonicalNames.length === 0
      ? await deps.monitorTargetRepository.findActiveSubreddits()
      : (
          await Promise.all(
            requestedCanonicalNames.map((name) =>
              deps.monitorTargetRepository.findByCanonicalName(name),
            ),
          )
        ).filter((target): target is NonNullable<typeof target> => {
          return target !== null && target.targetType === "subreddit" && target.status === "active";
        });

  const processedCanonicalNames: string[] = [];

  for (const target of targets) {
    processedCanonicalNames.push(target.canonicalName);
    const subreddit = target.canonicalName.replace(/^r\//, "");
    const baseInput = {
      targetId: target.id,
      subreddit,
      nowIso,
    };

    await collectSubredditAboutJob(
      {
        redditConnector: deps.redditConnector,
        redditMapper: deps.redditMapper,
        collectionJobRepository: deps.collectionJobRepository,
        rawEventRepository: deps.rawEventRepository,
        metricsSnapshotRepository: deps.metricsSnapshotRepository,
      },
      baseInput,
    );

    await collectSubredditNewPostsJob(
      {
        redditConnector: deps.redditConnector,
        redditMapper: deps.redditMapper,
        collectionJobRepository: deps.collectionJobRepository,
        rawEventRepository: deps.rawEventRepository,
        accountRepository: deps.accountRepository,
        contentRepository: deps.contentRepository,
        metricsSnapshotRepository: deps.metricsSnapshotRepository,
      },
      { ...baseInput, limit: postLimit },
    );

    const fromIso = new Date(
      new Date(nowIso).getTime() - trendLookbackMinutes * 60 * 1000,
    ).toISOString();
    await buildSubredditTrendPointsJob(
      {
        metricsSnapshotRepository: deps.metricsSnapshotRepository,
        subredditTrendPointRepository: deps.subredditTrendPointRepository,
      },
      {
        targetId: target.id,
        fromIso,
        toIso: nowIso,
      },
    );
  }

  return {
    processedCanonicalNames,
    requestedCanonicalNames,
  };
}
