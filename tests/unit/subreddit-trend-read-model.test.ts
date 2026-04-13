import test from "node:test";
import assert from "node:assert/strict";
import { buildSubredditTrendReadModel } from "../../src/application/services/subreddit-trend-read-model";
import type { SubredditTrendPoint } from "../../src/domain/entities/subreddit-trend-point";

const targetId = "11111111-1111-1111-1111-111111111111";

function point(args: Partial<SubredditTrendPoint> & Pick<SubredditTrendPoint, "windowStart" | "windowEnd">): SubredditTrendPoint {
  return {
    targetId,
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    newPosts: args.newPosts ?? 0,
    deltaNewPostsVsPrevWindow: args.deltaNewPostsVsPrevWindow ?? 0,
    deltaActiveUsersVsPrevWindow: args.deltaActiveUsersVsPrevWindow ?? 0,
    trendScore: args.trendScore ?? 0,
    anomalyScore: args.anomalyScore,
  };
}

test("buildSubredditTrendReadModel returns summary and sorted insights", () => {
  const model = buildSubredditTrendReadModel([
    point({
      windowStart: "2026-04-10T10:00:00.000Z",
      windowEnd: "2026-04-10T10:15:00.000Z",
      deltaNewPostsVsPrevWindow: 2,
      trendScore: 0.1,
      anomalyScore: 0.2,
    }),
    point({
      windowStart: "2026-04-10T10:15:00.000Z",
      windowEnd: "2026-04-10T10:30:00.000Z",
      deltaNewPostsVsPrevWindow: -6,
      trendScore: -0.4,
      anomalyScore: 0.7,
    }),
    point({
      windowStart: "2026-04-10T10:30:00.000Z",
      windowEnd: "2026-04-10T10:45:00.000Z",
      deltaNewPostsVsPrevWindow: 4,
      trendScore: 0.35,
      anomalyScore: 0.9,
    }),
  ]);

  assert.equal(model.timeline.pointCount, 3);
  assert.equal(model.summary.latestTrendDirection, "rising");
  assert.equal(model.summary.latestWindowStart, "2026-04-10T10:30:00.000Z");
  assert.equal(model.topMovers[0]?.deltaNewPostsVsPrevWindow, -6);
  assert.equal(model.recentAnomalies[0]?.anomalyScore, 0.9);
});

test("buildSubredditTrendReadModel handles empty input", () => {
  const model = buildSubredditTrendReadModel([]);

  assert.equal(model.timeline.pointCount, 0);
  assert.equal(model.summary.latestTrendDirection, "unknown");
  assert.equal(model.summary.latestTrendScore, null);
  assert.deepEqual(model.topMovers, []);
  assert.deepEqual(model.recentAnomalies, []);
});
