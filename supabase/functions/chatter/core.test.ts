import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cronMinutes, decideOptions, runChatter } from './core.ts';
import { CHATTER_TOKENS } from '../../../engine/system/chatter.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import { instance as realInstance } from '../_shared/instance.ts';
import { placeholderWorld } from '../../../instances/divided-world/system/fixtures/index.ts';
import { AnswerRejected, LedgerWriteFailed, PromptTooLong, SchemaRefused, models as realModels } from '../_shared/models/index.ts';
import { ProviderRefusal } from '../_shared/models/transport.ts';
import { tokenCounter } from '../../../engine/system/tokens.ts';
import type { ModelCallRow } from '../_shared/models/ledger.ts';
import type { ChatRequest, CompletionRequest, ModelResult, Models } from '../../../engine/system/model.ts';
import type { Instance } from '../../../engine/rules/types.ts';
import { autocorrect as autocorrectRules } from '../../../instances/divided-world/cards/autocorrect.ts';
import { staffOffers } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
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
  /** The faces `character_faces` answers, by character id; none by default. */
  faces?: Record<string, { name: string; pronouns: null }>;
  /** The body card_target_reach reports for a post the run did not write. */
  targetBody?: string;
  /** The open walls pool_thread reports on every thread (`{ play, card, about }`). */
  walls?: { play: string; card: string; about: string }[];
  /** When set, pool_thread reports this many long posts (Poster0 oldest) instead of the one short one. */
  longThread?: number;
  /** `pool_context`'s lockouts (staff character id, thread id); omitted from the context when unset. */
  lockouts?: { staff: string; thread: string }[];
  /** The day's sessions, already drawn (minutes from 00:00 UTC): the day's first round has passed. Without any, the pool draws none (perDay 0) and every round is a first round. */
  sessions?: { staff: string; start: number; end: number }[];
  /** Picks already kept for the day. */
  kept?: { staff: string; pick: Record<string, unknown>; day?: string }[];
  /** `kept_picks` lists the picks already written too (the case the database never produces: it lists only the unwritten). */
  keptListsWritten?: boolean;
  /** The replies waiting on each persona, by thread: `staff: true` for a reply by a staff character (the database never reports one). */
  waiting?: { staff: string; thread: string; heat?: number; replies: { act: string; author: string; at: string; staff?: true; old?: true }[] }[];
  /** Turns already spent: (staff, session index in `sessions`, thread). */
  spentTurns?: { staff: string; session: number; thread: string }[];
  /** The turns written today before this run, instance-wide. */
  turnsToday?: number;
  points?: Record<string, string>;
  record?: Record<string, unknown>;
  /** `claim_pool_round` refuses a slot a run already claimed, as the lease does. */
  leases?: boolean;
  /** `write_staff_turn` refuses with this reason (the kayfabb.refusal hint). */
  turnRefusal?: string;
  /** `write_staff_turn` commits, then its answer is lost (a transport error), once. */
  lostTurnAnswer?: boolean;
  /** `write_sessions` refuses (kayfabb.refusal) any list that holds this persona, as the database does for one benched since the context was read. */
  refuseSessionsFor?: string;
  /** The nth call of `write_sessions` (1-based) fails with a database error, once. */
  crashSessionCall?: number;
  /** From this `until` on, `pool_signals` names these personas instead (the signal window has shifted). */
  namedFrom?: { until: string; named: string[] };
  /** What post_effects_up reports for the quoted post: the effects it draws in force. Unset reads 0. */
  effectsUp?: number;
}
type Spend = { day: string; staff: string; trigger: string; post_act: string; card_act: string | null; started_thread: boolean; record: any };

