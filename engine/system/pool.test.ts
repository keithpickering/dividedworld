import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Persona } from '../rules/types.ts';
import type { Memory } from './memory.ts';
import {
  DEFAULT_STRENGTHS, NEW_POSTS_BELOW, TRIGGERS, allowance, candidates, dayRng, pick, priorities, priority, seededRng,
  type Candidate, type PoolContext, type PoolPhase, type PoolSignals, type PoolPickSettings,
} from './pool.ts';

const DAY = 24 * 60 * 60 * 1000;
const persona = (key: string, beats: string[] = []): Persona => ({ key, name: key, beats }) as unknown as Persona;
const ROSTER = [persona('boss1'), persona('old'), persona('mod1', ['general']), persona('mem1', ['arcade']), persona('wait'), persona('bench'), persona('fresh', ['general'])];
const OFFICES = { boss1: 'boss', old: 'member', mod1: 'mod', mem1: 'member', wait: 'waiting', bench: 'benched', fresh: 'member' };
const CTX: PoolContext = { offices: OFFICES, boards: { b1: 'general', b2: 'arcade' }, characters: { mod1: 'c-mod1', old: 'c-old' } };
const none: PoolSignals = { named: [], quoted: [], legacy: [], reversals: [], handovers: [], hot: [], tallies: [] };
const PHASES = {
  honeymoon: { days: 14, weeklyMoves: 2, bankCap: 4, moveExpiryMostDays: 7 },
  reign: { weeklyMoves: 5, bankCap: 10, moveExpiryMostDays: 28 },
  meltdown: { days: 21, weeklyMoves: 8, bankCap: 14, moveExpiryMostDays: 42 },
};
// A 100-day season: the meltdown begins on day 79.
const PHASE: PoolPhase = { season: { startsAt: 0, endsAt: 100 * DAY }, since: 40 * DAY, until: 41 * DAY, settings: { phases: PHASES }, boss: 'boss1', predecessor: 'old' };
const memory = (m: Partial<Memory>): Memory => ({ hobby: { name: 'x', since: 'a', from: 'b' }, opinions: [], grudges: [], wheelhouse: [], realWorld: [], marks: [], ...m });
const hot = (over: object = {}) => ({ thread: 't1', board: 'b1', heat: 4, starter: 'c-x', starterStaff: null, staffStarted: false, authors: [], boardMaker: null, ...over });
const run = (signals: Partial<PoolSignals>, phase: PoolPhase = PHASE, memories: Record<string, Memory> = {}) =>
  candidates({ ...none, ...signals }, ROSTER, memories, phase, CTX);
const only = (cs: Candidate[], trigger: string) => cs.filter((c) => c.trigger === trigger);

const POOL: PoolPickSettings = { strengths: DEFAULT_STRENGTHS, holdback: 0.2 };

/* -------------------------------------------------------------------------------------------------- the triggers ---- */

test('the triggers are the design\'s eight, and the defaults put the first five above the last three', () => {
  assert.deepEqual([...TRIGGERS], ['named', 'quoted', 'legacy', 'successorStumbles', 'oldFlame', 'homeTurf', 'seasonTurn', 'hotOnBeat']);
  for (const t of ['named', 'quoted', 'legacy', 'successorStumbles', 'oldFlame'] as const) assert.equal(DEFAULT_STRENGTHS[t], 5, t);
  for (const t of ['homeTurf', 'seasonTurn', 'hotOnBeat'] as const) assert.equal(DEFAULT_STRENGTHS[t], 2, t);
});

test('named: a post that names a persona is a candidate, in that thread, quoting that post', () => {
  const c = run({ named: [{ staff: 'mod1', act: 'a1', thread: 't1', n: 1 }] });
  assert.deepEqual(c, [{ staff: 'mod1', trigger: 'named', thread: 't1', quoting: 'a1', act: 'a1' }]);
});

test('quoted: a post that quotes or replies to a persona\'s post is a candidate in that thread', () => {
  const c = run({ quoted: [{ staff: 'mem1', act: 'a2', thread: 't2', n: 1 }] });
  assert.deepEqual(c, [{ staff: 'mem1', trigger: 'quoted', thread: 't2', quoting: 'a2', act: 'a2' }]);
});

test('legacy: a move ended, kept or reversed fires for its maker, not for its owner at the Act', () => {
  const c = run({ legacy: [{ staff: 'mem1', maker: 'old', move: 'm1', act: 'e1', how: 'reversed', n: 1 }, { staff: 'mod1', maker: 'mod1', move: 'm2', act: 'k1', how: 'kept', n: 1 }] });
  assert.deepEqual(only(c, 'legacy').map((x) => [x.staff, x.act]).sort(), [['mod1', 'k1'], ['old', 'e1']]);
});

