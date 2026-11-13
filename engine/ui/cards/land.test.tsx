/**
 * Whether a card can land on a post as the screen sees it: the card's own rules (`canApply`), given
 * the post's length and the plays already on it. The server decides again; this only says which
 * posts to offer a card on and which cards to offer a post.
 */
import { describe, expect, test } from 'vitest';
import { economyOf, landsOn, quadrantFree, type CardRules } from '../../rules/cards.ts';
import { QUADRANTS, type Quadrant } from '../../rules/types.ts';
import type { Act } from '../data/api.ts';
import { effectsOf, landing, landingOn, lengthOf, targetOf, waysOn } from './land.ts';
import type { CardPlay } from './types.ts';

const rules = (key: string, stack?: number): Pick<CardRules, 'key' | 'stack' | 'canApply'> => {
  const own = { key, ...(stack === undefined ? {} : { stack }) };
  return { ...own, canApply: (target, effects, _config, now) => landsOn(own, target, effects, now) };
};
const post = (body: unknown, kind: Act['kind'] = 'post'): Act => ({
  id: 'p1', character: 'c1', kind, thread: 't1', targetActId: null, seq: 1, createdAt: '2026-10-29T21:00:00Z',
  payload: { body }, currentPayload: { body }, editedAt: null, shownEditedAt: null,
});
const play = (card: string, n: number): CardPlay => ({ id: `play-${card}-${n}`, card, layer: n, caster: 'c2', message: '', config: {}, playedAt: '2026-10-29T21:16:00Z', post: 'p1' });

describe('which posts a card lands on', () => {
  test('a post with room for it, and not an Act that is no post', () => {
    expect(landing(rules('whoops', 3), post('hi'), []).ok).toBe(true);
    expect(landing(rules('whoops', 3), post('hi', 'unmask'), []).ok).toBe(false);
  });

  test('a post already carrying three Whoops! takes no fourth, and says why', () => {
    const three = [play('whoops', 1), play('whoops', 2), play('whoops', 3)];
    const verdict = landing(rules('whoops', 3), post('hi'), three);
    expect(verdict).toEqual({ ok: false, why: 'this post already carries 3 of that card, the most it takes' });
    expect(landing(rules('whoops', 3), post('hi'), three.slice(0, 2)).ok).toBe(true);
  });

  test('another card\'s plays do not count against it', () => {
    expect(landing(rules('whoops', 3), post('hi'), [play('stick-around', 1), play('stick-around', 2), play('stick-around', 3)]).ok).toBe(true);
    expect(landing(rules('stick-around'), post('hi'), [play('stick-around', 1)]).ok).toBe(false);
  });
});

describe('how long a post is', () => {
  test('in characters of its current words, as the rules count it, and nothing for a body that is no text', () => {
    expect(lengthOf(post('a😀b'))).toBe(3);
    expect(lengthOf(post(undefined))).toBe(0);
  });
});

/* The card mechanic (docs/plans/2026-11-01-card-plays-plan.md, Task 7): a Set lands where no back is live, a cast where no live ward
   covers it, and a caught play holds no place. */
