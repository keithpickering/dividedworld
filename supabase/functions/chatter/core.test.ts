import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChatter } from './core.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { instance as realInstance } from '../_shared/instance.ts';
import { placeholderWorld } from '../../../instances/divided-world/system/fixtures/index.ts';
import { AnswerRejected, LedgerWriteFailed, models as realModels } from '../_shared/models/index.ts';
import type { ModelCallRow } from '../_shared/models/ledger.ts';
import type { ChatRequest, CompletionRequest, ModelResult, Models } from '../../../engine/system/model.ts';
import type { Instance } from '../../../engine/rules/types.ts';
import { autocorrect as autocorrectRules } from '../../../instances/divided-world/cards/autocorrect.ts';
import { staffOffers } from '../../../engine/rules/cards.ts';
import { laughTrack as laughTrackRules } from '../../../instances/divided-world/cards/laugh-track.ts';
import { whoops as whoopsRules } from '../../../instances/divided-world/cards/whoops.ts';

const dividedWorld: Instance = placeholderWorld(realInstance);

// A Wednesday: the week's 20 posts over its five days left give an allowance of 4, so three posts and one card slot.
const SLOT = '2026-11-04T17:37:00.000Z';
const DAY = '2026-11-04';
const CLERK = 'placeholder-clerk';
const HYPE = 'placeholder-hype-man';
const SIGH = 'placeholder-sighbot';
const MON = 'placeholder-monitor';
const GENERAL = '11111111-1111-4111-8111-111111111111';
const T1 = '33333333-3333-4333-8333-333333333331';
const T2 = '33333333-3333-4333-8333-333333333332';
const T3 = '33333333-3333-4333-8333-333333333333';
const Q1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const Q2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const Q3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

interface World {
  enabled?: boolean;
  /** Overrides for Settings.pool. */
  pool?: Record<string, unknown>;
  /** The slots the week spent before today. */
  priorSpent?: number;
  failOn?: Record<string, number | 'always'>;
  /** What the card doors say. */
  cardRefusal?: string;
  /** The personas whose signals fire: three by default. */
  named?: string[];
  boards?: Record<string, string>;
  /** Personas whose signal names no thread (the pick's thread-null stumble). */
  noThread?: string[];
  /** The body card_target_reach reports for a post the run did not write. */
  targetBody?: string;
  /** The open walls pool_thread reports on every thread (`{ play, card, about }`). */
  walls?: { play: string; card: string; about: string }[];
}
type Spend = { day: string; staff: string; trigger: string; post_act: string; card_act: string | null; started_thread: boolean; record: any };