test('successorStumbles: the Boss entering its meltdown inside the window fires for the Boss before it, and only then', () => {
  const crossing: PoolPhase = { ...PHASE, since: 78.5 * DAY, until: 79.5 * DAY };
  assert.deepEqual(run({}, crossing), [{ staff: 'old', trigger: 'successorStumbles', thread: null, quoting: null, act: null }]);
  assert.deepEqual(run({}, PHASE), [], 'mid-reign, nothing');
  assert.deepEqual(run({}, { ...PHASE, since: 85 * DAY, until: 86 * DAY }), [], 'already in the meltdown before the window: it entered it earlier');
  assert.deepEqual(run({}, { ...crossing, predecessor: null }), [], 'a Boss with no predecessor stumbles in front of no one');
});

test('successorStumbles: an admin reversal of the Boss\'s move fires for the Boss before it, with the reversal as its act', () => {
  const c = run({ reversals: [{ staff: 'boss1', move: 'm9', act: 'r1' }] });
  assert.deepEqual(c, [{ staff: 'old', trigger: 'successorStumbles', thread: null, quoting: null, act: 'r1' }]);
});

test('oldFlame: a favorite or a grudge in its memory writing one of the hottest posts fires, in that thread', () => {
  const memories = {
    mod1: memory({ opinions: [{ character: 'c-fav', score: 4, note: '' }, { character: 'c-meh', score: 1, note: '' }] }),
    mem1: memory({ grudges: [{ character: 'c-foe', note: '' }] }),
    fresh: memory({ opinions: [{ character: 'c-meh', score: 1, note: '' }] }),
  };
  const c = only(run({ hot: [hot({ authors: [{ character: 'c-fav', posts: 3 }, { character: 'c-foe', posts: 1 }, { character: 'c-meh', posts: 2 }] })] }, PHASE, memories), 'oldFlame');
  assert.deepEqual(c.map((x) => [x.staff, x.thread]).sort(), [['mem1', 't1'], ['mod1', 't1']], 'a score of 1 is not a favorite');
});

test('oldFlame: a persona is never lit by its own character\'s post', () => {
  const memories = { mod1: memory({ opinions: [{ character: 'c-mod1', score: 5, note: '' }] }) };
  assert.deepEqual(only(run({ hot: [hot({ authors: [{ character: 'c-mod1', posts: 3 }] })] }, PHASE, memories), 'oldFlame'), []);
});

test('hotOnBeat: a hot thread on a board of a persona\'s beats fires for it, and for no one whose beats are elsewhere', () => {
  const c = only(run({ hot: [hot({ board: 'b1' })] }), 'hotOnBeat');
  assert.deepEqual(c.map((x) => x.staff).sort(), ['fresh', 'mod1']);
  assert.ok(c.every((x) => x.thread === 't1'));
  assert.deepEqual(only(run({ hot: [hot({ board: 'unknown' })] }), 'hotOnBeat'), [], 'a board with no slug is no one\'s beat');
});

test('homeTurf: a hot thread a persona started fires for it; so does a board it made, once an Act records one', () => {
  const started = only(run({ hot: [hot({ staffStarted: true, starterStaff: 'mem1', board: 'unknown' })] }), 'homeTurf');
  assert.deepEqual(started, [{ staff: 'mem1', trigger: 'homeTurf', thread: 't1', quoting: null, act: null }]);
  const made = only(run({ hot: [hot({ boardMaker: 'old', board: 'unknown' })] }), 'homeTurf');
  assert.deepEqual(made.map((x) => x.staff), ['old']);
  assert.deepEqual(only(run({ hot: [hot({ board: 'unknown' })] }), 'homeTurf'), [], 'a thread a player started is no persona\'s turf');
});

test('seasonTurn: a handover in the window fires for the Boss that left', () => {
  const c = run({ handovers: [{ season: 4, outgoing: 'old', boss: 'boss1', how: 'rotation', at: 'x' }, { season: 5, outgoing: null, boss: 'mod1', how: 'none', at: 'y' }] });
  assert.deepEqual(c, [{ staff: 'old', trigger: 'seasonTurn', thread: null, quoting: null, act: null }]);
});

test('a waiting or benched persona is never a candidate, whatever the signal says', () => {
  const c = run({
    named: [{ staff: 'wait', act: 'a', thread: 't', n: 1 }, { staff: 'bench', act: 'b', thread: 't', n: 1 }],
    legacy: [{ staff: 'x', maker: 'bench', move: 'm', act: 'e', how: 'met', n: 1 }],
    handovers: [{ season: 1, outgoing: 'wait', boss: 'bench', how: 'rotation', at: 'z' }],
    hot: [hot({ staffStarted: true, starterStaff: 'bench', board: 'unknown' })],
  });
  assert.deepEqual(c, []);
  assert.deepEqual(candidates({ ...none, named: [{ staff: 'ghost', act: 'a', thread: 't', n: 1 }] }, ROSTER, {}, PHASE, CTX), [], 'nor a key the roster does not hold');
});

