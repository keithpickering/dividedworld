import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointAt, rewindConfig, rewindPoints, type Version } from './rewind.ts';

const MIN = 60_000;
const T0 = Date.parse('2026-11-21T12:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();
const grace = { unit: 'minute', count: 2 } as const;
const post: Version = { id: 'post', at: at(0) };
const edit = (id: string, ms: number): Version => ({ id, at: at(ms) });
const now = new Date(T0 + 60 * MIN);
const playOf = (id: string, ms: number) => ({ id, at: at(ms) });

test('pointAt: the post gives its time plus the grace; an edit inside the grace gives none, an edit past it gives its own time', () => {
  assert.equal(pointAt(post, post, grace), at(2 * MIN));
  assert.equal(pointAt(post, edit('e', 2 * MIN - 1000), grace), null, 'one second inside the grace');
  assert.equal(pointAt(post, edit('e', 2 * MIN + 1000), grace), at(2 * MIN + 1000), 'one second past it');
  assert.equal(pointAt(post, post, { unit: 'minute', count: 0 } as never), at(0), 'a grace of zero');
  assert.equal(pointAt(post, edit('e', 1000), { unit: 'minute', count: 0 } as never), at(1000), 'a grace of zero leaves every edit a point');
});

test('rewindPoints: a point is offered only where showing it would change the post', () => {
  const all = () => true;
  assert.deepEqual(rewindPoints(post, [], [], grace, now, all), [], 'a post never edited, with no plays');
  assert.deepEqual(rewindPoints(post, [edit('e1', MIN)], [], grace, now, all), [], 'edited once, inside the grace only');
  assert.deepEqual(rewindPoints(post, [edit('e1', 10 * MIN)], [], grace, now, all), [{ version: 'post', at: at(2 * MIN), first: true }], 'edited past the grace');
  assert.deepEqual(
    rewindPoints(post, [edit('e1', 10 * MIN)], [playOf('w', 20 * MIN)], grace, now, all),
    [{ version: 'post', at: at(2 * MIN), first: true }, { version: 'e1', at: at(10 * MIN), first: false }],
    'a play after the last edit and still showing offers the last edit as well, oldest first',
  );
  assert.deepEqual(rewindPoints(post, [edit('e1', 10 * MIN)], [playOf('w', 20 * MIN)], grace, now, () => false), [{ version: 'post', at: at(2 * MIN), first: true }], 'the same play ended offers nothing from it');
  assert.deepEqual(rewindPoints(post, [], [playOf('w', 20 * MIN)], grace, now, all), [{ version: 'post', at: at(2 * MIN), first: true }], 'a play still showing on an unedited post offers the first point');
  assert.deepEqual(rewindPoints(post, [], [playOf('w', 20 * MIN)], grace, now, () => false), [], 'the same play ended, on an unedited post');
  assert.deepEqual(rewindPoints(post, [], [playOf('w', 2 * MIN)], grace, now, all), [], 'a play at exactly the point is not later than it');
  assert.deepEqual(rewindPoints(post, [], [playOf('w', MIN)], grace, now, all), [], 'a play inside the grace is part of the first point');
});

test('rewindPoints: edits are taken in time order whatever order they come in, and an edit inside the grace is never a point', () => {
  const edits = [edit('late', 30 * MIN), edit('early', 10 * MIN), edit('inside', MIN)];
  assert.deepEqual(rewindPoints(post, edits, [], grace, now, () => true).map((p) => p.version), ['post', 'early']);
});

test('rewindConfig: a non-empty string `to`, in the card\'s own words otherwise', () => {
  assert.deepEqual(rewindConfig({ to: 'abc' }), { ok: true, value: { to: 'abc' } });
  for (const v of [undefined, null, {}, { to: '' }, { to: 3 }, 'abc', []]) assert.deepEqual(rewindConfig(v), { ok: false, why: "pick a point from this post's History" });
});

test('pointAt: an unparsable time gives no point, for the post and for an edit', () => {
  assert.equal(pointAt({ id: 'post', at: 'garbage' }, { id: 'post', at: 'garbage' }, grace), null);
  assert.equal(pointAt(post, edit('e', 0), grace) === null, true);
  assert.equal(pointAt(post, { id: 'e', at: 'garbage' }, grace), null);
});
