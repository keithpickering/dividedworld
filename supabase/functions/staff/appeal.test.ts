import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appealDoor, runAppeal } from './appeal.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import { instance as dividedWorld } from '../_shared/instance.ts';
import { AnswerRejected } from '../_shared/models/index.ts';
import type { ChatRequest, ModelResult, Models } from '../../../engine/system/model.ts';

const MON = 'placeholder-monitor';
const BOSS = 'placeholder-hype-man';
const GAMES = '11111111-1111-4111-8111-111111111111';
const THROUGH = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const PUNISHMENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const POST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const APPEAL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const THREAD = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const body = { through: THROUGH, punishment: PUNISHMENT, plea: 'Rule 2 does not cover this.' };

interface World {
  open?: 'ok' | DatabaseError | TransportError;
  /** What kind of punishment open_appeal found, and who hears it. */
  kind?: 'infraction' | 'ban';
  staff?: string;
  standing?: { office: string | null; allowance: number; order: string | null; beat: { id: string; name: string }[] };
  closedBeforeRefund?: boolean;
  failOn?: Record<string, 'always'>;
  closeSays?: Record<string, unknown>;
}

function fakeDbs(w: World = {}) {
  const calls: { db: 'player' | 'service'; fn: string; args: Record<string, any> }[] = [];
  const state = { records: [] as any[], closed: [] as any[], refunds: 0, moves: [] as any[] };
  const kind = w.kind ?? 'infraction';
  const make = (which: 'player' | 'service'): Db => ({
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ db: which, fn, args });
      if (w.failOn?.[fn] === 'always') throw new DatabaseError(`${fn} failed`, '08006', 500);
      switch (fn) {
        case 'open_appeal': {
          if (which !== 'player') throw new Error('open_appeal is the player\'s');
          if (w.open instanceof Error) throw w.open;
          return {
            appeal: APPEAL, punishment: args.punishment_act, post: POST, thread: THREAD, staff: w.staff ?? (kind === 'ban' ? BOSS : MON), price: 50, plea: args.plea, kind,
            details: { kind, filed_at: '2026-11-06T10:00:00Z', band: 'moderate', points: 4, rule: 'Rule 2: no double posting (moderate)', filed_by: MON, ...(kind === 'ban' ? { days: 3, until: '2026-11-09T10:00:00Z' } : {}) },
            board: { id: GAMES, name: 'Games', premise: 'Talk about games.' }, appellant: { id: args.through, name: 'Bob' },
          } as T;
        }
        case 'instance_settings':
          return { economy: dividedWorld.settings.economy, systemEnabled: true } as T;
        case 'mod_standing': return (w.standing ?? { office: kind === 'ban' ? 'boss' : 'mod', allowance: 2, order: 'Be fair.', beat: [{ id: GAMES, name: 'Games' }] }) as T;
        case 'rules_in_force': return [{ board: GAMES, number: 2, predicate: 'noDoublePost', param: null, band: 'moderate' }] as T;
        case 'staff_career': return { led: [], offices: [{ office: 'mod', since: '2026-10-01T00:00:00Z', until: null, cause: 'seed' }] } as T;
        case 'staff_memory_latest': return null as T;
        case 'staff_memory_at': return null as T;
        case 'staff_notes_recent': return [] as T;
        case 'character_faces': return Object.fromEntries((args.ids as string[]).map((id) => [id, { name: 'Bob', pronouns: { subject: 'they', object: 'them', determiner: 'their', possessive: 'theirs', reflexive: 'themself', plural: true } }])) as T;
        case 'pool_thread': return { title: 'Best Mario game?', posts: [{ act: POST, name: 'Bob', pronouns: { subject: 'they', object: 'them', determiner: 'their', possessive: 'theirs', reflexive: 'themself', plural: true }, body: 'Odyssey. Odyssey.' }] } as T;
        case 'record_staff_call': { state.records.push(args); return { recorded: true } as T; }
        case 'close_appeal': {
          state.closed.push(args);
          return { closed: true, ruling_act: 'ffffffff-ffff-4fff-8fff-fffffffffff1', verdict: args.verdict, staff: args.staff, line: args.line ?? 'stock', points_delta: args.verdict === 'overturned' ? -4 : 0, refunded_amount: args.verdict === 'overturned' ? 50 : 0, ...(w.closeSays ?? {}) } as T;
        }
        case 'refund_appeal': {
          state.refunds++;
          return (w.closedBeforeRefund ? { refunded: false, closed: true } : { refunded: true, amount: 50 }) as T;
        }
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
    async complete() { throw new Error('an appeal is judged in structure'); },
  };
  return { models, chats };
}
const go = (d: ReturnType<typeof fakeDbs>, m: { models: Models }, req: unknown = body) => runAppeal(d.dbs, async () => m.models, dividedWorld, req);

