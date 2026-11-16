import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import prisma from '../db/prisma.js';

/**
 * Configures Passport with the GitHub OAuth strategy.
 *
 * Flow:
 * 1. User clicks "Login with GitHub"
 * 2. Browser → GitHub OAuth page (user approves)
 * 3. GitHub → GET /auth/github/callback?code=...
 * 4. passport-github2 exchanges code for access token
 * 5. This verify callback runs — upsert User in DB
 * 6. User object stored in session
 */
export function configurePassport() {
  const clientID     = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientID || clientID === 'your_client_id_here' ||
      !clientSecret || clientSecret === 'your_client_secret_here') {
    console.warn('[Auth] ⚠️  GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET not configured.');
    console.warn('[Auth]     OAuth login is DISABLED. Set them in .env to enable it.');
    // Serialize/deserialize still needed even without OAuth
    passport.serializeUser((user: any, done) => done(null, user.id));
    passport.deserializeUser(async (id: string, done) => {
      try {
        const user = await prisma.user.findUnique({ where: { id } });
        done(null, user);
      } catch (err) { done(err); }
    });
    return;
  }

  passport.use(
    new GitHubStrategy(
      {
        clientID,
        clientSecret,
        callbackURL:  process.env.GITHUB_CALLBACK_URL ?? 'http://localhost:3000/auth/github/callback',
        scope: ['user:email', 'repo:status'], // repo:status = can post commit statuses
      },
      async (_accessToken: string, _refreshToken: string, profile: any, done: Function) => {
        try {
          // Upsert: create or update user on every login
          const user = await prisma.user.upsert({
            where: { githubId: String(profile.id) },
            update: {
              username:    profile.username,
              avatarUrl:   profile.photos?.[0]?.value ?? null,
              accessToken: _accessToken,  // refresh token on every login
            },
            create: {
              githubId:    String(profile.id),
              username:    profile.username,
              avatarUrl:   profile.photos?.[0]?.value ?? null,
              accessToken: _accessToken,
            },
          });
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    )
  );

  // Store only the user ID in the session cookie (small + secure)
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  // On each request, load the full user from DB using the session ID
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await prisma.user.findUnique({ where: { id } });
      done(null, user);
    } catch (err) {
      done(err);
    }
  });
}
