import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instanceSeed } from './seed.ts';
import { chooseInstance, conduct, instance } from './instance.ts';
import { MOVE_KINDS } from '../../../engine/system/moves.ts';
import { BBCODE_TAGS } from '../../../engine/bbcode/parse.ts';
import { PREDICATES } from '../../../engine/rules/predicates.ts';
import { DEMAND_KINDS } from '../../../engine/system/demands.ts';
import { PRONOUN_PRESETS } from '../../../engine/rules/pronouns.ts';
import type { Persona } from '../../../engine/rules/types.ts';
import { PHASE_CAPS } from '../../../engine/system/phases.ts';

test('the seed carries every setting, class, reaction, card and board of the instance, in the shape seed_instance() reads', () => {
  const seed = instanceSeed(instance, conduct);
  assert.deepEqual(Object.keys(seed.settings).sort(), [...Object.keys(instance.settings), 'copy', 'systemLines', 'systemMoveWords', 'conductVersion', 'conductSections'].sort());
  assert.equal(seed.settings.conductVersion, conduct.version, 'the version an account must have accepted (0340)');
  assert.deepEqual(seed.settings.conductSections, conduct.sections.map((c) => c.key), 'the sections a report may name, by key (0340)');
  assert.deepEqual(seed.settings.conduct, instance.settings.conduct, 'the open-report limit and the admin address ride with the instance\'s settings');
  assert.deepEqual(seed.settings.systemLines, instance.system.stockLines, 'the tick (0048) fills these lines in SQL');
  assert.deepEqual(seed.settings.systemMoveWords, Object.fromEntries(MOVE_KINDS.map((m) => [m.key, m.plain])), '{move}, in plain words, by kind');
  assert.equal(seed.system.announcementsTitle, instance.system.announcementsTitle, 'the thread where moves land is made from the seed');
  assert.deepEqual(seed.settings.copy, instance.copy);
  assert.deepEqual(seed.settings.seasonLength, instance.settings.seasonLength);
  assert.deepEqual(seed.classes, instance.classes.map((c) => ({ key: c.key, name: c.name })));
  assert.deepEqual(seed.reactions, instance.reactions.map((r) => ({ key: r.key, emoji: r.emoji, quadrant: r.quadrant })));
  const readKeys = (c: (typeof instance.cards)[number]) => (c.reads ?? []).map((r) => (typeof r === 'string' ? r : r.key));
  assert.deepEqual(seed.cards, instance.cards.map((c) => ({
    key: c.key, name: c.name, alignment: c.alignment, stack: c.stack ?? 1, seeded: c.seeded === true, reads: readKeys(c),
    rarity: c.rarity, play: c.play ?? 'cast', trap: c.trap, gimmick: c.gimmick, lasts: c.lasts, skim: c.skim, scoresAs: c.scoresAs, reaches: c.reaches ?? ['post'], pins: c.pins === true, writes: c.writes !== undefined,
    draws: c.draws, drive: c.drive, needsMessage: c.needsMessage, surface: c.surface !== undefined,
  })));
  assert.deepEqual(seed.cards.filter((c) => c.surface).map((c) => c.key), instance.cards.filter((c) => c.surface !== undefined).map((c) => c.key), 'the SQL knows which cards hold a wall by this flag alone');
  assert.ok(seed.cards.some((c) => c.surface), 'a surface card is flagged');
  assert.deepEqual(seed.cards.find((c) => c.key === 'whoops'), {
    key: 'whoops', name: 'Whoops!', alignment: 'salty', stack: 3, seeded: true, reads: ['whoops.perLength', 'whoops.lengthStep', 'whoops.mostAdded'],
    rarity: 'common', play: 'cast', trap: undefined, gimmick: undefined, lasts: undefined, skim: undefined, scoresAs: undefined, reaches: ['post'], pins: false, writes: false, draws: undefined, drive: undefined, needsMessage: undefined, surface: false,
  }, 'the stack, the seed, the economy numbers its rules read, its rarity and its play reach the SQL (0039, screen_settings\'s cardEconomy; 0054)');
  // The packs and the machine's slots (0139): the pulls as the instance writes them, a slot's item flattened to `card` or `pack`, in grid order.
  assert.deepEqual(seed.packs.map((p) => [p.key, p.pulls.length, p.leaves]), instance.packs.map((p) => [p.key, p.pulls.length, [...(p.leaves ?? [])]]));
  assert.deepEqual(seed.packs[0]!.pulls[4], { weights: { uncommon: 74, rare: 24, legendary: 2 } }, 'the hit pull reaches the SQL as written');
  assert.deepEqual(seed.machine.map((m) => ('card' in m ? m.card : m.pack)), instance.machine.map((m) => ('card' in m.item ? m.item.card : m.item.pack)));
  assert.deepEqual(seed.machine.find((m) => 'pack' in m), { pack: 'booster', availability: 'onSale', price: 300 });
  assert.deepEqual(seed.machine.find((m) => 'card' in m && m.card === 'main-event'), { card: 'main-event', availability: 'hidden', price: 300 });
  assert.deepEqual(seed.boards, instance.boards.map((b) => ({ ...b, system: b.system === true })));
  assert.deepEqual(seed.boards.filter((b) => b.system).map((b) => b.slug), ['announcements'], 'one board is The System\'s, said in the seed');
  assert.deepEqual(seed.pipStyles, instance.pipStyles, 'the pip styles a profile may name');
  assert.equal(seed.classes.length, instance.classes.length);
  assert.equal(seed.reactions.length, 16);
});

