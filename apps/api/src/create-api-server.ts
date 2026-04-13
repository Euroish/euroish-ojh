import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type {
  ApiErrorResponse,
  ApiHealthResponse,
  CreateSubredditTargetRequest,
  CreateSubredditTargetResponse,
  RunMode,
  SubredditTrendResponse,
  TriggerPhase1RunRequest,
  TriggerPhase1RunResponse,
} from "../../../packages/contracts/src/http";
import { buildSubredditTrendReadModel } from "../../../src/application/services/subreddit-trend-read-model";
import type { RedditConnector } from "../../../src/connectors/reddit/reddit-connector.interface";
import { DefaultRedditMapper } from "../../../src/connectors/reddit/reddit.mapper";
import type { RedditMapper } from "../../../src/connectors/reddit/reddit-mapper.interface";
import { stableUuidFromString } from "../../../src/shared/ids/stable-id";
import type { AccountRepository } from "../../../src/domain/repositories/account-repository";
import type { CollectionJobRepository } from "../../../src/domain/repositories/collection-job-repository";
import type { ContentRepository } from "../../../src/domain/repositories/content-repository";
import type { MetricsSnapshotRepository } from "../../../src/domain/repositories/metrics-snapshot-repository";
import type { MonitorTargetRepository } from "../../../src/domain/repositories/monitor-target-repository";
import type { RawEventRepository } from "../../../src/domain/repositories/raw-event-repository";
import type { SubredditTrendPointRepository } from "../../../src/domain/repositories/subreddit-trend-point-repository";
import { runRedditPhase1Cycle } from "../../../src/workers/reddit-phase1.worker";
import {
  BadRequestError,
  normalizeSubredditName,
  parseOptionalIntegerParam,
  resolveRunMode,
  resolveTrendRange,
} from "./api-validation";

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body, null, 2));
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return null;
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new BadRequestError("invalid JSON body", "invalid_json");
  }
}

type ApiLogLevel = "info" | "error";

interface ApiRequestLog {
  level: ApiLogLevel;
  event: "api.request.completed";
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  targetId?: string;
  canonicalName?: string;
  mode?: RunMode;
  errorCode?: string;
}

export interface ApiRepositoryBundle {
  monitorTargetRepository: MonitorTargetRepository;
  collectionJobRepository: CollectionJobRepository;
  rawEventRepository: RawEventRepository;
  accountRepository: AccountRepository;
  contentRepository: ContentRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
}

export interface CreateApiServerOptions {
  repositories: ApiRepositoryBundle;
  createConnector: (mode: RunMode) => RedditConnector;
  redditMapper?: RedditMapper;
  now?: () => string;
  logger?: (event: ApiRequestLog) => void;
  requestIdGenerator?: () => string;
  auth?: {
    bearerToken?: string;
    protectedPathPrefixes?: string[];
  };
  cors?: {
    allowedOrigins?: string[];
    allowedMethods?: string[];
    allowedHeaders?: string[];
    maxAgeSeconds?: number;
  };
}

function defaultApiLogger(event: ApiRequestLog): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(event));
}

function toApiError(args: {
  requestId: string;
  message: string;
  code: string;
}): ApiErrorResponse {
  return {
    ok: false,
    requestId: args.requestId,
    error: args.message,
    errorCode: args.code,
  };
}

function toBodySnippet(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length <= 140 ? trimmed : `${trimmed.slice(0, 137)}...`;
}

function resolveRequestId(req: IncomingMessage, fallback: () => string): string {
  const headerValue = req.headers["x-request-id"];
  const requestId = typeof headerValue === "string" ? headerValue.trim() : "";
  if (!requestId || requestId.length > 128) {
    return fallback();
  }
  return requestId;
}

function appendVaryHeader(res: ServerResponse, value: string): void {
  const existing = res.getHeader("Vary");
  if (!existing) {
    res.setHeader("Vary", value);
    return;
  }
  const normalized = String(existing)
    .split(",")
    .map((item) => item.trim().toLowerCase());
  if (!normalized.includes(value.toLowerCase())) {
    res.setHeader("Vary", `${existing}, ${value}`);
  }
}

function resolveAllowedOrigin(args: {
  origin?: string;
  allowedOrigins: string[];
}): string | null {
  if (!args.origin) {
    return null;
  }
  if (args.allowedOrigins.includes("*")) {
    return "*";
  }
  return args.allowedOrigins.includes(args.origin) ? args.origin : null;
}

