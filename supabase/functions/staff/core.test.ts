import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILINGS_PER_RUN, runFilings } from './core.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { instance as dividedWorld } from '../_shared/instance.ts';
import { AnswerRejected, LedgerWriteFailed, models as realModels } from '../_shared/models/index.ts';
import type { ModelCallRow } from '../_shared/models/ledger.ts';
import type { ChatRequest, CompletionRequest, ModelResult, Models } from '../../../engine/system/model.ts';
import type { Instance } from '../../../engine/rules/types.ts';

const SLOT = '2026-11-07T10:00:00.000Z';
const NOW = Date.parse(SLOT);
const MON = 'placeholder-monitor';
const SIGH = 'placeholder-sighbot';
const CLERK = 'placeholder-clerk';
const GAMES = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const V1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const V2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const V3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const P1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const P3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const T1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

interface Due { visit: string; post: string; thread: string; staff: string; ends_at: string; board: { id: string; name: string; premise: string }; charges: { rule: string; rule_number: number; board: string; band: string; cause: string; about_act: string }[] }
const due = (visit: string, post: string, staff = MON, ends_at = '2026-11-07T09:00:00.000Z'): Due => ({
  visit, post, thread: T1, staff, ends_at, board: { id: GAMES, name: 'Games', premise: 'Talk about games.' },
  charges: [{ rule: 'Rule 2: no double posting', rule_number: 2, board: GAMES, band: 'moderate', cause: 'rule', about_act: post }],
});

interface Standing { office: string | null; allowance: number; order: string | null; beat: { id: string; name: string }[] }
interface World {
  enabled?: boolean;
  visits?: Due[];
  standing?: Record<string, Standing>;
  today?: number;
  modBots?: Record<string, unknown>;
  failOn?: Record<string, number | 'always'>;
  /** Visits the tick files while the model is thinking (the race). */
  tickFiles?: string[];  /** What `mod_group_context` answers. */
  groups?: { conferred: { key: string; name: string; tone: string }[]; characters: { id: string; capped: boolean; held: boolean }[] };
}
const mod = (allowance: number, over: Partial<Standing> = {}): Standing => ({ office: 'mod', allowance, order: 'Crack down on bumping in Games.', beat: [{ id: GAMES, name: 'Games' }], ...over });

