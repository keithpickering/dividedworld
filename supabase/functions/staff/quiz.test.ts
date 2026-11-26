import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUIZZES_PER_RUN, runQuizzes } from './quiz.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { instance as realInstance } from '../_shared/instance.ts';
import { placeholderWorld } from '../../../instances/divided-world/system/fixtures/index.ts';
import { AnswerRejected, LedgerWriteFailed } from '../_shared/models/index.ts';
import { ProviderRefusal } from '../_shared/models/transport.ts';
import type { ChatRequest, ModelResult, Models } from '../../../engine/system/model.ts';
import type { Instance } from '../../../engine/rules/types.ts';

const dividedWorld: Instance = placeholderWorld(realInstance);
const SLOT = '2026-11-07T10:00:00.000Z';
const MON = 'placeholder-monitor';
const GAMES = '11111111-1111-4111-8111-111111111111';
const V1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const V2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const P1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const T1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

const pend = (visit: string, post: string, staff = MON) => ({
  visit_act: visit, staff, post_act: post, thread: T1, board: GAMES, board_name: 'Games', started_at: '2026-11-07T09:00:00.000Z',
  charges: [{ rule: 'Rule 2: no double posting', rule_number: 2, board: GAMES, band: 'moderate', cause: 'rule', about_act: post }],
});
const BANK = { question: 'The bank asks: which?', choices: ['One', 'Two'], answer: 'One' };
const GOOD = { question: 'What did Bob say twice?', choices: ['Odyssey', 'Sunshine', 'Galaxy'], answer: 'Odyssey' };

interface World {
  enabled?: boolean; pending?: ReturnType<typeof pend>[]; today?: number; modBots?: Record<string, unknown>;
  office?: string | null; body?: string; name?: string; extras?: Record<string, unknown>; bank?: boolean;
  standing?: Set<string>; failOn?: Record<string, 'always'>;
}
function fakeDb(w: World = {}) {
  const calls: { fn: string; args: Record<string, any> }[] = [];
  const written = new Map<string, any>();
  const records: { cause_act: string; duty: string; staff: string; record: any }[] = [];
  const pending = w.pending ?? [pend(V1, P1)];
  const db: Db = {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      if (w.failOn?.[fn]) throw new DatabaseError(`${fn}: the connection dropped`, '08006', 500);
      switch (fn) {
        case 'instance_settings': return { economy: dividedWorld.settings.economy, systemEnabled: w.enabled ?? true, modBots: { ...dividedWorld.settings.modBots, quizQuestionsPerDay: 60, quizWriteMinutes: 15, ...(w.modBots ?? {}) } } as T;
        case 'pending_quizzes': return pending.filter((p) => !written.has(p.visit_act)).slice(0, Number(args.most)) as T;
        case 'quiz_calls_today': return (w.today ?? 0) as T;
        case 'mod_standing': return { office: w.office === undefined ? 'mod' : w.office, allowance: 1, order: null, beat: [{ id: GAMES, name: 'Games' }] } as T;
        case 'pool_read': {
          const v = pending.find((x) => x.post_act === (args.named as string[])[0])!;
          return { title: 'Best Mario game?', self: null, posts: [{ act: v.post_act, seq: 1, at: '2026-11-04T09:00:00.000Z', author: 'bob', name: w.name ?? 'Bob', pronouns: null, body: w.body ?? 'Odyssey. Odyssey.', replyTo: null, quotes: [], ...w.extras }] } as T;
        }
        case 'bank_quiz_for': return (w.bank === false ? null : BANK) as T;
        case 'write_visit_quiz': {
          const v = String(args.visit);
          const standing = written.get(v);
          if (standing) return { written: false, ...standing } as T;
          const row = { source: args.source, question: args.question, choices: args.choices, answer: args.answer };
          written.set(v, row);
          return { written: true, ...row } as T;
        }
        case 'record_staff_call': records.push({ cause_act: String(args.cause_act), duty: String(args.duty), staff: String(args.staff), record: args.record }); return { recorded: true } as T;
        default: throw new Error(`the fake database has no ${fn}`);
      }
    },
  };
  return { db, calls, written, records, of: (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.args), count: (fn: string) => calls.filter((c) => c.fn === fn).length };
}
const result = <T,>(value: T): ModelResult<T> => ({ value, usage: {}, provider: 'fake', model: 'fake', trims: [], retries: 0, costMicrodollars: 0 });
function fakeModels(reply: (r: ChatRequest) => unknown = () => GOOD) {
  const chats: ChatRequest[] = [];
  const models: Models = {
    async chat(r) { chats.push(r); const out = reply(r); if (out instanceof Error) throw out; return result(out) as never; },
    async complete() { throw new Error('a quiz is a chat'); },
  };
  return { models, chats };
}
const run = (d: ReturnType<typeof fakeDb>, m: { models: Models }, instance: Instance = dividedWorld) => runQuizzes(d.db, m.models, instance, SLOT, () => Date.parse(SLOT));

