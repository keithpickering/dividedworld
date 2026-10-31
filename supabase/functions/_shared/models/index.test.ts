import { test } from 'node:test';
import assert from 'node:assert/strict';
import { models } from './index.ts';
import { PRICES } from './prices.ts';
import { ProviderRefusal, TransportFailure } from './transport.ts';

type Reply = Response | Error | 'hang';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const message = (text: string, usage: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => json({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }],
  usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, service_tier: 'standard', ...usage },
  ...extra,
});
/** A fake fetch that plays its replies in order; 'hang' never answers until the request's signal aborts it. */
function fake(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    if (next === 'hang') return await new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    if (next instanceof Error) throw next;
    return next.clone();
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}
const secrets: Record<string, string> = { ANTHROPIC_API_KEY: 'sk-test', SYSTEM_COMPLETIONS_URL: 'https://old.example', SYSTEM_COMPLETIONS_KEY: 'ck-test' };
const env = (name: string) => secrets[name];
const chat = { duty: 'microEvent', tier: 'light', system: 'You are the Director.', messages: [{ role: 'user', content: 'Go.' }], schema: { type: 'object' }, maxTokens: 300 } as const;

test('chat asks the Messages API for structured output, with the key in a header and no sampling parameters', async () => {
  const f = fake([message('{"line":"hi"}')]);
  const r = await models(env, { fetch: f.fetch, sleep: async () => {} }).chat(chat);
  assert.equal(f.calls[0]?.url, 'https://api.anthropic.com/v1/messages');
  const headers = new Headers(f.calls[0]?.init.headers);
  assert.equal(headers.get('x-api-key'), 'sk-test');
  assert.equal(headers.get('anthropic-version'), '2023-06-01');
  const body = JSON.parse(String(f.calls[0]?.init.body));
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.equal(body.max_tokens, 300);
  assert.equal(body.system, 'You are the Director.');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Go.' }]);
  assert.deepEqual(body.output_config, { format: { type: 'json_schema', schema: { type: 'object' } } });
  for (const k of ['temperature', 'top_p', 'top_k', 'thinking']) assert.equal(k in body, false, k);
  assert.deepEqual(r.value, { line: 'hi' });
  assert.equal(r.provider, 'anthropic');
  assert.equal(r.model, 'claude-haiku-5-5');
  assert.equal(r.costMicrodollars, 350);
  assert.equal(r.retries, 0);
  assert.deepEqual(r.usage, { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, serviceTier: 'standard' });
});

test('the strong tier asks for the strong model; a tier\'s model is an environment setting', async () => {
  const f = fake([message('{}', {}, { model: 'claude-opus-5-5' })]);
  await models(env, { fetch: f.fetch, sleep: async () => {} }).chat({ ...chat, tier: 'strong' });
  assert.equal(JSON.parse(String(f.calls[0]?.init.body)).model, 'claude-opus-5-5');
  const g = fake([message('{}', {}, { model: 'claude-sonnet-5-5' })]);
  await models((n) => (n === 'SYSTEM_MODEL_LIGHT' ? 'claude-sonnet-5-5' : env(n)), { fetch: g.fetch, sleep: async () => {} }).chat(chat);
  assert.equal(JSON.parse(String(g.calls[0]?.init.body)).model, 'claude-sonnet-5-5');
});

test('a usage block that reports priority is priced from the priority row even though the request asked for standard', async () => {
  const table = { ...PRICES.anthropic, models: { 'claude-haiku-5-5': { tiers: {
    standard: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2 },
    priority: { input: 0.2, output: 1, cacheRead: 0.02, cacheWrite5m: 0.25, cacheWrite1h: 0.4 },
  } } } };
  const f = fake([message('{}', { service_tier: 'priority' })]);
  const r = await models(env, { fetch: f.fetch, sleep: async () => {}, prices: { anthropic: table } as never }).chat(chat);
  assert.equal(r.usage.serviceTier, 'priority');
  assert.equal(r.costMicrodollars, 200 + 500);
});

test('a model missing from the shipped table throws naming it, as does a priority usage block', async () => {
  await assert.rejects(models(env, { fetch: fake([message('{}', {}, { model: 'claude-mystery-9' })]).fetch, sleep: async () => {} }).chat(chat), /claude-mystery-9/);
  await assert.rejects(models(env, { fetch: fake([message('{}', { service_tier: 'priority' })]).fetch, sleep: async () => {} }).chat(chat), /priority/);
});