function fakeDb(w: World = {}) {
  const calls: { fn: string; args: Record<string, any> }[] = [];
  const state = {
    filed: new Map<string, string | null>(),
    moves: [] as { id: number; staff: string; cause: string; move: any }[],
    allowance: new Map<string, number>(),
    ticked: new Set<string>(),
    records: [] as { cause_act: string; duty: string; staff: string; record: any }[],
  };
  const standing = w.standing ?? { [MON]: mod(2), [SIGH]: mod(0) };
  for (const [k, s] of Object.entries(standing)) state.allowance.set(k, s.allowance);
  const failing = { ...(w.failOn ?? {}) };
  const visits = w.visits ?? [due(V1, P1), due(V2, P2, SIGH)];
  const db: Db = {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      const f = failing[fn];
      if (f === 'always' || (typeof f === 'number' && f > 0)) {
        if (typeof f === 'number') failing[fn] = f - 1;
        throw new DatabaseError(`${fn}: the connection dropped`, '08006', 500);
      }
      switch (fn) {
        case 'instance_settings':
          return { economy: dividedWorld.settings.economy, systemEnabled: w.enabled ?? true, modBots: { ...dividedWorld.settings.modBots, ...(w.modBots ?? {}) } } as T;
        case 'filings_due': return visits.filter((v) => !state.filed.has(v.visit)).slice(0, Number(args.most)) as T;
        case 'refund_stale_reports': return 0 as T;
        case 'refund_stale_appeals': return 0 as T;
        case 'filing_calls_today': return (w.today ?? 0) as T;
        case 'mod_standing': {
          const s = standing[String(args.staff)] ?? { office: null, allowance: 0, order: null, beat: [] };
          return { ...s, allowance: state.allowance.get(String(args.staff)) ?? 0 } as T;
        }
        case 'mod_group_context': return (w.groups ?? { conferred: [{ key: 'trial', name: 'Trial Members', tone: 'punishment' }, { key: 'vip', name: 'VIPs', tone: 'favor' }], characters: [] }) as T;
        case 'rules_in_force': return [{ board: GAMES, number: 2, predicate: 'noDoublePost', param: null, band: 'moderate' }, { board: null, number: 1, predicate: 'noAllCaps', param: null, band: 'minor' }] as T;
        case 'staff_career': return { led: [], offices: [{ office: 'mod', since: '2026-10-01T00:00:00Z', until: null, cause: 'seed' }] } as T;
        case 'staff_memory_latest': return null as T;
        case 'staff_memory_at': return null as T;
        case 'staff_notes_recent': return ['Games gets bumped.'] as T;
        case 'pool_names': return {} as T;
        case 'pool_thread': {
          const v = visits.find((x) => x.thread === args.in_thread)!;
          return { title: 'Best Mario game?', posts: [{ act: v.post, name: 'Bob', body: 'Odyssey. Odyssey.' }] } as T;
        }
        case 'apply_mod_move': {
          const staffKey = String(args.staff);
          const earlier = state.moves.find((m) => m.staff === staffKey && m.cause === args.cause_act);
          if (earlier) return { move: earlier.id, queued: false, existing: true } as T;
          const left = state.allowance.get(staffKey) ?? 0;
          if (left < 1) return { move: null, queued: false, reason: `${staffKey} has no allowance left` } as T;
          state.allowance.set(staffKey, left - 1);
          const m = { id: state.moves.length + 1, staff: staffKey, cause: String(args.cause_act), move: args.move };
          state.moves.push(m);
          return { move: m.id, queued: true, existing: false } as T;
        }
        case 'record_staff_call': {
          state.records.push({ cause_act: String(args.cause_act), duty: String(args.duty), staff: String(args.staff), record: args.record });
          return { recorded: true } as T;
        }
        case 'file_visit': {
          const v = String(args.visit_act);
          if (state.filed.has(v)) return { filed: false } as T;
          state.filed.set(v, (args.line as string | undefined) ?? null);
          return { filed: true } as T;
        }
        default: throw new Error(`the fake database has no ${fn}`);
      }
    },
  };
  const tick = (v: string) => { state.filed.set(v, null); state.ticked.add(v); };
  return { db, calls, state, tick, count: (fn: string) => calls.filter((c) => c.fn === fn).length, of: (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.args) };
}

const result = <T,>(value: T): ModelResult<T> => ({ value, usage: {}, provider: 'fake', model: 'fake', trims: [], retries: 0, costMicrodollars: 0 });
function fakeModels(reply: (r: ChatRequest) => unknown, completion: string | Error | ((r: CompletionRequest) => string) = 'An old-voice line.', during?: () => void) {
  const chats: ChatRequest[] = [];
  const completions: CompletionRequest[] = [];
  const models: Models = {
    async chat(r) {
      chats.push(r);
      during?.();
      const out = reply(r);
      if (out instanceof Error) throw out;
      return result(out);
    },
    async complete(r) {
      completions.push(r);
      during?.();
      const out = typeof completion === 'function' ? completion(r) : completion;
      if (out instanceof Error) throw out;
      return result(out);
    },
  };
  return { models, chats, completions };
}
const move = (over: Record<string, unknown> = {}) => ({ kind: 'setRule', params: { board: GAMES, predicate: 'noAllCaps', param: '', band: 'minor' }, expires_in_hours: 48, why: 'Too much shouting.', ...over });
const clock = () => NOW;
const run = (d: ReturnType<typeof fakeDb>, m: { models: Models }, instance: Instance = dividedWorld, now: () => number = clock) => runFilings(d.db, m.models, instance, SLOT, now);
const withVoice = (key: string, voice: 'chat' | 'oldVoice'): Instance => ({ ...dividedWorld, system: { ...dividedWorld.system, roster: dividedWorld.system.roster.map((p) => (p.key === key ? { ...p, voice } : p)) } });

