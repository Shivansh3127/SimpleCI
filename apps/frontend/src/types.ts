// Shared TypeScript types — mirrors the backend API response shapes exactly

export interface Run {
  id: string;
  repoName: string;
  branch: string;
  commitSha: string;
  commitMsg: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  startedAt: string;
  finishedAt: string | null;
  repositoryId: string | null;
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

export interface WsMessage {
  runId: string;
  line: string;
}

export interface Repository {
  id: string;
  repoName: string;
  repoUrl: string;
  webhookSecret: string;
  createdAt: string;
  _count: { runs: number };
}
