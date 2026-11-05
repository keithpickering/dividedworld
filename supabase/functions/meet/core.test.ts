import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMeeting } from './core.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { instance as dividedWorld } from '../_shared/instance.ts';
import { AnswerRejected, LedgerWriteFailed } from '../_shared/models/index.ts';
import type { ChatRequest, CompletionRequest, ModelResult, Models } from '../../../engine/system/model.ts';
import type { Instance } from '../../../engine/rules/types.ts';
import type { Memory } from '../../../engine/system/memory.ts';

const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.parse('2026-11-01T12:00:00Z');
const SLOT = '2026-11-01T09:23:00.000Z';
const BOSS = dividedWorld.system.firstBoss;
const OTHER_BOSS = dividedWorld.system.roster.find((b) => b.key !== BOSS && !dividedWorld.system.firstStaff.includes(b.key))!.key;
const BOARD = '11111111-1111-4111-8111-111111111111';
const BOARD2 = '22222222-2222-4222-8222-222222222222';
const HOT = '33333333-3333-4333-8333-333333333333';
const ANN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HIDDEN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NAMES = ['Pirate Puns Palace', 'Big Bad Bowser', 'Koopa Kart Klub', 'Silly Snake Society', 'Wario Wants Waluigi', 'Tidy Turtle Tower', 'Moody Mushroom Mansion'];

const memory = (hobby = 'pro wrestling'): Memory => ({ hobby: { name: hobby, since: '2026-10-01', from: 'Ann' }, opinions: [], grudges: [], wheelhouse: [], realWorld: [], marks: [] });

function rename(i: number, extra: Record<string, unknown> = {}) {
  return {
    kind: 'renameBoard',
    params: { board: BOARD, name: NAMES[i % NAMES.length], premise: `Everything about thing number ${i}.` },
    demand: { kind: 'postsOnBoard', params: { board: BOARD, count: 10 } },
    go_live_at: new Date(NOW + 30 * H).toISOString(),
    expires_in_hours: 72,
    why: `Reason ${i}.`,
    ...extra,
  };
}
function answer(moves: unknown[] = [], extra: Record<string, unknown> = {}) {
  return {
    memory: { hobby: { name: 'pro wrestling', since: '2026-11-01', from: 'Ann' }, opinions: [{ character: ANN, score: 3, note: 'Cut a good promo.' }], grudges: [], wheelhouse: ['mario hacks'], realWorld: [], marks: [] },
    profile: { interests: ['wrestling'], favorites: [ANN], mood: 'smug', signature: 'It is decided.' },
    moves,
    ...extra,
  };
}

interface World {
  enabled?: boolean;
  bank?: number;
  /** The season's end, relative to NOW. */
  endsIn?: number;
  /** The moves the Boss inherits, as meeting_context() hands them over (absent: an older database that does not). */
  inheritanceDue?: unknown[];
  memories?: Record<string, Memory>;
  closed?: boolean;
  open?: boolean;
  failOn?: string | string[];
  publicIds?: string[];
  boss?: string;
  /** The keys meeting_context() lists as a nomination's candidates (default: the roster but the Boss). */
  successors?: string[];
  /** What staff_career returns for the Boss (default: it has led nothing). */
  career?: { led: unknown[]; offices: unknown[] };
  /** What staff_notes_recent returns for the Boss (default: none). */
  notes?: string[];
  /** When the Boss's latest memory version was written (staff_memory_at; default: with the last meeting's slot). */
  memoryAt?: string;
}
function fakeDb(w: World = {}) {
  const calls: { fn: string; args: Record<string, any> }[] = [];
  const state = { closed: w.closed ?? false, open: w.open ?? false, applied: [] as Record<string, any>[], failed: [] as Record<string, any>[], meeting: 7 };
  const db: Db = {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      if ([w.failOn ?? []].flat().includes(fn)) throw new DatabaseError(`${fn}: the connection dropped`, '08006', 500);
      switch (fn) {
        case 'instance_settings': return { economy: dividedWorld.settings.economy, systemEnabled: w.enabled ?? true } as T;
        case 'begin_meeting':
          if (state.closed) return { status: 'already met', meeting: state.meeting } as T;
          if (state.open) return { status: 'resumed', meeting: state.meeting } as T;
          state.open = true;
          return { status: 'begun', meeting: state.meeting } as T;
        case 'fail_meeting': state.failed.push(args); state.closed = true; return { status: 'closed' } as T;
        case 'meeting_context':
          return { season: { startsAt: NOW - 30 * DAY, endsAt: NOW + (w.endsIn ?? 60 * DAY) }, boss: w.boss ?? BOSS, lastSlot: '2026-10-31T09:23:00.000Z', boards: [{ id: BOARD, name: 'Mario Fan Games' }, { id: BOARD2, name: 'Off Topic' }], successors: w.successors ?? dividedWorld.system.roster.map((b) => b.key).filter((k) => k !== (w.boss ?? BOSS)), ...(w.inheritanceDue ? { inheritanceDue: w.inheritanceDue } : {}) } as T;
        case 'system_digest':
          return { since: args.since, until: args.until, threads: [{ thread: HOT, title: 'Pineapple', board: 'Mario Fan Games', posts: 4, heat: 1, controversy: 0.5, length: 9 }], standings: [], moves: [], quotes: [], bossReactions: [], excerpts: [], characters: [{ id: ANN, name: 'Ann the Great', staff: false }] } as T;
        case 'staff_notes_recent': return (w.notes ?? []) as T;
        case 'staff_career': return (w.career ?? { led: [], offices: [] }) as T;
        case 'staff_memory_at': return (w.memories?.[String(args.staff)] ? (w.memoryAt ?? '2026-10-31T09:23:00.000Z') : null) as T;
        case 'staff_memory_latest': return (w.memories?.[String(args.staff)] ?? null) as T;
        case 'bank_now': return (w.bank ?? 5.9) as T;
        case 'public_characters': return (args.ids as string[]).filter((id) => (w.publicIds ?? [ANN, BOB]).includes(id)) as T;
        case 'apply_meeting':
          if (state.closed) return { status: 'already applied' } as T;
          state.applied.push(args);
          state.closed = true;
          return { status: 'applied', queued: ((args.payload as any).moves as unknown[]).length } as T;
        default: throw new Error(`the fake database has no ${fn}`);
      }
    },
  };
  return { db, calls, state, count: (fn: string) => calls.filter((c) => c.fn === fn).length };
}

