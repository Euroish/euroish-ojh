import type {
  ConnectorPage,
  ConnectorRequestContext,
} from "../shared/connector.interface";
import { RedditHttpConnector } from "./reddit-http.connector";
import type { RedditConnector } from "./reddit-connector.interface";
import type {
  RedditAboutPayload,
  RedditCollectSubredditAboutArgs,
  RedditCollectSubredditPostsArgs,
  RedditListingPayload,
  RedditPostData,
} from "./reddit.types";

export interface RedditApifyConnectorOptions {
  actorRunEndpoint?: string;
  token?: string;
  fallbackBaseUrl?: string;
  fallbackUserAgent?: string;
  fallbackAccessToken?: string;
}

export class RedditApifyConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;
  private readonly fallbackHttpConnector: RedditHttpConnector;

  constructor(private readonly options: RedditApifyConnectorOptions = {}) {
    this.fallbackHttpConnector = new RedditHttpConnector({
      baseUrl: options.fallbackBaseUrl,
      userAgent: options.fallbackUserAgent,
      accessToken: options.fallbackAccessToken,
    });
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
    // Temporary bridge: keep provider switch stable while external Apify payload contract
    // is finalized. This avoids runtime hard-fail in provider toggles.
    return this.fallbackHttpConnector.collectSubredditAbout(args, ctx);
  }

  public async collectSubredditPosts(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    return this.fallbackHttpConnector.collectSubredditPosts(args, ctx);
  }

  public async healthCheck(ctx: ConnectorRequestContext): Promise<boolean> {
    if (this.options.actorRunEndpoint && this.options.token) {
      return true;
    }
    return this.fallbackHttpConnector.healthCheck(ctx);
  }
}
