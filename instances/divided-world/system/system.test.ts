import { test } from 'node:test';
import assert from 'node:assert/strict';
import { system } from './index.ts';
import { BOSS_PREMISE, MOD_BOT_PREMISE, BOSS_ANSWER_RULES, MOD_BOT_ANSWER_RULES, persona } from './persona.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import { instance } from '../index.ts';
import { PHASE_CAPS } from '../../../engine/system/phases.ts';
import { STOCK_LINE_KEYS, STOCK_LINE_TOKENS } from '../../../engine/system/stock.ts';

test('Divided World\'s System content raises no problem', () => {
  assert.deepEqual(instanceProblems(instance).filter((p) => /Boss|bot|Bot|duty|stock|firstStaff|system/.test(p)), []);
});

const bosses = system.roster.filter((p) => !system.firstStaff.includes(p.key));

test('three placeholder Bosses, each marked as one in its name and title', () => {
  assert.equal(bosses.length, 3);
  for (const b of bosses) {
    assert.match(b.name, /placeholder/i, b.key);
    assert.match(b.title, /placeholder/i, b.key);
    assert.match(b.key, /^placeholder-/, b.key);
  }
  assert.ok(bosses.some((b) => b.key === system.firstBoss));
});

test('the Bosses contrast: different temperaments, hobbies and prompts, all on the shared premise', () => {
  for (const field of ['temperament', 'startingHobby', 'persona', 'signature', 'name'] as const) {
    assert.equal(new Set(bosses.map((b) => b[field])).size, 3, field);
  }
  for (const b of bosses) {
    assert.ok(b.persona.includes(BOSS_PREMISE), `${b.key} is built on the premise`);
    assert.ok(b.persona.includes(b.name), b.key);
  }
});

test('one Boss overrides its phases inside the caps, and none inherits a memory', () => {
  const overriding = bosses.filter((b) => b.phases !== undefined);
  assert.equal(overriding.length, 1);
  assert.ok((overriding[0]!.phases!.honeymoon!.weeklyMoves ?? 0) <= PHASE_CAPS.honeymoon.weeklyMoves);
  assert.ok(bosses.every((b) => b.inheritsMemoryOf === undefined));
});

test('the premise holds the design\'s hard facts: it cannot know who is behind a mask, it never takes a side, it reads only the digest', () => {
  assert.match(BOSS_PREMISE, /robo-McMahon/);
  assert.match(BOSS_PREMISE, /toybox/);
  assert.match(BOSS_PREMISE, /action figures/);
  assert.match(BOSS_PREMISE, /do not know, and can never find out, who is behind any mask/);
  assert.match(BOSS_PREMISE, /lands on a mask, never on a person/);
  assert.match(BOSS_PREMISE, /do not take a side/);
  assert.match(BOSS_PREMISE, /only the digest of public play/);
  assert.match(BOSS_PREMISE, /never acted on/);
});

test('one placeholder Mod Bot is on staff at the start', () => {
  const bots = system.roster.filter((p) => system.firstStaff.includes(p.key));
  assert.equal(bots.length, 1);
  assert.match(bots[0]!.name, /placeholder/i);
  assert.deepEqual(system.firstStaff, [bots[0]!.key]);
});

test('every standing order has a stock line', () => {
  for (const k of STOCK_LINE_KEYS) assert.ok(system.stockLines[k].length >= 1, k);
});

