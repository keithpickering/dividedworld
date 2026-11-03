/**
 * The log's lines as pure data (lines.ts): the parts the screens' tests reach only through a seeded world, held here on the
 * edges a world rarely makes: a season's end, reasons of two classes, an announcement's word against the reasons', a Turn to
 * the class the window scored, and two pages of one settlement merged.
 */
import { describe, expect, test } from 'vitest';
import type { Act, Log, LogSettlement, MyCharacter, TurnAnnounced } from '../data/api.ts';
import { testInstance } from '../test-world.tsx';
import { logRows, rankChanges, scoredAs, turnsTaken, type LogData, type Words } from './lines.ts';
import { mergeLogs } from './useLog.ts';

const empty: Log = { settlements: [], wallet: [], cards: [], playsOnMine: [], saves: [], setEnds: [], caught: [], before: null };
const settled = (id: number, endsAt: string, lines: LogSettlement['lines']): LogSettlement => ({ id, startsAt: new Date(Date.parse(endsAt) - 86_400_000).toISOString(), endsAt, sharesKept: true, lines });
const char = (id: string, name: string, cls: string, classSince = '2026-10-01T00:00:00.000Z'): MyCharacter =>
  ({ id, name, class: cls, classSince, turnOpensAt: null, debutedAt: '2026-10-01T00:00:00.000Z', debutLoudness: 'announced', retiredAt: null, pendingTurn: null, presenceHidden: false });
const words: Words = {
  instance: testInstance,
  ui: { reasonWords: (r) => ({ 'heel.drewHeat': 'Drew heat: x', 'face.cheered': 'Cheered: y' } as Record<string, string>)[r] ?? r, quadrantLabels: { excitedNegative: 'Heat', excitedPositive: 'Hype', boredNegative: 'Groan', calmPositive: 'Calm' }, cards: [], copy: { siteName: '', siteTagline: '', shopName: 'Shop', reducedMotionCard: '' } },
  postsPerPage: 20,
  economy: {},
};
const data = (over: Partial<LogData>): LogData => ({
  log: empty, mine: [], estimate: null, standings: {}, season: null, turns: [], acts: new Map(), names: new Map(), titles: new Map(), states: new Map(), ...over,
});
const season = (startsAt: string) => ({ id: 2, number: 2, startsAt, endsAt: null, turnsThread: null, revealAct: null });

describe('rank changes', () => {
  test('are drawn for the open season\'s settlements, and never across its start', () => {
    const p = char('p', 'Pipewrench', 'heel');
    /* The season began on Oct 25; Oct 30's +0.50 took this season's standing from 2.70 to 3.20, Jobber to Midcarder. */
    const log = { ...empty, settlements: [
      settled(2, '2026-10-30T08:17:00Z', [{ character: 'p', reason: 'heel.drewHeat', amount: 50, shares: [] }]),
      settled(1, '2026-10-20T08:17:00Z', [{ character: 'p', reason: 'heel.drewHeat', amount: -200, shares: [] }]),
    ] };
    const changes = rankChanges(data({ log, mine: [p], standings: { p: 320 }, season: season('2026-10-25T00:00:00Z') }), testInstance);
    expect(changes.get(2)).toEqual([{ character: 'p', before: 270, after: 320, rankWas: 0, rankNow: 1 }]);
    /* Read across the season's start, last season's loss would wrongly be a rank down from 4.70. */
    expect(changes.has(1)).toBe(false);
  });
});

describe('the class a settlement scored', () => {
  test('is named only when every reason is one class\'s; reasons of two say "Scored" alone', () => {
    expect(scoredAs([{ character: 'p', reason: 'heel.drewHeat', amount: 1, shares: [] }], testInstance)).toBe('heel');
    expect(scoredAs([{ character: 'p', reason: 'heel.drewHeat', amount: 1, shares: [] }, { character: 'p', reason: 'face.cheered', amount: 1, shares: [] }], testInstance)).toBeNull();
    const log = { ...empty, settlements: [settled(1, '2026-10-30T08:17:00Z', [{ character: 'p', reason: 'heel.drewHeat', amount: 5, shares: [] }, { character: 'p', reason: 'face.cheered', amount: 5, shares: [] }])] };
    const [row] = logRows(data({ log, mine: [char('p', 'Pipewrench', 'face')] }), words, 600, 'p');
    expect(row!.details.join('')).toMatch(/^Scored for Oct 29: /u);
  });
});

