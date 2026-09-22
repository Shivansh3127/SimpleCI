import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { Run } from '../types';
import StatusBadge from '../components/StatusBadge';

const API = 'http://localhost:3000';

function formatDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function Dashboard() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch(`${API}/runs`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data: Run[] = await res.json();
      setRuns(data);
      setError(null);
    } catch (e) {
      setError('Cannot connect to SimpleCI backend. Is it running?');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  // Auto-refresh every 5s so RUNNING → SUCCESS/FAILED updates without manual refresh
  useEffect(() => {
    const interval = setInterval(fetchRuns, 5000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  return (
    <>
      <nav className="navbar">
        <div className="navbar-logo">Simple<span>CI</span></div>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Pipeline Dashboard</span>
      </nav>

      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Pipeline Runs</h1>
          <button className="refresh-btn" onClick={fetchRuns}>↻ Refresh</button>
        </div>

        {loading && (
          <div className="empty-state">
            <div className="spinner" style={{ marginBottom: 12 }} />
            <p>Loading runs...</p>
          </div>
        )}

        {error && (
          <div className="empty-state">
            <h3>Connection Error</h3>
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && runs.length === 0 && (
          <div className="empty-state">
            <h3>No pipeline runs yet</h3>
            <p>Push a commit to a repo with a GitHub webhook configured to see runs appear here.</p>
          </div>
        )}

        {!loading && !error && runs.length > 0 && (
          <div className="card">
            <table className="run-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Repository</th>
                  <th>Branch</th>
                  <th>Commit</th>
                  <th>Message</th>
                  <th>Duration</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td><StatusBadge status={run.status} /></td>
                    <td>
                      <Link to={`/runs/${run.id}`} style={{ fontWeight: 600 }}>
                        {run.repoName}
                      </Link>
                    </td>
                    <td><span className="mono">{run.branch}</span></td>
                    <td><span className="mono">{run.commitSha}</span></td>
                    <td>
                      <span className="commit-msg" title={run.commitMsg}>
                        {run.commitMsg}
                      </span>
                    </td>
                    <td><span className="mono">{formatDuration(run.startedAt, run.finishedAt)}</span></td>
                    <td><span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{formatDate(run.startedAt)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
