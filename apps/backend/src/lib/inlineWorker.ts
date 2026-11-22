/**
 * inlineWorker.ts
 *
 * When INLINE_WORKER=true (e.g. on Render free tier where Background Workers
 * cost money), this module starts the BullMQ pipeline worker IN THE SAME
 * process as the HTTP server, sharing its WebSocket server for log streaming.
 *
 * For local dev / production with separate worker, leave INLINE_WORKER unset
 * and run `npm run dev:worker` separately.
 */
import { Worker, Job } from 'bullmq';
import { WebSocketServer } from 'ws';
import { redisConnection } from '../queue/redisConnection.js';
import { runPipeline } from '../services/dockerRunner.js';
import type { PipelineJobData } from '../queue/pipelineQueue.js';
import logger from './logger.js';
import {
  activeContainersGauge,
  pipelineDurationHistogram,
  pipelineTotalCounter,
} from './metrics.js';

export function startInlineWorker(wss: WebSocketServer): void {
  const CONCURRENCY = Number(process.env.PIPELINE_CONCURRENCY ?? 2);

  const worker = new Worker<PipelineJobData>(
    'pipelines',
    async (job: Job<PipelineJobData>) => {
      const {
        runId, repoUrl, steps, githubToken, repoOwner, repoSlug, commitSha,
        dockerImage, artifactPaths, matrixLabel, secrets, notifyUrl, repoName, branch,
        deployConfig,
      } = job.data;

      const log = logger.child({ jobId: job.id, runId });
      log.info({ repoUrl }, 'Inline worker: starting pipeline job');

      await job.updateProgress(0);
      activeContainersGauge.inc();
      const startMs = Date.now();

      try {
        await runPipeline(
          runId, repoUrl, steps, wss,
          githubToken, repoOwner, repoSlug, commitSha,
          dockerImage, artifactPaths, matrixLabel, secrets,
          notifyUrl, repoName, branch, deployConfig,
        );
        pipelineTotalCounter.inc({ status: 'success' });
      } catch (err) {
        log.error({ err }, 'Inline worker: pipeline job threw');
        pipelineTotalCounter.inc({ status: 'failed' });
        throw err;
      } finally {
        activeContainersGauge.dec();
        pipelineDurationHistogram.observe((Date.now() - startMs) / 1000);
        await job.updateProgress(100);
      }
    },
    {
      connection: redisConnection,
      concurrency: CONCURRENCY,
    },
  );

  worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Inline worker: job completed ✅'));
  worker.on('failed',    (job, err) => logger.error({ jobId: job?.id, err }, 'Inline worker: job failed ❌'));
  worker.on('stalled',   (jobId) => logger.warn({ jobId }, 'Inline worker: job stalled'));

  logger.info(`⚙️  Inline worker started (concurrency: ${CONCURRENCY})`);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Inline worker: shutting down...');
    await worker.close();
  });
}
