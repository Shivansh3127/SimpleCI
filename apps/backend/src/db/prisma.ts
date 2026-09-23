import { PrismaClient } from '@prisma/client';

// Singleton pattern — only one Prisma client instance ever exists.
// connection_limit=5   : keep a small pool (default 10 is overkill for local dev)
// connect_timeout=10   : fail fast if postgres is unreachable
// socket_timeout=60    : allow long-running queries (docker pull can take >30s)
const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL +
    (process.env.DATABASE_URL?.includes('?') ? '&' : '?') +
    'connection_limit=5&connect_timeout=10&socket_timeout=60',
});

// Reconnect helper — called by server.ts on startup and can be reused
// after a P1017 "server closed connection" error.
export async function connectWithRetry(retries = 5, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await prisma.$connect();
      console.log('[DB] Connected to PostgreSQL ✓');
      return;
    } catch (err) {
      console.error(`[DB] Connection attempt ${attempt}/${retries} failed:`, err);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export default prisma;
