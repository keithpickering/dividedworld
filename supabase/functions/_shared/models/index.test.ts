import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnswerRejected, models } from './index.ts';
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
const noRecord = async () => {};
const chat = { duty: 'microEvent', tier: 'light', system: 'You are the Director.', messages: [{ role: 'user', content: 'Go.' }], schema: { type: 'object' }, maxTokens: 300 } as const;

test('chat asks the Messages API for structured output, with the key in a header and no sampling parameters', async () => {
  const f = fake([message('{"line":"hi"}')]);
  const r = await models(env, noRecord, { fetch: f.fetch, sleep: async () => {} }).chat(chat);
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
  await models(env, noRecord, { fetch: f.fetch, sleep: async () => {} }).chat({ ...chat, tier: 'strong' });
  assert.equal(JSON.parse(String(f.calls[0]?.init.body)).model, 'claude-opus-5-5');
  const g = fake([message('{}', {}, { model: 'claude-sonnet-5-5' })]);
  await models((n) => (n === 'SYSTEM_MODEL_LIGHT' ? 'claude-sonnet-5-5' : env(n)), noRecord, { fetch: g.fetch, sleep: async () => {} }).chat(chat);
  assert.equal(JSON.parse(String(g.calls[0]?.init.body)).model, 'claude-sonnet-5-5');
});

test('a usage block that reports priority is priced from the priority row even though the request asked for standard', async () => {
  const table = { ...PRICES.anthropic, models: { 'claude-haiku-5-5': { tiers: {
    standard: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2 },
    priority: { input: 0.2, output: 1, cacheRead: 0.02, cacheWrite5m: 0.25, cacheWrite1h: 0.4 },
  } } } };
  const f = fake([message('{}', { service_tier: 'priority' })]);
  const r = await models(env, noRecord, { fetch: f.fetch, sleep: async () => {}, prices: { anthropic: table } as never }).chat(chat);
  assert.equal(r.usage.serviceTier, 'priority');
  assert.equal(r.costMicrodollars, 200 + 500);
});

test('a model missing from the shipped table throws naming it, as does a priority usage block', async () => {
  await assert.rejects(models(env, noRecord, { fetch: fake([message('{}', {}, { model: 'claude-mystery-9' })]).fetch, sleep: async () => {} }).chat(chat), /claude-mystery-9/);
  await assert.rejects(models(env, noRecord, { fetch: fake([message('{}', { service_tier: 'priority' })]).fetch, sleep: async () => {} }).chat(chat), /priority/);
});

test('a completion goes to the instance\'s /v1/completions, cut at its stop, priced at zero', async () => {
  const f = fake([json({ choices: [{ text: ' The Director sighs.\nAnd more' }], usage: { prompt_tokens: 12, completion_tokens: 7 } })]);
  const r = await models(env, noRecord, { fetch: f.fetch, sleep: async () => {}, now: () => 0 }).complete({ duty: 'standingOrderLine', prompt: 'Line:', temperature: 0.9, topP: 0.95, stop: ['\n\n'], maxTokens: 40 });
  assert.equal(f.calls[0]?.url, 'https://old.example/v1/completions');
  assert.equal(new Headers(f.calls[0]?.init.headers).get('authorization'), 'Bearer ck-test');
  assert.deepEqual(JSON.parse(String(f.calls[0]?.init.body)), { model: 'default', prompt: 'Line:', temperature: 0.9, top_p: 0.95, stop: ['\n\n'], max_tokens: 40 });
  assert.equal(r.value, 'The Director sighs.');
  assert.equal(r.provider, 'completions');
  assert.equal(r.costMicrodollars, 0);
  assert.equal(r.usage.inputTokens, 12);
  assert.equal(r.usage.outputTokens, 7);
});

test('a completions server that reports no usage gets GPU seconds from wall time; with no key set, no bearer is sent', async () => {
  const f = fake([json({ choices: [{ text: 'Four words right here' }] })]);
  let clock = 1000;
  const only = (n: string) => (n === 'SYSTEM_COMPLETIONS_URL' ? 'https://old.example/' : undefined);
  const slowFetch = (async (u: string, i: RequestInit) => { clock += 2500; return f.fetch(u, i); }) as unknown as typeof globalThis.fetch;
  const r = await models(only, noRecord, { fetch: slowFetch, sleep: async () => {}, now: () => clock }).complete({ duty: 'standingOrderLine', prompt: 'a b c', temperature: 1, topP: 1, stop: [], maxTokens: 40 });
  assert.equal(new Headers(f.calls[0]?.init.headers).has('authorization'), false);
  assert.equal(f.calls[0]?.url, 'https://old.example/v1/completions');
  assert.equal(r.usage.gpuSeconds, 2.5);
  assert.equal(r.usage.outputTokens, 0);
  assert.equal(r.usage.inputTokens, 0);
  assert.equal(r.costMicrodollars, 0);
  await assert.rejects(models(() => undefined, noRecord, { fetch: f.fetch }).complete({ duty: 'standingOrderLine', prompt: 'x', temperature: 1, topP: 1, stop: [], maxTokens: 4 }), /SYSTEM_COMPLETIONS_URL/);
});

