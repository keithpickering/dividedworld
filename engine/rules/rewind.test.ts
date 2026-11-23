import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointAt, rewindConfig, rewindPoints, rewindPointProblem, REWIND_PICK, REWIND_IN_GRACE, REWIND_SAME, type Version } from './rewind.ts';

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

test('the three point sentences, in the words the server says them in', () => {
  assert.equal(REWIND_PICK, "pick a point from this post's History");
  assert.equal(REWIND_IN_GRACE, 'that version was saved in the edit grace window, so it is part of the post as first posted');
  assert.equal(REWIND_SAME, 'this post shows the same at that point as it does now');
  const none = rewindConfig({});
  assert.deepEqual(none, { ok: false, why: REWIND_PICK }, 'rewindConfig says the first');
});

test('rewindPointProblem: no point, a version that is not the post\'s, a version in the grace, a point that shows the same, and null for an offered one, in that order', () => {
  const all = () => true;
  const edits = [edit('e1', 10 * MIN)];
  const problem = (to: unknown, e = edits, plays: { id: string; at: string }[] = [], t = now) => rewindPointProblem(to, post, e, plays, grace, t, all);
  assert.equal(problem(undefined), REWIND_PICK);
  assert.equal(problem(7), REWIND_PICK);
  assert.equal(problem(''), REWIND_PICK);
  assert.equal(problem('someone-else'), REWIND_PICK, 'a version of another post');
  assert.equal(problem('e0', [edit('e0', MIN)]), REWIND_IN_GRACE, 'an edit saved inside the grace');
  assert.equal(problem('e1', edits), REWIND_SAME, 'the newest version, with no play after it');
  assert.equal(problem('post', []), REWIND_SAME, 'a post never edited');
  assert.equal(problem('post'), null, 'the first version of an edited post');
  assert.equal(problem('e1', edits, [playOf('w', 20 * MIN)]), null, 'a play after the point still showing');
  assert.equal(rewindPointProblem('e1', post, edits, [playOf('w', 20 * MIN)], grace, now, () => false), REWIND_SAME, 'a play that no longer shows');
  assert.equal(problem('post', edits, [], new Date(T0 + MIN)), REWIND_SAME, 'a point that has not come yet');
  assert.equal(problem('e0', [edit('e0', MIN), edit('e1', 10 * MIN)]), REWIND_IN_GRACE, 'the grace is said before the same');
});
