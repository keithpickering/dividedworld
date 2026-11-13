import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWrites } from './core.ts';
import { tokenId } from '../../../engine/system/tokens.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { ProviderRefusal, TransportFailure } from '../_shared/models/transport.ts';
import { instance as base } from '../_shared/instance.ts';
import { AnswerRejected, type CompletionRequest, type Models } from '../../../engine/system/model.ts';
import type { CardRules } from '../../../engine/rules/cards.ts';
import { writeTokensMost } from '../../../engine/rules/cards.ts';
import { models as realModels } from '../_shared/models/index.ts';
import type { ModelCallRow } from '../_shared/models/ledger.ts';
import type { Instance } from '../../../engine/rules/types.ts';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const V = '44444444-4444-4444-8444-444444444444';

const frames: unknown[] = [];
const card = {
  key: 'echo', name: 'Echo',
  writes: {
    sampling: { temperature: 0.9, topP: 0.95 },
    tokens: (config: { steps: number }) => 100 + config.steps * 50,
    frame: (input: unknown) => { frames.push(input); return { prompt: 'PROMPT', stop: ['\n\n'] }; },
  },
} as unknown as CardRules;
const instance: Instance = { ...base, cards: [...base.cards, card], system: { ...base.system, scrubWords: ['badword'] } };

const job = (over: Record<string, unknown> = {}) => ({
  play: P1, version: V, post: POST, thread: 't', attempts: 1, card: 'echo', config: { steps: 2 }, tokens: 200, author: 'Mallory',
  body: 'Hello [b]there[/b] [code]hidden[/code] friend', title: 'A title', before: [{ name: 'Ann', body: '[i]first[/i]' }], earlier: [], ...over,
});

function fakeDb(rounds: unknown[][], o: { failOn?: string; renew?: boolean } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const queue = [...rounds];
  const db: Db = { rpc: async <T>(fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (o.failOn === fn) throw new DatabaseError('boom', '57014', 500);
    if (fn === 'claim_card_writes') return (queue.shift() ?? []) as T;
    if (fn === 'renew_card_write') return (o.renew ?? true) as T;
    return { written: true, refund: null } as T;
  } };
  return { db, calls };
}
const fakeModels = (answer: (r: CompletionRequest, n: number) => string | Error) => {
  const requests: CompletionRequest[] = [];
  const models = { chat: async () => { throw new Error('no chat'); }, complete: async (r: CompletionRequest) => {
    requests.push(r);
    const a = answer(r, requests.length);
    if (a instanceof Error) throw a;
    return { value: a, usage: {}, provider: 'p', model: 'm', trims: [], retries: 0, costMicrodollars: 0 };
  } } as unknown as Models;
  return { models, requests };
};
const finishes = (calls: { fn: string; args: Record<string, unknown> }[]) => calls.filter((c) => c.fn === 'finish_card_write').map((c) => c.args);
const run = (db: Db, models: Models, onlyPost?: string) => runWrites(db, models, instance, instance.settings, 8, onlyPost);

test('a job is finished with its text, and the request carries the play, the duty, many lines and the tokens for its config', async () => {
  const { db, calls } = fakeDb([[job()]]);
  /* Long enough not to be short (a tail under the full share of the tokens asked for is topped up), so the one call is the whole of it. */
  const said = 'and so it went on '.repeat(40);
  const { models, requests } = fakeModels(() => said);
  const out = await run(db, models);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: said, failed: null }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.play, P1);
  assert.equal(requests[0]!.duty, 'cardText');
  assert.equal(requests[0]!.lines, 'many');
  assert.equal(requests[0]!.maxTokens, 200);
  assert.equal(requests[0]!.prompt, 'PROMPT');
  assert.deepEqual(requests[0]!.stop, ['\n\n']);
  assert.ok((requests[0]!.maxChars ?? 0) <= 4000);
  assert.equal(out.written, 1);
});

