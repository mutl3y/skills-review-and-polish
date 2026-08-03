import { describe, it, expect, vi } from 'vitest';
import { createAnalysisJob } from './analysisJob';
import { batchModeWarning } from './batchTransport';

describe('createAnalysisJob', () => {
  it('returns a handle immediately without blocking on the analyze fn', async () => {
    let ran = false;
    const job = createAnalysisJob(async () => {
      ran = true;
      return [{ code: 'x', message: 'm', severity: 'info', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, analyzer: 'test' }];
    });
    // Handle returns synchronously with a processing status + jobId.
    expect(job.status).toBe('processing');
    expect(job.jobId).toMatch(/^job-/);
    const results = await job.getResults();
    expect(ran).toBe(true);
    expect(job.status).toBe('completed');
    expect(results).toHaveLength(1);
  });

  it('flags batch jobs and sets estimatedWaitMs', () => {
    const job = createAnalysisJob(async () => [], { batch: true });
    expect(job.batch).toBe(true);
    expect(job.estimatedWaitMs).toBe(300_000);
  });

  it('fires onComplete with results on success', async () => {
    const cb = vi.fn();
    const job = createAnalysisJob(async () => [{ code: 'a', message: 'b', severity: 'warning', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, analyzer: 'test' }]);
    job.onComplete(cb);
    await job.getResults();
    expect(cb).toHaveBeenCalledWith(
      [{ code: 'a', message: 'b', severity: 'warning', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, analyzer: 'test' }],
      'completed',
    );
  });

  it('marks failed status and rejects getResults on error', async () => {
    const job = createAnalysisJob(async () => { throw new Error('boom'); });
    await expect(job.getResults()).rejects.toThrow('boom');
    expect(job.status).toBe('failed');
  });

  it('cancel() transitions to cancelled and rejects', async () => {
    const job = createAnalysisJob(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return [];
    });
    job.cancel();
    expect(job.status).toBe('cancelled');
    await expect(job.getResults()).rejects.toThrow('cancelled');
  });
});

describe('batchModeWarning', () => {
  it('warns about the wait and tells the caller not to resubmit', () => {
    const w = batchModeWarning('google/gemini-2.5-flash', 300);
    expect(w).toContain('google/gemini-2.5-flash');
    expect(w).toContain('~300s');
    expect(w).toContain('Do NOT re-call analyze');
  });
});
