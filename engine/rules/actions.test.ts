import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from './actions.ts';
import type { Instance } from './types.ts';

const instance: Instance = {
  key: 'test-world', name: 'Test World', classes: [{ key: 'a', name: 'A', earn: () => [] }], cards: [],
  reactions: [{ key: 'fire', emoji: '🔥', quadrant: 'excitedPositive' }],
  settings: {
    walletCap: 600, vote: 10, halving: 0.5, reactionCap: 3, charactersPerPlayer: 6, settlementCron: '17 8 * * *',
    seasonLength: { unit: 'month', count: 3 }, turnCooldown: { unit: 'day', count: 30 }, registrationMode: 'invite',
    postMaxLength: 50, titleMaxLength: 10,
  },
  boards: [{ slug: 'general', name: 'General', description: '' }],
};
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const refusal = (request: unknown) => { const d = decide(request, instance); return d.ok ? null : `${d.field}: ${d.why}`; };

test('each action is decided into the SQL function that writes it, with that function\'s arguments', () => {
  assert.deepEqual(decide({ action: 'startThread', board: 'general', character: id, title: 'Hello', body: 'First.' }, instance),
    { ok: true, rpc: 'start_thread', args: { board_slug: 'general', through: id, title: 'Hello', body: 'First.' } });
  assert.deepEqual(decide({ action: 'post', thread: other, character: id, body: 'Reply.' }, instance),
    { ok: true, rpc: 'post', args: { in_thread: other, through: id, body: 'Reply.', quoting: null } });
  assert.deepEqual(decide({ action: 'post', thread: other, character: id, body: 'Reply.', quote: other }, instance),
    { ok: true, rpc: 'post', args: { in_thread: other, through: id, body: 'Reply.', quoting: other } });
  assert.deepEqual(decide({ action: 'edit', post: other, character: id, body: 'Fixed.' }, instance),
    { ok: true, rpc: 'edit_post', args: { target: other, through: id, body: 'Fixed.' } });
  assert.deepEqual(decide({ action: 'spin', origin: other, character: id, title: 'Spun', body: '' }, instance),
    { ok: true, rpc: 'spin', args: { origin: other, through: id, title: 'Spun', body: '' } });
  assert.deepEqual(decide({ action: 'react', act: other, character: id, kind: 'fire' }, instance),
    { ok: true, rpc: 'react', args: { target: other, through: id, reaction: 'fire' } });
});

test('a request that is not one of the actions is refused', () => {
  assert.match(refusal({ action: 'delete', act: other }) ?? '', /^action:/);
  assert.match(refusal(null) ?? '', /^action:/);
  assert.match(refusal('post') ?? '', /^action:/);
});

test('ids that are not ids are refused, by the field they were given in', () => {
  assert.match(refusal({ action: 'post', thread: 'nope', character: id, body: 'x' }) ?? '', /^thread:/);
  assert.match(refusal({ action: 'post', thread: other, character: 7, body: 'x' }) ?? '', /^character:/);
  assert.match(refusal({ action: 'post', thread: other, character: id, body: 'x', quote: 'q' }) ?? '', /^quote:/);
});

test('a post\'s text is something, and no longer than the instance allows, counted in characters', () => {
  assert.match(refusal({ action: 'post', thread: other, character: id, body: '   ' }) ?? '', /^body:.*empty/);
  assert.match(refusal({ action: 'post', thread: other, character: id, body: 'x'.repeat(51) }) ?? '', /^body:.*50/);
  assert.equal(refusal({ action: 'post', thread: other, character: id, body: 'x'.repeat(50) }), null);
  // Fifty emoji are fifty characters, though a hundred UTF-16 units: SQL's char_length counts the same way.
  assert.equal(refusal({ action: 'post', thread: other, character: id, body: '🔥'.repeat(50) }), null);
  assert.match(refusal({ action: 'edit', post: other, character: id, body: '' }) ?? '', /^body:/);
  assert.match(refusal({ action: 'post', thread: other, character: id, body: 7 }) ?? '', /^body:/);
});

test('a title is something, and no longer than the instance allows', () => {
  assert.match(refusal({ action: 'startThread', board: 'general', character: id, title: ' ', body: 'x' }) ?? '', /^title:/);
  assert.match(refusal({ action: 'spin', origin: other, character: id, title: 'x'.repeat(11) }) ?? '', /^title:.*10/);
  assert.match(refusal({ action: 'startThread', board: 'Not A Slug', character: id, title: 'x', body: 'x' }) ?? '', /^board:/);
});

test('a spin\'s own words may be empty, and are bounded like a post\'s', () => {
  assert.equal(refusal({ action: 'spin', origin: other, character: id, title: 'Spun' }), null);
  assert.match(refusal({ action: 'spin', origin: other, character: id, title: 'Spun', body: 'x'.repeat(51) }) ?? '', /^body:/);
});

test('a reaction the instance does not have is refused', () => {
  assert.match(refusal({ action: 'react', act: other, character: id, kind: 'shrug' }) ?? '', /^kind:.*shrug/);
});
