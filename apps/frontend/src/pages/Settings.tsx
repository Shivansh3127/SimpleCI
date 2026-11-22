import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)',
  borderRadius: 6, padding: '8px 12px', color: 'var(--text)', fontSize: 13,
  boxSizing: 'border-box',
};

interface Repo {
  id: string;
  repoName: string;
  repoUrl: string;
  webhookSecret: string;
  notifyUrl?: string | null;
  createdAt: string;
  _count: { runs: number };
}

interface SecretMeta { id: string; name: string; createdAt: string; }
interface Member { id: string; role: string; user: { id: string; username: string; avatarUrl?: string }; }

// ── Secrets panel ─────────────────────────────────────────────
function SecretsPanel({ repoId }: { repoId: string }) {
  const [secrets, setSecrets]   = useState<SecretMeta[]>([]);
  const [name,    setName]      = useState('');
  const [value,   setValue]     = useState('');
  const [error,   setError]     = useState<string | null>(null);
  const [saving,  setSaving]    = useState(false);

  const load = async () => {
    const res = await fetch(`${API}/repos/${repoId}/secrets`, { credentials: 'include' });
    if (res.ok) setSecrets(await res.json());
  };
  useEffect(() => { load(); }, [repoId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(null);
    const res = await fetch(`${API}/repos/${repoId}/secrets`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, value }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    setName(''); setValue(''); setSaving(false);
    await load();
  };

  const del = async (secretName: string) => {
    if (!confirm(`Delete secret "${secretName}"?`)) return;
    await fetch(`${API}/repos/${repoId}/secrets/${secretName}`, { method: 'DELETE', credentials: 'include' });
    await load();
  };

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
        🔐 Secrets (injected as env vars into every pipeline)
      </div>
      {secrets.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {secrets.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', borderRadius: 6, padding: '6px 10px' }}>
              <code style={{ flex: 1, fontSize: 12, color: 'var(--blue)' }}>{s.name}</code>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>••••••••</span>
              <button onClick={() => del(s.name)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 12 }}>✕</button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input placeholder="SECRET_NAME" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} required style={{ ...inputStyle, width: 160 }} />
        <input placeholder="value" type="password" value={value} onChange={(e) => setValue(e.target.value)} required style={{ ...inputStyle, flex: 1 }} />
        <button type="submit" disabled={saving} className="refresh-btn" style={{ flexShrink: 0 }}>
          {saving ? '...' : 'Add'}
        </button>
      </form>
      {error && <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>⚠ {error}</p>}
    </div>
  );
}

// ── Members / RBAC panel ───────────────────────────────────────
function MembersPanel({ repoId }: { repoId: string }) {
  const [members,  setMembers]  = useState<Member[]>([]);
  const [username, setUsername] = useState('');
  const [role,     setRole]     = useState<'admin' | 'viewer'>('viewer');
  const [error,    setError]    = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);

  const load = async () => {
    const res = await fetch(`${API}/repos/${repoId}/members`, { credentials: 'include' });
    if (res.ok) setMembers(await res.json());
  };
  useEffect(() => { load(); }, [repoId]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(null);
    const res = await fetch(`${API}/repos/${repoId}/members`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, role }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    setUsername(''); setSaving(false);
    await load();
  };

  const remove = async (userId: string, uname: string) => {
    if (!confirm(`Remove ${uname} from this repo?`)) return;
    await fetch(`${API}/repos/${repoId}/members/${userId}`, { method: 'DELETE', credentials: 'include' });
    await load();
  };

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
        👥 Members (RBAC)
      </div>
      {members.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {members.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', borderRadius: 6, padding: '6px 10px' }}>
              {m.user.avatarUrl && <img src={m.user.avatarUrl} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} />}
              <span style={{ flex: 1, fontSize: 13 }}>{m.user.username}</span>
              <span style={{ fontSize: 11, color: m.role === 'admin' ? 'var(--yellow)' : 'var(--text-muted)', background: 'var(--surface)', borderRadius: 4, padding: '2px 6px' }}>
                {m.role}
              </span>
              <button onClick={() => remove(m.user.id, m.user.username)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 12 }}>✕</button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={invite} style={{ display: 'flex', gap: 8 }}>
        <input placeholder="github-username" value={username} onChange={(e) => setUsername(e.target.value)} required style={{ ...inputStyle, flex: 1 }} />
        <select value={role} onChange={(e) => setRole(e.target.value as any)}
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: 'var(--text)', fontSize: 13 }}>
          <option value="viewer">viewer</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit" disabled={saving} className="refresh-btn" style={{ flexShrink: 0 }}>
          {saving ? '...' : 'Invite'}
        </button>
      </form>
      {error && <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>⚠ {error}</p>}
    </div>
  );
}

// ── Main Settings page ─────────────────────────────────────────
export default function Settings() {
  const { user, logout }     = useAuth();
  const [repos, setRepos]    = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [repoUrl, setRepoUrl] = useState('');
  const [repoName, setRepoName] = useState('');
  const [notifyUrl, setNotifyUrl] = useState('');
  const [adding, setAdding]  = useState(false);
  const [error, setError]    = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchRepos = async () => {
    const res = await fetch(`${API}/repos`, { credentials: 'include' });
    setRepos(await res.json());
    setLoading(false);
  };
  useEffect(() => { fetchRepos(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true); setError(null);
    const res = await fetch(`${API}/repos`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl, repoName, notifyUrl: notifyUrl || null }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setAdding(false); return; }
    setRepoUrl(''); setRepoName(''); setNotifyUrl('');
    setAdding(false); await fetchRepos();
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
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Repository URL</label>
                <input type="url" placeholder="https://github.com/you/my-repo" value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)} required style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Display name</label>
                <input type="text" placeholder="my-repo" value={repoName}
                  onChange={(e) => setRepoName(e.target.value)} required style={inputStyle} />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                Notify URL <span style={{ opacity: 0.5 }}>(optional — Slack / Discord webhook)</span>
              </label>
              <input type="url" placeholder="https://hooks.slack.com/services/..." value={notifyUrl}
                onChange={(e) => setNotifyUrl(e.target.value)} style={inputStyle} />
            </div>
            {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>⚠ {error}</p>}
            <button type="submit" disabled={adding} className="refresh-btn"
              style={{ alignSelf: 'flex-start', background: 'rgba(63,185,80,0.1)', color: 'var(--green)', borderColor: 'rgba(63,185,80,0.3)' }}>
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
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setExpandedId(expandedId === repo.id ? null : repo.id)}
                      className="refresh-btn" style={{ fontSize: 12 }}>
                      {expandedId === repo.id ? '▲ Less' : '▼ Manage'}
                    </button>
                    <button onClick={() => handleDelete(repo.id, repo.repoName)}
                      style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 13 }}>
                      Remove
                    </button>
                  </div>
                </div>

                {/* Webhook secret */}
                <div style={{ marginTop: 16, padding: 12, background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Webhook Secret — paste into GitHub → Settings → Webhooks
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code style={{ flex: 1, fontSize: 12, color: 'var(--green)', wordBreak: 'break-all' }}>
                      {repo.webhookSecret}
                    </code>
                    <button onClick={() => copySecret(repo.id, repo.webhookSecret)}
                      className="refresh-btn" style={{ flexShrink: 0, fontSize: 12 }}>
                      {copiedId === repo.id ? '✓ Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                {/* Expanded: Secrets + Members + Notify */}
                {expandedId === repo.id && (
                  <>
                    <SecretsPanel repoId={repo.id} />
                    <MembersPanel repoId={repo.id} />
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