function applyCorsHeaders(args: {
  req: IncomingMessage;
  res: ServerResponse;
  allowedOrigins: string[];
}): { origin?: string; blocked: boolean } {
  if (args.allowedOrigins.length === 0) {
    return { blocked: false };
  }

  const originHeader = args.req.headers.origin;
  const origin = typeof originHeader === "string" ? originHeader.trim() : undefined;
  if (!origin) {
    return { blocked: false };
  }

  const allowedOrigin = resolveAllowedOrigin({
    origin,
    allowedOrigins: args.allowedOrigins,
  });
  if (!allowedOrigin) {
    return { origin, blocked: true };
  }

  args.res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  if (allowedOrigin !== "*") {
    appendVaryHeader(args.res, "Origin");
  }
  return { origin: allowedOrigin, blocked: false };
}

function applyPreflightHeaders(args: {
  req: IncomingMessage;
  res: ServerResponse;
  allowedMethods: string[];
  allowedHeaders: string[];
  maxAgeSeconds: number;
}): void {
  args.res.setHeader("Access-Control-Allow-Methods", args.allowedMethods.join(", "));

  const requestedHeaders = args.req.headers["access-control-request-headers"];
  const requested = typeof requestedHeaders === "string" ? requestedHeaders.trim() : "";
  const allowHeaders = requested.length > 0 ? requested : args.allowedHeaders.join(", ");
  args.res.setHeader("Access-Control-Allow-Headers", allowHeaders);
  args.res.setHeader("Access-Control-Max-Age", String(args.maxAgeSeconds));
}

function readBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return null;
  }
  const [scheme, token] = header.trim().split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}

