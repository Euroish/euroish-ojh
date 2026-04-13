import {
  createRedditConnector,
  resolveRedditLiveProvider,
} from "../../../src/connectors/reddit/create-reddit-connector";
import { PostgresClient } from "../../../src/storage/postgres/postgres-client";
import { createPostgresRepositoryBundle } from "../../../src/storage/repositories/postgres/postgres-repository-bundle";
import { createApiServer } from "./create-api-server";

const port = Number(process.env.PORT ?? 3000);
const apiBearerToken = process.env.API_BEARER_TOKEN?.trim();
if (!apiBearerToken) {
  throw new Error("API_BEARER_TOKEN is required");
}

const corsAllowOrigins = (process.env.API_CORS_ALLOW_ORIGINS ?? "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
const corsMaxAgeSeconds = Number.parseInt(process.env.API_CORS_MAX_AGE_SECONDS ?? "300", 10);
const liveProvider = resolveRedditLiveProvider(process.env.REDDIT_LIVE_PROVIDER);

const db = new PostgresClient();
const repos = createPostgresRepositoryBundle(db);

const server = createApiServer({
  repositories: repos,
  createConnector: (mode) =>
    createRedditConnector({
      mode,
      liveProvider,
      accessToken: process.env.REDDIT_ACCESS_TOKEN,
      userAgent: process.env.REDDIT_USER_AGENT,
      apifyActorRunEndpoint: process.env.APIFY_REDDIT_ACTOR_RUN_ENDPOINT,
      apifyToken: process.env.APIFY_TOKEN,
    }),
  auth: {
    bearerToken: apiBearerToken,
  },
  cors: {
    allowedOrigins: corsAllowOrigins,
    maxAgeSeconds: Number.isFinite(corsMaxAgeSeconds) ? corsMaxAgeSeconds : 300,
  },
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});

async function closeGracefully(): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await db.close();
}

process.on("SIGINT", () => {
  void closeGracefully().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void closeGracefully().finally(() => process.exit(0));
});