function fakeDb(w: World = {}) {
  const calls: { fn: string; args: Record<string, any> }[] = [];
  const state = { held: false, acts: [] as { id: string; staff: string; kind: string; thread: string | null; target: string | null; payload: any }[], spends: [] as Spend[], notes: [] as { staff: string; post: string; body: string }[], n: 0 };
  const failing = { ...(w.failOn ?? {}) };
  const named = w.named ?? [SIGH, CLERK, MON];
  const threads = [T1, T2, T3];
  const quotes = [Q1, Q2, Q3];
  const nextId = (p: string) => `${p}-${(++state.n).toString().padStart(4, '0')}`;
  const db: Db = {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      const f = failing[fn];
      if (f === 'always' || (typeof f === 'number' && f > 0)) {
        if (typeof f === 'number') failing[fn] = f - 1;
        throw new DatabaseError(`${fn}: the connection dropped`, '08006', 500);
      }
      switch (fn) {
        case 'instance_settings': return { economy: dividedWorld.settings.economy, systemEnabled: w.enabled ?? true, ...(w.pool ? { pool: { ...dividedWorld.settings.pool, ...w.pool } } : {}) } as T;
        case 'claim_pool_run': return (state.held ? null : 'run-0001') as T;
        case 'pool_context':
          return { season: { startsAt: Date.parse('2026-10-01T00:00:00Z'), endsAt: Date.parse('2026-12-30T00:00:00Z') }, boss: HYPE, predecessor: null,
            offices: { [CLERK]: 'member', [HYPE]: 'boss', [SIGH]: 'mod', [MON]: 'mod' }, characters: {}, boards: w.boards ?? { [GENERAL]: 'general' } } as T;
        case 'pool_week': {
          const today = state.spends.filter((s) => s.day === args.today);
          const monday = new Date(Date.parse(String(args.today)) - ((new Date(String(args.today)).getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
          const before = state.spends.filter((s) => s.day >= monday && s.day < String(args.today));
          return { spent: (w.priorSpent ?? 0) + before.reduce((n, s) => n + 1 + (s.card_act === null ? 0 : 1), 0), threads: before.filter((s) => s.started_thread).length, today: today.map((s) => ({ staff: s.staff, post_act: s.post_act, card_act: s.card_act, started_thread: s.started_thread })) } as T;
        }
        case 'pool_signals':
          return { named: named.map((s, i) => ({ staff: s, act: quotes[i], thread: (w.noThread ?? []).includes(s) ? null : threads[i], n: 1 })), quoted: [], legacy: [], reversals: [], handovers: [], hot: [], tallies: [] } as T;
        case 'staff_memory_latest': return null as T;
        case 'staff_memory_at': return null as T;
        case 'staff_career': return { led: [], offices: [] } as T;
        case 'staff_notes_recent': return ['An earlier thought.'] as T;
        case 'character_faces': return {} as T;
        case 'pool_thread': {
          const at = threads.indexOf(args.in_thread as string);
          return { title: `Thread ${at}`, posts: [{ act: quotes[at] ?? 'none', name: 'Ann', pronouns: { subject: 'she', object: 'her', determiner: 'her', possessive: 'hers', reflexive: 'herself', plural: false }, body: 'Hello there.' }], ...(w.walls ? { walls: w.walls } : {}) } as T;
        }
        case 'pool_orphans': {
          // Every marked post of the week up to `through` that no spend names (the earliest for a persona and a day), with the card marked
          // the same day, of the same persona, on the post itself or on the post's quoted target.
          const through = String(args.through);
          const monday = new Date(Date.parse(through) - ((new Date(through).getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
          const out: unknown[] = [];
          for (const mark of state.acts) {
            const day = mark.payload?.pool as string | undefined;
            if (mark.kind === 'card' || mark.kind === 'set' || !day || day < monday || day > through || state.spends.some((s) => s.post_act === mark.id)) continue;
            if (out.some((o: any) => o.staff === mark.staff && o.day === day)) continue;
            const tied = state.acts.find((a) => a.staff === mark.staff && !state.spends.some((s) => s.card_act === a.id)
              && ((a.kind === 'set' && a.target === mark.id) || (a.kind === 'card' && a.payload?.pool === day && mark.target !== null && a.target === mark.target)));
            out.push({ staff: mark.staff, day, act: mark.id, startedThread: mark.kind === 'thread', card: tied?.id ?? null });
          }
          return out as T;
        }
        case 'write_staff_act': {
          const a = { id: nextId('act'), staff: String(args.staff_key), kind: 'post', thread: args.thread as string, target: args.target as string | null, payload: args.payload };
          state.acts.push(a);
          return { id: a.id } as T;
        }
        case 'write_staff_thread': {
          const a = { id: nextId('act'), staff: String(args.staff_key), kind: 'thread', thread: nextId('thread'), target: null, payload: { body: args.body, title: args.title, board: args.board, ...(args.marker as object) } };
          state.acts.push(a);
          return { thread: { id: a.thread }, act: { id: a.id } } as T;
        }
        case 'staff_play_card':
        case 'staff_set_card': {
          if (w.cardRefusal) throw new DatabaseError(`${fn}: ${w.cardRefusal}`, '55000', 400, w.cardRefusal);
          const a = { id: nextId('card'), staff: String(args.staff_key), kind: fn === 'staff_set_card' ? 'set' : 'card', thread: null, target: args.target as string, payload: fn === 'staff_set_card' ? {} : { card: args.card, ...(args.pool_day ? { pool: args.pool_day } : {}) } };
          state.acts.push(a);
          return { id: a.id } as T;
        }
        case 'staff_play_surface_card': {
          if (w.cardRefusal) throw new DatabaseError(`${fn}: ${w.cardRefusal}`, '55000', 400, w.cardRefusal);
          const a = { id: nextId('card'), staff: String(args.staff_key), kind: 'card', thread: null, target: args.target as string, payload: { card: args.card, ...(args.pool_day ? { pool: args.pool_day } : {}) } };
          state.acts.push(a);
          return { id: a.id, draw: { id: nextId('draw'), covered: 1, live: [] } } as T;
        }
        case 'staff_draw_on_surface': {
          const a = { id: nextId('draw'), staff: String(args.staff_key), kind: 'draw', thread: null, target: args.play as string, payload: args.payload };
          state.acts.push(a);
          return { id: a.id, covered: 1, live: [a.id] } as T;
        }
        case 'card_target_reach': {
          // The post as the act function reads it: a quoted post says Hello there.; a post the run wrote says what it was given.
          const wrote = state.acts.find((a) => a.id === args.target);
          const body = wrote ? String(wrote.payload?.body ?? '') : (w.targetBody ?? 'Hello there. Pineapple is a fine topping.');
          return { act: args.target, kind: 'post', length: body.length, body, version: 'v1', effects: [], above: {} } as T;
        }
        case 'write_staff_note': state.notes.push({ staff: String(args.staff_key), post: String(args.post), body: String(args.body) }); return 1 as T;
        case 'record_pool_spend': {
          if (state.spends.some((s) => s.day === args.on_day && s.staff === args.of_staff)) return { status: 'already' } as T;
          state.spends.push({ day: String(args.on_day), staff: String(args.of_staff), trigger: String(args.by_trigger), post_act: String(args.post), card_act: (args.card as string | null) ?? null, started_thread: Boolean(args.started), record: args.note });
          return { status: 'spent' } as T;
        }
        default: throw new Error(`the fake database has no ${fn}`);
      }
    },
  };
  return { db, calls, state, count: (fn: string) => calls.filter((c) => c.fn === fn).length, of: (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.args) };
}

const result = <T,>(value: T): ModelResult<T> => ({ value, usage: {}, provider: 'fake', model: 'fake', trims: [], retries: 0, costMicrodollars: 0 });
/** A fake model: `reply` is the answer for a chat request (a function of it), or an Error to throw. */
function fakeModels(reply: (r: ChatRequest) => unknown, completion: string | Error = 'hello from the old voice') {
  const chats: ChatRequest[] = [];
  const completions: CompletionRequest[] = [];
  const models: Models = {
    async chat(r) {
      chats.push(r);
      const out = reply(r);
      if (out instanceof Error) throw out;
      return result(out);
    },
    async complete(r) {
      completions.push(r);
      if (completion instanceof Error) throw completion;
      return result(completion);
    },
  };
  return { models, chats, completions };
}
/** A thread start is the one request that asks for a title; it may set a set card on its own post (a pool that plays uncommons). A reply may leave a note. */
const normal = (r: ChatRequest) => {
  const asksTitle = (r.schema as any).required.includes('title');
  return asksTitle
    ? { words: `Opening words from ${r.staff}.`, title: `A thread by ${r.staff}`, card: { key: 'card-collector', on: 'own', config: { 'card-collector': { card: 'whoops' } } }, note: `Started one, ${r.staff}.` }
    : { words: `A reply from ${r.staff}.`, note: `Replied, ${r.staff}.` };
};
const run = (d: ReturnType<typeof fakeDb>, m: { models: Models }, instance: Instance = dividedWorld, slot = SLOT) => runChatter(d.db, m.models, instance, slot);

test('a day with three picks writes three posts, one card, the notes and three spends', async () => {
  const d = fakeDb({ pool: { cardRarityMost: 'uncommon' } });
  const m = fakeModels(normal);
  const out = await run(d, m);
  assert.equal(out.status, 'ok');
  assert.ok(out.status === 'ok');
  assert.equal(out.day, DAY);
  assert.equal(out.allowance, 4);
  assert.equal(m.chats.length, 3, 'a call for each pick');
  for (const c of m.chats) { assert.equal(c.duty, 'chatter'); assert.equal(c.tier, 'light'); assert.ok(c.staff); assert.ok(c.rules); }
  assert.deepEqual(out.picks.map((p) => p.status), ['posted', 'posted', 'posted']);
  assert.equal(d.count('write_staff_thread') + d.count('write_staff_act'), 3, 'three posts');
  assert.equal(d.count('write_staff_thread'), 1, 'the top scorer starts the week\'s thread, on a board of its beats');
  assert.equal(d.count('staff_play_card') + d.count('staff_set_card'), 1, 'one card');
  assert.equal(d.count('staff_set_card'), 1, 'a Set, on the post the thread start wrote');
  const set = d.of('staff_set_card')[0]!;
  assert.equal(set.card, 'card-collector');
  assert.equal(set.target, d.state.acts.find((a) => a.kind === 'thread')!.id, 'on its own post');
  assert.equal(d.state.notes.length, 3, 'a note each');
  assert.equal(d.state.spends.length, 3);
  assert.deepEqual(d.state.spends.map((s) => s.day), [DAY, DAY, DAY]);
  assert.equal(d.state.spends.filter((s) => s.card_act !== null).length, 1);
  assert.equal(d.state.spends.filter((s) => s.started_thread).length, 1);
  assert.deepEqual([...new Set(d.state.spends.map((s) => s.trigger))], ['named']);
  assert.equal(new Set(d.state.spends.map((s) => s.staff)).size, 3, 'one post a persona');
  for (const a of d.state.acts.filter((x) => x.kind !== 'card' && x.kind !== 'set')) assert.equal(a.payload.pool, DAY, 'the post carries the day for a crash to find');
  // The reply goes in its trigger's thread, quoting the post that set it off.
  const reply = d.of('write_staff_act')[0]!;
  assert.equal(reply.kind, 'post');
  assert.ok([T1, T2, T3].includes(reply.thread as string));
  assert.ok([Q1, Q2, Q3].includes(reply.target as string));
  // The notes the persona already had are in its prompt, and the order of the writes is post, card, note, spend.
  assert.ok(m.chats.every((c) => c.system.includes('An earlier thought.')));
  assert.ok(m.chats.every((c) => /Your pronouns are \w+\/\w+ \(/.test(c.system)), 'each persona is told its own pronouns');
  assert.ok(m.chats.some((c) => c.messages[0]!.content.includes('Ann (she/her): Hello there.')), 'the thread\'s author is written with the pronouns pool_thread gave');
  const order = d.calls.map((c) => c.fn).filter((f) => ['write_staff_thread', 'write_staff_act', 'staff_set_card', 'staff_play_card', 'write_staff_note', 'record_pool_spend'].includes(f));
  assert.deepEqual(order.slice(0, 4), ['write_staff_thread', 'staff_set_card', 'write_staff_note', 'record_pool_spend']);
});

test('with no thread left in the week, the top scorer replies and its Cast lands on the post it replies to', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0 } });
  const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.`, card: { key: 'stick-around', on: 'reply' } }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(d.count('write_staff_thread'), 0);
  assert.equal(d.count('write_staff_act'), 3);
  assert.equal(d.count('staff_play_card'), 1, 'the day has one slot for a card');
  const play = d.of('staff_play_card')[0]!;
  assert.equal(play.card, 'stick-around');
  const reply = d.state.acts.find((a) => a.staff === play.staff_key && a.kind === 'post')!;
  assert.equal(play.target, reply.target, 'a Cast lands on the post the reply quotes, never on one chosen by who wrote it');
  assert.ok([Q1, Q2, Q3].includes(play.target as string));
  assert.deepEqual(out.picks.map((p) => p.status), ['posted', 'posted', 'posted']);
});

test('Whoops! is offered, played with an ink chosen by code, and the same ink on a rerun; the ink is on the spend\'s record', async () => {
  const inks = async () => {
    const d = fakeDb({ pool: { threadsWeekly: 0 } });
    const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.`, card: { key: 'whoops', on: 'reply' } }));
    const out = await run(d, m);
    assert.ok(out.status === 'ok');
    assert.ok(m.chats.some((c) => JSON.stringify(c.schema).includes('whoops')), 'Whoops! is on offer');
    const play = d.of('staff_play_card')[0]!;
    assert.equal(play.card, 'whoops');
    const config = play.config as { color: string };
    assert.deepEqual(whoopsRules.validateConfig(config), { ok: true, value: config }, 'a valid ink');
    assert.deepEqual(d.state.spends.find((s) => s.staff === play.staff_key)!.record.cardConfig, config, 'and it is on the record');
    return JSON.stringify(config);
  };
  assert.equal(await inks(), await inks(), 'the same day builds the same ink');
});

