import { describe, expect, it } from 'vitest';

import { getJobnibBatchDownloadUrl } from './results';

describe('Jobnib progress downloads', () => {
  it('includes checkpointed chapters by default', () => {
    expect(getJobnibBatchDownloadUrl('batch/1')).toBe(
      'http://localhost:8000/api/results/jobnib-batch/batch%2F1/download?include_partial=true',
    );
  });

  it('can still request a completed-only run archive', () => {
    expect(getJobnibBatchDownloadUrl('deadbeef', 'run 1', false)).toBe(
      'http://localhost:8000/api/results/jobnib-batch/deadbeef/download?run_id=run+1',
    );
  });
});
