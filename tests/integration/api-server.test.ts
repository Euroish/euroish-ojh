import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import {
  InMemoryAccountRepository,
  InMemoryCollectionJobRepository,
  InMemoryContentRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryMonitorTargetRepository,
  InMemoryRawEventRepository,
  InMemorySubredditTrendPointRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";

interface JsonResponse<T> {
  status: number;
  body: T;
  requestId: string | null;
}

async function startServer(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function getJson<T>(url: string): Promise<JsonResponse<T>> {
  const response = await fetch(url);
  const body = (await response.json()) as T;
  return {
    status: response.status,
    body,
    requestId: response.headers.get("x-request-id"),
  };
}

async function postJson<T>(
  url: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<JsonResponse<T>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as T;
  return {
    status: response.status,
    body,
    requestId: response.headers.get("x-request-id"),
  };
}

async function optionsRequest(url: string, headers: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "OPTIONS",
    headers,
  });
}

test("api server can seed target, run phase1 and read trends", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const server = createApiServer({
    repositories: {
      monitorTargetRepository: new InMemoryMonitorTargetRepository(),
      collectionJobRepository: new InMemoryCollectionJobRepository(),
      rawEventRepository: new InMemoryRawEventRepository(),
      accountRepository: new InMemoryAccountRepository(),
      contentRepository: new InMemoryContentRepository(),
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      subredditTrendPointRepository: new InMemorySubredditTrendPointRepository(),
    },
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const seedResult = await postJson<{ ok: boolean; requestId: string; canonicalName: string }>(
      `${baseUrl}/v1/targets/subreddit`,
      { subreddit: "DataScience" },
    );
    assert.equal(seedResult.status, 200);
    assert.equal(seedResult.body.ok, true);
    assert.equal(seedResult.body.canonicalName, "r/datascience");
    assert.equal(typeof seedResult.body.requestId, "string");
    assert.equal(seedResult.requestId, seedResult.body.requestId);

    const runResult = await postJson<{
      ok: boolean;
      requestId: string;
      mode: string;
      processedCanonicalNames: string[];
    }>(`${baseUrl}/v1/runs/reddit-phase1`, {
      mode: "mock",
      subreddit: "datascience",
    });
    assert.equal(runResult.status, 200);
    assert.equal(runResult.body.ok, true);
    assert.equal(runResult.body.mode, "mock");
    assert.deepEqual(runResult.body.processedCanonicalNames, ["r/datascience"]);
    assert.equal(runResult.requestId, runResult.body.requestId);

    const trendResult = await getJson<{
      ok: boolean;
      requestId: string;
      canonicalName: string;
      summary: { latestTrendDirection: string };
      topMovers: unknown[];
      recentAnomalies: unknown[];
      points: unknown[];
      recentPosts: unknown[];
    }>(
      `${baseUrl}/v1/trends/subreddit/datascience?from=2026-04-10T10:00:00.000Z&to=2026-04-10T12:15:00.000Z`,
    );
    assert.equal(trendResult.status, 200);
    assert.equal(trendResult.body.ok, true);
    assert.equal(trendResult.body.canonicalName, "r/datascience");
    assert.equal(trendResult.requestId, trendResult.body.requestId);
    assert.equal(trendResult.body.points.length > 0, true);
    assert.equal(trendResult.body.recentPosts.length > 0, true);
    assert.equal(["rising", "flat", "falling", "unknown"].includes(trendResult.body.summary.latestTrendDirection), true);
    assert.equal(Array.isArray(trendResult.body.topMovers), true);
    assert.equal(Array.isArray(trendResult.body.recentAnomalies), true);
  } finally {
    await stopServer(server);
  }
});

test("api server rejects unsupported run mode", async () => {
  const server = createApiServer({
    repositories: {
      monitorTargetRepository: new InMemoryMonitorTargetRepository(),
      collectionJobRepository: new InMemoryCollectionJobRepository(),
      rawEventRepository: new InMemoryRawEventRepository(),
      accountRepository: new InMemoryAccountRepository(),
      contentRepository: new InMemoryContentRepository(),
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      subredditTrendPointRepository: new InMemorySubredditTrendPointRepository(),
    },
    createConnector: () => new RedditMockConnector(),
  });

  const baseUrl = await startServer(server);
  try {
    const result = await postJson<{ ok: boolean; error: string; errorCode: string; requestId: string }>(
      `${baseUrl}/v1/runs/reddit-phase1`,
      { mode: "invalid-mode" },
    );
    assert.equal(result.status, 400);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.error, "mode must be live or mock");
    assert.equal(result.body.errorCode, "invalid_run_mode");
    assert.equal(result.body.requestId, result.requestId);
  } finally {
    await stopServer(server);
  }
});

