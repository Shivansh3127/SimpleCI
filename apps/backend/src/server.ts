import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { createWebhookRouter } from './routes/webhook.js';
import createRunsRouter from './routes/runs.js';
import prisma from './db/prisma.js';

const app = express();
const PORT = process.env.PORT ?? 3000;

// ─── Middleware ───────────────────────────────────────────────
// CORS — allows the React frontend (localhost:5173) to talk to this server
app.use(cors({ origin: '*' }));

// Raw body parser for the webhook route — we need the raw buffer to verify HMAC
app.use('/webhook', express.raw({ type: 'application/json' }));

// JSON parser for all other routes
app.use(express.json());

// ─── HTTP Server ──────────────────────────────────────────────
// We create a raw HTTP server so we can attach WebSockets to it
const server = http.createServer(app);

// ─── WebSocket Server ─────────────────────────────────────────
// Clients connect here to receive live log streaming for a run
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  ws.on('close', () => console.log('[WS] Client disconnected'));
});

// ─── Routes ───────────────────────────────────────────────────
app.use('/webhook', createWebhookRouter(wss));
app.use('/runs', createRunsRouter(wss));

// Health check — useful to verify the server is running
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Startup: recover stuck runs ──────────────────────────────
// If the server crashed while a pipeline was running, those runs are stuck
// in RUNNING status forever. Mark them FAILED on startup so the dashboard
// doesn't show phantom "Running" runs that will never complete.
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
recoverStuckRuns().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🚀 SimpleCI backend running at http://localhost:${PORT}`);
    console.log(`   Health:   http://localhost:${PORT}/health`);
    console.log(`   Runs API: http://localhost:${PORT}/runs`);
    console.log(`   Webhook:  POST http://localhost:${PORT}/webhook/github\n`);
  });
});