test('a 503 then a 200 is one call with one retry recorded, after a wait', async () => {
  const f = fake([json({ error: 'overloaded' }, 503), message('{"ok":true}')]);
  const waits: number[] = [];
  const r = await models(env, noRecord, { fetch: f.fetch, sleep: async (ms) => { waits.push(ms); } }).chat(chat);
  assert.equal(f.calls.length, 2);
  assert.equal(r.retries, 1);
  assert.deepEqual(waits, [250]);
});

test('a 429 and a fetch that throws are retried; at most three times, then the failure is thrown', async () => {
  const f = fake([json({}, 429), new TypeError('connection reset'), json({}, 500), json({}, 502)]);
  const waits: number[] = [];
  await assert.rejects(models(env, noRecord, { fetch: f.fetch, sleep: async (ms) => { waits.push(ms); } }).chat(chat), TransportFailure);
  assert.equal(f.calls.length, 4);
  assert.deepEqual(waits, [250, 500, 1000]);
});

test('a 400 is thrown without a retry, and so is a 401', async () => {
  for (const status of [400, 401]) {
    const f = fake([json({ error: { message: 'bad' } }, status)]);
    await assert.rejects(models(env, noRecord, { fetch: f.fetch, sleep: async () => {} }).chat(chat), ProviderRefusal);
    assert.equal(f.calls.length, 1, String(status));
  }
});

test('a fetch that hangs past its timeout is retried', async () => {
  const f = fake(['hang', message('{}')]);
  const r = await models(env, noRecord, { fetch: f.fetch, sleep: async () => {}, timeoutMs: 20 }).chat(chat);
  assert.equal(f.calls.length, 2);
  assert.equal(r.retries, 1);
});

/* ------------------------------------------------------------------ the ledger ---- */

import { ledgerWriter } from './ledger.ts';
import type { ModelCallRow } from './ledger.ts';

function ledger() {
  const rows: ModelCallRow[] = [];
  return { rows, record: async (row: ModelCallRow) => { rows.push(row); } };
}
const rules = { type: 'object', fields: { moves: { type: 'list', max: 6, of: { type: 'string' } } } } as const;
const asked = { ...chat, staff: 'director', meeting: 7, rules } as const;

test('a call that is used writes one ok row, with its tokens, cost, retries and who asked', async () => {
  const f = fake([json({}, 503), message('{"moves":["a"]}')]);
  const l = ledger();
  await models(env, l.record, { fetch: f.fetch, sleep: async () => {} }).chat(asked);
  assert.equal(l.rows.length, 1);
  assert.deepEqual(l.rows[0], {
    duty: 'microEvent', staff: 'director', provider: 'anthropic', model: 'claude-haiku-5-5', serviceTier: 'standard',
    inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, gpuSeconds: null,
    costMicrodollars: 350, outcome: 'ok', predicate: null, trims: [], retries: 1, meeting: 7,
  });
});

test('a call that throws in the adapter still writes a failed row, with the retries it spent', async () => {
  const l = ledger();
  await assert.rejects(models(env, l.record, { fetch: fake([json({}, 400)]).fetch, sleep: async () => {} }).chat(asked), ProviderRefusal);
  assert.equal(l.rows.length, 1);
  assert.equal(l.rows[0]?.outcome, 'failed');
  assert.equal(l.rows[0]?.provider, 'anthropic');
  assert.equal(l.rows[0]?.model, 'claude-haiku-5-5');
  assert.equal(l.rows[0]?.costMicrodollars, 0);
  assert.equal(l.rows[0]?.retries, 0);
  const m = ledger();
  await assert.rejects(models(env, m.record, { fetch: fake([json({}, 503)]).fetch, sleep: async () => {} }).chat(asked), TransportFailure);
  assert.equal(m.rows[0]?.outcome, 'failed');
  assert.equal(m.rows[0]?.retries, 3);
});

