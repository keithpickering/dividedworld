import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOwedLines } from './owed.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { instance as realInstance } from '../_shared/instance.ts';
import { placeholderWorld } from '../../../instances/divided-world/system/fixtures/index.ts';
import type { Instance as WorldInstance } from '../../../engine/rules/types.ts';
import { LedgerWriteFailed } from '../_shared/models/index.ts';
import type { ChatRequest, ModelResult, Models } from '../../../engine/system/model.ts';

const dividedWorld: WorldInstance = placeholderWorld(realInstance);
const BOSS = dividedWorld.system.firstBoss;
const MON = 'placeholder-monitor';

const row = (id: number, staff = MON, over: Record<string, unknown> = {}) => ({
  id, staff, line_key: 'moveMet', thread: 't-' + id, office: 'mod', cause_act: 'a-' + id,
  facts: { move: 'Ann was made Pariah on Games.', why: 'she bumped', ended: 'it was met', maker: null }, ...over,
});

function fakeDb(rows: ReturnType<typeof row>[], opts: { enabled?: boolean; today?: number; failPayOn?: number; failOn?: string } = {}) {
  const calls: { fn: string; args: Record<string, any> }[] = [];
  const db: Db = {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      if (opts.failOn === fn) throw new DatabaseError(`${fn} failed`, '08006', 500);
      switch (fn) {
        case 'instance_settings': return { economy: dividedWorld.settings.economy, systemEnabled: opts.enabled ?? true } as T;
        case 'owed_lines_due': return rows as T;
        case 'standing_order_line_calls_today': return (opts.today ?? 0) as T;
        case 'record_staff_call': return { recorded: true } as T;
        case 'pay_owed_line':
          if (args.owed === opts.failPayOn) throw new DatabaseError('pay failed', '08006', 500);
          return { how: args.body === null ? 'stock' : 'voiced' } as T;
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
const paid = (d: ReturnType<typeof fakeDb>) => d.calls.filter((c) => c.fn === 'pay_owed_line').map((c) => c.args);

test('a line is voiced: one light call with staff set, recorded, then paid with the line', async () => {
  const d = fakeDb([row(7)]);
  const m = fakeModels(() => ({ line: 'It is met. Moving on.' }));
  const out = await runOwedLines(d.db, m.models, dividedWorld);
  assert.equal(m.chats.length, 1);
  assert.equal(m.chats[0]!.duty, 'standingOrderLine');
  assert.equal(m.chats[0]!.staff, MON);
  assert.deepEqual(paid(d), [{ owed: 7, body: 'It is met. Moving on.' }]);
  const rec = d.calls.find((c) => c.fn === 'record_staff_call')!.args;
  assert.equal(rec.duty, 'standingOrderLine');
  assert.equal(rec.cause_act, 'a-7');
  assert.equal(out.status === 'ok' && out.lines[0]!.status, 'voiced');
});

test('a failed call, a rejected answer and a blank line each pay stock', async () => {
  const d = fakeDb([row(1), row(2), row(3)]);
  const m = fakeModels((_r, n) => (n === 1 ? new Error('boom') : n === 2 ? { line: 5 } : { line: '   ' }));
  const out = await runOwedLines(d.db, m.models, dividedWorld);
  assert.equal(m.chats.length, 3);
  assert.deepEqual(paid(d), [{ owed: 1, body: null }, { owed: 2, body: null }, { owed: 3, body: null }]);
  assert.deepEqual(out.status === 'ok' && out.lines.map((l) => l.status), ['stock', 'stock', 'stock']);
});

test('over perDay no call is made and the line is paid from stock', async () => {
  const d = fakeDb([row(1)], { today: dividedWorld.settings.owedLines.perDay });
  const m = fakeModels(() => ({ line: 'x' }));
  await runOwedLines(d.db, m.models, dividedWorld);
  assert.equal(m.chats.length, 0);
  assert.deepEqual(paid(d), [{ owed: 1, body: null }]);
});

test('a speaker off the roster is paid from stock, with no call', async () => {
  const d = fakeDb([row(1, 'nobody-here')]);
  const m = fakeModels(() => ({ line: 'x' }));
  await runOwedLines(d.db, m.models, dividedWorld);
  assert.equal(m.chats.length, 0);
  assert.deepEqual(paid(d), [{ owed: 1, body: null }]);
});

test('with The System off there is no call and no payment', async () => {
  const d = fakeDb([row(1)], { enabled: false });
  const m = fakeModels(() => ({ line: 'x' }));
  const out = await runOwedLines(d.db, m.models, dividedWorld);
  assert.equal(out.status, 'off');
  assert.equal(m.chats.length, 0);
  assert.equal(paid(d).length, 0);
  assert.equal(d.calls.some((c) => c.fn === 'owed_lines_due'), false);
});

test('a ledger failure is rethrown, nothing paid', async () => {
  const d = fakeDb([row(1)]);
  await assert.rejects(runOwedLines(d.db, fakeModels(() => new LedgerWriteFailed('down')).models, dividedWorld), LedgerWriteFailed);
  assert.equal(paid(d).length, 0);
});

test('a database error on one line is recorded and the next line is still paid', async () => {
  const d = fakeDb([row(1), row(2)], { failPayOn: 1 });
  const m = fakeModels(() => ({ line: 'Fine.' }));
  const out = await runOwedLines(d.db, m.models, dividedWorld);
  assert.deepEqual(paid(d), [{ owed: 1, body: 'Fine.' }, { owed: 2, body: 'Fine.' }]);
  assert.deepEqual(out.status === 'ok' && out.lines.map((l) => l.status), ['failed', 'voiced']);
});

test('the facts the call sees carry the maker as a name, and never the speaker as its own maker', async () => {
  const d = fakeDb([row(1, MON, { facts: { move: 'm', why: 'w', ended: 'e', maker: BOSS } }), row(2, MON, { facts: { move: 'm', why: 'w', ended: 'e', maker: MON } })]);
  const m = fakeModels(() => ({ line: 'ok' }));
  await runOwedLines(d.db, m.models, dividedWorld);
  const bossName = dividedWorld.system.roster.find((r) => r.key === BOSS)!.name;
  assert.ok((m.chats[0]!.messages[0]!.content as string).includes(`made by ${bossName}.`));
  assert.doesNotMatch(m.chats[1]!.messages[0]!.content as string, /made by/);
});
