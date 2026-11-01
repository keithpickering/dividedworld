import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instanceSeed } from './seed.ts';
import { chooseInstance, instance } from './instance.ts';
import { MOVE_KINDS } from '../../../engine/system/moves.ts';
import { DEMAND_KINDS } from '../../../engine/system/demands.ts';

test('the seed carries every setting, class, reaction, card and board of the instance, in the shape seed_instance() reads', () => {
  const seed = instanceSeed(instance);
  assert.deepEqual(Object.keys(seed.settings).sort(), [...Object.keys(instance.settings), 'copy', 'systemLines', 'systemMoveWords'].sort());
  assert.deepEqual(seed.settings.systemLines, instance.system.stockLines, 'the tick (0048) fills these lines in SQL');
  assert.deepEqual(seed.settings.systemMoveWords, Object.fromEntries(MOVE_KINDS.map((m) => [m.key, m.plain])), '{move}, in plain words, by kind');
  assert.equal(seed.system.announcementsTitle, instance.system.announcementsTitle, 'the thread where moves land is made from the seed');
  assert.deepEqual(seed.settings.copy, instance.copy);
  assert.deepEqual(seed.settings.seasonLength, instance.settings.seasonLength);
  assert.deepEqual(seed.classes, instance.classes.map((c) => ({ key: c.key, name: c.name })));
  assert.deepEqual(seed.reactions, instance.reactions.map((r) => ({ key: r.key, emoji: r.emoji, quadrant: r.quadrant })));
  const readKeys = (c: (typeof instance.cards)[number]) => (c.reads ?? []).map((r) => (typeof r === 'string' ? r : r.key));
  assert.deepEqual(seed.cards, instance.cards.map((c) => ({
    key: c.key, name: c.name, alignment: c.alignment, priceSetting: c.priceKey, stack: c.stack ?? 1, seeded: c.seeded === true, reads: readKeys(c),
    rarity: c.rarity, play: c.play ?? 'cast', trap: c.trap, ward: c.ward === true, lasts: c.lasts, reaches: c.reaches ?? ['post'], pins: c.pins === true,
  })));
  assert.deepEqual(seed.cards.find((c) => c.key === 'whoops'), {
    key: 'whoops', name: 'Whoops!', alignment: 'salty', priceSetting: 'whoops.price', stack: 3, seeded: true, reads: ['whoops.perLength', 'whoops.lengthStep', 'whoops.mostInAll'],
    rarity: 'common', play: 'cast', trap: undefined, ward: false, lasts: undefined, reaches: ['post'], pins: false,
  }, 'the stack, the seed, the economy numbers its price reads, its rarity and its play reach the SQL (0039, screen_settings\'s cardEconomy; 0054)');
  assert.deepEqual(seed.boards, instance.boards.map((b) => ({ ...b, system: b.system === true })));
  assert.deepEqual(seed.boards.filter((b) => b.system).map((b) => b.slug), ['the-system'], 'one board is The System\'s, said in the seed');
  assert.deepEqual(seed.pipStyles, instance.pipStyles, 'the pip styles a profile may name');
  assert.equal(seed.classes.length, 5);
  assert.equal(seed.reactions.length, 16);
});

test('the seed carries the roster as staff characters, Bosses and bots, and the bots on staff at first, and no prompt', () => {
  const seed = instanceSeed(instance);
  const { bosses, modBots, firstStaff } = instance.system;
  assert.deepEqual(seed.system.staff.filter((s) => s.kind === 'boss').map((s) => s.key), bosses.map((b) => b.key));
  assert.deepEqual(seed.system.staff.filter((s) => s.kind === 'bot').map((s) => s.key), modBots.map((b) => b.key));
  assert.equal(seed.system.staff.length, bosses.length + modBots.length);
  assert.deepEqual(seed.system.firstStaff, [...firstStaff]);
  assert.equal(seed.system.firstBoss, instance.system.firstBoss, 'the first season\'s Boss');
  for (const s of seed.system.staff) {
    assert.deepEqual(Object.keys(s).sort(), ['key', 'kind', 'name', 'signature', 'title']);
    assert.ok(s.title.length <= 40 && s.signature.length <= 500, 'the SQL cuts these in silence; instanceProblems holds them');
  }
  const bytes = JSON.stringify(seed);
  for (const b of [...bosses, ...modBots]) assert.ok(!bytes.includes(b.persona.slice(0, 80)), `${b.key}'s prompt stays in the instance module`);
});

test('the seed carries the engine\'s catalogs of moves (with whether each is structural and shapes a board) and demands', () => {
  const { moves, demands } = instanceSeed(instance).system;
  assert.deepEqual(moves, MOVE_KINDS.map((m) => ({ key: m.key, structural: m.structural, shapesBoard: m.shapesBoard })));
  assert.deepEqual(moves, [{ key: 'renameBoard', structural: true, shapesBoard: true }, { key: 'nameSuccessor', structural: true, shapesBoard: false }]);
  assert.deepEqual(demands.map((d) => d.key), DEMAND_KINDS.map((d) => d.key));
  assert.ok(demands.length >= 5);
});

test('the deployed instance is chosen by profile: the playtest\'s shorter season, or the defaults', () => {
  assert.deepEqual(chooseInstance('playtest').settings.turnCooldown, { unit: 'day', count: 7 });
  assert.deepEqual(chooseInstance(undefined).settings.turnCooldown, { unit: 'day', count: 30 });
  assert.throws(() => chooseInstance('staging'), /profile/);
});

test('a card\'s trap, ward and time up travel in the seed as the engine holds them, and an absent one is absent in the JSON', () => {
  const trap = { trigger: { on: 'cast' as const }, outcome: { do: 'payout' as const } };
  const set = { ...instance.cards[0]!, key: 'test-trap', play: 'set' as const, rarity: 'uncommon' as const, trap };
  const ward = { ...instance.cards[0]!, key: 'test-ward', play: 'use' as const, rarity: 'uncommon' as const, ward: true as const, lasts: { unit: 'day' as const, count: 7 } };
  const seed = instanceSeed({ ...instance, cards: [set, ward] });
  assert.deepEqual(JSON.parse(JSON.stringify(seed.cards[0])).trap, trap);
  assert.equal('lasts' in JSON.parse(JSON.stringify(seed.cards[0])), false, 'seed_instance reads a missing time up as none');
  assert.deepEqual([seed.cards[1]!.play, seed.cards[1]!.ward, seed.cards[1]!.lasts], ['use', true, { unit: 'day', count: 7 }]);
});