test('a pending visit gets a model row from a good answer: one light quizQuestion call naming the Mod, written and recorded', async () => {
  const d = fakeDb();
  const m = fakeModels();
  const out = await run(d, m);
  assert.equal(d.of('pending_quizzes')[0]!.most, QUIZZES_PER_RUN);
  assert.equal(m.chats.length, 1);
  assert.deepEqual([m.chats[0]!.duty, m.chats[0]!.tier, m.chats[0]!.staff], ['quizQuestion', 'light', MON]);
  assert.match(m.chats[0]!.messages[0]!.content, /Odyssey\. Odyssey\./);
  assert.match(m.chats[0]!.messages[0]!.content, /Rule 2: no double posting/);
  assert.deepEqual(d.of('write_visit_quiz'), [{ visit: V1, source: 'model', ...GOOD }]);
  assert.deepEqual(d.records, [{ cause_act: V1, duty: 'quizQuestion', staff: MON, record: { source: 'model', trims: [], calls: 1 } }]);
  assert.deepEqual(out.quizzes.map((q) => [q.visit, q.status, q.source]), [[V1, 'written', 'model']]);
  assert.equal(d.count('bank_quiz_for'), 0);
});

test('a rejected answer writes the bank row with the predicate on the record', async () => {
  const d = fakeDb();
  const m = fakeModels(() => ({ question: 'Which?', choices: ['A', 'B'], answer: 'C' }));
  await run(d, m);
  assert.equal(m.chats.length, 1);
  assert.equal(d.of('write_visit_quiz')[0]!.source, 'bank');
  assert.deepEqual(d.of('write_visit_quiz')[0]!.question, BANK.question);
  assert.match(d.records[0]!.record.why, /answer: not one of the choices/);
  assert.equal(d.records[0]!.record.source, 'bank');
  assert.equal(d.records[0]!.record.calls, 1);
});

test('a failed call and a rejection by the model layer write the bank row; a ledger failure stops the run', async () => {
  for (const e of [new ProviderRefusal('provider said no', 500), new AnswerRejected('not json', 'validJson')]) {
    const d = fakeDb();
    await run(d, fakeModels(() => e));
    assert.equal(d.of('write_visit_quiz')[0]!.source, 'bank');
    assert.match(d.records[0]!.record.why, /^the (call failed|answer was rejected): /);
  }
  const d = fakeDb();
  await assert.rejects(run(d, fakeModels(() => new LedgerWriteFailed('no ledger'))), LedgerWriteFailed);
  assert.equal(d.count('write_visit_quiz'), 0);
});

