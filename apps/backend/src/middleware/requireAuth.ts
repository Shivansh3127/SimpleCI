import { Request, Response, NextFunction } from 'express';

/**
 * Middleware: blocks unauthenticated requests.
 * Returns 401 JSON (not a redirect) so the React frontend can handle it.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Not authenticated', loginUrl: '/auth/github' });
}
