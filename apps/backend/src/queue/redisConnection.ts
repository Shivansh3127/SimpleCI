import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/**
 * Shared Redis connection used by BullMQ queue and worker.
 *
 * BullMQ requires a dedicated connection — do NOT share this with
 * other Redis operations (e.g. session store), as BullMQ calls
 * BLPOP which blocks the connection.
 *
 * maxRetriesPerRequest: null is REQUIRED by BullMQ — it disables
 * the default ioredis behaviour of giving up after N retries.
 * BullMQ manages its own retry logic.
 */
export const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

redisConnection.on('connect', () => console.log('[Redis] Connected ✓'));
redisConnection.on('error', (err) => console.error('[Redis] Error:', err.message));
