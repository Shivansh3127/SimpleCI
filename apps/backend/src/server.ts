// ─── OpenTelemetry: MUST be first (instruments modules before they load) ──────
import { initTracing } from './lib/tracing.js';
initTracing('simpleci-server');

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import session from 'express-session';
import passport from 'passport';
import connectRedis from 'connect-redis';
import { WebSocketServer } from 'ws';
import { createWebhookRouter } from './routes/webhook.js';
import createRunsRouter from './routes/runs.js';
import authRouter from './routes/auth.js';
import reposRouter from './routes/repos.js';
import secretsRouter from './routes/secrets.js';
import membersRouter from './routes/members.js';
import artifactsRouter from './routes/artifacts.js';
import prisma, { connectWithRetry } from './db/prisma.js';
import { configurePassport } from './lib/auth.js';
import { redisConnection } from './queue/redisConnection.js';
import { registry, queueDepthGauge } from './lib/metrics.js';
import { httpMetricsMiddleware } from './middleware/httpMetrics.js';
import { pipelineQueue } from './queue/pipelineQueue.js';
import logger from './lib/logger.js';

const app = express();
const PORT = process.env.PORT ?? 3000;
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

// ─── Middleware ───────────────────────────────────────────────
// CORS — allow the React frontend with credentials (cookies)
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,  // required for session cookies
}));

// Raw body parser for webhook (must come before json parser)
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// Record HTTP metrics for every request
app.use(httpMetricsMiddleware);

// ─── Session ──────────────────────────────────────────────────
// Sessions stored in Redis (not in-memory) so they survive restarts
// connect-redis v6 supports ioredis natively (v7+ dropped support)
const RedisStore = connectRedis(session);
app.use(session({
  store: new RedisStore({ client: redisConnection as any }),
  secret: process.env.SESSION_SECRET ?? 'simpleci-dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  name: 'simpleci.sid',
  cookie: {
    httpOnly: true,              // JS cannot read the cookie
    secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// ─── Passport (Auth) ──────────────────────────────────────────
configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// ─── HTTP + WebSocket Server ──────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  logger.debug('WebSocket client connected');
  ws.on('close', () => logger.debug('WebSocket client disconnected'));
});

// ─── Routes ───────────────────────────────────────────────────
app.use('/auth',    authRouter);
app.use('/webhook', createWebhookRouter(wss));
app.use('/runs',    createRunsRouter(wss));
app.use('/repos',   reposRouter);
// Level 5: nested resource routes
app.use('/repos/:repoId/secrets', secretsRouter);
app.use('/repos/:repoId/members', membersRouter);
app.use('/runs/:runId/artifacts', artifactsRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '4.0.0' });
});

// ─── Prometheus metrics endpoint ──────────────────────────────
// Scraped by Prometheus every 15s. Visualised in Grafana.
app.get('/metrics', async (_req, res) => {
  try {
    // Update queue depth gauge before every scrape
    const waiting = await pipelineQueue.getWaitingCount();
    const active  = await pipelineQueue.getActiveCount();
    queueDepthGauge.set(waiting + active);

    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (err) {
    logger.error({ err }, 'Failed to collect metrics');
    res.status(500).end('Error collecting metrics');
  }
});

// ─── Startup: recover stuck runs ──────────────────────────────
async function recoverStuckRuns() {
  const stuck = await prisma.run.updateMany({
    where: { status: 'RUNNING' },
    data: { status: 'FAILED', finishedAt: new Date() },
  });
  if (stuck.count > 0) {
    logger.warn(`Recovered ${stuck.count} stuck RUNNING run(s) → FAILED`);
  }
}

// ─── Start ────────────────────────────────────────────────────
connectWithRetry()
  .then(() => recoverStuckRuns())
  .then(() => {
    server.listen(PORT, () => {
      logger.info(`🚀 SimpleCI backend running at http://localhost:${PORT}`);
      logger.info(`   Health:   http://localhost:${PORT}/health`);
      logger.info(`   Metrics:  http://localhost:${PORT}/metrics`);
      logger.info(`   Login:    http://localhost:${PORT}/auth/github`);
      logger.info(`   Runs API: http://localhost:${PORT}/runs`);
      logger.info(`   Repos:    http://localhost:${PORT}/repos`);
      logger.info(`   Start the worker separately: npm run dev:worker`);
      logger.info(`   MinIO:    http://localhost:9001`);
    });
  })
  .catch((err) => {
    logger.error({ err }, 'Failed to connect to PostgreSQL after retries');
    process.exit(1);
  });
