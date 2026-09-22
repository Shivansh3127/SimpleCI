import { Router, Request, Response } from 'express';
import prisma from '../db/prisma.js';

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

export default router;