test('the seed carries the groups: the ladder with its rung indexes and conditions, then the conferred groups with their tones (0128)', () => {
  const { groups } = instanceSeed(instance, conduct);
  const ladder = groups.filter((g) => g.source === 'ladder');
  assert.deepEqual(ladder.map((g) => [g.key, 'rung' in g ? g.rung : null, 'condition' in g ? g.condition : null]),
    instance.groups.ladder.map((r, i) => [r.key, i, r.when.kind]), 'lowest first, each rung numbered by its place');
  assert.deepEqual(groups.find((g) => g.key === 'regulars'), { key: 'regulars', name: 'Regulars', badge: 'Regular', color: '#2f6fb0', stripe: false, source: 'ladder', rung: 1, condition: 'posts', atLeast: 100 });
  assert.deepEqual(groups.find((g) => g.key === 'trialMembers'), { key: 'trialMembers', name: 'Trial Members', badge: 'Trial Member', color: '#d2691e', stripe: true, source: 'conferred', tone: 'punishment' });
  assert.equal(groups.length, instance.groups.ladder.length + instance.groups.conferred.length);
});

test('the seed carries the roster as staff characters, one kind of persona, the first staff named, and no prompt', () => {
  const seed = instanceSeed(instance, conduct);
  const { roster, firstStaff } = instance.system;
  assert.deepEqual(seed.system.staff.map((s) => s.key), roster.map((p) => p.key));
  assert.equal('staffGroup' in seed.system, false, 'the staff rung is a group of the ladder (seed.groups), not a setting');
  assert.deepEqual(seed.system.firstStaff, [...firstStaff]);
  assert.equal(seed.system.firstBoss, instance.system.firstBoss, 'the first season\'s Boss');
  for (const s of seed.system.staff) {
    const p = roster.find((r) => r.key === s.key)!;
    assert.deepEqual(Object.keys(s).sort(), (p.weakness.kind === 'quiz' ? ['arc', 'beats', 'challenge', 'holdsBack', 'key', 'name', 'phaseDays', 'pronouns', 'quiz', 'signature', 'title', 'visitHours'] : ['arc', 'beats', 'challenge', 'holdsBack', 'key', 'name', 'phaseDays', 'pronouns', 'signature', 'title', 'visitHours']));
    assert.deepEqual((s as { pronouns?: unknown }).pronouns, p.pronouns, 'a persona\'s pronouns travel on its roster entry');
    assert.deepEqual(s.beats, [...p.beats], 'the beat preferences travel, for beat_of (0103)');
    // A quiz persona's questions travel as a list of their own, beside the challenge (never in it), for seed_instance to keep where no client can read them (0108).
    if (p.weakness.kind === 'quiz') assert.deepEqual((s as { quiz?: unknown }).quiz, p.weakness.questions.map((q) => ({ question: q.question, choices: [...q.choices], answer: q.answer })), 'a quiz persona\'s questions and answers travel');
    assert.deepEqual(s.visitHours, p.strictness.visitHours, 'the persona\'s visit hours travel, for start_visit (0105)');
    assert.equal(s.challenge.kind, p.weakness.kind);
    assert.ok(!JSON.stringify(s.challenge).includes('answer') && !('questions' in s.challenge && typeof s.challenge.questions !== 'number'), 'a challenge carries a count, never a question or an answer');
    if (p.weakness.kind === 'quiz') assert.equal(s.challenge.questions, p.weakness.questions.length, 'a quiz carries how many questions it has');
    assert.ok(s.title.length <= 40 && s.signature.length <= 500, 'the SQL cuts these in silence; instanceProblems holds them');
  }
  const bytes = JSON.stringify(seed);
  for (const b of roster) assert.ok(!bytes.includes(b.selfPrompt.slice(0, 80)), `${b.key}'s prompt stays in the instance module`);
});

