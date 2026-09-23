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
import { runPipeline } from '../services/dockerRunner.js';
import prisma from '../db/prisma.js';
import { WebSocketServer } from 'ws';

export function createWebhookRouter(wss: WebSocketServer): Router {
  const router = Router();

  /**
   * POST /webhook/github
   *
   * GitHub calls this endpoint on every push event.
   * Steps:
   *  1. Verify HMAC-SHA256 signature
   *  2. Parse and validate the payload
   *  3. Check branch filter from .simpleci.yaml (if configured)
   *  4. Create a Run record in the DB
   *  5. Respond 202 immediately (GitHub has a 10s timeout)
   *  6. Clone repo, read .simpleci.yaml, run pipeline in background
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
    // req.body is a raw Buffer (because of express.raw() in server.ts).
    const payload = JSON.parse((req.body as Buffer).toString('utf-8')) as Record<string, unknown>;

    // Only handle push events
    const event = req.headers['x-github-event'];
    if (event !== 'push') {
      res.status(200).json({ message: `Ignoring event: ${event}` });
      return;
    }

    // Validate required payload fields
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
    // We do a shallow clone to a temp dir just to read the config file.
    // This lets us filter branches BEFORE creating a DB run record.
    let configSteps = getDefaultSteps();
    let tempDir: string | null = null;

    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simpleci-'));
      execSync(`git clone --depth 1 ${repoUrl} ${tempDir}`, { stdio: 'ignore', timeout: 30_000 });

      const config = parsePipelineConfig(tempDir);
      const allowedBranches = getAllowedBranches(config);

      // Branch filter: if .simpleci.yaml defines branches, only run for those
      if (!isBranchAllowed(branch, allowedBranches)) {
        console.log(`[Webhook] ⏭️  Branch "${branch}" not in allowed list [${allowedBranches.join(', ')}] — skipping`);
        res.status(200).json({ message: `Branch "${branch}" not configured for CI — skipping` });
        return;
      }

      // Use steps from .simpleci.yaml if available, otherwise use defaults
      if (config?.pipeline?.steps?.length) {
        configSteps = config.pipeline.steps;
        console.log(`[Webhook] 📋 Using .simpleci.yaml steps: ${configSteps.map((s) => s.name).join(' → ')}`);
      } else {
        console.log('[Webhook] 📋 No .simpleci.yaml found — using default steps');
      }
    } catch (err) {
      // Clone failed (e.g. private repo, invalid URL) — fall back to defaults and continue
      console.warn('[Webhook] ⚠️  Could not clone repo to read .simpleci.yaml — using default steps:', err);
    } finally {
      // Clean up the temp clone
      if (tempDir) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      }
    }

    // ── 4. Create a Run record ────────────────────────────────────
    const run = await prisma.run.create({
      data: { repoName, repoUrl, branch, commitSha, commitMsg, status: 'RUNNING' },
    });

    // ── 5. Respond immediately to GitHub ─────────────────────────
    res.status(202).json({ message: 'Pipeline started', runId: run.id });

    // ── 6. Run the pipeline in the background ─────────────────────
    // (no await — runPipeline does its own cloning inside Docker)
    runPipeline(run.id, repoUrl, configSteps, wss).catch((err) => {
      console.error('[Pipeline] Unhandled error:', err);
    });
  });

  return router;
}

