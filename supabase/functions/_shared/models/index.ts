/**
 * The one way an Edge Function calls a model: `models(env)` builds the `Models` the meeting and
 * the tick take (engine/system/model.ts). Every call goes through it; it picks the adapter, retries
 * a transport failure, parses and repairs the answer, and prices the call from the usage block.
 *
 * "Three unrelated timeouts are not a poison pill": a transport failure (a 5xx, a 429, a fetch
 * that threw or never answered) is retried on the request itself, waiting longer each time, at
 * most three times; a 4xx other than 429 is a fact about the request and is thrown at once. The
 * number of retries rides on the result.
 *
 * Secrets come through `env`, an accessor passed in, and are never printed or put in an error.
 * A tier's model is an environment value for now (SYSTEM_MODEL_STRONG, SYSTEM_MODEL_LIGHT); the
 * instance setting that replaces it arrives with the system's settings.
 */
import type { ChatRequest, CompletionRequest, ModelResult, Models, Tier, Usage } from '../../../../engine/system/model.ts';
import { cutCompletion, repair } from '../../../../engine/system/validate.ts';
import type { Trim } from '../../../../engine/system/validate.ts';
import { anthropicChat } from './anthropic.ts';
import { complete as completeOverHttp } from './completions.ts';
import { PRICES, price } from './prices.ts';
import type { PriceTable } from './prices.ts';
import { TransportFailure } from './transport.ts';
import type { Wire } from './transport.ts';

export type Env = (name: string) => string | undefined;

export interface ModelOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /** How long one attempt may take before it counts as never answered. */
  readonly timeoutMs?: number;
  readonly now?: () => number;
  /** Price tables by provider; the shipped ones when unset. */
  readonly prices?: Readonly<Record<string, PriceTable>>;
}

const DEFAULT_MODELS: Record<Tier, string> = { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' };
/** At most this many retries after the first attempt. */
export const MAX_RETRIES = 3;

/** An answer that could not be used: the provider refused, or it was not JSON, or a bound could not be repaired. */
export class AnswerRejected extends Error {
  readonly predicate: string;
  readonly usage: Usage;
  readonly model: string;
  readonly retries: number;
  readonly costMicrodollars: number;
  constructor(message: string, predicate: string, call: { usage: Usage; model: string; retries: number; costMicrodollars: number }) {
    super(message);
    this.predicate = predicate;
    this.usage = call.usage;
    this.model = call.model;
    this.retries = call.retries;
    this.costMicrodollars = call.costMicrodollars;
  }
}

export function models(env: Env, options: ModelOptions = {}): Models {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const wire: Wire = { fetch: options.fetch ?? globalThis.fetch, timeoutMs: options.timeoutMs ?? 60_000, now: options.now ?? Date.now };
  const tables = (provider: string): PriceTable | undefined => options.prices?.[provider] ?? (PRICES as Record<string, PriceTable>)[provider];

  /** One request, retried on a transport failure. */
  async function withRetries<T>(attempt: () => Promise<T>): Promise<{ result: T; retries: number }> {
    for (let retries = 0; ; retries++) {
      try {
        return { result: await attempt(), retries };
      } catch (e) {
        if (!(e instanceof TransportFailure) || retries >= MAX_RETRIES) throw e;
        await sleep(250 * 2 ** retries);
      }
    }
  }

  return {
    async chat(request: ChatRequest): Promise<ModelResult<unknown>> {
      const key = env('ANTHROPIC_API_KEY');
      if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
      const model = env(request.tier === 'strong' ? 'SYSTEM_MODEL_STRONG' : 'SYSTEM_MODEL_LIGHT') ?? DEFAULT_MODELS[request.tier];
      const { result: raw, retries } = await withRetries(() => anthropicChat(request, model, key, wire));
      const costMicrodollars = price('anthropic', raw.model, raw.usage, tables('anthropic'));
      const call = { usage: raw.usage, model: raw.model, retries, costMicrodollars };
      if (raw.stopReason === 'refusal') throw new AnswerRejected('the model refused', 'refusal', call);
      let parsed: unknown;
      try { parsed = JSON.parse(raw.text); } catch { throw new AnswerRejected(raw.stopReason === 'max_tokens' ? 'the answer was cut off by its token cap' : 'the answer is not JSON', 'validJson', call); }
      let trims: readonly Trim[] = [];
      if (request.rules) {
        const fixed = repair(parsed, request.rules);
        if (!fixed.ok) throw new AnswerRejected(`the answer failed ${fixed.predicate} at ${fixed.path || 'the top'}`, fixed.predicate, call);
        parsed = fixed.value;
        trims = fixed.trims;
      }
      return { value: parsed, usage: raw.usage, provider: 'anthropic', model: raw.model, trims, retries, costMicrodollars };
    },

    async complete(request: CompletionRequest): Promise<ModelResult<string>> {
      const url = env('SYSTEM_COMPLETIONS_URL');
      if (!url) throw new Error('SYSTEM_COMPLETIONS_URL is not set');
      const { result: raw, retries } = await withRetries(() => completeOverHttp(request, url, env('SYSTEM_COMPLETIONS_KEY') || undefined, env('SYSTEM_COMPLETIONS_MODEL') ?? 'default', wire));
      const costMicrodollars = price('completions', raw.model, raw.usage, tables('completions'));
      const call = { usage: raw.usage, model: raw.model, retries, costMicrodollars };
      const cut = cutCompletion(raw.text, request.stop, request.maxChars ?? request.maxTokens * 6);
      if (!cut.ok) throw new AnswerRejected('the completion is empty', cut.predicate, call);
      return { value: cut.text, usage: raw.usage, provider: 'completions', model: raw.model, trims: cut.trims, retries, costMicrodollars };
    },
  };
}
