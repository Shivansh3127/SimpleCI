/**
 * artifacts.ts — Level 5.2
 * Serves build artifacts stored on the local filesystem.
 *
 * GET  /runs/:runId/artifacts          — list artifacts for a run
 * GET  /runs/:runId/artifacts/download — stream a specific artifact file
 */
import { Router, Request, Response } from 'express';
import path from 'path';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { getArtifactPath, listArtifacts } from '../services/artifactService.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

// GET /runs/:runId/artifacts — list all artifacts for this run
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
  try { keys = JSON.parse(run.artifactKeys); } catch { keys = []; }

  const API = process.env.BACKEND_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

  const artifacts = keys.map((key) => ({
    key,
    filename: key.split('/').pop(),
    // Direct download URL — the backend streams the file
    url: `${API}/runs/${req.params.runId}/artifacts/download?key=${encodeURIComponent(key)}`,
  }));

  res.json({ artifacts });
});

// GET /runs/:runId/artifacts/download?key=runs/<runId>/<file>
router.get('/download', async (req: Request, res: Response) => {
  const { key } = req.query;
  if (!key || typeof key !== 'string') {
    res.status(400).json({ error: 'Missing key param' });
    return;
  }

  // Security: prevent path traversal — key must start with "runs/<runId>/"
  const runId = req.params.runId;
  if (!key.startsWith(`runs/${runId}/`)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const filePath = getArtifactPath(key);
  const filename = path.basename(filePath);

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.sendFile(filePath, { root: '/' }, (err) => {
    if (err) res.status(404).json({ error: 'Artifact not found' });
  });
});

export default router;
