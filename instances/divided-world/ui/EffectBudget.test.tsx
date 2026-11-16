/**
 * The effect budget stories (EffectBudget.board.stories.tsx) hold a story for each key of `BUDGET`: a module's exports cannot be made from a map, so
 * the story of `hot-box` is the export `HotBox` written by hand, and a key added without one would be an effect on the tile layer that
 * e2e/effect-tiles.spec.ts never measures. The check (tools/check-effect-canvas.mjs) holds that every effect on the layer has a key; this holds that every key has a story.
 */
import { describe, expect, it } from 'vitest';
import * as stories from './EffectBudget.board.stories.tsx';

const pascal = (key: string) => key.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');

/** What is wrong with a stories module against its keys: each key with no story named for it, or whose story plays another effect. */
function storyFaults(keys: readonly string[], mod: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const story = mod[pascal(key)] as { args?: { effect?: string } } | undefined;
    if (!story) out.push(`no story ${pascal(key)} for the key ${key}`);
    else if (story.args?.effect !== key) out.push(`the story ${pascal(key)} plays ${String(story.args?.effect)}, not ${key}`);
  }
  return out;
}

describe('the effect budget stories', () => {
  it('have a story for each key of BUDGET, named for it', () => {
    expect(storyFaults(Object.keys(stories.BUDGET), stories as Record<string, unknown>)).toEqual([]);
  });
  it('the rule reports a key with no story, and a story that plays another effect (poison)', () => {
    const mod = { ...(stories as Record<string, unknown>), Planted: undefined };
    expect(storyFaults([...Object.keys(stories.BUDGET), 'planted'], mod)).toEqual([expect.stringContaining('no story Planted for the key planted')]);
    expect(storyFaults(['hot-box'], { HotBox: { args: { effect: 'other' } } })).toEqual([expect.stringContaining('hot-box')]);
  });
  it('have the two poisons, which play no effect', () => {
    expect(stories.PoisonSlow.args).toEqual({ poison: 'slow' });
    expect(stories.PoisonWhole.args).toEqual({ poison: 'whole' });
  });
});
