import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONCESSIONS_PER_RUN, runConcessions } from './concession.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { instance as realInstance } from '../_shared/instance.ts';
import { placeholderWorld } from '../../../instances/divided-world/system/fixtures/index.ts';
import { placeholderMonitor } from '../../../instances/divided-world/system/fixtures/placeholder-monitor.ts';
import { AnswerRejected, LedgerWriteFailed } from '../_shared/models/index.ts';
import { CHATTER_TOKENS } from '../../../engine/system/chatter.ts';
import { outcomePostMost } from '../../../engine/system/judgment.ts';
import { OLD_VOICE_POST_TOKENS } from './core.ts';
import type { ChatRequest, CompletionRequest, ModelResult, Models } from '../../../engine/system/model.ts';
import type { Instance, Persona } from '../../../engine/rules/types.ts';

const base: Instance = placeholderWorld(realInstance);
const SLOT = '2026-11-07T10:00:00.000Z';
const MON = 'placeholder-monitor';
const GAMES = '11111111-1111-4111-8111-111111111111';
const V1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const V2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const P1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const T1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

/** The placeholder Mod, with its weakness and voice changed. */
const worldOf = (patch: Partial<Persona>): Instance => ({ ...base, system: { ...base.system, roster: base.system.roster.map((p) => (p.key === MON ? { ...placeholderMonitor, ...patch } : p)) } });
const bribe = worldOf({ weakness: { kind: 'bribe', price: 150 } });
const distract = worldOf({ weakness: { kind: 'distraction' } });
const oldVoice = worldOf({ weakness: { kind: 'bribe', price: 150 }, voice: 'oldVoice' });

const WARIO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const SHE = { subject: 'she', object: 'her', determiner: 'her', possessive: 'hers', reflexive: 'herself', plural: false };
const E1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const E2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';

const pend = (visit: string, post: string, staff = MON, over: Record<string, unknown> = {}) => ({
  visit_act: visit, end_act: visit === V1 ? E1 : E2, staff, post_act: post, thread: T1, board: GAMES, board_name: 'Games', board_premise: 'Talk about games, and only games.', interceptor_id: WARIO, owed_at: '2026-11-07T09:00:00.000Z',
  charges: [{ rule: 'Rule 2: no double posting', rule_number: 2, board: GAMES, band: 'moderate', cause: 'rule', about_act: post }],
  interceptor_name: 'Wario', how: 'paid', question: null, choices: null, answer: null, price: 150, card: null, ...over,
});