test('a card with no default and no configurations of its own is not offered', async () => {
  const bare = { ...dividedWorld, cards: dividedWorld.cards.map((c) => (c.key === 'whoops' ? { ...c, staffConfigs: undefined } : c)) } as Instance;
  const d = fakeDb({ pool: { threadsWeekly: 0 } });
  const m = fakeModels((r) => ({ words: 'x', card: { key: 'whoops', on: 'reply' } }));
  await run(d, m, bare);
  assert.equal(d.count('staff_play_card'), 0);
});

test('a persona is asked in the frame of the office it holds now: a member opens with the member premise, a Boss with the Boss premise, a Mod with the Mod premise', async () => {
  const d = fakeDb({ named: [CLERK, HYPE, SIGH], pool: { threadsWeekly: 0 } });
  const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.` }));
  await run(d, m);
  const offices = dividedWorld.system.offices;
  const asked = (staff: string) => m.chats.find((c) => c.staff === staff)!.system;
  assert.ok(asked(CLERK).startsWith(offices.member.premise), 'member');
  assert.ok(asked(HYPE).startsWith(offices.boss.premise), 'boss');
  assert.ok(asked(SIGH).startsWith(offices.mod.premise), 'mod');
  assert.ok(!asked(CLERK).includes(offices.boss.premise), 'a member is never told it is the Boss');
});

test('a disabled System writes nothing and calls no model', async () => {
  const d = fakeDb({ enabled: false });
  const m = fakeModels(normal);
  const out = await run(d, m);
  assert.deepEqual(out, { status: 'off' });
  assert.equal(m.chats.length + m.completions.length, 0);
  assert.deepEqual([...new Set(d.calls.map((c) => c.fn))], ['instance_settings']);
  assert.equal(d.state.acts.length + d.state.spends.length + d.state.notes.length, 0);
});

test('a week whose pool is spent calls no model', async () => {
  const d = fakeDb({ priorSpent: 20 });
  const m = fakeModels(normal);
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(out.allowance, 0);
  assert.equal(m.chats.length, 0);
  assert.equal(d.count('pool_signals'), 0, 'nothing is read for a day with no post to give');
  assert.equal(d.state.spends.length, 0);
});

test('a rejected answer is skipped and spends nothing; the others post', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0 } });
  const m = fakeModels((r) => (r.staff === CLERK ? { words: '   ' } : { words: `A reply from ${r.staff}.` }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  const bad = out.picks.find((p) => p.staff === CLERK)!;
  assert.equal(bad.status, 'rejected');
  assert.match(bad.why!, /nonEmpty at words/);
  assert.equal(d.state.acts.filter((a) => a.staff === CLERK).length, 0, 'it wrote nothing');
  assert.equal(d.state.spends.filter((s) => s.staff === CLERK).length, 0, 'and spent nothing');
  assert.equal(d.state.spends.length, 2);
  assert.equal(d.state.notes.filter((n) => n.staff === CLERK).length, 0);
});

test('a model that rejects (the model layer\'s own rule) or fails is skipped, not thrown', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0 } });
  const m = fakeModels((r) => (r.staff === CLERK ? new AnswerRejected('the answer failed required at words', 'required') : r.staff === MON ? new Error('overloaded') : { words: 'Fine.' }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.picks.map((p) => [p.staff, p.status]).sort(), [[CLERK, 'rejected'], [MON, 'failed'], [SIGH, 'posted']]);
  assert.equal(d.state.spends.length, 1);
});

test('a ledger row that cannot be written stops the run', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0 } });
  const m = fakeModels(() => new LedgerWriteFailed('the ledger is down'));
  await assert.rejects(run(d, m), LedgerWriteFailed);
  assert.equal(d.state.spends.length, 0);
});

test('an answer past the length is trimmed, and the trim is on the spend\'s record', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0 } });
  const long = `${'A sentence of some length. '.repeat(2_000)}`;
  const m = fakeModels((r) => ({ words: long, note: 'n'.repeat(500) }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  const post = d.of('write_staff_act')[0]!;
  assert.ok((post.payload as any).body.length <= dividedWorld.settings.postMaxLength);
  assert.ok((post.payload as any).body.endsWith('.'), 'cut at a sentence');
  const spend = d.state.spends[0]!;
  assert.deepEqual(spend.record.trims.map((t: any) => t.path).sort(), ['note', 'words']);
  assert.ok(d.state.notes.every((n) => n.body.length === 280 || n.body.length < 280));
});

test('poison: a card outside the offer is dropped and never reaches the card doors', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0 } });
  const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.`, card: { key: 'main-event', on: 'reply' } }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(d.count('staff_play_card'), 0, 'Main Event is above the rarity the pool plays and was not offered');
  assert.equal(d.count('staff_set_card'), 0);
  assert.deepEqual(out.picks.map((p) => p.status), ['posted', 'posted', 'posted'], 'the words stand');
  assert.ok(d.state.spends.every((s) => s.card_act === null && s.record.trims.some((t: any) => t.path === 'card.key' && t.predicate === 'offered')));
  // A card the pool could play is offered by name, and a rarer one is not in the offer at all.
  assert.equal(m.chats.filter((c) => c.system.includes('stick-around')).length, 1, 'the day\'s one card slot is offered cards, to the top scorer');
  assert.ok(m.chats.every((c) => !c.system.includes('main-event') && !c.system.includes('force-field')));
  // Nor does a Cast on its own post, or a Set on the reply, get through.
  const d2 = fakeDb({ pool: { threadsWeekly: 0 } });
  await run(d2, fakeModels(() => ({ words: 'x', card: { key: 'stick-around', on: 'own' } })));
  assert.equal(d2.count('staff_play_card') + d2.count('staff_set_card'), 0);
});

