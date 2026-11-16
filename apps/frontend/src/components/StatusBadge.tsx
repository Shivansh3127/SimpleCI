import type { Run } from '../types';

interface Props {
  status: Run['status'];
}

const labels: Record<Run['status'], string> = {
  QUEUED:    'Queued',
  RUNNING:   'Running',
  SUCCESS:   'Success',
  FAILED:    'Failed',
  CANCELLED: 'Cancelled',
};

const classes: Record<Run['status'], string> = {
  QUEUED:    'badge badge-queued',
  RUNNING:   'badge badge-running',
  SUCCESS:   'badge badge-success',
  FAILED:    'badge badge-failed',
  CANCELLED: 'badge badge-cancelled',
};

export default function StatusBadge({ status }: Props) {
  return (
    <span className={classes[status]}>
      <span className={`badge-dot${status === 'RUNNING' ? ' pulse' : ''}`} />
      {labels[status]}
    </span>
  );
}
