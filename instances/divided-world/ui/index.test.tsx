import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { instance } from '../index.ts';
import { instanceUi } from './index.ts';

describe('Divided World\'s InstanceUi covers its rules', () => {
  test('every class has a look and a description', () => {
    for (const c of instance.classes) {
      expect(instanceUi.classLooks[c.key], c.key).toBeDefined();
      expect(instanceUi.classLooks[c.key]?.description.length, c.key).toBeGreaterThan(0);
    }
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
  test('the fonts ship with their license', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    expect(fs.readFileSync(path.join(dir, 'fonts', 'OFL.txt'), 'utf8')).toMatch(/SIL OPEN FONT LICENSE/);
  });
  test('every reason a class pays reads as a sentence of its own', () => {
    const reasons = ['face.cheered', 'face.liftedAPost', 'face.boredTheRoom', 'face.stoleThunder', 'heel.drewHeat', 'heel.stoleThunder', 'heel.shrugged',
      'jabroni.drewTheGroan', 'jabroni.soldTheL', 'jabroni.takenSincerely', 'lurker.calledIt', 'lurker.spunAThread', 'lurker.cardDrew', 'lurker.postedTooMuch'];
    for (const r of reasons) expect(instanceUi.reasonWords(r), r).not.toMatch(/^Settled under/);
  });
});
