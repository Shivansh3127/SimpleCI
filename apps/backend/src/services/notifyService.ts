/**
 * notifyService.ts — Level 5.6
 *
 * Sends a Slack-compatible webhook notification when a pipeline finishes.
 * Any webhook that accepts a JSON POST with { text: string } works
 * (Slack, Discord with /slack endpoint, Microsoft Teams incoming webhook, etc.)
 *
 * Configure per-repo via the Settings page → "Notify URL" field.
 */

export interface NotifyPayload {
  runId:      string;
  repoName:   string;
  branch:     string;
  commitSha:  string;
  status:     'SUCCESS' | 'FAILED' | 'CANCELLED';
  durationMs: number;
  matrixLabel?: string | null;
}

export async function sendNotification(
  webhookUrl: string,
  payload: NotifyPayload,
): Promise<void> {
  const { runId, repoName, branch, commitSha, status, durationMs, matrixLabel } = payload;

  const icon    = status === 'SUCCESS' ? '✅' : status === 'FAILED' ? '❌' : '🚫';
  const label   = matrixLabel ? ` [${matrixLabel}]` : '';
  const dur     = (durationMs / 1000).toFixed(1);
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

  const text =
    `${icon} *SimpleCI*${label}: \`${repoName}\` @ \`${branch}\` (${commitSha.slice(0, 7)}) — ` +
    `*${status}* in ${dur}s\n` +
    `<${frontendUrl}/runs/${runId}|View run →>`;

  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.warn(`[Notify] Webhook responded ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.warn('[Notify] Failed to send notification:', err);
  }
}
