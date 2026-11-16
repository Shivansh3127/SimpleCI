import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import session from 'express-session';
import passport from 'passport';
import { RedisStore } from 'connect-redis';
import { WebSocketServer } from 'ws';
import { createWebhookRouter } from './routes/webhook.js';
import createRunsRouter from './routes/runs.js';
import authRouter from './routes/auth.js';
import reposRouter from './routes/repos.js';
import prisma, { connectWithRetry } from './db/prisma.js';
import { configurePassport } from './lib/auth.js';
import { redisConnection } from './queue/redisConnection.js';

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

// ─── Session ──────────────────────────────────────────────────
// Sessions stored in Redis (not in-memory) so they survive restarts
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
  console.log('[WS] Client connected');
  ws.on('close', () => console.log('[WS] Client disconnected'));
});

// ─── Routes ───────────────────────────────────────────────────
app.use('/auth',    authRouter);
app.use('/webhook', createWebhookRouter(wss));
app.use('/runs',    createRunsRouter(wss));
app.use('/repos',   reposRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '3.0.0' });
});

// ─── Startup: recover stuck runs ──────────────────────────────
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
      console.log(`   Login:    http://localhost:${PORT}/auth/github`);
      console.log(`   Runs API: http://localhost:${PORT}/runs`);
      console.log(`   Repos:    http://localhost:${PORT}/repos`);
      console.log(`\n   ℹ️  Start the worker separately: npm run dev:worker\n`);
    });
  })
  .catch((err) => {
    console.error('[Startup] Failed to connect to PostgreSQL after retries:', err);
    process.exit(1);
  });
