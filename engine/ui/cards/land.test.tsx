/**
 * Whether a card can land on a post as the screen sees it: the card's own rules (`canApply`), given
 * the post's length and the plays already on it. The server decides again; this only says which
 * posts to offer a card on and which cards to offer a post.
 */
import { describe, expect, test } from 'vitest';
import { economyOf, landsOn, quadrantFree, type CardRules } from '../../rules/cards.ts';
import { QUADRANTS, type Quadrant } from '../../rules/types.ts';
import type { Act } from '../data/api.ts';
import { livePlays, stackPlays } from './plays.ts';
import { effectsOf, springWords, landing, landingOn, lengthOf, targetOf, waysOn } from './land.ts';
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

describe('what a set card says it does', () => {
  const trap = (outcome: object, match?: object) => ({ play: 'set' as const, rarity: 'common' as const, trap: { trigger: { on: 'cast' as const }, ...(match ? { match } : {}), outcome } }) as never;
  test('a ride says it pays on each vote, and says "of the kind you name" only where it names one', () => {
    expect(springWords(trap({ kind: 'ride', share: 0.25, every: true }, { upTo: 'common' }))).toBe('Waits for a card up to common to be cast on this post, lets it land, and pays you a quarter of a vote for each vote it draws.');
    expect(springWords(trap({ kind: 'ride', share: 1 }))).toBe('Waits for the card it names to be cast on this post, lets it land, and pays you a vote for each vote it draws of the kind you name.');
  });
  test('a refund says it lets the cast land and gives the card back to its caster', () => {
    expect(springWords({ ...(trap({ kind: 'refund' }, { flavors: ['sweet'], upTo: 'uncommon' }) as object), rarity: 'rare' } as never)).toBe('Waits for a Sweet card, up to uncommon, to be cast on this post, lets it land, and gives the card back to its caster.');
    expect(springWords(trap({ kind: 'refund' }))).toBe('Waits for the card it names to be cast on this post, lets it land, and gives the card back to its caster.');
  });
  test('a lockout says the Move lands and its player is locked out, with the match named from the flavor left out', () => {
    const lock = (match?: object, rarity = 'rare') => ({ play: 'set' as const, rarity, trap: { trigger: { on: 'cast' as const }, ...(match ? { match } : {}), outcome: { kind: 'lockout', hours: 24 } } }) as never;
    expect(springWords(lock({ flavors: ['salty', 'pepperoni'], upTo: 'rare' }))).toBe("It springs on the first Move played on your post that isn't Sweet, up to rare: the Move lands, and whoever played it is locked out of the thread for 24 hours.");
    expect(springWords(lock({ flavors: ['sweet', 'pepperoni'], upTo: 'rare' }))).toContain("that isn't Salty, up to rare:");
    expect(springWords(lock({ flavors: ['sweet'] }))).toContain('that is Sweet, up to rare:');
    expect(springWords(lock({ flavors: ['sweet', 'salty', 'pepperoni'], upTo: 'legendary' }, 'legendary'))).toBe('It springs on the first Move played on your post: the Move lands, and whoever played it is locked out of the thread for 24 hours.');
    expect(springWords(lock())).toContain('the first Move played on your post that it names:');
    /* Every match shape reads as a sentence. */
    expect(springWords(lock({ upTo: 'rare' }))).toBe('It springs on the first Move played on your post that is up to rare: the Move lands, and whoever played it is locked out of the thread for 24 hours.');
    expect(springWords(lock({ flavors: ['sweet', 'salty', 'pepperoni'], upTo: 'rare' }))).toContain('your post that is up to rare:');
    expect(springWords(lock({ flavors: ['sweet', 'salty'], upTo: 'rare' }))).toContain("that isn't Pepperoni, up to rare:");
    expect(springWords(lock({}, 'legendary'))).toContain('your post: the Move lands');
    expect(springWords(lock({ flavors: ['sweet'], upTo: 'legendary' }, 'legendary'))).toContain('that is Sweet: the Move');
    for (const m of [{ flavors: ['salty', 'pepperoni'], upTo: 'rare' }, undefined]) expect(springWords(lock(m))).not.toMatch(/cast/i);
  });
  test('a catching match is unchanged', () => {
    expect(springWords({ play: 'set', rarity: 'common', trap: { trigger: { on: 'cast' }, match: { upTo: 'common' } } } as never)).toBe('Waits for a card up to common to be cast on this post, and takes it.');
  });
});

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

