import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeholderBosses } from './index.ts';
import { fangame } from '../personas/fangame.ts';
import { placeholderMonitor } from '../personas/placeholder-monitor.ts';
import { instance } from '../../index.ts';
import { instanceProblems } from '../../../../engine/rules/instance.ts';
import { PHASE_CAPS } from '../../../../engine/system/phases.ts';

test('the three placeholder Bosses keep their keys and their "(placeholder)" names', () => {
  assert.deepEqual(placeholderBosses.map((b) => b.key), ['placeholder-clerk', 'placeholder-hype-man', 'placeholder-sighbot']);
  for (const b of placeholderBosses) {
    assert.match(b.name, /\(placeholder\)/, b.key);
    assert.match(b.title, /placeholder/i, b.key);
  }
  assert.equal(new Set(placeholderBosses.map((b) => b.name)).size, 3);
});

test('one placeholder Boss overrides its phases inside the caps, and none inherits a memory', () => {
  const overriding = placeholderBosses.filter((b) => b.phases !== undefined);
  assert.equal(overriding.length, 1);
  assert.ok((overriding[0]!.phases!.honeymoon!.weeklyMoves ?? 0) <= PHASE_CAPS.honeymoon.weeklyMoves);
  assert.ok(placeholderBosses.every((b) => b.inheritsMemoryOf === undefined));
});

test('the fixtures and FanGaME together pass instanceProblems when set as a roster', () => {
  const roster = [fangame, ...placeholderBosses, placeholderMonitor];
  assert.deepEqual(instanceProblems({ ...instance, system: { ...instance.system, roster } }), []);
});

test('the fixtures keep their temperament sentences about confidence', () => {
  const [clerk, hype] = placeholderBosses;
  assert.match(clerk!.selfPrompt, /You are confident in procedure, if in nothing else\./);
  assert.match(hype!.selfPrompt, /You are supremely confident\./);
});
