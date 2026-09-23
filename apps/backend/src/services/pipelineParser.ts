import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Shape of one step in the pipeline YAML
export interface PipelineStep {
  name: string;
  run: string;
}

// Shape of the full .simpleci.yaml file
export interface PipelineConfig {
  pipeline: {
    name: string;
    // Optional: list of branches that should trigger CI.
    // If absent or empty, ALL branches trigger CI.
    branches?: string[];
    steps: PipelineStep[];
  };
}

/**
 * Reads and parses the .simpleci.yaml file from a cloned repository directory.
 * Returns null if the file does not exist or is malformed.
 *
 * @param repoDir - The local path where the repo was cloned
 */
export function parsePipelineConfig(repoDir: string): PipelineConfig | null {
  const configPath = path.join(repoDir, '.simpleci.yaml');

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = yaml.load(raw) as PipelineConfig;

    // Basic validation — must have at least one step
    if (!parsed?.pipeline?.steps?.length) {
      console.warn('[Parser] .simpleci.yaml has no steps — using defaults');
      return null;
    }

    return parsed;
  } catch (err) {
    console.warn('[Parser] Failed to parse .simpleci.yaml — using defaults:', err);
    return null;
  }
}

/**
 * Given a parsed PipelineConfig, returns the list of branches that should
 * trigger CI. An absent or empty branches list means "all branches".
 *
 * @param config - Parsed PipelineConfig (can be null)
 */
export function getAllowedBranches(config: PipelineConfig | null): string[] {
  return config?.pipeline?.branches ?? [];
}

/**
 * Returns true if the given branch should trigger a pipeline run.
 * If no branch filter is configured, all branches are allowed.
 *
 * @param branch        - The branch name from the push event (e.g. "main")
 * @param allowedBranches - From getAllowedBranches() — empty means "all"
 */
export function isBranchAllowed(branch: string, allowedBranches: string[]): boolean {
  if (allowedBranches.length === 0) return true; // no filter — allow all
  return allowedBranches.includes(branch);
}

/**
 * Returns default pipeline steps if .simpleci.yaml is not found.
 * This is a sensible fallback for Node.js projects.
 */
export function getDefaultSteps(): PipelineStep[] {
  return [
    { name: 'Install Dependencies', run: 'npm install' },
    { name: 'Run Tests', run: 'npm test' },
    { name: 'Build', run: 'npm run build' },
  ];
}