describe('wards, backs and catches, as a screen offers a card', () => {
  const at = new Date().toISOString();
  const setLasts = { unit: 'day' as const, count: 7 };
  const back = (over: Partial<CardPlay> = {}): CardPlay => ({ ...play('kb:card-back', 1), id: 'back', faceDown: true, playedAt: at, endsAt: '2999-01-01T00:00:00.000Z', ...over });
  const shield: CardRules = { key: 'shield', name: 'Shield', alignment: 'sweet', rarity: 'uncommon', play: 'use', gimmick: { kind: 'ward', upTo: 'uncommon' }, lasts: setLasts, playPrice: () => 0, validateConfig: (c) => ({ ok: true, value: c }), canApply: (t, e, _config, now) => landsOn({ key: 'shield' }, t, e, now) };
  const snare: CardRules = { ...shield, key: 'snare', name: 'Snare', play: 'set', gimmick: undefined, lasts: undefined, trap: { trigger: { on: 'visit' } }, canApply: () => ({ ok: true, value: undefined }) };
  const blot: CardRules = { ...shield, key: 'blot', name: 'Blot', rarity: 'common', play: undefined, gimmick: undefined, lasts: undefined, canApply: (t, e, _config, now) => landsOn({ key: 'blot' }, t, e, now) };
  const cards = [shield, snare, blot];
  const ward = (ends: string): CardPlay => ({ ...play('shield', 1), ends });

  test('a Set is offered where no card back is live, and a sprung or ended back is none', () => {
    expect(landing(snare, post('hi'), [], { cards }).ok).toBe(true);
    expect(landing(snare, post('hi'), [back()], { cards })).toEqual({ ok: false, why: 'this post already holds a card face down' });
    expect(landing(snare, post('hi'), [back({ revealed: { card: 'snare', spring: 's', at } })], { cards }).ok).toBe(true);
    expect(landing(snare, post('hi'), [back({ playedAt: '2020-01-01T00:00:00Z', endsAt: '2020-01-08T00:00:00Z' })], { cards }).ok).toBe(true);
  });

  test('a back ends at the end the server stored, whatever the setting says', () => {
    const day = 86_400_000;
    const long = back({ playedAt: new Date(Date.now() - 10 * day).toISOString(), endsAt: new Date(Date.now() + 20 * day).toISOString() });
    expect(landing(snare, post('hi'), [long], { cards })).toEqual({ ok: false, why: 'this post already holds a card face down' });
    expect(effectsOf([long], cards)[0]!.ends).toBe(long.endsAt);
  });

  test('a back its setter took back is no longer live, and its end is when it was taken', () => {
    const taken = back({ takenBack: { at } });
    expect(landing(snare, post('hi'), [taken], { cards }).ok).toBe(true);
    expect(effectsOf([taken], cards)[0]!.ends).toBe(at);
  });

  test('a cast is not offered where a live ward turns it away, and is where the ward has ended', () => {
    expect(landing(blot, post('hi'), [ward('2999-01-01T00:00:00Z')], { cards })).toEqual({ ok: false, why: 'this post\'s Shield turns away cards up to uncommon' });
    expect(landing(blot, post('hi'), [ward('2020-01-01T00:00:00Z')], { cards }).ok).toBe(true);
  });

  test('a card that writes lands on a post, as a screen offers it: the screens hold no settings, so the old voice does not withhold it', () => {
    const writer: CardRules = { ...blot, key: 'writer', name: 'Writer', writes: { sampling: { temperature: 0.9, topP: 0.95 }, tokens: () => 40, frame: () => ({ prompt: '', stop: [] }) } };
    expect(landing(writer, post('hi'), [], { cards: [...cards, writer] }).ok).toBe(true);
    expect(landingOn(writer, { reach: 'post', act: 'p1', kind: 'post', length: 2, text: 'hi', links: [] }, [], { cards: [...cards, writer] }).ok).toBe(true);
  });

  test('a card whose length is read from the economy lands on a post too: the screens hold no settings, so where it lands never asks what it buys', () => {
    const writer: CardRules = { ...blot, key: 'writer', name: 'Writer', writes: { sampling: { temperature: 0.9, topP: 0.95 }, tokens: (_config, settings) => economyOf(settings, 'writer.tokens'), frame: () => ({ prompt: '', stop: [] }) } };
    expect(landing(writer, post('hi'), [], { cards: [...cards, writer] }).ok).toBe(true);
    expect(landingOn(writer, { reach: 'post', act: 'p1', kind: 'post', length: 2, text: 'hi', links: [] }, [], { cards: [...cards, writer] }).ok).toBe(true);
  });

  test('a caught play holds no place in its card\'s stack', () => {
    expect(landing(blot, post('hi'), [{ ...play('blot', 1), caught: 'back' }], { cards }).ok).toBe(true);
  });
});

/* Reach (docs/plans/2026-11-01-card-reach-plan.md, Task 1): a card beyond a post is offered on the targets its reaches list, its
   stack counts that target's plays alone, and a board takes one board card at a time. */