test('the length is the one the play recorded, whatever the card\'s rules and the settings say now', async () => {
  const { db } = fakeDb([[job({ tokens: 321 })]]);
  const { models, requests } = fakeModels(() => 'x');
  /* The card's rules would say 200 for these steps (and a retuned economy something else again); the job's own number is the length. */
  await run(db, models);
  assert.equal(requests[0]!.maxTokens, 321);
  assert.equal(requests[0]!.maxChars, Math.min(4000, 321 * 6));
});

test('a job whose play recorded no length makes no call and is finished unreachable', async () => {
  const { db, calls } = fakeDb([[job({ tokens: null })]]);
  const { models, requests } = fakeModels(() => 'x');
  await run(db, models);
  assert.equal(requests.length, 0);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: null, failed: 'unreachable' }]);
});

test('the frame is built from visible text, with the earlier tails in order', async () => {
  frames.length = 0;
  const { db } = fakeDb([[job({ earlier: [{ play: 'a', text: 'one' }, { play: 'b', text: 'two' }] })]]);
  await run(db, fakeModels(() => 'x').models);
  const f = frames[0] as { post: { name: string; text: string }; before: { name: string; text: string }[]; title: string; tails: string[] };
  assert.equal(f.post.name, 'Mallory');
  assert.ok(!f.post.text.includes('[b]') && !f.post.text.includes('hidden'), f.post.text);
  assert.ok(f.post.text.includes('Hello there'));
  assert.deepEqual(f.before, [{ name: 'Ann', text: 'first' }]);
  assert.equal(f.title, 'A title');
  assert.deepEqual(f.tails, ['one', 'two']);
});

test('a scrub hit twice finishes scrub:word', async () => {
  const { db, calls } = fakeDb([[job()]]);
  const { models, requests } = fakeModels(() => 'that is a badword');
  await run(db, models);
  assert.equal(requests.length, 2);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: null, failed: 'scrub:word' }]);
});

test('an empty completion finishes nonEmpty', async () => {
  const { db, calls } = fakeDb([[job()]]);
  await run(db, fakeModels(() => new AnswerRejected('the completion is empty', 'nonEmpty')).models);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: null, failed: 'nonEmpty' }]);
});

test('a transport failure that outlived the retries finishes unreachable', async () => {
  const { db, calls } = fakeDb([[job()]]);
  await run(db, fakeModels(() => new TransportFailure('timed out')).models);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: null, failed: 'unreachable' }]);
});

test('a job past three attempts is finished unreachable and the model is not called', async () => {
  const { db, calls } = fakeDb([[job({ attempts: 4 })]]);
  const { models, requests } = fakeModels(() => 'x');
  await run(db, models);
  assert.equal(requests.length, 0);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: null, failed: 'unreachable' }]);
});

test('a card the instance no longer has is finished unreachable without a call', async () => {
  const { db, calls } = fakeDb([[job({ card: 'gone' })]]);
  const { models, requests } = fakeModels(() => 'x');
  await run(db, models);
  assert.equal(requests.length, 0);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: null, failed: 'unreachable' }]);
});

test('a bug in the call is not finished as unreachable: the job stays claimed, and the run goes on', async () => {
  const { db, calls } = fakeDb([[job(), job({ play: P2, post: V })]]);
  const out = await run(db, fakeModels((_r, n) => (n === 1 ? new TypeError('x is undefined') : 'fine')).models);
  assert.deepEqual(finishes(calls).map((f) => f.play), [P2]);
  assert.equal(out.errored, 1);
});

test('a ProviderRefusal (a bad key, a wrong address: a 401) is a bug-shaped error: counted errored, the job left claimed, and the run goes on (#583)', async () => {
  const { db, calls } = fakeDb([[job(), job({ play: P2, post: V })]]);
  const out = await run(db, fakeModels((_r, n) => (n === 1 ? new ProviderRefusal('HTTP 401 bad key', 401) : 'fine')).models);
  assert.deepEqual(finishes(calls).map((f) => f.play), [P2]);
  assert.equal(out.errored, 1);
});