/* A fall a filing spent holds its place in the stack for good unless an admin ended it, as the server counts it (place_cast, 0361); the form is given `stackPlays`, never `livePlays`, which draws no spent fall. */
describe('a post whose fall a filing spent', () => {
  const fall = { ...rules('fall', 1), discipline: { kind: 'fall' as const }, reaches: ['post' as const], key: 'fall' };
  const cards = [{ ...fall, name: 'Fall', rarity: 'uncommon' } as unknown as CardRules];
  const spent: CardPlay = { ...play('fall', 1), spent: true };
  const now = Date.parse('2026-10-30T00:00:00Z');

  test('takes no second fall, and says why in the stack\'s words', () => {
    expect(landing(cards[0]!, post('hi'), stackPlays([spent], now), { postEffects: 8, cards })).toEqual({ ok: false, why: 'this post already carries that card' });
    /* The live plays leave it out, which is what draws it: not what counts it. */
    expect(landing(cards[0]!, post('hi'), livePlays([spent], now), { postEffects: 8, cards }).ok).toBe(true);
  });

  test('an admin-ended fall or an instant play holds no place', () => {
    expect(landing(cards[0]!, post('hi'), stackPlays([{ ...spent, reversed: true }], now), { postEffects: 8, cards }).ok).toBe(true);
    expect(landing(cards[0]!, post('hi'), stackPlays([{ ...play('fall', 1), instant: true }], now), { postEffects: 8, cards }).ok).toBe(true);
  });

  /* waysOn is the one answer the post's mark and the play form read: given the post's plays raw, or already as the stack holds them, it says no second fall. */
  test('waysOn offers no second fall, whether it is handed the raw plays or the stack', () => {
    expect(waysOn(cards[0]!, post('hi'), [spent], { postEffects: 8, cards, own: false, now })).toEqual({ cast: false, set: false });
    expect(waysOn(cards[0]!, post('hi'), stackPlays([spent], now), { postEffects: 8, cards, own: false, now })).toEqual({ cast: false, set: false });
    expect(waysOn(cards[0]!, post('hi'), [{ ...spent, reversed: true }], { postEffects: 8, cards, own: false, now }).cast).toBe(true);
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
    expect(landing(snare, post('hi'), [], { postEffects: 8, cards }).ok).toBe(true);
    expect(landing(snare, post('hi'), [back()], { postEffects: 8, cards })).toEqual({ ok: false, why: 'this post already holds a card face down' });
    expect(landing(snare, post('hi'), [back({ revealed: { card: 'snare', spring: 's', at } })], { postEffects: 8, cards }).ok).toBe(true);
    expect(landing(snare, post('hi'), [back({ playedAt: '2020-01-01T00:00:00Z', endsAt: '2020-01-08T00:00:00Z' })], { postEffects: 8, cards }).ok).toBe(true);
  });

  test('a back ends at the end the server stored, whatever the setting says', () => {
    const day = 86_400_000;
    const long = back({ playedAt: new Date(Date.now() - 10 * day).toISOString(), endsAt: new Date(Date.now() + 20 * day).toISOString() });
    expect(landing(snare, post('hi'), [long], { postEffects: 8, cards })).toEqual({ ok: false, why: 'this post already holds a card face down' });
    expect(effectsOf([long], cards)[0]!.ends).toBe(long.endsAt);
  });

  test('a back its setter took back is no longer live, and its end is when it was taken', () => {
    const taken = back({ takenBack: { at } });
    expect(landing(snare, post('hi'), [taken], { postEffects: 8, cards }).ok).toBe(true);
    expect(effectsOf([taken], cards)[0]!.ends).toBe(at);
  });

  test('a cast is not offered where a live ward turns it away, and is where the ward has ended', () => {
    expect(landing(blot, post('hi'), [ward('2999-01-01T00:00:00Z')], { postEffects: 8, cards })).toEqual({ ok: false, why: 'this post\'s Shield turns away cards up to uncommon' });
    expect(landing(blot, post('hi'), [ward('2020-01-01T00:00:00Z')], { postEffects: 8, cards }).ok).toBe(true);
  });

  test('a cast on a post under a live uncommon ward is offered with a pierce up to uncommon, and not without it', () => {
    const live = [ward('2999-01-01T00:00:00Z')];
    const ctx = { postEffects: 8, cards, own: false, now: Date.now() };
    expect(waysOn(blot, post('hi'), live, ctx).cast).toBe(false);
    expect(waysOn(blot, post('hi'), live, { ...ctx, pierce: 'common' }).cast).toBe(false);
    expect(waysOn(blot, post('hi'), live, { ...ctx, pierce: 'uncommon' }).cast).toBe(true);
    expect(landing(blot, post('hi'), live, { postEffects: 8, cards, pierce: 'uncommon' }).ok).toBe(true);
  });

  test('a card that writes lands on a post, as a screen offers it: the screens hold no settings, so the old voice does not withhold it', () => {
    const writer: CardRules = { ...blot, key: 'writer', name: 'Writer', writes: { sampling: { temperature: 0.9, topP: 0.95 }, tokens: () => 40, frame: () => ({ prompt: '', stop: [] }) } };
    expect(landing(writer, post('hi'), [], { postEffects: 8, cards: [...cards, writer] }).ok).toBe(true);
    expect(landingOn(writer, { reach: 'post', act: 'p1', kind: 'post', length: 2, text: 'hi', links: [] }, [], { postEffects: 8, cards: [...cards, writer] }).ok).toBe(true);
  });

  test('a card whose length is read from the economy lands on a post too: the screens hold no settings, so where it lands never asks what it buys', () => {
    const writer: CardRules = { ...blot, key: 'writer', name: 'Writer', writes: { sampling: { temperature: 0.9, topP: 0.95 }, tokens: (_config, settings) => economyOf(settings, 'writer.tokens'), frame: () => ({ prompt: '', stop: [] }) } };
    expect(landing(writer, post('hi'), [], { postEffects: 8, cards: [...cards, writer] }).ok).toBe(true);
    expect(landingOn(writer, { reach: 'post', act: 'p1', kind: 'post', length: 2, text: 'hi', links: [] }, [], { postEffects: 8, cards: [...cards, writer] }).ok).toBe(true);
  });

  test('a caught play holds no place in its card\'s stack', () => {
    expect(landing(blot, post('hi'), [{ ...play('blot', 1), caught: 'back' }], { postEffects: 8, cards }).ok).toBe(true);
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
    expect(landingOn(sparkle, { reach: 'character', character: 'c1' }, [], { postEffects: 8, cards }).ok).toBe(true);
    expect(landing(sparkle, post('hi'), [], { postEffects: 8, cards })).toEqual({ ok: false, why: 'this card lands on a character' });
    expect(landingOn(sparkle, { reach: 'character', character: 'c1' }, [on('sparkle', soon)], { postEffects: 8, cards })).toEqual({ ok: false, why: 'this character already carries that card' });
    expect(landingOn(sparkle, { reach: 'character', character: 'c1' }, [on('sparkle', '2020-01-01T00:00:00Z')], { postEffects: 8, cards }).ok).toBe(true);
  });

  test('a board card where no board card is live', () => {
    expect(landingOn(quake, { reach: 'board', board: 'b1' }, [on('other', '2099-03-04T05:06:07Z')], { postEffects: 8, cards })).toEqual({ ok: false, why: 'this board already carries a board card until 2099-03-04 05:06 UTC' });
    expect(landingOn(quake, { reach: 'board', board: 'b1' }, [], { postEffects: 8, cards }).ok).toBe(true);
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
    expect(landing(skim, post('hi'), [], { postEffects: 8, cards }).ok).toBe(true);
    expect(landingOn(scores, { reach: 'character', character: 'c1' }, [], { postEffects: 8, cards }).ok).toBe(true);
    expect(landing(ride, post('hi'), [], { postEffects: 8, cards }).ok).toBe(true);
    expect(landing(ride, post('hi'), [], { postEffects: 8, cards, faceDown: true }).ok).toBe(true);
  });

  test('a skim card is still offered on a post that carries one of its own, for the quadrants left', () => {
    expect(landing(skim, post('hi'), [{ ...play('skim', 1), ends: '2999-01-01T00:00:00Z', config: { quadrant: 'excitedNegative' } }], { postEffects: 8, cards }).ok).toBe(true);
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
    expect(() => landing(reading, post('hi'), [], { postEffects: 8, cards: [reading] })).not.toThrow();
    expect(landing(reading, post('hi'), [], { postEffects: 8, cards: [reading] }).ok).toBe(true);
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
    expect(landing(wall, post('hi'), [], { postEffects: 8, cards: [wall] })).toEqual({ ok: true, value: undefined });
    expect(landing(wall, post('hi'), [], { postEffects: 8, cards: [wall], faceDown: true }).ok).toBe(true);
    expect(landing(wall, post('hi'), [play('wall', 1)], { postEffects: 8, cards: [wall] })).toEqual({ ok: false, why: 'This post is already a wall. Draw on it instead.' });
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
    expect(waysOn(blot, post('hi'), [], { postEffects: 8, cards, own: true, now: 0 })).toEqual({ cast: true, set: true });
    expect(waysOn(blot, post('hi'), [], { postEffects: 8, cards, own: false, now: 0 })).toEqual({ cast: true, set: false });
  });

  test('a card that reaches a character lands only set, on one\'s own post, and nowhere on another\'s', () => {
    expect(waysOn(spark, post('hi'), [], { postEffects: 8, cards, own: true, now: 0 })).toEqual({ cast: false, set: true });
    expect(waysOn(spark, post('hi'), [], { postEffects: 8, cards, own: false, now: 0 })).toEqual({ cast: false, set: false });
  });

  test('a card that is only cast face up lands only cast, even on one\'s own post', () => {
    expect(waysOn(scribe, post('hi'), [], { postEffects: 8, cards, own: true, now: 0 })).toEqual({ cast: true, set: false });
  });

  test('a card that needs a message lands only cast, though landing\'s lenient reading sets the message aside', () => {
    expect(waysOn(plea, post('hi'), [], { postEffects: 8, cards, own: true, now: 0 })).toEqual({ cast: true, set: false });
  });

  test('a card that is drawn on lands only cast too, though landing\'s lenient reading would set it', () => {
    const wall: CardRules = { ...base, key: 'wall', name: 'Wall', surface: { limitKey: 'wall.limit', mostLive: 48, validateDraw: () => ({ ok: false, why: 'unused' }), validateWash: () => ({ ok: false, why: 'unused' }) } };
    expect(waysOn(wall, post('hi'), [], { postEffects: 8, cards: [wall], own: true, now: 0 })).toEqual({ cast: true, set: false });
  });

  test('a play beyond a post whose end has passed holds no place: waysOn keeps only the live plays', () => {
    const once: CardRules = { ...base, key: 'once', name: 'Once', stack: 1, canApply: (t, e, _config, now) => landsOn({ key: 'once', stack: 1 }, t, e, now) };
    const beyond = (ends: string): CardPlay => ({ ...play('once', 1), reach: 'character', ends });
    const ways = (ends: string, now: Date) => waysOn(once, post('hi'), [beyond(ends)], { postEffects: 8, cards: [once], own: true, now: now.getTime() });
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
    expect(landing(cutter, post('hi'), [], { postEffects: 8, cards }).ok).toBe(true);
    expect(landing(cutter, post('hi'), [], { postEffects: 8, cards, under: 'p0' })).toEqual({ ok: false, why: 'a reply drawn under a post takes no reply under it' });
  });
  test('any other card is offered there as on any post', () => {
    expect(landing(cards[1]!, post('hi'), [], { postEffects: 8, cards, under: 'p0' }).ok).toBe(true);
  });
  test('the post as the rules see it names the post it is under', () => {
    expect(targetOf(post('hi'), 'p0')).toMatchObject({ reach: 'post', act: 'p1', under: 'p0' });
    expect(targetOf(post('hi'))).not.toHaveProperty('under');
  });
});

