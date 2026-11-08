import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONDITION_KINDS, earnedGroup, groupsProblems } from './groups.ts';
import type { GroupsContent, Rung } from './groups.ts';

const ladder: readonly Rung[] = [
  { key: 'base', name: 'Base', color: '#777777', when: { kind: 'default' } },
  { key: 'posty', name: 'Posty', color: '#2f6fb0', when: { kind: 'posts', atLeast: 100 } },
  { key: 'old', name: 'Old', color: '#9c6b30', when: { kind: 'seasons', atLeast: 2 } },
  { key: 'crew', name: 'Crew', color: '#d4a017', when: { kind: 'staff' } },
];
const good: GroupsContent = { ladder, conferred: [{ key: 'trial', name: 'Trial', color: '#d2691e', stripe: true, tone: 'punishment' }] };

test('the earned group is the highest rung whose condition holds', () => {
  const table: [string, { posts: number; seasons: number; staff: boolean }, string][] = [
    ['no posts', { posts: 0, seasons: 0, staff: false }, 'base'],
    ['99 posts', { posts: 99, seasons: 0, staff: false }, 'base'],
    ['100 posts', { posts: 100, seasons: 0, staff: false }, 'posty'],
    ['5 posts and 2 seasons', { posts: 5, seasons: 2, staff: false }, 'old'],
    ['100 posts and 2 seasons: the higher rung wins', { posts: 100, seasons: 2, staff: false }, 'old'],
    ['staff with no posts', { posts: 0, seasons: 0, staff: true }, 'crew'],
  ];
  for (const [name, facts, want] of table) assert.equal(earnedGroup(ladder, facts), want, name);
});

test('the condition kinds are the four SQL has a case for', () => {
  assert.deepEqual([...CONDITION_KINDS], ['default', 'posts', 'seasons', 'staff']);
});

test('whole content has no problems', () => assert.deepEqual(groupsProblems(good), []));

test('a badge of 1 to 32 characters, or none, is whole', () => {
  assert.deepEqual(groupsProblems({ ...good, ladder: [{ ...ladder[0]!, badge: 'x'.repeat(32) }, ...ladder.slice(1)] }), []);
  assert.deepEqual(groupsProblems({ ...good, ladder: [{ ...ladder[0]!, badge: 'x' }, ...ladder.slice(1)] }), []);
});

test('each poison is named in words', () => {
  const [base, posty, old, crew] = ladder;
  const poisons: [string, GroupsContent, RegExp][] = [
    ['no default rung', { ...good, ladder: [posty!, old!, crew!] }, /default/],
    ['default not first', { ...good, ladder: [posty!, base!, old!, crew!] }, /default.*first/],
    ['two staff rungs', { ...good, ladder: [base!, crew!, { ...crew!, key: 'crew2' }] }, /2 staff rungs/],
    ['staff not last', { ...good, ladder: [base!, crew!, posty!] }, /staff.*last/],
    ['a duplicate key', { ...good, conferred: [{ key: 'old', name: 'X', color: '#111111', tone: 'favor' }] }, /key "old".*twice/],
    ['a short color', { ...good, ladder: [{ ...base!, color: '#fff' }, posty!, old!, crew!] }, /color.*#fff/],
    ['a 33-character name', { ...good, ladder: [{ ...base!, name: 'x'.repeat(33) }, posty!, old!, crew!] }, /name of 33 characters/],
    ['a 33-character badge', { ...good, ladder: [{ ...base!, badge: 'x'.repeat(33) }, posty!, old!, crew!] }, /group "base" has a badge of 33 characters/],
    ['an empty badge', { ...good, conferred: [{ key: 'trial', name: 'Trial', badge: '', color: '#d2691e', tone: 'punishment' }] }, /group "trial" has a badge of 0 characters/],
    ['an unknown condition kind', { ...good, ladder: [base!, { ...posty!, when: { kind: 'sparkly' } as never }, old!, crew!] }, /condition kind "sparkly"/],
    ['a fractional atLeast', { ...good, ladder: [base!, { ...posty!, when: { kind: 'posts', atLeast: 1.5 } }, old!, crew!] }, /atLeast 1.5/],
    ['an empty ladder', { ...good, ladder: [] }, /0 default rungs/],
    ['a bad name on a conferred group', { ...good, conferred: [{ key: 'trial', name: '', color: '#d2691e', tone: 'punishment' }] }, /group "trial" has a name of 0 characters/],
    ['an empty key', { ...good, conferred: [{ key: '', name: 'Blank', color: '#d2691e', tone: 'favor' }] }, /empty key/],
    ['a tone outside the two', { ...good, conferred: [{ key: 'odd', name: 'Odd', color: '#d2691e', tone: 'reward' } as never] }, /tone "reward"/],
    ['a missing when', { ...good, ladder: [base!, { ...posty!, when: undefined } as never, old!, crew!] }, /rung "posty" has no condition/],
    ['a zero atLeast', { ...good, ladder: [base!, { ...posty!, when: { kind: 'posts', atLeast: 0 } }, old!, crew!] }, /atLeast/],
  ];
  for (const [name, content, re] of poisons) assert.match(groupsProblems(content).join('\n'), re, name);
});

test('earnedGroup refuses a rung whose kind it has no case for, naming it', () => {
  const odd = [ladder[0]!, { ...ladder[1]!, when: { kind: 'sparkly' } as never }];
  assert.throws(() => earnedGroup(odd, { posts: 0, seasons: 0, staff: false }), /sparkly/);
});
