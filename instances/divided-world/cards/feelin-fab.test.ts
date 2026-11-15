/**
 * Feelin' Fab's own landing rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { post } from './test-kit.ts';

test("Feelin' Fab lands on a post alone, up to three, and a fourth is refused in plain words", async () => {
  const { feelinFab } = await import('./feelin-fab.ts');
  const up = (n: number) => Array.from({ length: n }, (_, i) => ({ card: 'feelin-fab', act: `f${i}`, reach: 'post' as const }));
  for (const n of [0, 1, 2]) assert.equal(feelinFab.canApply(post(10), up(n)).ok, true, `${n} up`);
  assert.deepEqual(feelinFab.canApply(post(10), up(3)), { ok: false, why: 'this post already carries 3 of that card, the most it takes' });
  assert.deepEqual(feelinFab.canApply({ reach: 'character', character: 'c1' }, []), { ok: false, why: 'this card lands on a post' });
  assert.deepEqual(feelinFab.canApply({ reach: 'thread', thread: 't1' }, []), { ok: false, why: 'this card lands on a post' });
});
