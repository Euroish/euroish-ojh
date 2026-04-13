import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

export interface SqlQueryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface PostgresClientOptions {
  connectionString?: string;
  max?: number;
  ssl?: boolean;
}

export class PostgresClient {
  private readonly pool: Pool;

  constructor(options: PostgresClientOptions = {}) {
    const connectionString = options.connectionString ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for PostgresClient");
    }

    this.pool = new Pool({
      connectionString,
      max: options.max ?? 10,
      ssl: options.ssl ?? process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
    });
  }

  public query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  public async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
