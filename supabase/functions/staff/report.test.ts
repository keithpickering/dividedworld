import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportDoor, runReport } from './report.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import { instance as dividedWorld } from '../_shared/instance.ts';
import { AnswerRejected } from '../_shared/models/index.ts';
import type { ChatRequest, ModelResult, Models } from '../../../engine/system/model.ts';

const MON = 'placeholder-monitor';
const GAMES = '11111111-1111-4111-8111-111111111111';
const THROUGH = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const POST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const REPORT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const THREAD = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const VISIT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const body = { through: THROUGH, post: POST, reason: 'This one bumps.' };

interface World {
  /** What open_report answers or raises. */
  open?: 'ok' | DatabaseError | TransportError;
  enabled?: boolean;
  standing?: { office: string | null; allowance: number; order: string | null; beat: { id: string; name: string }[] };
  /** A verdict that is already on the report when the failure path asks for the refund (the answer to close_report was lost). */
  closedBeforeRefund?: boolean;
  failOn?: Record<string, 'always'>;
  closeSays?: Record<string, unknown>;
  /** What `mod_group_context` answers. */
  groups?: { conferred: { key: string; name: string; tone: string }[]; characters: { id: string; capped: boolean; held: boolean }[] };
}

function fakeDbs(w: World = {}) {
  const calls: { db: 'player' | 'service'; fn: string; args: Record<string, any> }[] = [];
  const state = { records: [] as any[], closed: [] as any[], refunds: 0, moves: [] as any[] };
  const make = (which: 'player' | 'service'): Db => ({
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ db: which, fn, args });
      if (w.failOn?.[fn] === 'always') throw new DatabaseError(`${fn} failed`, '08006', 500);
      switch (fn) {
        case 'open_report': {
          if (which !== 'player') throw new Error('open_report is the player\'s');
          if (w.open instanceof Error) throw w.open;
          return {
            report: REPORT, post: args.post, thread: THREAD, staff: MON, price: 25, reason: args.reason,
            board: { id: GAMES, name: 'Games', premise: 'Talk about games.' }, reporter: { id: args.through, name: 'Ann' },
          } as T;
        }
        case 'instance_settings':
          return { economy: dividedWorld.settings.economy, systemEnabled: w.enabled ?? true } as T;
        case 'mod_group_context': return (w.groups ?? { conferred: [{ key: 'trial', name: 'Trial Members', tone: 'punishment' }, { key: 'vip', name: 'VIPs', tone: 'favor' }], characters: [] }) as T;
        case 'mod_standing': return (w.standing ?? { office: 'mod', allowance: 2, order: 'Crack down on bumping.', beat: [{ id: GAMES, name: 'Games' }] }) as T;
        case 'rules_in_force': return [{ board: GAMES, number: 2, predicate: 'noDoublePost', param: null, band: 'moderate' }, { board: null, number: 1, predicate: 'noAllCaps', param: null, band: 'minor' }] as T;
        case 'staff_career': return { led: [], offices: [{ office: 'mod', since: '2026-10-01T00:00:00Z', until: null, cause: 'seed' }] } as T;
        case 'staff_memory_latest': return null as T;
        case 'staff_memory_at': return null as T;
        case 'staff_notes_recent': return [] as T;
        case 'pool_names': return {} as T;
        case 'pool_thread': return { title: 'Best Mario game?', posts: [{ act: POST, name: 'Bob', body: 'Odyssey. Odyssey.' }] } as T;
        case 'record_staff_call': { state.records.push(args); return { recorded: true } as T; }
        case 'close_report': {
          state.closed.push(args);
          return { closed: true, verdict_act: 'ffffffff-ffff-4fff-8fff-fffffffffff1', verdict: args.verdict, staff: args.staff, line: args.line ?? 'stock', ...(args.verdict === 'dismissed' ? {} : { visit: VISIT }), ...(w.closeSays ?? {}) } as T;
        }
        case 'refund_report': {
          state.refunds++;
          return (w.closedBeforeRefund ? { refunded: false, closed: true } : { refunded: true, amount: 25 }) as T;
        }
        case 'apply_mod_move': { state.moves.push(args); return { move: 1, queued: true, existing: false } as T; }
        default: throw new Error(`the fake database has no ${fn}`);
      }
    },
  });
  return { dbs: { player: make('player'), service: make('service') }, calls, state, count: (fn: string) => calls.filter((c) => c.fn === fn).length, of: (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.args) };
}

