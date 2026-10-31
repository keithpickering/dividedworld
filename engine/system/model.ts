/**
 * The provider-neutral model interface (docs/plans/2026-10-30-the-system-design.md, section 6).
 *
 * Two modes: chat with structured output, which carries the meeting, the micro-events, the rename
 * judge and appeals; and raw completion, the OpenAI-compatible shape a self-hosted open-weights
 * server speaks. The meeting and the tick take a `Models` as a parameter, so a test passes a fake
 * and an instance can swap its provider, or switch The System off ("Portable by construction").
 * Nothing here names a vendor: the adapters live at the edge (supabase/functions/_shared/models/).
 *
 * `Usage` is the provider's own usage block, as reported ("Cost is a column, not a report"): the
 * tier it reports is the authority on what was billed, whatever the request asked for.
 */
import type { Duty } from './duties.ts';
import type { Trim } from './validate.ts';

/** The tier an instance maps to a model: a setting per tier, not a model id in the engine. */
export type Tier = 'strong' | 'light';

export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ChatRequest {
  readonly duty: Duty;
  readonly tier: Tier;
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  /** A JSON schema the answer must follow: structured output. */
  readonly schema: Readonly<Record<string, unknown>>;
  readonly maxTokens: number;
}

export interface CompletionRequest {
  readonly duty: Duty;
  readonly prompt: string;
  readonly temperature: number;
  readonly topP: number;
  readonly stop: readonly string[];
  readonly maxTokens: number;
}

/** What a provider reported, each field as it reported it; a field it did not report is absent. */
export interface Usage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  /** Cache writes by lifetime; a provider that does not split them reports one total in `cacheWrite5mTokens`. */
  readonly cacheWrite5mTokens?: number;
  readonly cacheWrite1hTokens?: number;
  /** The tier the usage block says was billed. */
  readonly serviceTier?: string;
  readonly gpuSeconds?: number;
}

export interface ModelResult<T> {
  readonly value: T;
  readonly usage: Usage;
  readonly provider: string;
  readonly model: string;
  /** Every bound the call's answer was trimmed to ("A validator tighter than the schema…"). */
  readonly trims: readonly Trim[];
}

export interface Models {
  /** The answer is parsed JSON; a caller repairs it against its own rules (validate.ts). */
  chat(request: ChatRequest): Promise<ModelResult<unknown>>;
  complete(request: CompletionRequest): Promise<ModelResult<string>>;
}
