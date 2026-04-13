import type { SubredditTrendPoint } from "../domain/entities/subreddit-trend-point";
import type { MetricsSnapshotRepository } from "../domain/repositories/metrics-snapshot-repository";
import type { SubredditTrendPointRepository } from "../domain/repositories/subreddit-trend-point-repository";
import { scoreTrendWindows } from "../domain/services/trend-scoring.service";

export interface BuildSubredditTrendPointsDependencies {
  metricsSnapshotRepository: MetricsSnapshotRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
}

export interface BuildSubredditTrendPointsInput {
  targetId: string;
  fromIso: string;
  toIso: string;
}

export async function buildSubredditTrendPointsJob(
  deps: BuildSubredditTrendPointsDependencies,
  input: BuildSubredditTrendPointsInput,
): Promise<SubredditTrendPoint[]> {
  const snapshots = await deps.metricsSnapshotRepository.listByTargetInRange({
    targetId: input.targetId,
    from: input.fromIso,
    to: input.toIso,
    metricNames: ["new_posts_15m", "active_users", "subscribers"],
  });

  const byWindow = new Map<
    string,
    {
      newPosts: number;
      activeUsers: number;
      subscribers: number;
      hasNewPosts: boolean;
      hasActiveUsers: boolean;
      hasSubscribers: boolean;
      granularity: "15m" | "1h" | "1d";
    }
  >();

  for (const snapshot of snapshots) {
    if (!byWindow.has(snapshot.snapshotAt)) {
      byWindow.set(snapshot.snapshotAt, {
        newPosts: 0,
        activeUsers: 0,
        subscribers: 0,
        hasNewPosts: false,
        hasActiveUsers: false,
        hasSubscribers: false,
        granularity: snapshot.granularity,
      });
    }
    const current = byWindow.get(snapshot.snapshotAt)!;
    if (snapshot.metricName === "new_posts_15m") {
      current.newPosts = Number(snapshot.metricValue);
      current.hasNewPosts = true;
    }
    if (snapshot.metricName === "active_users") {
      current.activeUsers = Number(snapshot.metricValue);
      current.hasActiveUsers = true;
    }
    if (snapshot.metricName === "subscribers") {
      current.subscribers = Number(snapshot.metricValue);
      current.hasSubscribers = true;
    }
  }

  const windows = Array.from(byWindow.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([windowStart, current]) => {
      const windowStartDate = new Date(windowStart);
      const windowEnd = new Date(windowStartDate.getTime() + 15 * 60 * 1000).toISOString();
      return {
        windowStart,
        windowEnd,
        granularity: current.granularity,
        newPosts: current.newPosts,
        activeUsers: current.activeUsers,
        subscribers: current.subscribers,
        hasNewPosts: current.hasNewPosts,
        hasActiveUsers: current.hasActiveUsers,
        hasSubscribers: current.hasSubscribers,
      };
    });

  const points: SubredditTrendPoint[] = scoreTrendWindows({
    targetId: input.targetId,
    windows,
  });

  if (points.length > 0) {
    await deps.subredditTrendPointRepository.upsertMany(points);
  }

  return points;
}