const result = <T,>(value: T): ModelResult<T> => ({ value, usage: {}, provider: 'fake', model: 'fake', trims: [], retries: 0, costMicrodollars: 0 });
function fakeModels(reply: (r: ChatRequest) => unknown) {
  const chats: ChatRequest[] = [];
  const models: Models = {
    async chat(r) { chats.push(r); const out = reply(r); if (out instanceof Error) throw out; return result(out); },
    async complete() { throw new Error('a report is judged in structure'); },
  };
  return { models, chats };
}
const move = (over: Record<string, unknown> = {}) => ({ kind: 'setRule', params: { board: GAMES, predicate: 'noAllCaps', param: '', band: 'minor' }, expires_in_hours: 48, why: 'Too much shouting.', ...over });
const go = (d: ReturnType<typeof fakeDbs>, m: { models: Models }, req: unknown = body) => runReport(d.dbs, async () => m.models, dividedWorld, req);

test('a visit verdict: the report is opened as the player, judged on the reportJudge duty, recorded, and closed with its repaired charge', async () => {
  const d = fakeDbs();
  const m = fakeModels(() => ({ verdict: 'visit', line: 'Rule 2, I think.', charge: { rule: 'Rule 2', band: 'minor' } }));
  const out = await go(d, m);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(d.calls.filter((c) => c.fn === 'open_report').map((c) => c.db), ['player'], 'the player opens the report with their own session');
  assert.deepEqual(d.of('open_report')[0], { through: THROUGH, post: POST, reason: 'This one bumps.' });
  assert.equal(m.chats.length, 1);
  assert.equal(m.chats[0]!.duty, 'reportJudge');
  assert.equal(m.chats[0]!.staff, MON);
  assert.equal(m.chats[0]!.tier, 'light');
  assert.deepEqual(d.state.closed, [{ report_act: REPORT, verdict: 'visit', line: 'Rule 2, I think.', charge: { rule_number: 2, house: false, band: 'moderate' }, staff: MON }]);
  assert.equal(d.state.records.length, 1);
  assert.deepEqual([d.state.records[0].cause_act, d.state.records[0].duty, d.state.records[0].staff], [REPORT, 'reportJudge', MON]);
  assert.equal(d.state.refunds, 0);
  assert.equal(out.body['verdict'], 'visit');
  assert.equal(out.body['report'], REPORT);
  assert.equal(out.body['visit'], VISIT);
  assert.deepEqual(d.calls.filter((c) => c.db === 'service').map((c) => c.fn).filter((f) => f === 'open_report'), [], 'the service never opens a report for a player');
});

test('the three verdicts: dismissed draws no visit and keeps the Aura spent; backfire is sent as the Mod said it', async () => {
  for (const verdict of ['dismissed', 'backfire'] as const) {
    const d = fakeDbs();
    const out = await go(d, fakeModels(() => ({ verdict, line: `The Mod says ${verdict}.`, charge: { rule: 'Rule 2', band: 'severe' } })));
    assert.equal(out.status, 200);
    assert.equal(d.state.closed[0].verdict, verdict);
    assert.equal(d.state.closed[0].charge, null, 'only a visit carries a charge');
    assert.equal(d.state.refunds, 0, 'a dismissal is not a failure: the Aura is spent');
  }
});

test('a charge naming no rule in force is sent as the premise at the minor band', async () => {
  const d = fakeDbs();
  await go(d, fakeModels(() => ({ verdict: 'visit', line: 'Hm.', charge: { rule: 'Rule 9', band: 'severe' } })));
  assert.deepEqual(d.state.closed[0].charge, { rule_number: null, house: false, band: 'minor' });
  assert.deepEqual(d.state.records[0].record.dropped, [{ path: 'charge.rule', predicate: 'inForce' }]);
});

test('a blank line is sent as none, so the database says the stock line', async () => {
  const d = fakeDbs();
  await go(d, fakeModels(() => ({ verdict: 'dismissed', line: '  ' })));
  assert.equal(d.state.closed[0].line, null);
});

test('the Mod\'s one move rides on the verdict, caused by the report, after the verdict is written', async () => {
  const d = fakeDbs();
  const out = await go(d, fakeModels(() => ({ verdict: 'dismissed', line: 'No.', move: move() })));
  assert.equal(out.status, 200);
  assert.equal(d.state.moves.length, 1);
  assert.deepEqual([d.state.moves[0].staff, d.state.moves[0].cause_act], [MON, REPORT]);
  assert.ok(d.calls.findIndex((c) => c.fn === 'close_report') < d.calls.findIndex((c) => c.fn === 'apply_mod_move'));
  // A move the database refuses costs the verdict nothing.
  const e = fakeDbs({ failOn: { apply_mod_move: 'always' } });
  const out2 = await go(e, fakeModels(() => ({ verdict: 'dismissed', line: 'No.', move: move() })));
  assert.equal(out2.status, 200);
  assert.equal(e.state.refunds, 0);
});