function fakeModels(reply: unknown | ((r: ChatRequest) => unknown), completion: string | Error | ((r: CompletionRequest) => string) = 'a very fine board indeed') {
  const chats: ChatRequest[] = [];
  const completions: CompletionRequest[] = [];
  const result = <T,>(value: T): ModelResult<T> => ({ value, usage: {}, provider: 'fake', model: 'fake', trims: [], retries: 0, costMicrodollars: 0 });
  const models: Models = {
    async chat(r) {
      chats.push(r);
      const out = typeof reply === 'function' ? (reply as (r: ChatRequest) => unknown)(r) : reply;
      if (out instanceof Error) throw out;
      return result(out);
    },
    async complete(r) {
      completions.push(r);
      if (completion instanceof Error) throw completion;
      return result(typeof completion === 'function' ? completion(r) : completion);
    },
  };
  return { models, chats, completions };
}

/** The outcome as a loose record: each test reads the fields of the status it expects. */
const run = (...a: Parameters<typeof runMeeting>): Promise<any> => runMeeting(...a);
const noFeeds = (async () => { throw new Error('no network in this test'); }) as unknown as typeof fetch;
const quiet: Instance = { ...dividedWorld, system: { ...dividedWorld.system, feeds: [] } };
const clock = () => NOW;

test('a disabled System writes an off meeting and calls no model', async () => {
  const d = fakeDb({ enabled: false });
  const m = fakeModels(answer());
  const out = await run(d.db, m.models, quiet, SLOT, clock, noFeeds);
  assert.equal(out.status, 'off');
  assert.equal(m.chats.length, 0);
  assert.equal(m.completions.length, 0);
  assert.deepEqual(d.state.failed.map((f) => [f.meeting, f.outcome]), [[7, 'off']], 'the row is opened and closed off');
  assert.equal(d.count('apply_meeting'), 0);
  assert.equal(d.count('system_digest'), 0, 'nothing is read for a meeting that does not happen');
});

test('seven moves with a bank of five and nine tenths queue five, and the trim is recorded', async () => {
  const d = fakeDb({ bank: 5.9 });
  const m = fakeModels(answer([0, 1, 2, 3, 4, 5, 6].map((i) => rename(i))));
  const out = await run(d.db, m.models, quiet, SLOT, clock, noFeeds);
  assert.equal(out.status, 'ok', JSON.stringify(out));
  const payload = d.state.applied[0]!.payload;
  assert.deepEqual(payload.moves.map((x: any) => x.params.name), NAMES.slice(0, 5), 'the first five, in order: the last are cut');
  assert.ok(out.trims.some((t: any) => t.path === 'moves' && t.predicate === 'atMost(5)' && t.before === 7 && t.after === 5), JSON.stringify(out.trims));
  assert.ok(payload.record.trims.some((t: any) => t.predicate === 'atMost(5)'), 'the row the meeting closes with carries the trims');
  assert.equal(m.completions.length, 5, 'the old voice writes for the five kept and not for the two cut');
  assert.equal(payload.moves.length, 5);
  assert.equal(payload.boss, BOSS);
  assert.deepEqual([payload.weekly_moves, payload.bank_cap], [5, 10], 'the reign\'s numbers: the database debits from the bank it computes itself');
});

