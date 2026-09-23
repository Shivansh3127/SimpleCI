import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { RunDetail as RunDetailType, WsMessage } from '../types';
import StatusBadge from '../components/StatusBadge';
import Terminal from '../components/Terminal';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3000';

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
  const [run, setRun] = useState<RunDetailType | null>(null);
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Retry handler — calls POST /runs/:id/retry and navigates to the new run
  const handleRetry = async () => {
    if (!id || retrying) return;
    setRetrying(true);
    try {
      const res = await fetch(`${API}/runs/${id}/retry`, { method: 'POST' });
      if (!res.ok) throw new Error('Retry failed');
      const data = await res.json();
      // Navigate to the new run's detail page
      window.location.href = `/runs/${data.runId}`;
    } catch {
      alert('Failed to retry the pipeline. Is the backend running?');
      setRetrying(false);
    }
  };

  // Fetch the run + its existing logs from the REST API
  useEffect(() => {
    if (!id) return;
    fetch(`${API}/runs/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error('Run not found');
        return r.json();
      })
      .then((data: RunDetailType) => {
        setRun(data);
        // Pre-populate terminal with logs already in the DB
        setLiveLogs(data.logs.map((l) => l.line));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Connect to WebSocket for live streaming (only if pipeline is RUNNING)
  useEffect(() => {
    if (!run || run.status !== 'RUNNING') return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => console.log('[WS] Connected for live logs');

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data);
      // Filter: only append lines belonging to THIS run
      if (msg.runId === id) {
        setLiveLogs((prev) => [...prev, msg.line]);
      }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      // When WS closes, refresh the run to get final status
      fetch(`${API}/runs/${id}`)
        .then((r) => r.json())
        .then((data: RunDetailType) => setRun(data))
        .catch(() => {});
    };

    return () => ws.close();
  }, [run?.status, id]);

  // Poll run status every 3s while RUNNING (updates finishedAt and status)
  useEffect(() => {
    if (!run || run.status !== 'RUNNING') return;
    const interval = setInterval(async () => {
      const res = await fetch(`${API}/runs/${id}`);
      const data: RunDetailType = await res.json();
      if (data.status !== 'RUNNING') {
        setRun(data);
        clearInterval(interval);
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

  const isLive = run.status === 'RUNNING';

  return (
    <>
      <nav className="navbar">
        <div className="navbar-logo">Simple<span style={{color:'var(--blue)'}}>CI</span></div>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Run Detail</span>
      </nav>

      <div className="page">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Link to="/" className="back-link" style={{ marginBottom: 0 }}>← All Runs</Link>
          <button
            className="refresh-btn"
            onClick={handleRetry}
            disabled={retrying || run.status === 'RUNNING'}
            title={run.status === 'RUNNING' ? 'Pipeline is already running' : 'Re-run this pipeline'}
          >
            {retrying ? '⏳ Starting...' : '↩ Re-run'}
          </button>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          {/* Run metadata header */}
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
          </div>

          {/* Commit message */}
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 13 }}>
            💬 {run.commitMsg}
          </div>

          {/* Terminal output */}
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                {isLive && <span className="live-dot" />}
                {isLive ? 'Live Output' : 'Pipeline Output'}
              </span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 12 }}>
                {liveLogs.length} lines
              </span>
            </div>
            <Terminal lines={liveLogs} isLive={isLive} />
          </div>
        </div>
      </div>
    </>
  );
}