describe('a Turn that took effect', () => {
  const at = '2026-10-30T08:17:00.000Z';
  test('names the old class the announcement said, over the class the window\'s reasons name', () => {
    const p = char('p', 'Pipewrench', 'face', at);
    const log = { ...empty, settlements: [settled(1, at, [{ character: 'p', reason: 'heel.drewHeat', amount: 5, shares: [] }])] };
    const turns: TurnAnnounced[] = [{ act: 't', character: 'p', at, was: 'lurker' }];
    expect(turnsTaken(data({ log, mine: [p], turns }), testInstance).get(1)).toEqual([{ character: 'p', classNow: 'face', classWas: 'lurker', announced: turns[0] }]);
    expect(turnsTaken(data({ log, mine: [p] }), testInstance).get(1)![0]!.classWas).toBe('heel');
  });
  test('names no old class where the window scored the class it Turned to', () => {
    const p = char('p', 'Pipewrench', 'heel', at);
    const log = { ...empty, settlements: [settled(1, at, [{ character: 'p', reason: 'heel.drewHeat', amount: 5, shares: [] }])] };
    expect(turnsTaken(data({ log, mine: [p] }), testInstance).get(1)![0]!.classWas).toBeNull();
  });
});

describe('two pages merged', () => {
  test('hold each settlement once, the older page\'s rows after the newer\'s, and the older page\'s cursor', () => {
    const a = settled(2, '2026-10-30T08:17:00Z', []);
    const b = settled(1, '2026-10-29T08:17:00Z', []);
    const merged = mergeLogs({ ...empty, settlements: [a, b], before: 'x' }, { ...empty, settlements: [b], before: null });
    expect(merged.settlements.map((s) => s.id)).toEqual([2, 1]);
    expect(merged.before).toBeNull();
  });
});

/* #89 F3: two of the log's sentences no test held. Each is what a player reads to tell a missing breakdown, or a Turn no one saw, from a bug. */
describe('the log\'s plain sentences', () => {
  const at = '2026-10-30T08:17:00.000Z';
  const text = (row: { readonly details: readonly unknown[] }) => row.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');

  test('a settlement made before posts were kept says so', () => {
    const p = char('p', 'Pipewrench', 'heel');
    const log = { ...empty, settlements: [{ ...settled(1, at, [{ character: 'p', reason: 'heel.drewHeat', amount: 5, shares: [] }]), sharesKept: false }] };
    const [row] = logRows(data({ log, mine: [p] }), words, 600, null).filter((r) => r.kind === 'settlement');
    expect(text(row!)).toContain('This settlement was made before posts were kept with it.');
    const kept = { ...empty, settlements: [settled(1, at, [{ character: 'p', reason: 'heel.drewHeat', amount: 5, shares: [] }])] };
    expect(text(logRows(data({ log: kept, mine: [p] }), words, 600, null).find((r) => r.kind === 'settlement')!)).not.toContain('before posts were kept');
  });

  test('a Turn no one was told of says it was silent', () => {
    const p = char('p', 'Pipewrench', 'face', at);
    const log = { ...empty, settlements: [settled(1, at, [{ character: 'p', reason: 'heel.drewHeat', amount: 5, shares: [] }])] };
    const turn = logRows(data({ log, mine: [p] }), words, 600, null).find((r) => r.kind === 'turn')!;
    expect(text(turn)).toBe('Pipewrench is a Face now. A silent Turn: no one else was told.');
  });
});

/* The card mechanic's lines (docs/plans/2026-11-01-card-plays-plan.md, Task 6; the design's section 10): the setter's set, spring,
   payout and end, the caster's catch and the struck player's strike, each in plain words, none naming an owner or a reactor. */