test('a spent day and a System switched off write bank rows and make no call; the budget counts this run\'s calls', async () => {
  for (const w of [{ today: 60 }, { enabled: false }, { modBots: { quizQuestionsPerDay: 0 } }] as World[]) {
    const d = fakeDb(w);
    const m = fakeModels();
    await run(d, m);
    assert.equal(m.chats.length, 0, JSON.stringify(w));
    assert.equal(d.of('write_visit_quiz')[0]!.source, 'bank');
    assert.equal(d.records[0]!.record.calls, 0);
    assert.ok(d.records[0]!.record.why, 'the reason is on the record');
  }
  const d = fakeDb({ today: 59, pending: [pend(V1, P1), pend(V2, P2)] });
  const m = fakeModels();
  await run(d, m);
  assert.equal(m.chats.length, 1, 'the second visit finds the day spent');
  assert.deepEqual(d.of('write_visit_quiz').map((a) => a.source), ['model', 'bank']);
  assert.match(d.records[1]!.record.why, /quizQuestionsPerDay is spent/);
});

test('a modBots row without quizQuestionsPerDay makes no call: the run stops on the instance check, and a settings object that slips past it is the bank always', async () => {
  const row = { ...dividedWorld.settings.modBots } as Record<string, unknown>;
  delete row.quizQuestionsPerDay;
  const d = fakeDb({ modBots: row });
  // The fake merges the defaults back; replace the row whole, as the database's does.
  const whole: Db = { async rpc<T>(fn: string, args: Record<string, unknown>) { const r = await d.db.rpc<any>(fn, args); return (fn === 'instance_settings' ? { ...r, modBots: row } : r) as T; } };
  const m = fakeModels();
  await assert.rejects(runQuizzes(whole, m.models, dividedWorld, SLOT, () => Date.parse(SLOT)), /quizQuestionsPerDay/);
  assert.equal(m.chats.length, 0);
  assert.equal(d.count('write_visit_quiz'), 0);
});

test('a Mod gone from the roster, or no longer a Mod, gets a bank row and no call', async () => {
  const gone = fakeDb({ pending: [pend(V1, P1, 'nobody-at-all')] });
  const m = fakeModels();
  await run(gone, m);
  assert.equal(gone.of('write_visit_quiz')[0]!.source, 'bank');
  assert.match(gone.records[0]!.record.why, /not in the roster/);
  const left = fakeDb({ office: null });
  await run(left, m);
  assert.equal(left.of('write_visit_quiz')[0]!.source, 'bank');
  assert.match(left.records[0]!.record.why, /not a Mod now/);
  assert.equal(m.chats.length, 0);
});

test('a post with an admin-hidden version is sent blank: the read\'s own body, never the hidden words', async () => {
  const d = fakeDb({ body: '' });
  const m = fakeModels();
  await run(d, m);
  const message = m.chats[0]!.messages[0]!.content;
  assert.ok(!message.includes('Odyssey'), 'the hidden words appear nowhere in the prompt');
  assert.match(message, /<<<post\n\npost>>>/);
});

test('a veiled post\'s author is the read\'s stand-in, and a play\'s seen line reaches the prompt as a line over the post', async () => {
  const withCard: Instance = { ...dividedWorld, cards: [...dividedWorld.cards, { ...dividedWorld.cards[0]!, key: 'fake-card', name: 'Fake Card', seen: () => 'A SEEN LINE lies over this post.' }] };
  const play = { play: 'play-1', card: 'fake-card', at: '2026-11-04T09:30:00.000Z', by: null, config: null, state: null, text: null, covered: null };
  const d = fakeDb({ name: 'A Veiled Stranger', extras: { plays: [play] } });
  const m = fakeModels();
  await run(d, m, withCard);
  const message = m.chats[0]!.messages[0]!.content;
  assert.match(message, /by A Veiled Stranger/);
  assert.ok(!message.includes('Bob'));
  assert.ok(message.includes('A SEEN LINE lies over this post.'), message);
  assert.ok(message.indexOf('post>>>') < message.indexOf('A SEEN LINE'), 'the line is outside the quoted post');
});

