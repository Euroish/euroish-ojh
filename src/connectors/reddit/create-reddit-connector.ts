import { RedditApifyConnector } from "./reddit-apify.connector";
import type { RedditConnector } from "./reddit-connector.interface";
import { RedditHttpConnector } from "./reddit-http.connector";
import { RedditMockConnector } from "./reddit-mock.connector";

export type RedditRunMode = "mock" | "live";
export type RedditLiveProvider = "http" | "apify";

export interface CreateRedditConnectorOptions {
  mode: RedditRunMode;
  liveProvider?: RedditLiveProvider;
  accessToken?: string;
  userAgent?: string;
  apifyActorRunEndpoint?: string;
  apifyToken?: string;
}

export function resolveRedditLiveProvider(value: string | undefined): RedditLiveProvider {
  return value === "apify" ? "apify" : "http";
}

export function createRedditConnector(
  options: CreateRedditConnectorOptions,
): RedditConnector {
  if (options.mode === "mock") {
    return new RedditMockConnector();
  }

  const provider = options.liveProvider ?? "http";
  if (provider === "apify") {
    return new RedditApifyConnector({
      actorRunEndpoint: options.apifyActorRunEndpoint,
      token: options.apifyToken,
      fallbackAccessToken: options.accessToken,
      fallbackUserAgent: options.userAgent,
    });
  }

  return new RedditHttpConnector({
    accessToken: options.accessToken,
    userAgent: options.userAgent,
  });
}