describe('cards set face down, traps and catches', () => {
  const trapWorld = {
    ...testInstance,
    cards: [
      ...testInstance.cards,
      { ...testInstance.cards[0]!, key: 'snare', name: 'Snare', rarity: 'uncommon' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const }, outcome: { do: 'payout' as const } } },
      { ...testInstance.cards[0]!, key: 'bluffy', name: 'Bluffy', play: 'set' as const },
      { ...testInstance.cards[0]!, key: 'hook', name: 'Hook', rarity: 'uncommon' as const, play: 'set' as const, trap: { trigger: { on: 'reply' as const }, outcome: { do: 'strike' as const, card: 'whoops' } } },
    ],
  };
  const w: Words = { ...words, instance: trapWorld };
  const act = (id: string, kind: Act['kind'], character: string | null, over: Partial<Act> = {}): Act =>
    ({ id, kind, character, thread: 'th', targetActId: null, seq: null, createdAt: '2026-10-30T10:00:00.000Z', payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over });
  const mine = [char('p', 'Pipewrench', 'heel')];
  const names = new Map([['s', 'Spritey']]);
  const at = '2026-10-30T10:00:00.000Z';
  const later = '2026-10-31T10:00:00.000Z';
  const posts = [act('post3', 'post', 'p', { seq: 3 }), act('post4', 'post', 's', { seq: 4 })];
  const text = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');

  test('a Set is the setter\'s line, on their own post, and names its card to them alone', () => {
    const set = act('set1', 'set', 'p', { targetActId: 'post3' });
    const log = { ...empty, cards: [{ card: 'snare', kind: 'played' as const, act: 'set1', price: 0, at }] };
    const [row] = logRows(data({ log, mine, acts: new Map([...posts, set].map((a) => [a.id, a])), names }), w, 600, null);
    expect(row!.kind).toBe('set');
    expect(row!.what).toBe('You set Snare face down');
    expect(text(row!)).toBe('Snare set face down on your post #3. It springs once, or ends by itself.');
  });

  test('a spring that paid out says what it caught and what reached the wallet', () => {
    const play = act('k1', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', caught: 'set1' } });
    const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'snare', trigger: 'cast', outcome: { do: 'payout' }, set: 'set1', by: 'k1', caught: 'k1' } });
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'snare', post: 'post3', spring: 'sp', endedAt: later }],
      wallet: [{ settlement: null, kind: 'trap' as const, change: 75, overflow: 0, floored: 0, balanceAfter: 475, ref: 'sp', at: later }] };
    const [row] = logRows(data({ log, mine, acts: new Map([...posts, play, spring].map((a) => [a.id, a])), names }), w, 600, null);
    expect(row!.kind).toBe('payout');
    expect(text(row!)).toBe('Snare caught Spritey\'s Whoops! on your post #3; +0.75 to your wallet.');
    expect([row!.aura, row!.wallet]).toEqual([75, 475]);
  });

  test('a strike says what it laid and where', () => {
    const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'hook', trigger: 'reply', outcome: { do: 'strike', card: 'whoops' }, set: 'set1', by: 'post4' } });
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'hook', post: 'post3', spring: 'sp', endedAt: later }] };
    const [row] = logRows(data({ log, mine, acts: new Map([...posts, spring].map((a) => [a.id, a])), names }), w, 600, null);
    expect(row!.kind).toBe('sprung');
    expect(text(row!)).toBe('Hook on your post #3 sprang on a reply, and laid Whoops! on Spritey\'s post #4.');
  });

  test('a card back that ended says nothing sprang it', () => {
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'bluffy', post: 'post3', spring: null, endedAt: later }] };
    const [row] = logRows(data({ log, mine, acts: new Map(posts.map((a) => [a.id, a])), names }), w, 600, null);
    expect(row!.kind).toBe('setEnded');
    expect(text(row!)).toBe('Bluffy on your post #3 ended; nothing sprang it.');
    expect(row!.characters).toEqual(['p']);
  });

  test('a caught play is the caster\'s line, with its whole cost, and no line of its own as a play', () => {
    const others = [act('post9', 'post', 's', { seq: 9 }), act('k2', 'card', 'p', { targetActId: 'post9', payload: { card: 'whoops', caught: 'setX' } })];
    const log = { ...empty,
      cards: [{ card: 'whoops', kind: 'played' as const, act: 'k2', price: 75, at }],
      caught: [{ play: 'k2', card: 'whoops', post: 'post9', trap: 'snare', spring: 'spX', price: 75, boughtPrice: 100, at }],
      wallet: [{ settlement: null, kind: 'play' as const, change: -75, overflow: 0, floored: 0, balanceAfter: 225, ref: 'k2', at }] };
    const rows = logRows(data({ log, mine, acts: new Map(others.map((a) => [a.id, a])), names }), w, 600, null);
    expect(rows.map((r) => r.kind)).toEqual(['caught']);
    expect(rows[0]!.what).toBe('Your Whoops! was caught');
    expect(text(rows[0]!)).toBe('Your Whoops! on Spritey\'s post #9 was caught by a Snare; it cost 1.00 and 0.75, and nothing came back.');
    expect([rows[0]!.aura, rows[0]!.wallet]).toEqual([-75, 225]);
  });

  test('a strike on the player\'s post is their line, naming the trap that laid it', () => {
    const spring = act('sp', 'spring', 's', { targetActId: 'post4', payload: { card: 'hook', trigger: 'reply', outcome: { do: 'strike', card: 'whoops' }, set: 'setS', by: 'post3' } });
    const struck = act('k3', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', spring: 'sp' } });
    const log = { ...empty, playsOnMine: [{ play: 'k3', post: 'post3', at, reach: 'post' as const, targetName: null, targetCharacter: 'p' }] };
    const [row] = logRows(data({ log, mine, acts: new Map([...posts, spring, struck].map((a) => [a.id, a])), names }), w, 600, null);
    expect(row!.kind).toBe('struck');
    expect(text(row!)).toBe('A Hook on Spritey\'s post #4 laid Whoops! on your post #3.');
  });

  test('no line names an owner or a reactor: only characters\' names, and the player\'s own', () => {
    const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'snare', trigger: 'cast', outcome: { do: 'payout' }, set: 'set1', by: 'k1', caught: 'k1' } });
    const play = act('k1', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', caught: 'set1' } });
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'snare', post: 'post3', spring: 'sp', endedAt: later }, { play: 'set2', card: 'bluffy', post: 'post3', spring: null, endedAt: at }] };
    const all = logRows(data({ log, mine, acts: new Map([...posts, play, spring].map((a) => [a.id, a])), names }), w, 600, null).map(text).join(' ');
    expect(all).not.toMatch(/account|player|owner|reacted/iu);
  });
});

