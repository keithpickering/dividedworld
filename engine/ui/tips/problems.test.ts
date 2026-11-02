/** `instanceUiProblems`, driven red on a poisoned instance: a missing tip key, an extra one, a blank title or line, and no letter. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { instanceUiProblems } from './problems.ts';
import { TIP_KEYS } from './keys.ts';
import type { OnboardingUi } from '../types.ts';

const tips = () => Object.fromEntries(TIP_KEYS.map((k) => [k, { title: `T ${k}`, line: `L ${k}` }])) as unknown as Record<string, { title: string; line: string }>;
const ui = (onboarding: unknown) => ({ onboarding: onboarding as OnboardingUi });

describe('instanceUiProblems', () => {
  test('passes an instance that fills every tip exactly', () => {
    assert.deepEqual(instanceUiProblems(ui({ tips: tips(), letter: 'Hi.' })), []);
  });
  test('refuses a tip key that is missing, naming it', () => {
    const t = tips();
    delete t['grid'];
    assert.deepEqual(instanceUiProblems(ui({ tips: t, letter: 'Hi.' })), ['the onboarding has no tip "grid"']);
  });
  test('refuses a tip key the engine does not have, naming it', () => {
    const problems = instanceUiProblems(ui({ tips: { ...tips(), 'made-up': { title: 'x', line: 'y' } }, letter: 'Hi.' }));
    assert.deepEqual(problems, ['the onboarding has a tip "made-up", which is not one of the engine\'s tips']);
  });
  test('refuses a tip with a blank title or line', () => {
    const problems = instanceUiProblems(ui({ tips: { ...tips(), ghost: { title: ' ', line: '' } }, letter: 'Hi.' }));
    assert.deepEqual(problems, ['the tip "ghost" has no title', 'the tip "ghost" has no line']);
  });
  test('refuses an instance with no letter, and one with no onboarding at all', () => {
    assert.deepEqual(instanceUiProblems(ui({ tips: tips(), letter: '' })), ['the onboarding has no letter']);
    assert.deepEqual(instanceUiProblems(ui(undefined)), ['the instance UI has no onboarding']);
  });
});