test('a card the card rules refuse keeps its post, with the refusal on the record', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0 }, cardRefusal: 'this post already carries that card' });
  const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.`, card: { key: 'stick-around', on: 'reply' }, note: 'Noted.' }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(d.count('staff_play_card'), 1);
  const refused = out.picks.filter((p) => p.cardRefused);
  assert.equal(refused.length, 1);
  assert.equal(refused[0]!.cardRefused, 'this post already carries that card');
  assert.equal(refused[0]!.status, 'posted');
  assert.equal(d.state.acts.filter((a) => a.kind === 'post').length, 3, 'every post stands');
  assert.equal(d.state.spends.length, 3);
  const spend = d.state.spends.find((s) => s.staff === refused[0]!.staff)!;
  assert.equal(spend.card_act, null);
  assert.equal(spend.record.cardRefused, 'this post already carries that card');
  assert.equal(d.state.notes.length, 3, 'the notes are written after the refusal');
});

test('a database error writing a post stops that pick and the run goes on; the error is on its record', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0 }, failOn: { write_staff_act: 1 } });
  const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.` }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.picks.map((p) => p.status), ['failed', 'posted', 'posted']);
  assert.match(out.picks[0]!.why!, /connection dropped/);
  assert.equal(d.state.spends.length, 2);
  assert.equal(d.state.notes.length, 0, 'a note goes with a post');
});

test('a rerun the same day posts nothing new, even at another minute', async () => {
  const d = fakeDb();
  const m = fakeModels(normal);
  await run(d, m);
  const writes = () => d.state.acts.length + d.state.spends.length + d.state.notes.length;
  const before = writes();
  const calls = m.chats.length;
  const again = await run(d, m);
  assert.ok(again.status === 'ok');
  assert.deepEqual(again.picks.map((p) => p.status), ['already', 'already', 'already']);
  assert.equal(writes(), before, 'nothing was written');
  assert.equal(m.chats.length, calls, 'and no model was paid');
  const later = await run(d, m, dividedWorld, '2026-11-04T19:02:00.000Z');
  assert.ok(later.status === 'ok');
  assert.equal(writes(), before, 'a different slot of the same day does not post twice either');
  assert.ok(d.state.spends.length <= 3, 'and never past the day\'s allowance');
});

test('a rerun after a crash between a post and its spend adopts the post and writes no second', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0 }, failOn: { record_pool_spend: 1 } });
  const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.` }));
  const first = await run(d, m);
  assert.ok(first.status === 'ok');
  assert.equal(first.picks[0]!.status, 'failed');
  assert.match(first.picks[0]!.why!, /the post was written but its spend was not recorded/);
  assert.equal(d.state.acts.filter((a) => a.kind === 'post').length, 3, 'all three posts were written');
  assert.equal(d.state.spends.length, 2, 'one has no row');
  const orphaned = first.picks[0]!.staff;
  const paid = m.chats.length;
  const second = await run(d, m);
  assert.ok(second.status === 'ok');
  assert.equal(second.adopted.find((p) => p.staff === orphaned)!.status, 'adopted');
  assert.equal(second.picks.find((p) => p.staff === orphaned)!.status, 'already', 'and it is not picked again');
  assert.equal(d.state.acts.filter((a) => a.kind === 'post').length, 3, 'no second post');
  assert.equal(d.state.spends.length, 3, 'the orphan now has its row');
  assert.equal(d.state.spends.find((s) => s.staff === orphaned)!.record.adopted, true);
  assert.equal(m.chats.length, paid, 'and no model call was made for it');
});

test('an adopted thread start uses the week\'s thread: no later pick in the rerun starts a second', async () => {
  const d = fakeDb({ failOn: { record_pool_spend: 1 }, noThread: [CLERK, MON] });
  const m = fakeModels(normal);
  const first = await run(d, m);
  assert.ok(first.status === 'ok');
  assert.equal(first.picks[0]!.status, 'failed');
  assert.equal(d.count('write_staff_thread'), 1);
  const second = await run(d, m);
  assert.ok(second.status === 'ok');
  assert.equal(second.adopted[0]!.status, 'adopted');
  assert.equal(second.adopted[0]!.startedThread, true);
  assert.equal(d.count('write_staff_thread'), 1, 'no second thread start in the rerun');
  assert.equal(d.state.spends.filter((s) => s.started_thread).length, 1);
});

test('an adopted post takes its card: the crash between the card and the spend still counts two slots', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0 }, failOn: { record_pool_spend: 1 } });
  const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.`, card: { key: 'stick-around', on: 'reply' } }));
  const first = await run(d, m);
  assert.ok(first.status === 'ok');
  assert.equal(first.picks[0]!.status, 'failed');
  const cardAct = d.state.acts.find((a) => a.kind === 'card')!;
  const second = await run(d, m);
  assert.ok(second.status === 'ok');
  const adopted = second.adopted[0]!;
  assert.equal(adopted.card, cardAct.id);
  assert.equal(d.state.spends.find((s) => s.staff === adopted.staff)!.card_act, cardAct.id, 'the spend names the card, so the week counts its slot');
  assert.equal(d.count('staff_play_card'), 1, 'and no second card is played');
});

test('a rerun cannot spend past the day\'s allowance counting the rows already there', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0 }, named: [SIGH, CLERK, MON, HYPE] });
  const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.` }));
  // Three personas spent earlier today (a card each: three posts and a card is four slots of the day's four).
  for (const [i, s] of [CLERK, SIGH, MON].entries()) d.state.spends.push({ day: DAY, staff: s, trigger: 'named', post_act: `old-${i}`, card_act: i === 0 ? 'old-card' : null, started_thread: false, record: {} });
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(m.chats.length, 0, 'the day is spent: four slots, three posts and a card');
  assert.ok(out.picks.every((p) => p.status === 'already' || p.status === 'skipped'));
});

test('a persona on the old voice writes its words in raw completion and gives no title, card or note', async () => {
  const old: Instance = { ...dividedWorld, system: { ...dividedWorld.system, roster: dividedWorld.system.roster.map((p) => (p.key === SIGH ? { ...p, voice: 'oldVoice' as const } : p)) } };
  const d = fakeDb({ pool: { threadsWeekly: 0 }, named: [SIGH] });
  const m = fakeModels(() => ({ words: 'chat' }), 'ur post is soooo cool!!!');
  const out = await run(d, m, old);
  assert.ok(out.status === 'ok');
  assert.equal(m.chats.length, 0);
  assert.equal(m.completions.length, 1);
  assert.equal(m.completions[0]!.duty, 'chatter');
  assert.equal(m.completions[0]!.staff, SIGH);
  assert.equal(d.of('write_staff_act')[0]!.payload.body, 'ur post is soooo cool!!!');
  assert.equal(d.count('write_staff_note') + d.count('staff_play_card') + d.count('staff_set_card'), 0);
});

test('an old-voice answer that hits the scrubber twice files a rejected pick and writes nothing; one hit is retried', async () => {
  const withWords = (scrubWords: string[]): Instance => ({ ...dividedWorld, system: { ...dividedWorld.system, scrubWords, roster: dividedWorld.system.roster.map((p) => (p.key === SIGH ? { ...p, voice: 'oldVoice' as const } : p)) } });
  const d = fakeDb({ pool: { threadsWeekly: 0 }, named: [SIGH] });
  const m = fakeModels(() => ({ words: 'chat' }), 'you absolute badword');
  const out = await run(d, m, withWords(['badword']));
  assert.ok(out.status === 'ok');
  assert.equal(m.completions.length, 2, 'asked again once');
  assert.equal(out.picks[0]!.status, 'rejected');
  assert.equal(d.count('write_staff_act'), 0);
  const once = fakeDb({ pool: { threadsWeekly: 0 }, named: [SIGH] });
  const answers = ['you absolute badword', 'a kinder post'];
  const m2 = fakeModels(() => ({ words: 'chat' }));
  m2.models.complete = async (r) => { m2.completions.push(r); return result(answers[m2.completions.length - 1]!); };
  const ok = await run(once, m2, withWords(['badword']));
  assert.ok(ok.status === 'ok');
  assert.equal(m2.completions.length, 2);
  assert.equal(once.of('write_staff_act')[0]!.payload.body, 'a kinder post');
});

test('a thread start whose persona has no beats board replies in its trigger\'s thread', async () => {
  const d = fakeDb({ boards: { [GENERAL]: 'elsewhere' } });
  const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.` }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(d.count('write_staff_thread'), 0);
  assert.equal(d.count('write_staff_act'), 3);
  assert.ok(m.chats.every((c) => !(c.schema as any).required.includes('title')));
});

