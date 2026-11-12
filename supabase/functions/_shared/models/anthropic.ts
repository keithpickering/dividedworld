/**
 * Chat over the Anthropic Messages API, with `fetch` alone. One attempt: index.ts retries.
 *
 * Structured output is the API's JSON-schema feature (`output_config.format`), whose answer is a
 * text block holding the JSON. No sampling parameters are sent (current models refuse them) and no
 * `thinking`. The usage block is read as reported, and `service_tier` in it is what was billed.
 * Model ids, the request form and the usage fields were read from the claude-api skill on
 * 2026-10-31. Parsing and repairing the answer is index.ts's, so a ledger row can say which.
 */
import type { ChatRequest, Usage } from '../../../../engine/system/model.ts';
import { postJson } from './transport.ts';
import type { Wire } from './transport.ts';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export interface RawChat {
  readonly text: string;
  readonly stopReason: string;
  readonly model: string;
  readonly usage: Usage;
}

export async function anthropicChat(request: ChatRequest, model: string, apiKey: string, wire: Wire): Promise<RawChat> {
  // `cachePrefix`: the system prompt and the first message are one cacheable prefix, the same in the calls that follow.
  const mark = { cache_control: { type: 'ephemeral' } } as const;
  const body = {
    model,
    max_tokens: request.maxTokens,
    system: request.cachePrefix ? [{ type: 'text', text: request.system, ...mark }] : request.system,
    messages: request.messages.map((m, i) => ({ role: m.role, content: request.cachePrefix && i === 0 ? [{ type: 'text', text: m.content, ...mark }] : m.content })),
    output_config: { format: { type: 'json_schema', schema: request.schema } },
  };
  const answer = (await postJson(ANTHROPIC_URL, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body, wire)) as {
    model?: string;
    stop_reason?: string;
    content?: { type: string; text?: string }[];
    usage?: Record<string, any>;
  } | null;
  const u = answer?.usage ?? {};
  const cache = u.cache_creation as { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | undefined;
  const usage: Usage = {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    // A block without the split reports one total of creation tokens, which are 5-minute writes.
    cacheWrite5mTokens: cache?.ephemeral_5m_input_tokens ?? u.cache_creation_input_tokens ?? 0,
    cacheWrite1hTokens: cache?.ephemeral_1h_input_tokens ?? 0,
    serviceTier: u.service_tier,
  };
  const text = (answer?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  return { text, stopReason: answer?.stop_reason ?? '', model: answer?.model ?? model, usage };
}
