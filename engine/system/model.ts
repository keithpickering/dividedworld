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
import type { Rule, Trim } from './validate.ts';

/** The tier an instance maps to a model: a setting per tier, not a model id in the engine. */
export type Tier = 'strong' | 'light';

export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** Who is asking, for the call's ledger row: the staff member the duty belongs to, and the meeting it was made in. */
export interface CallContext {
  readonly staff?: string;
  readonly meeting?: number;
  /** The card play a call was made for (a card that writes, `CardRules.writes`), for its ledger row; not a staff member or a meeting. */
  readonly play?: string;
}

export interface ChatRequest extends CallContext {
  readonly duty: Duty;
  readonly tier: Tier;
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  /** A JSON schema the answer must follow: structured output. */
  readonly schema: Readonly<Record<string, unknown>>;
  /** The bounds a provider's schema cannot express; the answer is repaired against them (validate.ts) and the trims recorded. */
  readonly rules?: Rule;
  readonly maxTokens: number;
  /** The system prompt and the first message are the same in the calls that follow (a meeting's parts): a provider that caches marks them. One without caching ignores it. */
  readonly cachePrefix?: boolean;
}

export interface CompletionRequest extends CallContext {
  /** A staff duty, or `cardText`: the text a card that writes generates, which is no staff member's work (`DUTIES` stays staff work only). */
  readonly duty: Duty | 'cardText';
  readonly prompt: string;
  readonly temperature: number;
  readonly topP: number;
  readonly stop: readonly string[];
  readonly maxTokens: number;
  /** The most characters kept; a completion's length is capped after the fact (cutCompletion). Six a token when unset. */
  readonly maxChars?: number;
  /** `'many'` keeps the answer's newlines (a text continued over several lines); `'one'`, cut at the first, when unset. */
  readonly lines?: 'one' | 'many';
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
  /** Transport failures retried before this answer came. */
  readonly retries: number;
  /** What the call cost, in whole microdollars, priced from `usage` as reported. */
  readonly costMicrodollars: number;
}

export interface Models {
  /** The answer is parsed JSON; a caller repairs it against its own rules (validate.ts). */
  chat(request: ChatRequest): Promise<ModelResult<unknown>>;
  complete(request: CompletionRequest): Promise<ModelResult<string>>;
}

/** An answer that could not be used: the provider refused, it was not JSON, or a bound could not be repaired. */
export class AnswerRejected extends Error {
  readonly predicate: string;
  constructor(message: string, predicate: string) {
    super(message);
    this.predicate = predicate;
  }
}

/**
 * A request whose schema the provider would refuse (engine/system/schema.ts), caught before anything is sent, in every mode.
 * It is an `AnswerRejected` so a caller that already handles a call with no usable answer handles this one; the model layer
 * writes its row as `failed`, not `rejected`, because nothing was asked and nothing was paid for. Its predicate is the first
 * problem's (`keyword(maxItems)`), and its message names where.
 */
export class SchemaRefused extends AnswerRejected {
  readonly problems: readonly { readonly path: string; readonly predicate: string }[];
  constructor(problems: readonly { readonly path: string; readonly predicate: string }[]) {
    const first = problems[0]!;
    super(`the schema is refused: ${first.predicate.replace(/^keyword\((.*)\)$/, '$1')} at ${first.path || 'the top'}`, first.predicate);
    this.problems = problems;
  }
}
