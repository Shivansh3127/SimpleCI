import { Queue, QueueEvents } from 'bullmq';
import { redisConnection } from './redisConnection.js';

/**
 * The shape of data stored in each BullMQ job.
 * This is serialized to Redis and read back by the worker.
 */
export interface PipelineJobData {
  runId:        string;
  repoUrl:      string;
  steps:        Array<{ name: string; run: string }>;
  // Level 3: GitHub Commit Status API
  githubToken:  string | null;
  repoOwner:    string | null;
  repoSlug:     string | null;
  commitSha:    string | null;
  // Level 5.1: Docker image
  dockerImage:  string;
  // Level 5.2: artifact paths to collect after run
  artifactPaths: string[];
  // Level 5.3: matrix label e.g. "node=20"
  matrixLabel:  string | null;
  // Level 5.4: decrypted secrets to inject as env vars
  secrets:      Record<string, string>;
  // Level 5.6: notification webhook URL
  notifyUrl:    string | null;
  // For notifications
  repoName:     string;
  branch:       string;
}

export const pipelineQueue = new Queue<PipelineJobData>('pipelines', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type:  'exponential',
      delay: 5_000,
    },
    removeOnComplete: { count: 100 },
    removeOnFail:     { count: 200 },
  },
});

export const pipelineQueueEvents = new QueueEvents('pipelines', {
  connection: redisConnection,
});

console.log('[Queue] Pipeline queue initialized ✓');