test('an infraction\'s appeal: opened as the player, judged on the appeal duty by the staff member the database names, recorded, and closed with the verdict', async () => {
  const d = fakeDbs();
  const m = fakeModels(() => ({ verdict: 'reduced', line: 'Half, then.' }));
  const out = await go(d, m);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(d.calls.filter((c) => c.fn === 'open_appeal').map((c) => c.db), ['player'], 'the player opens the appeal with their own session');
  assert.deepEqual(d.of('open_appeal')[0], { through: THROUGH, punishment_act: PUNISHMENT, plea: 'Rule 2 does not cover this.' });
  assert.equal(m.chats.length, 1);
  assert.equal(m.chats[0]!.duty, 'appeal');
  assert.equal(m.chats[0]!.staff, MON);
  assert.equal(m.chats[0]!.tier, 'light');
  assert.deepEqual(d.state.closed, [{ appeal_act: APPEAL, verdict: 'reduced', line: 'Half, then.', staff: MON }]);
  assert.equal(d.state.records.length, 1);
  assert.deepEqual([d.state.records[0].cause_act, d.state.records[0].duty, d.state.records[0].staff], [APPEAL, 'appeal', MON]);
  assert.equal(d.state.refunds, 0);
  assert.equal(out.body['verdict'], 'reduced');
  assert.equal(out.body['appeal'], APPEAL);
  assert.deepEqual(d.calls.filter((c) => c.db === 'service' && c.fn === 'open_appeal'), [], 'the service never opens an appeal for a player');
});

test('a ban\'s appeal is heard by the Boss the database names: the Boss is read as a staff member, and the persona\'s persuadedBy is in the prompt', async () => {
  const d = fakeDbs({ kind: 'ban' });
  const m = fakeModels(() => ({ verdict: 'overturned', line: 'Granted.' }));
  const out = await go(d, m);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(m.chats[0]!.staff, BOSS);
  assert.deepEqual(d.of('close_appeal'), [{ appeal_act: APPEAL, verdict: 'overturned', line: 'Granted.', staff: BOSS }]);
  const text = JSON.stringify(m.chats[0]);
  const persuadedBy = dividedWorld.system.roster.find((p) => p.key === BOSS)!.persuadedBy;
  assert.ok(text.includes(persuadedBy), 'the hearer\'s persuadedBy is in the prompt');
  assert.match(text, /appeal a ban to you, as the Boss/);
});

test('each of the four verdicts is sent as the Mod said it, and a blank line is sent as none', async () => {
  for (const verdict of ['overturned', 'upheld', 'reduced', 'increased']) {
    const d = fakeDbs();
    const out = await go(d, fakeModels(() => ({ verdict, line: `The Mod says ${verdict}.` })));
    assert.equal(out.status, 200);
    assert.equal(d.state.closed[0].verdict, verdict);
    assert.equal(d.state.refunds, 0, 'a ruling against the appellant is not a failure');
  }
  const d = fakeDbs();
  await go(d, fakeModels(() => ({ verdict: 'upheld', line: '  ' })));
  assert.equal(d.state.closed[0].line, null);
  assert.deepEqual(d.state.records[0].record.dropped, [{ path: 'line', predicate: 'nonEmpty' }]);
});

test('the model\'s free text is never read as a choice: a verdict outside the list, an amount or a move in the answer', async () => {
  const d = fakeDbs();
  const out = await go(d, fakeModels(() => ({ verdict: 'upheld, but double the ban', line: 'x', points: 50, move: { kind: 'setRule' } })));
  assert.equal(out.status, 502);
  assert.equal(d.state.closed.length, 0);
  const e = fakeDbs();
  await go(e, fakeModels(() => ({ verdict: 'increased', line: 'x', points: 50, days: 99 })));
  assert.deepEqual(Object.keys(e.state.closed[0]).sort(), ['appeal_act', 'line', 'staff', 'verdict'], 'only the verdict and the line go to the database');
  assert.equal(e.count('apply_mod_move'), 0);
});

