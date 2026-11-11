import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CassetteMiss, rehearsalFetch, rehearsalModels, type Mode } from './models.ts';
import { AnswerRejected } from '../../supabase/functions/_shared/models/index.ts';
import type { ModelCallRow } from '../../supabase/functions/_shared/models/ledger.ts';
import type { ChatRequest, CompletionRequest, Models } from '../../engine/system/model.ts';

const TIERS = { strong: 'big-model', light: 'small-model' } as const;
const chat: ChatRequest = { duty: 'meeting', tier: 'strong', system: 's', messages: [{ role: 'user', content: 'go' }], schema: { type: 'object', properties: { words: { type: 'string' } }, required: ['words'] }, maxTokens: 100, staff: 'boss', meeting: 1 };
const completion: CompletionRequest = { duty: 'chatter', prompt: 'say', temperature: 0.5, topP: 1, stop: [], maxTokens: 20 };
const dir = (): string => mkdtempSync(join(tmpdir(), 'cassette-'));

/** A fake of the real factory: counts live calls, writes a row through the record it was given, and costs 2 dollars a call. */
function fakeLive(behavior: { reject?: boolean } = {}) {
  const calls: string[] = [];
  const factory = ((_env: unknown, record: (row: ModelCallRow) => Promise<void>): Models => {
    const row = (duty: string, outcome: ModelCallRow['outcome'], predicate: string | null): ModelCallRow => ({
      duty, staff: null, provider: 'anthropic', model: 'big-model', serviceTier: 'standard', inputTokens: 10, outputTokens: 5, cacheReadTokens: null,
      cacheWrite5mTokens: null, cacheWrite1hTokens: null, gpuSeconds: null, costMicrodollars: 2_000_000, outcome, predicate, trims: [], retries: 0, meeting: null,
    });
    return {
      async chat(r) {
        calls.push(r.duty);
        if (behavior.reject) { await record(row(r.duty, 'rejected', 'validJson')); throw new AnswerRejected('the answer is not JSON', 'validJson'); }
        await record(row(r.duty, 'ok', null));
        return { value: { words: 'live' }, usage: { inputTokens: 10, outputTokens: 5 }, provider: 'anthropic', model: 'big-model', trims: [], retries: 0, costMicrodollars: 2_000_000 };
      },
      async complete(r) {
        calls.push(r.duty);
        await record(row(r.duty, 'ok', null));
        return { value: 'text', usage: {}, provider: 'completions', model: 'default', trims: [], retries: 0, costMicrodollars: 2_000_000 };
      },
    };
  }) as never;
  return { factory, calls };
}

function setup(mode: Mode, d: string, live = fakeLive(), dollars = 5) {
  const rows: ModelCallRow[] = [];
  const made = rehearsalModels({ mode, dir: d, cap: { dollars }, live: live.factory });
  const m = made(() => undefined, async (row) => { rows.push(row); }, { tiers: TIERS });
  return { made, m, rows, live };
}

test('a miss in record calls live once, saves it, and a second run replays it with no live call', async () => {
  const d = dir();
  const first = setup('record', d);
  const a = await first.m.chat(chat);
  assert.deepEqual(a.value, { words: 'live' });
  assert.deepEqual(first.live.calls, ['meeting']);
  assert.equal(readdirSync(d).length, 1, 'one JSON file per key');

  const second = setup('record', d);
  const b = await second.m.chat({ ...chat, staff: 'someone-else', meeting: 9 });
  assert.deepEqual(b.value, { words: 'live' });
  assert.deepEqual(second.live.calls, [], 'no live call on a hit');
  assert.equal(second.rows.length, 1, 'the recorded row is written again');
  assert.equal(second.rows[0]!.costMicrodollars, 2_000_000);
  assert.equal(second.rows[0]!.staff, 'someone-else', 'the row carries this run\'s staff and meeting');
  assert.equal(second.rows[0]!.meeting, 9);
  assert.equal(second.made.cap.liveMicrodollars(), 0, 'a replayed row is never counted');
  assert.equal(second.made.calls[0]!.replayed, true);
  assert.equal(first.made.calls[0]!.replayed, false);
});

test('a miss in a second call with the same request inside one record run replays the first', async () => {
  const s = setup('record', dir());
  await s.m.chat(chat);
  await s.m.chat(chat);
  assert.deepEqual(s.live.calls, ['meeting']);
});

test('offline throws CassetteMiss naming the duty and key on a miss, and replays a hit', async () => {
  const d = dir();
  const off = setup('offline', d);
  await assert.rejects(() => off.m.chat(chat), (e: unknown) => e instanceof CassetteMiss && /meeting/.test(e.message) && /[0-9a-f]{64}/.test(e.message));
  assert.deepEqual(off.live.calls, []);
  await setup('record', d).m.chat(chat);
  assert.deepEqual((await setup('offline', d).m.chat(chat)).value, { words: 'live' });
});

