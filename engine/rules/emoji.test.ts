import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_PREFIX, emojiBase, emojiOfKey, localKey, localReaction, singleEmoji } from './emoji.ts';

const set = [{ emoji: '👍' }, { emoji: '❤️' }];
const samples = {
  skull: '💀',
  heart: '❤️',
  flag: '🇺🇸',
  keycap: '1️⃣',
  family: '👨‍👩‍👧‍👦',
  tonedHand: '👍🏽',
};

test('one emoji of every shape is accepted and round-trips through its key', () => {
  for (const [name, e] of Object.entries(samples)) {
    assert.equal(singleEmoji(e), e, name);
    assert.equal(singleEmoji(`  ${e}\n`), e, `${name} trimmed`);
    const key = localKey(e);
    assert.match(key, /^[a-z][a-z0-9-]*$/, `${name} key fits the key pattern`);
    assert.equal(key.startsWith(LOCAL_PREFIX), true, name);
    assert.equal(emojiOfKey(key), e, `${name} round-trips`);
  }
  assert.equal(localKey('💀'), 'x-1f480');
});

test('what is not exactly one emoji is refused, with its words', () => {
  for (const bad of ['ab', '💀💀', '️', '', '   ', 7, null, undefined, {}]) {
    assert.equal(singleEmoji(bad), null, String(bad));
  }
  assert.deepEqual(localReaction({ quadrant: 'excitedPositive' }, set), { ok: false, why: 'choose one emoji' });
  assert.deepEqual(localReaction({ emoji: 'ab', quadrant: 'excitedPositive' }, set), { ok: false, why: 'choose one emoji' });
  assert.deepEqual(localReaction({ emoji: '️', quadrant: 'excitedPositive' }, set), { ok: false, why: 'choose one emoji' });
  assert.deepEqual(localReaction('💀', set), { ok: false, why: 'choose one emoji' });
  assert.deepEqual(localReaction({ emoji: 7, quadrant: 'excitedPositive' }, set), { ok: false, why: 'choose one emoji' });
  assert.deepEqual(localReaction({ emoji: '💀💀', quadrant: 'excitedPositive' }, set), { ok: false, why: 'that is more than one emoji' });
});

test('a base that the instance already has is refused, however it is toned or presented', () => {
  assert.equal(emojiBase('❤'), emojiBase('❤️'));
  assert.equal(emojiBase('👍🏽'), '👍');
  assert.deepEqual(localReaction({ emoji: '👍🏽', quadrant: 'calmPositive' }, set), { ok: false, why: 'this forum already has that reaction' });
  assert.deepEqual(localReaction({ emoji: '❤️', quadrant: 'calmPositive' }, [{ emoji: '❤' }]), { ok: false, why: 'this forum already has that reaction' });
});

test('the quadrant must be one of the four, and a good configuration is returned checked', () => {
  assert.deepEqual(localReaction({ emoji: '💀' }, set), { ok: false, why: 'choose the quadrant it scores in' });
  assert.deepEqual(localReaction({ emoji: '💀', quadrant: 'nope' }, set), { ok: false, why: 'choose the quadrant it scores in' });
  assert.deepEqual(localReaction({ emoji: ' 💀 ', quadrant: 'boredNegative' }, set), { ok: true, value: { emoji: '💀', quadrant: 'boredNegative' } });
});

test('only a local key turns back into an emoji', () => {
  for (const k of ['like', 'x-', 'x-zz', 'x-1f480-', 'X-1f480', 'x-110000', '']) assert.equal(emojiOfKey(k), null, k);
});