test('a due visit is filed with the Mod\'s line: one light-tier filing call naming the duty and the Mod, then file_visit with the line', async () => {
  const d = fakeDb({ visits: [due(V1, P1)] });
  const m = fakeModels(() => ({ words: 'Friendly reminder: one post at a time.' }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(d.of('filings_due')[0]!.most, FILINGS_PER_RUN);
  assert.equal(m.chats.length, 1);
  const c = m.chats[0]!;
  assert.equal(c.duty, 'filing');
  assert.equal(c.tier, 'light');
  assert.equal(c.staff, MON);
  assert.ok(c.rules);
  assert.match(c.system, /Crack down on bumping in Games\./, 'the Boss\'s order');
  assert.match(c.system, /Rule 2: no double posting/);
  assert.match(c.system, /Games \(11111111/, 'the beat');
  assert.match(c.messages[0]!.content, /Odyssey\. Odyssey\./);
  assert.match(c.messages[0]!.content, /Talk about games\./);
  assert.deepEqual(d.of('file_visit'), [{ visit_act: V1, line: 'Friendly reminder: one post at a time.' }]);
  assert.deepEqual(out.filings.map((f) => [f.visit, f.status, f.line]), [[V1, 'filed', 'model']]);
  assert.equal(d.count('apply_mod_move'), 0, 'no move was asked for');
});

test('a filing with a move queues it as the Mod\'s, caused by the visit, then files; the allowance is spent', async () => {
  const d = fakeDb({ visits: [due(V1, P1)] });
  const m = fakeModels(() => ({ words: 'Enough.', move: move() }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  const [asked] = d.of('apply_mod_move');
  assert.equal(asked!.staff, MON);
  assert.equal(asked!.cause_act, V1);
  assert.deepEqual(asked!.move, { kind: 'setRule', params: { board: GAMES, predicate: 'noAllCaps', param: null, band: 'minor' }, expires_in_hours: 48, why: 'Too much shouting.' });
  assert.equal(d.state.moves.length, 1);
  assert.equal(d.state.allowance.get(MON), 1);
  assert.deepEqual(d.of('file_visit'), [{ visit_act: V1, line: 'Enough.' }]);
  const order = d.calls.map((c) => c.fn).filter((f) => f === 'apply_mod_move' || f === 'file_visit');
  assert.deepEqual(order, ['apply_mod_move', 'file_visit'], 'the move first: a retry after a crash finds it by its cause, and a move is never lost to a crash');
  assert.ok(out.status === 'ok' && out.filings[0]!.move && (out.filings[0]!.move as { queued: boolean }).queued === true);
  // The schema offered the move, from the beat.
  const props = (m.chats[0]!.schema as { properties: Record<string, any> }).properties;
  assert.deepEqual(props['move'].properties.params.properties.board.enum, [GAMES]);
});

test('an expiry past ruleDaysMost is clamped with a trim on the record; a board off the beat drops the move, the predicate named, and the line still files', async () => {
  const d = fakeDb({ visits: [due(V1, P1), due(V3, P3)] });
  const m = fakeModels((r) => ({ words: `Line for ${r.messages[0]!.content.length}.`, move: move(r.messages[0]!.content.includes('Odyssey') && d.state.moves.length === 0 ? { expires_in_hours: 900 } : { params: { board: OTHER, predicate: 'noAllCaps', band: 'minor' } }) }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(d.of('apply_mod_move').length, 1);
  assert.equal((d.of('apply_mod_move')[0]!.move as any).expires_in_hours, 168);
  const [first, second] = out.filings;
  assert.deepEqual(first!.trims, [{ path: 'move.expires_in_hours', predicate: 'atMost(168)', before: 900, after: 168 }]);
  assert.deepEqual(second!.dropped, [{ path: 'move.params.board', predicate: 'onBeat' }]);
  assert.equal(d.of('file_visit').length, 2, 'both visits file');
  assert.ok(d.of('file_visit')[1]!.line, 'a dropped move does not cost the line');
});

test('the trims and drops of a judged call are kept in the database, once, before the move and the filing', async () => {
  const d = fakeDb({ visits: [due(V1, P1)] });
  const m = fakeModels(() => ({ words: 'Filed.', move: move({ expires_in_hours: 900 }) }));
  await run(d, m);
  assert.equal(d.state.records.length, 1);
  const r = d.state.records[0]!;
  assert.deepEqual([r.cause_act, r.duty, r.staff], [V1, 'filing', MON]);
  assert.deepEqual(r.record.trims, [{ path: 'move.expires_in_hours', predicate: 'atMost(168)', before: 900, after: 168 }]);
  assert.equal(r.record.line, 'model');
  const order = d.calls.map((c) => c.fn).filter((f) => ['record_staff_call', 'apply_mod_move', 'file_visit'].includes(f));
  assert.deepEqual(order, ['record_staff_call', 'apply_mod_move', 'file_visit']);
  // A drop is on the record too, with its predicate; a stock line (no call) has none.
  const e = fakeDb({ visits: [due(V2, P2, SIGH)] });
  await run(e, fakeModels(() => ({ words: 'Filed.', move: move() })));
  assert.deepEqual(e.state.records[0]!.record.dropped, [{ path: 'move', predicate: 'allowance' }]);
  const f = fakeDb({ visits: [due(V1, P1)] });
  await run(f, fakeModels(() => new Error('overloaded')));
  assert.match(f.state.records[0]!.record.why, /overloaded/, 'a failed call is on the record');
  const g = fakeDb({ visits: [due(V1, P1, CLERK)], standing: { [CLERK]: mod(1, { office: 'member' }) } });
  await run(g, fakeModels(() => ({ words: 'x' })));
  assert.equal(g.state.records.length, 0, 'no call, no record');
});

test('with no allowance the Mod is offered no move, and a move it gives anyway is dropped (recorded) and never sent', async () => {
  const d = fakeDb({ visits: [due(V2, P2, SIGH)] });
  const m = fakeModels(() => ({ words: 'Filed.', move: move() }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.deepEqual(Object.keys((m.chats[0]!.schema as { properties: object }).properties), ['words']);
  assert.match(m.chats[0]!.system, /no allowance/i);
  assert.equal(d.count('apply_mod_move'), 0);
  assert.deepEqual(out.filings[0]!.dropped, [{ path: 'move', predicate: 'allowance' }]);
  assert.deepEqual(d.of('file_visit'), [{ visit_act: V2, line: 'Filed.' }]);
});

test('the database refusing the move (the allowance went elsewhere) costs nothing: the line still files and the refusal is on the record', async () => {
  const d = fakeDb({ visits: [due(V1, P1)] });
  d.state.allowance.set(MON, 0); // the standing read says 2 below; the database has none left
  const w = d.db.rpc;
  d.db.rpc = async <T,>(fn: string, args: Record<string, unknown>) => (fn === 'mod_standing' ? ({ office: 'mod', allowance: 2, order: null, beat: [{ id: GAMES, name: 'Games' }] } as T) : w<T>(fn, args));
  const m = fakeModels(() => ({ words: 'Filed anyway.', move: move() }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(d.state.moves.length, 0);
  assert.equal((out.filings[0]!.move as { queued: boolean; reason: string }).queued, false);
  assert.match((out.filings[0]!.move as { reason: string }).reason, /no allowance/);
  assert.deepEqual(d.of('file_visit'), [{ visit_act: V1, line: 'Filed anyway.' }]);
});

test('a model failure, or a rejected answer, files with the stock line (no line sent) and no move', async () => {
  for (const failure of [new Error('overloaded'), new AnswerRejected('the answer failed required at words', 'required')]) {
    const d = fakeDb({ visits: [due(V1, P1)] });
    const m = fakeModels(() => failure);
    const out = await run(d, m);
    assert.ok(out.status === 'ok');
    assert.deepEqual(d.of('file_visit'), [{ visit_act: V1 }], 'the stock line is the database\'s: no line is sent');
    assert.equal(out.filings[0]!.line, 'stock');
    assert.equal(out.filings[0]!.status, 'filed');
    assert.match(out.filings[0]!.why ?? '', /overloaded|required/);
    assert.equal(d.count('apply_mod_move'), 0);
  }
});

test('a blank line from the model files the stock line, and its move still queues', async () => {
  const d = fakeDb({ visits: [due(V1, P1)] });
  const m = fakeModels(() => ({ words: '   ', move: move() }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.deepEqual(d.of('file_visit'), [{ visit_act: V1 }]);
  assert.equal(d.state.moves.length, 1);
  assert.equal(out.filings[0]!.line, 'stock');
});

test('a ledger row that cannot be written stops the run: an unrecorded call is not trusted', async () => {
  const d = fakeDb({ visits: [due(V1, P1)] });
  await assert.rejects(run(d, fakeModels(() => new LedgerWriteFailed('the ledger is down'))), LedgerWriteFailed);
  assert.equal(d.count('file_visit'), 0);
});

test('a line past 280 characters is cut at a sentence, the trim recorded', async () => {
  const d = fakeDb({ visits: [due(V1, P1)] });
  const m = fakeModels(() => ({ words: 'This post broke a rule. '.repeat(40) }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  const line = d.of('file_visit')[0]!.line as string;
  assert.ok(line.length <= 280 && line.endsWith('rule.'));
  assert.equal(out.filings[0]!.trims[0] && (out.filings[0]!.trims[0] as { predicate: string }).predicate, 'maxLength(280)');
});

test('past filingLinesPerDay the stock line files and no model is called; the count carries across the run', async () => {
  const d = fakeDb({ visits: [due(V1, P1), due(V3, P3)], today: 59, modBots: { filingLinesPerDay: 60 } });
  const m = fakeModels(() => ({ words: 'A line.' }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(m.chats.length, 1, 'one call fills the 60th; the next visit is over the count');
  assert.deepEqual(d.of('file_visit'), [{ visit_act: V1, line: 'A line.' }, { visit_act: V3 }]);
  assert.match(out.filings[1]!.why ?? '', /filingLinesPerDay/);
  const spent = fakeDb({ visits: [due(V1, P1)], today: 60, modBots: { filingLinesPerDay: 60 } });
  const none = fakeModels(() => ({ words: 'A line.' }));
  await run(spent, none);
  assert.equal(none.chats.length + none.completions.length, 0);
  assert.deepEqual(spent.of('file_visit'), [{ visit_act: V1 }]);
});

test('an old-voice persona\'s line is a raw completion, and its move a chat call only when it has an allowance', async () => {
  const old = withVoice(MON, 'oldVoice');
  const d = fakeDb({ visits: [due(V1, P1)] });
  const m = fakeModels(() => ({ move: move() }), 'Hey, quit it with the double posting');
  const out = await run(d, m, old);
  assert.ok(out.status === 'ok');
  assert.equal(m.completions.length, 1);
  assert.equal(m.completions[0]!.duty, 'filing');
  assert.equal(m.completions[0]!.staff, MON);
  assert.deepEqual(m.completions[0]!.stop, ['\n']);
  assert.ok(m.completions[0]!.prompt.endsWith(`${old.system.roster.find((p) => p.key === MON)!.name}:`));
  assert.equal(m.chats.length, 1, 'the move is a second, chat call');
  assert.equal(m.chats[0]!.duty, 'filing');
  assert.match(m.chats[0]!.messages[0]!.content, /Hey, quit it with the double posting/, 'it is shown the line it said');
  assert.deepEqual(Object.keys((m.chats[0]!.schema as { properties: object }).properties), ['move']);
  assert.deepEqual(d.of('file_visit'), [{ visit_act: V1, line: 'Hey, quit it with the double posting' }]);
  assert.equal(d.state.moves.length, 1);

  // No allowance: the line only.
  const none = fakeDb({ visits: [due(V2, P2, SIGH)] });
  const m2 = fakeModels(() => ({ move: move() }), 'Stop that.');
  await run(none, m2, withVoice(SIGH, 'oldVoice'));
  assert.equal(m2.completions.length, 1);
  assert.equal(m2.chats.length, 0, 'an old voice with nothing to spend makes no chat call');

  // A failed completion files stock and makes no second call.
  const dead = fakeDb({ visits: [due(V1, P1)] });
  const m3 = fakeModels(() => ({ move: move() }), new Error('down'));
  await run(dead, m3, old);
  assert.equal(m3.chats.length, 0);
  assert.deepEqual(dead.of('file_visit'), [{ visit_act: V1 }]);
});

test('the day\'s budget counts every call: an old voice with a move is two', async () => {
  const d = fakeDb({ visits: [due(V1, P1)], today: 59, modBots: { filingLinesPerDay: 60 } });
  const m = fakeModels(() => ({ move: move() }), 'Line.');
  await run(d, m, withVoice(MON, 'oldVoice'));
  assert.equal(m.completions.length, 1);
  assert.equal(m.chats.length, 0, 'the 60th call was the line; the move is over the count');
  assert.deepEqual(d.of('file_visit'), [{ visit_act: V1, line: 'Line.' }]);
});

test('a persona that is not on staff (or not in the roster) files the stock line with no model call', async () => {
  const d = fakeDb({ visits: [due(V1, P1, CLERK), due(V2, P2, 'a-persona-nobody-seeded')], standing: { [CLERK]: mod(1, { office: 'member' }), 'a-persona-nobody-seeded': mod(1) } });
  const m = fakeModels(() => ({ words: 'No.' }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(m.chats.length, 0);
  assert.deepEqual(d.of('file_visit'), [{ visit_act: V1 }, { visit_act: V2 }]);
  assert.match(out.filings[0]!.why ?? '', /not a Mod/);
  assert.match(out.filings[1]!.why ?? '', /not in the roster/);
});

test('nothing is filed before its end, even if the database offered it', async () => {
  const d = fakeDb({ visits: [due(V1, P1, MON, '2026-11-07T10:00:00.001Z'), due(V2, P2, MON, '2026-11-07T10:00:00.000Z')] });
  const m = fakeModels(() => ({ words: 'Line.' }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.deepEqual(d.of('file_visit').map((a) => a.visit_act), [V2], 'the end that has not come is left for the next run');
  assert.deepEqual(out.filings.map((f) => [f.visit, f.status]), [[V1, 'early'], [V2, 'filed']]);
});

test('a visit the tick files while the model thinks is filed once: the run finds it ended and files nothing a second time', async () => {
  const d = fakeDb({ visits: [due(V1, P1)] });
  const m = fakeModels(() => ({ words: 'Late line.', move: move() }), undefined, () => d.tick(V1));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(out.filings[0]!.status, 'already');
  assert.equal(d.state.filed.get(V1), null, 'the tick\'s stock line stands');
  assert.equal(d.state.moves.length, 1, 'the Mod\'s move was still queued once');
  const again = await run(d, fakeModels(() => ({ words: 'x' })));
  assert.ok(again.status === 'ok' && again.due === 0);
});

test('a crash between the move and the filing: the retry finds the move by its cause and queues no second', async () => {
  const d = fakeDb({ visits: [due(V1, P1)], failOn: { file_visit: 1 } });
  const first = await run(d, fakeModels(() => ({ words: 'First try.', move: move() })));
  assert.ok(first.status === 'ok');
  assert.equal(first.filings[0]!.status, 'failed');
  assert.equal(d.state.moves.length, 1);
  assert.equal(d.state.filed.size, 0, 'the visit is still open');
  const second = await run(d, fakeModels(() => ({ words: 'Second try.', move: move({ why: 'Asked differently.' }) })));
  assert.ok(second.status === 'ok');
  assert.equal(second.filings[0]!.status, 'filed');
  assert.equal(d.state.moves.length, 1, 'one cause, one move');
  assert.equal(d.state.allowance.get(MON), 1, 'the allowance was spent once');
  assert.equal(d.state.records.length, 2, 'each billed call has its record, the retry\'s too');
  assert.equal(d.state.filed.get(V1), 'Second try.');
  assert.equal((second.filings[0]!.move as { existing: boolean }).existing, true);
});

test('a database error on one visit is recorded and the run goes on to the next', async () => {
  const d = fakeDb({ visits: [due(V1, P1), due(V3, P3)], failOn: { apply_mod_move: 1 } });
  const m = fakeModels(() => ({ words: 'Line.', move: move() }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.filings.map((f) => f.status), ['failed', 'filed']);
  assert.match(out.filings[0]!.why ?? '', /connection dropped/);
  assert.deepEqual(d.of('file_visit').map((a) => a.visit_act), [V3], 'the failed visit is left open for the next run, or the tick');
});

test('a Mod\'s standing, memory and career are read once for all its visits, and its allowance is counted down as moves queue', async () => {
  const d = fakeDb({ visits: [due(V1, P1), due(V3, P3)], standing: { [MON]: mod(1) } });
  const m = fakeModels(() => ({ words: 'Line.', move: move() }));
  await run(d, m);
  assert.equal(d.count('mod_standing'), 1);
  assert.equal(d.count('staff_career'), 1);
  assert.equal(d.state.moves.length, 1);
  assert.ok((m.chats[0]!.schema as { properties: Record<string, unknown> }).properties['move'], 'the first filing is offered the one move');
  assert.equal((m.chats[1]!.schema as { properties: Record<string, unknown> }).properties['move'], undefined, 'the second finds it spent');
});

test('the run stops starting visits when its time is up; what is left is the next run\'s, or the tick\'s', async () => {
  const d = fakeDb({ visits: [due(V1, P1), due(V3, P3)] });
  let t = NOW;
  const m = fakeModels(() => { t += 200_000; return { words: 'Slow line.' }; });
  const out = await run(d, m, dividedWorld, () => t);
  assert.ok(out.status === 'ok');
  assert.equal(d.of('file_visit').length, 1);
  assert.deepEqual(out.filings.map((f) => f.status), ['filed', 'late']);
});

test('nothing at all while The System is off', async () => {
  const d = fakeDb({ enabled: false });
  const m = fakeModels(() => ({ words: 'No.' }));
  assert.deepEqual(await run(d, m), { status: 'off' });
  // Only the refund of reports already paid (no model call, no filing): the way out of a report whose judgment never came back.
  assert.deepEqual(d.calls.map((c) => c.fn), ['instance_settings', 'refund_stale_reports', 'refund_stale_appeals']);
});

test('a run refunds the reports whose judgment never came back, and a failure of that costs the filings nothing', async () => {
  const d = fakeDb({ visits: [due(V1, P1)], failOn: { refund_stale_reports: 'always' } });
  const m = fakeModels(() => ({ words: 'Filed.' }));
  const out = await run(d, m);
  assert.equal(out.status, 'ok');
  assert.equal(d.count('refund_stale_reports'), 1);
  assert.deepEqual(d.of('refund_stale_reports')[0], { minutes: 10, most: 100 });
  assert.equal(d.count('file_visit'), 1);
});

test('a run refunds the appeals whose judgment never came back, whether The System is on or off, and a failure of that costs the filings nothing', async () => {
  const d = fakeDb({ visits: [due(V1, P1)], failOn: { refund_stale_appeals: 'always' } });
  const out = await run(d, fakeModels(() => ({ words: 'Filed.' })));
  assert.equal(out.status, 'ok');
  assert.deepEqual(d.of('refund_stale_appeals'), [{ minutes: 10, most: 100 }]);
  assert.equal(d.count('file_visit'), 1);
  const off = fakeDb({ enabled: false });
  await run(off, fakeModels(() => ({})));
  assert.equal(off.count('refund_stale_appeals'), 1, 'a refund is no model call: it runs with The System off');
});

test('no judgment reads who owns a mask: no owner, class or reactor is read, and none is in the prompts', async () => {
  const d = fakeDb({ visits: [due(V1, P1)] });
  const m = fakeModels(() => ({ words: 'Filed.', move: move() }));
  await run(d, m);
  assert.deepEqual([...new Set(d.calls.map((c) => c.fn))].filter((fn) => /owner|class|reactor|reaction|account/.test(fn)), []);
  const old = fakeDb({ visits: [due(V1, P1)] });
  const m2 = fakeModels(() => ({ move: move() }), 'A line.');
  await run(old, m2, withVoice(MON, 'oldVoice'));
  for (const text of [...m.chats.flatMap((c) => [c.system, c.messages[0]!.content]), ...m2.completions.map((c) => c.prompt), ...m2.chats.flatMap((c) => [c.system, c.messages[0]!.content])]) {
    assert.ok(!/\bowner|\breactor|\bclass\b|\bclasses\b|\baccount\b/i.test(text), text.slice(0, 160));
  }
});

test('through the real model layer: each call is a ledger row naming the filing duty and the Mod, and a transport failure is retried on the request', async () => {
  const d = fakeDb({ visits: [due(V1, P1)] });
  const rows: ModelCallRow[] = [];
  const reply = (text: string) => new Response(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }],
    usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, service_tier: 'standard' },
  }), { status: 200 });
  let sent = 0;
  const fetch = (async () => {
    sent++;
    if (sent === 1) throw new TypeError('fetch failed');
    return reply(JSON.stringify({ words: 'Back from a bad connection.' }));
  }) as unknown as typeof globalThis.fetch;
  const models = realModels((n) => ({ ANTHROPIC_API_KEY: 'sk-test' } as Record<string, string>)[n], async (row) => { rows.push(row); }, {
    tiers: { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' }, fetch, sleep: async () => {},
  });
  const out = await runFilings(d.db, models, dividedWorld, SLOT, clock);
  assert.ok(out.status === 'ok');
  assert.equal(sent, 2, 'one retry');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.duty, 'filing');
  assert.equal(rows[0]!.staff, MON);
  assert.equal(rows[0]!.outcome, 'ok');
  assert.equal(rows[0]!.retries, 1);
  assert.ok(rows[0]!.costMicrodollars > 0);
  assert.deepEqual(d.of('file_visit'), [{ visit_act: V1, line: 'Back from a bad connection.' }]);
});

test('the database failing before anything is read fails the run loudly, and a bad slot is refused', async () => {
  await assert.rejects(run(fakeDb({ failOn: { filings_due: 'always' } }), fakeModels(() => ({ words: 'x' }))), /connection dropped/);
  await assert.rejects(runFilings(fakeDb().db, fakeModels(() => ({})).models, dividedWorld, 'not a time', clock), /slot is not a time/);
});

/* ---- a filing's move may confer a group (member groups plan, Task 13) ---- */

const WHO = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const confer = (over: Record<string, unknown> = {}) => ({ kind: 'conferGroup', params: { character: WHO, group: 'trial', board: GAMES }, expires_in_hours: 48, why: 'Needs a cooling off.', ...over });

test('a filing whose answer carries a conferGroup queues it with the apology demand, spends one allowance, and files', async () => {
  const d = fakeDb({ visits: [due(V1, P1)] });
  const m = fakeModels(() => ({ words: 'Cool off.', move: confer({ demand: { kind: 'postsOnBoard', params: {} } }) }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.match(m.chats[0]!.system, /trial \(Trial Members\)/);
  assert.deepEqual(d.of('apply_mod_move')[0]!.move, { kind: 'conferGroup', params: { character: WHO, group: 'trial', board: GAMES }, expires_in_hours: 48, why: 'Needs a cooling off.', demand: { kind: 'apologyAccepted', params: {} } });
  assert.equal(d.state.moves.length, 1);
  assert.equal(d.state.allowance.get(MON), 1);
  assert.deepEqual(d.of('file_visit'), [{ visit_act: V1, line: 'Cool off.' }]);
});

test('a filing by a Mod with no allowance drops the conferGroup, reads no groups, and still files', async () => {
  const d = fakeDb({ visits: [due(V1, P1)], standing: { [MON]: mod(0) } });
  const m = fakeModels(() => ({ words: 'Cool off.', move: confer() }));
  await run(d, m);
  assert.equal(d.count('mod_group_context'), 0);
  assert.equal(d.count('apply_mod_move'), 0);
  assert.equal(d.state.records[0]!.record.dropped[0].predicate, 'allowance');
  assert.equal(d.of('file_visit').length, 1);
});

test('the groups are read once per Mod per run, and again after a move is queued', async () => {
  const quiet = fakeDb({ visits: [due(V1, P1), due(V2, P2)] });
  await run(quiet, fakeModels(() => ({ words: 'Fine.' })));
  assert.equal(quiet.count('mod_group_context'), 1);
  const moved = fakeDb({ visits: [due(V1, P1), due(V2, P2)] });
  await run(moved, fakeModels(() => ({ words: 'Cool off.', move: confer() })));
  assert.equal(moved.count('mod_group_context'), 2, 'a queued move holds its character, so the next filing reads again');
});