test('a database error on the claim is thrown', async () => {
  const { db } = fakeDb([], { failOn: 'claim_card_writes' });
  await assert.rejects(run(db, fakeModels(() => 'x').models), DatabaseError);
});

test('a database error on the finish is thrown', async () => {
  const { db } = fakeDb([[job()]], { failOn: 'finish_card_write' });
  await assert.rejects(run(db, fakeModels(() => 'x').models), DatabaseError);
});

test('with onlyPost the claim is made for that post; without, for none', async () => {
  const a = fakeDb([]);
  await run(a.db, fakeModels(() => 'x').models, POST);
  assert.deepEqual(a.calls.map((c) => [c.fn, c.args.only_post]), [['claim_card_writes', POST]]);
  const b = fakeDb([]);
  await run(b.db, fakeModels(() => 'x').models);
  assert.equal(b.calls[0]!.args.only_post ?? null, null);
});

test('after a job, the post is claimed again, so the next play on it follows in order', async () => {
  const { db, calls } = fakeDb([[job()], [job({ play: P2, earlier: [{ play: P1, text: 'x' }] })], []]);
  await run(db, fakeModels(() => 'x').models, POST);
  assert.deepEqual(finishes(calls).map((f) => f.play), [P1, P2]);
  assert.equal(calls.filter((c) => c.fn === 'claim_card_writes').length, 3);
});

test('jobs run at most four at once', async () => {
  const jobs = Array.from({ length: 9 }, (_, i) => job({ play: `00000000-0000-4000-8000-00000000000${i}`, post: `00000000-0000-4000-8000-0000000001${i}` }));
  const { db } = fakeDb([jobs, []]);
  let live = 0; let peak = 0;
  const models = { complete: async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return { value: 'x', usage: {}, provider: 'p', model: 'm', trims: [], retries: 0, costMicrodollars: 0 }; } } as unknown as Models;
  await run(db, models);
  assert.equal(peak, 4);
});

test('a run stops starting rounds when its time budget is spent', async () => {
  const { db, calls } = fakeDb([[job()], [job({ play: P2 })], []]);
  let t = 0;
  await runWrites(db, fakeModels(() => 'x').models, instance, instance.settings, 8, undefined, { budgetMs: 1000, now: () => (t += 600) });
  assert.equal(calls.filter((c) => c.fn === 'claim_card_writes').length, 1);
});

test('a card whose frame throws for one job is that job\'s error: the others in the batch are finished, and the log has the play and the error name only', async () => {
  const boom = { ...card, writes: { ...card.writes, frame: (input: unknown) => { frames.push(input); if ((input as { post: { name: string } }).post.name === 'Boom') throw new RangeError('the post said: a secret'); return { prompt: 'PROMPT', stop: [] }; } } } as unknown as CardRules;
  const inst: Instance = { ...instance, cards: [...base.cards, boom] };
  const { db, calls } = fakeDb([[job({ author: 'Boom' }), job({ play: P2, post: V })]]);
  const logged: unknown[][] = [];
  const was = console.error;
  console.error = (...a: unknown[]) => { logged.push(a); };
  let out;
  try { out = await runWrites(db, fakeModels(() => 'fine').models, inst, inst.settings, 8); } finally { console.error = was; }
  assert.deepEqual(finishes(calls).map((f) => f.play), [P2]);
  assert.equal(out.errored, 1);
  assert.ok(logged.some((l) => l.includes(P1) && l.includes('RangeError')), JSON.stringify(logged));
  assert.ok(!JSON.stringify(logged).includes('secret'), 'the error\'s message is never logged');
});

