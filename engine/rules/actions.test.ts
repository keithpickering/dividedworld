import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from './actions.ts';
import type { Instance } from './types.ts';

const splat = { key: 'splat', name: 'Splat', alignment: 'salty' as const, priceKey: 'splat.price', playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) };
const instance: Instance = {
  key: 'test-world', name: 'Test World', classes: [{ key: 'a', name: 'A', earn: () => [] }], cards: [splat],
  reactions: [{ key: 'fire', emoji: '🔥', quadrant: 'excitedPositive' }],
  settings: {
    walletCap: 600, vote: 10, halving: 0.5, reactionCap: 3, charactersPerPlayer: 6, settlementCron: '17 8 * * *', viewCountCron: '41 * * * *',
    settlementLength: { unit: 'day', count: 1 }, seasonLength: { unit: 'month', count: 3 }, turnCooldown: { unit: 'day', count: 30 }, registrationMode: 'invite',
    postMaxLength: 50, titleMaxLength: 10, economy: { 'splat.price': 100 },
  },
  ranks: [{ name: 'Rookie', from: 0 }], pipStyles: [{ key: 'default', name: 'Default', full: '●', empty: '○' }], boards: [{ slug: 'general', name: 'General', description: '' }],
  copy: { turnsThreadTitle: 'S{season} Turns', revealTitle: 'S{season} Reveal', revealBody: 'All.' },
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
  for (const blank of ['   ', '\n\t', '\u00a0', '\u200b\u200b', '\u3000\ufeff']) {
    assert.match(refusal({ action: 'post', thread: other, character: id, body: blank }) ?? '', /^body:.*empty/, JSON.stringify(blank));
  }
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

test('a card is bought at the Vending Machine\'s price, by the service, for the caller', () => {
  assert.deepEqual(decide({ action: 'buyCard', card: 'splat' }, instance), { ok: true, rpc: 'buy_card', args: { card: 'splat', price: 100 }, asService: true });
  assert.match(refusal({ action: 'buyCard', card: 'nothing' }) ?? '', /^card:/);
});

test('a play names the card, the character, the post and the caster\'s configuration; its price waits on the post', () => {
  assert.deepEqual(decide({ action: 'playCard', card: 'splat', character: id, target: other, config: { color: 'red' } }, instance),
    { ok: true, rpc: 'play_card', args: { card: 'splat', through: id, target: other, config: { color: 'red' }, message: '' }, asService: true, needsTarget: true });
  assert.equal((decide({ action: 'playCard', card: 'splat', character: id, target: other, message: 'Take that.' }, instance) as unknown as { args: { message: unknown } }).args.message, 'Take that.', 'the caster\'s message travels to the card\'s rules');
  assert.match(refusal({ action: 'playCard', card: 'nothing', character: id, target: other }) ?? '', /^card:/);
  assert.match(refusal({ action: 'playCard', card: 'splat', character: id, target: 'x' }) ?? '', /^target:/);
});

test('saving an effect\'s state names the play, the character and the state', () => {
  assert.deepEqual(decide({ action: 'saveEffect', play: other, character: id, state: { strokes: [] } }, instance),
    { ok: true, rpc: 'save_effect_state', args: { through: id, on_play: other, state: { strokes: [] } }, asService: true, needsCardOfPlay: true });
  assert.match(refusal({ action: 'saveEffect', play: other, character: id }) ?? '', /^state:/);
});

test('a Turn names the character, a class the instance has, and how loud it is', () => {
  assert.deepEqual(decide({ action: 'turn', character: id, class: 'a', loudness: 'silent' }, instance),
    { ok: true, rpc: 'turn', args: { through: id, to_class: 'a', loudness: 'silent' } });
  assert.match(refusal({ action: 'turn', character: id, class: 'ghost', loudness: 'silent' }) ?? '', /^class:/);
  assert.match(refusal({ action: 'turn', character: id, class: 'a', loudness: 'whispered' }) ?? '', /^loudness:/);
});

test('a waiting Turn is withdrawn by naming its character', () => {
  assert.deepEqual(decide({ action: 'withdrawTurn', character: id }, instance), { ok: true, rpc: 'withdraw_turn', args: { through: id } });
  assert.match(refusal({ action: 'withdrawTurn' }) ?? '', /^character:/);
});

test('a character is made with a name and one of the instance\'s classes; invites are made, sent again and spent', () => {
  assert.deepEqual(decide({ action: 'createCharacter', name: 'Masked One', class: 'a' }, instance),
    { ok: true, rpc: 'create_character', args: { name: 'Masked One', class: 'a' } });
  assert.match(refusal({ action: 'createCharacter', name: 'Masked One', class: 'z' }) ?? '', /^class:/);
  assert.match(refusal({ action: 'createCharacter', name: ' \u200b ', class: 'a' }) ?? '', /^name: is empty/);
  assert.match(refusal({ action: 'createCharacter', name: 'n'.repeat(41), class: 'a' }) ?? '', /^name: is longer than 40/);
  assert.deepEqual(decide({ action: 'createInvite' }, instance), { ok: true, rpc: 'create_invite', args: {} });
  assert.deepEqual(decide({ action: 'reissueInvite', invite: 7 }, instance), { ok: true, rpc: 'reissue_invite', args: { invite: 7 } });
  assert.match(refusal({ action: 'reissueInvite', invite: '7' }) ?? '', /^invite:/);
  assert.match(refusal({ action: 'reissueInvite', invite: 1.5 }) ?? '', /^invite:/);
  assert.deepEqual(decide({ action: 'openAccount', invite: 'abc' }, instance), { ok: true, rpc: 'open_account', args: { code: 'abc' } });
  assert.deepEqual(decide({ action: 'openAccount' }, instance), { ok: true, rpc: 'open_account', args: { code: null } });
  assert.match(refusal({ action: 'openAccount', invite: 'x'.repeat(200) }) ?? '', /^invite:/);
  assert.match(refusal({ action: 'openAccount', invite: 7 }) ?? '', /^invite:/);
  // Trimmed as the database trims it, and held to the same hidden characters.
  assert.deepEqual(decide({ action: 'createCharacter', name: ` ${'n'.repeat(40)}  `, class: 'a' }, instance),
    { ok: true, rpc: 'create_character', args: { name: 'n'.repeat(40), class: 'a' } });
  for (const name of ['Mas\u200bk', 'Mask\u00a01', 'Mask  1', 'Mask\u202e1', 'Mask\t1', 'Mask\ufeff1', 'Mask\u3164', 'Mask\u{e0041}', 'Mask\u2800', 'Mask\u{1d173}']) {
    assert.match(refusal({ action: 'createCharacter', name, class: 'a' }) ?? '', /^name: can hold/, JSON.stringify(name));
  }
});
