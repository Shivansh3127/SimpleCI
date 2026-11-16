import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { createWebhookRouter } from './routes/webhook.js';
import createRunsRouter from './routes/runs.js';
import prisma, { connectWithRetry } from './db/prisma.js';

const app = express();
const PORT = process.env.PORT ?? 3000;

// ─── Middleware ───────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ─── HTTP + WebSocket Server ──────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  ws.on('close', () => console.log('[WS] Client disconnected'));
});

// ─── Routes ───────────────────────────────────────────────────
app.use('/webhook', createWebhookRouter(wss));
app.use('/runs', createRunsRouter(wss));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    queue: 'bullmq',
  });
});

// ─── Startup: recover stuck runs ──────────────────────────────
// If the server crashed while runs were RUNNING, mark them FAILED.
// QUEUED runs can stay QUEUED — the worker will pick them up when it restarts.
async function recoverStuckRuns() {
  const stuck = await prisma.run.updateMany({
    where: { status: 'RUNNING' },
    data: { status: 'FAILED', finishedAt: new Date() },
  });
  if (stuck.count > 0) {
    console.warn(`[Startup] ⚠️  Recovered ${stuck.count} stuck RUNNING run(s) → FAILED`);
  }
}

// ─── Start ────────────────────────────────────────────────────
connectWithRetry()
  .then(() => recoverStuckRuns())
  .then(() => {
    server.listen(PORT, () => {
      console.log(`\n🚀 SimpleCI backend running at http://localhost:${PORT}`);
      console.log(`   Health:   http://localhost:${PORT}/health`);
      console.log(`   Runs API: http://localhost:${PORT}/runs`);
      console.log(`   Webhook:  POST http://localhost:${PORT}/webhook/github`);
      console.log(`\n   ℹ️  Start the worker separately: npm run dev:worker\n`);
    });
  })
  .catch((err) => {
    console.error('[Startup] Failed to connect to PostgreSQL after retries:', err);
    process.exit(1);
  });
