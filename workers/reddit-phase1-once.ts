import {
  createRedditConnector,
  resolveRedditLiveProvider,
} from "../src/connectors/reddit/create-reddit-connector";
import { DefaultRedditMapper } from "../src/connectors/reddit/reddit.mapper";
import { stableUuidFromString } from "../src/shared/ids/stable-id";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { createPostgresRepositoryBundle } from "../src/storage/repositories/postgres/postgres-repository-bundle";
import { runRedditPhase1Cycle } from "../src/workers/reddit-phase1.worker";

export type RunMode = "mock" | "live";

export function resolveRunMode(value: string | undefined): RunMode {
  return value === "mock" ? "mock" : "live";
}

export interface RunPhase1OnceWithPostgresOptions {
  subreddit?: string;
  runMode?: RunMode;
  nowIso?: string;
  db?: PostgresClient;
}

export async function runPhase1OnceWithPostgres(
  options: RunPhase1OnceWithPostgresOptions = {},
): Promise<{
  ok: true;
  mode: RunMode;
  subreddit: string;
  nowIso: string;
}> {
  const subreddit = options.subreddit ?? process.env.REDDIT_RUN_SUBREDDIT ?? "machinelearning";
  const nowIso = options.nowIso ?? new Date().toISOString();
  const runMode = options.runMode ?? resolveRunMode(process.env.REDDIT_RUN_MODE);
  const liveProvider = resolveRedditLiveProvider(process.env.REDDIT_LIVE_PROVIDER);
  const db = options.db ?? new PostgresClient();
  const shouldClose = !options.db;

  try {
    const repos = createPostgresRepositoryBundle(db);

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

    const connector = createRedditConnector({
      mode: runMode,
      liveProvider,
      accessToken: process.env.REDDIT_ACCESS_TOKEN,
      userAgent: process.env.REDDIT_USER_AGENT,
      apifyActorRunEndpoint: process.env.APIFY_REDDIT_ACTOR_RUN_ENDPOINT,
      apifyToken: process.env.APIFY_TOKEN,
    });

    await runRedditPhase1Cycle(
      {
        ...repos,
        redditConnector: connector,
        redditMapper: new DefaultRedditMapper(),
      },
      nowIso,
      {
        targetCanonicalNames: [`r/${subreddit}`],
      },
    );
    return {
      ok: true,
      mode: runMode,
      subreddit: `r/${subreddit}`,
      nowIso,
    };
  } finally {
    if (shouldClose) {
      await db.close();
    }
  }
}

async function main(): Promise<void> {
  const result = await runPhase1OnceWithPostgres();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  void main();
}
