import type { CollectionJob, CollectionJobStatus } from "../entities/collection-job";

export interface CollectionJobFailurePolicy {
  nowIso: string;
  maxRetries: number;
  retryDelayMs: number;
}

export interface CollectionJobRepository {
  create(job: CollectionJob): Promise<CollectionJob>;
  updateStatus(jobId: string, status: CollectionJobStatus, errorMessage?: string): Promise<void>;
  fail(jobId: string, errorMessage: string, policy: CollectionJobFailurePolicy): Promise<CollectionJob>;
  saveCursor(jobId: string, cursor: string): Promise<void>;
  findRunnableJobs(nowIso: string, limit: number): Promise<CollectionJob[]>;
}
