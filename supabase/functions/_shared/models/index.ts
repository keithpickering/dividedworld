/**
 * The one way an Edge Function calls a model: `models(env, record)` builds the `Models` the meeting and
 * the tick take (engine/system/model.ts). Every call goes through it; it picks the adapter, retries
 * a transport failure, parses and repairs the answer, and prices the call from the usage block.
 *
 * "Three unrelated timeouts are not a poison pill": a transport failure (a 5xx, a 429, a fetch
 * that threw or never answered) is retried on the request itself, waiting longer each time, at
 * most three times; a 4xx other than 429 is a fact about the request and is thrown at once. The
 * number of retries rides on the result.
 *
 * Every call, whatever its end, writes one ledger row (ledger.ts) in a `finally`: used (`ok`), an
 * answer that could not be used (`rejected`, with the predicate and the trims made before it), or
 * anything else (`failed`). A call whose ledger write fails throws: an unrecorded call is the
 * silent failure the ledger exists to prevent. If the call had failed too, its own error is the
 * thrown one's `cause`.
 *
 * Secrets come through `env`, an accessor passed in, and are never printed or put in an error.
 * A tier's model comes from the caller, which passes the instance's `modelTiers` setting; nothing
 * here names a model id as a default, so the setting is the one place a tier's model is chosen.
 */
import type { CallContext, ChatRequest, CompletionRequest, ModelResult, Models, Tier, Usage } from '../../../../engine/system/model.ts';
import { AnswerRejected } from '../../../../engine/system/model.ts';
export { AnswerRejected };
import { cutCompletion, repair } from '../../../../engine/system/validate.ts';
import type { Trim } from '../../../../engine/system/validate.ts';
import { anthropicChat } from './anthropic.ts';
import { complete as completeOverHttp } from './completions.ts';
import { PRICES, price } from './prices.ts';
import type { PriceTable } from './prices.ts';
import type { ModelCallRow, RecordModelCall } from './ledger.ts';
import { NotJson, TransportFailure } from './transport.ts';
import type { Wire } from './transport.ts';

export type Env = (name: string) => string | undefined;

export interface ModelOptions {
  /** The model each tier asks for, as the provider names it: the instance's `modelTiers` setting. */
  readonly tiers: Readonly<Record<Tier, string>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /** How long one attempt may take before it counts as never answered. */
  readonly timeoutMs?: number;
  readonly now?: () => number;
  /** Price tables by provider; the shipped ones when unset. */
  readonly prices?: Readonly<Record<string, PriceTable>>;
}

/** At most this many retries after the first attempt. */
export const MAX_RETRIES = 3;

/** The ledger could not be written; the call it was for is not trusted. */
export class LedgerWriteFailed extends Error {}

/** What a call has learned so far, which is what its row says if it ends there. */
interface Call {
  provider: string;
  model: string;
  usage: Usage;
  retries: number;
  costMicrodollars: number;
  trims: readonly Trim[];
  outcome: ModelCallRow['outcome'];
  predicate: string | null;
}

