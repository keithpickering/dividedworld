/**
 * Feelin' Glam's own landing rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults as settings } from '../settings.ts';
import { by, post } from './test-kit.ts';

test("Feelin' Glam lands on a thread, one at a time, and costs nothing more", () => {
  const glam = by('feelin-glam');
  const thread = { reach: 'thread' as const, thread: 't1' };
  const live = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(glam.canApply(thread, []).ok, true);
  assert.deepEqual(glam.canApply(post(10), []), { ok: false, why: 'this card lands on a thread' });
  assert.deepEqual(glam.canApply(thread, [{ card: 'feelin-glam', act: 'k1', reach: 'thread', ends: live }]), { ok: false, why: 'this thread already carries that card' });
  assert.equal(glam.canApply(thread, [{ card: 'feelin-glam', act: 'k1', reach: 'thread', ends: new Date(Date.now() - 1000).toISOString() }]).ok, true, 'one that has worn off is no longer in the way');
  assert.equal(glam.playPrice(settings, thread, {}, []), 0);
});
