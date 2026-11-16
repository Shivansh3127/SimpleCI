import { Router, Request, Response } from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { verifyGithubWebhook } from '../lib/verifyWebhook.js';
import {
  getDefaultSteps,
  parsePipelineConfig,
  getAllowedBranches,
  isBranchAllowed,
} from '../services/pipelineParser.js';
import { pipelineQueue } from '../queue/pipelineQueue.js';
import prisma from '../db/prisma.js';
import { WebSocketServer } from 'ws';

export function createWebhookRouter(wss: WebSocketServer): Router {
  const router = Router();

  /**
   * POST /webhook/github
   *
   * GitHub calls this endpoint on every push event.
   *
   * Level 2 change:
   * - Instead of calling runPipeline() directly (fire-and-forget),
   *   we add a job to the BullMQ queue.
   * - The worker process picks it up and runs it with concurrency control.
   * - Run is created with status 'QUEUED' — worker sets it to 'RUNNING'
   *   when it actually starts executing.
   */
  router.post('/github', async (req: Request, res: Response) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? '';

    // ── 1. Verify HMAC-SHA256 signature ──────────────────────────
    const isValid = verifyGithubWebhook(req, secret);
    if (!isValid) {
      console.warn('[Webhook] ❌ Invalid signature — rejecting request');
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    // ── 2. Parse payload ──────────────────────────────────────────
    const payload = JSON.parse((req.body as Buffer).toString('utf-8')) as Record<string, unknown>;

    const event = req.headers['x-github-event'];
    if (event !== 'push') {
      res.status(200).json({ message: `Ignoring event: ${event}` });
      return;
    }

    const ref = payload.ref as string | undefined;
    const repo = payload.repository as Record<string, unknown> | undefined;
    const headCommit = payload.head_commit as Record<string, unknown> | undefined;

    if (!ref || !repo || !headCommit) {
      res.status(400).json({ error: 'Malformed push payload — missing ref, repository, or head_commit' });
      return;
    }

    const branch = ref.replace('refs/heads/', '');
    const repoName = repo.name as string;
    const repoUrl = repo.clone_url as string;
    const commitSha = (headCommit.id as string).slice(0, 7);
    const commitMsg = (headCommit.message as string) ?? '(no message)';

    console.log(`[Webhook] ✅ Push from ${repoName}@${branch} (${commitSha})`);

    // ── 3. Read .simpleci.yaml for branch filtering ───────────────
    let configSteps = getDefaultSteps();
    let tempDir: string | null = null;

    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simpleci-'));
      execSync(`git clone --depth 1 ${repoUrl} ${tempDir}`, { stdio: 'ignore', timeout: 30_000 });

      const config = parsePipelineConfig(tempDir);
      const allowedBranches = getAllowedBranches(config);

      if (!isBranchAllowed(branch, allowedBranches)) {
        console.log(`[Webhook] ⏭️  Branch "${branch}" not in allowed list — skipping`);
        res.status(200).json({ message: `Branch "${branch}" not configured for CI — skipping` });
        return;
      }

      if (config?.pipeline?.steps?.length) {
        configSteps = config.pipeline.steps;
        console.log(`[Webhook] 📋 Using .simpleci.yaml steps: ${configSteps.map((s) => s.name).join(' → ')}`);
      } else {
        console.log('[Webhook] 📋 No .simpleci.yaml found — using default steps');
      }
    } catch (err) {
      console.warn('[Webhook] ⚠️  Could not clone repo to read .simpleci.yaml — using default steps:', err);
    } finally {
      if (tempDir) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      }
    }

    // ── 4. Create a Run record with status QUEUED ─────────────────
    // Status is QUEUED here — the worker will flip it to RUNNING
    // when it actually picks up the job and starts the container.
    const run = await prisma.run.create({
      data: { repoName, repoUrl, branch, commitSha, commitMsg, status: 'QUEUED' },
    });

    // ── 5. Add job to BullMQ queue ────────────────────────────────
    // The worker process picks this up respecting the concurrency limit.
    // Job data is serialized to Redis — survives server restarts.
    const job = await pipelineQueue.add('pipeline', {
      runId: run.id,
      repoUrl,
      steps: configSteps,
    });

    console.log(`[Webhook] 📥 Queued job ${job.id} for run ${run.id}`);

    // ── 6. Respond immediately to GitHub ─────────────────────────
    res.status(202).json({
      message: 'Pipeline queued',
      runId: run.id,
      jobId: job.id,
    });
  });

  return router;
}