test('the call is a strong-tier meeting call for the Boss, naming the meeting, with a schema and rules', async () => {
  const d = fakeDb();
  const m = fakeModels(answer());
  await run(d.db, m.models, quiet, SLOT, clock, noFeeds);
  const r = m.chats[0]!;
  assert.equal(r.duty, 'meeting');
  assert.equal(r.tier, 'strong');
  assert.equal(r.staff, BOSS);
  assert.equal(r.meeting, 7, 'the ledger row names the meeting, which was opened before the call');
  assert.ok(r.rules && r.schema);
  assert.match(r.system, /Phase: reign/);
  assert.match(r.system, /make 5 moves/);
  assert.match(r.system, /Pointless Post Palace/, 'the name style, in the instance\'s own words');
  assert.match(r.messages[0]!.content, new RegExp(BOARD), 'the model is given the ids it may name');
  assert.match(r.messages[0]!.content, /Pineapple/);
  assert.ok(d.calls.findIndex((c) => c.fn === 'begin_meeting') < d.calls.findIndex((c) => c.fn === 'system_digest'));
  const digest = d.calls.find((c) => c.fn === 'system_digest')!;
  assert.equal(digest.args.since, '2026-10-31T09:23:00.000Z', 'the window starts where the last meeting\'s ended');
  assert.equal(digest.args.until, SLOT);
});

test('a rename whose name fails the style is dropped, not rewritten', async () => {
  const d = fakeDb();
  const m = fakeModels(answer([rename(0, { params: { board: BOARD, name: 'General Discussion', premise: 'Talk.' } }), rename(1)]));
  const out = await run(d.db, m.models, quiet, SLOT, clock, noFeeds);
  const names = d.state.applied[0]!.payload.moves.map((x: any) => x.params.name);
  assert.deepEqual(names, [NAMES[1]]);
  assert.ok(out.trims.some((t: any) => t.path === 'moves[0].params.name' && t.predicate === 'nameStyle'), JSON.stringify(out.trims));
  assert.equal(m.completions.length, 1, 'no description is written for a move that is dropped');
});

test('a name past boardNameMaxLength, a board that is not a board, a kind or demand outside the catalogs, and a reaction threshold at the cap are each dropped and recorded', async () => {
  const d = fakeDb();
  const long = `Pirate Puns ${'P'.repeat(80)}`;
  const m = fakeModels(answer([
    rename(0, { params: { board: BOARD, name: long, premise: 'x' } }),
    rename(1, { params: { board: HOT, name: NAMES[1], premise: 'x' } }),
    rename(2, { kind: 'banEveryone' }),
    rename(3, { demand: { kind: 'dance', params: {} } }),
    rename(4, { demand: { kind: 'quadrantOnBoard', params: { board: BOARD, quadrant: 'excitedPositive', count: 3 } } }),
    rename(5),
  ]));
  const out = await run(d.db, m.models, quiet, SLOT, clock, noFeeds);
  assert.deepEqual(d.state.applied[0]!.payload.moves.map((x: any) => x.params.name), [NAMES[5]]);
  const said = (path: string, predicate: RegExp) => assert.ok(out.trims.some((t: any) => t.path.startsWith(path) && predicate.test(t.predicate)), `${path}: ${JSON.stringify(out.trims)}`);
  said('moves[0].params.name', /atMost\(60\)/);
  said('moves[1].params.board', /isBoard/);
  said('moves[2].kind', /oneOf/);
  said('moves[3]', /oneOf/);
  said('moves[4]', /atLeast\(4\)/);
});

test('a structural move asked to go live in an hour is queued at the hold', async () => {
  const d = fakeDb();
  const m = fakeModels(answer([rename(0, { go_live_at: new Date(NOW + H).toISOString() })]));
  const out = await run(d.db, m.models, quiet, SLOT, clock, noFeeds);
  const move = d.state.applied[0]!.payload.moves[0];
  assert.equal(Date.parse(move.go_live_at), NOW + 24 * H);
  assert.ok(out.trims.some((t: any) => t.path === 'moves[0].go_live_at' && /hold/.test(t.predicate) && t.before === NOW + H && t.after === NOW + 24 * H), JSON.stringify(out.trims));
});