test('fresh ignores the cassette and calls live again', async () => {
  const d = dir();
  await setup('record', d).m.chat(chat);
  const fresh = setup('fresh', d);
  await fresh.m.chat(chat);
  assert.deepEqual(fresh.live.calls, ['meeting']);
});

test('the live total counts live rows only, and cap.reached() turns true at the cap', async () => {
  const d = dir();
  await setup('record', d).m.chat(chat); // saved: 2 dollars
  const s = setup('record', d, fakeLive(), 4);
  assert.equal(s.made.cap.reached(), false);
  await s.m.chat(chat); // replay, uncounted
  assert.equal(s.made.cap.liveMicrodollars(), 0);
  await s.m.chat({ ...chat, system: 'other 1' });
  assert.equal(s.made.cap.liveMicrodollars(), 2_000_000);
  assert.equal(s.made.cap.reached(), false);
  await s.m.complete(completion);
  assert.equal(s.made.cap.liveMicrodollars(), 4_000_000);
  assert.equal(s.made.cap.reached(), true);
});

test('a rejection is saved, and a replay rethrows AnswerRejected with its predicate and writes its row', async () => {
  const d = dir();
  const rec = setup('record', d, fakeLive({ reject: true }));
  await assert.rejects(() => rec.m.chat(chat), (e: unknown) => e instanceof AnswerRejected && e.predicate === 'validJson');
  const again = setup('record', d);
  await assert.rejects(() => again.m.chat(chat), (e: unknown) => e instanceof AnswerRejected && e.predicate === 'validJson' && /not JSON/.test(e.message));
  assert.deepEqual(again.live.calls, []);
  assert.equal(again.rows[0]!.outcome, 'rejected');
  assert.equal(again.rows[0]!.predicate, 'validJson');
  assert.ok(again.made.calls[0]!.error);
});

test('stub never calls live: chat gets the least answer, complete an empty one, both priced at zero under provider stub', async () => {
  const s = setup('stub', dir());
  const r = await s.m.chat(chat);
  assert.deepEqual(r.value, { words: 'stub' });
  assert.equal(r.provider, 'stub');
  assert.equal(r.costMicrodollars, 0);
  const c = await s.m.complete(completion);
  assert.equal(c.value, '');
  assert.deepEqual(s.live.calls, []);
  assert.deepEqual(s.rows.map((x) => [x.provider, x.costMicrodollars, x.outcome, x.predicate]), [['stub', 0, 'ok', null], ['stub', 0, 'ok', null]]);
  assert.equal(s.made.cap.reached(), false);
});

test('stub repairs a chat answer against its rules: a bound it cannot meet is a rejection naming the predicate', async () => {
  const s = setup('stub', dir());
  const rules = { type: 'object', fields: { words: { type: 'string', minLength: 1 }, mood: { type: 'enum', values: ['x'], optional: true } } } as const;
  const r = await s.m.chat({ ...chat, rules, schema: { type: 'object', properties: { words: { type: 'string' } }, required: ['words'] } });
  assert.ok(r.value);
  const rejected = await s.m.chat({ ...chat, rules: { type: 'object', fields: { missing: { type: 'string' } } } }).catch((e) => e);
  assert.ok(rejected instanceof AnswerRejected);
  assert.equal(s.rows.at(-1)!.outcome, 'rejected');
});

test('the calls are kept for the report', async () => {
  const s = setup('record', dir());
  await s.m.chat(chat);
  const [call] = s.made.calls;
  assert.equal(call!.duty, 'meeting');
  assert.equal(call!.staff, 'boss');
  assert.match(call!.key, /^[0-9a-f]{64}$/);
  assert.deepEqual(call!.value, { words: 'live' });
  assert.equal(call!.cost, 2_000_000);
});

test('feeds are recorded and replayed by URL and simulated day; offline misses; stub answers an empty body', async () => {
  const d = dir();
  let hits = 0;
  const live = (async () => { hits++; return new Response('<rss/>', { status: 200 }); }) as unknown as typeof fetch;
  let day = '2026-11-01';
  const f = rehearsalFetch('record', d, { day: () => day, live });
  assert.equal(await (await f('https://news.example/feed')).text(), '<rss/>');
  assert.equal(await (await f('https://news.example/feed')).text(), '<rss/>');
  assert.equal(hits, 1);
  day = '2026-11-02';
  await f('https://news.example/feed');
  assert.equal(hits, 2, 'a new day is a new key');
  await assert.rejects(() => rehearsalFetch('offline', d, { day: () => '2030-01-01', live })('https://news.example/feed'), CassetteMiss);
  assert.equal(await (await rehearsalFetch('offline', d, { day: () => '2026-11-01', live })('https://news.example/feed')).text(), '<rss/>');
  const stub = rehearsalFetch('stub', d, { day: () => day, live });
  assert.equal(await (await stub('https://news.example/other')).text(), '');
  assert.equal(hits, 2);
});