describe('a caught play and a ward\'s end, in the setter\'s and the user\'s logs', () => {
  const w: Words = { ...words, instance: { ...testInstance, cards: [...testInstance.cards, { ...testInstance.cards[0]!, key: 'shield', name: 'Shield', play: 'use' as const, ward: true as const, lasts: { unit: 'day' as const, count: 7 } }] } };
  const act = (id: string, kind: Act['kind'], character: string | null, over: Partial<Act> = {}): Act =>
    ({ id, kind, character, thread: 'th', targetActId: null, seq: null, createdAt: '2026-10-30T10:00:00.000Z', payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over });
  const mine = [char('p', 'Pipewrench', 'heel')];
  const text = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');

  test('a play a trap caught on the player\'s post is no "played on your post" line: the spring\'s line says it', () => {
    const post = act('post3', 'post', 'p', { seq: 3 });
    const caught = act('k1', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', caught: 'set1' } });
    const log = { ...empty, playsOnMine: [{ play: 'k1', post: 'post3', at: '2026-10-30T10:00:00.000Z', reach: 'post' as const, targetName: null, targetCharacter: 'p' }] };
    expect(logRows(data({ log, mine, acts: new Map([post, caught].map((a) => [a.id, a])) }), w, 600, null)).toEqual([]);
  });

  test('a ward the player used says when it ended', () => {
    const post = act('post3', 'post', 'p', { seq: 3 });
    const ward = act('u1', 'card', 'p', { targetActId: 'post3', payload: { card: 'shield', ends: '2026-10-31T10:00:00.000Z' } });
    const log = { ...empty, cards: [{ card: 'shield', kind: 'played' as const, act: 'u1', price: 0, at: '2026-10-24T10:00:00.000Z' }] };
    const rows = logRows(data({ log, mine, acts: new Map([post, ward].map((a) => [a.id, a])) }), w, 600, null);
    expect(rows.map((r) => [r.kind, r.at])).toEqual([['wardEnded', '2026-10-31T10:00:00.000Z'], ['played', '2026-10-24T10:00:00.000Z']]);
    expect(text(rows[0]!)).toBe('Shield on your post #3 ended.');
  });
});

/* Cards beyond a post (docs/plans/2026-11-02-alerts-design.md, section 9): every line names its target by its public name and its
   reach, and none names a caster or an owner. */
describe('a play beyond a post, in the caster\'s and the target\'s logs', () => {
  const w: Words = {
    ...words,
    instance: { ...testInstance, cards: [...testInstance.cards,
      { ...testInstance.cards[0]!, key: 'glitter', name: 'Glitter Bomb' },
      { ...testInstance.cards[0]!, key: 'event', name: 'Main Event' },
      { ...testInstance.cards[0]!, key: 'minus', name: 'Minus World' }] },
  };
  const act = (id: string, kind: Act['kind'], character: string | null, over: Partial<Act> = {}): Act =>
    ({ id, kind, character, thread: 'th', targetActId: null, seq: null, createdAt: '2026-10-30T10:00:00.000Z', payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over });
  const text = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');
  const at = '2026-10-30T10:00:00.000Z';
  const ended = '2026-10-31T10:00:00.000Z';
  const names = new Map([['g', 'Gloomba']]);
  const titles = new Map([['tt', 'Thwomp appreciation'], ['bd', 'Hobbies']]);
  const post = act('post1', 'post', 'g', { seq: 1 });
  const caster = [char('p', 'Pipewrench', 'heel')];
  const plays = {
    character: act('k1', 'card', 'p', { targetActId: 'post1', payload: { card: 'glitter', reach: 'character', character: 'g', ends: ended } }),
    thread: act('k2', 'card', 'p', { targetActId: 'post1', payload: { card: 'event', reach: 'thread', thread: 'tt', ends: ended } }),
    board: act('k3', 'card', 'p', { payload: { card: 'minus', reach: 'board', board: 'bd', ends: ended } }),
  };
  const cast = (play: Act, card: string) => {
    const log = { ...empty, cards: [{ card, kind: 'played' as const, act: play.id, price: 0, at }] };
    return logRows(data({ log, mine: caster, acts: new Map([post, play].map((a) => [a.id, a])), names, titles }), w, 600, null);
  };

  test.each([
    ['character', 'glitter', 'Glitter Bomb', 'Gloomba'],
    ['thread', 'event', 'Main Event', '\'Thwomp appreciation\''],
    ['board', 'minus', 'Minus World', 'the Hobbies board'],
  ] as const)('a %s play names its target in the caster\'s played and ended rows', (reach, key, card, place) => {
    const rows = cast(plays[reach], key);
    expect(rows.map((r) => r.kind)).toEqual(['wardEnded', 'played']);
    expect(rows[1]!.what).toBe(`You played ${card} on ${place}`);
    expect(rows[0]!.what).toBe(`${card} on ${place} ended`);
    expect(text(rows[0]!)).toBe(`${card} on ${place} ended.`);
    expect(text(rows[1]!)).toContain(`on ${place}`);
    expect(text(rows[1]!)).not.toMatch(/post/iu);
  });

  test('a post play keeps its words', () => {
    const own = act('post3', 'post', 'p', { seq: 3 });
    const play = act('k4', 'card', 'p', { targetActId: 'post3', payload: { card: 'glitter', ends: ended } });
    const log = { ...empty, cards: [{ card: 'glitter', kind: 'played' as const, act: 'k4', price: 0, at }] };
    const rows = logRows(data({ log, mine: caster, acts: new Map([own, play].map((a) => [a.id, a])) }), w, 600, null);
    expect(rows.map((r) => r.what)).toEqual(['Glitter Bomb ended', 'You played Glitter Bomb']);
    expect(text(rows[0]!)).toBe('Glitter Bomb on your post #3 ended.');
  });

  test.each([
    ['character', 'glitter', 'Glitter Bomb was played on Gloomba'],
    ['thread', 'event', 'Main Event was played on \'Thwomp appreciation\''],
  ] as const)('the target\'s player reads a %s play on theirs, naming no caster', (reach, key, said) => {
    const mine = [char('g', 'Gloomba', 'face')];
    const play = plays[reach];
    const targetName = reach === 'character' ? 'Gloomba' : 'Thwomp appreciation';
    const log = { ...empty, playsOnMine: [{ play: play.id, post: 'post1', at, reach, targetName, targetCharacter: 'g' }] };
    const rows = logRows(data({ log, mine, acts: new Map([post, play].map((a) => [a.id, a])), names, titles }), w, 600, null);
    expect(rows.map((r) => r.kind)).toEqual(['onMine']);
    expect(text(rows[0]!)).toBe(`${said}.`);
    expect(rows[0]!.characters).toEqual(['g']);
    expect(rows[0]!.what).not.toMatch(/post/iu);
    expect(`${rows[0]!.what} ${text(rows[0]!)}`).not.toMatch(/Pipewrench|account|player|owner/iu);
  });

  test('a message the caster left is shown with a play on a thread', () => {
    const mine = [char('g', 'Gloomba', 'face')];
    const play = act('k5', 'card', 'p', { targetActId: 'post1', payload: { ...plays.thread.payload, message: 'Hear ye.' } });
    const log = { ...empty, playsOnMine: [{ play: 'k5', post: 'post1', at, reach: 'thread' as const, targetName: 'Thwomp appreciation', targetCharacter: 'g' }] };
    const rows = logRows(data({ log, mine, acts: new Map([post, play].map((a) => [a.id, a])), names, titles }), w, 600, null);
    expect(text(rows[0]!)).toBe('Main Event was played on \'Thwomp appreciation\', with the message \u201cHear ye.\u201d.');
  });

  test('the name the card was played with is the name the line uses, over what the board is called now', () => {
    const renamed = act('k6', 'card', 'p', { payload: { card: 'minus', reach: 'board', board: 'bd', targetName: 'Old Hobbies', ends: ended } });
    const rows = cast(renamed, 'minus');
    expect(rows[1]!.what).toBe('You played Minus World on the Old Hobbies board');
    const onChar = act('k7', 'card', 'p', { targetActId: 'post1', payload: { card: 'glitter', reach: 'character', character: 'g', targetName: 'Old Gloomba', ends: ended } });
    expect(cast(onChar, 'glitter')[1]!.what).toBe('You played Glitter Bomb on Old Gloomba');
  });

  test('the target\'s row is filed under the target\'s character, not the author of the post it was played from', () => {
    const mine = [char('g', 'Gloomba', 'face'), char('h', 'Hammer', 'face')];
    const elsewhere = act('post2', 'post', 'p', { seq: 2 });
    const play = act('k8', 'card', 'p', { targetActId: 'post2', payload: plays.character.payload });
    const log = { ...empty, playsOnMine: [{ play: 'k8', post: 'post2', at, reach: 'character' as const, targetName: 'Gloomba', targetCharacter: 'g' }] };
    const [row] = logRows(data({ log, mine, acts: new Map([post, elsewhere, play].map((a) => [a.id, a])), names, titles }), w, 600, null);
    expect(row!.characters).toEqual(['g']);
  });

  test('a thread whose title could not be read is said plainly, with no quotes', () => {
    const rows = logRows(data({ log: { ...empty, cards: [{ card: 'event', kind: 'played' as const, act: 'k2', price: 0, at }] }, mine: caster, acts: new Map([post, plays.thread].map((a) => [a.id, a])), names }), w, 600, null);
    expect(rows[1]!.what).toBe('You played Main Event on a thread');
    const mine = [char('g', 'Gloomba', 'face')];
    const log = { ...empty, playsOnMine: [{ play: 'k2', post: 'post1', at, reach: 'thread' as const, targetName: null, targetCharacter: 'g' }] };
    const [row] = logRows(data({ log, mine, acts: new Map([post, plays.thread].map((a) => [a.id, a])), names }), w, 600, null);
    expect(text(row!)).toBe('Main Event was played on a thread.');
  });
});

/* A card may say in the log what a play of it did (CardUi.logPlay; docs/plans/2026-11-03-autocorrect-plan.md, Task 7). */
describe('a card\'s own words for a play', () => {
  const key = testInstance.cards[0]!.key;
  const w: Words = { ...words, ui: { ...words.ui, cards: [{ key, art: { color: '#000', ink: '#fff' }, describe: () => '', logPlay: (config) => (typeof config.phrase === 'string' ? `It covers “${config.phrase}” with “${config.replacement}”.` : undefined) }] } };
  const at = '2026-11-03T10:00:00.000Z';
  const act = (id: string, kind: Act['kind'], character: string | null, over: Partial<Act> = {}): Act =>
    ({ id, kind, character, thread: 'th', targetActId: null, seq: null, createdAt: at, payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over });
  const text = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');
  const post = act('post3', 'post', 'a', { seq: 3 });
  const play = act('k1', 'card', 'c', { targetActId: 'post3', payload: { card: key, config: { phrase: 'mario', replacement: 'Luigi' } } });

  test('the caster\'s played row says it', () => {
    const log = { ...empty, cards: [{ card: key, kind: 'played' as const, act: 'k1', price: 25, at }] };
    const [row] = logRows(data({ log, mine: [char('c', 'Spritey', 'heel')], acts: new Map([post, play].map((a) => [a.id, a])) }), w, 600, null);
    expect(text(row!)).toContain('It covers “mario” with “Luigi”.');
  });

  test('the author\'s "a card on your post" row says it', () => {
    const log = { ...empty, playsOnMine: [{ play: 'k1', post: 'post3', at, reach: 'post' as const, targetName: null, targetCharacter: 'a' }] };
    const [row] = logRows(data({ log, mine: [char('a', 'Pipewrench', 'jabroni')], acts: new Map([post, play].map((a) => [a.id, a])), names: new Map([['c', 'Spritey']]) }), w, 600, null);
    expect(row!.kind).toBe('onMine');
    expect(text(row!)).toContain('It covers “mario” with “Luigi”.');
  });

  test('a caught play says only that it was caught, never what it would have covered', () => {
    const log = { ...empty, cards: [{ card: key, kind: 'played' as const, act: 'k1', price: 25, at }], caught: [{ play: 'k1', card: key, post: 'post3', trap: key, spring: 'sp1', price: 25, boughtPrice: 100, at }] };
    const rows = logRows(data({ log, mine: [char('c', 'Spritey', 'heel')], acts: new Map([post, play].map((a) => [a.id, a])) }), w, 600, null);
    expect(rows.map((r) => r.kind)).toEqual(['caught']);
    expect(text(rows[0]!)).not.toContain('covers');
  });

  test('a card that says nothing adds nothing', () => {
    const quiet: Words = { ...words, ui: { ...words.ui, cards: [{ key, art: { color: '#000', ink: '#fff' }, describe: () => '' }] } };
    const log = { ...empty, cards: [{ card: key, kind: 'played' as const, act: 'k1', price: 25, at }] };
    const [row] = logRows(data({ log, mine: [char('c', 'Spritey', 'heel')], acts: new Map([post, play].map((a) => [a.id, a])) }), quiet, 600, null);
    expect(text(row!)).not.toContain('covers');
  });
});
