/** Buzzkill's face and words: what the sheet says is the rules' own, in plain words, and the log's line is the engine's alone. */
import { describe, expect, test } from 'vitest';
import { faceUpOnly, reachesOf } from '../../../../../engine/rules/cards.ts';
import { instance } from '../../../index.ts';
import { instanceUi } from '../../index.ts';
import { instanceUiProblems } from '../../../../../engine/ui/tips/problems.ts';
import { cardsUi } from '../../cards.ts';
import { buzzkill } from '../../../cards/buzzkill.ts';

const ui = instanceUi.cards.find((c) => c.key === 'buzzkill');

describe('Buzzkill in plain words (the Buzzkill plan, Task 8)', () => {
  test('it wears the Salty pink and ink and says what it does', () => {
    expect(ui, 'buzzkill is listed').toBeDefined();
    expect([ui!.art.color, ui!.art.ink]).toEqual(['#ff3d7f', '#14030a']);
    expect(ui!.art.tagline).toBe('End a Gimmick early.');
    expect(ui!.summary).toBe('Played on a post or a character. Ends one Gimmick there, up to rare. You choose which.');
    expect(ui!.status).toBe('Ended a Gimmick early');
    expect(ui!.ConfigForm).toBeDefined();
    expect(ui!.Effect).toBeUndefined();
  });

  test('its sheet is the rules in plain words', () => {
    expect(ui!.describe(instance.settings)).toBe("A Salty card, rare, played on a post or a character. It ends one Gimmick there, up to rare, which you pick. The Gimmick isn't refunded, and what it did before it ended stands. A card that would turn a Salty card away still does, and on a post a card set face down there can still catch it. It is played face up, never set face down.");
    expect(buzzkill.rarity).toBe('rare');
    expect(buzzkill.cuts).toEqual({ upTo: 'rare' });
    expect(reachesOf(buzzkill)).toEqual(['post', 'character']);
    expect(faceUpOnly(buzzkill)).toBe(true);
  });

  test('the engine says what it ended on the log row, so the card adds no line of its own', () => {
    expect(ui!.logPlay).toBeUndefined();
  });

  test('it says "play" and never "cast", and the rules over every card hold with it in', () => {
    const words = [ui!.art.tagline, ui!.summary, ui!.describe(instance.settings)].join('\n');
    expect(words).not.toMatch(/\bcast/iu);
    expect(instanceUiProblems(instanceUi, instance)).toEqual([]);
    const keys = cardsUi.map((c) => c.key);
    expect(keys).toContain('buzzkill');
    expect(keys).toEqual([...keys].sort());
  });
});