function isBearerTokenValid(req: IncomingMessage, expectedToken: string): boolean {
  const providedToken = readBearerToken(req);
  if (!providedToken) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedToken);
  const providedBuffer = Buffer.from(providedToken);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function createApiServer(options: CreateApiServerOptions): Server {
  const repos = options.repositories;
  const now = options.now ?? (() => new Date().toISOString());
  const redditMapper = options.redditMapper ?? new DefaultRedditMapper();
  const logger = options.logger ?? defaultApiLogger;
  const requestIdGenerator = options.requestIdGenerator ?? randomUUID;
  const bearerToken = options.auth?.bearerToken?.trim() || undefined;
  const protectedPathPrefixes = options.auth?.protectedPathPrefixes ?? ["/v1/"];
  const corsAllowedOrigins =
    options.cors?.allowedOrigins?.map((origin) => origin.trim()).filter((origin) => origin.length > 0) ??
    [];
  const corsAllowedMethods =
    options.cors?.allowedMethods?.map((method) => method.trim().toUpperCase()).filter(Boolean) ??
    ["GET", "POST", "OPTIONS"];
  const corsAllowedHeaders =
    options.cors?.allowedHeaders?.map((header) => header.trim()).filter(Boolean) ??
    ["content-type", "authorization", "x-request-id"];
  const corsMaxAgeSeconds = Math.max(0, options.cors?.maxAgeSeconds ?? 300);

  return createServer(async (req, res) => {
    const requestId = resolveRequestId(req, requestIdGenerator);
    const startedAtMs = Date.now();
    let pathForLog = req.url ?? "/";
    const methodForLog = req.method ?? "UNKNOWN";
    res.setHeader("x-request-id", requestId);

    const respond = (args: {
      statusCode: number;
      body: unknown;
      level?: ApiLogLevel;
      targetId?: string;
      canonicalName?: string;
      mode?: RunMode;
      errorCode?: string;
    }): void => {
      sendJson(res, args.statusCode, args.body);
      logger({
        level: args.level ?? (args.statusCode >= 500 ? "error" : "info"),
        event: "api.request.completed",
        requestId,
        method: methodForLog,
        path: pathForLog,
        statusCode: args.statusCode,
        durationMs: Date.now() - startedAtMs,
        targetId: args.targetId,
        canonicalName: args.canonicalName,
        mode: args.mode,
        errorCode: args.errorCode,
      });
    };

    const respondNoContent = (statusCode: number): void => {
      res.statusCode = statusCode;
      res.end();
      logger({
        level: statusCode >= 500 ? "error" : "info",
        event: "api.request.completed",
        requestId,
        method: methodForLog,
        path: pathForLog,
        statusCode,
        durationMs: Date.now() - startedAtMs,
      });
    };

    try {
      if (!req.url || !req.method) {
        respond({
          statusCode: 400,
          body: toApiError({
            requestId,
            message: "invalid request",
            code: "invalid_request",
          }),
          errorCode: "invalid_request",
        });
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const pathname = url.pathname;
      pathForLog = pathname;

      const corsResult = applyCorsHeaders({
        req,
        res,
        allowedOrigins: corsAllowedOrigins,
      });
      if (corsResult.blocked) {
        respond({
          statusCode: 403,
          body: toApiError({
            requestId,
            message: "CORS origin is not allowed",
            code: "cors_origin_not_allowed",
          }),
          errorCode: "cors_origin_not_allowed",
        });
        return;
      }

      if (req.method === "OPTIONS") {
        applyPreflightHeaders({
          req,
          res,
          allowedMethods: corsAllowedMethods,
          allowedHeaders: corsAllowedHeaders,
          maxAgeSeconds: corsMaxAgeSeconds,
        });
        respondNoContent(204);
        return;
      }

      const needsAuth =
        Boolean(bearerToken) &&
        protectedPathPrefixes.some((prefix) => pathname.startsWith(prefix));
      if (needsAuth && bearerToken && !isBearerTokenValid(req, bearerToken)) {
        respond({
          statusCode: 401,
          body: toApiError({
            requestId,
            message: "unauthorized",
            code: "unauthorized",
          }),
          errorCode: "unauthorized",
        });
        return;
      }

      if (req.method === "GET" && pathname === "/healthz") {
        const payload: ApiHealthResponse = {
          ok: true,
          requestId,
          service: "reddit-monitoring-mvp",
          nowIso: now(),
        };
        respond({
          statusCode: 200,
          body: payload,
        });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/targets/subreddit") {
        const body = await readJsonBody<CreateSubredditTargetRequest>(req);
        if (!body || typeof body.subreddit !== "string" || body.subreddit.trim() === "") {
          respond({
            statusCode: 400,
            body: toApiError({
              requestId,
              message: "subreddit is required",
              code: "missing_subreddit",
            }),
            errorCode: "missing_subreddit",
          });
          return;
        }

        const nowIso = now();
        const subreddit = normalizeSubredditName(body.subreddit);
        const canonicalName = `r/${subreddit}`;
        const targetId = stableUuidFromString(`reddit:target:${canonicalName}`);

        await repos.monitorTargetRepository.upsert({
          id: targetId,
          source: "reddit",
          targetType: "subreddit",
          canonicalName,
          status: "active",
          config: {},
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        const payload: CreateSubredditTargetResponse = {
          ok: true,
          requestId,
          targetId,
          canonicalName,
        };
        respond({
          statusCode: 200,
          body: payload,
          targetId,
          canonicalName,
        });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/runs/reddit-phase1") {
        const body = await readJsonBody<TriggerPhase1RunRequest>(req);
        const requestedMode = body?.mode ?? process.env.REDDIT_RUN_MODE;
        const mode = resolveRunMode(requestedMode);
        if (!mode) {
          respond({
            statusCode: 400,
            body: toApiError({
              requestId,
              message: "mode must be live or mock",
              code: "invalid_run_mode",
            }),
            errorCode: "invalid_run_mode",
          });
          return;
        }

        const requestedSubreddit =
          typeof body?.subreddit === "string" && body.subreddit.trim().length > 0
            ? normalizeSubredditName(body.subreddit)
            : undefined;

        if (requestedSubreddit) {
          const nowIso = now();
          const canonicalName = `r/${requestedSubreddit}`;
          await repos.monitorTargetRepository.upsert({
            id: stableUuidFromString(`reddit:target:${canonicalName}`),
            source: "reddit",
            targetType: "subreddit",
            canonicalName,
            status: "active",
            config: {},
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }

        const nowIso = now();
        const runResult = await runRedditPhase1Cycle(
          {
            ...repos,
            redditConnector: options.createConnector(mode),
            redditMapper,
          },
          nowIso,
          {
            targetCanonicalNames: requestedSubreddit ? [`r/${requestedSubreddit}`] : undefined,
          },
        );

        const payload: TriggerPhase1RunResponse = {
          ok: true,
          requestId,
          mode,
          nowIso,
          subreddit: requestedSubreddit ? `r/${requestedSubreddit}` : undefined,
          requestedCanonicalNames: runResult.requestedCanonicalNames,
          processedCanonicalNames: runResult.processedCanonicalNames,
        };
        respond({
          statusCode: 200,
          body: payload,
          canonicalName: requestedSubreddit ? `r/${requestedSubreddit}` : undefined,
          mode,
        });
        return;
      }

      if (req.method === "GET" && pathname.startsWith("/v1/trends/subreddit/")) {
        const subredditRaw = pathname.replace("/v1/trends/subreddit/", "");
        const subreddit = normalizeSubredditName(decodeURIComponent(subredditRaw));
        if (!subreddit) {
          sendJson(res, 400, { ok: false, error: "subreddit is required" });
          return;
        }

        const canonicalName = `r/${subreddit}`;
        const target = await repos.monitorTargetRepository.findByCanonicalName(canonicalName);
        if (!target) {
          respond({
            statusCode: 404,
            body: toApiError({
              requestId,
              message: `target not found: ${canonicalName}`,
              code: "target_not_found",
            }),
            canonicalName,
            errorCode: "target_not_found",
          });
          return;
        }

        const { fromIso, toIso } = resolveTrendRange(url.searchParams, now());
        const recentPostsLimit =
          parseOptionalIntegerParam({
            value: url.searchParams.get("recentPostsLimit"),
            name: "recentPostsLimit",
            min: 1,
            max: 50,
          }) ?? 20;

        const [points, recentPosts] = await Promise.all([
          repos.subredditTrendPointRepository.listByTargetInRange({
            targetId: target.id,
            from: fromIso,
            to: toIso,
          }),
          repos.contentRepository.findRecentByTarget(target.id, recentPostsLimit),
        ]);
        const trendReadModel = buildSubredditTrendReadModel(points);

        const payload: SubredditTrendResponse = {
          ok: true,
          requestId,
          generatedAtIso: now(),
          targetId: target.id,
          canonicalName,
          fromIso,
          toIso,
          timeline: trendReadModel.timeline,
          summary: trendReadModel.summary,
          topMovers: trendReadModel.topMovers,
          recentAnomalies: trendReadModel.recentAnomalies,
          points: points.map((point) => ({
            windowStart: point.windowStart,
            windowEnd: point.windowEnd,
            newPosts: point.newPosts,
            deltaNewPostsVsPrevWindow: point.deltaNewPostsVsPrevWindow,
            deltaActiveUsersVsPrevWindow: point.deltaActiveUsersVsPrevWindow,
            trendScore: point.trendScore,
            velocityScore: point.velocityScore,
            accelerationScore: point.accelerationScore,
            baselineDeviationScore: point.baselineDeviationScore,
            changeScore: point.changeScore,
            anomalyScore: point.anomalyScore,
            algorithmVersion: point.algorithmVersion,
            sampleCount: point.sampleCount,
            windowComplete: point.windowComplete,
            scoreComponents: point.scoreComponents,
          })),
          recentPosts: recentPosts.map((post) => ({
            id: post.id,
            externalId: post.externalId,
            title: post.title,
            permalink: post.permalink,
            createdAtSource: post.createdAtSource,
            url: post.url,
            bodySnippet: toBodySnippet(post.bodyText),
          })),
        };
        respond({
          statusCode: 200,
          body: payload,
          targetId: target.id,
          canonicalName,
        });
        return;
      }

      respond({
        statusCode: 404,
        body: toApiError({
          requestId,
          message: "not found",
          code: "route_not_found",
        }),
        errorCode: "route_not_found",
      });
    } catch (error) {
      if (error instanceof BadRequestError) {
        respond({
          statusCode: 400,
          body: toApiError({
            requestId,
            message: error.message,
            code: error.code,
          }),
          errorCode: error.code,
        });
        return;
      }
      const message = error instanceof Error ? error.message : "unknown error";
      respond({
        statusCode: 500,
        body: toApiError({
          requestId,
          message,
          code: "internal_error",
        }),
        level: "error",
        errorCode: "internal_error",
      });
    }
  });
}