test('go-live times are clamped into the next day and expiries into the settings\' bounds', async () => {
  const d = fakeDb();
  const m = fakeModels(answer([
    rename(0, { go_live_at: new Date(NOW + 9 * DAY).toISOString(), expires_in_hours: 3 }),
    rename(1, { go_live_at: 'sometime soon', expires_in_hours: 99999 }),
  ]));
  const out = await run(d.db, m.models, quiet, SLOT, clock, noFeeds);
  const [a, b] = d.state.applied[0]!.payload.moves;
  assert.equal(Date.parse(a.go_live_at), NOW + 24 * H, 'a day at most');
  assert.equal(a.expires_in_hours, 24, 'the least hours any move lasts');
  assert.equal(Date.parse(b.go_live_at), NOW + 24 * H, 'a time that is not one is now, then held');
  assert.equal(b.expires_in_hours, 28 * 24, 'the reign\'s longest');
  assert.ok(out.trims.some((t: any) => t.path === 'moves[0].go_live_at' && /between/.test(t.predicate)));
  assert.ok(out.trims.some((t: any) => t.path === 'moves[0].expires_in_hours' && t.after === 24));
  assert.ok(out.trims.some((t: any) => t.path === 'moves[1].expires_in_hours' && t.after === 672));
});

test('the old voice writes the description from the instance\'s frame, cut to one line', async () => {
  const d = fakeDb();
  const m = fakeModels(answer([rename(0)]), '  ur board is sooo cool!!!\nBoard: Next');
  await run(d.db, m.models, quiet, SLOT, clock, noFeeds);
  assert.equal(d.state.applied[0]!.payload.moves[0].params.description, 'ur board is sooo cool!!!');
  const c = m.completions[0]!;
  assert.match(c.prompt, /Board: Pirate Puns Palace/);
  assert.match(c.prompt, /Subject: Everything about thing number 0/);
  assert.ok(c.stop.includes('\n'));
  assert.equal(c.staff, BOSS);
  assert.equal(c.meeting, 7);
});

test('the completion endpoint failing, or its text rejected, leaves the stock description and does not fail the meeting', async () => {
  for (const completion of [new Error('endpoint down'), new AnswerRejected('empty', 'nonEmpty'), '\n\n']) {
    const d = fakeDb();
    const m = fakeModels(answer([rename(0)]), completion);
    const out = await run(d.db, m.models, quiet, SLOT, clock, noFeeds);
    assert.equal(out.status, 'ok');
    const description = d.state.applied[0]!.payload.moves[0].params.description as string;
    const stock = dividedWorld.system.stockLines.boardDescription.map((l) => l.replaceAll('{board}', NAMES[0]!));
    assert.ok(stock.includes(description), `${String(completion)}: ${description}`);
    assert.ok(out.notes.some((n: string) => /old voice|description/i.test(n)), 'the result says the stock line stood in');
  }
});

test('a model failure closes the meeting failed and writes nothing else', async () => {
  for (const [err, outcome] of [[new Error('upstream 500'), 'failed'], [new AnswerRejected('the answer failed required at moves', 'required'), 'rejected']] as const) {
    const d = fakeDb();
    const m = fakeModels(err);
    const out = await run(d.db, m.models, quiet, SLOT, clock, noFeeds);
    assert.equal(out.status, outcome);
    assert.equal(d.count('apply_meeting'), 0, 'memory, profile, moves and bank are unchanged');
    assert.deepEqual(d.state.failed.map((f) => [f.outcome, /./.test(f.error)]), [[outcome, true]]);
    assert.match(d.state.failed[0]!.error, new RegExp(err.message));
  }
});

test('an answer the repair cannot save closes the meeting rejected', async () => {
  const d = fakeDb();
  const m = fakeModels({ ...answer(), memory: 'I forget' });
  const out = await run(d.db, m.models, quiet, SLOT, clock, noFeeds);
  assert.equal(out.status, 'rejected');
  assert.equal(d.count('apply_meeting'), 0);
  assert.match(d.state.failed[0]!.error, /memory/);
});

test('a database error is thrown, not swallowed, and so is an unrecorded model call', async () => {
  const d = fakeDb({ failOn: 'system_digest' });
  await assert.rejects(run(d.db, fakeModels(answer()).models, quiet, SLOT, clock, noFeeds), /connection dropped/);
  const e = fakeDb();
  await assert.rejects(run(e.db, fakeModels(new LedgerWriteFailed('the ledger is down')).models, quiet, SLOT, clock, noFeeds), /ledger is down/);
  const f = fakeDb({ failOn: 'apply_meeting' });
  await assert.rejects(run(f.db, fakeModels(answer()).models, quiet, SLOT, clock, noFeeds), /connection dropped/);
});

test('a meeting that throws after it begins closes its row failed with the real error, and the error is still thrown', async () => {
  const d = fakeDb({ failOn: 'system_digest' });
  await assert.rejects(run(d.db, fakeModels(answer()).models, quiet, SLOT, clock, noFeeds), /connection dropped/);
  assert.deepEqual(d.state.failed.map((f) => [f.meeting, f.outcome]), [[7, 'failed']]);
  assert.match(d.state.failed[0]!.error, /system_digest: the connection dropped/);
  const e = fakeDb();
  await assert.rejects(run(e.db, fakeModels(new LedgerWriteFailed('the ledger is down')).models, quiet, SLOT, clock, noFeeds), /ledger is down/);
  assert.match(e.state.failed[0]!.error, /ledger is down/);
  const f = fakeDb({ failOn: 'apply_meeting' });
  await assert.rejects(run(f.db, fakeModels(answer()).models, quiet, SLOT, clock, noFeeds), /connection dropped/);
  assert.match(f.state.failed[0]!.error, /apply_meeting/);
});