describe('where a card beyond a post is offered', () => {
  const lasts = { unit: 'day' as const, count: 1 };
  const reaching = (key: string, reaches: CardRules['reaches']): CardRules => ({
    key, name: key, alignment: 'pepperoni', rarity: 'legendary', reaches, lasts, playPrice: () => 0,
    validateConfig: (c) => ({ ok: true, value: c }), canApply: (t, e, _config, now) => landsOn({ key, reaches }, t, e, now),
  });
  const sparkle = reaching('sparkle', ['character']);
  const quake = reaching('quake', ['board']);
  const cards = [sparkle, quake];
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  const on = (card: string, ends: string): CardPlay => ({ ...play(card, 1), ends });

  test('a character card on a character, never on a post', () => {
    expect(landingOn(sparkle, { reach: 'character', character: 'c1' }, [], { cards }).ok).toBe(true);
    expect(landing(sparkle, post('hi'), [], { cards })).toEqual({ ok: false, why: 'this card lands on a character' });
    expect(landingOn(sparkle, { reach: 'character', character: 'c1' }, [on('sparkle', soon)], { cards })).toEqual({ ok: false, why: 'this character already carries that card' });
    expect(landingOn(sparkle, { reach: 'character', character: 'c1' }, [on('sparkle', '2020-01-01T00:00:00Z')], { cards }).ok).toBe(true);
  });

  test('a board card where no board card is live', () => {
    expect(landingOn(quake, { reach: 'board', board: 'b1' }, [on('other', '2099-03-04T05:06:07Z')], { cards })).toEqual({ ok: false, why: 'this board already carries a board card until 2099-03-04 05:06 UTC' });
    expect(landingOn(quake, { reach: 'board', board: 'b1' }, [], { cards }).ok).toBe(true);
  });
});

/* A card that names something when it is played (a skim card's quadrant, a scored-as card's class, a ride back's quadrant) is offered where it lands, before
   its player has named anything: the settings are the form's, and the screen asks only where the card lands. */
describe('a card that names a quadrant or a class, as a screen offers it', () => {
  const base: CardRules = { key: 'base', name: 'Base', alignment: 'salty', rarity: 'uncommon', playPrice: () => 0, validateConfig: (c) => ({ ok: true, value: c }), canApply: () => ({ ok: true, value: undefined }) };
  const named = (config: unknown) => (config as { quadrant?: unknown; class?: unknown } | null) ?? {};
  const skim: CardRules = { ...base, key: 'skim', name: 'Skim', skim: { share: 0.1 }, lasts: { unit: 'week', count: 1 }, stack: 4, validateConfig: (c) => (typeof named(c).quadrant === 'string' ? { ok: true, value: c } : { ok: false, why: 'choose the reactions' }), canApply: (t, e, c, now) => landsOn({ key: 'skim', stack: 4 }, t, e, now) };
  const scores: CardRules = { ...base, key: 'scores', name: 'Scores', reaches: ['character'], scoresAs: true, lasts: { unit: 'day', count: 2 }, validateConfig: (c) => (typeof named(c).class === 'string' ? { ok: true, value: c } : { ok: false, why: 'choose the class' }) };
  const ride: CardRules = { ...base, key: 'ride', name: 'Ride', play: 'set', trap: { trigger: { on: 'cast' }, outcome: { kind: 'ride', share: 1 } }, validateConfig: (c) => (typeof named(c).quadrant === 'string' ? { ok: true, value: c } : { ok: false, why: 'choose the reactions' }) };
  const cards = [skim, scores, ride];

  test('a skim card lands on a post, a scored-as card on a character, a ride back on a post, each with nothing named yet', () => {
    expect(landing(skim, post('hi'), [], { cards }).ok).toBe(true);
    expect(landingOn(scores, { reach: 'character', character: 'c1' }, [], { cards }).ok).toBe(true);
    expect(landing(ride, post('hi'), [], { cards }).ok).toBe(true);
    expect(landing(ride, post('hi'), [], { cards, faceDown: true }).ok).toBe(true);
  });

  test('a skim card is still offered on a post that carries one of its own, for the quadrants left', () => {
    expect(landing(skim, post('hi'), [{ ...play('skim', 1), ends: '2999-01-01T00:00:00Z', config: { quadrant: 'excitedNegative' } }], { cards }).ok).toBe(true);
  });
});

