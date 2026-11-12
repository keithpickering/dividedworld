/**
 * The rehearsal's models (docs/plans/2026-11-11-system-rehearsal-design.md, sections 4 and 5): a factory with the
 * real `models`' signature, so the jobs' `JobDeps.models` takes it, with a cassette in front of the real adapter.
 *
 * A call is keyed on everything it sends (engine/rehearsal/cassette.ts) and the model its tier resolves to. A call the
 * cassette holds is replayed for free and writes its recorded ledger row, uncounted; a call it does not hold goes live
 * through the real factory and is saved, one JSON file per key. `offline` stops on a miss and names it; `fresh`
 * ignores what the cassette holds; `stub` never goes live and answers with the least value the schema allows.
 *
 * "Cost is a column, not a report": the cap counts the `costMicrodollars` of every row the live adapter writes, which
 * the adapter priced from the provider's own usage block. A replayed row is never counted. A stub row is priced at
 * zero: `record_model_call` takes the cost in the payload and prices nothing itself (supabase/migrations/
 * 0042_model_calls.sql: no check on `provider`), and the price table (`prices.ts`) is consulted only inside the
 * adapter, which a stub call never reaches, so provider `stub` with cost 0 is a row the database accepts as it is.
 *
 * Secrets are never read here: the live factory takes `env` and the key never passes through this file.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { callKey } from '../../engine/rehearsal/cassette.ts';
import { leastAnswer } from '../../engine/rehearsal/stub.ts';
import type { ChatRequest, CompletionRequest, ModelResult, Models } from '../../engine/system/model.ts';
import { schemaProblems } from '../../engine/system/schema.ts';
import { repair } from '../../engine/system/validate.ts';
import type { Trim } from '../../engine/system/validate.ts';
import { AnswerRejected, SchemaRefused, models as realModels } from '../../supabase/functions/_shared/models/index.ts';
import type { Env, ModelOptions } from '../../supabase/functions/_shared/models/index.ts';
import type { ModelCallRow, RecordModelCall } from '../../supabase/functions/_shared/models/ledger.ts';

export type Mode = 'record' | 'offline' | 'fresh' | 'stub';

/** `offline` met a call the cassette does not hold. */
export class CassetteMiss extends Error {
  readonly duty: string;
  readonly key: string;
  constructor(duty: string, key: string) {
    super(`the cassette holds no ${duty} call with key ${key}; the run is offline`);
    this.duty = duty;
    this.key = key;
  }
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** One call, as the report shows it. `cost` is the call's own microdollars, live or replayed. */
export interface KeptCall {
  readonly at: number;
  readonly duty: string;
  readonly staff: string | null;
  readonly key: string;
  readonly replayed: boolean;
  readonly request: ChatRequest | CompletionRequest;
  readonly value?: unknown;
  readonly error?: { readonly message: string; readonly predicate: string };
  readonly trims: readonly Trim[];
  readonly cost: number;
}

export interface Cap {
  /** Microdollars of live spend so far. */
  liveMicrodollars(): number;
  reached(): boolean;
}

export type RehearsalModels = typeof realModels & { readonly calls: readonly KeptCall[]; readonly cap: Cap };

export interface RehearsalModelsOptions {
  readonly mode: Mode;
  readonly dir: string;
  readonly cap: { readonly dollars: number };
  /** The real factory by default; a test passes a fake, since the rehearsal's tests never make a live call. */
  readonly live?: typeof realModels;
  /** The clock a kept call's `at` reads. */
  readonly now?: () => number;
  /**
   * The transport a live call goes out on: the global fetch by default, a fake in a test. The handlers pass `deps.fetch` as the models'
   * `options.fetch`, and in the rehearsal that is the feeds' cassette (`rehearsalFetch`), keyed on URL and day only; a model call sent
   * through it would get the day's first answer back. So a live call never uses `options.fetch`: the model cassette above is its record.
   */
  readonly transport?: typeof fetch;
}

interface Saved {
  readonly key: string;
  readonly kind: 'chat' | 'complete';
  readonly request: unknown;
  readonly result?: ModelResult<unknown>;
  readonly error?: { readonly message: string; readonly predicate: string };
  readonly row: ModelCallRow;
}

const fileOf = (dir: string, key: string): string => join(dir, `${key}.json`);
function load(dir: string, key: string): Saved | null {
  try { return JSON.parse(readFileSync(fileOf(dir, key), 'utf8')) as Saved; } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
function save(dir: string, saved: Saved): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(fileOf(dir, saved.key), `${JSON.stringify(saved, null, 2)}\n`);
}

const emptyRow = (duty: string, request: CompletionRequest | ChatRequest, over: Partial<ModelCallRow>): ModelCallRow => ({
  duty, staff: request.staff ?? null, provider: 'stub', model: 'stub', serviceTier: null, inputTokens: null, outputTokens: null, cacheReadTokens: null,
  cacheWrite5mTokens: null, cacheWrite1hTokens: null, gpuSeconds: null, costMicrodollars: 0, outcome: 'ok', predicate: null, trims: [], retries: 0, meeting: request.meeting ?? null, play: request.play ?? null, ...over,
});

export function rehearsalModels(o: RehearsalModelsOptions): RehearsalModels {
  const live = o.live ?? realModels;
  const now = o.now ?? Date.now;
  const transport: typeof fetch = o.transport ?? ((input, init) => globalThis.fetch(input, init));
  const calls: KeptCall[] = [];
  let liveMicro = 0;
  const cap: Cap = { liveMicrodollars: () => liveMicro, reached: () => liveMicro >= o.cap.dollars * 1e6 };

  const factory = ((env: Env, record: RecordModelCall, options: ModelOptions): Models => {
    /** One call: stub, a replay, or live through the real adapter with a counting writer of its own (so a concurrent call never reads another's row). */
    async function run<T>(kind: 'chat' | 'complete', request: ChatRequest | CompletionRequest, model: string, doLive: (m: Models) => Promise<ModelResult<T>>, doStub: () => { result: ModelResult<T>; row: ModelCallRow } | { reject: AnswerRejected; row: ModelCallRow } | { fail: Error; row: ModelCallRow }): Promise<ModelResult<T>> {
      const key = callKey(kind, request, o.mode === 'stub' ? 'stub' : model, sha256);
      const keep = (extra: Pick<KeptCall, 'replayed' | 'trims' | 'cost'> & Partial<Pick<KeptCall, 'value' | 'error'>>): void => {
        calls.push({ at: now(), duty: request.duty, staff: request.staff ?? null, key, request, ...extra });
      };
      const replayRow = (row: ModelCallRow): ModelCallRow => ({ ...row, staff: request.staff ?? null, meeting: request.meeting ?? null });

      // Before the cassette is consulted, in every mode: a held answer must not hide a schema the provider would now refuse.
      if (kind === 'chat') {
        const problems = schemaProblems((request as ChatRequest).schema);
        if (problems.length > 0) {
          const refused = new SchemaRefused(problems);
          // Named as the real factory names it (provider 'anthropic', the tier's model), so the ledger reads the same in every mode but stub.
          const where = o.mode === 'stub' ? { provider: 'stub', model: 'stub' } : { provider: 'anthropic', model };
          await record(emptyRow(request.duty, request, { ...where, outcome: 'failed', predicate: refused.predicate }));
          keep({ replayed: false, error: { message: refused.message, predicate: refused.predicate }, trims: [], cost: 0 });
          throw refused;
        }
      }

      if (o.mode === 'stub') {
        const made = doStub();
        await record(made.row);
        if ('fail' in made) {
          keep({ replayed: false, error: { message: made.fail.message, predicate: 'failed' }, trims: [], cost: 0 });
          throw made.fail;
        }
        if ('reject' in made) {
          keep({ replayed: false, error: { message: made.reject.message, predicate: made.reject.predicate }, trims: made.row.trims as Trim[], cost: 0 });
          throw made.reject;
        }
        keep({ replayed: false, value: made.result.value, trims: made.result.trims, cost: 0 });
        return made.result;
      }

      const held = o.mode === 'fresh' ? null : load(o.dir, key);
      if (held) {
        await record(replayRow(held.row));
        if (held.error) {
          keep({ replayed: true, error: held.error, trims: held.row.trims as Trim[], cost: held.row.costMicrodollars });
          throw new AnswerRejected(held.error.message, held.error.predicate);
        }
        const result = held.result as ModelResult<T>;
        keep({ replayed: true, value: result.value, trims: result.trims, cost: held.row.costMicrodollars });
        return result;
      }
      if (o.mode === 'offline') throw new CassetteMiss(request.duty, key);

      let written: ModelCallRow | undefined;
      const counting: RecordModelCall = async (row) => {
        await record(row);
        written = row;
        liveMicro += row.costMicrodollars;
      };
      try {
        const result = await doLive(live(env, counting, { ...options, fetch: transport }));
        if (written) save(o.dir, { key, kind, request, result, row: written });
        keep({ replayed: false, value: result.value, trims: result.trims, cost: result.costMicrodollars });
        return result;
      } catch (e) {
        // Only an answer the model gave and the repair refused is a fact about the request; a transport or ledger failure is not saved.
        if (e instanceof AnswerRejected && written) {
          const error = { message: e.message, predicate: e.predicate };
          save(o.dir, { key, kind, request, error, row: written });
          keep({ replayed: false, error, trims: written.trims as Trim[], cost: written.costMicrodollars });
        }
        throw e;
      }
    }

    return {
      chat(request: ChatRequest): Promise<ModelResult<unknown>> {
        return run('chat', request, options.tiers[request.tier], (m) => m.chat(request), () => {
          let value: unknown = leastAnswer(request.schema);
          let trims: readonly Trim[] = [];
          if (request.rules) {
            const fixed = repair(value, request.rules);
            trims = fixed.trims;
            if (!fixed.ok) {
              const reject = new AnswerRejected(`the answer failed ${fixed.predicate} at ${fixed.path || 'the top'}`, fixed.predicate);
              return { reject, row: emptyRow(request.duty, request, { outcome: 'rejected', predicate: fixed.predicate, trims }) };
            }
            value = fixed.value;
          }
          return { result: { value, usage: {}, provider: 'stub', model: 'stub', trims, retries: 0, costMicrodollars: 0 }, row: emptyRow(request.duty, request, { trims }) };
        });
      },
      complete(request: CompletionRequest): Promise<ModelResult<string>> {
        return run('complete', request, env('SYSTEM_COMPLETIONS_MODEL') ?? 'default', (m) => m.complete(request), () => ({
          // As production does with no completions server: the same error and a failed row, so the stock lines stand in.
          fail: new Error('SYSTEM_COMPLETIONS_URL is not set'),
          row: emptyRow(request.duty, request, { outcome: 'failed' }),
        }));
      },
    };
  }) as typeof realModels;

  return Object.assign(factory, { calls, cap });
}

/**
 * `fetch` for the meeting's feed reads: keyed on the method, the URL and the simulated day, recorded and replayed like a model
 * call, so a replay reads the same news. `stub` answers every feed with an empty body.
 */
export function rehearsalFetch(mode: Mode, dir: string, o: { readonly day: () => string; readonly live?: typeof fetch }): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    if (mode === 'stub') return new Response('', { status: 200 });
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET');
    const key = sha256(JSON.stringify({ kind: 'feed', method, url, day: o.day() }));
    const file = join(dir, `feed-${key}.json`);
    if (mode !== 'fresh') {
      try {
        const held = JSON.parse(readFileSync(file, 'utf8')) as { status: number; contentType: string | null; body: string };
        return new Response(held.body, { status: held.status, headers: held.contentType ? { 'content-type': held.contentType } : {} });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    if (mode === 'offline') throw new CassetteMiss('feed', key);
    const response = await (o.live ?? globalThis.fetch)(input, init);
    const body = await response.text();
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify({ key, url, day: o.day(), status: response.status, contentType: response.headers.get('content-type'), body }, null, 2)}\n`);
    return new Response(body, { status: response.status, headers: response.headers.get('content-type') ? { 'content-type': response.headers.get('content-type')! } : {} });
  }) as typeof fetch;
}