test('if closing the row fails too, the original error is the one thrown', async () => {
  const d = fakeDb({ failOn: ['system_digest', 'fail_meeting'] });
  await assert.rejects(run(d.db, fakeModels(answer()).models, quiet, SLOT, clock, noFeeds), /system_digest: the connection dropped/);
  assert.equal(d.count('fail_meeting'), 1, 'the close was attempted');
});

test('a successor named before the meltdown\'s last week is dropped and recorded; in it, a roster Boss other than the outgoing one stands', async () => {
  const early = fakeDb({ endsIn: 60 * DAY });
  const eo = await run(early.db, fakeModels(answer([], { successor: { boss: OTHER_BOSS, why: 'I am bored of me.' } })).models, quiet, SLOT, clock, noFeeds);
  assert.equal(eo.successor, null);
  assert.ok(eo.trims.some((t: any) => t.path === 'successor' && t.predicate === 'inMeltdownLastWeek'), JSON.stringify(eo.trims));
  assert.equal(early.state.applied[0]!.payload.record.successor ?? null, null);

  const meltdownButEarly = fakeDb({ endsIn: 10 * DAY });
  const mo = await run(meltdownButEarly.db, fakeModels(answer([], { successor: { boss: OTHER_BOSS, why: 'x' } })).models, quiet, SLOT, clock, noFeeds);
  assert.equal(mo.successor, null, 'in the meltdown, but not yet its last week');

  const late = fakeDb({ endsIn: 3 * DAY });
  const lm = fakeModels(answer([], { successor: { boss: OTHER_BOSS, why: 'Time for a change.' } }));
  const lo = await run(late.db, lm.models, quiet, SLOT, clock, noFeeds);
  assert.deepEqual(lo.successor, { boss: OTHER_BOSS, why: 'Time for a change.' });
  assert.match(lm.chats[0]!.system, /name your successor/, 'the prompt offers it only now');
  assert.match(lm.chats[0]!.system, /Phase: meltdown/);

  for (const boss of [BOSS, 'nobody-we-know']) {
    const x = fakeDb({ endsIn: 3 * DAY });
    const xo = await run(x.db, fakeModels(answer([], { successor: { boss, why: 'x' } })).models, quiet, SLOT, clock, noFeeds);
    assert.equal(xo.successor, null, boss);
    assert.ok(xo.trims.some((t: any) => t.path === 'successor.boss'), boss);
  }
});

test('who a successor may be is the database\'s list, not the roster minus the first staff', async () => {
  const [staffKey] = dividedWorld.system.firstStaff;
  // A persona on staff from the start may be named: the Boss may come from any office.
  const onStaff = fakeDb({ endsIn: 3 * DAY });
  const so = await run(onStaff.db, fakeModels(answer([], { successor: { boss: staffKey!, why: 'x' } })).models, quiet, SLOT, clock, noFeeds);
  assert.deepEqual(so.successor, { boss: staffKey, why: 'x' });
  // One the database leaves out (benched) is refused, and is not offered in the prompt.
  const benched = fakeDb({ endsIn: 3 * DAY, successors: [OTHER_BOSS] });
  const bm = fakeModels(answer([], { successor: { boss: staffKey!, why: 'x' } }));
  const bo = await run(benched.db, bm.models, quiet, SLOT, clock, noFeeds);
  assert.equal(bo.successor, null);
  assert.ok(bo.trims.some((t: any) => t.path === 'successor.boss' && t.predicate === 'rosterBoss'), JSON.stringify(bo.trims));
  assert.ok(!bm.chats[0]!.system.includes(`${staffKey} (`), 'a persona the database leaves out is not offered');
});

test('inheritance answers are repaired and carried, not acted on', async () => {
  const d = fakeDb();
  const act = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const out = await run(d.db, fakeModels(answer([], { inherited: [{ move_act: act, decision: 'keep' }, { move_act: act, decision: 'end' }, { move_act: 'not-an-id', decision: 'end' }] })).models, quiet, SLOT, clock, noFeeds);
  assert.deepEqual(out.inherited, [{ move_act: act, decision: 'keep' }]);
  assert.equal(out.trims.filter((t: any) => t.path.startsWith('inherited[')).length, 2);
});

