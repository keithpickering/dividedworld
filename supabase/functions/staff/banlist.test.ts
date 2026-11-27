import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBanEntries } from './banlist.ts';
import { OLD_VOICE_LINE_TOKENS } from './core.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { instance as realInstance } from '../_shared/instance.ts';
import { placeholderWorld } from '../../../instances/divided-world/system/fixtures/index.ts';
import { placeholderMonitor } from '../../../instances/divided-world/system/fixtures/placeholder-monitor.ts';
import { AnswerRejected, LedgerWriteFailed } from '../_shared/models/index.ts';
import { CHATTER_TOKENS } from '../../../engine/system/chatter.ts';
import type { ChatRequest, CompletionRequest, ModelResult, Models } from '../../../engine/system/model.ts';
import type { Instance } from '../../../engine/rules/types.ts';

const base: Instance = placeholderWorld(realInstance);
const SLOT = '2026-11-07T10:00:00.000Z';
const MON = 'placeholder-monitor';
const GAMES = '11111111-1111-4111-8111-111111111111';
const B1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const B2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const P1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const T1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const { perDay, perRun } = base.settings.owedLines;

const oldVoice: Instance = { ...base, system: { ...base.system, roster: base.system.roster.map((p) => (p.key === MON ? { ...placeholderMonitor, voice: 'oldVoice' as const } : p)) } };

const pend = (ban: string, post: string, staff = MON) => ({
  ban_act: ban, staff, banned: 'Waluigi', days: 3, rule: 'Rule 2: no double posting (moderate)', season: 4, post_act: post, thread: T1, board: GAMES, board_name: 'Games', owed_at: '2026-11-07T09:00:00.000Z',
});

interface World {
  enabled?: boolean; pending?: ReturnType<typeof pend>[]; today?: number; office?: string | null; body?: string;
  posted?: Record<string, unknown>; failOn?: Record<string, 'always'>; failPostOn?: string;
}
function fakeDb(w: World = {}) {
  const calls: { fn: string; args: Record<string, any> }[] = [];
  const records: { cause_act: string; duty: string; staff: string; record: any }[] = [];
  const pending = w.pending ?? [pend(B1, P1)];
  const db: Db = {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      if (w.failOn?.[fn]) throw new DatabaseError(`${fn}: the connection dropped`, '08006', 500);
      switch (fn) {
        case 'instance_settings': return { economy: base.settings.economy, systemEnabled: w.enabled ?? true } as T;
        case 'pending_ban_entries': return pending.slice(0, Number(args.most)) as T;
        case 'standing_order_line_calls_today': return (w.today ?? 0) as T;
        case 'mod_standing': return { office: w.office === undefined ? 'mod' : w.office, allowance: 1, order: null, beat: [{ id: GAMES, name: 'Games' }] } as T;
        case 'staff_career': return { led: [], offices: [] } as T;
        case 'staff_memory_latest': case 'staff_memory_at': return null as T;
        case 'staff_notes_recent': case 'rules_in_force': return [] as T;
        case 'pool_read': {
          const v = pending.find((x) => x.post_act === (args.named as string[])[0])!;
          return { title: 'Best Mario game?', self: null, posts: [{ act: v.post_act, seq: 1, at: '2026-11-04T09:00:00.000Z', author: 'bob', name: 'Bob', pronouns: null, body: w.body ?? 'Odyssey. Odyssey.', replyTo: null, quotes: [] }] } as T;
        }
        case 'post_ban_entry':
          if (w.failPostOn === args.ban) throw new DatabaseError('post_ban_entry failed', '08006', 500);
          return (w.posted ?? { posted: true, existing: false, post: 'p-' + args.ban }) as T;
        case 'record_staff_call': records.push({ cause_act: String(args.cause_act), duty: String(args.duty), staff: String(args.staff), record: args.record }); return { recorded: true } as T;
        default: throw new Error(`the fake database has no ${fn}`);
      }
    },
  };
  return { db, calls, records, of: (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.args), count: (fn: string) => calls.filter((c) => c.fn === fn).length };
}
const result = <T,>(value: T): ModelResult<T> => ({ value, usage: {}, provider: 'fake', model: 'fake', trims: [], retries: 0, costMicrodollars: 0 });
function fakeModels(reply: (r: ChatRequest | CompletionRequest, n: number) => unknown = () => ({ line: 'Next time, {banned}, read the rules.' })) {
  const chats: ChatRequest[] = [];
  const completes: CompletionRequest[] = [];
  const models: Models = {
    async chat(r) { chats.push(r); const out = reply(r, chats.length); if (out instanceof Error) throw out; return result(out) as never; },
    async complete(r) { completes.push(r); const out = reply(r, completes.length); if (out instanceof Error) throw out; return result(out) as never; },
  };
  return { models, chats, completes };
}
const run = (d: ReturnType<typeof fakeDb>, m: { models: Models }, instance: Instance = base) => runBanEntries(d.db, m.models, instance, SLOT, () => Date.parse(SLOT));

