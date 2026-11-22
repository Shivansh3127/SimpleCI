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
  getDockerImage,
  getArtifactPaths,
  getDeployConfig,
  expandMatrix,
  type DeployConfig,
} from '../services/pipelineParser.js';
import { pipelineQueue } from '../queue/pipelineQueue.js';
import prisma from '../db/prisma.js';
import { WebSocketServer } from 'ws';
import { decryptSecret } from '../services/secretsService.js';

export function createWebhookRouter(wss: WebSocketServer): Router {
  const router = Router();

  /**
   * POST /webhook/github
   *
   * Level 5 changes:
   * - 5.1: Passes dockerImage from .simpleci.yaml to job
   * - 5.2: Passes artifactPaths to job
   * - 5.3: If matrix is defined, creates N parallel runs (one per matrix value)
   * - 5.4: Loads + decrypts per-repo secrets, passes them to job
   * - 5.6: Passes notifyUrl from repo settings
   */
  router.post('/github', async (req: Request, res: Response) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse((req.body as Buffer).toString('utf-8'));
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    const event = req.headers['x-github-event'];
    if (event !== 'push') {
      res.status(200).json({ message: `Ignoring event: ${event}` });
      return;
    }

    const ref        = payload.ref as string | undefined;
    const repo       = payload.repository as Record<string, unknown> | undefined;
    const headCommit = payload.head_commit as Record<string, unknown> | undefined;

    if (!ref || !repo || !headCommit) {
      res.status(400).json({ error: 'Malformed push payload' });
      return;
    }

    const repoUrl = repo.clone_url as string;

    const registeredRepo = await prisma.repository.findUnique({
      where:   { repoUrl },
      include: {
        user:    { select: { accessToken: true, username: true } },
        secrets: true,
      },
    });

    const secret = registeredRepo?.webhookSecret ?? process.env.GITHUB_WEBHOOK_SECRET ?? '';
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

    // ── Block deploy branches — prevents infinite loop ─────────────
    // When SimpleCI pushes to gh-pages, GitHub fires ANOTHER webhook.
    // We must ignore it or the pipeline will run → deploy → webhook → forever.
    const DEPLOY_BRANCHES = ['gh-pages', 'gh-pages-deploy'];
    if (DEPLOY_BRANCHES.includes(branch) || branch.startsWith('simpleci-deploy')) {
      console.log(`[Webhook] ⏭️  Branch "${branch}" is a deploy branch — ignoring to prevent infinite loop`);
      res.status(200).json({ message: `Deploy branch "${branch}" ignored` });
      return;
    }

    // ── Read .simpleci.yaml ───────────────────────────────────────
    let configSteps   = getDefaultSteps();
    let dockerImage   = 'node:20-alpine';
    let artifactPaths: string[] = [];
    let matrixEntries: Array<Record<string, string>> | null = null;
    let deployConfig: DeployConfig | null = null;
    let tempDir: string | null = null;

    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simpleci-'));
      execSync(`git clone --depth 1 ${repoUrl} ${tempDir}`, { stdio: 'ignore', timeout: 30_000 });

      const config      = parsePipelineConfig(tempDir);
      const allowedBranches = getAllowedBranches(config);

      if (!isBranchAllowed(branch, allowedBranches)) {
        console.log(`[Webhook] ⏭️  Branch "${branch}" not in allowed list — skipping`);
        res.status(200).json({ message: `Branch "${branch}" not configured for CI — skipping` });
        return;
      }

      if (config?.pipeline?.steps?.length) configSteps = config.pipeline.steps;
      dockerImage   = getDockerImage(config);
      artifactPaths = getArtifactPaths(config);
      matrixEntries = expandMatrix(config);         // Level 5.3
      deployConfig  = getDeployConfig(config);       // CD: deploy config
    } catch (err) {
      console.warn('[Webhook] ⚠️  Could not clone repo for config — using defaults:', err);
    } finally {
      if (tempDir) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      }
    }

    // ── Level 5.4: Decrypt repo secrets ───────────────────────────
    const decryptedSecrets: Record<string, string> = {};
    if (registeredRepo?.secrets) {
      for (const s of registeredRepo.secrets) {
        try {
          decryptedSecrets[s.name] = decryptSecret({
            encryptedVal: s.encryptedVal,
            iv:           s.iv,
            tag:          s.tag,
          });
        } catch (err) {
          console.warn(`[Webhook] Could not decrypt secret "${s.name}":`, err);
        }
      }
    }

    const notifyUrl  = registeredRepo?.notifyUrl ?? null;
    const fullSha    = headCommit.id as string;

    // ── Level 5.3: Matrix fan-out ──────────────────────────────────
    // If matrix is defined, create one run per matrix entry.
    // Otherwise, create a single run as before.
    const matrixList = matrixEntries ?? [null];
    const createdRuns: Array<{ runId: string; jobId: string; matrixLabel: string | null }> = [];

    for (const matrixEntry of matrixList) {
      const matrixLabel = matrixEntry
        ? Object.entries(matrixEntry).map(([k, v]) => `${k}=${v}`).join(',')
        : null;

      // Substitute matrix values into step commands
      // e.g. "node: 20" → replaces ${{ matrix.node }} with 20
      const resolvedSteps = configSteps.map((step) => ({
        ...step,
        run: matrixEntry
          ? Object.entries(matrixEntry).reduce(
              (cmd, [k, v]) => cmd.replaceAll(`\${{ matrix.${k} }}`, v),
              step.run,
            )
          : step.run,
      }));

      const run = await prisma.run.create({
        data: {
          repositoryId: registeredRepo?.id ?? null,
          repoName,
          repoUrl,
          branch,
          commitSha,
          commitMsg,
          status:      'QUEUED',
          matrixLabel,
          dockerImage,
        },
      });

      const job = await pipelineQueue.add('pipeline', {
        runId:        run.id,
        repoUrl,
        steps:        resolvedSteps,
        githubToken:  registeredRepo?.user?.accessToken ?? null,
        repoOwner:    (repo.owner as any)?.login ?? null,
        repoSlug:     repo.name as string,
        commitSha:    fullSha,
        dockerImage,
        artifactPaths,
        matrixLabel,
        secrets:      decryptedSecrets,
        notifyUrl,
        repoName,
        branch,
        deployConfig,
      });

      createdRuns.push({ runId: run.id, jobId: job.id!, matrixLabel });
      console.log(`[Webhook] 📥 Queued job ${job.id} for run ${run.id}${matrixLabel ? ` [${matrixLabel}]` : ''}`);
    }

    res.status(202).json({
      message: matrixList.length > 1
        ? `${matrixList.length} matrix runs queued`
        : 'Pipeline queued',
      runs: createdRuns,
    });
  });

  return router;
}
