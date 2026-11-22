/**
 * members.ts — Level 5.5 RBAC
 * API routes for managing per-repo role-based access.
 *
 * GET    /repos/:repoId/members          — list members + roles
 * POST   /repos/:repoId/members          — invite a user (by GitHub username)
 * PATCH  /repos/:repoId/members/:userId  — change role
 * DELETE /repos/:repoId/members/:userId  — remove member
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

/** Verify caller is admin of the repo, return repoId or null. */
async function requireRepoAdmin(req: Request, res: Response): Promise<string | null> {
  const user = req.user as any;
  const repo = await prisma.repository.findUnique({ where: { id: req.params.repoId } });
  if (!repo) { res.status(404).json({ error: 'Repository not found' }); return null; }

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

// GET /repos/:repoId/members
router.get('/', async (req: Request, res: Response) => {
  const repoId = await requireRepoAdmin(req, res);
  if (!repoId) return;

  const members = await prisma.repoMember.findMany({
    where:   { repositoryId: repoId },
    include: { user: { select: { id: true, username: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(members);
});

// POST /repos/:repoId/members  — { username, role }
const InviteSchema = z.object({
  username: z.string().min(1),
  role:     z.enum(['admin', 'viewer']).default('viewer'),
});

router.post('/', async (req: Request, res: Response) => {
  const repoId = await requireRepoAdmin(req, res);
  if (!repoId) return;

  const result = InviteSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  const { username, role } = result.data;
  const targetUser = await prisma.user.findFirst({ where: { username } });
  if (!targetUser) {
    res.status(404).json({ error: `User "${username}" has not logged in to SimpleCI yet` });
    return;
  }

  const member = await prisma.repoMember.upsert({
    where:  { repositoryId_userId: { repositoryId: repoId, userId: targetUser.id } },
    update: { role },
    create: { repositoryId: repoId, userId: targetUser.id, role },
  });

  res.status(201).json(member);
});

// PATCH /repos/:repoId/members/:userId  — { role }
router.patch('/:userId', async (req: Request, res: Response) => {
  const repoId = await requireRepoAdmin(req, res);
  if (!repoId) return;

  const { role } = req.body;
  if (!['admin', 'viewer'].includes(role)) {
    res.status(400).json({ error: 'role must be "admin" or "viewer"' });
    return;
  }

  const updated = await prisma.repoMember.updateMany({
    where: { repositoryId: repoId, userId: req.params.userId },
    data:  { role },
  });
  if (updated.count === 0) { res.status(404).json({ error: 'Member not found' }); return; }

  res.json({ message: 'Role updated' });
});

// DELETE /repos/:repoId/members/:userId
router.delete('/:userId', async (req: Request, res: Response) => {
  const repoId = await requireRepoAdmin(req, res);
  if (!repoId) return;

  const deleted = await prisma.repoMember.deleteMany({
    where: { repositoryId: repoId, userId: req.params.userId },
  });
  if (deleted.count === 0) { res.status(404).json({ error: 'Member not found' }); return; }
  res.json({ message: 'Member removed' });
});

export default router;