test('a ban\'s entry call reads the thread and the ban\'s facts, and the line goes through post_ban_entry as the model\'s', async () => {
  const d = fakeDb();
  const m = fakeModels();
  const out = await run(d, m);
  assert.equal(d.of('pending_ban_entries')[0]!.most, perRun);
  assert.equal(m.chats.length, 1);
  assert.deepEqual([m.chats[0]!.duty, m.chats[0]!.tier, m.chats[0]!.staff, m.chats[0]!.maxTokens], ['banEntry', 'light', MON, CHATTER_TOKENS]);
  const message = m.chats[0]!.messages[0]!.content;
  assert.match(message, /Best Mario game\?/);
  assert.match(message, /Odyssey\. Odyssey\./, 'the post that tipped the bar, as judged');
  assert.match(message, /Waluigi/);
  assert.match(message, /3 days/);
  assert.match(message, /Rule 2: no double posting/);
  assert.match(message, /Season 4/);
  assert.deepEqual(d.of('pool_read')[0]!.named, [P1]);
  assert.deepEqual(d.of('post_ban_entry'), [{ ban: B1, line: 'Next time, {banned}, read the rules.', source: 'model' }]);
  assert.deepEqual(d.records, [{ cause_act: B1, duty: 'banEntry', staff: MON, record: { source: 'model', trims: [], calls: 1 } }]);
  assert.deepEqual(out.status === 'ok' && out.entries.map((e) => [e.ban, e.status, e.source]), [[B1, 'posted', 'model']]);
  assert.ok(d.calls.findIndex((c) => c.fn === 'record_staff_call') < d.calls.findIndex((c) => c.fn === 'post_ban_entry'), 'the billed call is recorded before the post');
});

test('over owedLines.perDay, counting the owed lines\' calls, no call is made and the stock is posted; the day counts this run\'s calls', async () => {
  const d = fakeDb({ today: perDay });
  const m = fakeModels();
  const out = await run(d, m);
  assert.equal(d.count('standing_order_line_calls_today'), 1);
  assert.equal(m.chats.length + m.completes.length, 0);
  assert.deepEqual(d.of('post_ban_entry'), [{ ban: B1, line: null, source: 'stock' }]);
  assert.equal(d.records.length, 0);
  assert.match(out.status === 'ok' ? out.entries[0]!.why! : '', /perDay/);
  const e = fakeDb({ today: perDay - 1, pending: [pend(B1, P1), pend(B2, P2)] });
  const n = fakeModels();
  await run(e, n);
  assert.equal(n.chats.length, 1);
  assert.deepEqual(e.of('post_ban_entry').map((a) => a.source), ['model', 'stock']);
});

test('a rejected, blank, failed or model-layer-rejected answer pays the stock and records the predicate', async () => {
  for (const reply of [() => ({ line: '   ' }), () => ({}), () => ({ line: 5 }), () => new AnswerRejected('not json', 'validJson'), () => new Error('provider said no')]) {
    const d = fakeDb();
    const m = fakeModels(reply);
    const out = await run(d, m);
    assert.equal(m.chats.length, 1);
    assert.deepEqual(d.of('post_ban_entry'), [{ ban: B1, line: null, source: 'stock' }]);
    assert.equal(d.records.length, 1);
    assert.deepEqual([d.records[0]!.record.source, d.records[0]!.record.calls], ['stock', 1]);
    assert.ok(d.records[0]!.record.why);
    assert.equal(out.status === 'ok' && out.entries[0]!.source, 'stock');
  }
  const d = fakeDb();
  await run(d, fakeModels(() => new AnswerRejected('not json', 'validJson')));
  assert.match(d.records[0]!.record.why, /^the answer was rejected: /);
});

