import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAREER_MOST, careerText, type Career } from './career.ts';

// A persona that led Season 2, was a Mod Bot under the next Boss, and led Season 5.
const SERVED: Career = {
  led: [
    { season: 2, from: '2026-02-01T00:00:00+00:00', until: '2026-03-29T00:00:00+00:00', how: 'rotation' },
    { season: 5, from: '2026-06-07T00:00:00+00:00', until: null, how: 'nomination' },
  ],
  offices: [{ office: 'mod', from: '2026-03-29T00:00:00+00:00', until: '2026-06-07T00:00:00+00:00', cause: 'handover' }],
};
const NEVER: Career = { led: [], offices: [] };

test('a persona that led two seasons and was a mod between them reads as plain sentences, newest first', () => {
  const lines = careerText(SERVED, { 5: 'Season Five' });
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /^Boss in Season Five, from 2026-06-07 until now/u);
  assert.match(lines[0]!, /named by the Boss before it/u);
  assert.match(lines[1]!, /^Mod Bot from 2026-03-29 to 2026-06-07/u);
  assert.match(lines[1]!, /at a handover/u);
  assert.match(lines[2]!, /^Boss in Season 2, from 2026-02-01 to 2026-03-29 \(8 weeks\)/u);
  assert.match(lines[2]!, /by rotation/u);
});

test('a member that never served has no career', () => {
  assert.deepEqual(careerText(NEVER), []);
});

test('thirteen entries are cut to the newest twelve and "and 1 more" says so', () => {
  const offices = Array.from({ length: 13 }, (_, i) => ({
    office: i % 2 ? 'mod' : 'member', from: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00+00:00`,
    until: `2026-01-${String(i + 2).padStart(2, '0')}T00:00:00+00:00`, cause: 'admin',
  }));
  const lines = careerText({ led: [], offices });
  assert.equal(CAREER_MOST, 12);
  assert.equal(lines.length, CAREER_MOST + 1);
  assert.match(lines[0]!, /2026-01-13/u);
  assert.equal(lines.at(-1), 'and 1 more.');
  assert.ok(!lines.some((l) => l.includes('from 2026-01-01 ')), 'the oldest entry is the one cut');
  assert.equal(careerText({ led: [], offices: offices.slice(0, 12) }).length, 12, 'twelve are not cut');
});

test('poison: one persona\'s career never holds a season another persona led', () => {
  // Two personas as the database returns them: the careers are keyed by who is asked, so a season is in exactly one.
  const careers: Record<string, Career> = {
    'of-ann': { led: [{ season: 1, from: '2026-01-01T00:00:00+00:00', until: '2026-02-01T00:00:00+00:00', how: 'seed' }], offices: [] },
    'of-bob': { led: [{ season: 2, from: '2026-02-01T00:00:00+00:00', until: null, how: 'rotation' }], offices: [] },
  };
  const ann = careerText(careers['of-ann']!).join('\n');
  const bob = careerText(careers['of-bob']!).join('\n');
  assert.match(ann, /Season 1\b/u);
  assert.doesNotMatch(ann, /Season 2\b/u);
  assert.match(bob, /Season 2\b/u);
  assert.doesNotMatch(bob, /Season 1\b/u);
});
