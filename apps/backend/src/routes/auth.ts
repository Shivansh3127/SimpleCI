import { Router, Request, Response } from 'express';
import passport from 'passport';

const router = Router();

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

/**
 * GET /auth/github
 * Redirects the user to GitHub's OAuth authorization page.
 */
router.get('/github', passport.authenticate('github', { scope: ['user:email', 'repo:status', 'public_repo'] }));

/**
 * GET /auth/github/callback
 * GitHub redirects here after the user approves the OAuth app.
 * Passport exchanges the code for a token and runs the verify callback.
 */
router.get(
  '/github/callback',
  passport.authenticate('github', { failureRedirect: `${FRONTEND_URL}/login?error=auth_failed` }),
  (_req: Request, res: Response) => {
    // Success — redirect to the dashboard
    res.redirect(`${FRONTEND_URL}/`);
  }
);

/**
 * POST /auth/logout
 * Destroys the session and clears the cookie.
 */
router.post('/logout', (req: Request, res: Response) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    req.session.destroy(() => {
      res.clearCookie('simpleci.sid');
      res.json({ message: 'Logged out' });
    });
  });
});

/**
 * GET /auth/me
 * Returns the currently logged-in user's public info.
 * Frontend uses this to check if the user is authenticated on page load.
 */
router.get('/me', (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ user: null });
    return;
  }
  const user = req.user as any;
  // Never send accessToken to the frontend
  res.json({
    id:        user.id,
    username:  user.username,
    avatarUrl: user.avatarUrl,
  });
});

export default router;