test('a repaired line records its trims, beside the line that is posted', async () => {
  const d = fakeDb();
  await run(d, fakeModels(() => ({ line: 'Gone for {days}, {banned}.' })));
  assert.equal(d.of('post_ban_entry')[0]!.line, 'Gone for days, {banned}.');
  assert.deepEqual(d.records[0]!.record.trims.map((t: any) => t.predicate), ['tokens(banEntry)']);
});

test('a Mod not on the roster or no longer a Mod: the stock at once, no call', async () => {
  for (const w of [{ pending: [pend(B1, P1, 'nobody-at-all')] }, { office: null }] as World[]) {
    const d = fakeDb(w);
    const m = fakeModels();
    await run(d, m);
    assert.equal(m.chats.length, 0, JSON.stringify(w));
    assert.deepEqual(d.of('post_ban_entry'), [{ ban: B1, line: null, source: 'stock' }]);
    assert.equal(d.records.length, 0);
  }
});

test('with the System off nothing is done: no read, no call, no post', async () => {
  const d = fakeDb({ enabled: false });
  const m = fakeModels();
  const out = await run(d, m);
  assert.equal(out.status, 'off');
  assert.equal(m.chats.length, 0);
  assert.equal(d.count('post_ban_entry'), 0);
  assert.equal(d.count('pending_ban_entries'), 0);
});

test('an old-voice Mod writes by completion, at the old voice\'s line bounds', async () => {
  const d = fakeDb();
  const m = fakeModels(() => ' Rules are rules, {banned}.');
  await run(d, m, oldVoice);
  assert.equal(m.chats.length, 0);
  assert.equal(m.completes.length, 1);
  const c = m.completes[0]!;
  assert.deepEqual([c.duty, c.staff, c.maxChars], ['banEntry', MON, 280]);
  assert.ok(c.maxTokens! <= OLD_VOICE_LINE_TOKENS && c.maxTokens! > 0);
  assert.match(c.prompt, /Odyssey\. Odyssey\./);
  assert.match(c.prompt, /Waluigi banned for 3 days/);
  assert.deepEqual(d.of('post_ban_entry'), [{ ban: B1, line: 'Rules are rules, {banned}.', source: 'model' }]);
});

test('a failed read pays the stock with the reason; a post the read does not hold too', async () => {
  const d = fakeDb({ failOn: { pool_read: 'always' } });
  const m = fakeModels();
  const out = await run(d, m);
  assert.equal(m.chats.length, 0);
  assert.deepEqual(d.of('post_ban_entry'), [{ ban: B1, line: null, source: 'stock' }]);
  assert.match(out.status === 'ok' ? out.entries[0]!.why! : '', /^the read failed: /);
});

test('a ledger failure stops the run; a database error on one entry is recorded and the run goes on', async () => {
  await assert.rejects(run(fakeDb(), fakeModels(() => new LedgerWriteFailed('no ledger'))), LedgerWriteFailed);
  const d = fakeDb({ pending: [pend(B1, P1), pend(B2, P2)], failPostOn: B1 });
  const m = fakeModels();
  const out = await run(d, m);
  assert.equal(m.chats.length, 2);
  assert.deepEqual(out.status === 'ok' && out.entries.map((e) => e.status), ['failed', 'posted']);
});

test('a post_ban_entry that posts nothing is not a post: already there, or the instance gave no words', async () => {
  const there = await run(fakeDb({ posted: { posted: false, existing: true, post: 'p' } }), fakeModels());
  assert.equal(there.status === 'ok' && there.entries[0]!.status, 'existing');
  const noWords = await run(fakeDb({ posted: { posted: false, existing: false, error: 'no words' } }), fakeModels());
  assert.deepEqual(noWords.status === 'ok' && [noWords.entries[0]!.status, noWords.entries[0]!.why], ['none', 'no words']);
});

test('nothing pending reads nothing else', async () => {
  const d = fakeDb({ pending: [] });
  const out = await run(d, fakeModels());
  assert.equal(out.status === 'ok' && out.due, 0);
  assert.deepEqual(d.calls.map((c) => c.fn).filter((f) => f !== 'instance_settings'), ['pending_ban_entries']);
  assert.equal(d.count('standing_order_line_calls_today'), 0);
});
