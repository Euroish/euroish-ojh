import {
  createRedditConnector,
  resolveRedditLiveProvider,
} from "../src/connectors/reddit/create-reddit-connector";
import { DefaultRedditMapper } from "../src/connectors/reddit/reddit.mapper";
import { stableUuidFromString } from "../src/shared/ids/stable-id";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { createPostgresRepositoryBundle } from "../src/storage/repositories/postgres/postgres-repository-bundle";
import { runRedditPhase1Cycle } from "../src/workers/reddit-phase1.worker";

export type SchedulerRunMode = "mock" | "live";

function resolveRunMode(value: string | undefined): SchedulerRunMode {
  return value === "mock" ? "mock" : "live";
}

function parseSubredditListFromEnv(env: NodeJS.ProcessEnv): string[] {
  const raw = env.REDDIT_RUN_SUBREDDITS ?? env.REDDIT_RUN_SUBREDDIT ?? "";
  const unique = new Set<string>();
  for (const token of raw.split(",")) {
    const normalized = token.trim().replace(/^r\//i, "").toLowerCase();
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }
  return Array.from(unique);
}

function parseIntervalMs(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 5_000) {
    return 60_000;
  }
  return parsed;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return fallback;
}

async function main(): Promise<void> {
  const intervalMs = parseIntervalMs(process.env.PHASE1_SCHEDULER_INTERVAL_MS);
  const runOnBoot = parseBoolean(process.env.PHASE1_SCHEDULER_RUN_ON_START, true);
  const runMode = resolveRunMode(process.env.REDDIT_RUN_MODE);
  const liveProvider = resolveRedditLiveProvider(process.env.REDDIT_LIVE_PROVIDER);
  const subreddits = parseSubredditListFromEnv(process.env);

  const db = new PostgresClient();
  const repos = createPostgresRepositoryBundle(db);
  const connector = createRedditConnector({
    mode: runMode,
    liveProvider,
    accessToken: process.env.REDDIT_ACCESS_TOKEN,
    userAgent: process.env.REDDIT_USER_AGENT,
    apifyActorRunEndpoint: process.env.APIFY_REDDIT_ACTOR_RUN_ENDPOINT,
    apifyToken: process.env.APIFY_TOKEN,
  });
  const redditMapper = new DefaultRedditMapper();

  let inFlight = false;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const runCycle = async (): Promise<void> => {
    if (stopped || inFlight) {
      return;
    }
    inFlight = true;
    const nowIso = new Date().toISOString();
    try {
      for (const subreddit of subreddits) {
        await repos.monitorTargetRepository.upsert({
          id: stableUuidFromString(`reddit:target:r/${subreddit}`),
          source: "reddit",
          targetType: "subreddit",
          canonicalName: `r/${subreddit}`,
          status: "active",
          config: {},
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }

      const result = await runRedditPhase1Cycle(
        {
          ...repos,
          redditConnector: connector,
          redditMapper,
        },
        nowIso,
      );

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "scheduler.cycle.completed",
          nowIso,
          mode: runMode,
          intervalMs,
          processedCanonicalNames: result.processedCanonicalNames,
          requestedCanonicalNames: result.requestedCanonicalNames,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          event: "scheduler.cycle.failed",
          nowIso,
          mode: runMode,
          intervalMs,
          error: message,
        }),
      );
    } finally {
      inFlight = false;
    }
  };

  const closeGracefully = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    while (inFlight) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await db.close();
  };

  process.on("SIGINT", () => {
    void closeGracefully().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void closeGracefully().finally(() => process.exit(0));
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "scheduler.started",
      mode: runMode,
      intervalMs,
      runOnBoot,
      seedSubreddits: subreddits.map((item) => `r/${item}`),
    }),
  );

  if (runOnBoot) {
    await runCycle();
  }
  timer = setInterval(() => {
    void runCycle();
  }, intervalMs);
}

if (require.main === module) {
  void main();
}
