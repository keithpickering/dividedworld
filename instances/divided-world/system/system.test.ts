import { test } from 'node:test';
import assert from 'node:assert/strict';
import { system } from './index.ts';
import { BOSS_PREMISE } from './persona.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import { instance } from '../index.ts';
import { PHASE_CAPS } from '../../../engine/system/phases.ts';
import { STOCK_LINE_KEYS } from '../../../engine/system/stock.ts';

test('Divided World\'s System content raises no problem', () => {
  assert.deepEqual(instanceProblems(instance).filter((p) => /Boss|bot|Bot|duty|stock|firstStaff|system/.test(p)), []);
});

test('three placeholder Bosses, each marked as one in its name and title', () => {
  assert.equal(system.bosses.length, 3);
  for (const b of system.bosses) {
    assert.match(b.name, /placeholder/i, b.key);
    assert.match(b.title, /placeholder/i, b.key);
    assert.match(b.key, /^placeholder-/, b.key);
  }
  assert.ok(system.bosses.some((b) => b.key === system.firstBoss));
});

test('the Bosses contrast: different temperaments, hobbies and prompts, all on the shared premise', () => {
  for (const field of ['temperament', 'startingHobby', 'persona', 'signature', 'name'] as const) {
    assert.equal(new Set(system.bosses.map((b) => b[field])).size, 3, field);
  }
  for (const b of system.bosses) {
    assert.ok(b.persona.includes(BOSS_PREMISE), `${b.key} is built on the premise`);
    assert.ok(b.persona.includes(b.name), b.key);
  }
});

test('one Boss overrides its phases inside the caps, and none inherits a memory', () => {
  const overriding = system.bosses.filter((b) => b.phases !== undefined);
  assert.equal(overriding.length, 1);
  assert.ok((overriding[0]!.phases!.honeymoon!.weeklyMoves ?? 0) <= PHASE_CAPS.honeymoon.weeklyMoves);
  assert.ok(system.bosses.every((b) => b.inheritsMemoryOf === undefined));
});

test('the premise holds the design\'s hard facts: it cannot know who is behind a mask, it never takes a side, it reads only the digest', () => {
  assert.match(BOSS_PREMISE, /robo-McMahon/);
  assert.match(BOSS_PREMISE, /toybox/);
  assert.match(BOSS_PREMISE, /action figures/);
  assert.match(BOSS_PREMISE, /do not know, and can never find out, who is behind any mask/);
  assert.match(BOSS_PREMISE, /lands on a mask, never on a person/);
  assert.match(BOSS_PREMISE, /do not take a side/);
  assert.match(BOSS_PREMISE, /only the digest of public play/);
  assert.match(BOSS_PREMISE, /never acted on/);
});

test('one placeholder Mod Bot is on staff at the start', () => {
  assert.equal(system.modBots.length, 1);
  assert.match(system.modBots[0]!.name, /placeholder/i);
  assert.deepEqual(system.firstStaff, [system.modBots[0]!.key]);
});

test('every standing order has a stock line', () => {
  for (const k of STOCK_LINE_KEYS) assert.ok(system.stockLines[k].length >= 1, k);
});

test('feeds are plain https addresses, and the lists are the content the plan names', () => {
  for (const f of system.feeds) assert.match(f.url, /^https:\/\//);
  assert.ok(system.realWorld.length > 0 && system.wheelhouse.length > 0);
  assert.ok(system.wheelhouse.some((w) => /Mario/.test(w)));
});

test('the content is frozen, so no caller edits the roster in place', () => {
  assert.ok(Object.isFrozen(system) && Object.isFrozen(system.bosses) && Object.isFrozen(system.bosses[0]));
});