test('no more jobs are claimed at a time than run at once', async () => {
  const { db, calls } = fakeDb([[]]);
  await run(db, fakeModels(() => 'x').models);
  assert.equal(calls[0]!.args.most, 4);
  const narrow = fakeDb([[]]);
  await runWrites(narrow.db, fakeModels(() => 'x').models, instance, instance.settings, 8, undefined, { concurrency: 2 });
  assert.equal(narrow.calls[0]!.args.most, 2);
  const few = fakeDb([[]]);
  await runWrites(few.db, fakeModels(() => 'x').models, instance, instance.settings, 3);
  assert.equal(few.calls[0]!.args.most, 3);
});

test('an instance whose old voice is off finishes the job unreachable, with no call', async () => {
  const { db, calls } = fakeDb([[job()]]);
  const { models, requests } = fakeModels(() => 'x');
  await runWrites(db, models, instance, { ...instance.settings, oldVoice: false }, 8);
  assert.equal(requests.length, 0);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: null, failed: 'unreachable' }]);
});

test('a post an edit has emptied finishes emptyPost, with no call', async () => {
  frames.length = 0;
  const { db, calls } = fakeDb([[job({ body: '[code]only hidden[/code]  ' })]]);
  const { models, requests } = fakeModels(() => 'x');
  await run(db, models);
  assert.equal(requests.length, 0);
  assert.equal(frames.length, 0);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: null, failed: 'emptyPost' }]);
});

test('a frame that ignores its budget ends the job at once: nothing is sent, the job finishes promptTooLong on the first claim, and the ledger row is failed', async () => {
  const long = { ...card, writes: { ...card.writes, frame: () => ({ prompt: 'x'.repeat(200), stop: ['\n\n'] }) } } as unknown as CardRules;
  const inst: Instance = { ...instance, cards: [...base.cards, long] };
  const { db, calls } = fakeDb([[job()]]);
  let fetched = 0;
  const fetch = (async () => { fetched++; return new Response('{}'); }) as unknown as typeof globalThis.fetch;
  const rows: ModelCallRow[] = [];
  const real = realModels((n) => ({ SYSTEM_COMPLETIONS_URL: 'https://old.example' } as Record<string, string>)[n], async (row) => { rows.push(row); }, {
    tiers: { strong: 's', light: 'l' }, fetch, sleep: async () => {}, oldVoice: { window: 100, count: (t: string) => t.length },
  });
  const out = await runWrites(db, real, inst, inst.settings, 8);
  assert.equal(fetched, 0);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: null, failed: 'promptTooLong' }]);
  assert.equal(out.failed, 1);
  assert.equal(out.errored, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.outcome, 'failed');
  assert.equal(rows[0]!.predicate, 'promptTooLong');
});

test('a play that bought more than the window leaves room for is asked for the most that fits, and framed with the rest as its budget', async () => {
  frames.length = 0;
  const settings = { ...instance.settings, oldVoiceWindow: 656, oldVoicePromptFloor: 256 };
  assert.equal(writeTokensMost(settings), 400);
  const { db } = fakeDb([[job({ tokens: 768 })]]);
  const { models, requests } = fakeModels(() => 'x');
  await runWrites(db, models, instance, settings, 8);
  assert.equal(requests[0]!.maxTokens, 400);
  const frame = frames[0] as { budget: number; count: (t: string) => number };
  assert.equal(frame.budget, 656 - 400);
  assert.equal(typeof frame.count, 'function');
});

test('a window at or below the floor asks for one token and frames with the rest: the job does not throw (#582)', async () => {
  frames.length = 0;
  const settings = { ...instance.settings, oldVoiceWindow: 64, oldVoicePromptFloor: 256 };
  assert.equal(writeTokensMost(settings), 1);
  const { db, calls } = fakeDb([[job({ tokens: 25 })]]);
  const { models, requests } = fakeModels(() => 'x');
  const out = await runWrites(db, models, instance, settings, 8);
  assert.equal(requests[0]!.maxTokens, 1);
  assert.equal((frames[0] as { budget: number }).budget, 63);
  assert.equal(out.errored, 0);
  assert.equal(finishes(calls).length, 1);
});

