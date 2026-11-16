/**
 * httpMetrics.ts — Express middleware that records per-request Prometheus metrics.
 *
 * Records:
 * - simpleci_http_requests_total  (counter, labelled by method/route/status)
 * - simpleci_http_duration_ms     (histogram, labelled by method/route)
 *
 * Route normalisation collapses dynamic segments so that
 * /runs/abc-123 and /runs/def-456 both show as /runs/:id in Grafana.
 */
import { Request, Response, NextFunction } from 'express';
import { httpRequestsCounter, httpDurationHistogram } from '../lib/metrics.js';

/** Collapse UUID/numeric path segments into named placeholders */
function normaliseRoute(url: string): string {
  return url
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id') // UUID
    .replace(/\/\d+/g, '/:id')   // numeric IDs
    .split('?')[0];               // drop query string
}

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const method = req.method;

  res.on('finish', () => {
    const route      = normaliseRoute(req.path);
    const statusCode = String(res.statusCode);
    const durationMs = Date.now() - start;

    httpRequestsCounter.inc({ method, route, status_code: statusCode });
    httpDurationHistogram.observe({ method, route }, durationMs);
  });

  next();
}
