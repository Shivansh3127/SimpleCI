import { exec } from 'child_process';
import { spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WebSocketServer } from 'ws';
import prisma from '../db/prisma.js';
import { PipelineStep, type DeployConfig } from './pipelineParser.js';
import { childLogger } from '../lib/logger.js';
import { sendNotification } from './notifyService.js';

const execAsync = promisify(exec);

/**
 * Process-based pipeline runner — used when RUNNER_MODE=process (e.g. on Render).
 * Runs steps directly via child_process instead of Docker containers.
 * Requires git to be installed in the host environment.
 */

function broadcastLog(wss: WebSocketServer, runId: string, line: string) {
  const message = JSON.stringify({ runId, line });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(message);
  });
}

async function postCommitStatus(
  token: string, owner: string, repo: string,
  sha: string, state: 'pending' | 'success' | 'failure' | 'error', runId: string,
) {
  try {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    await fetch(`https://api.github.com/repos/${owner}/${repo}/statuses/${sha}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'SimpleCI/1.0',
      },
      body: JSON.stringify({
        state,
        target_url: `${frontendUrl}/runs/${runId}`,
        description: state === 'success' ? 'All checks passed' :
                     state === 'failure' ? 'Pipeline failed'   :
                     state === 'pending' ? 'Pipeline running...' : 'Pipeline error',
        context: 'SimpleCI',
      }),
    });
  } catch (err) {
    console.warn('[GitHub Status] Failed to post commit status:', err);
  }
}

export async function runPipelineProcess(
  runId:         string,
  repoUrl:       string,
  steps:         PipelineStep[],
  wss:           WebSocketServer,
  githubToken?:  string | null,
  repoOwner?:    string | null,
  repoSlug?:     string | null,
  commitSha?:    string | null,
  dockerImage?:  string,
  artifactPaths?: string[],
  matrixLabel?:  string | null,
  secrets?:      Record<string, string>,
  notifyUrl?:    string | null,
  repoName?:     string,
  branch?:       string,
  deployConfig?: DeployConfig | null,
): Promise<void> {
  const log     = childLogger({ runId, repo: repoUrl });
  const startMs = Date.now();
  let   finalStatus: 'SUCCESS' | 'FAILED' | 'CANCELLED' = 'FAILED';
  let   workDir: string | null = null;

  const sanitize = (raw: string) =>
    raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x00/g, '').trimEnd();

  const emitLog = async (line: string) => {
    const clean = sanitize(line);
    try { await prisma.log.create({ data: { runId, line: clean } }); } catch {}
    broadcastLog(wss, runId, clean);
  };

  const isCancelled = async () => {
    const run = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
    return run?.status === 'CANCELLED';
  };

  try {
    await prisma.run.update({
      where: { id: runId },
      data:  { status: 'RUNNING', dockerImage: dockerImage ?? 'process', matrixLabel: matrixLabel ?? null },
    });

    if (githubToken && repoOwner && repoSlug && commitSha) {
      await postCommitStatus(githubToken, repoOwner, repoSlug, commitSha, 'pending', runId);
    }

    const matrixTag = matrixLabel ? ` [${matrixLabel}]` : '';
    await emitLog(`[SimpleCI] Starting pipeline${matrixTag} for run: ${runId}`);
    await emitLog(`[SimpleCI] Mode:  process (no Docker)`);
    await emitLog(`[SimpleCI] Repo:  ${repoUrl}`);
    await emitLog(`[SimpleCI] Steps: ${steps.map((s) => s.name).join(' → ')}`);
    await emitLog('');

    // ── Clone repo ────────────────────────────────────────────────
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simpleci-run-'));
    await emitLog(`[SimpleCI] Cloning ${repoUrl}...`);

    const cloneOut = await execAsync(`git clone --depth 1 ${repoUrl} ${workDir}`, { timeout: 60_000 });
    if (cloneOut.stdout) await emitLog(cloneOut.stdout);
    await emitLog(`[SimpleCI] Clone complete ✓`);

    // Set secrets as env vars
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...(secrets ?? {}),
    };

    // ── Run each step ─────────────────────────────────────────────
    for (const step of steps) {
      if (await isCancelled()) {
        await emitLog('[SimpleCI] 🚫 Run was cancelled');
        finalStatus = 'CANCELLED';
        return;
      }

      await emitLog(`\n[SimpleCI] ▶ Step: ${step.name}`);
      await emitLog(`[SimpleCI]   $ ${step.run}`);

      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn('sh', ['-c', step.run], {
            cwd: workDir!,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
          });

          child.stdout.on('data', async (chunk: Buffer) => {
            for (const line of chunk.toString().split('\n')) {
              if (line.trim()) await emitLog(line);
            }
          });
          child.stderr.on('data', async (chunk: Buffer) => {
            for (const line of chunk.toString().split('\n')) {
              if (line.trim()) await emitLog(line);
            }
          });
          child.on('close', (code: number) => {
            if (code === 0) resolve();
            else reject(new Error(`Step "${step.name}" exited with code ${code}`));
          });
          child.on('error', reject);
        });

        await emitLog(`[SimpleCI] ✓ Step passed: ${step.name}`);
      } catch (stepErr) {
        const msg = stepErr instanceof Error ? stepErr.message : String(stepErr);
        await emitLog(`[SimpleCI] ✗ Step failed: ${step.name} — ${msg}`);
        throw stepErr;  // bubble up to outer catch → FAILED
      }
    }

    await emitLog('\n[SimpleCI] ✅ Pipeline PASSED');

    // ── CD: GitHub Pages auto-deploy ────────────────────────────
    if (deployConfig && deployConfig.provider === 'github-pages') {
      // Log why we're skipping if we are
      if (!githubToken) {
        await emitLog('\n[SimpleCI] ⚠️  CD skipped: No GitHub token found (repo must be connected via OAuth login)');
      } else if (!repoOwner || !repoSlug) {
        await emitLog('\n[SimpleCI] ⚠️  CD skipped: Could not determine repo owner/name');
      } else {
        try {
          await emitLog('\n[SimpleCI] 🚀 Deploying to GitHub Pages...');
          const deployDir       = deployConfig.directory ?? '.';
          const deploySourceDir = deployDir === '.'
            ? workDir!
            : path.join(workDir!, deployDir);
          const deployBranch = deployConfig.branch ?? 'gh-pages';

          await emitLog(`[SimpleCI]   Source dir: ${deploySourceDir}`);
          await emitLog(`[SimpleCI]   Target branch: ${deployBranch}`);
          await emitLog(`[SimpleCI]   Repo: ${repoOwner}/${repoSlug}`);

          if (!fs.existsSync(deploySourceDir)) {
            await emitLog(`[SimpleCI] ⚠️  Deploy directory "${deployDir}" not found — skipping deploy`);
          } else {
            const deployWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simpleci-deploy-'));

            // Copy deploy files
            await execAsync(
              process.platform === 'win32'
                ? `xcopy "${deploySourceDir}\\*" "${deployWorkDir}\\" /E /I /Q /Y`
                : `cp -r "${deploySourceDir}/." "${deployWorkDir}/"`,
              { timeout: 30_000 },
            );
            await emitLog(`[SimpleCI]   Files copied to deploy workspace ✓`);

            // Remove .git if copied from source
            const copiedGit = path.join(deployWorkDir, '.git');
            if (fs.existsSync(copiedGit)) {
              fs.rmSync(copiedGit, { recursive: true, force: true });
            }

            // Remove .simpleci.yaml from deploy (not needed on gh-pages)
            const copiedYaml = path.join(deployWorkDir, '.simpleci.yaml');
            if (fs.existsSync(copiedYaml)) fs.unlinkSync(copiedYaml);

            // Git init, commit, force push
            const authUrl = `https://x-access-token:${githubToken}@github.com/${repoOwner}/${repoSlug}.git`;
            const gitCmds = [
              `git init`,
              `git checkout -b ${deployBranch}`,
              `git config user.email "simpleci@deploy.bot"`,
              `git config user.name "SimpleCI Deploy Bot"`,
              `git add -A`,
              // allow-empty in case nothing changed
              `git diff --cached --quiet && git commit --allow-empty -m "deploy: SimpleCI auto-deploy [run ${runId}]" || git commit -m "deploy: SimpleCI auto-deploy [run ${runId}]"`,
              `git push --force "${authUrl}" ${deployBranch}`,
            ].join(' && ');

            await execAsync(gitCmds, { cwd: deployWorkDir, timeout: 60_000 });

            await emitLog(`[SimpleCI] ✅ Deployed to GitHub Pages (${deployBranch} branch)`);
            await emitLog(`[SimpleCI] 🌐 Site: https://${repoOwner}.github.io/${repoSlug}/`);

            // Cleanup deploy work dir
            try { fs.rmSync(deployWorkDir, { recursive: true, force: true }); } catch {}
          }
        } catch (deployErr) {
          const deployMsg = deployErr instanceof Error ? deployErr.message : String(deployErr);
          await emitLog(`[SimpleCI] ⚠️  Deploy failed: ${deployMsg}`);
          await emitLog('[SimpleCI] ℹ️  CI passed but deploy failed — marking as SUCCESS (deploy is best-effort)');
        }
      }
    }

    finalStatus = 'SUCCESS';
    await prisma.run.update({
      where: { id: runId },
      data:  { status: 'SUCCESS', finishedAt: new Date() },
    });

    if (githubToken && repoOwner && repoSlug && commitSha) {
      await postCommitStatus(githubToken, repoOwner, repoSlug, commitSha, 'success', runId);
    }

  } catch (err) {
    if (await isCancelled()) {
      await emitLog('[SimpleCI] 🚫 Pipeline was cancelled');
      finalStatus = 'CANCELLED';
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    await emitLog(`\n[SimpleCI] ❌ Pipeline FAILED: ${message}`);
    finalStatus = 'FAILED';
    await prisma.run.update({
      where: { id: runId },
      data:  { status: 'FAILED', finishedAt: new Date() },
    });
    if (githubToken && repoOwner && repoSlug && commitSha) {
      await postCommitStatus(githubToken, repoOwner, repoSlug, commitSha, 'failure', runId);
    }
  } finally {
    // Cleanup workspace
    if (workDir) {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
    // Send notification (Level 5.6)
    if (notifyUrl) {
      await sendNotification(notifyUrl, {
        runId, repoName: repoName ?? repoUrl, branch: branch ?? 'unknown',
        commitSha: commitSha ?? '', status: finalStatus,
        durationMs: Date.now() - startMs, matrixLabel,
      });
    }
  }
}
