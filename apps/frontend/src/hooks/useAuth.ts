import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export interface AuthUser {
  id: string;
  username: string;
  avatarUrl: string | null;
}

/**
 * Fetches the current logged-in user from GET /auth/me.
 * Returns { user, loading } — user is null if not logged in.
 * Used by every protected page to check auth state.
 */
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/auth/me`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    window.location.href = '/login';
  };

  return { user, loading, logout };
}
