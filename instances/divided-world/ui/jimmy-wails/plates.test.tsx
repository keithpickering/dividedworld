/**
 * Jimmy Wails's plates (docs/plans/2026-11-03-jimmy-wails-plan.md, Task 6): the card draws one of these at each play, so the keys the card
 * lists and the ones plates.ts draws must be the same, each plate's file must be there with the size plates.ts states (a banner is laid out
 * from that size), and each plate's text box must lie inside the plate as it is drawn. A `.test.tsx` because plates.ts imports its pictures
 * as Vite does (`?url`), which plain node cannot load (vitest.config.ts).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { cards } from '../../cards/index.ts';
import { PLATES } from './plates.ts';

/** Vitest runs from the repository's root (vitest.config.ts), and the jsdom environment gives `import.meta.url` no file scheme. */
const dir = join(process.cwd(), 'instances/divided-world/ui/jimmy-wails/plates/');
/** A PNG's pixel size, from its header: eight signature bytes, then the IHDR chunk's width and height as big-endian integers. */
const sizeOf = (file: string) => {
  const b = readFileSync(file);
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

describe('Jimmy Wails plates', () => {
  test('the card draws exactly the plates plates.ts lists', () => {
    expect(cards.find((c) => c.key === 'jimmy-wails')!.draws).toEqual(PLATES.map((p) => p.key));
    expect(new Set(PLATES.map((p) => p.key)).size).toBe(PLATES.length);
  });

  test('each plate file is there with the dimensions plates.ts states', () => {
    for (const p of PLATES) {
      const file = join(dir, `${p.key}.png`);
      expect(existsSync(file), p.key).toBe(true);
      expect(sizeOf(file), p.key).toEqual({ width: p.width, height: p.height });
      expect(typeof p.src, p.key).toBe('string');
      expect(p.src.length, p.key).toBeGreaterThan(0);
    }
  });

  test('each text box lies inside the plate as drawn, and an extended plate has a panel to hold it', () => {
    for (const p of PLATES) {
      const wide = p.width + (p.panel?.width ?? 0);
      expect(p.box.x, p.key).toBeGreaterThanOrEqual(0);
      expect(p.box.y, p.key).toBeGreaterThanOrEqual(0);
      expect(p.box.w, p.key).toBeGreaterThan(0);
      expect(p.box.h, p.key).toBeGreaterThan(0);
      expect(p.box.x + p.box.w, p.key).toBeLessThanOrEqual(wide);
      expect(p.box.y + p.box.h, p.key).toBeLessThanOrEqual(p.height);
      expect(p.extend === 'right', p.key).toBe(p.panel !== null);
      expect(['#fff', '#222'], p.key).toContain(p.ink);
    }
  });

  test('make.py measures the colors under the same boxes plates.ts sets the words in', () => {
    const maker = readFileSync(join(dir, 'make.py'), 'utf8');
    const boxes = [...maker.match(/^BOXES = \{(.*)\}$/m)![1]!.matchAll(/'([a-z-]+)': \((\d+), (\d+), (\d+), (\d+)\)/g)];
    expect(boxes.length).toBeGreaterThan(0);
    for (const [, key, x, y, w, h] of boxes) {
      expect(PLATES.find((p) => p.key === key)?.box, key).toEqual({ x: Number(x), y: Number(y), w: Number(w), h: Number(h) });
    }
    /* Every plate the maker makes whose words sit on the picture's own file (no panel) is measured. */
    const made = [...maker.matchAll(/^ {4}'([a-z-]+)': \('/gm)].map((m) => m[1]!);
    expect(made.filter((key) => PLATES.find((p) => p.key === key)!.panel === null).sort()).toEqual(boxes.map((b) => b[1]!).sort());
  });

  test('each plate credits its photograph: who took it, its page on Wikimedia Commons and the license it is used under', () => {
    for (const p of PLATES) {
      expect(p.credit.author.length, p.key).toBeGreaterThan(0);
      expect(p.credit.source, p.key).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:\S+$/);
      expect(p.credit.license, p.key).toBe('CC BY-SA 3.0');
      expect(p.credit.licenseUrl, p.key).toBe('https://creativecommons.org/licenses/by-sa/3.0/');
    }
  });

  test('CREDITS.md, beside the files, names every plate with its photographer, its source and its license, and no plate the pool lacks', () => {
    const credits = readFileSync(join(dir, 'CREDITS.md'), 'utf8');
    for (const p of PLATES) {
      const row = credits.split('\n').find((line) => line.includes(`\`${p.key}.png\``));
      expect(row, p.key).toBeDefined();
      expect(row, p.key).toContain(p.credit.author);
      expect(row, p.key).toContain(p.credit.source);
      expect(row, p.key).toContain(p.credit.licenseUrl);
    }
    const named = [...credits.matchAll(/`([a-z-]+)\.png`/g)].map((m) => m[1]);
    expect(named.sort()).toEqual(PLATES.map((p) => p.key).sort());
  });
});
