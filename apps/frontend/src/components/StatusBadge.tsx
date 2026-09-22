import type { Run } from '../types';

interface Props {
  status: Run['status'];
}

const labels = {
  RUNNING: 'Running',
  SUCCESS: 'Success',
  FAILED:  'Failed',
};

const classes = {
  RUNNING: 'badge badge-running',
  SUCCESS: 'badge badge-success',
  FAILED:  'badge badge-failed',
};

export default function StatusBadge({ status }: Props) {
  return (
    <span className={classes[status]}>
      <span className={`badge-dot${status === 'RUNNING' ? ' pulse' : ''}`} />
      {labels[status]}
    </span>
  );
}