test('the moves a new Boss inherits are shown in plain words, and its keep and end answers reach the database; an answer naming a move it was not shown is dropped', async () => {
  const kept = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const ended = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const unseen = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const due = [
    { act: kept, kind: 'renameBoard', params: { board: BOARD, name: 'Pirate Puns Palace', premise: 'Puns.' }, landedAt: '2026-10-20T09:00:00.000Z', expiresAt: '2026-11-10T09:00:00.000Z', by: 'The Old Boss', boardName: 'Mario Fan Games' },
    { act: ended, kind: 'renameBoard', params: { board: BOARD2, name: 'Pie Place', premise: 'Pie.' }, landedAt: '2026-10-21T09:00:00.000Z', expiresAt: null, by: 'The Old Boss', boardName: 'Off Topic' },
  ];
  const d = fakeDb({ inheritanceDue: due });
  const m = fakeModels(answer([], { inherited: [{ move_act: kept, decision: 'keep' }, { move_act: ended, decision: 'end' }, { move_act: unseen, decision: 'keep' }] }));
  const out = await run(d.db, m.models, quiet, SLOT, clock, noFeeds);
  const text = m.chats[0]!.messages[0]!.content;
  assert.match(text, /# Moves you inherited/);
  assert.match(text, new RegExp(`${kept}: Renamed Mario Fan Games to Pirate Puns Palace \\(by The Old Boss, since 2026-10-20, runs out 2026-11-10\\)`));
  assert.match(text, /Neither costs a move from your bank/);
  assert.deepEqual(d.state.applied[0]!.payload.inherited, [{ move_act: kept, decision: 'keep' }, { move_act: ended, decision: 'end' }]);
  assert.ok(out.trims.some((t: any) => t.path === 'inherited[2].move_act' && t.predicate === 'inheritedMove'), JSON.stringify(out.trims));
  assert.equal(d.state.applied[0]!.payload.moves.length, 0, 'reviewing is no move');
  // A meeting with nothing to review shows no such section.
  const none = fakeDb({ inheritanceDue: [] });
  const nm = fakeModels(answer());
  await run(none.db, nm.models, quiet, SLOT, clock, noFeeds);
  assert.doesNotMatch(nm.chats[0]!.messages[0]!.content, /Moves you inherited/);
});

test('a successor answer is carried to the database to be queued, and a moves-list nomination is not a move', async () => {
  const late = fakeDb({ endsIn: 3 * DAY });
  await run(late.db, fakeModels(answer([], { successor: { boss: OTHER_BOSS, why: 'Time for a change.' } })).models, quiet, SLOT, clock, noFeeds);
  assert.deepEqual(late.state.applied[0]!.payload.successor, { boss: OTHER_BOSS, why: 'Time for a change.' });
  assert.deepEqual(late.state.applied[0]!.payload.moves, []);
  const early = fakeDb({ endsIn: 60 * DAY });
  await run(early.db, fakeModels(answer([], { successor: { boss: OTHER_BOSS, why: 'x' } })).models, quiet, SLOT, clock, noFeeds);
  assert.equal(early.state.applied[0]!.payload.successor, null);
});

test('a new Boss reads no memory, unless its persona inherits another Boss\'s', async () => {
  const fresh = fakeDb({ memories: { [OTHER_BOSS]: memory('the old boss\'s hobby') } });
  const fm = fakeModels(answer());
  await run(fresh.db, fm.models, quiet, SLOT, clock, noFeeds);
  assert.deepEqual(fresh.calls.filter((c) => c.fn === 'staff_memory_latest').map((c) => c.args.staff), [BOSS], 'only its own memory is asked for, and it has none');
  assert.match(fm.chats[0]!.messages[0]!.content, /You are new to this board/);
  assert.doesNotMatch(fm.chats[0]!.messages[0]!.content, /the old boss's hobby/);

  const heir: Instance = { ...quiet, system: { ...quiet.system, roster: quiet.system.roster.map((b) => (b.key === BOSS ? { ...b, inheritsMemoryOf: OTHER_BOSS } : b)) } };
  const inherited = fakeDb({ memories: { [OTHER_BOSS]: memory('the old boss\'s hobby') } });
  const im = fakeModels(answer());
  await run(inherited.db, im.models, heir, SLOT, clock, noFeeds);
  assert.match(im.chats[0]!.messages[0]!.content, /the old boss's hobby/);

  const own = fakeDb({ memories: { [BOSS]: memory('my own hobby'), [OTHER_BOSS]: memory('the old boss\'s hobby') } });
  const om = fakeModels(answer());
  await run(own.db, om.models, heir, SLOT, clock, noFeeds);
  assert.match(om.chats[0]!.messages[0]!.content, /my own hobby/);
  assert.doesNotMatch(om.chats[0]!.messages[0]!.content, /the old boss's hobby/, 'a Boss that has a memory of its own keeps it');
});

test('a retry of a slot already met does nothing, and a slot begun and never closed is resumed under the same meeting', async () => {
  const d = fakeDb({ closed: true });
  const m = fakeModels(answer([rename(0)]));
  const out = await run(d.db, m.models, quiet, SLOT, clock, noFeeds);
  assert.equal(out.status, 'already met');
  assert.equal(m.chats.length, 0);
  assert.equal(d.count('apply_meeting'), 0);
  assert.equal(d.count('system_digest'), 0);

  const crashed = fakeDb({ open: true });
  const cm = fakeModels(answer([rename(0)]));
  const co = await run(crashed.db, cm.models, quiet, SLOT, clock, noFeeds);
  assert.equal(co.status, 'ok');
  assert.equal(cm.chats[0]!.meeting, 7, 'the same meeting row');
  assert.equal(crashed.state.applied[0]!.meeting, 7);
  const again = await run(crashed.db, cm.models, quiet, SLOT, clock, noFeeds);
  assert.equal(again.status, 'already met');
  assert.equal(crashed.state.applied.length, 1, 'queued once');

  // Two runs at once: the later one's apply finds the meeting closed and says so, and queues nothing.
  const racing = fakeDb({ open: true });
  const first = racing.db.rpc.bind(racing.db);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow: Db = { rpc: async (fn, args) => { if (fn === 'apply_meeting') await gate; return first(fn, args); } };
  const one = run(slow, fakeModels(answer([rename(0)])).models, quiet, SLOT, clock, noFeeds);
  const two = run(racing.db, fakeModels(answer([rename(0)])).models, quiet, SLOT, clock, noFeeds);
  assert.equal((await two).status, 'ok');
  release();
  assert.equal((await one).status, 'already applied');
  assert.equal(racing.state.applied.length, 1);
});

test('a feed that fails is skipped and noted; the others\' titles reach the prompt, capped', async () => {
  const withFeeds: Instance = { ...dividedWorld, system: { ...dividedWorld.system, feeds: [{ name: 'Down Feed', url: 'https://down.test/rss' }, { name: 'Good Feed', url: 'https://good.test/rss' }, { name: 'Slow Feed', url: 'https://slow.test/rss' }] } };
  const items = Array.from({ length: 60 }, (_, i) => `<item><title>Headline ${i} &amp; more</title><link>https://x/${i}</link></item>`).join('');
  const asked: string[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    asked.push(String(url));
    assert.ok(init?.signal, 'every fetch has a timeout');
    if (String(url).includes('down')) return new Response('nope', { status: 503 });
    if (String(url).includes('slow')) throw new DOMException('timed out', 'TimeoutError');
    return new Response(`<rss><channel>${items}</channel></rss>`, { status: 200 });
  }) as unknown as typeof fetch;
  const d = fakeDb();
  const m = fakeModels(answer());
  const out = await run(d.db, m.models, withFeeds, SLOT, clock, fetcher);
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.feedsSkipped.map((f: any) => f.name), ['Down Feed', 'Slow Feed']);
  const text = m.chats[0]!.messages[0]!.content;
  assert.match(text, /Headline 0 & more/);
  assert.match(text, /Down Feed.*could not be read/s);
  assert.equal((text.match(/Headline \d+/g) ?? []).length, 30, 'capped at the digest\'s feed ceiling');
  assert.deepEqual(d.state.applied[0]!.payload.record.feedsSkipped.map((f: any) => f.name), ['Down Feed', 'Slow Feed']);
});

test('a feed body is read only to the byte cap, and the titles in what was read still parse', async () => {
  const withFeed: Instance = { ...dividedWorld, system: { ...dividedWorld.system, feeds: [{ name: 'Huge Feed', url: 'https://huge.test/rss' }] } };
  const enc = new TextEncoder();
  const chunk = enc.encode(`<item><title>Big Headline</title></item>${' '.repeat(49_000)}`);
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) { pulled++; if (pulled > 1000) c.close(); else c.enqueue(chunk); },
    cancel() { cancelled = true; },
  });
  const fetcher = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
  const d = fakeDb();
  const m = fakeModels(answer());
  const out = await run(d.db, m.models, withFeed, SLOT, clock, fetcher);
  assert.equal(out.status, 'ok');
  assert.ok(pulled * chunk.length <= 400_000 + 2 * chunk.length, `pulled ${pulled} chunks of ${chunk.length}`);
  assert.ok(cancelled, 'the rest of the body is cancelled');
  assert.match(m.chats[0]!.messages[0]!.content, /Big Headline/);
});