interface World {
  enabled?: boolean; pending?: ReturnType<typeof pend>[]; today?: number; modBots?: Record<string, unknown>;
  office?: string | null; body?: string; name?: string; extras?: Record<string, unknown>;
  posted?: Record<string, unknown>; failOn?: Record<string, 'always'>; faces?: unknown;
}
function fakeDb(w: World = {}) {
  const calls: { fn: string; args: Record<string, any> }[] = [];
  const posted = new Set<string>();
  const records: { cause_act: string; duty: string; staff: string; record: any }[] = [];
  const pending = w.pending ?? [pend(V1, P1)];
  const db: Db = {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      if (w.failOn?.[fn]) throw new DatabaseError(`${fn}: the connection dropped`, '08006', 500);
      switch (fn) {
        case 'instance_settings': return { economy: base.settings.economy, systemEnabled: w.enabled ?? true, modBots: { ...base.settings.modBots, concessionsPerDay: 60, ...(w.modBots ?? {}) } } as T;
        case 'pending_concessions': return pending.filter((p) => !posted.has(p.visit_act)).slice(0, Number(args.most)) as T;
        case 'character_faces': return Object.fromEntries((args.ids as string[]).map((id) => [id, { name: 'Wario', pronouns: w.faces === undefined ? SHE : w.faces }])) as T;
        case 'concession_calls_today': return (w.today ?? 0) as T;
        case 'mod_standing': return { office: w.office === undefined ? 'mod' : w.office, allowance: 1, order: null, beat: [{ id: GAMES, name: 'Games' }] } as T;
        case 'staff_career': return { led: [], offices: [] } as T;
        case 'staff_memory_latest': case 'staff_memory_at': return null as T;
        case 'staff_notes_recent': case 'rules_in_force': return [] as T;
        case 'pool_read': {
          const v = pending.find((x) => x.post_act === (args.named as string[])[0])!;
          return { title: 'Best Mario game?', self: null, posts: [{ act: v.post_act, seq: 1, at: '2026-11-04T09:00:00.000Z', author: 'bob', name: w.name ?? 'Bob', pronouns: null, body: w.body ?? 'Odyssey. Odyssey.', replyTo: null, quotes: [], ...w.extras }] } as T;
        }
        case 'post_visit_concession': {
          const v = String(args.visit);
          if (w.posted) return w.posted as T;
          if (posted.has(v)) return { posted: false, existing: true, post: 'p-' + v } as T;
          posted.add(v);
          return { posted: true, existing: false, post: 'p-' + v } as T;
        }
        case 'record_staff_call': records.push({ cause_act: String(args.cause_act), duty: String(args.duty), staff: String(args.staff), record: args.record }); return { recorded: true } as T;
        default: throw new Error(`the fake database has no ${fn}`);
      }
    },
  };
  return { db, calls, posted, records, of: (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.args), count: (fn: string) => calls.filter((c) => c.fn === fn).length };
}
const result = <T,>(value: T): ModelResult<T> => ({ value, usage: {}, provider: 'fake', model: 'fake', trims: [], retries: 0, costMicrodollars: 0 });
function fakeModels(reply: (r: ChatRequest | CompletionRequest) => unknown = () => ({ concession: 'Fine, {who}. Take it.' })) {
  const chats: ChatRequest[] = [];
  const completes: CompletionRequest[] = [];
  const models: Models = {
    async chat(r) { chats.push(r); const out = reply(r); if (out instanceof Error) throw out; return result(out) as never; },
    async complete(r) { completes.push(r); const out = reply(r); if (out instanceof Error) throw out; return result(out) as never; },
  };
  return { models, chats, completes };
}
const run = (d: ReturnType<typeof fakeDb>, m: { models: Models }, instance: Instance = bribe) => runConcessions(d.db, m.models, instance, SLOT, () => Date.parse(SLOT));

test('a talk-down\'s concession call reads the thread and the facts, and the post goes through post_visit_concession', async () => {
  const d = fakeDb();
  const m = fakeModels();
  const out = await run(d, m);
  assert.equal(d.of('pending_concessions')[0]!.most, CONCESSIONS_PER_RUN);
  assert.equal(m.chats.length, 1);
  assert.deepEqual([m.chats[0]!.duty, m.chats[0]!.tier, m.chats[0]!.staff, m.chats[0]!.maxTokens], ['concession', 'light', MON, CHATTER_TOKENS]);
  const message = m.chats[0]!.messages[0]!.content;
  assert.match(message, /Best Mario game\?/, 'the thread\'s title');
  assert.match(message, /Odyssey\. Odyssey\./, 'the visited post as readers see it');
  assert.match(message, /Rule 2: no double posting/);
  assert.match(message, /Wario/);
  assert.match(message, /paid you 1\.50 Aura/);
  assert.deepEqual(d.of('post_visit_concession'), [{ visit: V1, body: 'Fine, {who}. Take it.' }]);
  assert.deepEqual(d.records, [{ cause_act: V1, duty: 'concession', staff: MON, record: { source: 'model', trims: [], calls: 1 } }]);
  assert.deepEqual(out.concessions.map((c) => [c.visit, c.status, c.source]), [[V1, 'posted', 'model']]);
  assert.ok(d.calls.findIndex((c) => c.fn === 'record_staff_call') < d.calls.findIndex((c) => c.fn === 'post_visit_concession'), 'the billed call is recorded before the post');
});

