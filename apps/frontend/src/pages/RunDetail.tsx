import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { RunDetail as RunDetailType, WsMessage } from '../types';
import StatusBadge from '../components/StatusBadge';
import Terminal from '../components/Terminal';

const API    = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
const WS_URL = import.meta.env.VITE_WS_URL       ?? 'ws://localhost:3000';

interface Artifact { key: string; filename: string; url: string; }


function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return 'Running...';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun]           = useState<RunDetailType | null>(null);
  const [liveLogs, setLiveLogs]  = useState<string[]>([]);
  const [loading, setLoading]    = useState(true);
  const [error, setError]        = useState<string | null>(null);
  const [retrying, setRetrying]  = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Re-run handler
  const handleRetry = async () => {
    if (!id || retrying) return;
    setRetrying(true);
    try {
      const res = await fetch(`${API}/runs/${id}/retry`, { method: 'POST' });
      if (!res.ok) throw new Error('Retry failed');
      const data = await res.json();
      window.location.href = `/runs/${data.runId}`;
    } catch {
      alert('Failed to retry the pipeline. Is the backend running?');
      setRetrying(false);
    }
  };

  // Cancel handler — calls DELETE /runs/:id
  const handleCancel = async () => {
    if (!id || cancelling) return;
    if (!confirm('Cancel this pipeline run?')) return;
    setCancelling(true);
    try {
      const res = await fetch(`${API}/runs/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Cancel failed');
      // Refresh run data to show CANCELLED status
      const updated = await fetch(`${API}/runs/${id}`).then(r => r.json());
      setRun(updated);
    } catch {
      alert('Failed to cancel the pipeline.');
    } finally {
      setCancelling(false);
    }
  };

  // Fetch the run + its existing logs from the REST API
  useEffect(() => {
    if (!id) return;
    fetch(`${API}/runs/${id}`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('Run not found');
        return r.json();
      })
      .then((data: RunDetailType) => {
        setRun(data);
        setLiveLogs(data.logs.map((l) => l.line));
        // Load artifacts if run is done
        if (data.status === 'SUCCESS') {
          fetch(`${API}/runs/${id}/artifacts`, { credentials: 'include' })
            .then((r) => r.json())
            .then((d) => setArtifacts(d.artifacts ?? []))
            .catch(() => {});
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Connect to WebSocket for live streaming (only if QUEUED or RUNNING)
  useEffect(() => {
    if (!run || (run.status !== 'RUNNING' && run.status !== 'QUEUED')) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => console.log('[WS] Connected for live logs');

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data);
      if (msg.runId === id) {
        setLiveLogs((prev) => [...prev, msg.line]);
      }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      fetch(`${API}/runs/${id}`)
        .then((r) => r.json())
        .then((data: RunDetailType) => setRun(data))
        .catch(() => {});
    };

    return () => ws.close();
  }, [run?.status, id]);

  // Poll run status every 3s while QUEUED or RUNNING
  useEffect(() => {
    if (!run || (run.status !== 'RUNNING' && run.status !== 'QUEUED')) return;
    const interval = setInterval(async () => {
      const res = await fetch(`${API}/runs/${id}`);
      const data: RunDetailType = await res.json();
      if (data.status !== 'RUNNING' && data.status !== 'QUEUED') {
        setRun(data);
        clearInterval(interval);
      } else {
        // Update status in case it changed from QUEUED → RUNNING
        setRun(data);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [run?.status, id]);

  if (loading) return (
    <>
      <nav className="navbar"><div className="navbar-logo">Simple<span style={{color:'var(--blue)'}}>CI</span></div></nav>
      <div className="page"><div className="empty-state"><div className="spinner" /></div></div>
    </>
  );

  if (error || !run) return (
    <>
      <nav className="navbar"><div className="navbar-logo">Simple<span style={{color:'var(--blue)'}}>CI</span></div></nav>
      <div className="page">
        <Link to="/" className="back-link">← Back to Dashboard</Link>
        <div className="empty-state"><h3>Error</h3><p>{error ?? 'Run not found'}</p></div>
      </div>
    </>
  );

  const isActive = run.status === 'RUNNING' || run.status === 'QUEUED';
  const canCancel = run.status === 'RUNNING' || run.status === 'QUEUED';

  return (
    <>
      <nav className="navbar">
        <div className="navbar-logo">Simple<span style={{color:'var(--blue)'}}>CI</span></div>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Run Detail</span>
      </nav>

      <div className="page">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Link to="/" className="back-link" style={{ marginBottom: 0 }}>← All Runs</Link>

          <div style={{ display: 'flex', gap: 8 }}>
            {/* Cancel button — only shown for QUEUED or RUNNING */}
            {canCancel && (
              <button
                className="refresh-btn"
                onClick={handleCancel}
                disabled={cancelling}
                style={{ background: 'rgba(248,81,73,0.1)', color: 'var(--red)', borderColor: 'rgba(248,81,73,0.3)' }}
                title="Stop this pipeline run"
              >
                {cancelling ? '⏳ Cancelling...' : '✕ Cancel'}
              </button>
            )}

            {/* Re-run button */}
            <button
              className="refresh-btn"
              onClick={handleRetry}
              disabled={retrying || isActive}
              title={isActive ? 'Pipeline is already active' : 'Re-run this pipeline'}
            >
              {retrying ? '⏳ Starting...' : '↩ Re-run'}
            </button>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          {/* Run metadata */}
          <div className="run-meta">
            <div className="run-meta-item">
              <span className="run-meta-label">Status</span>
              <StatusBadge status={run.status} />
            </div>
            <div className="run-meta-item">
              <span className="run-meta-label">Repository</span>
              <span className="run-meta-value">{run.repoName}</span>
            </div>
            <div className="run-meta-item">
              <span className="run-meta-label">Branch</span>
              <span className="run-meta-value mono">{run.branch}</span>
            </div>
            <div className="run-meta-item">
              <span className="run-meta-label">Commit</span>
              <span className="run-meta-value mono">{run.commitSha}</span>
            </div>
            <div className="run-meta-item">
              <span className="run-meta-label">Duration</span>
              <span className="run-meta-value mono">{formatDuration(run.startedAt, run.finishedAt)}</span>
            </div>
            <div className="run-meta-item">
              <span className="run-meta-label">Started</span>
              <span className="run-meta-value">{formatDate(run.startedAt)}</span>
            </div>
            {(run as any).dockerImage && (
              <div className="run-meta-item">
                <span className="run-meta-label">Image</span>
                <code style={{ fontSize: 12, color: 'var(--blue)' }}>{(run as any).dockerImage}</code>
              </div>
            )}
            {(run as any).matrixLabel && (
              <div className="run-meta-item">
                <span className="run-meta-label">Matrix</span>
                <code style={{ fontSize: 12, color: 'var(--yellow, #d29922)' }}>{(run as any).matrixLabel}</code>
              </div>
            )}
          </div>

          {/* Commit message */}
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 13 }}>
            💬 {run.commitMsg}
          </div>

          {/* Artifacts panel — Level 5.2 */}
          {artifacts.length > 0 && (
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                📦 Artifacts
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {artifacts.map((a) => (
                  <a key={a.key} href={a.url} target="_blank" rel="noreferrer"
                    style={{ fontSize: 13, color: 'var(--blue)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    ⬇ {a.filename}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Terminal output */}
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                {run.status === 'RUNNING' && <span className="live-dot" />}
                {run.status === 'QUEUED'  && <span style={{ marginRight: 6 }}>⏳</span>}
                {run.status === 'QUEUED'  ? 'Waiting in queue...' :
                 run.status === 'RUNNING' ? 'Live Output' : 'Pipeline Output'}
              </span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 12 }}>
                {liveLogs.length} lines
              </span>
            </div>
            <Terminal lines={liveLogs} isLive={run.status === 'RUNNING'} />
          </div>
        </div>
      </div>
    </>
  );
}
