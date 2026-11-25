/**
 * The ladder the fogs share (ladder.ts), as numbers: which of the fogs in view steps down a rung when the frames' mean is over the budget. Hot Box's own cases are in
 * Effect.test.tsx; this holds what the puff added, that a transient fog (Steel Chair's puff) is the one to step down first, so that a smoked post never goes down a rung
 * for a puff that is gone in 5 s, and that with no puff among them the order is as it always was.
 *
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning --test instances/divided-world/ui/hot-box/ladder.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOG_BUDGET_MS, LADDER_FIRST, ladder, resetFogLadder, spend, type Rung } from './ladder.ts';

/** A post on the ladder at a rung, that painted in every frame, and what it was lowered to. */
function post(o: { transient?: boolean; pointed?: boolean }): Rung & { to: number | null } {
  const r = { to: null as number | null, level: () => 0, pointed: () => o.pointed === true, paintedIn: () => ladder.frames, lower(to: number) { r.to = to; }, ...(o.transient ? { transient: true } : {}) };
  ladder.rungs.add(r);
  return r;
}

/** Runs frames each costing `ms` until the ladder has judged, or a hundred have passed. */
function overBudget(ms: number): void {
  for (let frame = 1; frame <= 100 && !ladder.skipping; frame++) {
    spend('a:0', frame, ms);
    spend('a:0', frame, 0);
    if (frame > LADDER_FIRST + 2 && ladder.kept.length === 0) break;
  }
}

test('over the budget with a smoked post and a puff, the puff steps down and the smoked post does not', () => {
  resetFogLadder();
  const smoked = post({}), puff = post({ transient: true });
  overBudget(FOG_BUDGET_MS * 3);
  assert.ok(puff.to !== null, 'the puff was lowered');
  assert.equal(smoked.to, null, 'the smoked post was left alone');
});

test('with no puff the order is as it was: a post nobody points at first, in the order they joined', () => {
  resetFogLadder();
  const pointed = post({ pointed: true }), idle = post({});
  overBudget(FOG_BUDGET_MS * 3);
  assert.ok(idle.to !== null && pointed.to === null, 'the unpointed post was lowered, the pointed one was not');
  resetFogLadder();
});
