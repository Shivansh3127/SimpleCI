import { Queue, QueueEvents } from 'bullmq';
import { redisConnection } from './redisConnection.js';

/**
 * The shape of data stored in each BullMQ job.
 * This is serialized to Redis and read back by the worker.
 */
export interface PipelineJobData {
  runId: string;
  repoUrl: string;
  steps: Array<{ name: string; run: string }>;
}

/**
 * The single pipeline queue.
 * - Producer (webhook.ts) adds jobs here.
 * - Consumer (worker.ts) picks them up.
 *
 * BullMQ stores jobs in Redis so they survive server restarts.
 * If the worker crashes mid-job, BullMQ automatically retries it.
 */
export const pipelineQueue = new Queue<PipelineJobData>('pipelines', {
  connection: redisConnection,
  defaultJobOptions: {
    // Retry up to 3 times on failure, with exponential backoff:
    // attempt 1 → wait 5s → attempt 2 → wait 10s → attempt 3 → wait 20s
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5_000,
    },
    // Keep last 100 completed + 200 failed jobs in Redis for visibility
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
});

/**
 * QueueEvents lets us listen to job lifecycle events from outside the worker.
 * Used by the API server to react to job completion without running the worker itself.
 */
export const pipelineQueueEvents = new QueueEvents('pipelines', {
  connection: redisConnection,
});

console.log('[Queue] Pipeline queue initialized ✓');