test('a rejected structured output writes a rejected row with its predicate, its trims and its cost (the answer was paid for)', async () => {
  const l = ledger();
  const twelve = JSON.stringify({ moves: Array.from({ length: 12 }, (_, i) => String(i)) });
  await assert.rejects(models(env, l.record, { fetch: fake([message(twelve)]).fetch, sleep: async () => {} }).chat(asked), (e: Error) => e instanceof AnswerRejected && e.predicate === 'atMost(6)');
  assert.equal(l.rows.length, 1);
  assert.equal(l.rows[0]?.outcome, 'rejected');
  assert.equal(l.rows[0]?.predicate, 'atMost(6)');
  assert.equal(l.rows[0]?.costMicrodollars, 350);
  const notJson = ledger();
  await assert.rejects(models(env, notJson.record, { fetch: fake([message('not json')]).fetch, sleep: async () => {} }).chat(asked), AnswerRejected);
  assert.equal(notJson.rows[0]?.predicate, 'validJson');
  const refused = ledger();
  await assert.rejects(models(env, refused.record, { fetch: fake([message('', {}, { stop_reason: 'refusal' })]).fetch, sleep: async () => {} }).chat(asked), AnswerRejected);
  assert.equal(refused.rows[0]?.predicate, 'refusal');
});

test('a trimmed answer is used, and its trims are on the ok row', async () => {
  const l = ledger();
  const seven = JSON.stringify({ moves: Array.from({ length: 7 }, (_, i) => String(i)) });
  const r = await models(env, l.record, { fetch: fake([message(seven)]).fetch, sleep: async () => {} }).chat(asked);
  assert.equal((r.value as { moves: string[] }).moves.length, 6);
  assert.deepEqual(l.rows[0]?.trims, [{ path: 'moves', predicate: 'atMost(6)', before: 7, after: 6 }]);
  assert.equal(l.rows[0]?.outcome, 'ok');
});

test('a rejection that follows a trim keeps the trim on its row', async () => {
  const l = ledger();
  const body = JSON.stringify({ moves: Array.from({ length: 7 }, (_, i) => String(i)), extra: 1 });
  const strict = { ...asked, rules: { type: 'object', fields: { moves: { type: 'list', max: 6, of: { type: 'string' } }, verdict: { type: 'string' } } } } as const;
  await assert.rejects(models(env, l.record, { fetch: fake([message(body)]).fetch, sleep: async () => {} }).chat(strict), AnswerRejected);
  assert.equal(l.rows[0]?.predicate, 'required');
  assert.equal(l.rows[0]?.trims.length, 1);
});

test('a model missing from the price table is a failed row at cost zero naming why, and the call throws naming the model', async () => {
  const l = ledger();
  await assert.rejects(models(env, l.record, { fetch: fake([message('{}', {}, { model: 'claude-mystery-9' })]).fetch, sleep: async () => {} }).chat(asked), /claude-mystery-9/);
  assert.equal(l.rows[0]?.outcome, 'failed');
  assert.equal(l.rows[0]?.predicate, 'unpriced');
  assert.equal(l.rows[0]?.model, 'claude-mystery-9');
  assert.equal(l.rows[0]?.inputTokens, 1000);
});

test('a completion writes its row at zero with GPU seconds; an empty one is a rejected row', async () => {
  const l = ledger();
  await models(env, l.record, { fetch: fake([json({ choices: [{ text: 'Fine.' }], usage: { prompt_tokens: 3, completion_tokens: 2 } })]).fetch, sleep: async () => {} })
    .complete({ duty: 'standingOrderLine', staff: 'director', prompt: 'x', temperature: 1, topP: 1, stop: [], maxTokens: 10 });
  assert.equal(l.rows[0]?.provider, 'completions');
  assert.equal(l.rows[0]?.costMicrodollars, 0);
  assert.equal(l.rows[0]?.outcome, 'ok');
  assert.equal(typeof l.rows[0]?.gpuSeconds, 'number');
  const e = ledger();
  await assert.rejects(models(env, e.record, { fetch: fake([json({ choices: [{ text: '\n' }] })]).fetch, sleep: async () => {} })
    .complete({ duty: 'standingOrderLine', prompt: 'x', temperature: 1, topP: 1, stop: [], maxTokens: 10 }), AnswerRejected);
  assert.equal(e.rows[0]?.outcome, 'rejected');
  assert.equal(e.rows[0]?.predicate, 'nonEmpty');
});

