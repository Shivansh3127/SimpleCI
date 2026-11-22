// ─── OpenTelemetry: MUST be first ────────────────────────────
import { initTracing } from './lib/tracing.js';
initTracing('simpleci-worker');

/**
 * worker.ts — SimpleCI BullMQ Pipeline Worker
 *
 * Level 4 additions:
 * - Pino structured logging (replaces console.log)
 * - Prometheus metrics: active containers gauge, pipeline duration histogram
 * - Build cache: named Docker volume mounted at /cache so npm/pip
 *   packages are reused across runs (see dockerRunner.ts for the mount)
 *
 * This runs as a SEPARATE process from server.ts.
 * Start with: npm run dev:worker
 */
import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { WebSocketServer } from 'ws';
import http from 'http';
import { redisConnection } from './queue/redisConnection.js';
import { runPipeline } from './services/dockerRunner.js';
import { connectWithRetry } from './db/prisma.js';
import type { PipelineJobData } from './queue/pipelineQueue.js';
import logger from './lib/logger.js';
import {
  activeContainersGauge,
  pipelineDurationHistogram,
  pipelineTotalCounter,
} from './lib/metrics.js';

// ── Minimal WebSocket server for the worker ────────────────────
const WS_PORT    = Number(process.env.WORKER_WS_PORT ?? 3001);
const wsServer   = http.createServer();
const wss        = new WebSocketServer({ server: wsServer });

wss.on('connection', () => logger.debug('Worker WS client connected'));

// ── BullMQ Worker ──────────────────────────────────────────────
const CONCURRENCY = Number(process.env.PIPELINE_CONCURRENCY ?? 3);

const worker = new Worker<PipelineJobData>(
  'pipelines',
  async (job: Job<PipelineJobData>) => {
    const { runId, repoUrl, steps, githubToken, repoOwner, repoSlug, commitSha,
            dockerImage, artifactPaths, matrixLabel, secrets, notifyUrl, repoName, branch,
            deployConfig } = job.data;
    const log = logger.child({ jobId: job.id, runId });

    log.info({ repoUrl }, 'Starting pipeline job');
    await job.updateProgress(0);

    const startMs = Date.now();
    activeContainersGauge.inc();

    try {
      await runPipeline(
        runId, repoUrl, steps, wss,
        githubToken, repoOwner, repoSlug, commitSha,
        // Level 5 params
        dockerImage, artifactPaths, matrixLabel, secrets, notifyUrl, repoName, branch,
        deployConfig,
      );

      const durationMs = Date.now() - startMs;
      pipelineDurationHistogram.observe({ status: 'success', repo: repoUrl }, durationMs);
      pipelineTotalCounter.inc({ status: 'success' });

      await job.updateProgress(100);
      log.info({ durationMs }, 'Pipeline job completed');
    } catch (err) {
      const durationMs = Date.now() - startMs;
      pipelineDurationHistogram.observe({ status: 'failed', repo: repoUrl }, durationMs);
      pipelineTotalCounter.inc({ status: 'failed' });
      log.error({ err, durationMs }, 'Pipeline job failed');
      throw err; // re-throw so BullMQ marks job as failed
    } finally {
      activeContainersGauge.dec();
    }
  },
  {
    connection: redisConnection,
    concurrency: CONCURRENCY,
  }
);

// ── Worker lifecycle events ────────────────────────────────────
worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Job completed ✅'));
worker.on('failed',    (job, err) => logger.error({ jobId: job?.id, err }, 'Job failed ❌'));
worker.on('stalled',   (jobId) => logger.warn({ jobId }, 'Job stalled — may retry'));

// ── Startup ────────────────────────────────────────────────────
connectWithRetry()
  .then(() => {
    wsServer.listen(WS_PORT, () => {
      logger.info(`⚙️  SimpleCI Worker running`);
      logger.info(`   Concurrency: ${CONCURRENCY} parallel pipelines`);
      logger.info(`   Worker WS:   ws://localhost:${WS_PORT}`);
      logger.info(`   Redis:       ${process.env.REDIS_URL ?? 'redis://localhost:6379'}`);
    });
  })
  .catch((err) => {
    logger.error({ err }, 'Worker failed to connect to DB');
    process.exit(1);
  });

// ── Graceful shutdown ──────────────────────────────────────────
async function shutdown() {
  logger.info('Shutting down worker gracefully...');
  await worker.close();
  wsServer.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