/* ---------------------------------------------------------------------------------------------- priority, allowance ---- */

test('priority is reactions per post, and fewer than three posts counts as new', () => {
  assert.deepEqual(priority({ posts: 4, reactions: 10 }), { value: 2.5, isNew: false });
  assert.deepEqual(priority({ posts: NEW_POSTS_BELOW - 1, reactions: 100 }), { value: 50, isNew: true });
  assert.deepEqual(priority({ posts: 0, reactions: 0 }), { value: 0, isNew: true });
  assert.deepEqual(priorities([{ staff: 'a', posts: 3, reactions: 3 }]), { a: { value: 1, isNew: false } });
});

test('the allowance is the week\'s remainder over the days left, rounded down, and a spent week gives 0', () => {
  const monday = Date.UTC(2026, 10, 2); // 2026-11-02 is a Monday
  assert.equal(allowance(0, 20, monday), 2, '20 over 7 days');
  assert.equal(allowance(6, 20, monday + 3 * DAY), 3, 'Thursday: 14 over 4');
  assert.equal(allowance(14, 20, monday + 6 * DAY), 6, 'Sunday: all that is left');
  assert.equal(allowance(20, 20, monday + 2 * DAY), 0, 'a spent week');
  assert.equal(allowance(25, 20, monday), 0, 'an overspent week is never negative');
  assert.equal(allowance(0, 3, monday), 0, 'a floor can leave a day empty');
});

/* ------------------------------------------------------------------------------------------------------------ pick ---- */

const cand = (staff: string, trigger: Candidate['trigger'] = 'named', thread = 't-' + staff): Candidate => ({ staff, trigger, thread, quoting: null, act: null });
const veteran = { value: 2, isNew: false };
const rookie = { value: 0, isNew: true };
const PRIOR = (...staff: string[]) => Object.fromEntries(staff.map((s) => [s, veteran]));

type PickFn = typeof pick;
/** The one-per-persona check, over any pick: it throws when a persona is picked twice. */
function onePerPersona(pickFn: PickFn): void {
  const cs = [cand('a'), cand('a', 'quoted'), cand('a', 'hotOnBeat'), cand('b'), cand('b', 'oldFlame')];
  const { picks } = pickFn(cs, PRIOR('a', 'b'), 10, 0, dayRng('d'), POOL);
  assert.deepEqual(picks.map((p) => p.staff).sort(), ['a', 'b'], 'each persona posts once');
}

test('at most one post per persona, whatever it has been triggered by', () => {
  onePerPersona(pick);
});

test('the one-per-persona check goes red against a pick that lets a persona post twice (the poison)', () => {
  // The poison: the real pick, then its first persona posted again, as a forgotten dedupe would leave it.
  const twice: PickFn = (...args) => { const r = pick(...args); return { ...r, picks: [...r.picks, r.picks[0]!] }; };
  assert.throws(() => onePerPersona(twice), /each persona posts once/);
  // And one that skips the per-persona best and keeps every candidate.
  const every: PickFn = (cs, pr, n, t, rng, pool) => ({ picks: cs.slice(0, n).map((c) => ({ ...c, startThread: false, cardSlot: false })), cardSlots: 0 });
  assert.throws(() => onePerPersona(every), /each persona posts once/);
});

test('a persona\'s best candidate is the one that posts: the stronger trigger wins', () => {
  const { picks } = pick([cand('a', 'hotOnBeat'), cand('a', 'named')], PRIOR('a'), 1, 0, dayRng('d'), POOL);
  assert.equal(picks[0]!.trigger, 'named');
});

test('the top scorers post, up to the allowance: strength times priority', () => {
  const cs = [cand('a', 'named'), cand('b', 'hotOnBeat'), cand('c', 'named')];
  const pr = { a: { value: 3, isNew: false }, b: { value: 9, isNew: false }, c: { value: 1, isNew: false } };
  // scores: a 15, b 18, c 5
  assert.deepEqual(pick(cs, pr, 2, 0, dayRng('d'), POOL).picks.map((p) => p.staff), ['b', 'a']);
});

test('a persona the crowd ignores still scores by its trigger: the priority has a floor', () => {
  const { picks } = pick([cand('a', 'hotOnBeat'), cand('b', 'named')], { a: { value: 0, isNew: false }, b: { value: 0, isNew: false } }, 1, 0, dayRng('d'), POOL);
  assert.equal(picks[0]!.staff, 'b');
});

