import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Shape of one step in the pipeline YAML
export interface PipelineStep {
  name: string;
  run:  string;
}

// Level 5.3 — matrix definition
export interface MatrixConfig {
  [key: string]: (string | number)[];
  // e.g. { node: [18, 20, 22] }  or  { python: ['3.10', '3.12'] }
}

// Shape of the full .simpleci.yaml file
export interface PipelineConfig {
  pipeline: {
    name:      string;
    // Level 5.1: custom Docker image — if absent, defaults to node:20-alpine
    image?:    string;
    // Optional: list of branches that should trigger CI.
    // If absent or empty, ALL branches trigger CI.
    branches?: string[];
    // Level 5.3: matrix builds
    matrix?:   MatrixConfig;
    // Level 5.2: artifact paths to upload after success
    artifacts?: string[];
    steps:     PipelineStep[];
  };
}

/**
 * Reads and parses the .simpleci.yaml file from a cloned repository directory.
 * Returns null if the file does not exist or is malformed.
 */
export function parsePipelineConfig(repoDir: string): PipelineConfig | null {
  const configPath = path.join(repoDir, '.simpleci.yaml');

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const raw    = fs.readFileSync(configPath, 'utf-8');
    const parsed = yaml.load(raw) as PipelineConfig;

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

/** Returns the Docker image to use for this pipeline. */
export function getDockerImage(config: PipelineConfig | null): string {
  return config?.pipeline?.image ?? 'node:20-alpine';
}

/** Returns artifact paths declared in the config. */
export function getArtifactPaths(config: PipelineConfig | null): string[] {
  return config?.pipeline?.artifacts ?? [];
}

/**
 * Expands a matrix config into an array of label→value maps.
 * e.g. { node: [18, 20] } → [{ node: '18' }, { node: '20' }]
 * Only the first matrix key is used (single-axis matrix for now).
 */
export function expandMatrix(config: PipelineConfig | null): Array<Record<string, string>> | null {
  const matrix = config?.pipeline?.matrix;
  if (!matrix) return null;

  const keys = Object.keys(matrix);
  if (keys.length === 0) return null;

  // Single-axis expansion (most common use case)
  const key    = keys[0];
  const values = matrix[key];
  return values.map((v) => ({ [key]: String(v) }));
}

export function getAllowedBranches(config: PipelineConfig | null): string[] {
  return config?.pipeline?.branches ?? [];
}

export function isBranchAllowed(branch: string, allowedBranches: string[]): boolean {
  if (allowedBranches.length === 0) return true;
  return allowedBranches.includes(branch);
}

export function getDefaultSteps(): PipelineStep[] {
  return [
    { name: 'Install Dependencies', run: 'npm install' },
    { name: 'Run Tests',            run: 'npm test'    },
    { name: 'Build',                run: 'npm run build' },
  ];
}
