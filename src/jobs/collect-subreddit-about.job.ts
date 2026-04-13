import type { RedditConnector } from "../connectors/reddit/reddit-connector.interface";
import type { RedditMapper } from "../connectors/reddit/reddit-mapper.interface";
import type { CollectionJob } from "../domain/entities/collection-job";
import type { MetricsSnapshot } from "../domain/entities/metrics-snapshot";
import type { CollectionJobRepository } from "../domain/repositories/collection-job-repository";
import type { MetricsSnapshotRepository } from "../domain/repositories/metrics-snapshot-repository";
import type { RawEventRepository } from "../domain/repositories/raw-event-repository";
import { stableUuidFromString } from "../shared/ids/stable-id";
import { buildDedupeKey, floorToWindow } from "../shared/time/windowing";
import { computeRetryDelayMs, resolveJobRetryPolicy } from "./job-retry-policy";
import type { RedditCollectionJobInput } from "./reddit-job.types";

export interface CollectSubredditAboutDependencies {
  redditConnector: RedditConnector;
  redditMapper: RedditMapper;
  collectionJobRepository: CollectionJobRepository;
  rawEventRepository: RawEventRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
}

export async function collectSubredditAboutJob(
  deps: CollectSubredditAboutDependencies,
  input: RedditCollectionJobInput,
): Promise<void> {
  const windowStart = floorToWindow(input.nowIso, 15);
  const retryPolicy = resolveJobRetryPolicy();
  const job: CollectionJob = {
    id: stableUuidFromString(`job:collect_subreddit_about:${input.targetId}:${windowStart}`),
    source: "reddit",
    targetId: input.targetId,
    jobType: "collect_subreddit_about",
    status: "queued",
    scheduledAt: input.nowIso,
    nextRunAt: input.nowIso,
    dedupeKey: buildDedupeKey("collect_subreddit_about", input.targetId, windowStart),
    retryCount: 0,
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
    const page = await deps.redditConnector.collectSubredditAbout(
      { subreddit: input.subreddit },
      { requestId: job.id, now: input.nowIso },
    );

    await deps.rawEventRepository.append({
      collectionJobId: job.id,
      targetId: input.targetId,
      envelope: page.raw,
    });

    const normalized = deps.redditMapper.toSubredditSnapshot(page.raw, {
      requestId: job.id,
      now: input.nowIso,
    });

    const snapshots: MetricsSnapshot[] = [];
    if (typeof normalized.subscribers === "number") {
      snapshots.push({
        snapshotAt: windowStart,
        source: "reddit",
        targetId: input.targetId,
        granularity: "15m",
        metricName: "subscribers",
        metricValue: normalized.subscribers,
        collectionJobId: job.id,
      });
    }

    if (typeof normalized.activeUsers === "number") {
      snapshots.push({
        snapshotAt: windowStart,
        source: "reddit",
        targetId: input.targetId,
        granularity: "15m",
        metricName: "active_users",
        metricValue: normalized.activeUsers,
        collectionJobId: job.id,
      });
    }

    if (snapshots.length > 0) {
      await deps.metricsSnapshotRepository.appendMany(snapshots);
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