test('through the real model layer: a transport failure is retried once on the request and then succeeds, and each call is a ledger row naming the duty and the persona', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0 }, named: [SIGH] });
  const rows: ModelCallRow[] = [];
  const reply = (text: string) => new Response(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }],
    usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, service_tier: 'standard' },
  }), { status: 200 });
  let sent = 0;
  const fetch = (async () => {
    sent++;
    if (sent === 1) throw new TypeError('fetch failed');
    return reply(JSON.stringify({ words: 'Back from a bad connection.', note: 'It took two tries.' }));
  }) as unknown as typeof globalThis.fetch;
  const models = realModels((n) => ({ ANTHROPIC_API_KEY: 'sk-test' } as Record<string, string>)[n], async (row) => { rows.push(row); }, {
    tiers: { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' }, fetch, sleep: async () => {},
  });
  const out = await runChatter(d.db, models, dividedWorld, SLOT);
  assert.ok(out.status === 'ok');
  assert.equal(sent, 2, 'one retry');
  assert.equal(rows.length, 1, 'one ledger row for the call');
  assert.equal(rows[0]!.duty, 'chatter');
  assert.equal(rows[0]!.staff, SIGH);
  assert.equal(rows[0]!.outcome, 'ok');
  assert.equal(rows[0]!.retries, 1);
  assert.ok(rows[0]!.costMicrodollars > 0, 'priced from the usage block');
  assert.equal(d.count('write_staff_act'), 1, 'and one post, not two');
  assert.equal(d.state.spends.length, 1);
});

test('the database failing before anything is written fails the run loudly, and a bad slot is refused', async () => {
  await assert.rejects(run(fakeDb({ failOn: { pool_context: 'always' } }), fakeModels(normal)), /connection dropped/);
  await assert.rejects(run(fakeDb(), fakeModels(normal), dividedWorld, 'not a time'), /slot is not a time/);
});

