import { Router, Request, Response } from 'express';
import { verifyGithubWebhook } from '../lib/verifyWebhook.js';
import { getDefaultSteps, parsePipelineConfig } from '../services/pipelineParser.js';
import { runPipeline } from '../services/dockerRunner.js';
import prisma from '../db/prisma.js';
import { WebSocketServer } from 'ws';

export function createWebhookRouter(wss: WebSocketServer): Router {
  const router = Router();

  /**
   * POST /webhook/github
   *
   * GitHub calls this endpoint on every push event.
   * We verify the signature, create a run record, and kick off the pipeline.
   */
  router.post('/github', async (req: Request, res: Response) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? '';

    // 1. Verify HMAC-SHA256 signature — reject if invalid
    const isValid = verifyGithubWebhook(req, secret);
    if (!isValid) {
      console.warn('[Webhook] ❌ Invalid signature — rejecting request');
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    // 2. Parse the GitHub payload
    // req.body is a raw Buffer (because of express.raw() in server.ts).
    // We must explicitly parse it as JSON — a direct cast would make all fields undefined.
    const payload = JSON.parse((req.body as Buffer).toString('utf-8')) as Record<string, unknown>;

    // Only handle push events (ignore PR events, etc.)
    const event = req.headers['x-github-event'];
    if (event !== 'push') {
      res.status(200).json({ message: `Ignoring event: ${event}` });
      return;
    }

    const ref = payload.ref as string;                             // e.g. "refs/heads/main"
    const branch = ref.replace('refs/heads/', '');                 // e.g. "main"
    const repo = payload.repository as Record<string, unknown>;
    const repoName = repo.name as string;
    const repoUrl = repo.clone_url as string;
    const headCommit = payload.head_commit as Record<string, unknown>;
    const commitSha = (headCommit.id as string).slice(0, 7);       // short SHA e.g. "d4f9a1b"
    const commitMsg = headCommit.message as string;

    console.log(`[Webhook] ✅ Push from ${repoName}@${branch} (${commitSha})`);

    // 3. Create a Run record in the database
    const run = await prisma.run.create({
      data: {
        repoName,
        repoUrl,
        branch,
        commitSha,
        commitMsg,
        status: 'RUNNING',
      },
    });

    // 4. Respond immediately to GitHub (must respond within 10 seconds)
    res.status(202).json({
      message: 'Pipeline started',
      runId: run.id,
    });

    // 5. Run the pipeline in the background (don't await — let it run async)
    const steps = getDefaultSteps(); // fallback — will be overridden from .simpleci.yaml later
    runPipeline(run.id, repoUrl, steps, wss).catch((err) => {
      console.error('[Pipeline] Unhandled error:', err);
    });
  });

  return router;
}
