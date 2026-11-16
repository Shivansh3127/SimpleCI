/**
 * logger.ts — Structured logging with Pino
 *
 * Why Pino over console.log?
 * - JSON output: machine-parseable (Loki, Datadog, Cloud Logging can ingest it)
 * - Blazingly fast: async logging, minimal overhead in hot paths
 * - Log levels (trace/debug/info/warn/error/fatal)
 * - Automatic timestamp, pid, hostname on every line
 *
 * In development (NODE_ENV !== 'production') we use pino-pretty for
 * human-readable colourised output. In production we emit raw NDJSON.
 */
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
    // Redact sensitive fields that should never appear in logs
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.accessToken', '*.secret'],
      censor: '[REDACTED]',
    },
    base: {
      pid:  process.pid,
      name: 'simpleci',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize:   true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
        },
      })
    : undefined,
);

/**
 * Child logger factory — attach extra context to a logger for a specific
 * scope (e.g. a single pipeline run, a specific route handler).
 *
 * Usage:
 *   const log = childLogger({ runId: 'abc-123', repo: 'owner/repo' });
 *   log.info('Starting pipeline');  // → { ..., runId: 'abc-123', repo: '...' }
 */
export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}

export default logger;