test('feeds are plain https addresses, and the lists are the content the plan names', () => {
  for (const f of system.feeds) assert.match(f.url, /^https:\/\//);
  assert.ok(system.realWorld.length > 0 && system.wheelhouse.length > 0);
  assert.ok(system.wheelhouse.some((w) => /Mario/.test(w)));
});

test('the content is frozen, so no caller edits the roster in place', () => {
  assert.ok(Object.isFrozen(system) && Object.isFrozen(system.roster) && Object.isFrozen(system.roster[0]));
});

test('a persona is built on its office: the Boss premise and side-taking rule, or the Mod Bot premise without it', () => {
  const v = { name: 'Test', title: 'Tester', temperament: 't', voice: 'v', habits: ['h'] };
  const side = 'Never take a side in a real argument. ';
  const boss = persona(v, 'boss');
  const bot = persona(v, 'bot');
  assert.ok(boss.includes(BOSS_PREMISE) && !boss.includes(MOD_BOT_PREMISE));
  assert.ok(boss.includes(side));
  assert.ok(bot.includes(MOD_BOT_PREMISE) && !bot.includes(BOSS_PREMISE));
  assert.ok(!bot.includes(side) && !bot.includes('Never take a side'));
  assert.ok(bot.endsWith(MOD_BOT_ANSWER_RULES));
  assert.equal(MOD_BOT_ANSWER_RULES, BOSS_ANSWER_RULES.replace(side, ''));
});

test('the four appeal lines use only the tokens an appeal\'s ruling is given', () => {
  for (const k of ['appealOverturned', 'appealUpheld', 'appealReduced', 'appealIncreased'] as const) {
    assert.ok(STOCK_LINE_KEYS.includes(k), k);
    assert.deepEqual([...STOCK_LINE_TOKENS[k]], ['mod', 'appellant']);
    for (const line of system.stockLines[k]) for (const [, token] of line.matchAll(/\{([^{}]*)\}/g)) assert.ok(['mod', 'appellant'].includes(token!), `${k}: {${token}}`);
  }
});

// Task 14 (Mod Bots): Divided World's staff content.
test('every persona\'s pet rules are known predicates, and its visit hours sit inside the settings\' range', async () => {
  const { predicate } = await import('../../../engine/rules/predicates.ts');
  const { defaults: settings } = await import('../settings.ts');
  for (const p of system.roster) {
    for (const k of p.petRules) assert.ok(predicate(k) !== undefined, `${p.key}: ${k}`);
    assert.ok(p.strictness.visitHours.least >= settings.modBots.visitHours.least && p.strictness.visitHours.most <= settings.modBots.visitHours.most, p.key);
  }
  const bot = system.roster.find((p) => system.firstStaff.includes(p.key))!;
  assert.ok(bot.petRules.length >= 2, 'the Mod Bot lobbies for something');
});

test('the Mod Bot\'s quiz has five questions, every answer is one of its choices, and no position holds a third of the answers', () => {
  const bot = system.roster.find((p) => system.firstStaff.includes(p.key))!;
  assert.equal(bot.weakness.kind, 'quiz');
  if (bot.weakness.kind !== 'quiz') return;
  const qs = bot.weakness.questions;
  assert.ok(qs.length >= 5);
  for (const q of qs) {
    assert.ok(q.choices.includes(q.answer), q.question);
    assert.ok(q.choices.length >= 2 && q.choices.length <= 8, q.question);
    assert.equal(new Set(q.choices).size, q.choices.length, q.question);
    assert.ok(q.choices.every((c) => c === c.trim()), q.question);
  }
  const at = qs.map((q) => q.choices.indexOf(q.answer));
  const most = Math.max(...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => at.filter((a) => a === i).length));
  assert.ok(most <= Math.ceil(qs.length / 3), `no position holds more than a third of the answers (positions ${at.join(',')})`);
});

test('every persona\'s weakness is a quiz, a bribe or a distraction the engine accepts', () => {
  assert.deepEqual(instanceProblems(instance), []);
});

test('the Mod Bot stock lines have at least five each, and every token is one the key allows and well formed', () => {
  for (const k of ['ruleSet', 'visitArrived', 'visitFiled', 'reportDismissed', 'reportBackfired', 'appealOverturned', 'appealUpheld', 'appealReduced', 'appealIncreased'] as const) {
    assert.ok(system.stockLines[k].length >= 5, `${k} has several lines`);
    for (const line of system.stockLines[k]) for (const [, t] of line.matchAll(/\{([^{}]*)\}/g)) assert.ok(STOCK_LINE_TOKENS[k].includes(t!), `${k}: {${t}}`);
    for (const line of system.stockLines[k]) assert.equal(line.replace(/\{[^{}]*\}/g, ''). match(/[{}]/), null, `${k}: stray brace in ${line}`);
  }
});

test('the theme sets the visit mark\'s ink in the light, device-dark and chosen-dark blocks', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/theme.css', import.meta.url), 'utf8');
  const light = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'));
  const device = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf(':root[data-kb-mode="dark"]'));
  const chosen = css.slice(css.indexOf(':root[data-kb-mode="dark"]'));
  for (const [name, block] of [['light', light], ['device-dark', device], ['chosen-dark', chosen]] as const) assert.match(block, /--kb-visit-ink:\s*#[0-9a-f]{6}/i, name);
});

test('the visit mark\'s ink holds 3:1 against the glass tile\'s field and against the Lens\'s brightest smoke, in every block', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/theme.css', import.meta.url), 'utf8');
  const glass = JSON.parse(readFileSync(new URL('../ui/glass.json', import.meta.url), 'utf8')) as { keys: { standard: Record<string, { value: string }> } };
  const ceilings = JSON.parse(readFileSync(new URL('../../../e2e/glass-ceilings.json', import.meta.url), 'utf8')) as Record<string, { surfaces: Record<string, { worst: number }> }>;
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const field = lum(glass.keys.standard['--kb-glass-field']!.value);
  const worst = Object.values(ceilings)[0]!.surfaces['effect']!.worst;
  const inks = [...css.matchAll(/--kb-visit-ink:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1]!);
  assert.equal(inks.length, 3);
  for (const ink of inks) {
    assert.ok(ratio(lum(ink), field) >= 3, `${ink} on the tile's field`);
    assert.ok(ratio(lum(ink), worst) >= 3, `${ink} on the Lens's smoke`);
  }
});

test('every persona\'s bands are keys of the warn bar\'s bands', async () => {
  const { defaults } = await import('../settings.ts');
  for (const p of system.roster) for (const b of p.strictness.bands) assert.ok(b in defaults.warnBar.bands, `${p.key}: ${b}`);
});

test('no persona\'s startingHobby, persuadedBy or temperament refers to the persona as it, its or itself, so its pronouns can change without a sweep', () => {
  for (const p of system.roster) {
    for (const field of ['startingHobby', 'persuadedBy', 'temperament'] as const) {
      assert.doesNotMatch(p[field], /\b(it|its|itself)\b/i, `${p.key}.${field}`);
    }
  }
});
