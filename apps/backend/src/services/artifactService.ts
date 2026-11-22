/**
 * artifactService.ts — Level 5.2
 *
 * Local filesystem artifact storage.
 * Artifacts are stored under ARTIFACTS_DIR (default: <project root>/artifacts/).
 * The backend serves them via GET /runs/:runId/artifacts (pre-signed URL = direct path).
 *
 * This is a self-contained, zero-dependency implementation — no MinIO/S3 needed.
 * The interface is identical to what an S3 implementation would expose, so it can
 * be swapped to MinIO/S3 later by just replacing this file.
 *
 * Directory structure:
 *   artifacts/
 *     runs/
 *       <runId>/
 *         artifact-<timestamp>.tar
 */
import fs   from 'fs';
import path from 'path';

// Resolve artifacts dir relative to the project root (two levels up from src/)
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR
  ?? path.resolve(process.cwd(), '..', '..', 'artifacts');

/** Ensure the directory for a run's artifacts exists. */
function ensureRunDir(runId: string): string {
  const dir = path.join(ARTIFACTS_DIR, 'runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * "Upload" (copy) a local file into the artifact store.
 * Returns a key string — in this implementation it's the relative path from ARTIFACTS_DIR.
 */
export async function uploadArtifact(
  runId:     string,
  localPath: string,
): Promise<string> {
  const runDir  = ensureRunDir(runId);
  const filename = path.basename(localPath);
  const dest    = path.join(runDir, filename);

  fs.copyFileSync(localPath, dest);

  // Key is relative: "runs/<runId>/<filename>"
  return `runs/${runId}/${filename}`;
}

/**
 * Returns the absolute path of an artifact from its key.
 * Used by the artifacts API to serve the file.
 */
export function getArtifactPath(key: string): string {
  return path.join(ARTIFACTS_DIR, key);
}

/**
 * List all artifact keys for a run.
 */
export async function listArtifacts(runId: string): Promise<string[]> {
  const runDir = path.join(ARTIFACTS_DIR, 'runs', runId);
  if (!fs.existsSync(runDir)) return [];
  return fs.readdirSync(runDir).map((f) => `runs/${runId}/${f}`);
}
