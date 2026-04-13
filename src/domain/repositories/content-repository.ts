import type { Content } from "../entities/content";

export interface ContentRepository {
  upsertMany(contents: Content[]): Promise<void>;
  findRecentByTarget(targetId: string, limit: number): Promise<Content[]>;
}

