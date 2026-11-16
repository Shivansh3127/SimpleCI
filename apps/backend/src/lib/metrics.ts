/**
 * metrics.ts — Prometheus metrics for SimpleCI
 *
 * Exposes a /metrics endpoint that Prometheus scrapes every 15s.
 * Grafana then visualises the data in dashboards.
 *
 * Metrics exposed:
 * ┌─────────────────────────────────┬───────────┬─────────────────────────────────┐
 * │ Metric name                     │ Type      │ What it measures                │
 * ├─────────────────────────────────┼───────────┼─────────────────────────────────┤
 * │ simpleci_pipeline_duration_ms   │ Histogram │ How long each pipeline takes    │
 * │ simpleci_pipeline_total         │ Counter   │ Total pipelines (by status)     │
 * │ simpleci_active_containers      │ Gauge     │ Containers running right now     │
 * │ simpleci_queue_depth            │ Gauge     │ Jobs waiting in BullMQ queue    │
 * │ simpleci_http_requests_total    │ Counter   │ HTTP requests (by route/status) │
 * │ simpleci_http_duration_ms       │ Histogram │ HTTP response time              │
 * └─────────────────────────────────┴───────────┴─────────────────────────────────┘
 *
 * Default Node.js metrics (event loop lag, GC, heap, etc.) are
 * collected automatically by collectDefaultMetrics().
 */
import { Registry, collectDefaultMetrics, Histogram, Counter, Gauge } from '@prometheus-io/client';

// One registry for all SimpleCI metrics
export const registry = new Registry();

// ── Collect built-in Node.js metrics ──────────────────────────
// Adds ~20 metrics: heap, GC pause, event loop lag, file handles, etc.
collectDefaultMetrics({ register: registry, prefix: 'simpleci_node_' });

// ── Pipeline duration ──────────────────────────────────────────
export const pipelineDurationHistogram = new Histogram({
  name: 'simpleci_pipeline_duration_ms',
  help: 'End-to-end pipeline execution time in milliseconds',
  labelNames: ['status', 'repo'],
  buckets: [1_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000],
  registers: [registry],
});

// ── Pipeline total (counter) ───────────────────────────────────
export const pipelineTotalCounter = new Counter({
  name: 'simpleci_pipeline_total',
  help: 'Total number of pipeline runs by final status',
  labelNames: ['status'],
  registers: [registry],
});

// ── Active Docker containers ───────────────────────────────────
export const activeContainersGauge = new Gauge({
  name: 'simpleci_active_containers',
  help: 'Number of Docker containers currently running a pipeline',
  registers: [registry],
});

// ── Queue depth ────────────────────────────────────────────────
export const queueDepthGauge = new Gauge({
  name: 'simpleci_queue_depth',
  help: 'Number of pipeline jobs waiting in the BullMQ queue',
  registers: [registry],
});

// ── HTTP request counter ───────────────────────────────────────
export const httpRequestsCounter = new Counter({
  name: 'simpleci_http_requests_total',
  help: 'Total HTTP requests handled',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

// ── HTTP response time ─────────────────────────────────────────
export const httpDurationHistogram = new Histogram({
  name: 'simpleci_http_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: ['method', 'route'],
  buckets: [10, 50, 100, 250, 500, 1_000, 5_000],
  registers: [registry],
});
