import type { RedditConnector } from "../connectors/reddit/reddit-connector.interface";
import type { RedditMapper } from "../connectors/reddit/reddit-mapper.interface";
import type { Account } from "../domain/entities/account";
import type { CollectionJob } from "../domain/entities/collection-job";
import type { Content } from "../domain/entities/content";
import type { MetricsSnapshot } from "../domain/entities/metrics-snapshot";
import type { AccountRepository } from "../domain/repositories/account-repository";
import type { CollectionJobRepository } from "../domain/repositories/collection-job-repository";
import type { ContentRepository } from "../domain/repositories/content-repository";
import type { MetricsSnapshotRepository } from "../domain/repositories/metrics-snapshot-repository";
import type { RawEventRepository } from "../domain/repositories/raw-event-repository";
import { stableUuidFromString } from "../shared/ids/stable-id";
import { buildDedupeKey, floorToWindow } from "../shared/time/windowing";
import { computeRetryDelayMs, resolveJobRetryPolicy } from "./job-retry-policy";
import type { RedditCollectionJobInput } from "./reddit-job.types";

export interface CollectSubredditNewPostsInput extends RedditCollectionJobInput {
  limit?: number;
  after?: string;
}

export interface CollectSubredditNewPostsDependencies {
  redditConnector: RedditConnector;
  redditMapper: RedditMapper;
  collectionJobRepository: CollectionJobRepository;
  rawEventRepository: RawEventRepository;
  accountRepository: AccountRepository;
  contentRepository: ContentRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
}

export async function collectSubredditNewPostsJob(
  deps: CollectSubredditNewPostsDependencies,
  input: CollectSubredditNewPostsInput,
): Promise<void> {
  const windowStart = floorToWindow(input.nowIso, 15);
  const retryPolicy = resolveJobRetryPolicy();
  const job: CollectionJob = {
    id: stableUuidFromString(`job:collect_subreddit_new_posts:${input.targetId}:${windowStart}`),
    source: "reddit",
    targetId: input.targetId,
    jobType: "collect_subreddit_new_posts",
    status: "queued",
    scheduledAt: input.nowIso,
    nextRunAt: input.nowIso,
    dedupeKey: buildDedupeKey("collect_subreddit_new_posts", input.targetId, windowStart),
    retryCount: 0,
    cursor: input.after,
  };

  const created = await deps.collectionJobRepository.create(job);
  if (created.status === "succeeded" || created.status === "dead_letter") {
    return;
  }
  if (
    created.status === "retrying" &&
    created.nextRunAt &&
    created.nextRunAt > input.nowIso
  ) {
    return;
  }
  await deps.collectionJobRepository.updateStatus(job.id, "running");

  try {
    const page = await deps.redditConnector.collectSubredditPosts(
      {
        subreddit: input.subreddit,
        limit: input.limit ?? 50,
        after: input.after,
      },
      { requestId: job.id, now: input.nowIso },
    );

    await deps.rawEventRepository.append({
      collectionJobId: job.id,
      targetId: input.targetId,
      envelope: page.raw,
    });

    const upserts = deps.redditMapper.toPostUpserts(input.targetId, page.raw, {
      requestId: job.id,
      now: input.nowIso,
    });
    const metricPoints = deps.redditMapper.toPostMetricPoints(page.raw, {
      requestId: job.id,
      now: input.nowIso,
    });

    const accountsMap = new Map<string, Account>();
    const contents: Content[] = [];

    for (const item of upserts) {
      const accountId = stableUuidFromString(`reddit:account:${item.accountExternalId}`);
      if (!accountsMap.has(item.accountExternalId)) {
        accountsMap.set(item.accountExternalId, {
          id: accountId,
          source: "reddit",
          externalId: item.accountExternalId,
          username: item.accountExternalId,
          isDeleted: item.accountExternalId === "[deleted]",
          firstSeenAt: input.nowIso,
          lastSeenAt: input.nowIso,
        });
      }

      const contentId = stableUuidFromString(`reddit:content:${item.externalId}`);
      contents.push({
        id: contentId,
        source: "reddit",
        targetId: item.targetId,
        accountId,
        externalId: item.externalId,
        kind: "post",
        title: item.title,
        bodyText: item.bodyText,
        url: item.url,
        permalink: item.permalink,
        createdAtSource: item.createdAtSource,
        firstSeenAt: input.nowIso,
        lastSeenAt: input.nowIso,
      });
    }

    if (accountsMap.size > 0) {
      await deps.accountRepository.upsertMany(Array.from(accountsMap.values()));
    }

    if (contents.length > 0) {
      await deps.contentRepository.upsertMany(contents);
    }

    const snapshots: MetricsSnapshot[] = [
      {
        snapshotAt: windowStart,
        source: "reddit",
        targetId: input.targetId,
        granularity: "15m",
        metricName: "new_posts_15m",
        metricValue: upserts.length,
        collectionJobId: job.id,
      },
    ];

    for (const point of metricPoints) {
      const contentId = stableUuidFromString(`reddit:content:${point.externalId}`);
      if (typeof point.score === "number") {
        snapshots.push({
          snapshotAt: windowStart,
          source: "reddit",
          targetId: input.targetId,
          contentId,
          granularity: "15m",
          metricName: "score",
          metricValue: point.score,
          collectionJobId: job.id,
        });
      }
      if (typeof point.numComments === "number") {
        snapshots.push({
          snapshotAt: windowStart,
          source: "reddit",
          targetId: input.targetId,
          contentId,
          granularity: "15m",
          metricName: "num_comments",
          metricValue: point.numComments,
          collectionJobId: job.id,
        });
      }
      if (typeof point.upvoteRatio === "number") {
        snapshots.push({
          snapshotAt: windowStart,
          source: "reddit",
          targetId: input.targetId,
          contentId,
          granularity: "15m",
          metricName: "upvote_ratio",
          metricValue: point.upvoteRatio,
          collectionJobId: job.id,
        });
      }
    }

    await deps.metricsSnapshotRepository.appendMany(snapshots);

    if (page.nextCursor) {
      await deps.collectionJobRepository.saveCursor(job.id, page.nextCursor);
    }

    await deps.collectionJobRepository.updateStatus(job.id, "succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await deps.collectionJobRepository.fail(job.id, message, {
      nowIso: input.nowIso,
      maxRetries: retryPolicy.maxRetries,
      retryDelayMs: computeRetryDelayMs(created.retryCount + 1, retryPolicy),
    });
    throw error;
  }
}