test('the holdback keeps a share of the day\'s posts for new personas, filled from them first', () => {
  // 10 slots at 0.2 hold 2 back. Eight veterans and three rookies, the veterans scoring higher.
  const vets = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8'];
  const rooks = ['r1', 'r2', 'r3'];
  const pr = { ...PRIOR(...vets), ...Object.fromEntries(rooks.map((r) => [r, rookie])) };
  const { picks } = pick([...vets, ...rooks].map((s) => cand(s)), pr, 10, 0, dayRng('d'), POOL);
  assert.equal(picks.length, 10);
  assert.equal(picks.filter((p) => rooks.includes(p.staff)).length, 2, 'two of ten go to rookies though the veterans outscore them');
  assert.equal(picks.filter((p) => vets.includes(p.staff)).length, 8);
});

test('the holdback goes back to the others when there are no new personas, or too few', () => {
  const vets = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'];
  const none_ = pick(vets.map((s) => cand(s)), PRIOR(...vets), 5, 0, dayRng('d'), POOL);
  assert.equal(none_.picks.length, 5, 'with no rookies all five go to veterans');
  const one = pick([...vets, 'r1'].map((s) => cand(s)), { ...PRIOR(...vets), r1: rookie }, 10, 0, dayRng('d'), { ...POOL, holdback: 0.5 });
  assert.equal(one.picks.length, 7, 'five held for rookies, one rookie: the other four slots return to the rest');
  assert.ok(one.picks.some((p) => p.staff === 'r1'));
});

test('a spent week gives 0 posts, and 0 card slots', () => {
  const got = pick([cand('a'), cand('b')], PRIOR('a', 'b'), 0, 1, dayRng('d'), POOL);
  assert.deepEqual(got, { picks: [], cardSlots: 0 });
});

test('the thread share: the top scorer starts a thread while the week has one left, and no one else does', () => {
  const cs = [cand('a', 'named'), cand('b', 'hotOnBeat'), cand('c', 'quoted')];
  const pr = PRIOR('a', 'b', 'c');
  const withShare = pick(cs, pr, 3, 1, dayRng('d'), POOL).picks;
  assert.deepEqual(withShare.filter((p) => p.startThread).map((p) => p.staff.length), [1]);
  const top = withShare[0]!;
  assert.ok(top.startThread && top.trigger !== 'hotOnBeat', 'the top scorer, not the weakest trigger');
  assert.equal(pick(cs, pr, 3, 0, dayRng('d'), POOL).picks.filter((p) => p.startThread).length, 0, 'none left: none start');
});

test('the allowance left after the posts is the card budget, and the top scorers hold the slots', () => {
  const cs = [cand('a', 'named'), cand('b', 'named'), cand('c', 'hotOnBeat')];
  const got = pick(cs, PRIOR('a', 'b', 'c'), 4, 0, dayRng('d'), POOL);
  assert.equal(got.picks.length, 3);
  assert.equal(got.cardSlots, 1);
  assert.deepEqual(got.picks.map((p) => p.cardSlot), [true, false, false]);
  const full = pick(cs, PRIOR('a', 'b', 'c'), 3, 0, dayRng('d'), POOL);
  assert.equal(full.cardSlots, 0);
  assert.ok(full.picks.every((p) => !p.cardSlot));
});

test('a rerun on the same day picks the same, whatever order the candidates arrive in; another day may break ties otherwise', () => {
  const cs = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => cand(s));
  const pr = PRIOR('a', 'b', 'c', 'd', 'e', 'f');
  const first = pick(cs, pr, 3, 1, dayRng('2026-11-05'), POOL);
  assert.deepEqual(pick(cs, pr, 3, 1, dayRng('2026-11-05'), POOL), first);
  assert.deepEqual(pick([...cs].reverse(), pr, 3, 1, dayRng('2026-11-05'), POOL), first);
  const others = new Set(Array.from({ length: 30 }, (_, i) => pick(cs, pr, 3, 1, dayRng(`day-${i}`), POOL).picks.map((p) => p.staff).join()));
  assert.ok(others.size > 1, 'ties are broken by the day');
});

test('the seeded generator repeats for a seed and varies across seeds', () => {
  const a = seededRng('x'); const b = seededRng('x'); const c = seededRng('y');
  const take = (r: () => number) => Array.from({ length: 5 }, r);
  assert.deepEqual(take(a), take(b));
  assert.notDeepEqual(take(seededRng('x')), take(c));
  assert.ok(take(seededRng('z')).every((n) => n >= 0 && n < 1));
});

test('a benched or waiting persona is never picked, even when handed to pick as a candidate by the signals', () => {
  const c = run({ named: [{ staff: 'bench', act: 'a', thread: 't', n: 1 }, { staff: 'wait', act: 'b', thread: 't', n: 1 }, { staff: 'mod1', act: 'c', thread: 't', n: 1 }] });
  const { picks } = pick(c, PRIOR('bench', 'wait', 'mod1'), 10, 1, dayRng('d'), POOL);
  assert.deepEqual(picks.map((p) => p.staff), ['mod1']);
});
