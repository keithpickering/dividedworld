import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instanceSeed } from './seed.ts';
import { chooseInstance, instance } from './instance.ts';

test('the seed carries every setting, class, reaction, card and board of the instance, in the shape seed_instance() reads', () => {
  const seed = instanceSeed(instance);
  assert.deepEqual(Object.keys(seed.settings).sort(), [...Object.keys(instance.settings), 'copy'].sort());
  assert.deepEqual(seed.settings.copy, instance.copy);
  assert.deepEqual(seed.settings.seasonLength, instance.settings.seasonLength);
  assert.deepEqual(seed.classes, instance.classes.map((c) => ({ key: c.key, name: c.name })));
  assert.deepEqual(seed.reactions, instance.reactions.map((r) => ({ key: r.key, emoji: r.emoji, quadrant: r.quadrant })));
  const readKeys = (c: (typeof instance.cards)[number]) => (c.reads ?? []).map((r) => (typeof r === 'string' ? r : r.key));
  assert.deepEqual(seed.cards, instance.cards.map((c) => ({ key: c.key, name: c.name, alignment: c.alignment, priceSetting: c.priceKey, stack: c.stack ?? 1, seeded: c.seeded === true, reads: readKeys(c) })));
  assert.deepEqual(seed.cards.find((c) => c.key === 'whoops'), {
    key: 'whoops', name: 'Whoops!', alignment: 'salty', priceSetting: 'whoops.price', stack: 3, seeded: true, reads: ['whoops.perLength', 'whoops.lengthStep', 'whoops.mostInAll'],
  }, 'the stack, the seed and the economy numbers its price reads reach the SQL (0039, screen_settings\'s cardEconomy)');
  assert.deepEqual(seed.boards, instance.boards.map((b) => ({ ...b, system: b.system === true })));
  assert.deepEqual(seed.boards.filter((b) => b.system).map((b) => b.slug), ['the-system'], 'one board is The System\'s, said in the seed');
  assert.deepEqual(seed.pipStyles, instance.pipStyles, 'the pip styles a profile may name');
  assert.equal(seed.classes.length, 5);
  assert.equal(seed.reactions.length, 16);
});

test('the deployed instance is chosen by profile: the playtest\'s shorter season, or the defaults', () => {
  assert.deepEqual(chooseInstance('playtest').settings.turnCooldown, { unit: 'day', count: 7 });
  assert.deepEqual(chooseInstance(undefined).settings.turnCooldown, { unit: 'day', count: 30 });
  assert.throws(() => chooseInstance('staging'), /profile/);
});
