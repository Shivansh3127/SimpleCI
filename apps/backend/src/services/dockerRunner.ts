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
    // Only send to clients that are open
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

/**
 * Runs the full CI pipeline for a given repository inside a Docker container.
 *
 * What happens:
 * 1. Pulls a Node.js Docker image
 * 2. Creates a container
 * 3. Clones the repo + runs each step sequentially
 * 4. Streams every line of output to WebSocket clients + saves to DB
 * 5. Updates run status to SUCCESS or FAILED when done
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
  // Build one big shell script: install git (alpine has none by default),
  // clone the repo, then run each pipeline step
  const stepCommands = steps.map((s) => s.run).join(' && ');
  const fullCommand = `apk add --no-cache git && git clone ${repoUrl} /workspace && cd /workspace && ${stepCommands}`;

  // Helper: save a log line to DB + broadcast over WebSocket
  const emitLog = async (line: string) => {
    await prisma.log.create({ data: { runId, line } });
    broadcastLog(wss, runId, line);
  };

  try {
    await emitLog(`[SimpleCI] Starting pipeline for run: ${runId}`);
    await emitLog(`[SimpleCI] Repo: ${repoUrl}`);
    await emitLog(`[SimpleCI] Steps: ${steps.map((s) => s.name).join(' → ')}`);
    await emitLog('');

    // Create a Docker container using the official Node.js image
    const container = await docker.createContainer({
      Image: 'node:20-alpine',        // lightweight Node.js image
      Cmd: ['sh', '-c', fullCommand], // run our shell script
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        AutoRemove: true,             // auto-delete container when done
        Memory: 512 * 1024 * 1024,   // 512 MB memory limit
        NanoCpus: 500_000_000,        // 0.5 CPU limit
      },
    });

    // Start the container
    await container.start();
    await emitLog('[SimpleCI] Container started. Running pipeline...\n');

    // Attach to container output stream to read logs in real time
    const stream = await container.logs({
      follow: true,    // keep streaming until container exits
      stdout: true,
      stderr: true,
    });

    // Buffer to accumulate partial log chunks into complete lines
    let buffer = '';

    await new Promise<void>((resolve, reject) => {
      stream.on('data', async (chunk: Buffer) => {
        // Docker log chunks have a header (first 8 bytes). Strip it.
        const text = chunk.slice(8).toString('utf-8');
        buffer += text;

        // Split on newlines and emit each complete line
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // last partial line stays in buffer

        for (const line of lines) {
          if (line.trim()) await emitLog(line);
        }
      });

      stream.on('end', resolve);
      stream.on('error', reject);
    });

    // Flush any remaining buffer content
    if (buffer.trim()) await emitLog(buffer);

    // Wait for container to finish and get exit code
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
    const message = err instanceof Error ? err.message : String(err);
    await emitLog(`\n[SimpleCI] 💥 Error: ${message}`);
    await prisma.run.update({
      where: { id: runId },
      data: { status: 'FAILED', finishedAt: new Date() },
    });
  }
}
