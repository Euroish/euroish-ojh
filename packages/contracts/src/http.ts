export interface ApiHealthResponse {
  ok: boolean;
  requestId: string;
  service: "reddit-monitoring-mvp";
  nowIso: string;
}

export interface CreateSubredditTargetRequest {
  subreddit: string;
}

export interface CreateSubredditTargetResponse {
  ok: boolean;
  requestId: string;
  targetId: string;
  canonicalName: string;
}

export type RunMode = "mock" | "live";

export interface TriggerPhase1RunRequest {
  subreddit?: string;
  mode?: RunMode;
}

export interface TriggerPhase1RunResponse {
  ok: boolean;
  requestId: string;
  mode: RunMode;
  nowIso: string;
  subreddit?: string;
  requestedCanonicalNames: string[];
  processedCanonicalNames: string[];
}

export interface SubredditTrendResponse {
  ok: boolean;
  requestId: string;
  generatedAtIso: string;
  targetId: string;
  canonicalName: string;
  fromIso: string;
  toIso: string;
  timeline: {
    granularity: "15m";
    windowMinutes: 15;
    comparison: "previous_window";
    pointCount: number;
  };
  summary: {
    pointCount: number;
    latestWindowStart: string | null;
    latestWindowEnd: string | null;
    latestTrendScore: number | null;
    latestTrendDirection: "rising" | "flat" | "falling" | "unknown";
  };
  topMovers: Array<{
    windowStart: string;
    windowEnd: string;
    deltaNewPostsVsPrevWindow: number;
    trendScore: number;
  }>;
  recentAnomalies: Array<{
    windowStart: string;
    windowEnd: string;
    anomalyScore: number;
    trendScore: number;
  }>;
  points: Array<{
    windowStart: string;
    windowEnd: string;
    newPosts: number;
    deltaNewPostsVsPrevWindow: number;
    deltaActiveUsersVsPrevWindow: number;
    trendScore: number;
    velocityScore?: number;
    accelerationScore?: number;
    baselineDeviationScore?: number;
    changeScore?: number;
    anomalyScore?: number;
    algorithmVersion?: string;
    sampleCount?: number;
    windowComplete?: boolean;
    scoreComponents?: Record<string, unknown>;
  }>;
  recentPosts: Array<{
    id: string;
    externalId: string;
    title: string;
    permalink: string;
    createdAtSource: string;
    url?: string;
    bodySnippet?: string;
  }>;
}

export interface ApiErrorResponse {
  ok: false;
  requestId: string;
  error: string;
  errorCode: string;
}