test('a completion goes to the instance\'s /v1/completions, cut at its stop, priced at zero', async () => {
  const f = fake([json({ choices: [{ text: ' The Director sighs.\nAnd more' }], usage: { prompt_tokens: 12, completion_tokens: 7 } })]);
  const r = await models(env, { fetch: f.fetch, sleep: async () => {}, now: () => 0 }).complete({ duty: 'standingOrderLine', prompt: 'Line:', temperature: 0.9, topP: 0.95, stop: ['\n\n'], maxTokens: 40 });
  assert.equal(f.calls[0]?.url, 'https://old.example/v1/completions');
  assert.equal(new Headers(f.calls[0]?.init.headers).get('authorization'), 'Bearer ck-test');
  assert.deepEqual(JSON.parse(String(f.calls[0]?.init.body)), { model: 'default', prompt: 'Line:', temperature: 0.9, top_p: 0.95, stop: ['\n\n'], max_tokens: 40 });
  assert.equal(r.value, 'The Director sighs.');
  assert.equal(r.provider, 'completions');
  assert.equal(r.costMicrodollars, 0);
  assert.equal(r.usage.inputTokens, 12);
  assert.equal(r.usage.outputTokens, 7);
});

test('a completions server that reports no usage gets token counts from the text and GPU seconds from wall time; with no key set, no bearer is sent', async () => {
  const f = fake([json({ choices: [{ text: 'Four words right here' }] })]);
  let clock = 1000;
  const only = (n: string) => (n === 'SYSTEM_COMPLETIONS_URL' ? 'https://old.example/' : undefined);
  const slowFetch = (async (u: string, i: RequestInit) => { clock += 2500; return f.fetch(u, i); }) as unknown as typeof globalThis.fetch;
  const r = await models(only, { fetch: slowFetch, sleep: async () => {}, now: () => clock }).complete({ duty: 'standingOrderLine', prompt: 'a b c', temperature: 1, topP: 1, stop: [], maxTokens: 40 });
  assert.equal(new Headers(f.calls[0]?.init.headers).has('authorization'), false);
  assert.equal(f.calls[0]?.url, 'https://old.example/v1/completions');
  assert.equal(r.usage.gpuSeconds, 2.5);
  assert.ok((r.usage.outputTokens ?? 0) > 0 && (r.usage.inputTokens ?? 0) > 0);
  assert.equal(r.costMicrodollars, 0);
  await assert.rejects(models(() => undefined, { fetch: f.fetch }).complete({ duty: 'standingOrderLine', prompt: 'x', temperature: 1, topP: 1, stop: [], maxTokens: 4 }), /SYSTEM_COMPLETIONS_URL/);
});

test('a 503 then a 200 is one call with one retry recorded, after a wait', async () => {
  const f = fake([json({ error: 'overloaded' }, 503), message('{"ok":true}')]);
  const waits: number[] = [];
  const r = await models(env, { fetch: f.fetch, sleep: async (ms) => { waits.push(ms); } }).chat(chat);
  assert.equal(f.calls.length, 2);
  assert.equal(r.retries, 1);
  assert.deepEqual(waits, [250]);
});

test('a 429 and a fetch that throws are retried; at most three times, then the failure is thrown', async () => {
  const f = fake([json({}, 429), new TypeError('connection reset'), json({}, 500), json({}, 502)]);
  const waits: number[] = [];
  await assert.rejects(models(env, { fetch: f.fetch, sleep: async (ms) => { waits.push(ms); } }).chat(chat), TransportFailure);
  assert.equal(f.calls.length, 4);
  assert.deepEqual(waits, [250, 500, 1000]);
});

test('a 400 is thrown without a retry, and so is a 401', async () => {
  for (const status of [400, 401]) {
    const f = fake([json({ error: { message: 'bad' } }, status)]);
    await assert.rejects(models(env, { fetch: f.fetch, sleep: async () => {} }).chat(chat), ProviderRefusal);
    assert.equal(f.calls.length, 1, String(status));
  }
});

test('a fetch that hangs past its timeout is retried', async () => {
  const f = fake(['hang', message('{}')]);
  const r = await models(env, { fetch: f.fetch, sleep: async () => {}, timeoutMs: 20 }).chat(chat);
  assert.equal(f.calls.length, 2);
  assert.equal(r.retries, 1);
});
