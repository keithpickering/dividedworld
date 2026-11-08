import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupsProblems } from '../../engine/rules/groups.ts';
import { groups } from './groups.ts';

test("every Divided World group has a singular badge, and the plural name stays", () => {
  assert.deepEqual([...groups.ladder, ...groups.conferred].map((g) => g.badge), ['Member', 'Regular', 'Old Guard', 'Personality Core', 'Trial Member', "Teacher's Pet", 'Hall Monitor']);
  assert.equal(groups.ladder[1]!.name, 'Regulars');
});

test("Divided World's groups pass the engine's checks", () => {
  assert.deepEqual(groupsProblems(groups), []);
});