test('a staff Cast is told the day, so the card Act is tied to its post exactly', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0 } });
  const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.`, card: { key: 'stick-around', on: 'reply' } }));
  await run(d, m);
  const doors = d.of('staff_play_card');
  assert.ok(doors.length > 0);
  assert.ok(doors.every((a) => a.pool_day === DAY), 'every staff Cast carries the pool day');
});

test('an orphan from an earlier day of the week is adopted today, on its own day, and counts in the week and the thread share', async () => {
  const d = fakeDb();
  d.state.acts.push({ id: 'old-start', staff: SIGH, kind: 'thread', thread: 'old-thread', target: null, payload: { pool: '2026-11-03', body: 'x' } });
  d.state.acts.push({ id: 'old-card', staff: SIGH, kind: 'set', thread: null, target: 'old-start', payload: {} });
  d.state.acts.push({ id: 'last-week', staff: CLERK, kind: 'post', thread: T1, target: null, payload: { pool: '2026-11-01', body: 'x' } });
  const m = fakeModels(normal);
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.adopted.map((a) => [a.staff, a.status, a.day, a.post, a.card]), [[SIGH, 'adopted', '2026-11-03', 'old-start', 'old-card']]);
  const spend = d.state.spends.find((s) => s.post_act === 'old-start')!;
  assert.equal(spend.day, '2026-11-03', 'recorded on its own day');
  assert.equal(spend.card_act, 'old-card');
  assert.equal(spend.started_thread, true);
  assert.equal(d.state.spends.some((s) => s.post_act === 'last-week'), false, 'a post of the week before is not this week\'s');
  const calls = d.calls.map((c) => c.fn);
  assert.ok(calls.indexOf('pool_orphans') < calls.indexOf('pool_week'), 'adopted before the week is read, so the week counts it');
  assert.equal(d.count('write_staff_thread'), 0, 'its thread is the week\'s one thread');
  // The week's spend as the next read sees it counts the post and its card.
  const week = await d.db.rpc<{ spent: number; threads: number }>('pool_week', { today: DAY });
  assert.equal(week.spent, 2);
  assert.equal(week.threads, 1);
});

test('a run that loses the claim writes nothing and reads nothing past it', async () => {
  const d = fakeDb();
  d.state.held = true;
  const m = fakeModels(normal);
  const out = await run(d, m);
  assert.equal(out.status, 'busy');
  assert.deepEqual(d.calls.map((c) => c.fn).filter((f) => f !== 'instance_settings'), ['claim_pool_run']);
  assert.equal(d.calls.find((c) => c.fn === 'claim_pool_run')!.args.on_day, DAY);
  assert.equal(m.chats.length + m.completions.length, 0, 'and no model was paid');
  assert.equal(d.state.acts.length + d.state.spends.length + d.state.notes.length, 0);
});

test('the claim is taken at the start of the run, before any write, and a disabled System claims nothing', async () => {
  const d = fakeDb();
  await run(d, fakeModels(normal));
  const calls = d.calls.map((c) => c.fn);
  assert.ok(calls.indexOf('claim_pool_run') < calls.indexOf('pool_context'));
  assert.equal(d.count('claim_pool_run'), 1);
  const off = fakeDb({ enabled: false });
  await run(off, fakeModels(normal));
  assert.equal(off.count('claim_pool_run'), 0);
});

/* ------------------------------------------------------------------------------- a persona chooses its card's options ---- */

const asks = (card: Record<string, unknown>) => (r: ChatRequest) => ({ words: `A reply from ${r.staff}.`, card: { on: 'reply', ...card } });
const oneReply = { pool: { threadsWeekly: 0 } };

test('Autocorrect is offered with its options in the prompt and the schema, and Whoops! carries config.whoops', async () => {
  const d = fakeDb(oneReply);
  const m = fakeModels(asks({ key: 'autocorrect', config: { autocorrect: { phrase: 'fine topping', replacement: 'terrible crime' } } }));
  await run(d, m);
  const offered = m.chats.find((c) => (c.schema as any).properties.card)!;
  const schema = offered.schema as any;
  assert.deepEqual(Object.keys(schema.properties.card.properties.config.properties).sort(), ['autocorrect', 'stick-around', 'whoops']);
  assert.match(offered.system, /card\.config\.autocorrect/);
  assert.deepEqual((offered.rules as any).fields.card.fields.config, { type: 'any', optional: true }, 'and the model layer\'s rule passes the options through for the card\'s own validator');
});

test('a persona\'s valid Autocorrect is played with its phrase, on the whole post, and the config is on the record', async () => {
  const d = fakeDb(oneReply);
  const m = fakeModels(asks({ key: 'autocorrect', config: { autocorrect: { phrase: 'fine topping', replacement: 'terrible crime' } } }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  const play = d.of('staff_play_card')[0]!;
  assert.equal(play.card, 'autocorrect');
  assert.deepEqual(play.config, { phrase: 'fine topping', replacement: 'terrible crime' });
  assert.deepEqual(autocorrectRules.validateConfig(play.config).ok, true);
  const spend = d.state.spends.find((x) => x.staff === play.staff_key)!;
  assert.deepEqual(spend.record.cardConfig, play.config);
  assert.equal(spend.record.cardOptionsFailed, undefined);
  assert.equal(d.count('card_target_reach') >= 1, true, 'the target was read as the act function reads it');
});

test('a phrase not in the post drops the card with the trim, and the post is written', async () => {
  const d = fakeDb(oneReply);
  const m = fakeModels(asks({ key: 'autocorrect', config: { autocorrect: { phrase: 'banana split', replacement: 'terrible crime' } } }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(d.count('staff_play_card'), 0, 'Autocorrect has no fallback');
  assert.equal(d.count('write_staff_act'), 3, 'every post is written');
  const pick = out.picks.find((x) => x.cardRefused)!;
  assert.match(pick.cardOptionsFailed!, /autocorrect.*banana split|not in this post/);
  assert.equal(pick.cardRefused, 'no configuration could be built for the card');
  assert.ok(pick.trims.some((t) => t.path === 'card.config.autocorrect'), 'the trim names the card');
  assert.equal(pick.status, 'posted');
});

test('an Autocorrect without options is dropped the same way, with no failure to name', async () => {
  const d = fakeDb(oneReply);
  await run(d, fakeModels(asks({ key: 'autocorrect' })));
  assert.equal(d.count('staff_play_card'), 0);
});

test('an ink that is not a color falls back to a staffConfigs ink, with the trim', async () => {
  const d = fakeDb(oneReply);
  const m = fakeModels(asks({ key: 'whoops', config: { whoops: { color: 'not a color at all' } } }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  const play = d.of('staff_play_card')[0]!;
  const config = play.config as { color: string };
  assert.deepEqual(whoopsRules.validateConfig(config), { ok: true, value: config });
  assert.ok((whoopsRules.staffConfigs ?? []).some((c) => (c as { color: string }).color === config.color), 'one of the five');
  const pick = out.picks.find((x) => x.card)!;
  assert.match(pick.cardOptionsFailed!, /^whoops: /);
  assert.ok(pick.trims.some((t) => t.path === 'card.config.whoops'));
  assert.deepEqual(d.state.spends.find((x) => x.staff === play.staff_key)!.record.cardConfig, config);
});

test('a persona\'s valid ink is played as given', async () => {
  const d = fakeDb(oneReply);
  await run(d, fakeModels(asks({ key: 'whoops', config: { whoops: { color: '#12ab34' } } })));
  assert.deepEqual(d.of('staff_play_card')[0]!.config, { color: '#12ab34' });
});

test('an answer carrying another card\'s options keeps only the chosen card\'s', async () => {
  const d = fakeDb(oneReply);
  const m = fakeModels(asks({ key: 'whoops', config: { whoops: { color: 'teal' }, autocorrect: { phrase: 'fine topping', replacement: 'x y z' } } }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.deepEqual(d.of('staff_play_card')[0]!.config, { color: 'teal' });
  assert.ok(out.picks.some((x) => x.trims.some((t) => t.path === 'card.config.autocorrect' && t.predicate === 'notChosen')));
});

test('a wrongly typed option costs neither the post nor the card: the ink falls back with a trim', async () => {
  const d = fakeDb(oneReply);
  const out = await run(d, fakeModels(asks({ key: 'whoops', config: { whoops: { color: 5 } } })));
  assert.ok(out.status === 'ok');
  assert.equal(d.count('write_staff_act'), 3, 'every post is written');
  const play = d.of('staff_play_card')[0]!;
  const config = play.config as { color: string };
  assert.ok((whoopsRules.staffConfigs ?? []).some((c) => (c as { color: string }).color === config.color), 'the fallback ink');
  const pick = out.picks.find((x) => x.card)!;
  assert.equal(pick.status, 'posted');
  assert.ok(pick.trims.some((t) => t.path === 'card.config.whoops'));
  const auto = await run(fakeDb(oneReply), fakeModels(asks({ key: 'autocorrect', config: { autocorrect: 'teal' } })));
  assert.ok(auto.status === 'ok' && auto.picks.every((x) => x.status === 'posted'), 'a non-object option for the chosen card is trimmed and the post stands');
});

const NATO = 'alpha bravo charlie delta echoes foxtrot golfing hotel';
const cues = (...words: string[]) => ({ cues: words.map((phrase) => ({ phrase, sound: 'laugh' })) });

test('a persona\'s seven Laugh Track cues become five with one trim named, and the five-cue play is made rather than the fallback', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0, cardRarityMost: 'uncommon' }, targetBody: NATO });
  const m = fakeModels(asks({ key: 'laugh-track', config: { 'laugh-track': cues('alpha', 'bravo', 'charlie', 'delta', 'echoes', 'foxtrot', 'golfing') } }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  const play = d.of('staff_play_card')[0]!;
  assert.equal(play.card, 'laugh-track');
  assert.deepEqual((play.config as { cues: { phrase: string }[] }).cues.map((c) => c.phrase), ['alpha', 'bravo', 'charlie', 'delta', 'echoes']);
  assert.equal(laughTrackRules.validateConfig(play.config).ok, true);
  const pick = out.picks.find((x) => x.card)!;
  assert.equal(pick.cardOptionsFailed, undefined, 'the repaired options passed');
  assert.deepEqual(pick.trims.filter((t) => t.path === 'card.config.laugh-track.cues'), [{ path: 'card.config.laugh-track.cues', predicate: 'mostFiveCues', before: 7, after: 5 }]);
  const spend = d.state.spends.find((x) => x.staff === play.staff_key)!;
  assert.deepEqual(spend.record.trims.filter((t: { path: string }) => t.path === 'card.config.laugh-track.cues').length, 1, 'and it is on the call\'s record');
});

test('Laugh Track cues none of which are in the post are refused in the card\'s own words, with the original options and no invented cue', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0, cardRarityMost: 'uncommon' }, targetBody: NATO });
  const out = await run(d, fakeModels(asks({ key: 'laugh-track', config: { 'laugh-track': cues('banana split') } })));
  assert.ok(out.status === 'ok');
  const pick = out.picks.find((x) => x.cardOptionsFailed)!;
  assert.match(pick.cardOptionsFailed!, /laugh-track: .*banana split/);
  assert.equal(pick.trims.some((t) => t.path === 'card.config.laugh-track.cues'), false, 'nothing was repaired');
  assert.equal(d.count('staff_play_card'), 0);
});

test('the card\'s repair trims are on the record even when the decision then refuses', async () => {
  const trim = { path: 'card.config.laugh-track.cues', predicate: 'mostFiveCues', before: 9, after: 0 };
  const repairing = { ...laughTrackRules, repairStaff: () => ({ config: { cues: [] }, trims: [trim] }) };
  const tuned: Instance = { ...dividedWorld, cards: dividedWorld.cards.map((c) => (c.key === 'laugh-track' ? repairing : c)) };
  const d = fakeDb({ pool: { threadsWeekly: 0, cardRarityMost: 'uncommon' }, targetBody: NATO });
  const out = await run(d, fakeModels(asks({ key: 'laugh-track', config: { 'laugh-track': cues('alpha') } })), tuned);
  assert.ok(out.status === 'ok');
  const pick = out.picks.find((x) => x.cardOptionsFailed)!;
  assert.ok(pick, 'the options were refused');
  assert.deepEqual(pick.trims.filter((t) => t.predicate === 'mostFiveCues'), [trim], 'the repair\'s trim is named though the decision refused');
  const spend = d.state.spends.find((x) => x.staff === pick.staff)!;
  assert.ok(spend.record.trims.some((t: { predicate: string }) => t.predicate === 'mostFiveCues'), 'and it is on the call\'s record');
});

test('a repairStaff that throws is no repair: the options are decided as given, the fallback is built and the throw is named', async () => {
  const throwing = { ...whoopsRules, repairStaff: () => { throw new SyntaxError('Invalid regular expression'); } };
  const tuned: Instance = { ...dividedWorld, cards: dividedWorld.cards.map((c) => (c.key === 'whoops' ? throwing : c)) };
  const bad = await run(fakeDb(oneReply), fakeModels(asks({ key: 'whoops', config: { whoops: { color: 5 } } })), tuned);
  assert.ok(bad.status === 'ok');
  const pick = bad.picks.find((x) => x.card)!;
  assert.equal(pick.status, 'posted', 'the post stands');
  assert.ok(pick.trims.some((t) => t.path === 'card.config.whoops' && t.predicate === 'repairThrew'), 'the throw is named');
  assert.ok(pick.trims.some((t) => t.path === 'card.config.whoops' && t.after === 0 && t.predicate !== 'repairThrew'), 'the options failed as they would without the hook');
  const d = fakeDb(oneReply);
  const good = await run(d, fakeModels(asks({ key: 'whoops', config: { whoops: { color: '#12ab34' } } })), tuned);
  assert.ok(good.status === 'ok');
  assert.deepEqual(d.of('staff_play_card')[0]!.config, { color: '#12ab34' }, 'valid options are decided as given');
});

test('a Set with options reads its own new post as the target, after it is written, and sets with the decided config', async () => {
  // The only Divided World set card with options is Card Collector, whose option is the card it names; so the instance here carries a set card on a cast
  // with Whoops!'s options and a catch of its own: the persona's ink is checked by the card's own rules, and the named catch goes to SQL.
  const whoops = dividedWorld.cards.find((c) => c.key === 'whoops')!;
  const snare = { ...whoops, key: 'snare', name: 'Snare', play: 'set' as const, trap: { trigger: { on: 'cast' as const } }, catches: () => 'whoops' };
  const tuned: Instance = { ...dividedWorld, cards: [...dividedWorld.cards, snare] };
  const d = fakeDb(oneReply);
  const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.`, card: { key: 'snare', on: 'own', config: { snare: { color: '#12ab34' } } } }));
  const out = await run(d, m, tuned);
  assert.ok(out.status === 'ok');
  const set = d.of('staff_set_card')[0]!;
  assert.ok(set, 'the Set was made');
  assert.equal(set.card, 'snare');
  assert.deepEqual(set.config, { color: '#12ab34' });
  assert.equal(set.catches, 'whoops', 'the card\'s own named catch goes to staff_set_card');
  const post = d.state.acts.find((a) => a.id === set.target)!;
  assert.equal(post.kind, 'post', 'the target is the persona\'s own new post');
  const reads = d.calls.filter((c) => c.fn === 'card_target_reach' && c.args.target === set.target);
  assert.ok(reads.length >= 1, 'that post was read as the card\'s target');
  const wrote = d.calls.findIndex((c) => c.fn === 'write_staff_act' && c.args.staff_key === set.staff_key);
  const read = d.calls.findIndex((c) => c.fn === 'card_target_reach' && c.args.target === set.target);
  const setAt = d.calls.findIndex((c) => c.fn === 'staff_set_card');
  assert.ok(wrote >= 0 && wrote < read && read < setAt, 'written, then read, then set');
});

