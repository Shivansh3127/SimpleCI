// Shared TypeScript types — mirrors the backend API response shapes exactly

export interface Run {
  id: string;
  repoName: string;
  branch: string;
  commitSha: string;
  commitMsg: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  startedAt: string;
  finishedAt: string | null;
}

export interface Log {
  id: number;
  runId: string;
  line: string;
  createdAt: string;
}

export interface RunDetail extends Run {
  logs: Log[];
}

// WebSocket message shape
export interface WsMessage {
  runId: string;
  line: string;
}
