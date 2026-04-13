import {
  createRedditConnector,
  resolveRedditLiveProvider,
} from "../connectors/reddit/create-reddit-connector";
import { DefaultRedditMapper } from "../connectors/reddit/reddit.mapper";
import { stableUuidFromString } from "../shared/ids/stable-id";
import { PostgresClient } from "../storage/postgres/postgres-client";
import { createPostgresRepositoryBundle } from "../storage/repositories/postgres/postgres-repository-bundle";
import { runRedditPhase1Cycle } from "./reddit-phase1.worker";

async function main(): Promise<void> {
  const subreddit = process.env.REDDIT_RUN_SUBREDDIT ?? "machinelearning";
  const nowIso = new Date().toISOString();
  const db = new PostgresClient();
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
      mode: "live",
      liveProvider: resolveRedditLiveProvider(process.env.REDDIT_LIVE_PROVIDER),
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

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          subreddit: `r/${subreddit}`,
          nowIso,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.close();
  }
}

void main();
