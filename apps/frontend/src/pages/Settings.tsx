import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

interface Repo {
  id: string;
  repoName: string;
  repoUrl: string;
  webhookSecret: string;
  createdAt: string;
  _count: { runs: number };
}

export default function Settings() {
  const { user, logout } = useAuth();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [repoUrl, setRepoUrl] = useState('');
  const [repoName, setRepoName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchRepos = async () => {
    const res = await fetch(`${API}/repos`, { credentials: 'include' });
    const data = await res.json();
    setRepos(data);
    setLoading(false);
  };

  useEffect(() => { fetchRepos(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`${API}/repos`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl, repoName }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setRepoUrl('');
      setRepoName('');
      await fetchRepos();
    } catch {
      setError('Failed to register repo. Is the backend running?');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}" from SimpleCI? All its run history will be deleted.`)) return;
    await fetch(`${API}/repos/${id}`, { method: 'DELETE', credentials: 'include' });
    await fetchRepos();
  };

  const copySecret = (id: string, secret: string) => {
    navigator.clipboard.writeText(secret);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <>
      <nav className="navbar">
        <div className="navbar-logo">Simple<span style={{ color: 'var(--blue)' }}>CI</span></div>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Settings</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {user?.avatarUrl && (
            <img src={user.avatarUrl} alt={user.username}
              style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border)' }} />
          )}
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{user?.username}</span>
          <button className="refresh-btn" onClick={logout}>Sign out</button>
        </div>
      </nav>

      <div className="page">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 className="page-title" style={{ marginBottom: 4 }}>Repositories</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              Register repos to get a unique webhook secret. Add that secret in GitHub → Settings → Webhooks.
            </p>
          </div>
          <Link to="/" className="refresh-btn" style={{ textDecoration: 'none' }}>← Dashboard</Link>
        </div>

        {/* Add repo form */}
        <div className="card" style={{ padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Register a new repository</h2>
          <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Repository URL
                </label>
                <input
                  type="url"
                  placeholder="https://github.com/you/my-repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  required
                  style={{
                    width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '8px 12px', color: 'var(--text)', fontSize: 13,
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Display name
                </label>
                <input
                  type="text"
                  placeholder="my-repo"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  required
                  style={{
                    width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '8px 12px', color: 'var(--text)', fontSize: 13,
                  }}
                />
              </div>
            </div>
            {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>⚠ {error}</p>}
            <button
              type="submit"
              disabled={adding}
              className="refresh-btn"
              style={{ alignSelf: 'flex-start', background: 'rgba(63,185,80,0.1)', color: 'var(--green)', borderColor: 'rgba(63,185,80,0.3)' }}
            >
              {adding ? 'Registering...' : '+ Register Repository'}
            </button>
          </form>
        </div>

        {/* Repo list */}
        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : repos.length === 0 ? (
          <div className="empty-state">
            <h3>No repositories registered</h3>
            <p>Register a repo above to get its webhook secret.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {repos.map((repo) => (
              <div key={repo.id} className="card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{repo.repoName}</div>
                    <a href={repo.repoUrl} target="_blank" rel="noreferrer"
                      style={{ fontSize: 12, color: 'var(--text-muted)' }}>{repo.repoUrl}</a>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      {repo._count.runs} run{repo._count.runs !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(repo.id, repo.repoName)}
                    style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 13 }}
                  >
                    Remove
                  </button>
                </div>

                {/* Webhook secret — copy button */}
                <div style={{ marginTop: 16, padding: 12, background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Webhook Secret — paste this into GitHub → Settings → Webhooks
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code style={{ flex: 1, fontSize: 12, color: 'var(--green)', wordBreak: 'break-all' }}>
                      {repo.webhookSecret}
                    </code>
                    <button
                      onClick={() => copySecret(repo.id, repo.webhookSecret)}
                      className="refresh-btn"
                      style={{ flexShrink: 0, fontSize: 12 }}
                    >
                      {copiedId === repo.id ? '✓ Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
