import { describe, expect, test } from 'vitest';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';
import type { HandoverTodo } from '../data/api.ts';
import { todoDraft, todoFacts, todoSentence, todoTitle } from './handover-words.ts';

const todo = (over: Partial<HandoverTodo> = {}): HandoverTodo => ({
  handover: 1, cause: 'rollover', season: 4, boss: 'comptroller', bossName: 'Comptroller', bossPronouns: ENGINE_DEFAULT_PRONOUNS, bossWas: 'mod', outgoing: 'old-boss', outgoingName: 'Old Boss',
  outgoingPronouns: ENGINE_DEFAULT_PRONOUNS, outgoingOffice: 'member', how: 'rotation', landedAt: '2026-11-01T00:00:00+00:00', note: null,
  facts: { created: [], merged: [], closed: [], beats: [], moves: [], busiest: [], quietest: [] },
  ...over,
});

describe('a handover to-do in plain words', () => {
  test('a roll-over opens the season', () => {
    const t = todo();
    expect(todoSentence(t)).toBe('Season 4 opens with Comptroller.');
    expect(todoTitle(t)).toBe('Season 4 opens with Comptroller');
    expect(todoFacts(t, 'The Boss')).toEqual([
      'Season 4: The Boss is Comptroller (was a Moderator).',
      'Old Boss is now a member.',
      "The Boss was chosen by the roster's rotation.",
    ]);
  });

  test('a departure whose outgoing name is unknown falls back to the roll-over sentence, naming no role', () => {
    const t = todo({ cause: 'departure', outgoingName: null, outgoing: null });
    expect(todoSentence(t)).toBe('Season 4 opens with Comptroller.');
    expect(todoTitle(t)).toBe('Season 4 opens with Comptroller');
  });

  test('a departure says who takes over from whom, and that the outgoing left the roster and is benched', () => {
    const t = todo({ cause: 'departure', outgoingOffice: 'benched' });
    expect(todoSentence(t)).toBe('Comptroller takes over Season 4 from Old Boss.');
    expect(todoTitle(t)).toBe('Comptroller takes over Season 4 from Old Boss');
    expect(todoFacts(t, 'The Boss')).toEqual([
      'Season 4: The Boss is Comptroller (was a Moderator).',
      "Old Boss left the instance's roster and is now benched.",
      "The Boss was chosen by the roster's rotation.",
    ]);
    expect(todoDraft(t, 'The Boss').title).toBe('Comptroller takes over Season 4 from Old Boss');
  });
});
