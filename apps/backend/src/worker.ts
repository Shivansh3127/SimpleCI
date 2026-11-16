/**
 * worker.ts — SimpleCI BullMQ Pipeline Worker
 *
 * This runs as a SEPARATE process from server.ts.
 * It picks up jobs from the BullMQ 'pipelines' queue in Redis
 * and executes them (clones repo, runs Docker container).
 *
 * Why separate process?
 * - If a heavy Docker pipeline uses 100% CPU, it doesn't
 *   slow down the HTTP server handling new webhook/API requests.
 * - Both processes talk to the same Redis and PostgreSQL.
 *
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

// ── Minimal WebSocket server for the worker ────────────────────
// The worker needs to broadcast logs over WebSocket.
// It runs its OWN WS server on a different port (3001) so it
// doesn't conflict with the main HTTP server on 3000.
const WS_PORT = Number(process.env.WORKER_WS_PORT ?? 3001);
const wsServer = http.createServer();
const wss = new WebSocketServer({ server: wsServer });

wss.on('connection', (ws) => {
  console.log('[Worker WS] Client connected');
  ws.on('close', () => console.log('[Worker WS] Client disconnected'));
});

// ── BullMQ Worker ──────────────────────────────────────────────
// concurrency: 3 means up to 3 Docker containers can run at once.
// Increase or decrease based on your machine's resources.
const CONCURRENCY = Number(process.env.PIPELINE_CONCURRENCY ?? 3);

const worker = new Worker<PipelineJobData>(
  'pipelines',
  async (job: Job<PipelineJobData>) => {
    const { runId, repoUrl, steps } = job.data;

    console.log(`[Worker] Starting job ${job.id} for run ${runId}`);

    // Update progress so BullMQ dashboard can show it
    await job.updateProgress(0);

    await runPipeline(runId, repoUrl, steps, wss);

    await job.updateProgress(100);
    console.log(`[Worker] Completed job ${job.id} for run ${runId}`);
  },
  {
    connection: redisConnection,
    concurrency: CONCURRENCY,
  }
);

// ── Worker lifecycle events ────────────────────────────────────
worker.on('completed', (job) => {
  console.log(`[Worker] ✅ Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] ❌ Job ${job?.id} failed:`, err.message);
});

worker.on('stalled', (jobId) => {
  console.warn(`[Worker] ⚠️  Job ${jobId} stalled (worker crashed mid-run?)`);
});

// ── Startup ────────────────────────────────────────────────────
connectWithRetry()
  .then(() => {
    wsServer.listen(WS_PORT, () => {
      console.log(`\n⚙️  SimpleCI Worker running`);
      console.log(`   Concurrency: ${CONCURRENCY} parallel pipelines`);
      console.log(`   Worker WS:   ws://localhost:${WS_PORT}`);
      console.log(`   Redis:       ${process.env.REDIS_URL ?? 'redis://localhost:6379'}\n`);
    });
  })
  .catch((err) => {
    console.error('[Worker] Failed to connect to DB:', err);
    process.exit(1);
  });

// ── Graceful shutdown ──────────────────────────────────────────
// When process is killed, let the current job finish before exiting.
async function shutdown() {
  console.log('\n[Worker] Shutting down gracefully...');
  await worker.close();
  wsServer.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