test('a failed judgment refunds the appeal and says it can be made again: a failed call, a rejected answer, a verdict that is none, a hearer who is gone', async () => {
  const cases: [string, World, () => unknown][] = [
    ['the call failed', {}, () => new Error('the provider is down')],
    ['the answer was rejected', {}, () => new AnswerRejected('verdict', 'oneOf')],
    ['the verdict is none of the four', {}, () => ({ verdict: 'ban', line: 'x' })],
    ['the answer is no object', {}, () => 'overturned'],
    ['the hearer is no longer a Mod', { standing: { office: 'benched', allowance: 0, order: null, beat: [] } }, () => ({ verdict: 'upheld', line: 'x' })],
    ['the hearer is not in the roster', { staff: 'ghost' }, () => ({ verdict: 'upheld', line: 'x' })],
    ['the ruling could not be written', { failOn: { close_appeal: 'always' } }, () => ({ verdict: 'upheld', line: 'x' })],
  ];
  for (const [label, world, reply] of cases) {
    const d = fakeDbs(world);
    const out = await go(d, fakeModels(reply));
    assert.equal(out.status, 502, label);
    assert.equal(d.state.refunds, 1, label);
    assert.deepEqual(d.of('refund_appeal'), [{ appeal_act: APPEAL }], label);
    assert.match(String(out.body['error']), /refunded.*again|again.*refunded/i, label);
  }
});

test('a billed call that failed still has its record, with the predicate that failed', async () => {
  const d = fakeDbs();
  await go(d, fakeModels(() => ({ verdict: 'ban', line: 'x' })));
  assert.equal(d.state.records.length, 1);
  assert.deepEqual(d.state.records[0].record.dropped, [{ path: 'verdict', predicate: 'oneOf(overturned, upheld, reduced, increased)' }]);
  const e = fakeDbs();
  await go(e, fakeModels(() => new Error('down')));
  assert.match(String(e.state.records[0].record.why), /call failed/);
});

test('a refund that finds the appeal already ruled says so and does not call it a failure; a close that finds it refunded is told so', async () => {
  const d = fakeDbs({ closedBeforeRefund: true, failOn: { close_appeal: 'always' } });
  const out = await go(d, fakeModels(() => ({ verdict: 'upheld', line: 'x' })));
  assert.equal(out.status, 200);
  assert.equal(out.body['answered'], true);
  const e = fakeDbs({ closeSays: { closed: false, refunded: true } });
  const out2 = await go(e, fakeModels(() => ({ verdict: 'upheld', line: 'x' })));
  assert.equal(out2.status, 409);
  assert.equal(e.state.refunds, 0);
});

test('a punishment that ran out while the appeal waited is told plainly and is not refunded twice; a retried close reports the ruling\'s own numbers', async () => {
  const d = fakeDbs({ closeSays: { closed: false, refunded: true, expired: true, reason: 'that punishment had already run out before the appeal was heard' } });
  const out = await go(d, fakeModels(() => ({ verdict: 'increased', line: 'x' })));
  assert.equal(out.status, 409);
  assert.equal(out.body['expired'], true);
  assert.match(String(out.body['error']), /already run out/);
  assert.equal(d.state.refunds, 0, 'the database already refunded it');
  const e = fakeDbs({ closeSays: { closed: false, existing: true, verdict: 'reduced', points_delta: -2, until: '2026-11-08T00:00:00Z', refunded_amount: 0 } });
  const again = await go(e, fakeModels(() => ({ verdict: 'upheld', line: 'x' })));
  assert.equal(again.status, 200);
  assert.equal(again.body['verdict'], 'reduced');
  assert.equal(again.body['points_delta'], -2);
  assert.equal(again.body['until'], '2026-11-08T00:00:00Z');
});

test('the database\'s refusals reach the player in its words, and nothing is judged', async () => {
  const refusal = new DatabaseError('open_appeal: this punishment has already been appealed', '55000', 400, 'this punishment has already been appealed; each punishment is appealed once', 'kayfabb.refusal');
  const d = fakeDbs({ open: refusal });
  const m = fakeModels(() => ({ verdict: 'upheld', line: 'x' }));
  const out = await go(d, m);
  assert.equal(out.status, 400);
  assert.equal(out.body['error'], 'this punishment has already been appealed; each punishment is appealed once');
  assert.equal(m.chats.length, 0);
  assert.deepEqual(d.calls.map((c) => c.fn), ['open_appeal'], 'nothing is done as the service before the database has taken the appeal');
});

test('no session is a 401 first; a lost answer from open_appeal is said, since the appeal may be open', async () => {
  const d = fakeDbs({ open: new DatabaseError('', '', 401, '', '') });
  assert.equal((await go(d, fakeModels(() => ({})))).status, 401);
  assert.deepEqual(d.calls.map((c) => c.fn), ['open_appeal']);
  const e = fakeDbs({ open: new TransportError('no answer') });
  const out = await go(e, fakeModels(() => ({})));
  assert.equal(out.status, 503);
  assert.match(String(out.body['error']), /may have gone through/);
});

