import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONCESSIONS_PER_RUN, runConcessions } from './concession.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { instance as realInstance } from '../_shared/instance.ts';
import { placeholderWorld } from '../../../instances/divided-world/system/fixtures/index.ts';
import { placeholderMonitor } from '../../../instances/divided-world/system/fixtures/placeholder-monitor.ts';
import { AnswerRejected, LedgerWriteFailed } from '../_shared/models/index.ts';
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

const pend = (visit: string, post: string, staff = MON) => ({
  visit_act: visit, staff, post_act: post, thread: T1, board: GAMES, board_name: 'Games', started_at: '2026-11-07T09:00:00.000Z',
  charges: [{ rule: 'Rule 2: no double posting', rule_number: 2, board: GAMES, band: 'moderate', cause: 'rule', about_act: post }],
});

interface World {
  enabled?: boolean; pending?: ReturnType<typeof pend>[]; today?: number; modBots?: Record<string, unknown>;
  office?: string | null; body?: string; name?: string; extras?: Record<string, unknown>;
  ended?: Set<string>; failOn?: Record<string, 'always'>;
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
        case 'instance_settings': return { economy: base.settings.economy, systemEnabled: w.enabled ?? true, modBots: { ...base.settings.modBots, concessionsPerDay: 60, concessionWriteMinutes: 15, ...(w.modBots ?? {}) } } as T;
        case 'pending_concessions': return pending.filter((p) => !written.has(p.visit_act)).slice(0, Number(args.most)) as T;
        case 'concession_calls_today': return (w.today ?? 0) as T;
        case 'mod_standing': return { office: w.office === undefined ? 'mod' : w.office, allowance: 1, order: null, beat: [{ id: GAMES, name: 'Games' }] } as T;
        case 'pool_read': {
          const v = pending.find((x) => x.post_act === (args.named as string[])[0])!;
          return { title: 'Best Mario game?', self: null, posts: [{ act: v.post_act, seq: 1, at: '2026-11-04T09:00:00.000Z', author: 'bob', name: w.name ?? 'Bob', pronouns: null, body: w.body ?? 'Odyssey. Odyssey.', replyTo: null, quotes: [], ...w.extras }] } as T;
        }
        case 'write_visit_concession': {
          const v = String(args.visit);
          if (w.ended?.has(v)) return { written: false, ended: true } as T;
          const standing = written.get(v);
          if (standing) return { written: false, ...standing } as T;
          const row = { source: args.source, body: args.body, why: args.why };
          written.set(v, row);
          return { written: true, source: row.source, ...(row.body ? { body: row.body } : {}), ...(row.why ? { why: row.why } : {}) } as T;
        }
        case 'record_staff_call': records.push({ cause_act: String(args.cause_act), duty: String(args.duty), staff: String(args.staff), record: args.record }); return { recorded: true } as T;
        default: throw new Error(`the fake database has no ${fn}`);
      }
    },
  };
  return { db, calls, written, records, of: (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.args), count: (fn: string) => calls.filter((c) => c.fn === fn).length };
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

test('a bribe visit gets a model row: one light concession call naming the Mod, written and recorded', async () => {
  const d = fakeDb();
  const m = fakeModels();
  const out = await run(d, m);
  assert.equal(d.of('pending_concessions')[0]!.most, CONCESSIONS_PER_RUN);
  assert.equal(m.chats.length, 1);
  assert.deepEqual([m.chats[0]!.duty, m.chats[0]!.tier, m.chats[0]!.staff], ['concession', 'light', MON]);
  assert.match(m.chats[0]!.messages[0]!.content, /Odyssey\. Odyssey\./);
  assert.match(m.chats[0]!.messages[0]!.content, /paid you/);
  assert.deepEqual(d.of('write_visit_concession'), [{ visit: V1, source: 'model', body: 'Fine, {who}. Take it.', why: null }]);
  assert.deepEqual(d.records, [{ cause_act: V1, duty: 'concession', staff: MON, record: { source: 'model', trims: [], calls: 1 } }]);
  assert.deepEqual(out.concessions.map((c) => [c.visit, c.status, c.source]), [[V1, 'written', 'model']]);
});

test('a distraction visit is told it was distracted', async () => {
  const m = fakeModels();
  await run(fakeDb(), m, distract);
  assert.match(m.chats[0]!.messages[0]!.content, /distracted you/);
});