test('a failed judgment refunds the report: a failed call, a rejected answer, a verdict that is none, a Mod who is gone', async () => {
  const cases: [string, World, () => unknown][] = [
    ['the call failed', {}, () => new Error('the provider is down')],
    ['the answer was rejected', {}, () => new AnswerRejected('verdict', 'oneOf')],
    ['the verdict is none of the three', {}, () => ({ verdict: 'ban', line: 'x' })],
    ['the answer is no object', {}, () => 'visit'],
    ['the Mod is no longer a Mod', { standing: { office: 'benched', allowance: 0, order: null, beat: [] } }, () => ({ verdict: 'dismissed', line: 'x' })],
    ['the verdict could not be written', { failOn: { close_report: 'always' } }, () => ({ verdict: 'dismissed', line: 'x' })],
  ];
  for (const [label, world, reply] of cases) {
    const d = fakeDbs(world);
    const out = await go(d, fakeModels(reply));
    assert.equal(out.status, 502, label);
    assert.equal(d.state.refunds, 1, label);
    assert.deepEqual(d.of('refund_report'), [{ report_act: REPORT }], label);
    assert.match(String(out.body['error']), /refunded.*again|again.*refunded/i, label);
    assert.equal(d.state.closed.length, label === 'the verdict could not be written' ? 0 : 0, label);
  }
});

test('a failed call that was billed still has its record, with the predicate that failed', async () => {
  const d = fakeDbs();
  await go(d, fakeModels(() => ({ verdict: 'ban', line: 'x' })));
  assert.equal(d.state.records.length, 1);
  assert.deepEqual(d.state.records[0].record.dropped, [{ path: 'verdict', predicate: 'oneOf(visit, dismissed, backfire)' }]);
  const e = fakeDbs();
  await go(e, fakeModels(() => new Error('down')));
  assert.equal(e.state.records.length, 1, 'a call that failed has no answer to repair but is recorded as the failure it was');
  assert.match(String(e.state.records[0].record.why), /call failed/);
});

test('a refund that finds the report already answered says so and does not call it a failure', async () => {
  const d = fakeDbs({ closedBeforeRefund: true, failOn: { close_report: 'always' } });
  const out = await go(d, fakeModels(() => ({ verdict: 'dismissed', line: 'x' })));
  assert.equal(out.status, 200);
  assert.equal(out.body['report'], REPORT);
  assert.equal(out.body['answered'], true);
});

test('a report closed by a retry or refunded in the meantime is told so', async () => {
  const d = fakeDbs({ closeSays: { closed: false, refunded: true } });
  const out = await go(d, fakeModels(() => ({ verdict: 'visit', line: 'x', charge: { rule: 'premise', band: 'minor' } })));
  assert.equal(out.status, 409);
  assert.equal(d.state.refunds, 0, 'it is already refunded; a second refund is not asked for');
});

test('the database\'s refusals reach the player in its words, and nothing is judged', async () => {
  const refusal = new DatabaseError('open_report: the Mods have heard all the reports they will today', '55000', 400, 'the Mods have heard all the reports they will today; reports open again after midnight UTC', 'kayfabb.refusal');
  const d = fakeDbs({ open: refusal });
  const m = fakeModels(() => ({ verdict: 'dismissed', line: 'x' }));
  const out = await go(d, m);
  assert.equal(out.status, 400);
  assert.equal(out.body['error'], 'the Mods have heard all the reports they will today; reports open again after midnight UTC');
  assert.equal(m.chats.length, 0);
  assert.deepEqual(d.calls.map((c) => c.fn), ['open_report'], 'nothing is done as the service before the database has taken the report');
  assert.equal(d.state.refunds, 0, 'nothing was paid');
});

test('no session is a 401 before anything else, and the same words whoever the target is', async () => {
  const d = fakeDbs({ open: new DatabaseError('', '', 401, '', '') });
  const out = await go(d, fakeModels(() => ({})));
  assert.equal(out.status, 401);
  assert.deepEqual(d.calls.map((c) => c.fn), ['open_report']);
});

test('an answer lost on the way back from open_report is said, since the report may be open: the run refunds it later', async () => {
  const d = fakeDbs({ open: new TransportError('no answer') });
  const out = await go(d, fakeModels(() => ({})));
  assert.equal(out.status, 503);
  assert.match(String(out.body['error']), /may have gone through/);
  assert.deepEqual(d.calls.map((c) => c.fn), ['open_report']);
});

