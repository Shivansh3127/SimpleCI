import Docker from 'dockerode';
import { WebSocketServer } from 'ws';
import prisma from '../db/prisma.js';
import { PipelineStep } from './pipelineParser.js';

// Connect to the local Docker daemon (Docker Desktop on Windows)
const docker = new Docker();

/**
 * Broadcasts a log line to all WebSocket clients watching a specific runId.
 */
function broadcastLog(wss: WebSocketServer, runId: string, line: string) {
  const message = JSON.stringify({ runId, line });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

/**
 * Runs the full CI pipeline for a given repository inside a Docker container.
 *
 * Level 2 changes:
 * - Marks run RUNNING when container actually starts (was set at webhook time before)
 * - Saves containerId to DB so the cancel endpoint can kill the container
 * - Handles CANCELLED status — exits cleanly if run is cancelled mid-flight
 *
 * @param runId    - The UUID of this pipeline run (from DB)
 * @param repoUrl  - The GitHub repo URL to clone
 * @param steps    - Pipeline steps to run (from .simpleci.yaml)
 * @param wss      - WebSocket server to broadcast logs to
 */
export async function runPipeline(
  runId: string,
  repoUrl: string,
  steps: PipelineStep[],
  wss: WebSocketServer
): Promise<void> {
  const stepCommands = steps.map((s) => s.run).join(' && ');
  const fullCommand = `apk add --no-cache git && git clone ${repoUrl} /workspace && ${stepCommands}`;

  // Helper: sanitise a raw Docker log line before writing to PostgreSQL.
  const sanitize = (raw: string): string =>
    raw
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // strip ANSI codes
      .replace(/\x00/g, '')                    // strip null bytes
      .trimEnd();

  // Helper: save a log line to DB + broadcast over WebSocket.
  // Never throws — a bad log line must not abort the whole pipeline.
  const emitLog = async (line: string) => {
    const clean = sanitize(line);
    try {
      await prisma.log.create({ data: { runId, line: clean } });
    } catch (dbErr) {
      console.error('[emitLog] DB write failed:', dbErr);
    }
    broadcastLog(wss, runId, clean);
  };

  // Helper: check if this run was cancelled while we were working
  const isCancelled = async (): Promise<boolean> => {
    const run = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
    return run?.status === 'CANCELLED';
  };

  try {
    // Mark run as RUNNING now that the worker has picked it up
    await prisma.run.update({
      where: { id: runId },
      data: { status: 'RUNNING' },
    });

    await emitLog(`[SimpleCI] Starting pipeline for run: ${runId}`);
    await emitLog(`[SimpleCI] Repo: ${repoUrl}`);
    await emitLog(`[SimpleCI] Steps: ${steps.map((s) => s.name).join(' → ')}`);
    await emitLog('');

    // ── Auto-pull the image if it doesn't exist locally ──────────
    const IMAGE = 'node:20-alpine';
    await emitLog(`[SimpleCI] Checking image: ${IMAGE}`);
    try {
      await docker.getImage(IMAGE).inspect();
      await emitLog(`[SimpleCI] Image already cached locally ✓`);
    } catch {
      await emitLog(`[SimpleCI] Image not found — pulling ${IMAGE} (this may take a minute)...`);
      await new Promise<void>((resolve, reject) => {
        docker.pull(IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, (pullErr: Error | null) => {
            if (pullErr) return reject(pullErr);
            resolve();
          });
        });
      });
      await emitLog(`[SimpleCI] Image pulled successfully ✓`);
    }

    // Check for cancellation before creating the container
    if (await isCancelled()) {
      await emitLog('[SimpleCI] 🚫 Run was cancelled before container started');
      return;
    }

    // Create a Docker container
    const container = await docker.createContainer({
      Image: IMAGE,
      Cmd: ['sh', '-c', fullCommand],
      WorkingDir: '/workspace',
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        AutoRemove: true,
        Memory: 512 * 1024 * 1024,  // 512 MB
        NanoCpus: 500_000_000,       // 0.5 CPU
      },
    });

    // ── Save containerId so DELETE /runs/:id can kill it ─────────
    await prisma.run.update({
      where: { id: runId },
      data: { containerId: container.id },
    });

    // Start the container
    await container.start();
    await emitLog('[SimpleCI] Container started. Running pipeline...\n');

    // Attach to container output stream
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    });

    let buffer = '';

    await new Promise<void>((resolve, reject) => {
      stream.on('data', async (chunk: Buffer) => {
        const text = chunk.slice(8).toString('utf-8');
        buffer += text;

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.trim()) await emitLog(line);
        }
      });

      stream.on('end', resolve);
      stream.on('error', reject);
    });

    // Flush remaining buffer
    if (buffer.trim()) await emitLog(buffer);

    // Check if cancelled after stream ends (container may have been killed)
    if (await isCancelled()) {
      await emitLog('[SimpleCI] 🚫 Pipeline was cancelled');
      return;
    }

    // Get exit code
    const result = await container.wait();
    const exitCode: number = result.StatusCode;

    if (exitCode === 0) {
      await emitLog('\n[SimpleCI] ✅ Pipeline PASSED');
      await prisma.run.update({
        where: { id: runId },
        data: { status: 'SUCCESS', finishedAt: new Date() },
      });
    } else {
      await emitLog(`\n[SimpleCI] ❌ Pipeline FAILED (exit code: ${exitCode})`);
      await prisma.run.update({
        where: { id: runId },
        data: { status: 'FAILED', finishedAt: new Date() },
      });
    }
  } catch (err) {
    // If the run was cancelled, the container.wait() throws — handle gracefully
    if (await isCancelled()) {
      await emitLog('[SimpleCI] 🚫 Pipeline was cancelled');
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    await emitLog(`\n[SimpleCI] 💥 Error: ${message}`);
    await prisma.run.update({
      where: { id: runId },
      data: { status: 'FAILED', finishedAt: new Date() },
    });
  }
}
