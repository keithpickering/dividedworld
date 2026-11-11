import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instance } from '../index.ts';
import { defaults } from '../settings.ts';
import { sameName } from '../../../engine/rules/names.ts';
import { repairMemory } from '../../../engine/system/memory.ts';
import { rehearsal } from './index.ts';
import { interestWords } from '../../../engine/rehearsal/generate.ts';
import { wheelhouse } from '../system/wheelhouse.ts';

const { corpus, scenarios } = rehearsal;
const classKeys = new Set(instance.classes.map((c) => c.key));
const playBoards = instance.boards.filter((b) => !b.system).map((b) => b.slug);

test('there are about thirty sketches, with unique keys', () => {
  assert.ok(corpus.sketches.length >= 28 && corpus.sketches.length <= 34, `${corpus.sketches.length} sketches`);
  assert.equal(new Set(corpus.sketches.map((s) => s.key)).size, corpus.sketches.length);
});

test('every sketch has a class of the instance, three to five interests from the wheelhouse, and sane post bounds', () => {
  for (const s of corpus.sketches) {
    assert.ok(classKeys.has(s.classKey), `${s.key}: class ${s.classKey}`);
    assert.ok(s.interests.length >= 3 && s.interests.length <= 5, `${s.key}: interests`);
    assert.ok(s.voice.trim() !== '', `${s.key}: voice`);
    for (const i of s.interests) assert.ok(wheelhouse.includes(i), `${s.key}: "${i}" is not in the wheelhouse`);
    assert.ok(s.postsPerDay.least >= 0 && s.postsPerDay.most >= s.postsPerDay.least && s.postsPerDay.most <= 6, `${s.key}: postsPerDay`);
  }
});

test('every feud names another sketch', () => {
  const keys = new Set(corpus.sketches.map((s) => s.key));
  for (const s of corpus.sketches) for (const f of s.feuds) {
    assert.ok(keys.has(f), `${s.key} feuds with ${f}`);
    assert.notEqual(f, s.key);
  }
  assert.ok(corpus.sketches.some((s) => s.feuds.length > 0));
});

test('every name passes the instance\'s name rules: 1 to 40 characters and not the same name as another', () => {
  const names = corpus.sketches.map((s) => s.name);
  for (const n of names) assert.ok(n.length >= 1 && n.length <= 40 && n === n.trim(), n);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) assert.ok(!sameName(names[i]!, names[j]!), `${names[i]} and ${names[j]}`);
});

test('openers are for non-System boards of the instance, five to ten for each, and fit the limits', () => {
  for (const b of Object.keys(corpus.openers)) assert.ok(playBoards.includes(b), `board ${b}`);
  for (const b of playBoards) {
    const list = corpus.openers[b] ?? [];
    assert.ok(list.length >= 5 && list.length <= 10, `${b}: ${list.length} openers`);
    for (const o of list) {
      assert.ok(o.title.trim() !== '' && o.title.length <= defaults.titleMaxLength, o.title);
      assert.ok(o.body.trim() !== '' && o.body.length <= defaults.postMaxLength, o.title);
    }
  }
});

test('there are about sixty reply lines, twenty agreeing and twenty disagreeing, each short and within the limit', () => {
  assert.equal(corpus.agreeing.length, 20);
  assert.equal(corpus.disagreeing.length, 20);
  assert.ok(corpus.replies.length >= 55 && corpus.replies.length <= 65, `${corpus.replies.length} replies`);
  for (const line of [...corpus.replies, ...corpus.agreeing, ...corpus.disagreeing]) {
    assert.ok(line.trim() !== '' && line.length <= 200 && line.length <= defaults.postMaxLength, line);
    for (const slot of line.matchAll(/\{([^}]*)\}/g)) assert.ok(['name', 'interest', 'board'].includes(slot[1]!), `slot ${slot[0]} in ${line}`);
  }
});

test('scenario keys are unique and the three are shipped', () => {
  const keys = scenarios.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual([...keys].sort(), ['meltdown-handover', 'season-opening', 'small-circle-reign']);
  const reign = scenarios.find((s) => s.key === 'small-circle-reign')!;
  assert.deepEqual([reign.players, reign.startThreads, reign.backstoryDays, reign.dayOfSeason, reign.days, reign.costCapDollars], [8, 6, 3, 30, 7, 5]);
  assert.deepEqual(reign.charactersPerPlayer, { least: 2, most: 3 });
  const opening = scenarios.find((s) => s.key === 'season-opening')!;
  assert.deepEqual([opening.dayOfSeason, opening.backstoryDays, opening.bossMemory], [1, 2, undefined]);
});

test('the meltdown scenario puts day 1 eight days before the end of a ninety-day season', () => {
  const m = scenarios.find((s) => s.key === 'meltdown-handover')!;
  assert.equal(defaults.seasonLength.unit, 'month');
  assert.equal(defaults.seasonLength.count, 3);
  assert.equal(90 + 1 - m.dayOfSeason, 8);
});

test('every scenario\'s starting memory passes repairMemory with no trim', () => {
  const caps = defaults;
  for (const s of scenarios) {
    if (!s.bossMemory) continue;
    const r = repairMemory(JSON.parse(JSON.stringify(s.bossMemory)), () => true, caps);
    assert.ok(r.ok, s.key);
    assert.deepEqual(r.trims, [], s.key);
  }
  assert.ok(scenarios.some((s) => (s.bossMemory?.grudges.length ?? 0) > 0 && s.bossMemory?.hobby.name));
});

test('a starting memory names only characters of the corpus', () => {
  const names = new Set(corpus.sketches.map((s) => s.name));
  for (const s of scenarios) for (const g of [...(s.bossMemory?.grudges ?? []), ...(s.bossMemory?.opinions ?? [])]) assert.ok(names.has(g.character), `${s.key}: ${g.character}`);
});

test('each sketch\'s interests weigh at least one opener title, by the generator\'s word match', () => {
  const titles = Object.values(corpus.openers).flat().map((o) => o.title.toLowerCase());
  for (const s of corpus.sketches) assert.ok(s.interests.some((i) => interestWords(i).some((w) => titles.some((t) => t.includes(w)))), `${s.key} matches no opener`);
});

test('every {interest} line reads as a sentence with each wheelhouse phrase: the phrase is never the subject', () => {
  const lines = [...corpus.replies, ...corpus.agreeing, ...corpus.disagreeing].filter((l) => l.includes('{interest}'));
  assert.ok(lines.length >= 8);
  for (const l of lines) assert.ok(/(about|of|to|for|with|in) \{interest\}/.test(l), l);
});

test('each scenario\'s cast fits the sketches and the instance\'s characters per player', () => {
  for (const s of scenarios) {
    assert.ok(s.players * s.charactersPerPlayer.most <= corpus.sketches.length, `${s.key}: ${s.players * s.charactersPerPlayer.most} characters, ${corpus.sketches.length} sketches`);
    assert.ok(s.charactersPerPlayer.most <= defaults.charactersPerPlayer, s.key);
  }
});