test('the frame is handed the counter of the settings\' tokenizer: bytes counts a byte each, gpt2 counts tokens', async () => {
  for (const [kind, expected] of [['bytes', 5], ['gpt2', 1]] as const) {
    frames.length = 0;
    const settings = { ...instance.settings, oldVoiceTokenizer: kind };
    const { db } = fakeDb([[job()]]);
    await runWrites(db, fakeModels(() => 'x').models, instance, settings, 8);
    assert.equal((frames[0] as { count: (t: string) => number }).count('hello'), expected, kind);
  }
});

test('a play that bought less than the cap is asked for what it bought, and framed with the window less that', async () => {
  frames.length = 0;
  const settings = { ...instance.settings, oldVoiceWindow: 1024, oldVoicePromptFloor: 256 };
  const { db } = fakeDb([[job({ tokens: 100 })]]);
  const { models, requests } = fakeModels(() => 'x');
  await runWrites(db, models, instance, settings, 8);
  assert.equal(requests[0]!.maxTokens, 100);
  assert.equal((frames[0] as { budget: number }).budget, 1024 - 100);
});

/* Topping up a short tail (docs/plans/2026-11-13-you-were-saying-voice-design.md, section 3). The bytes tokenizer counts a character each, so a text's length is its own. */
const bytes = { ...instance.settings, oldVoiceTokenizer: 'bytes' as const, cardWriteFullShare: 0.5, cardWriteTopUps: 3 };
const scripted = (answers: (string | Error)[]) => fakeModels((_r, n) => answers[n - 1] ?? 'z'.repeat(500));
const x = (n: number) => 'x'.repeat(n);
/* A frame that writes the tail so far and the break into the prompt, as the card's own does. */
const writing = { ...card, writes: { ...card.writes, frame: (input: { sofar: string; budget: number }) => { frames.push(input); return { prompt: `P|${input.sofar === '' ? '' : `${input.sofar}\n\n`}`, stop: ['\n\n'] }; } } } as unknown as CardRules;
const writingInstance: Instance = { ...instance, cards: [...base.cards, writing] };

test('a first answer at the full length is the only call, and its frame is asked with nothing so far', async () => {
  frames.length = 0;
  const { db, calls } = fakeDb([[job({ tokens: 200 })]]);
  const { models, requests } = scripted([x(100)]);
  await runWrites(db, models, instance, bytes, 8);
  assert.equal(requests.length, 1);
  assert.equal((frames[0] as { sofar: string }).sofar, '');
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: x(100), failed: null }]);
});

test('a short first answer then a long one: two calls, the second continues the first after a break, asks for the tokens owed, and the two are stored joined by a break', async () => {
  frames.length = 0;
  const { db, calls } = fakeDb([[job({ tokens: 200 })]]);
  const { models, requests } = scripted([' ab', x(150)]);
  await runWrites(db, models, writingInstance, bytes, 8);
  assert.equal(requests.length, 2);
  assert.equal(requests[1]!.prompt, 'P| ab\n\n');
  assert.equal(requests[1]!.maxTokens, 200 - 3);
  assert.equal(requests[1]!.maxChars, Math.min((200 - 3) * 6, 4000 - 3 - 2));
  const second = frames[1] as { sofar: string; budget: number };
  assert.equal(second.sofar, ' ab');
  assert.equal(second.budget, bytes.oldVoiceWindow - 197);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: ` ab\n\n${x(150)}`, failed: null }]);
});

test('a top-up rejected as empty ends the loop: the first answer is stored, nothing is refunded', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 200 })]]);
  const { models, requests } = scripted(['?', new AnswerRejected('the completion is empty', 'nonEmpty')]);
  await runWrites(db, models, instance, bytes, 8);
  assert.equal(requests.length, 2);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: '?', failed: null }]);
});