/* The Buzzkill: a card that cuts is offered where a live Use-card Gimmick it may end is up, and nowhere else. */
describe('a card that cuts, as a screen offers it', () => {
  test('effectsOf leaves a cut play out, as it leaves a reversed one', () => {
    const cut = { ...play('jimmy', 1), cut: { by: 'b', card: 'buzzkill' } };
    expect(effectsOf([cut, play('jimmy', 2)], []).map((e) => e.act)).toEqual(['play-jimmy-2']);
  });
  const now = Date.parse('2026-10-30T00:00:00Z');
  const buzz = { ...rules('buzzkill'), name: 'Buzzkill', rarity: 'rare', play: 'cast', reaches: ['post'], cuts: { upTo: 'rare' } } as unknown as CardRules;
  const gimmick = { ...rules('jimmy'), name: 'Jimmy', rarity: 'rare', play: 'use', reaches: ['post'], gimmick: 'jimmy' } as unknown as CardRules;
  const cards = [buzz, gimmick];
  test('waysOn offers it on a post with a live rare Use-card play, not on one with none, nor with a cut one', () => {
    expect(waysOn(buzz, post('hi'), [play('jimmy', 1)], { postEffects: 8, cards, own: false, now }).cast).toBe(true);
    expect(waysOn(buzz, post('hi'), [], { postEffects: 8, cards, own: false, now }).cast).toBe(false);
    expect(waysOn(buzz, post('hi'), [{ ...play('jimmy', 1), cut: { by: 'b', card: 'buzzkill' } }], { postEffects: 8, cards, own: false, now }).cast).toBe(false);
  });
  test('whether the Gimmick is still up is read on the page\'s clock, not the wall\'s', () => {
    /* Up a day past the page's now, and long over by any wall clock this test runs under. */
    const timed = { ...play('jimmy', 1), ends: '2026-10-31T00:00:00Z' };
    expect(waysOn(buzz, post('hi'), [timed], { postEffects: 8, cards, own: false, now }).cast).toBe(true);
    expect(waysOn(buzz, post('hi'), [timed], { postEffects: 8, cards, own: false, now: Date.parse('2026-11-01T00:00:00Z') }).cast).toBe(false);
  });
});