test('a call that fails before an adapter is chosen (no key set) still writes its row', async () => {
  const l = ledger();
  await assert.rejects(models(() => undefined, l.record, { fetch: fake([message('{}')]).fetch }).chat(asked), /ANTHROPIC_API_KEY/);
  assert.equal(l.rows[0]?.outcome, 'failed');
});

test('a ledger write that fails makes the call throw, even when the call itself went well', async () => {
  const broken = async () => { throw new Error('the database is gone'); };
  await assert.rejects(models(env, broken, { fetch: fake([message('{"moves":[]}')]).fetch, sleep: async () => {} }).chat(asked), /ledger.*database is gone|database is gone/);
  // And when the call also failed, the ledger's failure is what is thrown, with the call's own on its cause.
  await assert.rejects(models(env, broken, { fetch: fake([json({}, 400)]).fetch, sleep: async () => {} }).chat(asked), (e: Error) => /ledger/.test(e.message) && e.cause instanceof ProviderRefusal);
});

test('the real writer calls record_model_call with the row in snake case', async () => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const write = ledgerWriter({ rpc: async <T>(fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return 1 as T; } });
  await write({ duty: 'meeting', staff: null, provider: 'anthropic', model: 'm', serviceTier: 'standard', inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWrite5mTokens: 4, cacheWrite1hTokens: 5,
    gpuSeconds: null, costMicrodollars: 9, outcome: 'ok', predicate: null, trims: [], retries: 0, meeting: null });
  assert.equal(calls[0]?.fn, 'record_model_call');
  assert.deepEqual(calls[0]?.args, { payload: { duty: 'meeting', staff: null, provider: 'anthropic', model: 'm', service_tier: 'standard', input_tokens: 1, output_tokens: 2, cache_read_tokens: 3,
    cache_write_5m_tokens: 4, cache_write_1h_tokens: 5, gpu_seconds: null, cost_microdollars: 9, outcome: 'ok', predicate: null, trims: [], retries: 0, meeting: null } });
});

test('a 200 whose body is not JSON is one attempt: not retried, and one rejected row naming validJson', async () => {
  for (const run of [(m: ReturnType<typeof models>) => m.chat(chat), (m: ReturnType<typeof models>) => m.complete({ duty: 'standingOrderLine', prompt: 'x', temperature: 1, topP: 1, stop: [], maxTokens: 10 })]) {
    const f = fake([new Response('<html>gateway</html>', { status: 200 })]);
    const l = ledger();
    await assert.rejects(run(models(env, l.record, { fetch: f.fetch, sleep: async () => {} })), (e: Error) => e instanceof AnswerRejected && e.predicate === 'validJson');
    assert.equal(f.calls.length, 1);
    assert.equal(l.rows.length, 1);
    assert.equal(l.rows[0]?.retries, 0);
    assert.equal(l.rows[0]?.outcome, 'rejected');
    assert.equal(l.rows[0]?.predicate, 'validJson');
  }
});

test('a completions server that reports no usage block records no tokens, never an estimate; other names for the counts are read', async () => {
  const none = ledger();
  await models(env, none.record, { fetch: fake([json({ choices: [{ text: 'Four words right here' }] })]).fetch, sleep: async () => {} })
    .complete({ duty: 'standingOrderLine', prompt: 'a b c', temperature: 1, topP: 1, stop: [], maxTokens: 40 });
  assert.equal(none.rows[0]?.inputTokens, 0);
  assert.equal(none.rows[0]?.outputTokens, 0);
  const llama = ledger();
  await models(env, llama.record, { fetch: fake([json({ choices: [{ text: 'Fine.' }], tokens_evaluated: 21, tokens_predicted: 9 })]).fetch, sleep: async () => {} })
    .complete({ duty: 'standingOrderLine', prompt: 'x', temperature: 1, topP: 1, stop: [], maxTokens: 40 });
  assert.equal(llama.rows[0]?.inputTokens, 21);
  assert.equal(llama.rows[0]?.outputTokens, 9);
  const tgi = ledger();
  await models(env, tgi.record, { fetch: fake([json({ choices: [{ text: 'Fine.' }], details: { generated_tokens: 5 } })]).fetch, sleep: async () => {} })
    .complete({ duty: 'standingOrderLine', prompt: 'x', temperature: 1, topP: 1, stop: [], maxTokens: 40 });
  assert.equal(tgi.rows[0]?.outputTokens, 5);
  assert.equal(tgi.rows[0]?.inputTokens, 0);
});