test("api server validates recentPostsLimit query parameter", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const server = createApiServer({
    repositories: {
      monitorTargetRepository: new InMemoryMonitorTargetRepository(),
      collectionJobRepository: new InMemoryCollectionJobRepository(),
      rawEventRepository: new InMemoryRawEventRepository(),
      accountRepository: new InMemoryAccountRepository(),
      contentRepository: new InMemoryContentRepository(),
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      subredditTrendPointRepository: new InMemorySubredditTrendPointRepository(),
    },
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    await postJson(`${baseUrl}/v1/targets/subreddit`, { subreddit: "datascience" });
    await postJson(`${baseUrl}/v1/runs/reddit-phase1`, { mode: "mock", subreddit: "datascience" });

    const result = await getJson<{ ok: boolean; errorCode: string }>(
      `${baseUrl}/v1/trends/subreddit/datascience?recentPostsLimit=100`,
    );
    assert.equal(result.status, 400);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.errorCode, "invalid_query_param");
  } finally {
    await stopServer(server);
  }
});

test("api server enforces bearer auth on /v1 routes", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const server = createApiServer({
    repositories: {
      monitorTargetRepository: new InMemoryMonitorTargetRepository(),
      collectionJobRepository: new InMemoryCollectionJobRepository(),
      rawEventRepository: new InMemoryRawEventRepository(),
      accountRepository: new InMemoryAccountRepository(),
      contentRepository: new InMemoryContentRepository(),
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      subredditTrendPointRepository: new InMemorySubredditTrendPointRepository(),
    },
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
    auth: {
      bearerToken: "test-token",
    },
  });

  const baseUrl = await startServer(server);
  try {
    const noTokenResult = await postJson<{ ok: boolean; errorCode: string }>(
      `${baseUrl}/v1/targets/subreddit`,
      { subreddit: "datascience" },
    );
    assert.equal(noTokenResult.status, 401);
    assert.equal(noTokenResult.body.ok, false);
    assert.equal(noTokenResult.body.errorCode, "unauthorized");

    const wrongTokenResult = await postJson<{ ok: boolean; errorCode: string }>(
      `${baseUrl}/v1/targets/subreddit`,
      { subreddit: "datascience" },
      { authorization: "Bearer wrong-token" },
    );
    assert.equal(wrongTokenResult.status, 401);
    assert.equal(wrongTokenResult.body.ok, false);
    assert.equal(wrongTokenResult.body.errorCode, "unauthorized");

    const okResult = await postJson<{ ok: boolean; canonicalName: string }>(
      `${baseUrl}/v1/targets/subreddit`,
      { subreddit: "datascience" },
      { authorization: "Bearer test-token" },
    );
    assert.equal(okResult.status, 200);
    assert.equal(okResult.body.ok, true);
    assert.equal(okResult.body.canonicalName, "r/datascience");

    const healthz = await getJson<{ ok: boolean }>(`${baseUrl}/healthz`);
    assert.equal(healthz.status, 200);
    assert.equal(healthz.body.ok, true);
  } finally {
    await stopServer(server);
  }
});

test("api server supports CORS preflight and blocks unknown origins", async () => {
  const server = createApiServer({
    repositories: {
      monitorTargetRepository: new InMemoryMonitorTargetRepository(),
      collectionJobRepository: new InMemoryCollectionJobRepository(),
      rawEventRepository: new InMemoryRawEventRepository(),
      accountRepository: new InMemoryAccountRepository(),
      contentRepository: new InMemoryContentRepository(),
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      subredditTrendPointRepository: new InMemorySubredditTrendPointRepository(),
    },
    createConnector: () => new RedditMockConnector(),
    cors: {
      allowedOrigins: ["https://frontend.example.com"],
    },
  });

  const baseUrl = await startServer(server);
  try {
    const preflight = await optionsRequest(`${baseUrl}/v1/targets/subreddit`, {
      origin: "https://frontend.example.com",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,authorization",
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      "https://frontend.example.com",
    );
    assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");

    const blocked = await postJson<{ ok: boolean; errorCode: string }>(
      `${baseUrl}/v1/targets/subreddit`,
      { subreddit: "datascience" },
      { origin: "https://evil.example.com" },
    );
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.ok, false);
    assert.equal(blocked.body.errorCode, "cors_origin_not_allowed");
  } finally {
    await stopServer(server);
  }
});
