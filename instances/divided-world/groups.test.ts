import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupsProblems } from '../../engine/rules/groups.ts';
import { groups } from './groups.ts';

test("Divided World's groups pass the engine's checks", () => {
  assert.deepEqual(groupsProblems(groups), []);
});