test('four short answers: the first call and three top-ups, joined by breaks, each owed what is left', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 200 })]]);
  const { models, requests } = scripted([x(3), x(4), x(5), x(6), x(7)]);
  await runWrites(db, models, instance, bytes, 8);
  assert.equal(requests.length, 4);
  assert.deepEqual(requests.map((r) => r.maxTokens), [200, 197, 191, 184]);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: [x(3), x(4), x(5), x(6)].join('\n\n'), failed: null }]);
});

test('no top-ups, or a full share of zero, is one call whatever the length', async () => {
  for (const over of [{ cardWriteTopUps: 0 }, { cardWriteFullShare: 0 }]) {
    const { db, calls } = fakeDb([[job({ tokens: 200 })]]);
    const { models, requests } = scripted(['?']);
    await runWrites(db, models, instance, { ...bytes, ...over }, 8);
    assert.equal(requests.length, 1, JSON.stringify(over));
    assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: '?', failed: null }], JSON.stringify(over));
  }
});

test('the request carries the card\'s sampling, the ban as token ids, ignoreEos and the frame\'s stop pattern; a bytes tokenizer has no ids, so no ban', async () => {
  const pattern = /-{2,}[ \t]*Posted by /;
  const sampled = { ...card,
    writes: { ...card.writes, sampling: { temperature: 0.7, topP: 0.8, topK: 40, minP: 0.05, repeatPenalty: 1.6, repeatLastN: 64, ban: ['Posted', ' Quote', 'no such token \u0000'] }, frame: () => ({ prompt: 'PROMPT', stop: ['\n\n'], stopPattern: pattern }) } } as unknown as CardRules;
  const inst: Instance = { ...instance, cards: [...base.cards, sampled] };
  const long = x(2000);
  const gpt2 = fakeDb([[job()]]); const a = scripted([long]);
  await runWrites(gpt2.db, a.models, inst, { ...inst.settings, oldVoiceTokenizer: 'gpt2' }, 8);
  const r = a.requests[0]!;
  assert.equal(r.temperature, 0.7); assert.equal(r.topP, 0.8); assert.equal(r.topK, 40); assert.equal(r.minP, 0.05);
  assert.equal(r.repeatPenalty, 1.6); assert.equal(r.repeatLastN, 64); assert.equal(r.ignoreEos, true);
  assert.equal(r.stopPattern, pattern);
  assert.deepEqual(r.ban, [tokenId('gpt2', 'Posted'), tokenId('gpt2', ' Quote')]);
  assert.ok(r.ban!.every((id) => Number.isInteger(id)) && r.ban!.length === 2);
  const none = fakeDb([[job()]]); const b = scripted([long]);
  await runWrites(none.db, b.models, inst, { ...inst.settings, oldVoiceTokenizer: 'bytes' }, 8);
  assert.ok(!('ban' in b.requests[0]!), 'no ids, no ban key');
});

test('a card that gives only temperature and top-p sends no other sampling number, and still ignores end-of-text', async () => {
  const { db } = fakeDb([[job()]]);
  const { models, requests } = scripted([x(2000)]);
  await runWrites(db, models, instance, bytes, 8);
  const r = requests[0]!;
  for (const k of ['topK', 'minP', 'repeatPenalty', 'repeatLastN', 'ban', 'stopPattern']) assert.ok(!(k in r) || (r as unknown as Record<string, unknown>)[k] === undefined, k);
  assert.equal(r.ignoreEos, true);
});

test('a top-up asks under the room left: with no room under the limit the loop ends and the tail stands', async () => {
  /* GPT-2 counts about four characters a token, so a 4,000-character tail is far under the 1,800 tokens that 2,000 bought. */
  const settings = { ...instance.settings, oldVoiceTokenizer: 'gpt2' as const, oldVoiceWindow: 20_000, cardWriteFullShare: 0.9, cardWriteTopUps: 3 };
  const prose = 'the quick brown fox '.repeat(200);
  const { db, calls } = fakeDb([[job({ tokens: 2000 })]]);
  const { models, requests } = scripted([prose.slice(0, 3998), 'more']);
  await runWrites(db, models, instance, settings, 8);
  assert.equal(requests.length, 1);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: prose.slice(0, 3998), failed: null }]);
  const near = fakeDb([[job({ tokens: 2000 })]]);
  const more = scripted([prose.slice(0, 3990), 'more', 'again']);
  await runWrites(near.db, more.models, instance, settings, 8);
  assert.equal(more.requests[1]!.maxChars, 4000 - 3990 - 2);
});

