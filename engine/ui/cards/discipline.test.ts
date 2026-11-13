/**
 * The discipline cards' words (discipline.ts), held where a Lens test reaches them only through a world: the singular and the plural, "twice" and "N times", and the two states of a fall.
 */
import { describe, expect, test } from 'vitest';
import { dayAndTime } from '../characters/format.ts';
import { disciplineNote, FALL_ENDS, timesWords, warnPoints } from './discipline.ts';
import type { CardPlay } from './types.ts';

const play = (over: Partial<CardPlay> = {}): CardPlay => ({ id: 'k1', card: 'x', layer: 1, caster: 'q', message: '', config: {}, playedAt: '2026-10-30T12:00:00.000Z', post: 'p', ...over });
const NOW = Date.parse('2026-11-01T00:00:00.000Z');
const names = { target: 'Spritey', caster: 'Pipewrench', author: 'Gloomba' };

describe('a discipline play\'s words', () => {
  test('a relief says how many points it took, singular and plural, and a relief that says none says nothing', () => {
    expect(warnPoints(1)).toBe('1 warn point');
    expect(warnPoints(2)).toBe('2 warn points');
    expect(disciplineNote({ kind: 'relief', points: 'all' }, play({ took: 1 }), names, NOW)).toBe(`Took 1 warn point off Spritey's warn bar on ${dayAndTime('2026-10-30T12:00:00.000Z')}.`);
    expect(disciplineNote({ kind: 'relief', points: 'lightestBand' }, play({ took: 2 }), names, NOW)).toBe(`Took 2 warn points off Spritey's warn bar on ${dayAndTime('2026-10-30T12:00:00.000Z')}.`);
    expect(disciplineNote({ kind: 'relief', points: 'all' }, play(), names, NOW)).toBeNull();
  });
  test('an unban says whose ban it ended and when', () => {
    expect(disciplineNote({ kind: 'unban' }, play({ lifted: 1 }), names, NOW)).toBe(`Ended Spritey's ban on ${dayAndTime('2026-10-30T12:00:00.000Z')}.`);
  });
  test('a fall says whom the points land on and whom they spare while it waits, and where they landed once a filing spent it', () => {
    expect(disciplineNote({ kind: 'fall' }, play(), names, NOW)).toBe("If a Mod Bot's visit to this post files, its warn points land on Pipewrench, not on Gloomba. The post keeps its notice.");
    expect(disciplineNote({ kind: 'fall' }, play({ spent: true }), names, NOW)).toBe('A visit to this post filed, and its warn points landed on Pipewrench.');
    expect(FALL_ENDS).toBe('Ends when a visit to this post files, or when an admin ends it.');
  });
  test('a watch says twice, or N times, and until when; one with no end says nothing', () => {
    expect(timesWords(2)).toBe('twice');
    expect(timesWords(3)).toBe('3 times');
    const ends = '2026-11-06T12:00:00.000Z';
    expect(disciplineNote({ kind: 'watch', weight: 2 }, play({ ends }), names, NOW)).toBe(`Mod Bot patrols are twice as likely to look at Spritey's posts until ${dayAndTime(ends)}. A patrol still judges each post against the rules.`);
    expect(disciplineNote({ kind: 'watch', weight: 5 }, play({ ends }), names, NOW)).toContain('are 5 times as likely');
    expect(disciplineNote({ kind: 'watch', weight: 2 }, play(), names, NOW)).toBeNull();
    /* Once its time has passed it says so in the past tense, with no second sentence. */
    const after = Date.parse(ends);
    expect(disciplineNote({ kind: 'watch', weight: 2 }, play({ ends }), names, after)).toBe(`Mod Bot patrols were twice as likely to look at Spritey's posts until ${dayAndTime(ends)}.`);
    expect(disciplineNote({ kind: 'watch', weight: 3 }, play({ ends }), names, after + 1)).toBe(`Mod Bot patrols were 3 times as likely to look at Spritey's posts until ${dayAndTime(ends)}.`);
  });
});