test('the facts of an answered talk-down and a distraction reach the prompt', async () => {
  const answered = pend(V1, P1, MON, { how: 'answered', price: null, question: 'What did Bob say twice?', choices: ['Odyssey', 'Sunshine'], answer: 'Odyssey' });
  const m = fakeModels();
  await run(fakeDb({ pending: [answered] }), m);
  assert.match(m.chats[0]!.messages[0]!.content, /What did Bob say twice\?/);
  assert.match(m.chats[0]!.messages[0]!.content, /answered your question right/);
  const n = fakeModels();
  await run(fakeDb({ pending: [pend(V1, P1, MON, { how: 'distracted', price: null, card: 'Whoops!' })] }), n, distract);
  assert.match(n.chats[0]!.messages[0]!.content, /distracted you with a card: Whoops!/);
});

test('a rejected answer posts nothing and records the predicate; so do a failed call and a model-layer rejection', async () => {
  for (const reply of [() => ({ concession: '   ' }), () => ({}), () => new AnswerRejected('not json', 'validJson'), () => new Error('provider said no')]) {
    const d = fakeDb();
    const out = await run(d, fakeModels(reply));
    assert.equal(d.count('post_visit_concession'), 0);
    assert.equal(out.concessions[0]!.status, 'none');
    assert.ok(out.concessions[0]!.why);
    assert.deepEqual([d.records[0]!.record.source, d.records[0]!.record.calls], ['none', 1]);
    assert.equal(d.records[0]!.record.why, out.concessions[0]!.why);
  }
  const d = fakeDb();
  await run(d, fakeModels(() => ({ concession: '' })));
  assert.match(d.records[0]!.record.why, /concession: blank/);
  await assert.rejects(run(fakeDb(), fakeModels(() => new LedgerWriteFailed('no ledger'))), LedgerWriteFailed);
});

test('over budget, a System switched off, or a missing or departed Mod: no call and nothing posted, and the tick\'s stock follows', async () => {
  for (const w of [{ today: 60 }, { enabled: false }, { modBots: { concessionsPerDay: 0 } }, { office: null }, { pending: [pend(V1, P1, 'nobody-at-all')] }] as World[]) {
    const d = fakeDb(w);
    const m = fakeModels();
    const out = await run(d, m);
    assert.equal(m.chats.length + m.completes.length, 0, JSON.stringify(w));
    assert.equal(d.count('post_visit_concession'), 0);
    assert.equal(d.records.length, 0, 'no call, no record');
    assert.equal(out.concessions[0]!.status, 'none');
    assert.ok(out.concessions[0]!.why);
  }
});

test('the day\'s budget counts this run\'s calls', async () => {
  const d = fakeDb({ today: 59, pending: [pend(V1, P1), pend(V2, P2)] });
  const m = fakeModels();
  const out = await run(d, m);
  assert.equal(m.chats.length, 1);
  assert.deepEqual(d.of('post_visit_concession').map((a) => a.visit), [V1]);
  assert.match(out.concessions[1]!.why!, /concessionsPerDay is spent/);
});

test('a concession already posted, or not owed, is not a post of this run; the call that was billed is recorded', async () => {
  const d = fakeDb({ posted: { posted: false, existing: true, post: 'p' } });
  const out = await run(d, fakeModels());
  assert.deepEqual(out.concessions.map((c) => c.status), ['existing']);
  assert.equal(d.records[0]!.record.calls, 1);
  const gone = fakeDb({ posted: { posted: false, owed: false } });
  assert.equal((await run(gone, fakeModels())).concessions[0]!.status, 'existing');
  const refused = fakeDb({ posted: { posted: false, existing: false, error: 'the Mod is banned there' } });
  const r = await run(refused, fakeModels());
  assert.deepEqual([r.concessions[0]!.status, r.concessions[0]!.why], ['none', 'the Mod is banned there']);
});