test('a short first answer then a scrub rejection: the short text is finished, not the rejection', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 200 })]]);
  const { models, requests } = scripted(['?', 'a badword', 'a badword']);
  await runWrites(db, models, instance, bytes, 8);
  assert.equal(requests.length, 3);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: '?', failed: null }]);
});

test('a short first answer then a transport failure: the short text is finished', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 200 })]]);
  const { models, requests } = scripted(['?', new TransportFailure('timed out')]);
  await runWrites(db, models, instance, bytes, 8);
  assert.equal(requests.length, 2);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: '?', failed: null }]);
});

test('a failed first call still finishes the job as a failure', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 200 })]]);
  await runWrites(db, scripted([new AnswerRejected('the completion is empty', 'nonEmpty')]).models, instance, bytes, 8);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: null, failed: 'nonEmpty' }]);
});

test('a database error on a top-up stops the run', async () => {
  const { db } = fakeDb([[job({ tokens: 200 })]]);
  await assert.rejects(runWrites(db, scripted(['?', new DatabaseError('boom', '57014', 500)]).models, instance, bytes, 8), DatabaseError);
});

test('no top-up starts once the deadline has passed since the first call: one call, the short text finished', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 200 })]]);
  let t = 0;
  const requests: CompletionRequest[] = [];
  const models = { complete: async (r: CompletionRequest) => { requests.push(r); t += 130_000; return { value: '?', usage: {}, provider: 'p', model: 'm', trims: [], retries: 0, costMicrodollars: 0 }; } } as unknown as Models;
  await runWrites(db, models, instance, bytes, 8, undefined, { now: () => t, budgetMs: 10_000_000 });
  assert.equal(requests.length, 1);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: '?', failed: null }]);
});

test('a regeneration after an edit tops up the same way, at the length the play recorded', async () => {
  for (const over of [{ tokens: 300, earlier: [{ play: P2, text: 'old tail' }] }, { tokens: 300, attempts: 2 }]) {
    const { db, calls } = fakeDb([[job(over)]]);
    const { models, requests } = scripted(['?', x(200)]);
    await runWrites(db, models, instance, bytes, 8);
    assert.equal(requests.length, 2);
    assert.equal(requests[0]!.maxTokens, 300);
    assert.equal(requests[1]!.maxTokens, 299);
    assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: `?\n\n${x(200)}`, failed: null }]);
  }
});

test('a share of 0.07 of a 100-token play is 7 tokens, not 8: a 7-token answer is full, one call', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 100 })]]);
  const { models, requests } = scripted([x(7)]);
  await runWrites(db, models, instance, { ...bytes, cardWriteFullShare: 0.07 }, 8);
  assert.equal(requests.length, 1);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: x(7), failed: null }]);
});

test('a top-up that would start just under the deadline still runs: a second call is made', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 200 })]]);
  let t = 0;
  const requests: CompletionRequest[] = [];
  const models = { complete: async (r: CompletionRequest) => { requests.push(r); t = 119_999; return { value: requests.length === 1 ? '?' : x(150), usage: {}, provider: 'p', model: 'm', trims: [], retries: 0, costMicrodollars: 0 }; } } as unknown as Models;
  await runWrites(db, models, instance, bytes, 8, undefined, { now: () => t, budgetMs: 10_000_000 });
  assert.equal(requests.length, 2);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: `?\n\n${x(150)}`, failed: null }]);
});

/* The claim is renewed before each top-up (issue #584; supabase/migrations/0354_card_write_claim_renewal.sql). */
const renewals = (calls: { fn: string; args: Record<string, unknown> }[]) => calls.filter((c) => c.fn === 'renew_card_write');