test('a roster entry carries pronouns only when its persona declares them, and the developer when he does', () => {
  const [first, second] = instance.system.roster;
  const { pronouns: _dropped, ...undeclared } = second!;
  const seed = instanceSeed({
    ...instance,
    system: { ...instance.system, roster: [{ ...first!, pronouns: PRONOUN_PRESETS.she }, undeclared as unknown as Persona, ...instance.system.roster.slice(2)] },
  }, conduct);
  const [a, b] = seed.system.staff as { pronouns?: unknown }[];
  assert.deepEqual(a!.pronouns, PRONOUN_PRESETS.she, 'she/her travels on the entry that declares it');
  assert.ok(!('pronouns' in b!), 'an entry whose persona names none carries no key, so the instance default applies in SQL');
  assert.ok(!('pronouns' in instanceSeed({ ...instance, developer: { name: 'Dev', tagline: 'Hi.' } }, conduct).developer), 'a developer who names none carries none');
});

test('the seed carries the engine\'s catalogs of moves (with whether each is structural, shapes a board, and which offices make it, and the tokens SQL derives for its words) and demands', () => {
  const { moves, demands } = instanceSeed(instance, conduct).system;
  assert.deepEqual(moves, MOVE_KINDS.map((m) => ({ key: m.key, structural: m.structural, shapesBoard: m.shapesBoard, lasting: m.lasting, offices: m.offices, derived: m.derived ?? [] })));
  assert.deepEqual(moves, [
    { key: 'renameBoard', structural: true, shapesBoard: true, lasting: false, offices: ['boss'], derived: [] },
    { key: 'nameSuccessor', structural: true, shapesBoard: false, lasting: false, offices: ['boss'], derived: [] },
    { key: 'setRule', structural: false, shapesBoard: false, lasting: false, offices: ['boss', 'mod'], derived: [] },
    { key: 'conferGroup', structural: false, shapesBoard: false, lasting: false, offices: ['boss', 'mod'], derived: ['groupName'] },
    { key: 'pullSlot', structural: false, shapesBoard: false, lasting: false, offices: ['boss'], derived: [] },
    { key: 'repriceSlot', structural: false, shapesBoard: false, lasting: false, offices: ['boss'], derived: [] },
    { key: 'flashSale', structural: false, shapesBoard: false, lasting: false, offices: ['boss'], derived: [] },
    { key: 'awardTrophy', structural: false, shapesBoard: false, lasting: false, offices: ['boss'], derived: ['trophyName', 'characterName'] },
    { key: 'createBoard', structural: true, shapesBoard: true, lasting: true, offices: ['boss'], derived: [] },
    { key: 'moveThread', structural: false, shapesBoard: false, lasting: true, offices: ['boss'], derived: [] },
    { key: 'mergeBoard', structural: true, shapesBoard: true, lasting: true, offices: ['boss'], derived: [] },
  ]);
  assert.deepEqual(demands.map((d) => d.key), DEMAND_KINDS.map((d) => d.key));
  assert.ok(demands.length >= 5);
});

