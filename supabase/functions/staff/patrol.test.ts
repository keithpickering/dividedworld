import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATROLS_PER_RUN, runPatrols, runPatrolsAfterFilings } from './patrol.ts';
import { RUN_BUDGET_MS } from './core.ts';
import { TransportError } from '../_shared/rpc.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { instance as dividedWorld } from '../_shared/instance.ts';
import { AnswerRejected, LedgerWriteFailed } from '../_shared/models/index.ts';
import type { ChatRequest, ModelResult, Models } from '../../../engine/system/model.ts';
import type { Instance } from '../../../engine/rules/types.ts';

const NOW = Date.parse('2026-11-07T10:00:00.000Z');
const MON = 'placeholder-monitor';
const SIGH = 'placeholder-sighbot';
const GAMES = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const P1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const P3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const OUTSIDE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9';
const T1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const V = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${n}`;

interface Standing { office: string | null; allowance: number; order: string | null; beat: { id: string; name: string }[] }
const mod = (allowance: number, over: Partial<Standing> = {}): Standing => ({ office: 'mod', allowance, order: 'Crack down on bumping in Games.', beat: [{ id: GAMES, name: 'Games' }], ...over });
const post = (act: string, name = 'Bob', body = 'Odyssey. Odyssey.') => ({ act, thread: T1, title: 'Best Mario game?', board: GAMES, name, body });

interface World {
  enabled?: boolean;
  /** The due patrols, claimed in order, once each. */
  patrols?: { id: number; staff: string }[];
  standing?: Record<string, Standing>;
  sample?: ReturnType<typeof post>[];
  load?: number;
  modBots?: Record<string, unknown>;
  /** The posts whose patrol visit the database refuses at the cap. */
  capped?: string[];
  failOn?: Record<string, 'always'>;  /** What `mod_group_context` answers. */
  groups?: { conferred: { key: string; name: string; tone: string }[]; characters: { id: string; capped: boolean; held: boolean }[] };
}

function fakeDb(w: World = {}) {
  const calls: { fn: string; args: Record<string, any> }[] = [];
  const state = {
    claimed: new Set<number>(),
    records: [] as { patrol: number; staff: string; record: any }[],
    patrolRows: new Map<number, { sampled: string[]; outcome: any }>(),
    visits: [] as { post: string; staff: string; charge: any }[],
    moves: [] as { staff: string; cause: string; move: any }[],
  };
  const patrols = w.patrols ?? [{ id: 1, staff: MON }];
  const standing = w.standing ?? { [MON]: mod(2), [SIGH]: mod(0) };
  const db: Db = {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      if (w.failOn?.[fn] === 'always') throw new DatabaseError(`${fn} failed`, '08006', 500);
      switch (fn) {
        case 'instance_settings':
          return { economy: dividedWorld.settings.economy, systemEnabled: w.enabled ?? true, modBots: { ...dividedWorld.settings.modBots, ...(w.modBots ?? {}) } } as T;
        case 'refund_stale_reports': case 'refund_stale_appeals': return 0 as T;
        case 'judgment_load_today': return (w.load ?? 0) as T;
        case 'claim_patrol': {
          // One statement in the database: whoever asks first has it.
          const next = patrols.find((p) => !state.claimed.has(p.id));
          if (!next) return null as T;
          state.claimed.add(next.id);
          return { id: next.id, meeting: 1, staff: next.staff, at: '2026-11-07T09:00:00.000Z' } as T;
        }
        case 'mod_standing': return (standing[String(args.staff)] ?? { office: null, allowance: 0, order: null, beat: [] }) as T;
        case 'mod_group_context': return (w.groups ?? { conferred: [{ key: 'trial', name: 'Trial Members', tone: 'punishment' }, { key: 'vip', name: 'VIPs', tone: 'favor' }], characters: [] }) as T;
        case 'rules_in_force': return [{ board: GAMES, number: 2, predicate: 'noDoublePost', param: null, band: 'moderate' }, { board: null, number: 1, predicate: 'noAllCaps', param: null, band: 'minor' }] as T;
        case 'board_premises': return (args.boards as string[]).map((id) => ({ id, name: 'Games', premise: 'Talk about games.' })) as T;
        case 'staff_career': return { led: [], offices: [{ office: 'mod', since: '2026-10-01T00:00:00Z', until: null, cause: 'seed' }] } as T;
        case 'staff_memory_latest': case 'staff_memory_at': return null as T;
        case 'staff_notes_recent': return ['Games gets bumped.'] as T;
        case 'pool_names': return {} as T;
        case 'patrol_sample': return (w.sample ?? [post(P1), post(P2, 'Ann', 'Hello.'), post(P3, 'Cy', 'FRIDAY')]).slice(0, Number(args.most)) as T;
        case 'record_patrol_call': { state.records.push({ patrol: Number(args.patrol), staff: String(args.staff), record: args.record }); return { recorded: true, attempt: 1 } as T; }
        case 'patrol_record': { state.patrolRows.set(Number(args.patrol), { sampled: args.sampled as string[], outcome: args.outcome }); return null as T; }
        case 'start_visit': {
          const charge = args.charge as any;
          state.visits.push({ post: String(args.post_act), staff: String(args.staff), charge });
          if (w.capped?.includes(String(args.post_act))) return { visit: null, capped: true } as T;
          return { visit: V(state.visits.length), joined: false } as T;
        }
        case 'apply_mod_move': { state.moves.push({ staff: String(args.staff), cause: String(args.cause_act), move: args.move }); return { move: state.moves.length, queued: true, existing: false } as T; }
        default: throw new Error(`the fake database has no ${fn}`);
      }
    },
  };
  return { db, calls, state, count: (fn: string) => calls.filter((c) => c.fn === fn).length, of: (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.args) };
}

const result = <T,>(value: T): ModelResult<T> => ({ value, usage: {}, provider: 'fake', model: 'fake', trims: [], retries: 0, costMicrodollars: 0 });
function fakeModels(reply: (r: ChatRequest) => unknown) {
  const chats: ChatRequest[] = [];
  const models: Models = {
    async chat(r) { chats.push(r); const out = reply(r); if (out instanceof Error) throw out; return result(out); },
    async complete() { throw new Error('a patrol is judged in structure'); },
  };
  return { models, chats };
}
const move = (over: Record<string, unknown> = {}) => ({ kind: 'setRule', params: { board: GAMES, predicate: 'noAllCaps', param: '', band: 'minor' }, expires_in_hours: 48, why: 'Too much shouting.', ...over });
const find = (post: string, rule = 'Rule 2', band = 'minor') => ({ post, charge: { rule, band } });
const run = (d: ReturnType<typeof fakeDb>, m: { models: Models }, instance: Instance = dividedWorld) => runPatrols(d.db, m.models, instance, () => NOW);

test('a due patrol is judged once on the patrolJudge duty, light tier, as the Mod: the sample read from the beat, each finding a visit with cause patrol', async () => {
  const d = fakeDb();
  const m = fakeModels(() => ({ findings: [find(P1), find(P3, 'premise', 'moderate')] }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(m.chats.length, 1);
  const c = m.chats[0]!;
  assert.equal(c.duty, 'patrolJudge');
  assert.equal(c.tier, 'light');
  assert.equal(c.staff, MON);
  assert.ok(c.rules);
  assert.deepEqual(d.of('patrol_sample'), [{ boards: [GAMES], most: dividedWorld.settings.modBots.patrolSample }]);
  assert.match(c.system, /Crack down on bumping in Games\./, 'the Boss\'s order');
  assert.match(c.messages[0]!.content, /Talk about games\./);
  assert.match(c.messages[0]!.content, new RegExp(P1));
  assert.deepEqual(d.state.visits.map((v) => [v.post, v.staff, v.charge.cause, v.charge.patrol_id]), [[P1, MON, 'patrol', 1], [P3, MON, 'patrol', 1]]);
  assert.deepEqual(d.state.visits[0]!.charge, { rule_number: 2, board: GAMES, band: 'moderate', cause: 'patrol', about_act: P1, predicate: 'noDoublePost', rule: 'Rule 2: no double posting', patrol_id: 1 });
  assert.deepEqual(d.state.visits[1]!.charge, { rule_number: null, board: GAMES, band: 'moderate', cause: 'patrol', about_act: P3, rule: 'the premise of Games', patrol_id: 1 });
  assert.deepEqual(d.state.patrolRows.get(1)!.sampled, [P1, P2, P3]);
  assert.equal(d.state.patrolRows.get(1)!.outcome.visits, 2);
  assert.deepEqual(out.patrols.map((p) => [p.patrol, p.status, p.findings, p.visits]), [[1, 'judged', 2, 2]]);
});

test('the call\'s record is kept against the patrol, before any visit starts', async () => {
  const d = fakeDb();
  const m = fakeModels(() => ({ findings: [find(P1)] }));
  await run(d, m);
  assert.equal(d.state.records.length, 1);
  assert.deepEqual([d.state.records[0]!.patrol, d.state.records[0]!.staff], [1, MON]);
  assert.equal(d.state.records[0]!.record.calls, 1);
  assert.ok(d.calls.findIndex((c) => c.fn === 'record_patrol_call') < d.calls.findIndex((c) => c.fn === 'start_visit'));
});

test('a patrol runs once: a second run, and two runs at once, judge nothing the first claimed', async () => {
  const d = fakeDb();
  const m = fakeModels(() => ({ findings: [find(P1)] }));
  await run(d, m);
  await run(d, m);
  assert.equal(m.chats.length, 1, 'a retried run judged the patrol again');
  const e = fakeDb();
  const n = fakeModels(() => ({ findings: [find(P1)] }));
  await Promise.all([run(e, n), run(e, n)]);
  assert.equal(n.chats.length, 1, 'two runs at once judged the patrol twice');
  assert.equal(e.state.visits.length, 1);
});

test('a finding naming a post that is not in the sample is dropped and recorded, and starts no visit', async () => {
  const d = fakeDb();
  const m = fakeModels(() => ({ findings: [find(OUTSIDE), find(P2)] }));
  const out = await run(d, m);
  assert.deepEqual(d.state.visits.map((v) => v.post), [P2]);
  assert.deepEqual(d.state.records[0]!.record.dropped, [{ path: 'findings[0].post', predicate: 'inSample' }]);
  assert.ok(out.status === 'ok' && out.patrols[0]!.dropped.length === 1);
});

test('a charge naming no rule in force is the premise at the minor band, with the drop recorded', async () => {
  const d = fakeDb();
  await run(d, fakeModels(() => ({ findings: [find(P1, 'Rule 9', 'severe')] })));
  assert.deepEqual(d.state.visits[0]!.charge, { rule_number: null, board: GAMES, band: 'minor', cause: 'patrol', about_act: P1, rule: 'the premise of Games', patrol_id: 1 });
  assert.deepEqual(d.state.records[0]!.record.dropped, [{ path: 'findings[0].charge.rule', predicate: 'inForce' }]);
});

test('findings past the sample\'s size are cut from the end, with a trim on the record', async () => {
  const d = fakeDb({ sample: [post(P1), post(P2)], modBots: { patrolSample: 2 } });
  await run(d, fakeModels(() => ({ findings: [find(P1), find(P2), find(P3)] })));
  assert.deepEqual(d.state.visits.map((v) => v.post), [P1, P2]);
  assert.ok(d.state.records[0]!.record.dropped.some((x: any) => x.path === 'findings[2].post'));
});

test('a finding the database refuses at the targeting cap starts no visit, and nothing else is said: the drop is the database\'s to record on the patrol', async () => {
  const d = fakeDb({ capped: [P1] });
  const out = await run(d, fakeModels(() => ({ findings: [find(P1), find(P2)], move: move() })));
  assert.ok(out.status === 'ok');
  assert.deepEqual([out.patrols[0]!.findings, out.patrols[0]!.visits, out.patrols[0]!.capped], [2, 1, 1]);
  assert.equal(d.state.patrolRows.get(1)!.outcome.capped, 1);
  // The move rides on the first visit that did start, not on the finding that was capped.
  assert.deepEqual(d.state.moves.map((x) => x.cause), [V(2)]);
});

test('every finding at the cap: no visit, so the Mod\'s move is dropped and named rather than ridden on an Act that is not there', async () => {
  const d = fakeDb({ capped: [P1] });
  const out = await run(d, fakeModels(() => ({ findings: [find(P1)], move: move() })));
  assert.equal(d.count('apply_mod_move'), 0);
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.patrols[0]!.dropped.at(-1), { path: 'move', predicate: 'noVisit' });
});

test('the Mod\'s one move is repaired and queued as the Mod\'s, caused by the patrol\'s first visit; a move the database refuses costs the visit nothing', async () => {
  const d = fakeDb();
  await run(d, fakeModels(() => ({ findings: [find(P1), find(P2)], move: move({ expires_in_hours: 900 }) })));
  assert.deepEqual(d.state.moves.map((x) => [x.staff, x.cause, x.move.expires_in_hours]), [[MON, V(1), 168]]);
  assert.deepEqual(d.state.records[0]!.record.trims, [{ path: 'move.expires_in_hours', predicate: 'atMost(168)', before: 900, after: 168 }]);
  const e = fakeDb({ failOn: { apply_mod_move: 'always' } });
  const out = await run(e, fakeModels(() => ({ findings: [find(P1)], move: move() })));
  assert.ok(out.status === 'ok' && out.patrols[0]!.status === 'judged' && out.patrols[0]!.visits === 1);
});

test('a patrol that finds nothing is whole: no visit, no move asked, the sample kept', async () => {
  const d = fakeDb();
  const out = await run(d, fakeModels(() => ({ findings: [] })));
  assert.ok(out.status === 'ok');
  assert.equal(d.count('start_visit'), 0);
  assert.equal(d.count('apply_mod_move'), 0);
  assert.deepEqual(d.state.patrolRows.get(1)!.sampled, [P1, P2, P3]);
  assert.equal(out.patrols[0]!.status, 'judged');
});

test('nothing at all unless The System is on: no patrol is claimed', async () => {
  const d = fakeDb({ enabled: false });
  const m = fakeModels(() => ({ findings: [] }));
  const out = await run(d, m);
  assert.deepEqual(out, { status: 'off' });
  assert.equal(d.count('claim_patrol'), 0);
  assert.equal(m.chats.length, 0);
});

test('a patrol whose Mod has left the staff is skipped and recorded, with no call and no sample', async () => {
  const d = fakeDb({ standing: { [MON]: { office: 'benched', allowance: 0, order: null, beat: [] } } });
  const m = fakeModels(() => ({ findings: [] }));
  const out = await run(d, m);
  assert.equal(m.chats.length, 0);
  assert.equal(d.count('patrol_sample'), 0);
  assert.ok(out.status === 'ok' && out.patrols[0]!.status === 'skipped');
  assert.match(String(d.state.patrolRows.get(1)!.outcome.skipped), /not a Mod/);
  // A persona the roster does not hold is skipped the same.
  const e = fakeDb({ patrols: [{ id: 5, staff: 'nobody' }] });
  const out2 = await run(e, fakeModels(() => ({ findings: [] })));
  assert.ok(out2.status === 'ok' && out2.patrols[0]!.status === 'skipped');
});

test('an empty sample, or a Mod with no beat, is skipped and recorded with no call', async () => {
  const d = fakeDb({ sample: [] });
  const m = fakeModels(() => ({ findings: [] }));
  const out = await run(d, m);
  assert.equal(m.chats.length, 0);
  assert.ok(out.status === 'ok' && out.patrols[0]!.status === 'skipped');
  assert.match(String(d.state.patrolRows.get(1)!.outcome.skipped), /nothing/);
  const e = fakeDb({ standing: { [MON]: mod(1, { beat: [] }) } });
  await run(e, m);
  assert.equal(e.count('patrol_sample'), 0);
});

test('the day\'s judgment budget: a spent day claims nothing, so the patrol waits for tomorrow rather than being lost', async () => {
  const d = fakeDb({ load: dividedWorld.settings.modBots.judgmentsPerDay });
  const m = fakeModels(() => ({ findings: [] }));
  const out = await run(d, m);
  assert.equal(d.count('claim_patrol'), 0);
  assert.equal(m.chats.length, 0);
  assert.ok(out.status === 'ok' && out.patrols.length === 0 && out.budgetSpent === true);
});

test('a run judges at most PATROLS_PER_RUN patrols, each against the budget as it goes', async () => {
  const many = Array.from({ length: PATROLS_PER_RUN + 3 }, (_, i) => ({ id: i + 1, staff: MON }));
  const d = fakeDb({ patrols: many });
  const m = fakeModels(() => ({ findings: [] }));
  await run(d, m);
  assert.equal(m.chats.length, PATROLS_PER_RUN);
  assert.ok(d.count('judgment_load_today') >= PATROLS_PER_RUN, 'the budget was asked before each claim');
});

test('a failed or rejected call is recorded on the patrol and starts no visit; the run goes on to the next patrol', async () => {
  const d = fakeDb({ patrols: [{ id: 1, staff: MON }, { id: 2, staff: MON }] });
  let n = 0;
  const m = fakeModels(() => (++n === 1 ? new AnswerRejected('the answer was not an object', 'isObject') : { findings: [find(P1)] }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.patrols.map((p) => p.status), ['failed', 'judged']);
  assert.match(String(d.state.patrolRows.get(1)!.outcome.failed), /rejected/);
  assert.equal(d.state.visits.length, 1);
  assert.equal(d.state.records.length, 2, 'both billed calls have a record');
});

test('a ledger row that could not be written stops the run: an unrecorded call is not trusted', async () => {
  const d = fakeDb({ patrols: [{ id: 1, staff: MON }, { id: 2, staff: MON }] });
  const m = fakeModels(() => new LedgerWriteFailed('the ledger is down'));
  await assert.rejects(run(d, m), LedgerWriteFailed);
  assert.equal(m.chats.length, 1);
});

test('a database error on one patrol is recorded and the run goes on', async () => {
  const d = fakeDb({ patrols: [{ id: 1, staff: MON }, { id: 2, staff: MON }], failOn: { board_premises: 'always' } });
  const out = await run(d, fakeModels(() => ({ findings: [] })));
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.patrols.map((p) => p.status), ['failed', 'failed']);
});

test('masks: the prompt holds no owner, class or reactor, and the run reads nothing but public play and the Mod\'s own record', async () => {
  const d = fakeDb();
  const m = fakeModels(() => ({ findings: [] }));
  await run(d, m);
  const c = m.chats[0]!;
  for (const text of [c.system, c.messages[0]!.content]) assert.ok(!/\bowner|\breactor|\bclass\b|\bclasses\b|\baccount\b|\bplayer behind/i.test(text), text.slice(0, 200));
  const allowed = new Set(['instance_settings', 'refund_stale_reports', 'refund_stale_appeals', 'judgment_load_today', 'claim_patrol', 'mod_standing', 'rules_in_force', 'board_premises', 'staff_career', 'staff_memory_latest',
    'staff_memory_at', 'staff_notes_recent', 'pool_names', 'patrol_sample', 'record_patrol_call', 'patrol_record', 'start_visit', 'apply_mod_move', 'mod_group_context']);
  assert.deepEqual([...new Set(d.calls.map((x) => x.fn))].filter((f) => !allowed.has(f)), [], 'a call outside the reviewed list');
  // No argument names an account, an owner or a character: posts and boards only.
  for (const call of d.calls) assert.ok(!/owner|account|reactor/i.test(JSON.stringify(call.args)), call.fn);
});

test('the oldVoice persona is judged in structure like any other: a patrol is a pick from a list', async () => {
  const withVoice: Instance = { ...dividedWorld, system: { ...dividedWorld.system, roster: dividedWorld.system.roster.map((p) => (p.key === MON ? { ...p, voice: 'oldVoice' as const } : p)) } };
  const d = fakeDb();
  const m = fakeModels(() => ({ findings: [find(P1)] }));
  await run(d, m, withVoice);
  assert.equal(m.chats.length, 1);
  assert.equal(d.state.visits.length, 1);
});

test('one clock for the invocation: filings that used the run\'s time leave the patrols none, and nothing is claimed', async () => {
  const d = fakeDb();
  const m = fakeModels(() => ({ findings: [] }));
  const out = await runPatrols(d.db, m.models, dividedWorld, () => NOW, NOW - RUN_BUDGET_MS - 1);
  assert.ok(out.status === 'ok' && out.patrols.length === 0);
  assert.equal(d.count('claim_patrol'), 0);
  assert.equal(m.chats.length, 0);
  const e = fakeDb();
  await runPatrols(e.db, fakeModels(() => ({ findings: [] })).models, dividedWorld, () => NOW, NOW - 1000);
  assert.equal(e.count('claim_patrol'), 2);
});

test('the patrol run beside the filings: its own failure is answered as failed, but an error that stops the run is rethrown', async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    const m = fakeModels(() => ({ findings: [] })).models;
    const soft = fakeDb({ failOn: { claim_patrol: 'always' } });
    assert.deepEqual(await runPatrolsAfterFilings(soft.db, m, dividedWorld, () => NOW, NOW, 'slot'), { status: 'failed' });
    const ledger = fakeDb();
    const down = fakeModels(() => new LedgerWriteFailed('the ledger is down')).models;
    await assert.rejects(runPatrolsAfterFilings(ledger.db, down, dividedWorld, () => NOW, NOW, 'slot'), LedgerWriteFailed);
    const wire: Db = { async rpc<T>(fn: string): Promise<T> { if (fn === 'instance_settings') throw new TransportError('no answer'); throw new Error('x'); } };
    await assert.rejects(runPatrolsAfterFilings(wire, m, dividedWorld, () => NOW, NOW, 'slot'), TransportError);
  } finally { console.error = quiet; }
});

/* ---- a Mod's patrol confers a group (member groups plan, Task 13) ---- */

const WHO = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const confer = (over: Record<string, unknown> = {}) => ({ kind: 'conferGroup', params: { character: WHO, group: 'trial', board: GAMES }, expires_in_hours: 48, why: 'Needs a cooling off.', ...over });

test('a patrol\'s conferGroup is told the catalog, queued with the apology demand after the first visit, and spends the allowance as the database does', async () => {
  const d = fakeDb({ standing: { [MON]: mod(2) } });
  const m = fakeModels(() => ({ findings: [find(P1)], move: confer({ demand: { kind: 'postsOnBoard', params: {} } }) }));
  await run(d, m);
  assert.equal(d.count('mod_group_context'), 1);
  assert.match(m.chats[0]!.system, /trial \(Trial Members\)/);
  assert.ok(!m.chats[0]!.system.includes('VIPs'));
  assert.equal(d.state.moves.length, 1);
  assert.deepEqual([d.state.moves[0]!.staff, d.state.moves[0]!.cause], [MON, V(1)]);
  assert.deepEqual(d.state.moves[0]!.move, { kind: 'conferGroup', params: { character: WHO, group: 'trial', board: GAMES }, expires_in_hours: 48, why: 'Needs a cooling off.', demand: { kind: 'apologyAccepted', params: {} } });
});

test('a patrol with no allowance reads no groups and queues no move, the conferGroup dropped for the allowance', async () => {
  const d = fakeDb({ standing: { [MON]: mod(0) } });
  const m = fakeModels(() => ({ findings: [find(P1)], move: confer() }));
  await run(d, m);
  assert.equal(d.count('mod_group_context'), 0);
  assert.equal(d.state.moves.length, 0);
  assert.deepEqual(d.state.records[0]!.record.dropped, [{ path: 'move', predicate: 'allowance' }]);
});

test('a patrol\'s conferGroup on a capped or held character is dropped, and its visit still starts', async () => {
  const d = fakeDb({ standing: { [MON]: mod(2) }, groups: { conferred: [{ key: 'trial', name: 'Trial Members', tone: 'punishment' }], characters: [{ id: WHO.toUpperCase(), capped: true, held: false }] } });
  const m = fakeModels(() => ({ findings: [find(P1)], move: confer() }));
  await run(d, m);
  assert.equal(d.state.visits.length, 1);
  assert.equal(d.state.moves.length, 0);
  assert.deepEqual(d.state.records[0]!.record.dropped, [{ path: 'move.params.character', predicate: 'underPunishmentCap' }]);
});