test('a persona\'s Card Collector is offered with its options and stores the card it names; Hall Pass is never offered', async () => {
  const hall = dividedWorld.cards.find((c) => c.key === 'hall-pass')!;
  const trap = dividedWorld.cards.find((c) => c.key === 'card-collector')!;
  assert.equal(staffOffers(hall), false, 'a Mod Bot visits only players\' posts');
  assert.equal(staffOffers(trap), true);
  // Divided World's pool plays commons; an instance that lets it play uncommons offers the Card Collector.
  const d = fakeDb({ pool: { threadsWeekly: 0, cardRarityMost: 'uncommon' } });
  const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.`, card: { key: 'card-collector', on: 'own', config: { 'card-collector': { card: 'whoops' } } } }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  const set = d.of('staff_set_card')[0]!;
  assert.ok(set, 'the Card Collector was set: ' + JSON.stringify(out.picks));
  assert.deepEqual({ card: set.card, config: set.config, catches: set.catches }, { card: 'card-collector', config: { card: 'whoops' }, catches: 'whoops' });
  const hallModels = fakeModels((r) => ({ words: `A reply from ${r.staff}.`, card: { key: 'hall-pass', on: 'own' } }));
  const d2 = fakeDb({ pool: { threadsWeekly: 0, cardRarityMost: 'uncommon' } });
  await run(d2, hallModels);
  assert.equal(d2.count('staff_set_card'), 0, 'a Hall Pass the model names is not set');
});

test('a card that writes is not offered to the pool where the instance runs no old voice, and is where it does', async () => {
  const typewriter = { key: 'typewriter', name: 'Test Typewriter', alignment: 'salty' as const, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }), staffConfigs: [{}], writes: { tokens: () => 40, frame: () => ({ prompt: '', stop: [] as string[] }) } };
  const withVoice = (oldVoice: boolean): Instance => ({ ...dividedWorld, cards: [...dividedWorld.cards, typewriter], settings: { ...dividedWorld.settings, oldVoice } });
  const offered = async (oldVoice: boolean) => {
    const d = fakeDb({ pool: { threadsWeekly: 0 } });
    const m = fakeModels(normal);
    await run(d, m, withVoice(oldVoice));
    return m.chats.some((c) => c.system.includes('Test Typewriter') || c.messages.some((x) => x.content.includes('Test Typewriter')));
  };
  assert.equal(await offered(true), true, 'the card is on offer where the endpoint runs');
  assert.equal(await offered(false), false, 'and withheld where there is none');
});

test('a completion made for a card play is a request with the duty cardText and the play it was made for', () => {
  const request: CompletionRequest = { duty: 'cardText', play: 'act-1', prompt: 'p', temperature: 1, topP: 1, stop: [], maxTokens: 40, lines: 'many' };
  assert.equal(request.duty, 'cardText');
  assert.equal(request.play, 'act-1');
});

test('a Mod Bot\'s play of a card that writes hands staff_play_card the tokens the card\'s rules decide, from the settings as the rows hold them', async () => {
  const writing = { ...dividedWorld.cards.find((c) => c.key === 'you-were-saying')!, rarity: 'common' as const };
  const withVoice: Instance = { ...dividedWorld, settings: { ...dividedWorld.settings, oldVoice: true }, cards: dividedWorld.cards.map((c) => (c.key === writing.key ? writing : c)) };
  const d = fakeDb({ pool: { threadsWeekly: 0 } });
  const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.`, card: { key: writing.key, on: 'reply' } }));
  const out = await run(d, m, withVoice);
  assert.ok(out.status === 'ok');
  const play = d.of('staff_play_card')[0];
  assert.ok(play, 'the writing card was played');
  assert.equal(play.tokens, writing.writes!.tokens(play.config as never, withVoice.settings));
  assert.ok(Number.isSafeInteger(play.tokens) && (play.tokens as number) >= 1);
  const plain = fakeDb({ pool: { threadsWeekly: 0 } });
  await run(plain, fakeModels((r) => ({ words: `A reply from ${r.staff}.`, card: { key: 'stick-around', on: 'reply' } })));
  assert.equal('tokens' in plain.of('staff_play_card')[0]!, false, 'a play of any other card carries none');
});

