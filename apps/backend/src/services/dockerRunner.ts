import Docker from 'dockerode';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import os from 'os';
import tar from 'tar';
import prisma from '../db/prisma.js';
import { PipelineStep } from './pipelineParser.js';
import { childLogger } from '../lib/logger.js';
import { uploadArtifact } from './artifactService.js';
import { sendNotification } from './notifyService.js';
import { runPipelineProcess } from './processRunner.js';

const docker = new Docker();

const BUILD_CACHE_VOLUME = 'simpleci-build-cache';

/**
 * Posts a commit status to GitHub so PRs show ✅ or ❌ from SimpleCI.
 */
async function postCommitStatus(
  token:  string,
  owner:  string,
  repo:   string,
  sha:    string,
  state:  'pending' | 'success' | 'failure' | 'error',
  runId:  string,
) {
  try {
    const url         = `https://api.github.com/repos/${owner}/${repo}/statuses/${sha}`;
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    await fetch(url, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent':   'SimpleCI/1.0',
      },
      body: JSON.stringify({
        state,
        target_url:  `${frontendUrl}/runs/${runId}`,
        description: state === 'success' ? 'All checks passed' :
                     state === 'failure' ? 'Pipeline failed'   :
                     state === 'pending' ? 'Pipeline running...' : 'Pipeline error',
        context: 'SimpleCI',
      }),
    });
  } catch (err) {
    console.warn('[GitHub Status] Failed to post commit status:', err);
  }
}

function broadcastLog(wss: WebSocketServer, runId: string, line: string) {
  const message = JSON.stringify({ runId, line });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(message);
  });
}

/**
 * Runs the full CI pipeline for a given repository inside a Docker container.
 *
 * Level 5 additions:
 * - 5.1: Uses configurable Docker image (from .simpleci.yaml `image:`)
 * - 5.2: Uploads declared artifact paths to MinIO after success
 * - 5.3: matrixLabel is recorded on the Run for display in dashboard
 * - 5.4: Decrypted secrets injected as container env vars
 * - 5.6: Sends Slack-compatible notification on completion
 */
