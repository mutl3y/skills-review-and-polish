/**
 * Deferred analysis job handle (B1 batch design).
 *
 * The analyzer's `analyze()` is synchronous — it awaits every wave's
 * `provider.complete()` before returning. For batch (slow) mode, that means a
 * ~5-minute block on the caller's thread, which breaks the MCP protocol's 60s
 * client timeout and freezes the UI. `AnalysisJob` decouples submission from
 * completion: `analyzeDeferred()` returns immediately with a job handle while
 * the real `analyze()` runs in the background. Callers poll `getResults()` (or
 * register `onComplete`) and never block on the batch duration.
 *
 * @module analysisJob
 */

import { AnalysisResult } from './types';

export type AnalysisJobStatus = 'processing' | 'completed' | 'failed' | 'cancelled';

export interface AnalysisJob {
  /** Unique job id (timestamp + random) — used by MCP get_analysis_result. */
  jobId: string;
  /** Current lifecycle state. */
  status: AnalysisJobStatus;
  /** Epoch ms when the job was submitted. */
  submittedAt: number;
  /** Estimated completion wait in ms (best-effort, e.g. 300_000 for batch). */
  estimatedWaitMs?: number;
  /** True when the job was submitted in batch (slow) mode. */
  batch: boolean;
  /** Resolve with the analysis results once complete. */
  getResults(): Promise<AnalysisResult[]>;
  /** Register a callback fired when the job completes or fails. */
  onComplete(cb: (result: AnalysisResult[] | undefined, status: AnalysisJobStatus) => void): void;
  /** Request cancellation. Best-effort: stops awaiting; in-flight batch jobs are left to expire. */
  cancel(): void;
}

/**
 * Create a deferred job that runs `runAnalyze` in the background.
 *
 * @param runAnalyze  The (blocking) analysis function, e.g. `() => engine.analyze(input, ...)`.
 * @param opts.batch  Whether this job uses batch (slow) mode.
 * @param opts.estimatedWaitMs  Best-effort completion estimate (default 300_000 for batch).
 */
export function createAnalysisJob(
  runAnalyze: () => Promise<AnalysisResult[]>,
  opts: { batch?: boolean; estimatedWaitMs?: number } = {},
): AnalysisJob {
  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const batch = opts.batch ?? false;
  const estimatedWaitMs = opts.estimatedWaitMs ?? (batch ? 300_000 : undefined);

  let resolveResults!: (r: AnalysisResult[]) => void;
  let rejectResults!: (e: unknown) => void;
  const done = new Promise<AnalysisResult[]>((res, rej) => {
    resolveResults = res;
    rejectResults = rej;
  });

  const job: AnalysisJob = {
    jobId,
    status: 'processing',
    submittedAt: Date.now(),
    estimatedWaitMs,
    batch,
    getResults: () => done,
    onComplete: (cb) => {
      done
        .then((r) => cb(r, 'completed'))
        .catch(() => cb(undefined, 'failed'));
    },
    cancel: () => {
      if (job.status === 'processing') {
        job.status = 'cancelled';
        rejectResults(new Error('Analysis job cancelled'));
      }
    },
  };

  // Run in the background — do NOT await on the caller's thread.
  void (async () => {
    try {
      const results = await runAnalyze();
      if (job.status === 'cancelled') return;
      job.status = 'completed';
      resolveResults(results);
    } catch (e) {
      if (job.status === 'cancelled') return;
      job.status = 'failed';
      rejectResults(e);
    }
  })();

  return job;
}
