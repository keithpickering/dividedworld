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
});
