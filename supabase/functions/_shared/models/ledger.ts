/**
 * The model-call ledger's writer, at the edge: a row per call, through the one SQL function that
 * writes it (supabase/migrations/0041_model_calls.sql). The service role calls it; no client can.
 * The row is camelCase here and snake_case on the wire, where the migration's columns are.
 * "Cost is a column, not a report": index.ts writes one for every call it makes, in a `finally`.
 */
import type { Db } from '../rpc.ts';

export interface ModelCallRow {
  readonly duty: string;
  readonly staff: string | null;
  readonly provider: string;
  readonly model: string;
  readonly serviceTier: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWrite5mTokens: number | null;
  readonly cacheWrite1hTokens: number | null;
  readonly gpuSeconds: number | null;
  readonly costMicrodollars: number;
  readonly outcome: 'ok' | 'rejected' | 'failed';
  /** The bound a rejection failed, or `unpriced` for a call whose model has no price. */
  readonly predicate: string | null;
  readonly trims: readonly unknown[];
  readonly retries: number;
  readonly meeting: number | null;
}

export type RecordModelCall = (row: ModelCallRow) => Promise<void>;

export function ledgerWriter(db: Db): RecordModelCall {
  return async (row) => {
    await db.rpc('record_model_call', {
      payload: {
        duty: row.duty, staff: row.staff, provider: row.provider, model: row.model, service_tier: row.serviceTier,
        input_tokens: row.inputTokens, output_tokens: row.outputTokens, cache_read_tokens: row.cacheReadTokens,
        cache_write_5m_tokens: row.cacheWrite5mTokens, cache_write_1h_tokens: row.cacheWrite1hTokens, gpu_seconds: row.gpuSeconds,
        cost_microdollars: row.costMicrodollars, outcome: row.outcome, predicate: row.predicate, trims: row.trims, retries: row.retries, meeting: row.meeting,
      },
    });
  };
}
