import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instanceSeed } from './seed.ts';
import { chooseInstance, instance } from './instance.ts';
import { MOVE_KINDS } from '../../../engine/system/moves.ts';
import { BBCODE_TAGS } from '../../../engine/bbcode/parse.ts';
import { PREDICATES } from '../../../engine/rules/predicates.ts';
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

test('the seed carries the roster as staff characters, one kind of persona, the first staff named, and no prompt', () => {
  const seed = instanceSeed(instance);
  const { roster, firstStaff, staffGroup } = instance.system;
  assert.deepEqual(seed.system.staff.map((s) => s.key), roster.map((p) => p.key));
  assert.deepEqual(seed.system.staffGroup, { name: staffGroup.name });
  assert.deepEqual(seed.system.firstStaff, [...firstStaff]);
  assert.equal(seed.system.firstBoss, instance.system.firstBoss, 'the first season\'s Boss');
  for (const s of seed.system.staff) {
    assert.deepEqual(Object.keys(s).sort(), ['beats', 'challenge', 'key', 'name', 'signature', 'title', 'visitHours']);
    assert.deepEqual(s.beats, [...roster.find((p) => p.key === s.key)!.beats], 'the beat preferences travel, for beat_of (0101)');
    const p = roster.find((r) => r.key === s.key)!;
    assert.deepEqual(s.visitHours, p.strictness.visitHours, 'the persona\'s visit hours travel, for start_visit (0103)');
    assert.equal(s.challenge.kind, p.weakness.kind);
    assert.ok(!JSON.stringify(s.challenge).includes('answer') && !('questions' in s.challenge && typeof s.challenge.questions !== 'number'), 'a challenge carries a count, never a question or an answer');
    if (p.weakness.kind === 'quiz') assert.equal(s.challenge.questions, p.weakness.questions.length, 'a quiz carries how many questions it has');
    assert.ok(s.title.length <= 40 && s.signature.length <= 500, 'the SQL cuts these in silence; instanceProblems holds them');
  }
  const bytes = JSON.stringify(seed);
  for (const b of roster) assert.ok(!bytes.includes(b.persona.slice(0, 80)), `${b.key}'s prompt stays in the instance module`);
});

test('the seed carries the engine\'s catalogs of moves (with whether each is structural, shapes a board, and which offices make it) and demands', () => {
  const { moves, demands } = instanceSeed(instance).system;
  assert.deepEqual(moves, MOVE_KINDS.map((m) => ({ key: m.key, structural: m.structural, shapesBoard: m.shapesBoard, offices: m.offices })));
  assert.deepEqual(moves, [
    { key: 'renameBoard', structural: true, shapesBoard: true, offices: ['boss'] },
    { key: 'nameSuccessor', structural: true, shapesBoard: false, offices: ['boss'] },
    { key: 'setRule', structural: false, shapesBoard: false, offices: ['boss', 'mod'] },
  ]);
  assert.deepEqual(demands.map((d) => d.key), DEMAND_KINDS.map((d) => d.key));
  assert.ok(demands.length >= 5);
});

test('the seed carries the rule predicates, each with its parameter kind, its bounds and its words as a template', () => {
  const { predicates } = instanceSeed(instance).system;
  assert.deepEqual(predicates.map((p) => p.key), PREDICATES.map((p) => p.key));
  const by = Object.fromEntries(predicates.map((p) => [p.key, p]));
  assert.deepEqual(by['minLength'], { key: 'minLength', param: 'count', least: 1, most: 200, plain: 'posts of at least {param} characters' });
  assert.deepEqual(by['noDoublePost'], { key: 'noDoublePost', param: 'none', least: null, most: null, plain: 'no double posting' });
  assert.deepEqual(by['bannedWord'], { key: 'bannedWord', param: 'word', least: 1, most: 40, plain: 'the word "{param}" is banned' });
  assert.equal(by['noTag']!.param, 'tag');
  assert.deepEqual((by['noTag'] as { tags?: string[] }).tags, [...BBCODE_TAGS], 'the tags a rule may name are the parser\'s');
  assert.ok(predicates.filter((p) => p.key !== 'noTag').every((p) => !('tags' in p)));
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

test('the seed carries the developer persona: the instance\'s, or the engine\'s plain default, and no prompt (a model never writes it)', () => {
  assert.deepEqual(instanceSeed(instance).developer, { name: 'Gabe', title: 'Made this. Sorry.', avatar: 'gabe' }, 'Divided World\'s is Gabe, with his tagline as the profile title');
  assert.deepEqual(instanceSeed({ ...instance, developer: undefined }).developer, { name: 'The developers', title: '' }, 'an instance with no persona gets the engine\'s plain one, with no avatar key');
  assert.deepEqual(instanceSeed({ ...instance, developer: { name: 'Dev', tagline: 'Hi.' } }).developer, { name: 'Dev', title: 'Hi.' });
  assert.ok(!instanceSeed(instance).system.staff.some((s) => s.key === 'developer'), 'the developer is not in the roster a model is handed');
  assert.ok(!('developer' in instanceSeed(instance).system), 'nothing under `system`, which is all the Director reads, names the developer');
});
