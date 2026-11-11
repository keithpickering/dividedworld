import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runApologies } from './apology.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import { instance as dividedWorld } from '../_shared/instance.ts';
import { AnswerRejected, LedgerWriteFailed } from '../_shared/models/index.ts';
import type { ChatRequest, ModelResult, Models } from '../../../engine/system/model.ts';

const MON = 'placeholder-monitor';
const BOSS = dividedWorld.system.firstBoss;
const word = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(' ');

const row = (apology: number, staff = MON) => ({
  apology, move_act: 'm-' + apology, apology_act: 'a-' + apology, character: 'c-' + apology, character_name: 'Ann', staff, kind: 'conferGroup', params: {},
  line: 'Ann was made Pariah on Games.', title: null, body: 'I am sorry I bumped.', created_at: '2026-11-07T09:00:00Z',
});

function fakeDb(rows: ReturnType<typeof row>[], opts: { failOn?: string; enabled?: boolean; offices?: Record<string, string | null> } = {}) {
  const calls: { fn: string; args: Record<string, any> }[] = [];
  const db: Db = {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      if (opts.failOn === fn) throw new DatabaseError(`${fn} failed`, '08006', 500);
      switch (fn) {
        case 'instance_settings': return { economy: dividedWorld.settings.economy, systemEnabled: opts.enabled ?? true } as T;
        case 'pending_apologies': return rows as T;
        case 'mod_standing': return { office: (opts.offices ?? { [BOSS]: 'boss', [MON]: 'mod' })[String(args.staff)] ?? null, allowance: 0, order: null, beat: [] } as T;
        case 'record_staff_call': return { recorded: true } as T;
        case 'rule_apology': return { state: args.verdict } as T;
        default: throw new Error(`unexpected ${fn}`);
      }
    },
  };
  return { db, calls };
}
const result = <T,>(value: T): ModelResult<T> => ({ value, usage: {}, provider: 'fake', model: 'fake', trims: [], retries: 0, costMicrodollars: 0 });
function fakeModels(reply: (r: ChatRequest, n: number) => unknown) {
  const chats: ChatRequest[] = [];
  const models: Models = {
    async chat(r) { chats.push(r); const out = reply(r, chats.length); if (out instanceof Error) throw out; return result(out); },
    async complete() { throw new Error('structure only'); },
  };
  return { models, chats };
}
const ruled = (d: ReturnType<typeof fakeDb>) => d.calls.filter((c) => c.fn === 'rule_apology').map((c) => c.args);

test('one call is made (models.chat retries transport itself): an answer is accepted and rule_apology is called with the ruling', async () => {
  const d = fakeDb([row(7)]);
  const m = fakeModels(() => ({ verdict: 'accepted', ruling: 'Fine. Go.' }));
  const out = await runApologies(d.db, m.models, dividedWorld);
  assert.equal(m.chats.length, 1);
  assert.equal(m.chats[0]!.duty, 'apologyJudge');
  assert.equal(m.chats[0]!.staff, MON);
  assert.deepEqual(ruled(d), [{ in_apology: 7, verdict: 'accepted', ruling: 'Fine. Go.' }]);
  assert.equal(d.calls.find((c) => c.fn === 'record_staff_call')!.args.record.calls, 1);
  assert.equal(out.status, 'ok');
});

test('a transport failure that models.chat gave up on stops the run, nothing ruled', async () => {
  const d = fakeDb([row(1)]);
  await assert.rejects(runApologies(d.db, fakeModels(() => new TransportError('down')).models, dividedWorld), TransportError);
  assert.equal(ruled(d).length, 0);
});

test('an answer of "maybe" is rejected naming oneOf and the apology is returned', async () => {
  const d = fakeDb([row(8)]);
  const m = fakeModels(() => ({ verdict: 'maybe', ruling: 'Hm.' }));
  const out = await runApologies(d.db, m.models, dividedWorld);
  assert.deepEqual(ruled(d), [{ in_apology: 8, verdict: 'returned', ruling: '' }]);
  const rec = d.calls.find((c) => c.fn === 'record_staff_call')!.args;
  assert.equal(rec.duty, 'apologyJudge');
  assert.deepEqual(rec.record.dropped, [{ path: 'verdict', predicate: 'oneOf(accepted, rejected)' }]);
  assert.equal(out.status === 'ok' && out.apologies[0]!.status, 'returned');
});

