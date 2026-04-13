import type {
  ConnectorPage,
  ConnectorRequestContext,
  RawEnvelope,
} from "../shared/connector.interface";
import type { RedditConnector } from "./reddit-connector.interface";
import type {
  RedditAboutPayload,
  RedditCollectSubredditAboutArgs,
  RedditCollectSubredditPostsArgs,
  RedditListingPayload,
  RedditPostData,
} from "./reddit.types";

interface RedditHttpConnectorOptions {
  baseUrl?: string;
  userAgent?: string;
  accessToken?: string;
  timeoutMs?: number;
  healthcheckSubreddit?: string;
  maxRetries?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  jitterRatio?: number;
  rateLimitRemainingFloor?: number;
}

export class RedditHttpConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;

  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly accessToken?: string;
  private readonly timeoutMs: number;
  private readonly healthcheckSubreddit: string;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly backoffCapMs: number;
  private readonly jitterRatio: number;
  private readonly rateLimitRemainingFloor: number;

  constructor(options: RedditHttpConnectorOptions = {}) {
    this.accessToken = options.accessToken;
    this.baseUrl = options.baseUrl ?? (this.accessToken ? "https://oauth.reddit.com" : "https://www.reddit.com");
    if (this.baseUrl.includes("oauth.reddit.com") && !this.accessToken) {
      throw new Error("OAuth base URL requires accessToken");
    }

    this.userAgent = options.userAgent ?? "reddit-monitoring-mvp/0.1";
    this.timeoutMs = options.timeoutMs ?? 12000;
    this.healthcheckSubreddit = options.healthcheckSubreddit ?? "news";
    this.maxRetries = options.maxRetries ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 500;
    this.backoffCapMs = options.backoffCapMs ?? 10000;
    this.jitterRatio = options.jitterRatio ?? 0.2;
    this.rateLimitRemainingFloor = options.rateLimitRemainingFloor ?? 1;
  }

  public async collect(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    return this.collectSubredditPosts(args, ctx);
  }

  public async collectSubredditAbout(
    args: RedditCollectSubredditAboutArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditAboutPayload>> {
    const path = `/r/${encodeURIComponent(args.subreddit)}/about.json`;
    return this.requestJson<RedditAboutPayload>(path, {}, ctx);
  }

  public async collectSubredditPosts(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    const path = `/r/${encodeURIComponent(args.subreddit)}/new.json`;
    const params: Record<string, string | number | boolean | undefined> = {
      limit: args.limit,
      after: args.after,
    };

    const page = await this.requestJson<RedditListingPayload<RedditPostData>>(path, params, ctx);
    return {
      ...page,
      nextCursor: page.raw.payload.data.after,
    };
  }

  public async healthCheck(ctx: ConnectorRequestContext): Promise<boolean> {
    try {
      const result = await this.collectSubredditAbout(
        { subreddit: this.healthcheckSubreddit },
        ctx,
      );
      return result.raw.httpStatus >= 200 && result.raw.httpStatus < 300;
    } catch {
      return false;
    }
  }

  private async requestJson<TPayload>(
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<TPayload>> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: this.buildHeaders(ctx),
          signal: controller.signal,
        });

        const rateLimit = this.readRateLimit(response.headers);
        if (response.ok) {
          const payload = (await response.json()) as TPayload;
          const raw: RawEnvelope<TPayload> = {
            endpoint: path,
            requestParams: params,
            httpStatus: response.status,
            responseHeaders: this.headersToRecord(response.headers),
            payload,
            fetchedAt: new Date().toISOString(),
          };

          return {
            raw,
            rateLimit,
          };
        }

        const errorBody = await this.safeReadResponseBody(response);
        if (this.shouldRetryStatus(response.status) && attempt < this.maxRetries) {
          await this.sleep(this.computeDelayMs({
            attempt,
            retryAfterMs: this.readRetryAfterMs(response.headers),
            rateLimit,
          }));
          continue;
        }

        throw new Error(
          `Reddit request failed: status=${response.status}, endpoint=${path}, body=${errorBody}`,
        );
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries && this.shouldRetryError(error)) {
          await this.sleep(this.computeDelayMs({ attempt }));
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Reddit request failed unexpectedly");
  }

  private buildHeaders(ctx: ConnectorRequestContext): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Accept: "application/json",
      "X-Request-Id": ctx.requestId,
    };

    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    return headers;
  }

  private headersToRecord(headers: Headers): Record<string, string> {
    const output: Record<string, string> = {};
    headers.forEach((value, key) => {
      output[key] = value;
    });
    return output;
  }

  private readRateLimit(headers: Headers) {
    const remainingRaw = headers.get("x-ratelimit-remaining");
    const resetRaw = headers.get("x-ratelimit-reset");
    const usedRaw = headers.get("x-ratelimit-used");
    const remaining = remainingRaw ? Number(remainingRaw) : undefined;
    const resetSeconds = resetRaw ? Number(resetRaw) : undefined;
    const used = usedRaw ? Number(usedRaw) : undefined;
    const limit =
      Number.isFinite(remaining) && Number.isFinite(used) ? (remaining as number) + (used as number) : undefined;

    return {
      limit: Number.isFinite(limit) ? limit : undefined,
      remaining: Number.isFinite(remaining) ? remaining : undefined,
      resetAt:
        Number.isFinite(resetSeconds) && resetSeconds !== undefined
          ? new Date(Date.now() + resetSeconds * 1000).toISOString()
          : undefined,
    };
  }

  private shouldRetryStatus(status: number): boolean {
    return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }

  private shouldRetryError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "AbortError") {
      return true;
    }
    return error instanceof TypeError;
  }

  private readRetryAfterMs(headers: Headers): number | undefined {
    const raw = headers.get("retry-after");
    if (!raw) {
      return undefined;
    }

    const seconds = Number(raw);
    if (Number.isFinite(seconds)) {
      return Math.max(0, Math.floor(seconds * 1000));
    }

    const at = Date.parse(raw);
    if (Number.isNaN(at)) {
      return undefined;
    }
    return Math.max(0, at - Date.now());
  }

  private computeDelayMs(args: {
    attempt: number;
    retryAfterMs?: number;
    rateLimit?: { remaining?: number; resetAt?: string };
  }): number {
    let delayMs: number;

    if (typeof args.retryAfterMs === "number") {
      delayMs = args.retryAfterMs;
    } else if (
      typeof args.rateLimit?.remaining === "number" &&
      args.rateLimit.remaining <= this.rateLimitRemainingFloor &&
      args.rateLimit.resetAt
    ) {
      delayMs = Math.max(0, Date.parse(args.rateLimit.resetAt) - Date.now());
    } else {
      delayMs = Math.min(this.backoffCapMs, this.backoffBaseMs * 2 ** args.attempt);
    }

    const jitter = delayMs * this.jitterRatio;
    const randomized = delayMs + (Math.random() * 2 - 1) * jitter;
    return Math.max(0, Math.round(randomized));
  }

  private async safeReadResponseBody(response: Response): Promise<string> {
    try {
      const text = await response.text();
      return text.slice(0, 300);
    } catch {
      return "<unreadable-response-body>";
    }
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