test('a malformed request is refused before the database is asked', async () => {
  for (const req of [null, 'x', {}, { through: 'no', post: POST, reason: 'x' }, { through: THROUGH, post: 'no', reason: 'x' }, { through: THROUGH, post: POST, reason: 7 }, { through: THROUGH, post: POST }]) {
    const d = fakeDbs();
    const out = await go(d, fakeModels(() => ({})), req);
    assert.equal(out.status, 400, JSON.stringify(req));
    assert.equal(d.calls.length, 0, JSON.stringify(req));
  }
});

test('no judgment reads who owns a mask: no owner, class or reactor is read, and none is in the prompt; the Mod is told the reporter\'s public name and reason', async () => {
  const d = fakeDbs();
  const m = fakeModels(() => ({ verdict: 'dismissed', line: 'x', move: move() }));
  await go(d, m);
  assert.deepEqual([...new Set(d.calls.map((c) => c.fn))].filter((fn) => /owner|class|reactor|reaction|account/.test(fn)), []);
  const text = JSON.stringify(m.chats[0]);
  assert.ok(!/\bowner|\breactor|\bclass\b|\bclasses\b|\baccount\b/i.test(text), text.slice(0, 200));
  assert.ok(text.includes('Ann') && text.includes('This one bumps.') && text.includes('Odyssey. Odyssey.') && text.includes('Talk about games.') && text.includes('Rule 2: no double posting'));
  // The player's session never reaches the model or its prompt, and the service never calls open_report.
  assert.ok(!text.includes(THROUGH), 'the reporter\'s character id is not told to the model');
});

/* ------------------------------------------------------------------------------------------------------ the door ---- */

function door(w: World = {}, reply: () => unknown = () => ({ verdict: 'dismissed', line: 'No.' })) {
  const d = fakeDbs(w);
  const m = fakeModels(reply);
  const made = { dbs: 0, models: 0, sessions: [] as string[] };
  const deps = {
    instance: dividedWorld,
    dbs: (session: string) => { made.dbs++; made.sessions.push(session); return d.dbs; },
    models: async () => { made.models++; return m.models; },
  };
  const send = (init: RequestInit & { headers?: Record<string, string> }) => reportDoor(new Request('https://x.test/functions/v1/staff', init), deps);
  return { d, m, made, send };
}
const post = (extra: Record<string, string> = {}, text = JSON.stringify(body)) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: text });

test('the door: no session is a 401 with no database made and no service call; the wrong method is a 405; an oversize body is a 413', async () => {
  const t = door();
  const none = await t.send(post());
  assert.equal(none.status, 401);
  assert.equal((await t.send({ method: 'GET' })).status, 405);
  assert.equal((await t.send(post({ Authorization: 'Bearer abc' }, JSON.stringify({ ...body, reason: 'x'.repeat(20_000) })))).status, 413);
  assert.equal((await t.send(post({ Authorization: 'Bearer ' }))).status, 401, 'an empty bearer is no session');
  assert.equal((await t.send({ method: 'OPTIONS' })).status, 204);
  assert.equal(t.made.dbs, 0, 'no connection is made for any of these');
  assert.equal(t.made.models, 0);
  assert.equal(t.d.calls.length, 0);
});

test('the door: a session the database refuses, or a refusal of the report, reaches no service read and builds no model', async () => {
  for (const open of [new DatabaseError('', '', 401, '', ''), new DatabaseError('x', '55000', 400, 'banned until later', 'kayfabb.refusal')]) {
    const t = door({ open });
    const out = await t.send(post({ Authorization: 'Bearer abc' }));
    assert.ok(out.status === 401 || out.status === 400);
    assert.deepEqual(t.d.calls.map((c) => `${c.db}:${c.fn}`), ['player:open_report'], 'only the player\'s open_report was called: no settings, no tiers');
    assert.equal(t.made.models, 0, 'no model is built (its tiers are a service read) before the report is taken');
  }
});

test('the door: a taken report is judged with the player\'s session passed on, and the models are built only after open_report', async () => {
  const t = door();
  const out = await t.send(post({ Authorization: 'Bearer abc' }));
  assert.equal(out.status, 200);
  assert.deepEqual(t.made.sessions, ['abc']);
  assert.equal(t.made.models, 1);
  assert.equal(t.d.calls[0]!.fn, 'open_report');
  assert.equal(t.d.calls[0]!.db, 'player');
  assert.equal(((await out.json()) as Record<string, unknown>)['verdict'], 'dismissed');
});
