/**
 * So Very Happy's entry in the screens' card list: its tagline, summary and status are the glass's plain words, its colors are Salty's,
 * and its describe says what springs it, what it does to the player who played that Move, and how long it stays set.
 */
import { describe, expect, test } from 'vitest';
import { ui } from './ui.ts';
import { instance } from '../../../index.ts';
import { soVeryHappy } from '../../../cards/so-very-happy.ts';
import { defaults as settings } from '../../../settings.ts';

describe('So Very Happy', () => {
  test('its tagline, summary and status are the glass\'s plain words', () => {
    expect(ui.key).toBe('so-very-happy');
    expect(ui.art.tagline).toBe('Play it Sweet or get locked out');
    expect(ui.summary).toBe('Set face down on your post. The first non-Sweet Move up to rare lands, and its player is locked out of the thread for 24 hours.');
    expect(ui.status).toBe('Set, face down to everyone else');
  });

  test('its colors are Salty\'s, and it has no effect and no form', () => {
    expect([ui.art.color, ui.art.ink]).toEqual(['#ff3d7f', '#14030a']);
    expect(ui.Effect).toBeUndefined();
    expect(ui.ConfigForm).toBeUndefined();
  });

  test('its describe says what springs it, what the Move and its player get, and how long it stays set', () => {
    const said = ui.describe!(instance.settings);
    expect(said.startsWith('A Salty card, rare, set face down on one of your own posts.')).toBe(true);
    expect(said).toContain('The first Move played on that post that isn\'t Sweet, up to rare, springs it');
    expect(said).toContain('that Move lands as usual, and whoever played it is locked out of that post\'s thread for 24 hours');
    expect(said).toContain('It springs once, or ends by itself after 7 days.');
    expect(said).toContain('It costs nothing more to set.');
    expect(ui.describe!({ ...settings, setLasts: { unit: 'day', count: 1 } })).toContain('after 1 day.');
  });

  test('its describe uses "play" and "Move", never "cast"', () => {
    expect(ui.describe!(instance.settings)).not.toMatch(/\bcast/iu);
    expect(ui.summary).not.toMatch(/\bcast/iu);
  });

  test('its summary and describe read the flavor it does not spring on, the rarity and the hours from its rules, so a retuned rule changes the words', () => {
    const trap = soVeryHappy.trap! as Record<string, unknown>;
    const held = { match: trap.match, outcome: trap.outcome };
    try {
      trap.match = { flavors: ['salty'], upTo: 'uncommon' };
      trap.outcome = { kind: 'lockout', hours: 1 };
      expect(ui.summary).toBe('Set face down on your post. The first Move up to uncommon that isn\'t Sweet or Pepperoni lands, and its player is locked out of the thread for 1 hour.');
      expect(ui.describe!(instance.settings)).toContain('The first Move played on that post that isn\'t Sweet or Pepperoni, up to uncommon, springs it');
      expect(ui.describe!(instance.settings)).toContain('locked out of that post\'s thread for 1 hour.');
    } finally {
      trap.match = held.match;
      trap.outcome = held.outcome;
    }
    expect(ui.summary).toContain('non-Sweet Move up to rare');
  });
});