export function models(env: Env, record: RecordModelCall, options: ModelOptions): Models {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const wire: Wire = { fetch: options.fetch ?? globalThis.fetch, timeoutMs: options.timeoutMs ?? 60_000, now: options.now ?? Date.now };
  const tables = (provider: string): PriceTable | undefined => options.prices?.[provider] ?? (PRICES as Record<string, PriceTable>)[provider];

  /** One request, retried on a transport failure; the retries spent are on the call even if it fails. */
  async function withRetries<T>(call: Call, attempt: () => Promise<T>): Promise<T> {
    for (;;) {
      try {
        return await attempt();
      } catch (e) {
        // A 2xx that is not JSON was answered (and may be billed): a rejection, never a second attempt.
        if (e instanceof NotJson) throw new AnswerRejected(e.message, 'validJson');
        if (!(e instanceof TransportFailure) || call.retries >= MAX_RETRIES) throw e;
        await sleep(250 * 2 ** call.retries);
        call.retries++;
      }
    }
  }

  /** Runs one call and writes its row, whatever its end. */
  async function ledgered<T>(request: CallContext & { duty: string }, first: { provider: string; model: string }, run: (call: Call) => Promise<T>): Promise<T> {
    const call: Call = { ...first, usage: {}, retries: 0, costMicrodollars: 0, trims: [], outcome: 'failed', predicate: null };
    let failure: unknown;
    let threw = false;
    try {
      const result = await run(call);
      call.outcome = 'ok';
      return result;
    } catch (e) {
      threw = true;
      failure = e;
      if (e instanceof AnswerRejected) { call.outcome = 'rejected'; call.predicate = e.predicate; }
      throw e;
    } finally {
      const u = call.usage;
      try {
        await record({
          duty: request.duty, staff: request.staff ?? null, provider: call.provider, model: call.model, serviceTier: u.serviceTier ?? null,
          inputTokens: u.inputTokens ?? null, outputTokens: u.outputTokens ?? null, cacheReadTokens: u.cacheReadTokens ?? null,
          cacheWrite5mTokens: u.cacheWrite5mTokens ?? null, cacheWrite1hTokens: u.cacheWrite1hTokens ?? null, gpuSeconds: u.gpuSeconds ?? null,
          costMicrodollars: call.costMicrodollars, outcome: call.outcome, predicate: call.predicate, trims: call.trims, retries: call.retries, meeting: request.meeting ?? null, play: request.play ?? null,
        });
      } catch (e) {
        throw new LedgerWriteFailed(`the model call could not be recorded in the ledger: ${e instanceof Error ? e.message : String(e)}`, threw ? { cause: failure } : { cause: e });
      }
    }
  }

  /** Prices a call from its usage block, or marks it unpriced and throws naming the model. */
  function priced(call: Call, provider: string): void {
    try {
      call.costMicrodollars = price(provider, call.model, call.usage, tables(provider));
    } catch (e) {
      call.predicate = 'unpriced';
      throw e;
    }
  }

  return {
    chat(request: ChatRequest): Promise<ModelResult<unknown>> {
      const model = options.tiers[request.tier];
      return ledgered(request, { provider: 'anthropic', model }, async (call) => {
        const key = env('ANTHROPIC_API_KEY');
        if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
        const raw = await withRetries(call, () => anthropicChat(request, model, key, wire));
        call.model = raw.model;
        call.usage = raw.usage;
        priced(call, 'anthropic');
        if (raw.stopReason === 'refusal') throw new AnswerRejected('the model refused', 'refusal');
        let parsed: unknown;
        try { parsed = JSON.parse(raw.text); } catch { throw new AnswerRejected(raw.stopReason === 'max_tokens' ? 'the answer was cut off by its token cap' : 'the answer is not JSON', 'validJson'); }
        if (request.rules) {
          const fixed = repair(parsed, request.rules);
          call.trims = fixed.trims;
          if (!fixed.ok) throw new AnswerRejected(`the answer failed ${fixed.predicate} at ${fixed.path || 'the top'}`, fixed.predicate);
          parsed = fixed.value;
        }
        return { value: parsed, usage: raw.usage, provider: 'anthropic', model: raw.model, trims: call.trims, retries: call.retries, costMicrodollars: call.costMicrodollars };
      });
    },

    complete(request: CompletionRequest): Promise<ModelResult<string>> {
      return ledgered(request, { provider: 'completions', model: 'self-hosted' }, async (call) => {
        const url = env('SYSTEM_COMPLETIONS_URL');
        if (!url) throw new Error('SYSTEM_COMPLETIONS_URL is not set');
        const raw = await withRetries(call, () => completeOverHttp(request, url, env('SYSTEM_COMPLETIONS_KEY') || undefined, env('SYSTEM_COMPLETIONS_MODEL') ?? 'default', wire));
        call.model = raw.model;
        call.usage = raw.usage;
        priced(call, 'completions');
        const cut = cutCompletion(raw.text, request.stop, request.maxChars ?? request.maxTokens * 6, request.lines);
        if (!cut.ok) throw new AnswerRejected('the completion is empty', cut.predicate);
        call.trims = cut.trims;
        return { value: cut.text, usage: raw.usage, provider: 'completions', model: raw.model, trims: cut.trims, retries: call.retries, costMicrodollars: call.costMicrodollars };
      });
    },
  };
}