test('a malformed request is refused before the database is asked', async () => {
  for (const req of [null, 'x', {}, { through: 'no', punishment: PUNISHMENT, plea: 'x' }, { through: THROUGH, punishment: 'no', plea: 'x' }, { through: THROUGH, punishment: PUNISHMENT, plea: 7 }, { through: THROUGH, punishment: PUNISHMENT }]) {
    const d = fakeDbs();
    const out = await go(d, fakeModels(() => ({})), req);
    assert.equal(out.status, 400, JSON.stringify(req));
    assert.equal(d.calls.length, 0, JSON.stringify(req));
  }
});

test('no judgment reads who owns a mask: no owner, class or reactor is read, and none is in the prompt; the hearer is told the punishment, the post, the rule and the plea', async () => {
  for (const kind of ['infraction', 'ban'] as const) {
    const d = fakeDbs({ kind });
    const m = fakeModels(() => ({ verdict: 'upheld', line: 'x' }));
    await go(d, m);
    assert.deepEqual([...new Set(d.calls.map((c) => c.fn))].filter((fn) => /owner|class|reactor|reaction|account/.test(fn)), []);
    const text = JSON.stringify(m.chats[0]);
    assert.ok(!/\bowner|\breactor|\bclass\b|\bclasses\b|\baccount\b/i.test(text), text.slice(0, 200));
    for (const needle of ['Bob', 'Rule 2 does not cover this.', 'Odyssey. Odyssey.', 'Talk about games.', 'Rule 2: no double posting', 'moderate band (4 points)']) assert.ok(text.includes(needle), needle);
    assert.ok(!text.includes(THROUGH), 'the appellant\'s character id is not told to the model');
    assert.ok(text.includes('The appeal, from Bob (they/them)') && text.includes('The post it is about, by Bob (they/them)'), 'the appellant and the post, with their pronouns');
    assert.ok(text.includes('Your pronouns are'), 'the hearer is told its own');
  }
});

/* ------------------------------------------------------------------------------------------------------ the door ---- */

function door(w: World = {}, reply: () => unknown = () => ({ verdict: 'upheld', line: 'No.' })) {
  const d = fakeDbs(w);
  const m = fakeModels(reply);
  const made = { dbs: 0, models: 0, sessions: [] as string[] };
  const deps = {
    instance: dividedWorld,
    dbs: (session: string) => { made.dbs++; made.sessions.push(session); return d.dbs; },
    models: async () => { made.models++; return m.models; },
  };
  const send = (init: RequestInit & { headers?: Record<string, string> }) => appealDoor(new Request('https://x.test/functions/v1/staff/appeal', init), deps);
  return { d, m, made, send };
}
const post = (extra: Record<string, string> = {}, text = JSON.stringify(body)) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: text });

test('the door: no session is a 401 with no database made and no service call; the wrong method is a 405; an oversize body is a 413', async () => {
  const t = door();
  assert.equal((await t.send(post())).status, 401);
  assert.equal((await t.send({ method: 'GET' })).status, 405);
  assert.equal((await t.send(post({ Authorization: 'Bearer abc' }, JSON.stringify({ ...body, plea: 'x'.repeat(40_000) })))).status, 413);
  assert.equal((await t.send(post({ Authorization: 'Bearer ' }))).status, 401, 'an empty bearer is no session');
  assert.equal((await t.send({ method: 'OPTIONS' })).status, 204);
  assert.equal(t.made.dbs, 0, 'no connection is made for any of these');
  assert.equal(t.made.models, 0);
  assert.equal(t.d.calls.length, 0);
  const said = (await (await t.send(post())).json()) as Record<string, unknown>;
  assert.match(String(said['error']), /appeal/);
});

test('the door: a session the database refuses, or a refusal of the appeal, reaches no service read and builds no model', async () => {
  for (const open of [new DatabaseError('', '', 401, '', ''), new DatabaseError('x', '55000', 400, 'that is not a punishment of this character', 'kayfabb.refusal')]) {
    const t = door({ open });
    const out = await t.send(post({ Authorization: 'Bearer abc' }));
    assert.ok(out.status === 401 || out.status === 400);
    assert.deepEqual(t.d.calls.map((c) => `${c.db}:${c.fn}`), ['player:open_appeal'], 'only the player\'s open_appeal was called: no settings, no tiers');
    assert.equal(t.made.models, 0, 'no model is built (its tiers are a service read) before the appeal is taken');
  }
});

test('the door: a taken appeal is judged with the player\'s session passed on, and the models are built only after open_appeal', async () => {
  const t = door();
  const out = await t.send(post({ Authorization: 'Bearer abc' }));
  assert.equal(out.status, 200);
  assert.deepEqual(t.made.sessions, ['abc']);
  assert.equal(t.made.models, 1);
  assert.equal(t.d.calls[0]!.fn, 'open_appeal');
  assert.equal(t.d.calls[0]!.db, 'player');
  assert.equal(((await out.json()) as Record<string, unknown>)['verdict'], 'upheld');
});