test('memory and favorites name only public characters', async () => {
  const d = fakeDb({ publicIds: [ANN] });
  const a = answer();
  a.memory.opinions.push({ character: HIDDEN, score: 9, note: 'Who?' } as never);
  a.profile.favorites.push(HIDDEN);
  const out = await run(d.db, fakeModels(a).models, quiet, SLOT, clock, noFeeds);
  const p = d.state.applied[0]!.payload;
  assert.deepEqual(p.memory.opinions.map((o: any) => o.character), [ANN]);
  assert.deepEqual(p.profile.favorites, [ANN]);
  assert.ok(out.trims.some((t: any) => t.predicate === 'publicCharacter' && t.path.startsWith('memory.opinions')));
  assert.ok(out.trims.some((t: any) => t.predicate === 'publicCharacter' && t.path.startsWith('profile.favorites')));
  assert.deepEqual(d.calls.find((c) => c.fn === 'public_characters')!.args.ids.sort(), [ANN, HIDDEN].sort(), 'the database is asked about every character the answer names');
});

test('a Boss with no moves banked still keeps its memory and profile', async () => {
  const d = fakeDb({ bank: 0.4 });
  const m = fakeModels(answer([rename(0)]));
  const out = await run(d.db, m.models, quiet, SLOT, clock, noFeeds);
  const p = d.state.applied[0]!.payload;
  assert.equal(p.moves.length, 0);
  assert.equal(p.profile.mood, 'smug');
  assert.ok(out.trims.some((t: any) => t.path === 'moves' && t.after === 0));
});

