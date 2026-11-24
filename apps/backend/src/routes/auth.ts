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
 * GET /auth/github/switch
 * "Use a different GitHub account" flow.
 *
 * GitHub remembers your browser session and auto-logs you in without asking.
 * To force account selection, we redirect through GitHub's logout URL first.
 * GitHub logs you out of github.com, then immediately starts a fresh OAuth flow
 * where the user can log in with any account they choose.
 */
router.get('/github/switch', (req: Request, res: Response) => {
  // 1. Destroy our own session so the old user is fully signed out of SimpleCICD
  req.logout((err) => {
    if (err) console.warn('[Auth] Logout error during account switch:', err);
    req.session.destroy(() => {
      res.clearCookie('simpleci.sid');

      // 2. Build the GitHub OAuth URL we want GitHub to redirect back to after logout
      const clientId = process.env.GITHUB_CLIENT_ID ?? '';
      const callbackUrl = process.env.GITHUB_CALLBACK_URL ?? 'http://localhost:3000/auth/github/callback';
      const scope = 'user:email repo:status public_repo';

      const oauthUrl =
        `https://github.com/login/oauth/authorize` +
        `?client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
        `&scope=${encodeURIComponent(scope)}`;

      // 3. Redirect through GitHub logout → GitHub shows fresh login page
      //    User can then sign in with any account they want
      const githubLogoutUrl =
        `https://github.com/logout?return_to=${encodeURIComponent(oauthUrl)}`;

      res.redirect(githubLogoutUrl);
    });
  });
});

/**
 * GET /auth/github/callback
 * GitHub redirects here after the user approves the OAuth app.
 * Passport exchanges the code for a token and runs the verify callback.
 */
router.get(
  '/github/callback',
  passport.authenticate('github', { failureRedirect: `${FRONTEND_URL}/login?error=auth_failed` }),
  (req: Request, res: Response) => {
    // Regenerate the session after successful login to prevent session fixation.
    // This ensures a new session ID is issued, discarding any stale data from a
    // previously logged-in user (e.g. a different GitHub account that was signed
    // in earlier in the same browser).
    const user = req.user;
    req.session.regenerate((err) => {
      if (err) {
        console.error('[Auth] Session regeneration failed:', err);
        return res.redirect(`${FRONTEND_URL}/login?error=session_error`);
      }
      // Re-attach the user to the new session so passport stays authenticated
      req.login(user as Express.User, (loginErr) => {
        if (loginErr) {
          console.error('[Auth] Re-login after session regenerate failed:', loginErr);
          return res.redirect(`${FRONTEND_URL}/login?error=session_error`);
        }
        res.redirect(`${FRONTEND_URL}/`);
      });
    });
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