test('a call that fails, and a rejected answer, return the apology, one call each', async () => {
  const d = fakeDb([row(1), row(2)]);
  const m = fakeModels((_r, n) => (n === 1 ? new Error('boom') : new AnswerRejected('ruling', 'isString')));
  await runApologies(d.db, m.models, dividedWorld);
  assert.equal(m.chats.length, 2);
  assert.deepEqual(ruled(d).map((r) => r.verdict), ['returned', 'returned']);
});

test('an 81-word ruling is trimmed to 80 and the trim is on the call record', async () => {
  const d = fakeDb([row(3)]);
  const m = fakeModels(() => ({ verdict: 'rejected', ruling: word(81) }));
  await runApologies(d.db, m.models, dividedWorld);
  assert.equal(ruled(d)[0]!.ruling, word(80));
  assert.deepEqual(d.calls.find((c) => c.fn === 'record_staff_call')!.args.record.trims, [{ path: 'ruling', predicate: 'maxWords(80)', before: 81, after: 80 }]);
});

test('a move the Boss made is judged by the Boss, a Mod\'s by the Mod; the prompt is the persona\'s and names no owner', async () => {
  const d = fakeDb([row(4, BOSS), row(5, MON)]);
  const m = fakeModels(() => ({ verdict: 'accepted', ruling: 'Ok.' }));
  await runApologies(d.db, m.models, dividedWorld);
  assert.deepEqual(m.chats.map((c) => c.staff), [BOSS, MON]);
  const boss = dividedWorld.system.roster.find((p) => p.key === BOSS)!;
  assert.ok(m.chats[0]!.system.includes(boss.selfPrompt));
  assert.ok(m.chats[0]!.system.startsWith(dividedWorld.system.offices.boss.premise), 'a Boss judges in the Boss\'s frame');
  assert.ok(m.chats[1]!.system.startsWith(dividedWorld.system.offices.mod.premise), 'a Mod in the Mod\'s');
  assert.match(m.chats[0]!.messages[0]!.content, /Ann was made Pariah on Games\./);
});

test('a judge who holds no posting office now (benched) judges in the member frame, which says it holds no office', async () => {
  const d = fakeDb([row(8, MON)], { offices: { [MON]: 'benched' } });
  const m = fakeModels(() => ({ verdict: 'accepted', ruling: 'Ok.' }));
  await runApologies(d.db, m.models, dividedWorld);
  assert.ok(m.chats[0]!.system.startsWith(dividedWorld.system.offices.member.premise));
  assert.match(m.chats[0]!.system, /You hold no office now/);
});

test('a staff key not on the roster returns the apology without a call', async () => {
  const d = fakeDb([row(6, 'nobody')]);
  const m = fakeModels(() => ({ verdict: 'accepted', ruling: 'x' }));
  await runApologies(d.db, m.models, dividedWorld);
  assert.equal(m.chats.length, 0);
  assert.deepEqual(ruled(d), [{ in_apology: 6, verdict: 'returned', ruling: '' }]);
});

test('a database error is thrown at once, and a ledger failure stops the run', async () => {
  const d = fakeDb([row(9)], { failOn: 'rule_apology' });
  await assert.rejects(runApologies(d.db, fakeModels(() => ({ verdict: 'accepted', ruling: 'x' })).models, dividedWorld), DatabaseError);
  const d2 = fakeDb([row(9), row(10)]);
  const m2 = fakeModels(() => new LedgerWriteFailed('no row'));
  await assert.rejects(runApologies(d2.db, m2.models, dividedWorld), LedgerWriteFailed);
  assert.equal(m2.chats.length, 1);
  assert.equal(ruled(d2).length, 0);
});

test('with The System off nothing is read or called', async () => {
  const d = fakeDb([row(1)], { enabled: false });
  const m = fakeModels(() => ({}));
  const out = await runApologies(d.db, m.models, dividedWorld);
  assert.equal(out.status, 'off');
  assert.equal(m.chats.length, 0);
});