test('a failed read posts nothing and a database error leaves the visit', async () => {
  const d = fakeDb({ failOn: { pool_read: 'always' } });
  const m = fakeModels();
  const out = await run(d, m);
  assert.equal(m.chats.length, 0);
  assert.match(out.concessions[0]!.why!, /^the read failed: /);
  assert.equal(d.count('post_visit_concession'), 0);
  const e = fakeDb({ failOn: { post_visit_concession: 'always' } });
  const left = await run(e, fakeModels());
  assert.deepEqual(left.concessions.map((c) => c.status), ['left']);
  assert.equal(e.records.length, 1, 'the billed call is on the record');
});

test('a post with a redaction reaches the prompt as readers see it: a hidden body blank, a play\'s seen line over it, a veil\'s stand-in author', async () => {
  const withCard: Instance = { ...bribe, cards: [...bribe.cards, { ...bribe.cards[0]!, key: 'fake-card', name: 'Fake Card', seen: () => 'A SEEN LINE lies over this post.' }] };
  const play = { play: 'play-1', card: 'fake-card', at: '2026-11-04T09:30:00.000Z', by: null, config: null, state: null, text: null, covered: null };
  const m = fakeModels();
  await run(fakeDb({ body: '', name: 'A Veiled Stranger', extras: { plays: [play] } }), m, withCard);
  const message = m.chats[0]!.messages[0]!.content;
  assert.ok(!message.includes('Odyssey'));
  assert.match(message, /A Veiled Stranger/);
  assert.ok(message.includes('A SEEN LINE lies over this post.'), message);
});

test('an old-voice Mod writes by completion, at the chatter\'s post bounds', async () => {
  const d = fakeDb();
  const m = fakeModels(() => ' Fine, {who}.');
  await run(d, m, oldVoice);
  assert.equal(m.chats.length, 0);
  assert.equal(m.completes.length, 1);
  const c = m.completes[0]!;
  assert.deepEqual([c.duty, c.staff], ['concession', MON]);
  assert.ok(c.maxTokens! <= OLD_VOICE_POST_TOKENS && c.maxTokens! > 120);
  assert.equal(c.maxChars, outcomePostMost(base.settings.postMaxLength));
  assert.match(c.prompt, /Odyssey\. Odyssey\./);
  assert.match(c.prompt, /was paid, and Wario paid it/);
  assert.deepEqual(d.of('post_visit_concession'), [{ visit: V1, body: 'Fine, {who}.' }]);
});

test('nothing pending reads nothing else', async () => {
  const d = fakeDb({ pending: [] });
  const out = await run(d, fakeModels());
  assert.equal(out.due, 0);
  assert.deepEqual(d.calls.map((c) => c.fn), ['pending_concessions']);
});

test('the prompt carries the board\'s premise and the interceptor\'s own pronouns, read from character_faces', async () => {
  const d = fakeDb();
  const m = fakeModels();
  await run(d, m);
  const message = m.chats[0]!.messages[0]!.content;
  assert.match(message, /Talk about games, and only games\./);
  assert.match(message, /Wario \(she\/her\)/);
  assert.deepEqual(d.of('character_faces'), [{ ids: [WARIO] }]);
  // A character with no profile row reads null: the instance's default.
  const n = fakeModels();
  await run(fakeDb({ faces: null }), n);
  assert.match(n.chats[0]!.messages[0]!.content, /Wario \(it\/its\)/);
});

test('a post that fails after the recorded call still counts the call made', async () => {
  const d = fakeDb({ failOn: { post_visit_concession: 'always' } });
  const out = await run(d, fakeModels());
  assert.deepEqual(out.concessions.map((c) => [c.status, c.calls]), [['left', 1]]);
  assert.equal(d.records.length, 1);
});
