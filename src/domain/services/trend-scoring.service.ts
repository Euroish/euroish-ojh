import type { SubredditTrendPoint, TrendGranularity } from "../entities/subreddit-trend-point";
import type { UUID } from "../../shared/types/common";

export interface TrendWindowInput {
  windowStart: string;
  windowEnd: string;
  granularity: TrendGranularity;
  newPosts: number;
  activeUsers: number;
  subscribers: number;
  hasNewPosts: boolean;
  hasActiveUsers: boolean;
  hasSubscribers: boolean;
}

export interface TrendScoringParams {
  velocityNewPostsWeight: number;
  velocityActiveUsersWeight: number;
  velocitySubscribersWeight: number;
  velocityScale: number;
  accelerationScale: number;
  baselineLookbackWindows: number;
  baselineNewPostsWeight: number;
  baselineActiveUsersWeight: number;
  baselineScale: number;
  changeRecentWindows: number;
  changeBaselineWindows: number;
  changeMinBaselineWindows: number;
  changeScale: number;
  anomalyZStart: number;
  anomalyZDivisor: number;
  trendWeightVelocity: number;
  trendWeightAcceleration: number;
  trendWeightBaselineDeviation: number;
  trendWeightChange: number;
  trendWeightAnomaly: number;
  trendScale: number;
}

export const DEFAULT_TREND_SCORING_PARAMS: TrendScoringParams = {
  velocityNewPostsWeight: 0.65,
  velocityActiveUsersWeight: 0.25,
  velocitySubscribersWeight: 0.1,
  velocityScale: 2.5,
  accelerationScale: 1.5,
  baselineLookbackWindows: 8,
  baselineNewPostsWeight: 0.7,
  baselineActiveUsersWeight: 0.3,
  baselineScale: 3,
  changeRecentWindows: 3,
  changeBaselineWindows: 6,
  changeMinBaselineWindows: 3,
  changeScale: 3,
  anomalyZStart: 1,
  anomalyZDivisor: 3,
  trendWeightVelocity: 0.45,
  trendWeightAcceleration: 0.2,
  trendWeightBaselineDeviation: 0.2,
  trendWeightChange: 0.1,
  trendWeightAnomaly: 0.05,
  trendScale: 1,
};

const ALGORITHM_VERSION = "trend_v1_explainable";