function fakeDb(w: World = {}) {
  const calls: { fn: string; args: Record<string, any> }[] = [];
  const sessionRows = (w.sessions ?? []).map((x, i) => ({ id: i + 1, staff: x.staff, day: '2026-11-04', startsAt: Date.parse('2026-11-04T00:00:00Z') + x.start * 60_000, endsAt: Date.parse('2026-11-04T00:00:00Z') + x.end * 60_000 }));
  const state = { sessions: sessionRows as { id: number; staff: string; day: string; startsAt: number; endsAt: number }[], kept: (w.kept ?? []).map((k) => ({ day: DAY, ...k })) as { staff: string; pick: any; day: string }[],
    turns: (w.spentTurns ?? []).map((t) => ({ staff: t.staff, session: sessionRows[t.session]!.id, thread: t.thread, post: 'earlier', answers: [] as string[], quoting: '', body: '' })),
    // A day with sessions or picks given is a day whose first round has passed.
    days: new Set<string>(sessionRows.length || w.kept?.length ? ['2026-11-04'] : []),
    attempts: [] as { staff: string; session: number; thread: string; answers: string[]; outcome: string; paid: boolean }[],
    sessionCalls: 0, answered: new Set<string>(), claimed: new Set<string>(), lost: Boolean(w.lostTurnAnswer), held: false, acts: [] as { id: string; staff: string; kind: string; thread: string | null; target: string | null; payload: any }[], spends: [] as Spend[], notes: [] as { staff: string; post: string; body: string }[], n: 0 };
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
        // No sessions are drawn unless a test asks (perDay 0): every persona then has none left, so a kept pick posts in its own round, as the pool's picks did.
        case 'instance_settings': return { economy: dividedWorld.settings.economy, systemEnabled: w.enabled ?? true, pool: { ...dividedWorld.settings.pool, sessions: { ...dividedWorld.settings.pool.sessions, perDay: 0 }, ...(w.pool ?? {}) } } as T;
        case 'claim_pool_round': {
          const at = new Date(String(args.slot)).toISOString();
          if (w.leases && state.claimed.has(at)) return null as T;
          state.claimed.add(at);
          return 'round-0001' as T;
        }
        case 'sessions_day': return state.sessions.filter((x) => x.day === args.on_day).map((x) => ({ staff: x.staff, session: x.id, startsAt: new Date(x.startsAt).toISOString(), endsAt: new Date(x.endsAt).toISOString() })) as T;
        case 'pool_day_started': return state.days.has(String(args.on_day)) as T;
        case 'write_sessions': {
          state.sessionCalls += 1;
          if (w.crashSessionCall === state.sessionCalls) throw new DatabaseError('write_sessions: the connection dropped', '08006', 500);
          const given = args.rows as { staff: string; start: number; end: number }[];
          if (w.refuseSessionsFor && given.some((r) => r.staff === w.refuseSessionsFor)) throw new DatabaseError('write_sessions: benched', '55000', 400, 'that persona is benched', 'kayfabb.refusal');
          if (args.mark !== false) state.days.add(String(args.on_day));
          for (const r of args.rows as { staff: string; start: number; end: number }[]) {
            const startsAt = Date.parse(`${args.on_day}T00:00:00Z`) + r.start * 60_000;
            if (!state.sessions.some((x) => x.day === args.on_day && x.staff === r.staff && x.startsAt === startsAt)) {
              state.sessions.push({ id: state.sessions.length + 1, staff: r.staff, day: String(args.on_day), startsAt, endsAt: Date.parse(`${args.on_day}T00:00:00Z`) + r.end * 60_000 });
            }
          }
          return state.sessions.filter((x) => x.day === args.on_day).length as T;
        }
        case 'keep_pick': {
          if (!state.kept.some((k) => k.day === args.on_day && k.staff === args.of_staff)) state.kept.push({ day: String(args.on_day), staff: String(args.of_staff), pick: args.pick });
          return null as T;
        }
        case 'kept_picks': return state.kept.filter((k) => k.day === args.on_day && (w.keptListsWritten || !state.spends.some((s) => s.day === args.on_day && s.staff === k.staff))).map((k) => ({ staff: k.staff, pick: k.pick })) as T;
        case 'sessions_awake': {
          const at = Date.parse(String(args.at));
          return state.sessions.filter((x) => x.startsAt <= at && at < x.endsAt).map((x) => {
            const mine = state.turns.filter((t) => t.session === x.id);
            const byThread: Record<string, number> = {};
            for (const t of mine) byThread[t.thread] = (byThread[t.thread] ?? 0) + 1;
            return { staff: x.staff, session: x.id, spent: mine.length, spentByThread: byThread };
          }) as T;
        }
        case 'pool_waiting': {
          const since = Date.parse(String(args.since));
          const keys = args.staff_keys as string[];
          // A reply a refused attempt covers, or two rejected ones, is given up on (record_turn_attempt); failed attempts leave it waiting.
          const givenUp = (act: string) => {
            const covering = state.attempts.filter((a) => a.answers.includes(act));
            return covering.some((a) => a.outcome === 'refused') || covering.filter((a) => a.outcome === 'rejected').length >= 2;
          };
          return (w.waiting ?? []).filter((x) => keys.includes(x.staff)).map((x) => ({ ...x, replies: x.replies.filter((r) => !r.staff && !state.answered.has(r.act) && !givenUp(r.act) && Date.parse(r.at) >= since).map(({ act, author, at }) => ({ act, author, at })) }))
            .filter((x) => x.replies.length > 0).map((x) => ({ staff: x.staff, thread: x.thread, heat: x.heat ?? 0, replies: x.replies })) as T;
        }
        case 'pool_turns_today': return ((w.turnsToday ?? 0) + state.turns.filter((t) => t.post !== 'earlier').length + state.attempts.filter((a) => a.paid).length) as T;
        case 'record_turn_attempt': {
          state.attempts.push({ staff: String(args.staff_key), session: Number(args.in_session), thread: String(args.in_thread), answers: [...new Set(args.answers as string[])], outcome: String(args.outcome), paid: Boolean(args.paid) });
          return state.attempts.length as T;
        }
        case 'pool_conversation': {
          const mine = (w.waiting ?? []).find((x) => x.staff === args.staff_key && x.thread === args.in_thread);
          return { posts: [{ act: `own-${args.in_thread}`, at: '2026-11-04T10:00:00.000Z', body: 'My earlier words.', cut: false,
            replies: (mine?.replies ?? []).filter((r) => !r.staff && !r.old).map((r) => ({ act: r.act, author: r.author, name: `Player ${r.author}`, pronouns: null, at: r.at, body: `Reply ${r.act} says hello.`, cut: false })) }] } as T;
        }
        case 'pool_record': return (w.record ?? { moves: [], rules: [], order: null }) as T;
        case 'staff_points_latest': return (w.points?.[String(args.staff_key)] ?? null) as T;
        case 'write_staff_turn': {
          if (w.turnRefusal) throw new DatabaseError(`write_staff_turn: ${w.turnRefusal}`, '55000', 400, w.turnRefusal, 'kayfabb.refusal');
          const answers = args.answers as string[];
          if (answers.some((a) => state.answered.has(a))) throw new DatabaseError('write_staff_turn: a reply is answered once', '55000', 400, 'a reply is answered once', 'kayfabb.refusal');
          const post = nextId('turn-post');
          state.acts.push({ id: post, staff: String(args.staff_key), kind: 'post', thread: args.in_thread as string, target: args.quoting as string, payload: { body: args.body } });
          state.turns.push({ staff: String(args.staff_key), session: Number(args.in_session), thread: String(args.in_thread), post, answers, quoting: String(args.quoting), body: String(args.body) });
          for (const a of answers) state.answered.add(a);
          if (state.lost) { state.lost = false; throw new TransportError('the answer was lost'); }
          return { turn: state.turns.length, post: { id: post } } as T;
        }
        case 'claim_pool_run': return (state.held ? null : 'run-0001') as T;
        case 'pool_context':
          return { season: { startsAt: Date.parse('2026-10-01T00:00:00Z'), endsAt: Date.parse('2026-12-30T00:00:00Z') }, boss: HYPE, predecessor: null,
            offices: { [CLERK]: 'member', [HYPE]: 'boss', [SIGH]: 'mod', [MON]: 'mod' }, characters: { [SIGH]: 'char-sigh' }, boards: w.boards ?? { [GENERAL]: 'general' }, ...(w.lockouts ? { lockouts: w.lockouts } : {}) } as T;
        case 'pool_week': {
          const today = state.spends.filter((s) => s.day === args.today);
          const monday = new Date(Date.parse(String(args.today)) - ((new Date(String(args.today)).getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
          const before = state.spends.filter((s) => s.day >= monday && s.day < String(args.today));
          return { spent: (w.priorSpent ?? 0) + before.reduce((n, s) => n + 1 + (s.card_act === null ? 0 : 1), 0), threads: before.filter((s) => s.started_thread).length, today: today.map((s) => ({ staff: s.staff, post_act: s.post_act, card_act: s.card_act, started_thread: s.started_thread })) } as T;
        }
        case 'pool_signals': {
          const named = w.namedFrom && Date.parse(String(args.until)) >= Date.parse(w.namedFrom.until) ? w.namedFrom.named : (w.named ?? [SIGH, CLERK, MON]);
          return { named: named.map((s, i) => ({ staff: s, act: quotes[i], thread: (w.noThread ?? []).includes(s) ? null : threads[i], n: 1 })), quoted: [], legacy: [], reversals: [], handovers: [], hot: [], tallies: [] } as T;
        }
        case 'post_effects_up': return (w.effectsUp ?? 0) as T;
        case 'staff_memory_latest': return null as T;
        case 'staff_memory_at': return null as T;
        case 'staff_career': return { led: [], offices: [] } as T;
        case 'staff_notes_recent': return ['An earlier thought.'] as T;
        case 'character_faces': return Object.fromEntries(((args.ids as string[] | undefined) ?? []).filter((id) => w.faces?.[id]).map((id) => [id, w.faces![id]])) as T;
        case 'pool_thread': {
          // A read for one post alone (`most` 0 and `also`): a waiting reply, whichever of the persona's posts it answers.
          if (args.most === 0 && (args.also || args.more)) {
            const wanted = [args.also, ...((args.more as string[] | undefined) ?? [])];
            const found = (w.waiting ?? []).flatMap((x) => x.replies).filter((r) => wanted.includes(r.act));
            return { title: 'Thread', posts: found.map((f) => ({ act: f.act, name: `Player ${f.author}`, pronouns: null, body: `Reply ${f.act} says hello.`, cut: false })) } as T;
          }
          const at = threads.indexOf(args.in_thread as string);
          if (w.longThread) return { title: `Thread ${at}`, posts: Array.from({ length: w.longThread }, (_, i) => ({ act: quotes[at] ?? 'none', name: `Poster${i}`, pronouns: null, body: `post ${i} ${'the quick brown fox jumps over a lazy dog '.repeat(8)}` })) } as T;
          return { title: `Thread ${at}`, posts: [{ act: quotes[at] ?? 'none', name: 'Ann', pronouns: { subject: 'she', object: 'her', determiner: 'her', possessive: 'hers', reflexive: 'herself', plural: false }, body: 'Hello there.' }], ...(w.walls ? { walls: w.walls } : {}) } as T;
        }
        case 'pool_orphans': {
          // Every marked post of the week up to `through` that no spend names (the earliest for a persona and a day), with the card marked
          // the same day, of the same persona, on the post itself or on the post's quoted target.
          const through = String(args.through);
          // From the earlier of the week's Monday and the day before `through`: a Monday's run still finds Sunday's orphan.
          const monday = new Date(Date.parse(through) - ((new Date(through).getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
          const yesterday = new Date(Date.parse(through) - 86_400_000).toISOString().slice(0, 10);
          const from = monday < yesterday ? monday : yesterday;
          const out: unknown[] = [];
          for (const mark of state.acts) {
            const day = mark.payload?.pool as string | undefined;
            if (mark.kind === 'card' || mark.kind === 'set' || !day || day < from || day > through || state.spends.some((s) => s.post_act === mark.id)) continue;
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

test('a card out of print is not offered, so a Mod Bot never gives out a copy of one', async () => {
  // Out of print, and so in no pack and no slot (instanceProblems refuses an instance that keeps a source of it).
  const retired = {
    ...dividedWorld,
    cards: dividedWorld.cards.map((c) => (c.key === 'whoops' ? { ...c, retired: true as const } : c)),
    packs: dividedWorld.packs.map((p) => ('contents' in p && p.contents ? { ...p, contents: p.contents.filter((k) => k !== 'whoops') } : p)),
    machine: dividedWorld.machine.filter((s) => !('card' in s.item) || s.item.card !== 'whoops'),
  } as Instance;
  assert.deepEqual(instanceProblems(retired), [], 'the fixture is an instance the seed would take');
  const d = fakeDb({ pool: { threadsWeekly: 0 } });
  const m = fakeModels((r) => ({ words: 'x', card: { key: 'whoops', on: 'reply' } }));
  await run(d, m, retired);
  assert.ok(!m.chats.some((c) => JSON.stringify(c.schema).includes('whoops')), 'Whoops! is not on offer');
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

test('a persona locked out of its only candidate thread is skipped cleanly: no model call, no spend, no crash', async () => {
  const d = fakeDb({ named: [SIGH], lockouts: [{ staff: 'char-sigh', thread: T1 }] });
  const m = fakeModels(normal);
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(out.picks.length, 0);
  assert.equal(m.chats.length, 0);
  assert.equal(d.state.spends.length, 0);
  assert.equal(d.count('write_staff_act'), 0);
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
  assert.deepEqual(again.picks, [], 'the day\'s first round is done: the daily path is not run again');
  assert.equal(d.count('pool_signals'), 1, 'and the signals are read once');
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
  assert.deepEqual(second.picks, [], 'the day is done (two spends are there), so the daily path does not pick it again');
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

const oldSigh = (settings: Partial<Instance['settings']> = {}): Instance => ({
  ...dividedWorld, settings: { ...dividedWorld.settings, ...settings },
  system: { ...dividedWorld.system, roster: dividedWorld.system.roster.map((p) => (p.key === SIGH ? { ...p, voice: 'oldVoice' as const } : p)) },
});

test('an old voice\'s pool post asks for the most the window leaves, and its frame fits what the window leaves for the prompt', async () => {
  const room = async (settings: Partial<Instance['settings']>) => {
    const d = fakeDb({ pool: { threadsWeekly: 0 }, named: [SIGH] });
    const m = fakeModels(() => ({ words: 'chat' }), 'a post');
    const world = oldSigh(settings);
    await run(d, m, world);
    return { req: m.completions[0]!, count: tokenCounter(world.settings.oldVoiceTokenizer), window: world.settings.oldVoiceWindow };
  };
  const roomy = await room({});
  assert.equal(roomy.req.maxTokens, 400, 'Divided World\'s window leaves 768, so the 400 stands');
  const tight = await room({ oldVoiceWindow: 400, oldVoicePromptFloor: 256 });
  assert.equal(tight.req.maxTokens, 144, 'a window of 400 with a floor of 256 leaves 144');
  assert.ok(tight.count(tight.req.prompt) <= tight.window - 144, 'the prompt fits the budget');
  const bare = await room({ oldVoiceWindow: 64, oldVoicePromptFloor: 8 });
  assert.equal(bare.req.maxTokens, 56);
  assert.ok(bare.req.prompt.endsWith(`${dividedWorld.system.roster.find((p) => p.key === SIGH)!.name}:`), 'the persona\'s own line is never removed');
});

test('an old voice\'s pool post drops the thread\'s oldest posts when the thread overflows the window less its answer', async () => {
  const world = oldSigh({ oldVoiceWindow: 400, oldVoicePromptFloor: 256, digestExcerptChars: 300, pool: { ...dividedWorld.settings.pool, chatterThreadPosts: 8 } });
  const d = fakeDb({ pool: { threadsWeekly: 0 }, named: [SIGH], longThread: 8 });
  const m = fakeModels(() => ({ words: 'chat' }), 'a post');
  await run(d, m, world);
  const req = m.completions[0]!;
  const count = tokenCounter(world.settings.oldVoiceTokenizer);
  const budget = world.settings.oldVoiceWindow - req.maxTokens!;
  assert.equal(req.maxTokens, 144);
  assert.ok(count(req.prompt) <= budget, `${count(req.prompt)} tokens against a budget of ${budget}`);
  assert.ok(!req.prompt.includes('Poster0:') && req.prompt.includes('Poster7:'), 'the oldest posts went and the newest stayed');
  assert.ok(req.prompt.endsWith(`${dividedWorld.system.roster.find((p) => p.key === SIGH)!.name}:`));
});

test('an old voice\'s pool post that the window refuses (promptTooLong, or a server\'s own 4xx) is a rejected pick that writes nothing', async () => {
  for (const refusal of [new PromptTooLong(900, 600), new AnswerRejected('the server refused', 'refused:400')]) {
    const d = fakeDb({ pool: { threadsWeekly: 0 }, named: [SIGH] });
    const m = fakeModels(() => ({ words: 'chat' }), refusal);
    const out = await run(d, m, oldSigh());
    assert.ok(out.status === 'ok');
    assert.equal(m.completions.length, 1, 'asked once and not again');
    assert.equal(out.picks[0]!.status, 'rejected');
    assert.equal(d.count('write_staff_act'), 0);
  }
});

test('an old voice\'s pool post whose server answers 401 (a bad key stays a ProviderRefusal, #583) is a failed pick that writes nothing', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0 }, named: [SIGH] });
  const m = fakeModels(() => ({ words: 'chat' }), new ProviderRefusal('HTTP 401 bad key', 401));
  const out = await run(d, m, oldSigh());
  assert.ok(out.status === 'ok');
  assert.equal(m.completions.length, 1, 'asked once and not again');
  assert.equal(out.picks[0]!.status, 'failed');
  assert.equal(d.count('write_staff_act'), 0);
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
    tiers: { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' }, oldVoice: { window: 1024, count: (t: string) => t.length }, fetch, sleep: async () => {},
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
  assert.deepEqual(d.calls.map((c) => c.fn).filter((f) => f !== 'instance_settings'), ['claim_pool_round', 'pool_day_started', 'sessions_day', 'claim_pool_run']);
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
  assert.deepEqual(Object.keys(schema.properties.card.properties.config.properties).sort(), ['autocorrect', 'stick-around', 'this', 'whoops']);
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

test('a persona\'s Laugh Track set on its own post keeps its cues though they are not in that post', async () => {
  // The real Laugh Track is a cast card, which a persona lands on a reply only; so this offers its rules (its validation and its repair) as a set (play `set`, a trap that springs on a cast and names a catch, and no set phrase, which only a cast card has).
  const { setPhrase: _waits, ...rules } = laughTrackRules;
  const settable = { ...rules, play: 'set' as const, drawsEffect: undefined, trap: { trigger: { on: 'cast' as const } }, catches: () => 'whoops' };
  const tuned: Instance = { ...dividedWorld, cards: dividedWorld.cards.map((c) => (c.key === 'laugh-track' ? settable : c)) };
  const d = fakeDb({ pool: { threadsWeekly: 0, cardRarityMost: 'uncommon' } });
  const m = fakeModels((r) => ({ words: 'Pizza time, everyone.', card: { key: 'laugh-track', on: 'own', config: { 'laugh-track': { cues: [{ phrase: 'Luigi', sound: 'boo' }, { phrase: 'pizza', sound: 'cheer' }] } } }, note: `Replied, ${r.staff}.` }));
  const out = await run(d, m, tuned);
  assert.ok(out.status === 'ok');
  const set = d.of('staff_set_card')[0]!;
  assert.ok(set, 'the Laugh Track was set: ' + JSON.stringify(out.picks));
  assert.equal(set.card, 'laugh-track');
  assert.deepEqual((set.config as { cues: { phrase: string }[] }).cues.map((c) => c.phrase), ['Luigi', 'pizza'], 'both cues, in order');
  const pick = out.picks.find((x) => x.card)!;
  assert.deepEqual(pick.trims.filter((t) => t.path === 'card.config.laugh-track.cues'), [], 'no trim');
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
  const snare = { ...whoops, key: 'snare', name: 'Snare', play: 'set' as const, drawsEffect: undefined, trap: { trigger: { on: 'cast' as const } }, catches: () => 'whoops' };
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

test('a post at its effects limit is offered no drawing cast, and a mark-only cast; a post with room is offered both', async () => {
  const marker = { key: 'marker', name: 'Test Marker', alignment: 'salty' as const, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }), staffConfigs: [{}] };
  const world: Instance = { ...dividedWorld, cards: [...dividedWorld.cards, marker] };
  assert.notEqual(world.cards.find((c) => c.key === 'whoops')!.drawsEffect, undefined, 'Whoops! draws an effect');
  const offeredWith = async (effectsUp: number) => {
    const d = fakeDb({ pool: { threadsWeekly: 0 }, effectsUp });
    const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.` }));
    await run(d, m, world);
    const asked = m.chats.map((c) => JSON.stringify(c.schema) + c.system + c.messages.map((x) => x.content).join(' '));
    return { whoops: asked.some((a) => a.includes('whoops')), marker: asked.some((a) => a.includes('Test Marker')), reads: d.count('post_effects_up'), args: d.of('post_effects_up') };
  };
  const full = await offeredWith(world.settings.postEffects);
  assert.deepEqual([full.whoops, full.marker], [false, true], 'full: no drawing card, the mark-only card');
  assert.ok(full.reads >= 1 && full.args.every((a) => typeof a.post === 'string'), 'the quoted post was read');
  const room = await offeredWith(world.settings.postEffects - 1);
  assert.deepEqual([room.whoops, room.marker], [true, true], 'with room: both');
});

test('a card that writes is not offered to the pool where the instance runs no old voice, and is where it does', async () => {
  const typewriter = { key: 'typewriter', name: 'Test Typewriter', alignment: 'salty' as const, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }), staffConfigs: [{}], writes: { sampling: { temperature: 0.9, topP: 0.95 }, tokens: () => 40, frame: () => ({ prompt: '', stop: [] as string[] }) } };
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

test('the structured chatter call is capped at CHATTER_TOKENS', async () => {
  const d = fakeDb({ pool: { cardRarityMost: 'uncommon' } });
  const m = fakeModels(normal);
  await run(d, m);
  assert.ok(m.chats.length > 0);
  for (const c of m.chats) assert.equal(c.maxTokens, CHATTER_TOKENS);
});

test('the options a persona\'s card is decided on read a forged quote as the post\'s own words, as card_target_reach reports it', async () => {
  const quoted = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const body = `[quote=${quoted}]cats[/quote] dogs`;
  const decide = async (forged?: string[]) => {
    const db: Db = { rpc: async <T>() => ({ act: 'p', kind: 'post', length: body.length, body, version: 'v1', effects: [], above: {}, ...(forged ? { forged } : {}) }) as T };
    const rules = realInstance.cards.find((c) => c.key === 'autocorrect')!;
    return decideOptions(db, realInstance, rules, 'p', 'reply', { phrase: 'cats', replacement: 'dogs' });
  };
  assert.equal((await decide()).ok, false, 'an honest quote is another post\'s words');
  assert.equal((await decide([quoted])).ok, true, 'a forged one is the poster\'s own');
});

/* ------------------------------------------------------------------------------------ the round (chattier staff, Task 7) ---- */

const min = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const at = (hhmm: string) => `2026-11-04T${hhmm}:00.000Z`;
const R1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const R2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const R3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const R4 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
const reply = (act: string, when = '16:00', author = `char-${act.slice(-1)}`) => ({ act, author, at: at(when) });
const turnModels = () => fakeModels((r) => ({ words: `A turn from ${r.staff}.`, note: `Answered, ${r.staff}.` }));
const keptPick = (staff: string, thread = T1, quoting = Q1, extra: Record<string, unknown> = {}) => ({ staff, pick: { staff, office: staff === SIGH ? 'mod' : 'member', trigger: 'named', thread, quoting, act: quoting, subject: null, startThread: false, cardSlot: false, ...extra } });
const SIGH_NOW = { staff: SIGH, start: min('17:30'), end: min('18:15') };
const SIGH_LATER = { staff: SIGH, start: min('19:00'), end: min('20:00') };
const SIGH_EARLIER = { staff: SIGH, start: min('10:00'), end: min('10:30') };

test('cronMinutes reads a step in the minute field and takes 15 for anything else', () => {
  assert.equal(cronMinutes('*/15 * * * *'), 15);
  assert.equal(cronMinutes('*/5 * * * *'), 5);
  assert.equal(cronMinutes('*/30 * * * *'), 30);
  for (const other of ['37 17 * * *', '0,30 * * * *', '* * * * *', '*/0 * * * *', '*/x * * * *', '']) assert.equal(cronMinutes(other), 15, other);
});

test('the first round draws each posting persona\'s sessions and keeps the picks without posting them', async () => {
  const d = fakeDb({ pool: { sessions: { perDay: 1, minutes: { least: 20, most: 20 }, waking: { from: 19, to: 20 } } } });
  const m = fakeModels(normal);
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(d.count('write_sessions'), 1);
  const write = d.of('write_sessions')[0]!;
  assert.equal(write.on_day, DAY);
  const rows = write.rows as { staff: string; start: number; end: number }[];
  assert.deepEqual(rows.map((r) => r.staff).sort(), [CLERK, HYPE, MON, SIGH].sort(), 'each posting persona of the roster');
  for (const r of rows) assert.ok(r.start >= min('19:00') && r.start <= min('19:45') && r.end - r.start === 30, `${r.staff} starts in its hour and lasts 20 minutes rounded up to the grid`);
  assert.equal(d.count('keep_pick'), 3, 'the three picks are kept');
  assert.deepEqual(d.state.kept.map((k) => k.staff).sort(), [CLERK, MON, SIGH].sort());
  assert.equal(d.state.kept[0]!.pick.trigger, 'named');
  assert.equal(d.count('write_staff_act') + d.count('write_staff_thread'), 0, 'no post yet: every persona has a session to come');
  assert.equal(m.chats.length, 0, 'and no model is paid');
  assert.equal(d.state.spends.length, 0);
  assert.deepEqual(out.picks, []);
  assert.deepEqual([...out.kept].sort(), [CLERK, MON, SIGH].sort());
});

test('a rerun of the first round writes neither the sessions nor the picks twice, and a crash between them is finished by the next round', async () => {
  const pool = { sessions: { perDay: 1, minutes: { least: 20, most: 20 }, waking: { from: 19, to: 20 } } };
  const d = fakeDb({ pool });
  const m = fakeModels(normal);
  await run(d, m);
  const sessions = d.state.sessions.length;
  const kept = d.state.kept.length;
  assert.ok(sessions > 0 && kept === 3);
  const again = await run(d, m, dividedWorld, '2026-11-04T17:52:00.000Z');
  assert.ok(again.status === 'ok');
  assert.equal(d.count('write_sessions'), 1, 'the day has its sessions; no second draw is written');
  assert.equal(d.count('keep_pick'), 3, 'and the daily path does not run again');
  assert.equal(d.state.sessions.length, sessions);
  assert.equal(d.state.kept.length, kept);
  // A round that dies after the picks are kept and before the sessions are written leaves no sessions, so the next round is a first round again: nothing is doubled.
  const crashed = fakeDb({ pool, failOn: { write_sessions: 1 } });
  await assert.rejects(run(crashed, m), /connection dropped/);
  assert.equal(crashed.state.sessions.length, 0);
  await run(crashed, m, dividedWorld, '2026-11-04T17:52:00.000Z');
  assert.equal(crashed.state.kept.length, 3, 'the picks are kept once');
  assert.equal(crashed.state.sessions.length, sessions, 'and the sessions are the same the draw made');
});

test('a kept pick posts in its persona\'s session and not before', async () => {
  const d = fakeDb({ sessions: [SIGH_LATER, { staff: CLERK, start: min('17:30'), end: min('18:15') }], kept: [keptPick(SIGH, T1, Q1), keptPick(CLERK, T2, Q2)] });
  const m = fakeModels(normal);
  const first = await run(d, m);
  assert.ok(first.status === 'ok');
  assert.deepEqual(first.picks.map((p) => [p.staff, p.status]), [[CLERK, 'posted']], 'only the persona in session posts');
  assert.deepEqual(d.state.spends.map((s) => s.staff), [CLERK]);
  assert.equal(d.count('write_staff_act'), 1);
  const next = await run(d, m, dividedWorld, at('19:07'));
  assert.ok(next.status === 'ok');
  assert.deepEqual(next.picks.map((p) => [p.staff, p.status]), [[SIGH, 'posted']]);
  assert.equal(d.state.spends.length, 2);
  const post = d.state.acts.find((a) => a.staff === SIGH)!;
  assert.equal(post.payload.pool, DAY, 'the pick\'s post carries the day, so a crash is adopted');
  assert.equal(post.target, Q1);
  assert.equal(d.state.notes.length, 2);
});

test('a kept pick written before `subject` existed (no such field) still posts', async () => {
  const k = keptPick(SIGH);
  delete (k.pick as Record<string, unknown>).subject;
  const d = fakeDb({ sessions: [SIGH_EARLIER], kept: [k] });
  const out = await run(d, fakeModels(normal));
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.picks.map((p) => [p.staff, p.status]), [[SIGH, 'posted']]);
});

test('an oldFlame pick names its flame in the reason, its face read even where the memory no longer holds it', async () => {
  const d = fakeDb({ sessions: [SIGH_EARLIER], kept: [keptPick(SIGH, T1, Q1, { trigger: 'oldFlame', subject: 'c-flame' })], faces: { 'c-flame': { name: 'Gloomba', pronouns: null } } });
  const m = fakeModels(normal);
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.ok((d.of('character_faces')[0]?.ids as string[] | undefined)?.includes('c-flame'), 'the flame\'s face is read');
  assert.ok(m.chats[0]!.system.includes('Why you are posting: Gloomba (it/its), a character you have strong feelings about, wrote one of today\'s hottest posts: the one you are replying to.'), 'the reason names the flame with its pronouns (the instance\'s, where the face has none)');
});

test('an oldFlame pick whose flame has no face (deleted, hidden) gives the plain reason, never "a character, a character"', async () => {
  const d = fakeDb({ sessions: [SIGH_EARLIER], kept: [keptPick(SIGH, T1, Q1, { trigger: 'oldFlame', subject: 'c-gone' })] });
  const m = fakeModels(normal);
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.ok(m.chats[0]!.system.includes('Why you are posting: a character you have strong feelings about wrote one of today\'s hottest posts.'), 'the plain reason');
});

test('a kept pick whose persona has no session left posts in the next round', async () => {
  const d = fakeDb({ sessions: [SIGH_EARLIER], kept: [keptPick(SIGH)] });
  const m = fakeModels(normal);
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.picks.map((p) => [p.staff, p.status]), [[SIGH, 'posted']], 'its only session ended at 10:30');
  // A persona with no session at all that day is the same: nothing is lost.
  const none = fakeDb({ sessions: [{ staff: CLERK, start: min('10:00'), end: min('10:30') }], kept: [keptPick(SIGH)] });
  const out2 = await run(none, fakeModels(normal));
  assert.ok(out2.status === 'ok');
  assert.deepEqual(out2.picks.map((p) => p.status), ['posted']);
  // A call that failed in the session is tried again in the first round after it ends, and not before it ends.
  const flaky = fakeDb({ sessions: [{ staff: SIGH, start: min('10:00'), end: min('11:00') }], kept: [keptPick(SIGH)] });
  let calls = 0;
  const bad = fakeModels((r) => { calls += 1; return calls === 1 ? new Error('provider down') : { words: `A reply from ${r.staff}.` }; });
  const during = await run(flaky, bad, dividedWorld, at('10:37'));
  assert.ok(during.status === 'ok');
  assert.deepEqual(during.picks.map((p) => p.status), ['failed']);
  assert.equal(flaky.state.spends.length, 0, 'a failed call spends nothing');
  const after = await run(flaky, bad, dividedWorld, at('11:07'));
  assert.ok(after.status === 'ok');
  assert.deepEqual(after.picks.map((p) => p.status), ['posted']);
});

test('a waiting reply is answered in the persona\'s next session and not out of session', async () => {
  const d = fakeDb({ sessions: [SIGH_LATER], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }] });
  const m = turnModels();
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(m.chats.length, 0, 'out of session it does not answer');
  assert.equal(d.count('write_staff_turn'), 0);
  assert.deepEqual(out.turns, []);
  const next = await run(d, m, dividedWorld, at('19:07'));
  assert.ok(next.status === 'ok');
  assert.deepEqual(next.turns.map((t) => [t.staff, t.status]), [[SIGH, 'taken']]);
  const wrote = d.of('write_staff_turn')[0]!;
  assert.equal(wrote.staff_key, SIGH);
  assert.equal(wrote.in_session, 1);
  assert.equal(wrote.in_thread, T1);
  assert.deepEqual(wrote.answers, [R1]);
  assert.equal(wrote.quoting, R1);
  assert.equal(wrote.body, `A turn from ${SIGH}.`);
  const call = m.chats[0]!;
  assert.equal(call.duty, 'conversation', 'a duty of its own, so the ledger prices the turns apart');
  assert.equal(call.tier, 'light');
  assert.equal(call.staff, SIGH);
  assert.ok(call.rules);
  assert.deepEqual(d.state.notes.map((n) => n.staff), [SIGH], 'the note, as a pick\'s');
  assert.equal(d.state.notes[0]!.post, d.state.turns[0]!.post);
  assert.equal(d.state.spends.length, 0, 'a turn is no pick: the pool\'s spends are unchanged');
  // The read asks only for the sessions open now, since the wait.
  assert.deepEqual(d.of('pool_waiting')[0]!.staff_keys, [SIGH]);
  assert.equal(d.of('pool_waiting')[0]!.since, new Date(Date.parse(at('19:07')) - 48 * 3_600_000).toISOString());
});

test('two waiting replies in a thread make one turn that answers both and quotes the newest', async () => {
  const d = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1, '15:00'), reply(R2, '16:30')] }] });
  const m = turnModels();
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(m.chats.length, 1, 'one call');
  assert.equal(d.count('write_staff_turn'), 1);
  const wrote = d.of('write_staff_turn')[0]!;
  assert.deepEqual(wrote.answers, [R1, R2]);
  assert.equal(wrote.quoting, R2);
  const message = m.chats[0]!.messages[0]!.content;
  assert.ok(message.includes('Reply bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2 says hello.') && message.includes('Reply bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1 says hello.'), 'the persona is shown both');
  assert.ok(message.includes('You are replying to Player char-2'), 'and the newest is the one it quotes');
  // The next round finds both answered: no second turn.
  const again = await run(d, m, dividedWorld, at('17:52'));
  assert.ok(again.status === 'ok');
  assert.equal(d.count('write_staff_turn'), 1);
});

test('a reply by a staff character makes no turn', async () => {
  const d = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [{ ...reply(R1), staff: true }] }] });
  const m = turnModels();
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(m.chats.length, 0);
  assert.equal(d.count('write_staff_turn'), 0);
});

test('a turn is capped per thread, per session, per day and by the round\'s share', async () => {
  const threeThreads = [T1, T2, T3].map((thread, i) => ({ staff: SIGH, thread, heat: 3 - i, replies: [reply([R1, R2, R3][i]!)] }));
  // The hottest thread goes first, and each thread has one turn in a round.
  const all = fakeDb({ sessions: [SIGH_NOW], waiting: threeThreads });
  const out = await run(all, turnModels(), dividedWorld, at('17:37'));
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.turns.map((t) => t.thread), [T1, T2, T3], 'by the crowd\'s reactions');
  // Per session: two turns left of the session's two.
  const session = fakeDb({ sessions: [SIGH_NOW], waiting: threeThreads, pool: { turns: { waitHours: 48, perThread: 2, perSession: 2, perDay: 60 } } });
  const s = await run(session, turnModels());
  assert.ok(s.status === 'ok');
  assert.equal(s.turns.length, 2, 'the session\'s own cap');
  // Per thread: the thread already has its one turn in this session.
  const thread = fakeDb({ sessions: [SIGH_NOW], waiting: threeThreads, spentTurns: [{ staff: SIGH, session: 0, thread: T1 }], pool: { turns: { waitHours: 48, perThread: 1, perSession: 4, perDay: 60 } } });
  const t = await run(thread, turnModels());
  assert.ok(t.status === 'ok');
  assert.deepEqual(t.turns.map((x) => x.thread), [T2, T3], 'the full thread waits');
  // The day: in the last round the whole day is earned, one turn is left of it, and the round's share is that one.
  const day = fakeDb({ sessions: [{ staff: SIGH, start: min('23:30'), end: min('23:59') }], waiting: threeThreads, turnsToday: 59 });
  const dd = await run(day, turnModels(), dividedWorld, at('23:52'));
  assert.ok(dd.status === 'ok');
  assert.equal(dd.turns.length, 1);
  const spent = fakeDb({ sessions: [SIGH_NOW], waiting: threeThreads, turnsToday: 60 });
  const none = turnModels();
  await run(spent, none);
  assert.equal(none.chats.length, 0, 'the ceiling is never passed');
  // The share: the day's turns are earned by time, floor(60 x (k+1) / 96) by round k, less what is spent: round 0 (00:07) has earned none, round 1 (00:22) has earned one.
  const morning = fakeDb({ sessions: [{ staff: SIGH, start: 0, end: 60 }], waiting: threeThreads.map((w) => ({ ...w, replies: [reply(w.replies[0]!.act, '00:01')] })).map((w) => ({ ...w, replies: w.replies.map((r) => ({ ...r, at: '2026-11-03T23:50:00.000Z' })) })) });
  const mo = await run(morning, turnModels(), dividedWorld, at('00:22'));
  assert.ok(mo.status === 'ok');
  assert.equal(mo.turns.length, 1, 'floor(60 x 2 / 96) = 1 turn earned by round 1');
});

test('a failed call leaves the replies waiting for a later round, and a rejected answer is the same', async () => {
  const d = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }] });
  const down = fakeModels(() => new Error('provider down'));
  const first = await run(d, down);
  assert.ok(first.status === 'ok');
  assert.deepEqual(first.turns.map((t) => t.status), ['failed']);
  assert.match(first.turns[0]!.why!, /provider down/);
  assert.equal(d.count('write_staff_turn'), 0);
  assert.equal(d.state.answered.size, 0);
  const rejected = fakeModels(() => ({ words: '   ' }));
  const second = await run(d, rejected, dividedWorld, at('17:52'));
  assert.ok(second.status === 'ok');
  assert.deepEqual(second.turns.map((t) => t.status), ['rejected']);
  assert.match(second.turns[0]!.why!, /nonEmpty/);
  assert.equal(d.state.answered.size, 0, 'still waiting');
  const ok = await run(d, turnModels(), dividedWorld, at('18:07'));
  assert.ok(ok.status === 'ok');
  assert.deepEqual(ok.turns.map((t) => t.status), ['taken']);
  assert.deepEqual(d.state.turns.map((t) => t.answers), [[R1]]);
});

test('a refusal of write_staff_turn skips the turn and says why, and nothing is spent', async () => {
  const d = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }], turnRefusal: 'that session is not open now' });
  const out = await run(d, turnModels());
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.turns.map((t) => [t.status, t.why]), [['skipped', 'that session is not open now']]);
  assert.equal(d.state.notes.length, 0, 'no note without a post');
});

const refusedAnswer = () => new AnswerRejected('the model refused', 'refusal');

test('a refused answer writes a paid attempt, and its reply is never called for again', async () => {
  const d = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }] });
  const refusing = fakeModels(() => refusedAnswer());
  const first = await run(d, refusing);
  assert.ok(first.status === 'ok');
  assert.deepEqual(first.turns.map((t) => t.status), ['rejected']);
  assert.deepEqual(d.state.attempts, [{ staff: SIGH, session: 1, thread: T1, answers: [R1], outcome: 'refused', paid: true }]);
  const next = turnModels();
  const second = await run(d, next, dividedWorld, at('17:52'));
  assert.ok(second.status === 'ok');
  assert.equal(next.chats.length, 0, 'the refused reply is not offered again');
  assert.equal(d.count('write_staff_turn'), 0);
});

test('a reply whose answer is rejected twice is called for twice and no more', async () => {
  const d = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }] });
  const bad = fakeModels(() => ({ words: '   ' }));
  await run(d, bad);
  await run(d, bad, dividedWorld, at('17:52'));
  assert.equal(bad.chats.length, 2);
  assert.deepEqual(d.state.attempts.map((a) => [a.outcome, a.paid]), [['rejected', true], ['rejected', true]]);
  await run(d, bad, dividedWorld, at('18:07'));
  assert.equal(bad.chats.length, 2, 'no third call');
  // A schema the provider refuses, and a prompt too long, are rejected and not paid.
  const e = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }] });
  await run(e, fakeModels(() => new SchemaRefused([{ path: '', predicate: 'keyword(maxItems)' }])));
  await run(e, fakeModels(() => new PromptTooLong(9, 3)), dividedWorld, at('17:52'));
  assert.deepEqual(e.state.attempts.map((a) => [a.outcome, a.paid]), [['rejected', false], ['rejected', false]]);
  // A request the provider turned away before answering (a 400 about the request itself) is rejected and was never answered: not paid.
  const f = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }] });
  await run(f, fakeModels(() => new AnswerRejected('the request is malformed', 'refused:400')));
  assert.deepEqual(f.state.attempts.map((a) => [a.outcome, a.paid]), [['rejected', false]]);
});

test('a transport failure writes an unpaid failed attempt and the reply is called for again', async () => {
  const d = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }] });
  const down = fakeModels(() => new Error('provider down'));
  await run(d, down);
  assert.deepEqual(d.state.attempts.map((a) => [a.outcome, a.paid, a.answers]), [['failed', false, [R1]]]);
  const again = turnModels();
  const out = await run(d, again, dividedWorld, at('17:52'));
  assert.ok(out.status === 'ok');
  assert.equal(again.chats.length, 1, 'still waiting');
  assert.deepEqual(out.turns.map((t) => t.status), ['taken']);
  // A write_staff_turn that fails with a database error after an answer is failed and paid; the reply still waits.
  const w = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }], failOn: { write_staff_turn: 1 } });
  await run(w, turnModels());
  assert.deepEqual(w.state.attempts.map((a) => [a.outcome, a.paid]), [['failed', true]]);
});

test('a kayfabb.refusal from write_staff_turn writes no attempt', async () => {
  const d = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }], turnRefusal: 'that session is not open now' });
  const out = await run(d, turnModels());
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.turns.map((t) => t.status), ['skipped']);
  assert.equal(d.count('record_turn_attempt'), 0);
});

test('a paid attempt is spent against the day\'s ceiling, so the next round\'s share is smaller', async () => {
  const three = [T1, T2, T3].map((thread, i) => ({ staff: SIGH, thread, heat: 3 - i, replies: [reply([R1, R2, R3][i]!)] }));
  const spendOne = (paid: boolean) => ({ staff: SIGH, session: 1, thread: T1, answers: [R1], outcome: 'failed', paid });
  // The last round of the day, 59 of 60 turns spent: one turn is left. A paid attempt takes it; an unpaid one does not.
  const lastRound = { sessions: [{ staff: SIGH, start: min('23:30'), end: min('23:59') }], waiting: three, turnsToday: 58 };
  const paidDb = fakeDb(lastRound);
  paidDb.state.attempts.push(spendOne(true));
  const unpaidDb = fakeDb(lastRound);
  unpaidDb.state.attempts.push(spendOne(false));
  const calledPaid = turnModels();
  const calledUnpaid = turnModels();
  await run(paidDb, calledPaid, dividedWorld, at('23:52'));
  await run(unpaidDb, calledUnpaid, dividedWorld, at('23:52'));
  assert.equal(calledPaid.chats.length, 1, '58 turns and a paid attempt leave one of 60');
  assert.equal(calledUnpaid.chats.length, 2, 'an unpaid attempt spends nothing: two are left');
});

test('a refused answer whose attempt cannot be written still returns the turn\'s record', async () => {
  const d = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }], failOn: { record_turn_attempt: 'always' } });
  const out = await run(d, fakeModels(() => refusedAnswer()));
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.turns.map((t) => t.status), ['rejected']);
  assert.match(out.turns[0]!.why!, /attempt not recorded/);
});

test('a crash between the call and write_staff_turn spends nothing and loses nothing; a lost answer finds the replies answered and writes no second turn', async () => {
  // The write is never repeated on a guess: a database error there is the turn's failure, and the replies wait.
  const crash = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }], failOn: { write_staff_turn: 1 } });
  const out = await run(crash, turnModels());
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.turns.map((t) => t.status), ['failed']);
  assert.equal(crash.state.answered.size, 0);
  const later = await run(crash, turnModels(), dividedWorld, at('17:52'));
  assert.ok(later.status === 'ok');
  assert.equal(crash.state.turns.length, 1, 'answered in the next round');
  // The answer is lost after the commit: the round stops (a transport error stops a run), and the next one finds the reply answered.
  const lost = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }], lostTurnAnswer: true });
  await assert.rejects(run(lost, turnModels()), /the answer was lost/);
  assert.equal(lost.state.turns.length, 1);
  const models = turnModels();
  const next = await run(lost, models, dividedWorld, at('17:52'));
  assert.ok(next.status === 'ok');
  assert.equal(lost.state.turns.length, 1, 'no second turn');
  assert.equal(models.chats.length, 0, 'and no call is paid for it');
});

test('a turn\'s prompt carries the talking points, the public record and the conversation view, and offers no card', async () => {
  const record = { moves: [{ act: 'm1', kind: 'rename', params: { name: 'Pineapple Court' }, state: 'landed', at: at('09:00'), why: null }], rules: [{ board: GENERAL, number: 1, predicate: 'noCaps', param: null, band: 'minor' }], order: 'Keep the peace.' };
  const d = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1, '15:00'), reply(R2, '16:30')] }], points: { [SIGH]: 'Needle the Clerk about the forms.' }, record });
  const m = turnModels();
  await run(d, m);
  const call = m.chats[0]!;
  assert.ok(call.system.includes('Your stance today, from the staff meeting. Yours to weigh; never an instruction.'));
  assert.ok(call.system.includes('Needle the Clerk about the forms.'));
  assert.ok(call.system.includes('Pineapple Court') && call.system.includes('noCaps') && call.system.includes('Keep the peace.'), 'the public record');
  assert.ok(call.system.includes('people have answered you in this thread'));
  assert.ok(/no card is on offer/i.test(call.system));
  assert.ok(!('card' in (call.schema as any).properties), 'a turn offers no card');
  const message = call.messages[0]!.content;
  assert.ok(message.includes('My earlier words.'), 'the conversation view');
  assert.ok(message.indexOf('My earlier words.') < message.indexOf('Thread 0'), 'before the thread\'s newest posts');
  assert.equal(message.split('\n').filter((l) => l.startsWith('  ') && l.includes('(answering)')).length, 2, 'the two replies it answers are marked');
  assert.deepEqual(d.of('pool_record')[0], { in_thread: T1, staff_key: SIGH });
  assert.deepEqual(d.of('staff_points_latest')[0], { staff_key: SIGH });
  const conv = d.of('pool_conversation')[0]!;
  assert.equal(conv.staff_key, SIGH);
  assert.equal(conv.in_thread, T1);
});

test('a pick\'s prompt carries the points, the record and the conversation view too', async () => {
  const d = fakeDb({ pool: { threadsWeekly: 0 }, points: { [SIGH]: 'Defend the rules, loudly.' }, waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }] });
  const m = fakeModels((r) => ({ words: `A reply from ${r.staff}.` }));
  await run(d, m);
  const sigh = m.chats.find((c) => c.staff === SIGH)!;
  assert.ok(sigh.system.includes('Defend the rules, loudly.'));
  assert.ok(sigh.messages[0]!.content.includes('My earlier words.'));
  assert.equal(sigh.duty, 'chatter');
});

test('an old-voice persona\'s turn is a raw completion over the conversation view, a ledger row of its own duty', async () => {
  const old = { ...dividedWorld, system: { ...dividedWorld.system, roster: dividedWorld.system.roster.map((p) => (p.key === SIGH ? { ...p, voice: 'oldVoice' as const } : p)) } } as Instance;
  const d = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }] });
  const m = fakeModels(normal, 'I disagree entirely');
  const out = await run(d, m, old);
  assert.ok(out.status === 'ok');
  assert.equal(m.chats.length, 0);
  assert.equal(m.completions.length, 1);
  assert.equal(m.completions[0]!.duty, 'conversation');
  assert.ok(m.completions[0]!.prompt.includes('My earlier words.') && m.completions[0]!.prompt.includes('Reply bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'));
  assert.equal(d.of('write_staff_turn')[0]!.body, 'I disagree entirely');
});

test('a second round of the same slot returns busy, having read and written nothing more', async () => {
  const d = fakeDb({ leases: true, sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [reply(R1)] }] });
  const m = turnModels();
  const first = await run(d, m);
  assert.ok(first.status === 'ok');
  const calls = d.calls.length;
  const again = await run(d, m);
  assert.deepEqual(again, { status: 'busy' });
  assert.equal(d.calls.length - calls, 2, 'the settings read and the lost claim');
  assert.equal(d.count('write_staff_turn'), 1);
});

test('a day with no sessions drawn is done once its picks are spent, and a crash while keeping them is redone whole', async () => {
  const d = fakeDb({ failOn: { keep_pick: 1 } });
  const m = fakeModels(normal);
  await assert.rejects(run(d, m), /connection dropped/);
  assert.equal(d.state.spends.length, 0);
  const again = await run(d, m, dividedWorld, '2026-11-04T17:52:00.000Z');
  assert.ok(again.status === 'ok');
  assert.deepEqual(again.picks.map((p) => p.status), ['posted', 'posted', 'posted'], 'no pick is lost');
  await run(d, m, dividedWorld, '2026-11-04T18:07:00.000Z');
  assert.equal(d.count('pool_signals'), 2, 'the round after the day\'s picks were spent does not run the daily path');
  assert.equal(d.count('keep_pick'), 4);
});

test('a turn answers every waiting reply, including one to an older post of its own that the conversation view does not hold, and quotes the newest', async () => {
  const d = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [{ ...reply(R1, '15:00'), old: true }, reply(R2, '16:00'), { ...reply(R3, '16:30'), old: true }] }] });
  const m = turnModels();
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.turns.map((t) => t.status), ['taken']);
  const wrote = d.of('write_staff_turn')[0]!;
  assert.deepEqual(wrote.answers, [R1, R2, R3]);
  assert.equal(wrote.quoting, R3, 'the newest, though the view does not hold it');
  const message = m.chats[0]!.messages[0]!.content;
  for (const r of [R1, R2, R3]) assert.ok(message.includes(`Reply ${r} says hello.`), `${r} is shown`);
  assert.equal(message.split('\n').filter((l) => l.startsWith('  ') && l.includes('(answering)')).length, 3, 'each marked');
  assert.ok(message.includes('You are replying to Player char-3'));
  // Nothing is skipped round after round: the next round finds all three answered.
  await run(d, m, dividedWorld, at('17:52'));
  assert.equal(d.count('write_staff_turn'), 1);
});

test('a day with no session drawn and no pick to spend runs the daily path once, then is marked and left alone', async () => {
  const d = fakeDb({ named: [] });
  const m = fakeModels(normal);
  for (const at of ['2026-11-04T17:37:00.000Z', '2026-11-04T17:52:00.000Z', '2026-11-04T18:07:00.000Z']) await run(d, m, dividedWorld, at);
  assert.equal(d.count('pool_signals'), 1, 'the daily path ran once');
  assert.equal(d.count('claim_pool_run'), 1, 'and the day was claimed once');
  assert.equal(d.count('write_sessions'), 1, 'the day is marked by writing its (empty) sessions, last');
  assert.deepEqual(d.of('write_sessions')[0]!.rows, []);
  const calls = d.calls.map((c) => c.fn);
  assert.ok(calls.lastIndexOf('pool_signals') < calls.indexOf('write_sessions'), 'the mark comes after the day\'s work');
});

test('a crash during the per-persona fallback leaves the day unmarked, and the next round gives every persona its sessions and marks the day', async () => {
  const pool = { sessions: { perDay: 1, minutes: { least: 20, most: 20 }, waking: { from: 19, to: 20 } } };
  // The whole list is refused (MON was benched since the context was read); the fallback writes each persona alone, and the third call of all dies.
  const d = fakeDb({ pool, refuseSessionsFor: MON, crashSessionCall: 3 });
  const m = fakeModels(normal);
  await assert.rejects(run(d, m), /connection dropped/);
  const marks = d.of('write_sessions').map((a) => a.mark);
  assert.ok(marks.slice(1).every((x) => x === false), 'a persona\'s own write does not mark the day');
  assert.equal(d.state.days.has(DAY), false, 'the day is not marked: its work is not done');
  assert.ok(d.state.sessions.length > 0 && d.state.sessions.length < 3, 'some personas have sessions, not all');
  const next = await run(d, m, dividedWorld, '2026-11-04T17:52:00.000Z');
  assert.ok(next.status === 'ok');
  assert.deepEqual([...new Set(d.state.sessions.map((x) => x.staff))].sort(), [CLERK, HYPE, SIGH].sort(), 'every persona that can post has its session, and the refused one has none');
  assert.equal(d.state.sessions.length, 3, 'none written twice');
  assert.equal(d.state.days.has(DAY), true, 'the last call marks the day');
  assert.equal(d.state.kept.length, 3, 'and the picks were kept once');
});

test('a first round redone in a later slot with a shifted signal window keeps no pick past the day\'s allowance', async () => {
  // priorSpent 15 leaves an allowance of one for the day.
  const d = fakeDb({ priorSpent: 15, named: [SIGH], namedFrom: { until: '2026-11-04T17:50:00.000Z', named: [CLERK, MON] }, failOn: { write_sessions: 1 } });
  const m = fakeModels(normal);
  await assert.rejects(run(d, m), /connection dropped/);
  assert.deepEqual(d.state.kept.map((k) => k.staff), [SIGH]);
  const again = await run(d, m, dividedWorld, '2026-11-04T17:52:00.000Z');
  assert.ok(again.status === 'ok');
  assert.equal(again.allowance, 1);
  assert.deepEqual(d.state.kept.map((k) => k.staff), [SIGH], 'the redone round keeps no second pick');
  assert.deepEqual(again.picks.filter((p) => p.status === 'posted').map((p) => p.staff), [SIGH]);
  assert.equal(d.state.spends.length, 1, 'and one is spent');
});

const NEXT = '2026-11-05';
const nextAt = (hhmm: string) => `${NEXT}T${hhmm}:00.000Z`;

test('a pick kept on day D whose persona\'s only session starts after the last round of D is written in the first round of D+1, and spent on D', async () => {
  const d = fakeDb({ sessions: [SIGH_LATER], kept: [keptPick(SIGH, T1, Q1)] });
  const m = fakeModels(normal);
  const last = await run(d, m, dividedWorld, at('18:52'));
  assert.ok(last.status === 'ok');
  assert.equal(d.state.spends.length, 0, 'the persona\'s session had not begun');
  const out = await run(d, m, dividedWorld, nextAt('00:07'));
  assert.ok(out.status === 'ok');
  assert.deepEqual(d.state.spends.filter((s) => s.staff === SIGH && s.day === DAY).map((s) => s.post_act), [d.state.acts.find((a) => a.staff === SIGH && a.payload.pool === DAY)!.id], 'spent on its own day, on the post written');
});

test('a once-a-day cron loses no kept pick', async () => {
  // One round a day: day D\'s round keeps the picks, and the persona\'s session is yet to come when it ends.
  const pool = { chatterCron: '37 17 * * *', sessions: { perDay: 1, minutes: { least: 20, most: 20 }, waking: { from: 22, to: 23 } } };
  const d = fakeDb({ pool });
  const m = fakeModels(normal);
  const first = await run(d, m);
  assert.ok(first.status === 'ok');
  assert.equal(first.kept.length, 3);
  assert.equal(d.state.spends.length, 0);
  const next = await run(d, m, dividedWorld, nextAt('17:37'));
  assert.ok(next.status === 'ok');
  for (const staff of first.kept) assert.ok(d.state.spends.some((s) => s.day === DAY && s.staff === staff), `${staff}'s pick of ${DAY} is spent on ${DAY}`);
});

test('a carried-over pick is written once whatever reruns', async () => {
  const d = fakeDb({ sessions: [SIGH_LATER], kept: [keptPick(SIGH, T1, Q1)] });
  const m = fakeModels(normal);
  await run(d, m, dividedWorld, nextAt('00:07'));
  await run(d, m, dividedWorld, nextAt('00:07'));
  await run(d, m, dividedWorld, nextAt('00:22'));
  assert.equal(d.state.acts.filter((a) => a.staff === SIGH && a.payload?.pool === DAY).length, 1, 'one post');
  assert.equal(d.state.spends.filter((s) => s.staff === SIGH && s.day === DAY).length, 1, 'and one spend');
});

test('a kept pick past the day\'s allowance is not written', async () => {
  // Weekly 20 on this Wednesday gives an allowance of 4; four spends today leave no slot. The kept pick waits (and is not lost: the allowance is what the day was given).
  const d = fakeDb({ sessions: [SIGH_EARLIER], kept: [keptPick(SIGH, T1, Q1)], priorSpent: 0 });
  const m = fakeModels(normal);
  d.state.spends.push(...[CLERK, MON, HYPE, 'placeholder-extra'].map((staff, i) => ({ day: DAY, staff, trigger: 'named', post_act: `done-${i}`, card_act: null, started_thread: false, record: {} })));
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.equal(out.picks.length, 0);
  assert.equal(d.state.acts.filter((a) => a.staff === SIGH).length, 0, 'nothing is posted past the allowance');
});

test('a turn reads its older replies in one pool_thread call', async () => {
  const d = fakeDb({ sessions: [SIGH_NOW], waiting: [{ staff: SIGH, thread: T1, replies: [{ ...reply(R1, '15:00'), old: true }, reply(R2, '16:00'), { ...reply(R3, '16:30'), old: true }, { ...reply(R4, '16:40'), old: true }] }] });
  const m = turnModels();
  const out = await run(d, m);
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.turns.map((t) => t.status), ['taken']);
  const older = d.calls.filter((c) => c.fn === 'pool_thread' && c.args.most === 0);
  assert.equal(older.length, 1, 'one call for the older replies');
  assert.deepEqual([...older[0]!.args.more].sort(), [R1, R3, R4].sort());
  assert.equal(older[0]!.args.also, null);
});

test('keepThePicks counts a persona once: one whose kept pick has posted is not counted again', async () => {
  // The database lists only unwritten picks, so the two sets never meet; the fake lists the written one as well, to show the count holds if a change ever does.
  const d = fakeDb({ kept: [keptPick(SIGH)], keptListsWritten: true });
  d.state.days.delete(DAY);
  d.state.spends.push(...[SIGH, 'placeholder-extra'].map((staff, i) => ({ day: DAY, staff, trigger: 'named', post_act: `done-${i}`, card_act: null, started_thread: false, record: {} })));
  const out = await run(d, fakeModels(normal));
  assert.ok(out.status === 'ok');
  assert.deepEqual([...out.kept].sort(), [CLERK, MON].sort(), 'the allowance of 4 holds two spends and two new picks');
});

test('a pick carried over from yesterday counts against the week\'s allowance before it is written', async () => {
  // Thursday 2026-11-05, a week of 20: yesterday's unwritten pick is a slot the week has already given, so today's allowance is the one a week with that slot spent gives.
  const carriedRun = async (priorSpent: number, kept: boolean) => {
    const d = fakeDb({ priorSpent, ...(kept ? { sessions: [SIGH_LATER], kept: [keptPick(SIGH, T1, Q1)] } : {}) });
    const out = await run(d, fakeModels(normal), dividedWorld, nextAt('00:07'));
    assert.ok(out.status === 'ok');
    return out.allowance;
  };
  const free = await carriedRun(0, false);
  const spent = await carriedRun(1, false);
  assert.ok(spent < free, 'the fixture shows a slot spent changes the allowance');
  assert.equal(await carriedRun(0, true), spent, 'the carried pick is counted as spent');
});

// Sunday 2026-11-22 and the Monday after it, 2026-11-23: the carried pick of a Sunday is spent in last week.
const SUNDAY = '2026-11-22';
const MONDAY_AT = (hhmm: string) => `2026-11-23T${hhmm}:00.000Z`;
const spendOn = (day: string, staff: string, card: string | null = null, i = 0): Spend => ({ day, staff, trigger: 'named', post_act: `done-${day}-${staff}-${i}`, card_act: card, started_thread: false, record: {} });
const postsOf = (d: ReturnType<typeof fakeDb>, staff: string, day: string) => d.state.acts.filter((a) => a.staff === staff && a.kind !== 'card' && a.kind !== 'set' && a.payload?.pool === day);

test('a Sunday pick whose post landed and whose spend failed is adopted on Monday, before the carried read, and posts once', async () => {
  const d = fakeDb({ kept: [{ ...keptPick(SIGH, T1, Q1), day: SUNDAY }], failOn: { record_pool_spend: 1 } });
  d.state.days.delete(DAY);
  d.state.days.add(SUNDAY);
  const m = fakeModels(normal);
  const sunday = await run(d, m, dividedWorld, `${SUNDAY}T12:07:00.000Z`);
  assert.ok(sunday.status === 'ok');
  assert.equal(postsOf(d, SIGH, SUNDAY).length, 1, 'the post landed');
  assert.equal(d.state.spends.some((s) => s.day === SUNDAY && s.staff === SIGH), false, 'and its spend did not');
  const monday = await run(d, m, dividedWorld, MONDAY_AT('00:07'));
  assert.ok(monday.status === 'ok');
  assert.deepEqual(monday.adopted.map((a) => [a.staff, a.status, a.day]), [[SIGH, 'adopted', SUNDAY]]);
  assert.equal(postsOf(d, SIGH, SUNDAY).length, 1, 'one post, not two');
  assert.equal(d.state.spends.filter((s) => s.day === SUNDAY && s.staff === SIGH).length, 1, 'spent once, on Sunday');
});

test('a carried pick blocked on its own day by a card slot is not written the next day, midweek or on a Monday', async () => {
  // Wednesday 11-04 has an allowance of 4 and a post with a card is two of it: three spends and a card use it all.
  const wed = fakeDb({ kept: [{ ...keptPick(SIGH, T1, Q1), day: DAY }], sessions: [SIGH_LATER] });
  wed.state.spends.push(spendOn(DAY, CLERK, 'card-1'), spendOn(DAY, MON), spendOn(DAY, HYPE));
  const thu = await run(wed, fakeModels(normal), dividedWorld, nextAt('00:07'));
  assert.ok(thu.status === 'ok');
  assert.equal(postsOf(wed, SIGH, DAY).length, 0, 'not written on Thursday');
  assert.ok(thu.picks.some((p) => p.staff === SIGH && p.status === 'skipped' && /own day/.test(p.why ?? '')), 'and skipped on the record');
  // Never owed, it takes no slot from Thursday: the allowance is what the same week gives with no pick carried.
  const none = fakeDb({ sessions: [SIGH_LATER] });
  none.state.spends.push(spendOn(DAY, CLERK, 'card-1'), spendOn(DAY, MON), spendOn(DAY, HYPE));
  const plain = await run(none, fakeModels(normal), dividedWorld, nextAt('00:07'));
  assert.ok(plain.status === 'ok');
  assert.equal(thu.allowance, plain.allowance, 'a carried pick past its own day takes no slot from today');
  // Sunday 11-22 with 18 spent before it has an allowance of 2: two spends use it, and Monday's run does not write the third.
  const sun = fakeDb({ kept: [{ ...keptPick(SIGH, T1, Q1), day: SUNDAY }], priorSpent: 18 });
  sun.state.days.delete(DAY);
  sun.state.days.add(SUNDAY);
  sun.state.spends.push(spendOn(SUNDAY, CLERK), spendOn(SUNDAY, MON));
  const mon = await run(sun, fakeModels(normal), dividedWorld, MONDAY_AT('00:07'));
  assert.ok(mon.status === 'ok');
  assert.equal(postsOf(sun, SIGH, SUNDAY).length, 0, 'not written on Monday');
  assert.ok(mon.picks.some((p) => p.staff === SIGH && p.status === 'skipped' && /own day/.test(p.why ?? '')));
});

test('a carried pick inside its own day\'s allowance is written on Monday as midweek, and Monday does not count it in its own week', async () => {
  // Week spent 6 before Monday: the allowance is floor(14 / 7) = 2 with the carried pick not counted (it is last week's), and floor(13 / 7) = 1 if it were.
  const d = fakeDb({ kept: [{ ...keptPick(SIGH, T1, Q1), day: SUNDAY }], priorSpent: 6 });
  d.state.days.delete(DAY);
  d.state.days.add(SUNDAY);
  const out = await run(d, fakeModels(normal), dividedWorld, MONDAY_AT('00:07'));
  assert.ok(out.status === 'ok');
  assert.equal(out.allowance, 2, 'Monday\'s allowance leaves out the Sunday pick');
  assert.equal(postsOf(d, SIGH, SUNDAY).length, 1, 'and the Sunday pick is written');
});

test('a kept pick of today whose persona has posted already is recorded as such and written no second time', async () => {
  const d = fakeDb({ kept: [keptPick(SIGH, T1, Q1)], keptListsWritten: true });
  d.state.spends.push(spendOn(DAY, SIGH));
  const out = await run(d, fakeModels(normal));
  assert.ok(out.status === 'ok');
  assert.deepEqual(out.picks.filter((p) => p.staff === SIGH).map((p) => p.status), ['already']);
  assert.equal(postsOf(d, SIGH, DAY).length, 0);
});

test('a day with no allowance reads no kept picks of its own', async () => {
  const d = fakeDb({ kept: [keptPick(SIGH, T1, Q1)], priorSpent: 20 });
  const out = await run(d, fakeModels(normal));
  assert.ok(out.status === 'ok');
  assert.equal(out.allowance, 0);
  assert.equal(d.of('kept_picks').filter((a) => a.on_day === DAY).length, 0, 'the day\'s own kept picks are not read');
  assert.equal(postsOf(d, SIGH, DAY).length, 0);
});

test('a carried pick offers no card, though its kept pick had a card slot', async () => {
  const d = fakeDb({ kept: [keptPick(SIGH, T1, Q1, { cardSlot: true })], sessions: [SIGH_LATER], pool: { cardRarityMost: 'uncommon' } });
  const m = fakeModels(normal);
  const out = await run(d, m, dividedWorld, nextAt('00:07'));
  assert.ok(out.status === 'ok');
  assert.equal(postsOf(d, SIGH, DAY).length, 1, 'the carried pick is written');
  const carriedChat = m.chats.filter((c) => c.staff === SIGH)[0]!;
  assert.equal('card' in ((carriedChat.schema as any).properties ?? {}), false, 'no card in its schema');
});

test('a carried thread start leaves no thread for the next carried pick', async () => {
  const d = fakeDb({ kept: [{ ...keptPick(SIGH, T1, Q1, { startThread: true }), day: DAY }, { ...keptPick(CLERK, T2, Q2, { startThread: true }), day: DAY }], sessions: [SIGH_LATER], pool: { threadsWeekly: 2 } });
  d.state.days.add(NEXT);
  const out = await run(d, fakeModels(normal), dividedWorld, nextAt('00:07'));
  assert.ok(out.status === 'ok');
  const threads = d.state.acts.filter((a) => a.kind === 'thread' && a.payload?.pool === DAY);
  assert.equal(threads.length, 1, 'one thread started on the carried day, the other pick replied');
  assert.equal(postsOf(d, CLERK, DAY).length + threads.length, 2, 'both picks were written');
});
