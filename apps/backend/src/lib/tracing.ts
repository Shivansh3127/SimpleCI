/**
 * tracing.ts — OpenTelemetry distributed tracing
 *
 * MUST be imported before anything else in server.ts / worker.ts
 * so that auto-instrumentation patches Node.js modules early.
 *
 * What it does:
 * - Wraps every HTTP request in a trace span (via @opentelemetry/auto-instrumentations-node)
 * - Wraps Prisma DB calls, fetch, Redis calls, etc. automatically
 * - Exports spans to a Jaeger/OTLP collector over HTTP
 *
 * View traces at: http://localhost:16686 (Jaeger UI)
 *
 * To disable tracing: set OTEL_ENABLED=false in .env
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export function initTracing(serviceName: 'simpleci-server' | 'simpleci-worker') {
  if (process.env.OTEL_ENABLED === 'false') {
    return;
  }

  const collectorUrl =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces';

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]:    serviceName,
      [ATTR_SERVICE_VERSION]: '4.0.0',
      environment:            process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: new OTLPTraceExporter({ url: collectorUrl }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Don't trace noisy file-system calls
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log(`[Tracing] OpenTelemetry started → ${collectorUrl}`);

  // Flush and shutdown on process exit
  process.on('SIGTERM', () => sdk.shutdown());
  process.on('SIGINT',  () => sdk.shutdown());
}