// Graffiti, a surface card: a Mod Bot names a stencil, a can and a spot (staffOptions); the card expands them into strokes (surface.validateDraw) and the play goes through staff_play_surface_card.
const rare = { pool: { threadsWeekly: 0, cardRarityMost: 'rare' } };
const graffitiAsks = (config?: unknown, extra: Record<string, unknown> = {}) => (r: ChatRequest) => ({ words: `A reply from ${r.staff}.`, card: { key: 'graffiti', on: 'reply', ...(config === undefined ? {} : { config: { graffiti: config } }), ...extra } });
const horns = { stencil: 'horns', can: 'red', spot: 4 };

test('a persona\'s Graffiti is offered with its options and played through staff_play_surface_card, with the stencil\'s strokes as its first draw and a configuration of {}', async () => {
  const d = fakeDb(rare);
  const m = fakeModels(graffitiAsks(horns));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.match(m.chats.find((c) => (c.schema as any).properties.card)!.system, /card\.config\.graffiti/);
  assert.equal(d.count('staff_play_card'), 0, 'the plain door is not used');
  const play = d.of('staff_play_surface_card')[0]!;
  assert.equal(play.card, 'graffiti');
  assert.deepEqual(play.config, {});
  assert.equal(play.message, '');
  assert.equal(play.first.stencil, 'horns');
  assert.ok(play.first.strokes.length > 0 && play.first.strokes.every((s: any) => s.can === 'red'), 'the stencil\'s strokes, in the persona\'s can');
  assert.equal(play.first_cells.length, 10000);
  assert.ok(play.first_cells.includes('1'), 'the strokes cover cells');
  assert.equal(typeof play.most, 'number');
  assert.equal(typeof play.most_live, 'number');
  assert.deepEqual(d.state.spends.find((x) => x.staff === play.staff_key)!.record.cardConfig, horns, 'the pick is on the record');
});

test('a persona with no valid pick still draws a stencil, one of the card\'s staffConfigs chosen by the seed, and the same on a rerun', async () => {
  const graffiti = dividedWorld.cards.find((c) => c.key === 'graffiti')!;
  const firsts = async (config?: unknown) => {
    const d = fakeDb(rare);
    const out = await run(d, fakeModels(graffitiAsks(config)));
    assert.ok(out.status === 'ok');
    const play = d.of('staff_play_surface_card')[0]!;
    assert.ok(play, 'a Graffiti was played');
    assert.equal(typeof play.first.stencil, 'string', 'a stencil, never an empty wall');
    assert.ok(play.first.strokes.length > 0);
    assert.ok((graffiti.staffConfigs ?? []).some((c) => (c as { stencil: string }).stencil === play.first.stencil));
    return { stencil: play.first.stencil as string, trims: out.picks.flatMap((p) => p.trims.map((t) => t.path)).filter((t) => t.startsWith('card.config')) };
  };
  const none = await firsts();
  const junk = await firsts({ stencil: 'not a stencil', can: 'red', spot: 4 });
  const typed = await firsts({ stencil: 5, can: [], spot: 'middle' });
  assert.deepEqual(none.trims, [], 'no pick, nothing to trim');
  assert.ok(junk.trims.includes('card.config.graffiti') && typed.trims.includes('card.config.graffiti'), 'a pick that fails is a trim');
  assert.deepEqual(await firsts(), none, 'the same day draws the same stencil');
});

test('a wall pick that is offered draws on that wall through staff_draw_on_surface with the persona\'s stencil, and plays no card', async () => {
  const W = '66666666-6666-4666-8666-666666666666';
  const d = fakeDb({ ...rare, walls: [{ play: W, card: 'graffiti', about: 'Ann\'s post' }] });
  const m = fakeModels(graffitiAsks(horns, { wall: W }));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  const offered = m.chats.find((c) => (c.schema as any).properties.card)!;
  assert.deepEqual((offered.schema as any).properties.card.properties.wall.enum, [W]);
  assert.equal(d.count('staff_play_surface_card'), 0);
  const drew = d.of('staff_draw_on_surface')[0]!;
  assert.equal(drew.play, W);
  assert.equal(drew.payload.stencil, 'horns');
  assert.equal(typeof drew.payload.pool, 'string', 'the draw carries its pool day, so a crash before the spend is adopted');
  assert.equal(drew.cells.length, 10000);
  assert.equal(typeof drew.most, 'number');
  assert.ok(d.state.spends.some((x) => x.card_act !== null && x.staff === drew.staff_key), 'the draw spends the card slot');
});

test('a wall pick that is not offered is dropped, and the persona plays its Graffiti anew', async () => {
  const W = '66666666-6666-4666-8666-666666666666';
  const d = fakeDb({ ...rare, walls: [{ play: W, card: 'graffiti', about: 'Ann\'s post' }] });
  const out = await run(d, fakeModels(graffitiAsks(horns, { wall: '77777777-7777-4777-8777-777777777777' })));
  assert.ok(out.status === 'ok');
  assert.equal(d.count('staff_draw_on_surface'), 0, 'no draw on a wall nobody offered');
  assert.equal(d.count('staff_play_surface_card'), 1);
  assert.ok(out.picks.some((p) => p.trims.some((t) => t.path === 'card.wall' && t.predicate === 'offered')));
  // No wall on offer at all: the same pick is dropped the same way.
  const bare = fakeDb(rare);
  await run(bare, fakeModels(graffitiAsks(horns, { wall: W })));
  assert.equal(bare.count('staff_draw_on_surface'), 0);
});

test('at most three walls are offered, and only those of the card offered', async () => {
  const ids = [1, 2, 3, 4].map((n) => `66666666-6666-4666-8666-66666666666${n}`);
  const d = fakeDb({ ...rare, walls: [...ids.map((play) => ({ play, card: 'graffiti', about: 'a post' })), { play: '88888888-8888-4888-8888-888888888888', card: 'whoops', about: 'not a wall of this card' }] });
  const m = fakeModels(graffitiAsks(horns));
  await run(d, m);
  const offered = m.chats.find((c) => (c.schema as any).properties.card)!;
  assert.deepEqual((offered.schema as any).properties.card.properties.wall.enum, ids.slice(0, 3));
});
