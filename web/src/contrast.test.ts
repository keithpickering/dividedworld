/**
 * A glass button's border on the brightest smoke, in each instance's own keys. The engine's test
 * (engine/ui/glass/parts.test.tsx) holds the tokens' defaults to 3:1; an instance's glass.json sets
 * the real colors, and the engine may not read it, so the composition side does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { BORDER_RULES, borderContrast, resolveColor, tokenDefaults } from '../../engine/ui/glass/border-contrast.ts';
import { contrastRatio } from '../../tools/check-glass-contrast.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const ceilings = JSON.parse(read('e2e', 'glass-ceilings.json')) as Record<string, { surfaces: Record<string, { worst: number; narrowWorst?: number }> }>;
const smoke = Math.max(...Object.values(ceilings).flatMap((i) => Object.values(i.surfaces).flatMap((x) => [x.worst, x.narrowWorst ?? 0])));
const parts = strip(read('engine', 'ui', 'glass', 'parts.css'));
const defaults = tokenDefaults(strip(read('engine', 'ui', 'glass', 'tokens.css')));

const instances = fs.readdirSync(path.join(root, 'instances')).filter((n) => fs.existsSync(path.join(root, 'instances', n, 'ui', 'glass.json')));

describe("a glass button's border in each instance's keys", () => {
  test('finds an instance', () => expect(instances.length).toBeGreaterThan(0));
  for (const name of instances) {
    const glass = JSON.parse(read('instances', name, 'ui', 'glass.json')) as { keys: Record<string, Record<string, { value: string }>> };
    for (const [key, tokens] of Object.entries(glass.keys)) {
      const vars = { ...defaults, ...Object.fromEntries(Object.entries(tokens).map(([a, b]) => [a, b.value])) };
      for (const [kind, sel] of BORDER_RULES) {
        test(`${name}'s ${key} key: the ${kind} border reaches 3:1 on the brightest smoke`, () => {
          expect(borderContrast(parts, sel, vars, smoke)).toBeGreaterThanOrEqual(3);
        });
      }
    }
  }
});

/*
 * A spent mark (engine/ui/cards/marks.css; spent-marks design, section 2) is still a button, so its gray border, the glass text mixed toward
 * transparent and drawn over the ground it sits on, is held to 3:1 against that ground in each instance's keys.
 */
const marksCss = strip(read('engine', 'ui', 'cards', 'marks.css'));
const spentLine = /\.kb-mark\.kb-meta-tile\[data-kb-spent='true'\]\s*\{[^}]*--kb-meta-line:\s*([^;]+);/.exec(marksCss)?.[1]?.trim();

describe("a spent mark's border in each instance's keys", () => {
  test('finds the spent mark\'s border', () => expect(spentLine).toBeDefined());
  for (const name of instances) {
    const glass = JSON.parse(read('instances', name, 'ui', 'glass.json')) as { keys: Record<string, Record<string, { value: string }>> };
    for (const [key, tokens] of Object.entries(glass.keys)) {
      const vars = { ...defaults, ...Object.fromEntries(Object.entries(tokens).map(([a, b]) => [a, b.value])) };
      test(`${name}'s ${key} key: the spent border reaches 3:1 on the ground`, () => {
        const line = resolveColor(spentLine!, vars);
        const ground = resolveColor(vars['--kb-glass-ground']!, vars);
        const under = [ground.r, ground.g, ground.b];
        const mixed = [line.r, line.g, line.b].map((x, i) => x * line.a + under[i]! * (1 - line.a));
        expect(contrastRatio(mixed as never, under as never)).toBeGreaterThanOrEqual(3);
      });
    }
  }
});
