import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { glassVars } from '../../../engine/ui/glass/apply.ts';
import { boardSwitch } from '../../../engine/ui/glass/board.ts';
import { SURFACES } from '../../../tools/check-glass-contrast.mjs';
import { QUADRANTS } from '../../../engine/rules/types.ts';
import { instance } from '../index.ts';
import { instanceUi } from './index.ts';

describe('Divided World\'s InstanceUi covers its rules', () => {
  test('every class has a look and a description', () => {
    for (const c of instance.classes) {
      expect(instanceUi.classLooks[c.key], c.key).toBeDefined();
      expect(instanceUi.classLooks[c.key]?.description.length, c.key).toBeGreaterThan(0);
    }
  });
  test('every card has a face and rules in plain words, true to the settings it is told', () => {
    expect(instanceUi.cards.map((c) => c.key).sort()).toEqual(instance.cards.map((c) => c.key).sort());
    for (const c of instance.cards) {
      const ui = instanceUi.cards.find((u) => u.key === c.key)!;
      expect(ui.art.color, c.key).toMatch(/^#[0-9a-f]{6}$/i);
      expect(ui.art.ink, c.key).toMatch(/^#[0-9a-f]{6}$/i);
      expect(ui.describe(instance.settings).length, c.key).toBeGreaterThan(40);
    }
    const whoops = instanceUi.cards.find((c) => c.key === 'whoops')!;
    expect(whoops.describe(instance.settings)).toContain('1.00');
    expect(whoops.describe({ ...instance.settings, economy: { ...instance.settings.economy, 'whoops.price': 250 } })).toContain('2.50');
  });
  test('Whoops! draws its effect and its ink form, and each play\'s tag takes its own ink', () => {
    const whoops = instanceUi.cards.find((c) => c.key === 'whoops')!;
    expect(whoops.Effect).toBeDefined();
    expect(whoops.ConfigForm).toBeDefined();
    const play = (id: string, color: unknown) => ({ id, card: 'whoops', layer: 1, caster: null, message: '', config: { color }, playedAt: '', post: 'p' });
    const under = play('a', '#ffd93d');
    const top = play('b', '#101010');
    /* The tag on top is the most drawn play, not always the top ink, so each play's tag and chip is in its own ink. */
    expect(whoops.tag!(under, [under, top])).toBe('#ffd93d');
    expect(whoops.tag!(top, [under, top])).toBe('#101010');
    expect(whoops.tag!(under, [under])).toBe('#ffd93d');
    expect(whoops.tag!(play('c', 'not a color'), [play('c', 'not a color')])).toBeUndefined();
    expect(instanceUi.cards.find((c) => c.key === 'stick-around')!.tag).toBeUndefined();
  });
  test('every pip style has images', () => {
    for (const p of instance.pipStyles) expect(instanceUi.pips[p.key], p.key).toBeDefined();
  });
  test('the house theme is first and holds both modes', () => {
    expect(instanceUi.themes[0]?.modes).toBe('both');
  });
  test('the glass is present: both keys, nine recipes and every surface the engine lists naming one', () => {
    const g = instanceUi.glass;
    expect(g).toBeDefined();
    expect(Object.keys(g.keys.standard).sort()).toEqual(Object.keys(g.keys.high).sort());
    expect(Object.keys(g.smoke.recipes)).toHaveLength(9);
    expect(Object.keys(g.smoke.surfaces)).toHaveLength(13);
    for (const [surface, recipe] of Object.entries(g.smoke.surfaces)) expect(g.smoke.recipes[recipe], surface).toBeDefined();
  });
  test('every class has a glass color', () => {
    for (const c of instance.classes) expect(instanceUi.glass.classes[c.key], c.key).toBeDefined();
  });
  test('every quadrant wears a class on the picker, a class of the rules with glass colors, each a different one', () => {
    const worn = QUADRANTS.map((q) => instanceUi.quadrantClasses?.[q]);
    for (const [i, key] of worn.entries()) {
      expect(instance.classes.map((c) => c.key), QUADRANTS[i]).toContain(key);
      expect(instanceUi.glass.classes[key!], QUADRANTS[i]).toBeDefined();
    }
    expect(new Set(worn).size).toBe(QUADRANTS.length);
  });
  test('every font file glass.json names exists, and the glass holds the URL it resolved to', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const named = JSON.parse(fs.readFileSync(path.join(dir, 'glass.json'), 'utf8')).fonts as { file: string }[];
    expect(named.length).toBeGreaterThan(0);
    expect(instanceUi.glass.fonts).toHaveLength(named.length);
    named.forEach((f, i) => {
      expect(fs.existsSync(path.join(dir, f.file)), f.file).toBe(true);
      const resolved = instanceUi.glass.fonts[i]!.file;
      expect(resolved, f.file).not.toBe(f.file);
      expect(resolved, f.file).toMatch(/\.woff2(\?.*)?$/);
    });
  });
  test('no font file sits in ui/fonts/ that glass.json does not name', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const named = new Set((JSON.parse(fs.readFileSync(path.join(dir, 'glass.json'), 'utf8')).fonts as { file: string }[]).map((f) => f.file));
    const shipped = fs.readdirSync(path.join(dir, 'fonts')).filter((f) => f.endsWith('.woff2')).map((f) => `fonts/${f}`);
    expect(shipped.filter((f) => !named.has(f)), 'shipped but unnamed').toEqual([]);
  });
  test('the names tokens.css declares are the names the glass writes: two lists that must agree are one list', () => {
    const css = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../engine/ui/glass/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const declared = [...css.matchAll(/(--kb-glass-[\w-]+)\s*:/g)].map((m) => m[1]!).sort();
    /* The orbs' and the classes' properties are named by the instance's own orbs and class keys, so
       tokens.css cannot declare them; they are held to the instance's lists instead. */
    const keyed = /^--kb-glass-(orb|class)-/;
    const fromInstance = [
      ...instanceUi.glass.orbs.gradients.flatMap((_, i) => ['highlight', 'color', 'shade'].map((s) => `--kb-glass-orb-${i + 1}-${s}`)),
      ...(['core', 'edge'] as const).filter((e) => instanceUi.glass.orbs.body[e]).map((e) => `--kb-glass-orb-body-${e}`),
      ...Object.keys(instanceUi.glass.classes).flatMap((c) => ['fill', 'ink', 'large'].map((s) => `--kb-glass-class-${c}-${s}`)),
    ].sort();
    for (const key of ['standard', 'high'] as const) {
      const written = Object.keys(glassVars(instanceUi.glass, key)).sort();
      expect(written.filter((n) => !keyed.test(n)), `${key} key writes what tokens.css declares`).toEqual(declared);
      expect(written.filter((n) => keyed.test(n)), `${key} key writes each orb and class the instance gives`).toEqual(fromInstance);
    }
  });
  test('the surfaces the glass names are the surfaces the engine lists', () => {
    expect(Object.keys(instanceUi.glass.smoke.surfaces).sort()).toEqual([...SURFACES].sort());
  });
  test('the fonts ship with their license', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    expect(fs.readFileSync(path.join(dir, 'fonts', 'OFL.txt'), 'utf8')).toMatch(/SIL OPEN FONT LICENSE/);
  });
  test('every reason a class pays reads as a sentence of its own', () => {
    const reasons = ['face.cheered', 'face.liftedAPost', 'face.boredTheRoom', 'face.stoleThunder', 'heel.drewHeat', 'heel.stoleThunder', 'heel.shrugged',
      'jabroni.drewTheGroan', 'jabroni.soldTheL', 'jabroni.takenSincerely', 'lurker.calledIt', 'lurker.spunAThread', 'lurker.cardDrew', 'lurker.postedTooMuch'];
    for (const r of reasons) expect(instanceUi.reasonWords(r), r).not.toMatch(/^Settled under/);
  });
  test('the Main board\'s layout becomes the Phone board\'s at 1152px: 1440 times the smallest phone size (16) over the smallest Main board size (20)', () => {
    expect(boardSwitch(instanceUi.glass)).toBe(1152);
  });
});
