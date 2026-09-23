import { Router, Request, Response } from 'express';
import prisma from '../db/prisma.js';
import { getDefaultSteps } from '../services/pipelineParser.js';
import { runPipeline } from '../services/dockerRunner.js';
import { WebSocketServer } from 'ws';

/**
 * Creates the runs router, injecting the WebSocketServer so the retry
 * endpoint can broadcast live logs just like a fresh webhook trigger.
 */
export default function createRunsRouter(wss: WebSocketServer): Router {
  const router = Router();

  /**
   * GET /runs
   * Returns all pipeline runs, newest first.
   * Used by the dashboard to populate the run list.
   */
  router.get('/', async (_req: Request, res: Response) => {
    const runs = await prisma.run.findMany({
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        repoName: true,
        branch: true,
        commitSha: true,
        commitMsg: true,
        status: true,
        startedAt: true,
        finishedAt: true,
      },
    });
    res.json(runs);
  });

  /**
   * GET /runs/:id
   * Returns a single run with all its logs.
   * Used by the RunDetail page when a user clicks on a run.
   */
  router.get('/:id', async (req: Request, res: Response) => {
    const run = await prisma.run.findUnique({
      where: { id: req.params.id },
      include: {
        logs: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    res.json(run);
  });

  /**
   * POST /runs/:id/retry
   *
   * Re-runs a pipeline using the same repo, branch, and commit info as
   * an existing run. Creates a brand-new Run record (new UUID) so the
   * original run history is preserved.
   *
   * This means you don't need to push an empty commit to retry a failed build.
   */
  router.post('/:id/retry', async (req: Request, res: Response) => {
    // Find the original run to copy its metadata
    const original = await prisma.run.findUnique({ where: { id: req.params.id } });

    if (!original) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    // Create a new run record with the same repo/branch/commit info
    const newRun = await prisma.run.create({
      data: {
        repoName:  original.repoName,
        repoUrl:   original.repoUrl,
        branch:    original.branch,
        commitSha: original.commitSha,
        commitMsg: `[retry] ${original.commitMsg}`,
        status:    'RUNNING',
      },
    });

    // Respond immediately — the pipeline runs in the background
    res.status(202).json({ message: 'Retry started', runId: newRun.id });

    // Run the pipeline with default steps (same as what the webhook uses as fallback)
    // Note: for a full implementation, you'd re-read .simpleci.yaml from the repo here.
    const steps = getDefaultSteps();
    runPipeline(newRun.id, original.repoUrl, steps, wss).catch((err) => {
      console.error('[Retry] Unhandled pipeline error:', err);
    });
  });

  return router;
}