export async function runPipeline(
  runId:         string,
  repoUrl:       string,
  steps:         PipelineStep[],
  wss:           WebSocketServer,
  githubToken?:  string | null,
  repoOwner?:    string | null,
  repoSlug?:     string | null,
  commitSha?:    string | null,
  // Level 5 params
  dockerImage?:  string,
  artifactPaths?: string[],
  matrixLabel?:  string | null,
  secrets?:      Record<string, string>,
  notifyUrl?:    string | null,
  repoName?:     string,
  branch?:       string,
): Promise<void> {
  // On Render (or any env without Docker), use the process-based runner
  if (process.env.RUNNER_MODE === 'process') {
    return runPipelineProcess(
      runId, repoUrl, steps, wss, githubToken, repoOwner, repoSlug,
      commitSha, dockerImage, artifactPaths, matrixLabel, secrets,
      notifyUrl, repoName, branch,
    );
  }
  const log       = childLogger({ runId, repo: repoUrl });
  const IMAGE     = dockerImage ?? 'node:20-alpine';
  const startMs   = Date.now();

  const stepCommands   = steps.map((s) => s.run).join(' && ');
  const cacheEnvPrefix = 'export npm_config_cache=/cache/npm PIP_CACHE_DIR=/cache/pip';

  // Determine the right package manager / shell prefix for non-Alpine images
  // Alpine uses apk; Debian/Ubuntu images (slim, etc.) use apt-get or already have git
  const isAlpine    = IMAGE.includes('alpine');
  const gitInstall  = isAlpine
    ? 'apk add --no-cache git'
    : 'apt-get update -qq && apt-get install -y -qq git 2>/dev/null || true';

  const fullCommand =
    `${gitInstall} && git clone ${repoUrl} /workspace && ` +
    `cd /workspace && ${cacheEnvPrefix} && ${stepCommands}`;

  const sanitize = (raw: string): string =>
    raw
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x00/g, '')
      .trimEnd();

  const emitLog = async (line: string) => {
    const clean = sanitize(line);
    try {
      await prisma.log.create({ data: { runId, line: clean } });
    } catch (dbErr) {
      log.error({ err: dbErr }, 'emitLog: DB write failed');
    }
    broadcastLog(wss, runId, clean);
  };

  const isCancelled = async (): Promise<boolean> => {
    const run = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
    return run?.status === 'CANCELLED';
  };

  // Build env vars array: cache dirs + user secrets (Level 5.4)
  const envVars: string[] = [];
  if (secrets) {
    for (const [k, v] of Object.entries(secrets)) {
      envVars.push(`${k}=${v}`);
    }
  }

  let finalStatus: 'SUCCESS' | 'FAILED' | 'CANCELLED' = 'FAILED';

  try {
    await prisma.run.update({
      where: { id: runId },
      data:  {
        status:      'RUNNING',
        dockerImage: IMAGE,
        matrixLabel: matrixLabel ?? null,
      },
    });

    if (githubToken && repoOwner && repoSlug && commitSha) {
      await postCommitStatus(githubToken, repoOwner, repoSlug, commitSha, 'pending', runId);
    }

    const matrixTag = matrixLabel ? ` [${matrixLabel}]` : '';
    await emitLog(`[SimpleCI] Starting pipeline${matrixTag} for run: ${runId}`);
    await emitLog(`[SimpleCI] Image:  ${IMAGE}`);
    await emitLog(`[SimpleCI] Repo:   ${repoUrl}`);
    await emitLog(`[SimpleCI] Steps:  ${steps.map((s) => s.name).join(' → ')}`);
    if (secrets && Object.keys(secrets).length > 0) {
      await emitLog(`[SimpleCI] Secrets: ${Object.keys(secrets).join(', ')} (injected)`);
    }
    await emitLog('');

    // ── Auto-pull the image ────────────────────────────────────────
    await emitLog(`[SimpleCI] Checking image: ${IMAGE}`);
    try {
      await docker.getImage(IMAGE).inspect();
      await emitLog(`[SimpleCI] Image already cached locally ✓`);
    } catch {
      await emitLog(`[SimpleCI] Pulling ${IMAGE} (this may take a minute)...`);
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

    if (await isCancelled()) {
      await emitLog('[SimpleCI] 🚫 Run was cancelled before container started');
      finalStatus = 'CANCELLED';
      return;
    }

    // ── Create Docker container ────────────────────────────────────
    const container = await docker.createContainer({
      Image:        IMAGE,
      Cmd:          ['sh', '-c', fullCommand],
      WorkingDir:   '/workspace',
      AttachStdout: true,
      AttachStderr: true,
      Env:          envVars,
      HostConfig: {
        AutoRemove: false,  // Level 5.2: we need to copy artifacts BEFORE removal
        Memory:     512 * 1024 * 1024,
        NanoCpus:   500_000_000,
        Binds:      [`${BUILD_CACHE_VOLUME}:/cache`],
      },
    });

    await prisma.run.update({
      where: { id: runId },
      data:  { containerId: container.id },
    });

    await container.start();
    await emitLog('[SimpleCI] Container started. Running pipeline...\n');

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
      stream.on('end',   resolve);
      stream.on('error', reject);
    });

    if (buffer.trim()) await emitLog(buffer);

    if (await isCancelled()) {
      await emitLog('[SimpleCI] 🚫 Pipeline was cancelled');
      finalStatus = 'CANCELLED';
      await container.remove({ force: true }).catch(() => {});
      return;
    }

    const result   = await container.wait();
    const exitCode = result.StatusCode as number;

    // ── Level 5.2: Collect & upload artifacts ─────────────────────
    const uploadedKeys: string[] = [];
    if (exitCode === 0 && artifactPaths && artifactPaths.length > 0) {
      await emitLog('\n[SimpleCI] 📦 Collecting artifacts...');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simpleci-artifacts-'));

      for (const artifactPath of artifactPaths) {
        try {
          // docker.getArchive extracts a tar from the container filesystem
          const archiveStream = await (container as any).getArchive({
            path: `/workspace/${artifactPath}`,
          });

          const tarFile = path.join(tmpDir, `artifact-${Date.now()}.tar`);
          const writeStream = fs.createWriteStream(tarFile);
          await new Promise<void>((res, rej) => {
            archiveStream.pipe(writeStream);
            writeStream.on('finish', res);
            writeStream.on('error',  rej);
          });

          const key = await uploadArtifact(runId, tarFile);
          uploadedKeys.push(key);
          await emitLog(`[SimpleCI] ✓ Uploaded artifact: ${artifactPath} → ${key}`);
          fs.unlinkSync(tarFile);
        } catch (err) {
          await emitLog(`[SimpleCI] ⚠️  Could not collect artifact "${artifactPath}": ${err}`);
        }
      }

      try { fs.rmdirSync(tmpDir); } catch {}
    }

    // Remove the container now that we've grabbed artifacts
    await container.remove({ force: true }).catch(() => {});

    if (exitCode === 0) {
      await emitLog('\n[SimpleCI] ✅ Pipeline PASSED');
      finalStatus = 'SUCCESS';
      await prisma.run.update({
        where: { id: runId },
        data:  {
          status:       'SUCCESS',
          finishedAt:   new Date(),
          artifactKeys: uploadedKeys.length > 0 ? JSON.stringify(uploadedKeys) : null,
        },
      });
      if (githubToken && repoOwner && repoSlug && commitSha) {
        await postCommitStatus(githubToken, repoOwner, repoSlug, commitSha, 'success', runId);
      }
    } else {
      await emitLog(`\n[SimpleCI] ❌ Pipeline FAILED (exit code: ${exitCode})`);
      finalStatus = 'FAILED';
      await prisma.run.update({
        where: { id: runId },
        data:  { status: 'FAILED', finishedAt: new Date() },
      });
      if (githubToken && repoOwner && repoSlug && commitSha) {
        await postCommitStatus(githubToken, repoOwner, repoSlug, commitSha, 'failure', runId);
      }
    }
  } catch (err) {
    if (await isCancelled()) {
      await emitLog('[SimpleCI] 🚫 Pipeline was cancelled');
      finalStatus = 'CANCELLED';
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    await emitLog(`\n[SimpleCI] 💥 Error: ${message}`);
    finalStatus = 'FAILED';
    await prisma.run.update({
      where: { id: runId },
      data:  { status: 'FAILED', finishedAt: new Date() },
    });
  } finally {
    // ── Level 5.6: Send notification ──────────────────────────────
    if (notifyUrl && (finalStatus === 'SUCCESS' || finalStatus === 'FAILED' || finalStatus === 'CANCELLED')) {
      await sendNotification(notifyUrl, {
        runId,
        repoName:   repoName ?? repoUrl,
        branch:     branch   ?? 'unknown',
        commitSha:  commitSha ?? '',
        status:     finalStatus,
        durationMs: Date.now() - startMs,
        matrixLabel,
      });
    }
  }
}
