/**
 * secrets.ts — Level 5.4
 * API routes for per-repo encrypted secrets management.
 *
 * GET    /repos/:repoId/secrets        — list secret names (never values)
 * POST   /repos/:repoId/secrets        — create/upsert a secret
 * DELETE /repos/:repoId/secrets/:name  — delete a secret
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { encryptSecret } from '../services/secretsService.js';

const router = Router({ mergeParams: true });

router.use(requireAuth);

/** Verify caller is admin of the repo. */
async function requireRepoAdmin(req: Request, res: Response): Promise<string | null> {
  const user    = req.user as any;
  const repo    = await prisma.repository.findUnique({ where: { id: req.params.repoId } });
  if (!repo) {
    res.status(404).json({ error: 'Repository not found' });
    return null;
  }
  // Owner always has admin; also check RepoMember table
  if (repo.userId !== user.id) {
    const member = await prisma.repoMember.findUnique({
      where: { repositoryId_userId: { repositoryId: repo.id, userId: user.id } },
    });
    if (!member || member.role !== 'admin') {
      res.status(403).json({ error: 'Admin role required' });
      return null;
    }
  }
  return repo.id;
}

// GET /repos/:repoId/secrets
router.get('/', async (req: Request, res: Response) => {
  const repoId = await requireRepoAdmin(req, res);
  if (!repoId) return;

  const secrets = await prisma.secret.findMany({
    where:   { repositoryId: repoId },
    select:  { id: true, name: true, createdAt: true }, // NEVER return encryptedVal
    orderBy: { name: 'asc' },
  });
  res.json(secrets);
});

// POST /repos/:repoId/secrets
const SecretSchema = z.object({
  name:  z.string().min(1).max(100).regex(/^[A-Z0-9_]+$/, 'Secret name must be uppercase letters, digits, underscores'),
  value: z.string().min(1),
});

router.post('/', async (req: Request, res: Response) => {
  const repoId = await requireRepoAdmin(req, res);
  if (!repoId) return;

  const result = SecretSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  const { name, value } = result.data;
  const enc = encryptSecret(value);

  const secret = await prisma.secret.upsert({
    where:  { repositoryId_name: { repositoryId: repoId, name } },
    update: { encryptedVal: enc.encryptedVal, iv: enc.iv, tag: enc.tag },
    create: { repositoryId: repoId, name, encryptedVal: enc.encryptedVal, iv: enc.iv, tag: enc.tag },
  });

  res.status(201).json({ id: secret.id, name: secret.name, createdAt: secret.createdAt });
});

// DELETE /repos/:repoId/secrets/:name
router.delete('/:name', async (req: Request, res: Response) => {
  const repoId = await requireRepoAdmin(req, res);
  if (!repoId) return;

  const deleted = await prisma.secret.deleteMany({
    where: { repositoryId: repoId, name: req.params.name },
  });

  if (deleted.count === 0) {
    res.status(404).json({ error: 'Secret not found' });
    return;
  }

  res.json({ message: 'Secret deleted' });
});

export default router;
