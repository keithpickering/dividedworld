/**
 * The discipline cards' words (discipline.ts), held where a Lens test reaches them only through a world: the singular and the plural, "twice" and "N times", and the two states of a fall.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dayAndTime } from '../characters/format.ts';
import { disciplineNote, FALL_ENDS, timesWords, warnPoints } from './discipline.ts';
import type { CardPlay } from './types.ts';

const play = (over: Partial<CardPlay> = {}): CardPlay => ({ id: 'k1', card: 'x', layer: 1, caster: 'q', message: '', config: {}, playedAt: '2026-10-30T12:00:00.000Z', post: 'p', ...over });
const NOW = Date.parse('2026-11-01T00:00:00.000Z');
const names = { target: 'Spritey', caster: 'Pipewrench', author: 'Gloomba' };

describe('a discipline play\'s words', () => {
  test('a relief says how many points it took, singular and plural, and a relief that says none says nothing', () => {
    assert.equal(warnPoints(1), '1 warn point');
    assert.equal(warnPoints(2), '2 warn points');
    assert.equal(disciplineNote({ kind: 'relief', points: 'all' }, play({ took: 1 }), names, NOW), `Took 1 warn point off Spritey's warn bar on ${dayAndTime('2026-10-30T12:00:00.000Z')}.`);
    assert.equal(disciplineNote({ kind: 'relief', points: 'lightestBand' }, play({ took: 2 }), names, NOW), `Took 2 warn points off Spritey's warn bar on ${dayAndTime('2026-10-30T12:00:00.000Z')}.`);
    assert.equal(disciplineNote({ kind: 'relief', points: 'all' }, play(), names, NOW), null);
  });
  test('an unban says whose ban it ended and when', () => {
    assert.equal(disciplineNote({ kind: 'unban' }, play({ lifted: 1 }), names, NOW), `Ended Spritey's ban on ${dayAndTime('2026-10-30T12:00:00.000Z')}.`);
  });
  test('a fall says whom the points land on and whom they spare while it waits, and where they landed once a filing spent it', () => {
    assert.equal(disciplineNote({ kind: 'fall' }, play(), names, NOW), "If a Mod Bot's visit to this post files, its warn points land on Pipewrench, not on Gloomba. The post keeps its notice.");
    assert.equal(disciplineNote({ kind: 'fall' }, play({ spent: true }), names, NOW), 'A visit to this post filed, and its warn points landed on Pipewrench.');
    assert.equal(FALL_ENDS, 'Ends when a visit to this post files, or when an admin ends it.');
  });
  test('a watch says twice, or N times, and until when; one with no end says nothing', () => {
    assert.equal(timesWords(2), 'twice');
    assert.equal(timesWords(3), '3 times');
    const ends = '2026-11-06T12:00:00.000Z';
    assert.equal(disciplineNote({ kind: 'watch', weight: 2 }, play({ ends }), names, NOW), `Mod Bot patrols are twice as likely to look at Spritey's posts until ${dayAndTime(ends)}. A patrol still judges each post against the rules.`);
    assert.ok(disciplineNote({ kind: 'watch', weight: 5 }, play({ ends }), names, NOW)!.includes('are 5 times as likely'));
    assert.equal(disciplineNote({ kind: 'watch', weight: 2 }, play(), names, NOW), null);
    /* Once its time has passed it says so in the past tense, with no second sentence. */
    const after = Date.parse(ends);
    assert.equal(disciplineNote({ kind: 'watch', weight: 2 }, play({ ends }), names, after), `Mod Bot patrols were twice as likely to look at Spritey's posts until ${dayAndTime(ends)}.`);
    assert.equal(disciplineNote({ kind: 'watch', weight: 3 }, play({ ends }), names, after + 1), `Mod Bot patrols were 3 times as likely to look at Spritey's posts until ${dayAndTime(ends)}.`);
  });
});