test('the Boss\'s career is read for the Boss itself and carried in the system prompt as plain facts', async () => {
  const served = fakeDb({ career: {
    led: [{ season: 2, since: '2026-02-01T00:00:00+00:00', until: '2026-03-29T00:00:00+00:00', how: 'rotation' }],
    offices: [{ office: 'mod', since: '2026-03-29T00:00:00+00:00', until: null, cause: 'handover' }],
  } });
  const m = fakeModels(answer([]));
  await run(served.db, m.models, quiet, SLOT, clock, noFeeds);
  assert.deepEqual(served.calls.filter((c) => c.fn === 'staff_career').map((c) => c.args), [{ of_staff: BOSS }]);
  const system = m.chats[0]!.system;
  assert.ok(system.includes('Boss in Season 2, from 2026-02-01 to 2026-03-29'), system);
  assert.ok(system.includes('Mod Bot from 2026-03-29 until now'), system);
  const fresh = fakeModels(answer([]));
  await run(fakeDb().db, fresh.models, quiet, SLOT, clock, noFeeds);
  assert.ok(fresh.chats[0]!.system.includes('You have held no office before.'), 'a Boss with no career is told so');
});

test('the Boss\'s recent notes are read for the Boss itself since the last meeting, capped by notesRead, and carried in the system prompt', async () => {
  const served = fakeDb({ notes: ['Ann is up to something.', 'Bob owes me a rematch.'], memories: { [BOSS]: memory('my own hobby') } });
  const m = fakeModels(answer([]));
  await run(served.db, m.models, quiet, SLOT, clock, noFeeds);
  const reads = served.calls.filter((c) => c.fn === 'staff_notes_recent');
  assert.equal(reads.length, 1);
  assert.equal(reads[0]!.args.of_staff, BOSS);
  assert.equal(reads[0]!.args.most, dividedWorld.settings.notesRead);
  assert.equal(reads[0]!.args.since, '2026-10-31T09:23:00.000Z', 'since its latest memory version');
  const system = m.chats[0]!.system;
  assert.ok(system.includes('Ann is up to something.') && system.includes('Bob owes me a rematch.'), system);
  assert.ok(system.includes('your own recent thoughts'), system);
  const fresh = fakeDb({ notes: ['Written as a member.'] });
  await run(fresh.db, fakeModels(answer([])).models, quiet, SLOT, clock, noFeeds);
  assert.equal(fresh.calls.find((c) => c.fn === 'staff_notes_recent')!.args.since, null, 'a Boss with no memory of its own reads every note it has written');
  const bare = fakeModels(answer([]));
  await run(fakeDb().db, bare.models, quiet, SLOT, clock, noFeeds);
  assert.ok(!bare.chats[0]!.system.includes('your own recent thoughts'), 'a Boss with no notes is told nothing of them');
});

test('the Boss\'s notes are read since its latest memory version, not the last recorded slot: a meeting that failed after its slot was recorded skipped no notes', async () => {
  const served = fakeDb({ notes: ['Written in the gap.'], memories: { [BOSS]: memory('my own hobby') }, memoryAt: '2026-10-29T08:00:00.000Z' });
  await run(served.db, fakeModels(answer([])).models, quiet, SLOT, clock, noFeeds);
  const read = served.calls.find((c) => c.fn === 'staff_notes_recent')!;
  assert.equal(read.args.since, '2026-10-29T08:00:00.000Z', 'earlier than the recorded slot (2026-10-31T09:23Z), where the memory was last saved');
});
