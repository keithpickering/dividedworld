/**
 * Stick Around's own rules: its price, its release sentence and its lack of state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stickAround } from './stick-around.ts';
import { defaults as settings } from '../settings.ts';
import { post } from './test-kit.ts';

test('Stick Around costs nothing more to play', () => {
  assert.equal(stickAround.playPrice(settings, post(6000), { sentence: 'Read it.' }, []), 0);
});

test('Stick Around\'s release is the caster\'s own sentence, bounded, with the design\'s default', () => {
  assert.deepEqual(stickAround.validateConfig({}), { ok: true, value: { sentence: 'I legally certify that I have read this post in full and thought about it contemplatively' } });
  assert.deepEqual(stickAround.validateConfig({ sentence: '  I read it.  ' }), { ok: true, value: { sentence: 'I read it.' } });
  assert.equal(stickAround.validateConfig({ sentence: 'x'.repeat(201) }).ok, false);
  assert.equal(stickAround.validateConfig({ sentence: '   ' }).ok, false);
  assert.equal(stickAround.validateConfig({ sentence: 7 }).ok, false);
});

test('Stick Around holds no state to save', () => {
  assert.equal(stickAround.validateState, undefined);
});
