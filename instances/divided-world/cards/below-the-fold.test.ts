/**
 * Below the Fold's own landing rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { post } from './test-kit.ts';

test('Below the Fold lands on a post with no fold, and a second is refused in plain words', async () => {
  const { belowTheFold } = await import('./below-the-fold.ts');
  assert.equal(belowTheFold.canApply(post(10), []).ok, true);
  assert.equal(belowTheFold.canApply(post(10), [{ card: 'whoops', act: 'w1', reach: 'post' as const }]).ok, true, 'another card is no fold');
  assert.deepEqual(belowTheFold.canApply(post(10), [{ card: 'below-the-fold', act: 'f1', reach: 'post' as const }]), { ok: false, why: 'this post already carries that card' });
  assert.deepEqual(belowTheFold.canApply({ reach: 'character', character: 'c1' }, []), { ok: false, why: 'this card lands on a post' });
});