/* The lenient wrapper asks a card's own landing with no settings at all: a card whose `canApply` reads its configuration (a skim card's, through quadrantFree) must see none. */
describe('a card whose canApply reads its configuration, as a screen offers it', () => {
  const reading: CardRules = {
    key: 'reader', name: 'Reader', alignment: 'salty', rarity: 'uncommon', playPrice: () => 0, skim: { share: 0.1 }, lasts: { unit: 'week', count: 1 }, stack: 4,
    validateConfig: (c) => ((c as { quadrant?: unknown } | null)?.quadrant === undefined ? { ok: false, why: 'choose the reactions' } : { ok: true, value: c }),
    canApply: (t, e, config, now) => {
      const lands = landsOn({ key: 'reader', stack: 4 }, t, e, now);
      const quadrant = (config as { quadrant: Quadrant } | undefined)?.quadrant as Quadrant;
      return lands.ok && config ? quadrantFree({ key: 'reader' }, t, [{ card: 'reader', act: 'x', quadrant: QUADRANTS[0], ends: '2999-01-01T00:00:00Z' }], quadrant, now) : lands;
    },
  };
  test('arming it neither throws nor applies the placeholder quadrant\'s check', () => {
    expect(() => landing(reading, post('hi'), [], { cards: [reading] })).not.toThrow();
    expect(landing(reading, post('hi'), [], { cards: [reading] }).ok).toBe(true);
  });
});

/* A surface card's play needs its first draw (decidePlay refuses "draw your tag first"), which is the composer's, made on the post after the mark is pressed: the screen
   asks only where the card lands, so the mark is offered, and a wall already on the post still says so. */
describe('a surface card, as a screen offers it', () => {
  const wall: CardRules = {
    key: 'wall', name: 'Wall', alignment: 'salty', rarity: 'rare', playPrice: () => 0, validateConfig: (c) => ({ ok: true, value: c }),
    surface: { limitKey: 'wall.limit', mostLive: 48, validateDraw: () => ({ ok: false, why: 'unused' }), validateWash: () => ({ ok: false, why: 'unused' }) },
    canApply: (t, e, _c, now) => landsOn({ key: 'wall', surface: {} }, t, e, now),
  };
  test('it is offered on a post with no draw made yet, face up and face down, and not where a wall already is', () => {
    expect(landing(wall, post('hi'), [], { cards: [wall] })).toEqual({ ok: true, value: undefined });
    expect(landing(wall, post('hi'), [], { cards: [wall], faceDown: true }).ok).toBe(true);
    expect(landing(wall, post('hi'), [play('wall', 1)], { cards: [wall] })).toEqual({ ok: false, why: 'This post is already a wall. Draw on it instead.' });
  });
});

/* An admin's end (supabase/migrations/0092_card_end.sql): a play an admin ended is no effect the rules see, as a caught one is none. */
describe('a play an admin ended, as the rules see the post', () => {
  const cards = [{ key: 'whoops', rarity: 'common' as const }];
  const ended = (n: number): CardPlay => ({ ...play('whoops', n), reversed: true });

  test('effectsOf leaves it out, and keeps the live one beside it', () => {
    expect(effectsOf([play('whoops', 1), ended(2)], cards).map((e) => e.act)).toEqual(['play-whoops-1']);
    expect(effectsOf([ended(1)], cards)).toEqual([]);
  });

  test('it holds no place against a card\'s stack limit', () => {
    const three = [play('whoops', 1), play('whoops', 2), ended(3)];
    expect(landing(rules('whoops', 3), post('hi'), three).ok).toBe(true);
    expect(landing(rules('whoops', 3), post('hi'), [...three.slice(0, 2), play('whoops', 3)]).ok).toBe(false);
  });
});