test('the seed carries the rule predicates, each with its parameter kind, its bounds and its words as a template', () => {
  const { predicates } = instanceSeed(instance, conduct).system;
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

test('a card\'s trap (and its match), gimmick and time up travel in the seed as the engine holds them, and an absent one is absent in the JSON', () => {
  const trap = { trigger: { on: 'cast' as const }, match: { flavors: ['salty' as const], upTo: 'uncommon' as const } };
  const set = { ...instance.cards[0]!, key: 'test-trap', play: 'set' as const, rarity: 'uncommon' as const, trap };
  const gimmick = { kind: 'ward' as const, upTo: 'uncommon' as const, flavors: ['salty' as const] };
  const ward = { ...instance.cards[0]!, key: 'test-ward', play: 'use' as const, rarity: 'uncommon' as const, gimmick, lasts: { unit: 'day' as const, count: 7 } };
  const seed = instanceSeed({ ...instance, cards: [set, ward] }, conduct);
  assert.deepEqual(JSON.parse(JSON.stringify(seed.cards[0])).trap, trap, 'a trap carries its match');
  assert.equal('lasts' in JSON.parse(JSON.stringify(seed.cards[0])), false, 'seed_instance reads a missing time up as none');
  assert.equal('gimmick' in JSON.parse(JSON.stringify(seed.cards[0])), false, 'seed_instance reads a missing gimmick as none');
  assert.equal('ward' in JSON.parse(JSON.stringify(seed.cards[1])), false, 'the ward flag is gone from the seed');
  assert.deepEqual([seed.cards[1]!.play, seed.cards[1]!.gimmick, seed.cards[1]!.lasts], ['use', gimmick, { unit: 'day', count: 7 }]);
});

test('a card\'s skim, its scored-as flag and a trap\'s outcome travel in the seed, and an absent one is absent in the JSON', () => {
  const skim = { ...instance.cards[0]!, key: 'test-skim', skim: { share: 0.1 }, lasts: { unit: 'week' as const, count: 1 } };
  const named = { ...instance.cards[0]!, key: 'test-named', reaches: ['character' as const], scoresAs: true as const };
  const trap = { trigger: { on: 'cast' as const }, outcome: { kind: 'ride' as const, share: 1 } };
  const ride = { ...instance.cards[0]!, key: 'test-ride', play: 'set' as const, trap };
  const sent = JSON.parse(JSON.stringify(instanceSeed({ ...instance, cards: [skim, named, ride] }, conduct).cards));
  assert.deepEqual([sent[0].skim, 'scoresAs' in sent[0]], [{ share: 0.1 }, false], 'seed_instance reads a missing scored-as flag as false');
  assert.deepEqual([sent[1].scoresAs, 'skim' in sent[1]], [true, false], 'and a missing skim as none');
  assert.deepEqual(sent[2].trap, trap, 'a trap carries its outcome');
});

test('the seed carries the developer persona: the instance\'s, or the engine\'s plain default, and no prompt (a model never writes it)', () => {
  assert.deepEqual(instanceSeed(instance, conduct).developer, { name: 'Gabe', title: 'Made this. Sorry.', avatar: 'gabe', pronouns: PRONOUN_PRESETS.he }, 'Divided World\'s is Gabe, with his tagline as the profile title');
  assert.deepEqual(instanceSeed({ ...instance, developer: undefined }, conduct).developer, { name: 'The developers', title: '' }, 'an instance with no persona gets the engine\'s plain one, with no avatar key');
  assert.deepEqual(instanceSeed({ ...instance, developer: { name: 'Dev', tagline: 'Hi.' } }, conduct).developer, { name: 'Dev', title: 'Hi.' });
  assert.ok(!instanceSeed(instance, conduct).system.staff.some((s) => s.key === 'developer'), 'the developer is not in the roster a model is handed');
  assert.ok(!('developer' in instanceSeed(instance, conduct).system), 'nothing under `system`, which is all the Director reads, names the developer');
});

test('the seed carries the conditions and each persona\'s arc as SQL checks it: keys, conditions, due points, held-back kinds and phase days, never a brief or a template (0332)', () => {
  const first = instance.system.roster[0]!;
  const arced: Persona = {
    ...first,
    phases: { honeymoon: { days: 5 } },
    arc: [{ key: 'one', unlock: [{ kind: 'phase', phase: 'reign' }], due: { phase: 'reign', daysIntoPhase: 7 }, brief: 'A secret.', bundle: { name: 'B', parts: [{ role: 'r', kind: 'createBoard', params: {} }] } }],
    miniArcs: [{ key: 'two', unlock: [{ kind: 'moveReversed' }], brief: 'Another.', repeatable: true }],
    holdsBack: [{ kind: 'createBoard', until: 'one' }],
  };
  const seed = instanceSeed({ ...instance, system: { ...instance.system, roster: [arced, ...instance.system.roster.slice(1)] } }, conduct);
  assert.deepEqual(seed.system.conditions.map((c) => c.key), ['phase', 'beatLanded', 'boardActivity', 'moveReversed', 'demandResolved']);
  const p = seed.system.staff[0]!;
  assert.deepEqual(p.arc, [
    { key: 'one', mini: false, repeatable: false, unlock: [{ kind: 'phase', phase: 'reign' }], due: { phase: 'reign', daysIntoPhase: 7 } },
    { key: 'two', mini: true, repeatable: true, unlock: [{ kind: 'moveReversed' }], due: null },
  ]);
  assert.deepEqual(p.holdsBack, [{ kind: 'createBoard', until: 'one' }]);
  assert.deepEqual(p.phaseDays, { honeymoon: 5 });
  assert.ok(!JSON.stringify(p).includes('A secret') && !JSON.stringify(p).includes('Another'), 'a brief travelled in the seed');
  assert.deepEqual(seed.system.staff[1]!.arc, [], 'a persona with no arc has none');
  assert.equal(seed.system.staff[0]!.beats.length, first.beats.length, 'the patrol beats are as they were');
});

test('a persona\'s phase days are seeded as phaseAt reads them: whole, from 1 to the engine\'s cap (0333)', () => {
  const first = instance.system.roster[0]!;
  const days = (h: number, m: number) => instanceSeed({ ...instance, system: { ...instance.system, roster: [{ ...first, phases: { honeymoon: { days: h }, meltdown: { days: m } } }, ...instance.system.roster.slice(1)] } }, conduct).system.staff[0]!.phaseDays;
  assert.deepEqual(days(2.5, 500), { honeymoon: 2, meltdown: PHASE_CAPS.meltdown.days });
  assert.deepEqual(days(0, -3), { honeymoon: 1, meltdown: 1 });
  assert.deepEqual(days(PHASE_CAPS.honeymoon.days, 7), { honeymoon: PHASE_CAPS.honeymoon.days, meltdown: 7 });
  assert.equal(PHASE_CAPS.honeymoon.days, 42, 'SQL\'s arc_season_span cuts at 42 too');
  assert.equal(PHASE_CAPS.meltdown.days, 42, 'SQL\'s arc_season_span cuts at 42 too');
});

test('the seed carries the trophy catalog: the kinds with their words and belts, the three places, the Boss\'s kinds and the met demand\'s (0206)', () => {
  const { trophies } = instanceSeed(instance, conduct);
  assert.deepEqual(trophies.kinds.map((k) => k.key), instance.trophies.kinds.map((k) => k.key));
  assert.deepEqual(trophies.kinds.filter((k) => k.belt).map((k) => k.key), instance.trophies.kinds.filter((k) => k.belt).map((k) => k.key), 'a belt is said as a belt');
  for (const k of trophies.kinds) assert.equal(typeof k.belt, 'boolean');
  assert.deepEqual(trophies.seasonPlaces, [...instance.trophies.seasonPlaces]);
  assert.deepEqual(trophies.boss, [...instance.trophies.boss]);
  assert.equal(trophies.demandMet, instance.trophies.demandMet);
  assert.ok(trophies.kinds.every((k) => !k.key.startsWith('made-')), 'an instance key never begins with the admin page\'s prefix');
});

test('the seed carries the instance\'s Random Event lines, each with its key, outcome and text (0207)', () => {
  const { eventLines } = instanceSeed(instance, conduct);
  assert.ok(eventLines.length > 0, 'the instance has event lines');
  assert.deepEqual(eventLines.map((l) => [l.key, l.outcome, l.text]), instance.events.lines.map((l) => [l.key, l.outcome, l.text]));
  assert.ok(['line', 'gear', 'card'].every((o) => eventLines.some((l) => l.outcome === o)), 'every outcome has a line to say');
});
