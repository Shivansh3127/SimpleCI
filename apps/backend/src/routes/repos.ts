import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// All repo routes require authentication
router.use(requireAuth);

// Zod schema — validates the request body when registering a repo
const RegisterRepoSchema = z.object({
  repoUrl:   z.string().url('Must be a valid URL').regex(/github\.com/, 'Must be a GitHub repository URL'),
  repoName:  z.string().min(1, 'Repo name is required').max(100),
  notifyUrl: z.string().url().optional().nullable(),
});

/**
 * GET /repos
 * Returns all repos registered by the logged-in user.
 * Webhook secret is included so the user can copy it into GitHub settings.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const repos = await prisma.repository.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { runs: true } }, // how many runs this repo has
      },
    });
    res.json(repos);
  } catch (err) {
    console.error('[GET /repos] Error:', err);
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});

/**
 * POST /repos
 * Registers a new repo for CI.
 * Generates a unique webhook secret — user copies this into GitHub webhook settings.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const user = req.user as any;

    // Validate body with Zod
    const result = RegisterRepoSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: result.error.issues[0].message });
      return;
    }

    const { repoUrl, repoName, notifyUrl } = result.data;

    // Normalize URL: ensure it ends with .git
    const normalizedUrl = repoUrl.endsWith('.git') ? repoUrl : `${repoUrl}.git`;

    // Check if this repo is already registered (by any user)
    const existing = await prisma.repository.findUnique({ where: { repoUrl: normalizedUrl } });
    if (existing) {
      res.status(409).json({ error: 'This repository is already registered' });
      return;
    }

    // Generate a cryptographically secure unique webhook secret
    const webhookSecret = crypto.randomBytes(32).toString('hex');

    const repo = await prisma.repository.create({
      data: {
        userId:        user.id,
        repoName,
        repoUrl:       normalizedUrl,
        webhookSecret,
        notifyUrl:     notifyUrl ?? null,
      },
    });

    console.log(`[Repos] User ${user.username} registered repo: ${repoName}`);
    res.status(201).json(repo);
  } catch (err) {
    console.error('[POST /repos] Error:', err);
    res.status(500).json({ error: 'Failed to register repository' });
  }
});

/**
 * PATCH /repos/:id
 * Update notify URL (Level 5.6).
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const repo = await prisma.repository.findUnique({ where: { id: req.params.id } });
    if (!repo) { res.status(404).json({ error: 'Repository not found' }); return; }
    if (repo.userId !== user.id) { res.status(403).json({ error: 'You do not own this repository' }); return; }

    const { notifyUrl } = req.body;
    const updated = await prisma.repository.update({
      where: { id: req.params.id },
      data:  { notifyUrl: notifyUrl ?? null },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update repository' });
  }
});

/**
 * DELETE /repos/:id
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const repo = await prisma.repository.findUnique({ where: { id: req.params.id } });

    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    if (repo.userId !== user.id) {
      res.status(403).json({ error: 'You do not own this repository' });
      return;
    }

    await prisma.repository.delete({ where: { id: req.params.id } });
    res.json({ message: 'Repository removed' });
  } catch (err) {
    console.error('[DELETE /repos/:id] Error:', err);
    res.status(500).json({ error: 'Failed to remove repository' });
  }
});

export default router;
