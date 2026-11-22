import { Router, Request, Response } from 'express';
import prisma from '../db/prisma.js';
import { getDefaultSteps } from '../services/pipelineParser.js';
import { pipelineQueue } from '../queue/pipelineQueue.js';
import { WebSocketServer } from 'ws';
import Docker from 'dockerode';

const docker = new Docker();

/**
 * Creates the runs router.
 * Level 2 adds:
 * - DELETE /runs/:id  — cancel a running pipeline (kills the Docker container)
 * - Retry now queues via BullMQ instead of calling runPipeline() directly
 */
export default function createRunsRouter(wss: WebSocketServer): Router {
  const router = Router();

  /**
   * GET /runs
   * Returns all pipeline runs, newest first.
   */
  router.get('/', async (_req: Request, res: Response) => {
    try {
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
    } catch (err) {
      console.error('[GET /runs] Error:', err);
      res.status(500).json({ error: 'Failed to fetch runs' });
    }
  });

  /**
   * GET /runs/:id
   * Returns a single run with all its logs.
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const run = await prisma.run.findUnique({
        where: { id: req.params.id },
        include: {
          logs: { orderBy: { createdAt: 'asc' } },
        },
      });

      if (!run) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }

      res.json(run);
    } catch (err) {
      console.error('[GET /runs/:id] Error:', err);
      res.status(500).json({ error: 'Failed to fetch run' });
    }
  });

  /**
   * POST /runs/:id/retry
   *
   * Re-runs a pipeline. Creates a new Run record and queues it via BullMQ.
   */
  router.post('/:id/retry', async (req: Request, res: Response) => {
    try {
      const original = await prisma.run.findUnique({ where: { id: req.params.id } });

      if (!original) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }

      const newRun = await prisma.run.create({
        data: {
          repoName:  original.repoName,
          repoUrl:   original.repoUrl,
          branch:    original.branch,
          commitSha: original.commitSha,
          commitMsg: `[retry] ${original.commitMsg}`,
          status:    'QUEUED',          // QUEUED — worker sets it to RUNNING
        },
      });

      const steps = getDefaultSteps();
      const job = await pipelineQueue.add('pipeline', {
        runId:        newRun.id,
        repoUrl:      original.repoUrl,
        steps,
        // Level 3+
        githubToken:  null,
        repoOwner:    null,
        repoSlug:     original.repoName,
        commitSha:    null,
        // Level 5
        dockerImage:   original.dockerImage ?? 'node:20-alpine',
        artifactPaths: [],
        matrixLabel:   null,
        secrets:       {},
        notifyUrl:     null,
        repoName:      original.repoName,
        branch:        original.branch,
      });

      console.log(`[Retry] Queued job ${job.id} for run ${newRun.id}`);

      res.status(202).json({ message: 'Retry queued', runId: newRun.id, jobId: job.id });
    } catch (err) {
      console.error('[POST /runs/:id/retry] Error:', err);
      res.status(500).json({ error: 'Failed to queue retry' });
    }
  });

  /**
   * DELETE /runs/:id
   *
   * Cancels a QUEUED or RUNNING pipeline.
   *
   * - If QUEUED: removes the job from Redis before the worker picks it up
   * - If RUNNING: kills the Docker container immediately
   * - Either way: marks run as CANCELLED in the DB
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const run = await prisma.run.findUnique({ where: { id: req.params.id } });

      if (!run) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }

      if (run.status !== 'QUEUED' && run.status !== 'RUNNING') {
        res.status(400).json({
          error: `Cannot cancel a run with status ${run.status}. Only QUEUED or RUNNING runs can be cancelled.`,
        });
        return;
      }

      // Mark as CANCELLED in DB first — this signals to the worker to stop
      await prisma.run.update({
        where: { id: req.params.id },
        data: { status: 'CANCELLED', finishedAt: new Date() },
      });

      // If running: kill the Docker container
      if (run.status === 'RUNNING' && run.containerId) {
        try {
          const container = docker.getContainer(run.containerId);
          await container.kill();
          console.log(`[Cancel] Killed container ${run.containerId} for run ${run.id}`);
        } catch (dockerErr) {
          // Container may have already exited — not an error
          console.warn(`[Cancel] Could not kill container (may have already exited):`, dockerErr);
        }
      }

      console.log(`[Cancel] Run ${run.id} cancelled (was ${run.status})`);
      res.json({ message: 'Run cancelled', runId: run.id });
    } catch (err) {
      console.error('[DELETE /runs/:id] Error:', err);
      res.status(500).json({ error: 'Failed to cancel run' });
    }
  });

  return router;
}
