import { useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

/**
 * Wraps a page component. If the user is not logged in,
 * redirects to /login. Shows a spinner while checking.
 */
export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      window.location.href = '/login';
    }
  }, [user, loading]);

  if (loading) {
    return (
      <>
        <nav className="navbar">
          <div className="navbar-logo">Simple<span>CI</span></div>
        </nav>
        <div className="page">
          <div className="empty-state">
            <div className="spinner" />
            <p>Checking authentication...</p>
          </div>
        </div>
      </>
    );
  }

  if (!user) return null; // redirect in progress

  return <>{children}</>;
}
