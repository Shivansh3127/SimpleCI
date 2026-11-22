/**
 * artifacts.ts — Level 5.2
 * API route to get pre-signed artifact download URLs for a run.
 *
 * GET /runs/:runId/artifacts  — returns presigned URLs for all artifacts in a run
 */
import { Router, Request, Response } from 'express';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { getArtifactUrl } from '../services/artifactService.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get('/', async (req: Request, res: Response) => {
  const run = await prisma.run.findUnique({
    where:  { id: req.params.runId },
    select: { artifactKeys: true },
  });

  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }

  if (!run.artifactKeys) {
    res.json({ artifacts: [] });
    return;
  }

  let keys: string[] = [];
  try {
    keys = JSON.parse(run.artifactKeys);
  } catch {
    res.json({ artifacts: [] });
    return;
  }

  const artifacts = await Promise.all(
    keys.map(async (key) => ({
      key,
      filename: key.split('/').pop(),
      url:      await getArtifactUrl(key),
    }))
  );

  res.json({ artifacts });
});

export default router;