test('a post under untouched Autocorrect tape is sent as the tape shows it, with the play\'s line over the post', async () => {
  const play = { play: 'play-1', card: 'autocorrect', at: '2026-11-04T09:30:00.000Z', by: 'Wario', config: { phrase: 'Odyssey', replacement: 'Sunshine Bridge' }, state: null, text: null, covered: null };
  const d = fakeDb({ extras: { plays: [play] } });
  const m = fakeModels();
  await run(d, m);
  const message = m.chats[0]!.messages[0]!.content;
  const shown = message.slice(message.indexOf('<<<post\n'), message.indexOf('post>>>'));
  assert.ok(shown.includes('Sunshine Bridge. Sunshine Bridge.'), message);
  assert.ok(!shown.includes('Odyssey'), 'the words under the tape are not in the quoted post');
  const after = message.slice(message.indexOf('post>>>'));
  assert.match(after, /taped over .*The post above reads as the tape shows it; the marker words are Wario's\./, 'the play\'s own line lies under the post');
});

test('a lost race records the standing row\'s source and writes nothing of its own', async () => {
  const d = fakeDb();
  d.written.set(V1, { source: 'bank', ...BANK });
  const real = d.db.rpc.bind(d.db);
  // The tick writes after this run has listed the visit.
  const racing: Db = { async rpc<T>(fn: string, args: Record<string, unknown>) { const r = await real<T>(fn, args); if (fn === 'pending_quizzes') return [pend(V1, P1)] as T; return r; } };
  const out = await runQuizzes(racing, fakeModels().models, dividedWorld, SLOT, () => Date.parse(SLOT));
  assert.deepEqual(out.quizzes.map((q) => [q.status, q.source]), [['lost', 'bank']]);
  assert.equal(d.records[0]!.record.source, 'bank');
  assert.equal(d.records[0]!.record.lost, true);
  assert.equal(d.written.get(V1).question, BANK.question, 'the standing row is untouched');
});

test('no bank question leaves the visit pending and says so on the record; a database error leaves it too', async () => {
  const d = fakeDb({ enabled: false, bank: false });
  const out = await run(d, fakeModels());
  assert.equal(d.count('write_visit_quiz'), 0);
  assert.equal(out.quizzes[0]!.status, 'left');
  assert.match(d.records[0]!.record.why, /no bank question/);
  const e = fakeDb({ enabled: false, pending: [pend(V1, P1), pend(V2, P2)], failOn: { bank_quiz_for: 'always' } });
  const bad = await run(e, fakeModels());
  assert.deepEqual(bad.quizzes.map((q) => q.status), ['left', 'left']);
});

test('a failed read banks with the reason on the record; a post absent from the read banks too; no call is made for either', async () => {
  const d = fakeDb({ pending: [pend(V1, P1), pend(V2, P2)], failOn: { pool_read: 'always' } });
  const m = fakeModels();
  const out = await run(d, m);
  assert.equal(m.chats.length, 0);
  assert.deepEqual(d.of('write_visit_quiz').map((a) => a.source), ['bank', 'bank']);
  assert.deepEqual(out.quizzes.map((q) => q.status), ['written', 'written']);
  assert.match(d.records[0]!.record.why, /^the read failed: /);
  const gone = fakeDb({ extras: { act: 'someone-elses' } });
  const n = fakeModels();
  await run(gone, n);
  assert.equal(n.chats.length, 0);
  assert.equal(gone.of('write_visit_quiz')[0]!.source, 'bank');
  assert.match(gone.records[0]!.record.why, /the post inspected cannot be read/);
});

test('nothing pending reads nothing else', async () => {
  const d = fakeDb({ pending: [] });
  const out = await run(d, fakeModels());
  assert.equal(out.due, 0);
  assert.deepEqual(d.calls.map((c) => c.fn), ['pending_quizzes']);
});