test('a rejected answer writes a none row with the predicate on the record, and so do a failed call and a model-layer rejection', async () => {
  for (const reply of [() => ({ concession: '   ' }), () => ({}), () => new AnswerRejected('not json', 'validJson'), () => new Error('provider said no')]) {
    const d = fakeDb();
    const m = fakeModels(reply);
    await run(d, m);
    assert.equal(m.chats.length, 1);
    const w = d.of('write_visit_concession')[0]!;
    assert.deepEqual([w.source, w.body], ['none', null]);
    assert.ok(w.why, 'the reason is written');
    assert.equal(d.records[0]!.record.source, 'none');
    assert.equal(d.records[0]!.record.why, w.why);
  }
  const d = fakeDb();
  await run(d, fakeModels(() => ({ concession: '' })));
  assert.match(d.of('write_visit_concession')[0]!.why, /concession: blank/);
  await assert.rejects(run(fakeDb(), fakeModels(() => new LedgerWriteFailed('no ledger'))), LedgerWriteFailed);
});

test('a spent day, a System switched off, a missing or departed Mod: none rows, no call', async () => {
  for (const w of [{ today: 60 }, { enabled: false }, { modBots: { concessionsPerDay: 0 } }, { office: null }, { pending: [pend(V1, P1, 'nobody-at-all')] }] as World[]) {
    const d = fakeDb(w);
    const m = fakeModels();
    await run(d, m);
    assert.equal(m.chats.length + m.completes.length, 0, JSON.stringify(w));
    assert.equal(d.of('write_visit_concession')[0]!.source, 'none');
    assert.ok(d.of('write_visit_concession')[0]!.why);
    assert.equal(d.records[0]!.record.calls, 0);
  }
});

test('the day\'s budget counts this run\'s calls', async () => {
  const d = fakeDb({ today: 59, pending: [pend(V1, P1), pend(V2, P2)] });
  const m = fakeModels();
  await run(d, m);
  assert.equal(m.chats.length, 1);
  assert.deepEqual(d.of('write_visit_concession').map((a) => a.source), ['model', 'none']);
  assert.match(d.records[1]!.record.why, /concessionsPerDay is spent/);
});

test('a visit already ended or already written is skipped by the answer, and its record says so', async () => {
  const d = fakeDb({ ended: new Set([V1]) });
  const out = await run(d, fakeModels());
  assert.deepEqual(out.concessions.map((c) => c.status), ['skipped']);
  assert.equal(d.records[0]!.record.skipped, true);
  const none = fakeDb({ ended: new Set([V1]), enabled: false });
  await run(none, fakeModels());
  assert.equal(none.records.length, 0, 'nothing was called, nothing to record');
});

test('a failed read writes none with the reason, and a database error leaves the visit', async () => {
  const d = fakeDb({ failOn: { pool_read: 'always' } });
  const m = fakeModels();
  await run(d, m);
  assert.equal(m.chats.length, 0);
  assert.match(d.of('write_visit_concession')[0]!.why, /^the read failed: /);
  const e = fakeDb({ failOn: { write_visit_concession: 'always' } });
  const out = await run(e, fakeModels());
  assert.deepEqual(out.concessions.map((c) => c.status), ['left']);
});

test('a post with a redaction reaches the prompt as readers see it: a hidden body blank, a play\'s seen line over it, a veil\'s stand-in author', async () => {
  const withCard: Instance = { ...bribe, cards: [...bribe.cards, { ...bribe.cards[0]!, key: 'fake-card', name: 'Fake Card', seen: () => 'A SEEN LINE lies over this post.' }] };
  const play = { play: 'play-1', card: 'fake-card', at: '2026-11-04T09:30:00.000Z', by: null, config: null, state: null, text: null, covered: null };
  const m = fakeModels();
  await run(fakeDb({ body: '', name: 'A Veiled Stranger', extras: { plays: [play] } }), m, withCard);
  const message = m.chats[0]!.messages[0]!.content;
  assert.ok(!message.includes('Odyssey'));
  assert.match(message, /<<<post\n\npost>>>/);
  assert.match(message, /by A Veiled Stranger/);
  assert.ok(message.includes('A SEEN LINE lies over this post.'), message);
});

test('an old-voice Mod makes its concession on a completion, not a chat', async () => {
  const d = fakeDb();
  const m = fakeModels(() => ' Fine, {who}.');
  await run(d, m, oldVoice);
  assert.equal(m.chats.length, 0);
  assert.equal(m.completes.length, 1);
  assert.deepEqual([m.completes[0]!.duty, m.completes[0]!.staff, m.completes[0]!.maxChars], ['concession', MON, 280]);
  assert.match(m.completes[0]!.prompt, /Odyssey\. Odyssey\./);
  assert.match(m.completes[0]!.prompt, /was paid, and \{who\} paid it/);
  assert.equal(d.of('write_visit_concession')[0]!.source, 'model');
  assert.equal(d.of('write_visit_concession')[0]!.body, 'Fine, {who}.');
});

test('nothing pending reads nothing else', async () => {
  const d = fakeDb({ pending: [] });
  const out = await run(d, fakeModels());
  assert.equal(out.due, 0);
  assert.deepEqual(d.calls.map((c) => c.fn), ['pending_concessions']);
});
