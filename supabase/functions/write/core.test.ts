import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWrites } from './core.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { TransportFailure } from '../_shared/models/transport.ts';
import { instance as base } from '../_shared/instance.ts';
import { AnswerRejected, type CompletionRequest, type Models } from '../../../engine/system/model.ts';
import type { CardRules } from '../../../engine/rules/cards.ts';
import type { Instance } from '../../../engine/rules/types.ts';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const V = '44444444-4444-4444-8444-444444444444';

const frames: unknown[] = [];
const card = {
  key: 'echo', name: 'Echo',
  writes: {
    tokens: (config: { steps: number }) => 100 + config.steps * 50,
    frame: (input: unknown) => { frames.push(input); return { prompt: 'PROMPT', stop: ['\n\n'] }; },
  },
} as unknown as CardRules;
const instance: Instance = { ...base, cards: [...base.cards, card], system: { ...base.system, scrubWords: ['badword'] } };

const job = (over: Record<string, unknown> = {}) => ({
  play: P1, version: V, post: POST, thread: 't', attempts: 1, card: 'echo', config: { steps: 2 }, author: 'Mallory',
  body: 'Hello [b]there[/b] [code]hidden[/code] friend', title: 'A title', before: [{ name: 'Ann', body: '[i]first[/i]' }], earlier: [], ...over,
});

function fakeDb(rounds: unknown[][], o: { failOn?: string } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const queue = [...rounds];
  const db: Db = { rpc: async <T>(fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (o.failOn === fn) throw new DatabaseError('boom', '57014', 500);
    if (fn === 'claim_card_writes') return (queue.shift() ?? []) as T;
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
  const { models, requests } = fakeModels(() => 'and so it went on');
  const out = await run(db, models);
  assert.deepEqual(finishes(calls), [{ play: P1, version: V, text: 'and so it went on', failed: null }]);
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