export function scoreTrendWindows(args: {
  targetId: UUID;
  windows: TrendWindowInput[];
  params?: Partial<TrendScoringParams>;
}): SubredditTrendPoint[] {
  if (args.windows.length === 0) {
    return [];
  }

  const params: TrendScoringParams = {
    ...DEFAULT_TREND_SCORING_PARAMS,
    ...args.params,
  };
  const windows = [...args.windows].sort((a, b) => a.windowStart.localeCompare(b.windowStart));
  const points: SubredditTrendPoint[] = [];

  let previousVelocityRaw = 0;
  for (let index = 0; index < windows.length; index += 1) {
    const current = windows[index];
    const previous = index > 0 ? windows[index - 1] : undefined;
    const history = windows.slice(0, index);

    const newPostsGrowth = growthRate(current.newPosts, previous?.newPosts);
    const activeUsersGrowth = growthRate(current.activeUsers, previous?.activeUsers);
    const subscribersGrowth = growthRate(current.subscribers, previous?.subscribers);

    const velocityRaw =
      params.velocityNewPostsWeight * newPostsGrowth +
      params.velocityActiveUsersWeight * activeUsersGrowth +
      params.velocitySubscribersWeight * subscribersGrowth;
    const velocityScore = squash(velocityRaw, params.velocityScale);

    const accelerationRaw = index === 0 ? 0 : velocityRaw - previousVelocityRaw;
    const accelerationScore = squash(accelerationRaw, params.accelerationScale);

    const newPostsHistory = history
      .map((item) => item.newPosts)
      .slice(-params.baselineLookbackWindows);
    const activeUsersHistory = history
      .map((item) => item.activeUsers)
      .slice(-params.baselineLookbackWindows);
    const newPostsRobustZ = robustZScore(current.newPosts, newPostsHistory);
    const activeUsersRobustZ = robustZScore(current.activeUsers, activeUsersHistory);
    const baselineRaw =
      params.baselineNewPostsWeight * newPostsRobustZ +
      params.baselineActiveUsersWeight * activeUsersRobustZ;
    const baselineDeviationScore = squash(baselineRaw, params.baselineScale);

    const changeRaw = changePointProxy(index, windows, params);
    const changeScore = squash(changeRaw, params.changeScale);

    const anomalyStrength =
      (Math.max(Math.abs(newPostsRobustZ), Math.abs(activeUsersRobustZ)) - params.anomalyZStart) /
      params.anomalyZDivisor;
    const anomalyScore = clamp(anomalyStrength, 0, 1);

    const trendRaw =
      params.trendWeightVelocity * velocityScore +
      params.trendWeightAcceleration * accelerationScore +
      params.trendWeightBaselineDeviation * baselineDeviationScore +
      params.trendWeightChange * changeScore +
      params.trendWeightAnomaly * anomalyScore;
    const trendScore = squash(trendRaw, params.trendScale);

    const sampleCount = Math.min(index, params.baselineLookbackWindows);
    const windowComplete = current.hasNewPosts && current.hasActiveUsers;

    points.push({
      targetId: args.targetId,
      windowStart: current.windowStart,
      windowEnd: current.windowEnd,
      granularity: current.granularity,
      newPosts: current.newPosts,
      activeUsers: current.activeUsers,
      subscribers: current.subscribers,
      deltaNewPostsVsPrevWindow: current.newPosts - (previous?.newPosts ?? 0),
      deltaActiveUsersVsPrevWindow: current.activeUsers - (previous?.activeUsers ?? 0),
      velocityScore: toFixedNumber(velocityScore),
      accelerationScore: toFixedNumber(accelerationScore),
      baselineDeviationScore: toFixedNumber(baselineDeviationScore),
      changeScore: toFixedNumber(changeScore),
      anomalyScore: toFixedNumber(anomalyScore),
      trendScore: toFixedNumber(trendScore),
      algorithmVersion: ALGORITHM_VERSION,
      algorithmParams: { ...params },
      sampleCount,
      windowComplete,
      scoreComponents: {
        newPostsGrowth: toFixedNumber(newPostsGrowth),
        activeUsersGrowth: toFixedNumber(activeUsersGrowth),
        subscribersGrowth: toFixedNumber(subscribersGrowth),
        velocityRaw: toFixedNumber(velocityRaw),
        accelerationRaw: toFixedNumber(accelerationRaw),
        newPostsRobustZ: toFixedNumber(newPostsRobustZ),
        activeUsersRobustZ: toFixedNumber(activeUsersRobustZ),
        baselineRaw: toFixedNumber(baselineRaw),
        changeRaw: toFixedNumber(changeRaw),
      },
    });

    previousVelocityRaw = velocityRaw;
  }

  return points;
}

function growthRate(current: number, previous?: number): number {
  if (previous == null) {
    return 0;
  }
  return (current - previous) / Math.max(Math.abs(previous), 1);
}

function robustZScore(current: number, history: number[]): number {
  if (history.length < 3) {
    return 0;
  }

  const medianValue = median(history);
  const absoluteDeviations = history.map((value) => Math.abs(value - medianValue));
  const mad = median(absoluteDeviations);
  const epsilon = 1e-9;

  if (mad > epsilon) {
    return (current - medianValue) / (1.4826 * mad);
  }

  const meanValue = mean(history);
  const stdDev = standardDeviation(history, meanValue);
  if (stdDev <= epsilon) {
    return 0;
  }
  return (current - meanValue) / stdDev;
}

function changePointProxy(
  index: number,
  windows: TrendWindowInput[],
  params: TrendScoringParams,
): number {
  const recentCount = Math.min(params.changeRecentWindows, index + 1);
  const baselineEnd = index - recentCount;
  if (baselineEnd < 0) {
    return 0;
  }

  const baselineStart = Math.max(0, baselineEnd - params.changeBaselineWindows + 1);
  const baselineSeries = windows.slice(baselineStart, baselineEnd + 1).map((item) => item.newPosts);
  if (baselineSeries.length < params.changeMinBaselineWindows) {
    return 0;
  }

  const recentSeries = windows
    .slice(index - recentCount + 1, index + 1)
    .map((item) => item.newPosts);
  const recentMean = mean(recentSeries);
  const baselineMean = mean(baselineSeries);
  const baselineStd = Math.max(standardDeviation(baselineSeries, baselineMean), 1);

  return (recentMean - baselineMean) / baselineStd;
}

function squash(value: number, scale: number): number {
  if (scale <= 0) {
    return Math.tanh(value);
  }
  return Math.tanh(value / scale);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function standardDeviation(values: number[], precomputedMean?: number): number {
  if (values.length < 2) {
    return 0;
  }
  const mu = precomputedMean ?? mean(values);
  const variance =
    values.reduce((sum, value) => {
      const diff = value - mu;
      return sum + diff * diff;
    }, 0) / values.length;
  return Math.sqrt(variance);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function toFixedNumber(value: number): number {
  return Number(value.toFixed(6));
}