/* Which ways a card lands on a post, the one answer the mark and the play form's "How to play it" pair share. */
describe('the ways a card lands on a post', () => {
  const base: CardRules = { key: 'base', name: 'Base', alignment: 'salty', rarity: 'common', playPrice: () => 0, validateConfig: (c) => ({ ok: true, value: c }), canApply: (t, e, _config, now) => landsOn({ key: 'base' }, t, e, now) };
  const blot: CardRules = { ...base, key: 'blot', name: 'Blot' };
  const spark: CardRules = { ...base, key: 'spark', name: 'Spark', reaches: ['character'], canApply: (t, e, _config, now) => landsOn({ key: 'spark', reaches: ['character'] }, t, e, now) };
  const scribe: CardRules = { ...base, key: 'scribe', name: 'Scribe', writes: { sampling: { temperature: 0.9, topP: 0.95 }, tokens: () => 40, frame: () => ({ prompt: '', stop: [] }) } };
  const plea: CardRules = { ...base, key: 'plea', name: 'Plea', needsMessage: 'say why' };
  const cards = [blot, spark, scribe, plea];

  test('a card that reaches a post lands both ways on one\'s own post, and only cast on another\'s', () => {
    expect(waysOn(blot, post('hi'), [], { cards, own: true, now: 0 })).toEqual({ cast: true, set: true });
    expect(waysOn(blot, post('hi'), [], { cards, own: false, now: 0 })).toEqual({ cast: true, set: false });
  });

  test('a card that reaches a character lands only set, on one\'s own post, and nowhere on another\'s', () => {
    expect(waysOn(spark, post('hi'), [], { cards, own: true, now: 0 })).toEqual({ cast: false, set: true });
    expect(waysOn(spark, post('hi'), [], { cards, own: false, now: 0 })).toEqual({ cast: false, set: false });
  });

  test('a card that is only cast face up lands only cast, even on one\'s own post', () => {
    expect(waysOn(scribe, post('hi'), [], { cards, own: true, now: 0 })).toEqual({ cast: true, set: false });
  });

  test('a card that needs a message lands only cast, though landing\'s lenient reading sets the message aside', () => {
    expect(waysOn(plea, post('hi'), [], { cards, own: true, now: 0 })).toEqual({ cast: true, set: false });
  });

  test('a card that is drawn on lands only cast too, though landing\'s lenient reading would set it', () => {
    const wall: CardRules = { ...base, key: 'wall', name: 'Wall', surface: { limitKey: 'wall.limit', mostLive: 48, validateDraw: () => ({ ok: false, why: 'unused' }), validateWash: () => ({ ok: false, why: 'unused' }) } };
    expect(waysOn(wall, post('hi'), [], { cards: [wall], own: true, now: 0 })).toEqual({ cast: true, set: false });
  });

  test('a play beyond a post whose end has passed holds no place: waysOn keeps only the live plays', () => {
    const once: CardRules = { ...base, key: 'once', name: 'Once', stack: 1, canApply: (t, e, _config, now) => landsOn({ key: 'once', stack: 1 }, t, e, now) };
    const beyond = (ends: string): CardPlay => ({ ...play('once', 1), reach: 'character', ends });
    const ways = (ends: string, now: Date) => waysOn(once, post('hi'), [beyond(ends)], { cards: [once], own: true, now: now.getTime() });
    /* It ends at 2999-01-01: before that it holds the card's one place, at it and after that it does not. */
    expect(ways('2999-01-01T00:00:00.000Z', new Date('2998-12-31T00:00:00.000Z'))).toEqual({ cast: false, set: false });
    expect(ways('2999-01-01T00:00:00.000Z', new Date('2999-01-01T00:00:00.000Z'))).toEqual({ cast: true, set: true });
  });
});

/* A reply drawn under a post (a card that replies, 0348) takes no card that replies under it, so the screen offers none there. */
describe('a card that replies, on a reply drawn under a post', () => {
  const cutter: CardRules = { key: 'cutter', name: 'Cutter', alignment: 'pepperoni', rarity: 'rare', replies: true, playPrice: () => 0, validateConfig: (c) => ({ ok: true, value: c }), canApply: (t, e, _c, now) => landsOn(cutter, t, e, now) };
  const cards = [cutter, { ...cutter, key: 'plain', name: 'Plain', replies: undefined, alignment: 'salty' } as CardRules];
  test('is offered on a post, and not on the reply drawn under one, in the rules\' words', () => {
    expect(landing(cutter, post('hi'), [], { cards }).ok).toBe(true);
    expect(landing(cutter, post('hi'), [], { cards, under: 'p0' })).toEqual({ ok: false, why: 'a reply drawn under a post takes no reply under it' });
  });
  test('any other card is offered there as on any post', () => {
    expect(landing(cards[1]!, post('hi'), [], { cards, under: 'p0' }).ok).toBe(true);
  });
  test('the post as the rules see it names the post it is under', () => {
    expect(targetOf(post('hi'), 'p0')).toMatchObject({ reach: 'post', act: 'p1', under: 'p0' });
    expect(targetOf(post('hi'))).not.toHaveProperty('under');
  });
});
