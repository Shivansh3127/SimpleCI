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
    steps: PipelineStep[];
  };
}

/**
 * Reads and parses the .simpleci.yaml file from a cloned repository.
 *
 * @param repoDir - The local path where the repo was cloned
 * @returns Parsed pipeline config, or null if file doesn't exist
 */
export function parsePipelineConfig(repoDir: string): PipelineConfig | null {
  const configPath = path.join(repoDir, '.simpleci.yaml');

  if (!fs.existsSync(configPath)) {
    return null;
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = yaml.load(raw) as PipelineConfig;
  return parsed;
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
