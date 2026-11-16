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
   * Level 3 changes:
   * - Instead of one global GITHUB_WEBHOOK_SECRET in .env, each registered
   *   repo has its own unique secret stored in the repositories table.
   * - We identify the repo from the payload, look up its secret, then verify.
   * - Run is linked to its Repository row (repositoryId FK).
   * - Falls back to .env secret for backwards compatibility with unregistered repos.
   */
  router.post('/github', async (req: Request, res: Response) => {
    // Parse payload first (we need repo URL to look up the per-repo secret)
    // We parse BEFORE verifying — this is safe because we still verify after.
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse((req.body as Buffer).toString('utf-8'));
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    // Only handle push events
    const event = req.headers['x-github-event'];
    if (event !== 'push') {
      res.status(200).json({ message: `Ignoring event: ${event}` });
      return;
    }

    const ref = payload.ref as string | undefined;
    const repo = payload.repository as Record<string, unknown> | undefined;
    const headCommit = payload.head_commit as Record<string, unknown> | undefined;

    if (!ref || !repo || !headCommit) {
      res.status(400).json({ error: 'Malformed push payload' });
      return;
    }

    const repoUrl = repo.clone_url as string;

    // ── Look up the registered repo to get its unique webhook secret ──
    // Falls back to the global .env secret for unregistered repos.
    const registeredRepo = await prisma.repository.findUnique({
      where: { repoUrl },
      include: { user: { select: { accessToken: true, username: true } } },
    });

    const secret = registeredRepo?.webhookSecret ?? process.env.GITHUB_WEBHOOK_SECRET ?? '';

    // ── Verify HMAC-SHA256 signature with the correct secret ──────
    const isValid = verifyGithubWebhook(req, secret);
    if (!isValid) {
      console.warn('[Webhook] ❌ Invalid signature — rejecting request');
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    const branch    = ref.replace('refs/heads/', '');
    const repoName  = repo.name as string;
    const commitSha = (headCommit.id as string).slice(0, 7);
    const commitMsg = (headCommit.message as string) ?? '(no message)';

    console.log(`[Webhook] ✅ Push from ${repoName}@${branch} (${commitSha})`);

    // ── Read .simpleci.yaml for branch filtering + steps ──────────
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
      }
    } catch (err) {
      console.warn('[Webhook] ⚠️  Could not clone repo for config — using defaults:', err);
    } finally {
      if (tempDir) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      }
    }

    // ── Create Run record linked to the registered repo ───────────
    const run = await prisma.run.create({
      data: {
        repositoryId: registeredRepo?.id ?? null,
        repoName,
        repoUrl,
        branch,
        commitSha,
        commitMsg,
        status: 'QUEUED',
      },
    });

    // ── Queue the pipeline job ────────────────────────────────────
    const job = await pipelineQueue.add('pipeline', {
      runId:       run.id,
      repoUrl,
      steps:       configSteps,
      // Pass the GitHub token so the worker can post commit statuses
      githubToken: registeredRepo?.user?.accessToken ?? null,
      repoOwner:   (repo.owner as any)?.login ?? null,
      repoSlug:    repo.name as string,
      commitSha:   (headCommit.id as string), // full SHA for status API
    });

    console.log(`[Webhook] 📥 Queued job ${job.id} for run ${run.id}`);
    res.status(202).json({ message: 'Pipeline queued', runId: run.id, jobId: job.id });
  });

  return router;
}
