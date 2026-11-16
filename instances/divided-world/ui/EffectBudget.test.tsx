/**
 * The effect budget stories (EffectBudget.board.stories.tsx) hold a story for each key of `BUDGET`: a module's exports cannot be made from a map, so
 * the story of `hot-box` is the export `HotBox` written by hand, and a key added without one would be an effect on the tile layer that
 * e2e/effect-tiles.spec.ts never measures. The check (tools/check-effect-canvas.mjs) holds that every effect on the layer has a key; this holds that every key has a story.
 */
import { describe, expect, it } from 'vitest';
import * as stories from './EffectBudget.board.stories.tsx';

const pascal = (key: string) => key.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');

describe('the effect budget stories', () => {
  it('have a story for each key of BUDGET, named for it', () => {
    for (const key of Object.keys(stories.BUDGET)) {
      const story = (stories as Record<string, unknown>)[pascal(key)] as { args?: { effect?: string } } | undefined;
      expect(story, `no story ${pascal(key)} for the key ${key}`).toBeDefined();
      expect(story?.args?.effect).toBe(key);
    }
  });
  it('have the two poisons, which play no effect', () => {
    expect(stories.PoisonSlow.args).toEqual({ poison: 'slow' });
    expect(stories.PoisonWhole.args).toEqual({ poison: 'whole' });
  });
});