test('a short first answer then a top-up: the claim is renewed once, before the second call, and not before the first', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 200 })]]);
  const order: string[] = [];
  const inner = db.rpc;
  const logged: Db = { rpc: async <T>(fn: string, args: Record<string, unknown>) => { order.push(fn); return inner<T>(fn, args); } };
  const { models } = scripted(['?', x(150)]);
  const models2 = { complete: async (r: CompletionRequest) => { order.push('call'); return models.complete(r); } } as unknown as Models;
  await runWrites(logged, models2, instance, bytes, 8);
  assert.deepEqual(renewals(calls).map((c) => c.args), [{ play: P1, version: V, attempts: 1 }]);
  assert.deepEqual(order, ['claim_card_writes', 'call', 'renew_card_write', 'call', 'finish_card_write', 'claim_card_writes']);
});

test('four short answers renew three times', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 200 })]]);
  const { models, requests } = scripted([x(3), x(4), x(5), x(6)]);
  await runWrites(db, models, instance, bytes, 8);
  assert.equal(requests.length, 4);
  assert.equal(renewals(calls).length, 3);
});

test('a full first answer never renews', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 200 })]]);
  await runWrites(db, scripted([x(100)]).models, instance, bytes, 8);
  assert.equal(renewals(calls).length, 0);
});

test('a renewal that says the claim is no longer this run\'s ends the job quietly: no top-up, no finish', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 200 })]], { renew: false });
  const { models, requests } = scripted(['?', x(150)]);
  const out = await runWrites(db, models, instance, bytes, 8);
  assert.equal(requests.length, 1);
  assert.equal(renewals(calls).length, 1);
  assert.deepEqual(finishes(calls), []);
  assert.deepEqual(out, { claimed: 1, written: 0, failed: 0, errored: 0 });
});

test('a database error from the renewal stops the run', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 200 })]], { failOn: 'renew_card_write' });
  const { models, requests } = scripted(['?', x(150)]);
  await assert.rejects(runWrites(db, models, instance, bytes, 8), DatabaseError);
  assert.equal(requests.length, 1);
  assert.deepEqual(finishes(calls), []);
});

test('a scrubbed first answer renews the claim once, before the second call', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 200 })]]);
  const order: string[] = [];
  const inner = db.rpc;
  const logged: Db = { rpc: async <T>(fn: string, args: Record<string, unknown>) => { order.push(fn); return inner<T>(fn, args); } };
  const { models } = scripted(['a badword', x(150)]);
  const models2 = { complete: async (r: CompletionRequest) => { order.push('call'); return models.complete(r); } } as unknown as Models;
  await runWrites(logged, models2, instance, bytes, 8);
  assert.deepEqual(renewals(calls).map((c) => c.args), [{ play: P1, version: V, attempts: 1 }]);
  assert.deepEqual(order, ['claim_card_writes', 'call', 'renew_card_write', 'call', 'finish_card_write', 'claim_card_writes']);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: x(150), failed: null }]);
});

test('a renewal that says no before the regeneration makes no second call and no finish', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 200 })]], { renew: false });
  const { models, requests } = scripted(['a badword', x(150)]);
  const out = await runWrites(db, models, instance, bytes, 8);
  assert.equal(requests.length, 1);
  assert.equal(renewals(calls).length, 1);
  assert.deepEqual(finishes(calls), []);
  assert.deepEqual(out, { claimed: 1, written: 0, failed: 0, errored: 0 });
});

test('a database error from the renewal before the regeneration stops the run', async () => {
  const { db, calls } = fakeDb([[job({ tokens: 200 })]], { failOn: 'renew_card_write' });
  const { models, requests } = scripted(['a badword', x(150)]);
  await assert.rejects(runWrites(db, models, instance, bytes, 8), DatabaseError);
  assert.equal(requests.length, 1);
  assert.deepEqual(finishes(calls), []);
});
