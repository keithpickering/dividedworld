/**
 * The log's lines as pure data (lines.ts): the parts the screens' tests reach only through a seeded world, held here on the
 * edges a world rarely makes: a season's end, reasons of two classes, an announcement's word against the reasons', a Turn to
 * the class the window scored, and two pages of one settlement merged.
 */
import { describe, expect, test } from 'vitest';
import type { Act, Log, LogSettlement, MyCharacter, TurnAnnounced, WalletEvent } from '../data/api.ts';
import { testCutter, testInstance } from '../test-world.tsx';
import { actsFollowed, actsNamed, lockoutEnd, logRows, rankChanges, scoredAs, turnsTaken, type LogData, type Words } from './lines.ts';
import { around, mergeLogs } from './useLog.ts';
import type { KayfaApi } from '../data/api.ts';
import { ENGINE_DEFAULT_PRONOUNS, PRONOUN_PRESETS, type PronounSet } from '../../rules/pronouns.ts';

const empty: Log = { infractions: [], bans: [], groupMoves: [], reports: [], appeals: [], settlements: [], wallet: [], cards: [], packs: [], playsOnMine: [], writes: [], saves: [], setEnds: [], caught: [], ended: [], cosmetics: [], falls: [], before: null };
const settled = (id: number, endsAt: string, lines: LogSettlement['lines']): LogSettlement => ({ id, startsAt: new Date(Date.parse(endsAt) - 86_400_000).toISOString(), endsAt, sharesKept: true, lines });
const char = (id: string, name: string, cls: string, classSince = '2026-10-01T00:00:00.000Z', pronouns: PronounSet = ENGINE_DEFAULT_PRONOUNS): MyCharacter =>
  ({ id, name, pronouns, class: cls, classSince, classShownAt: null, classDueAt: null, turnOpensAt: null, debutedAt: '2026-10-01T00:00:00.000Z', debutLoudness: 'announced', retiredAt: null, pendingTurn: null, presenceHidden: false });
const words: Words = {
  instance: testInstance,
  ui: { reasonWords: (r) => ({ 'heel.drewHeat': 'Drew heat: x', 'face.cheered': 'Cheered: y' } as Record<string, string>)[r] ?? r, quadrantLabels: { excitedNegative: 'Heat', excitedPositive: 'Hype', boredNegative: 'Groan', calmPositive: 'Calm' }, cards: [], copy: { siteName: '', siteTagline: '', roleWord: 'The Boss', staffWord: 'The staff', gameWord: 'the game', staffBoardTag: 'Staff post here; you react and spin', shopName: 'Shop', reducedMotionCard: '' }, packs: {} },
  postsPerPage: 20,
  economy: {},
  /* The time the log's "has ended" is read at: a fixed one, in the week the fixtures are dated (a test's result never depends on the date it runs). */
  now: Date.parse('2026-11-30T00:00:00.000Z'),
};
const data = (over: Partial<LogData>): LogData => ({
  log: empty, mine: [], estimate: null, standings: {}, season: null, turns: [], nextSettlement: null, acts: new Map(), names: new Map(), titles: new Map(), states: new Map(), ...over,
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
    expect(turnsTaken(data({ log, mine: [p], turns }), testInstance).get(1)).toEqual([{ character: 'p', classNow: 'face', classWas: 'lurker', announced: turns[0], dueAt: null }]);
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

  /* The settle claim design, section 4: a Turn the backstop passed over says why it came a settlement late. */
  test('a Turn that waited past a reveal says when it was due, and why it waited', () => {
    const before = '2026-10-29T08:17:00.000Z';
    const p = { ...char('p', 'Pipewrench', 'face', at), classDueAt: before };
    const log = { ...empty, settlements: [settled(2, at, [{ character: 'p', reason: 'heel.drewHeat', amount: 5, shares: [] }]), settled(1, before, [])] };
    const turn = logRows(data({ log, mine: [p] }), words, 600, null).find((r) => r.kind === 'turn')!;
    expect(text(turn)).toBe('Pipewrench is a Face now. A silent Turn: no one else was told.'
      + ' It was due at the settlement of Oct 29 and waited for this one: Pipewrench revealed after that window had ended.');
    const onTime = logRows(data({ log, mine: [char('p', 'Pipewrench', 'face', at)] }), words, 600, null).find((r) => r.kind === 'turn')!;
    expect(text(onTime)).not.toContain('It was due');
  });
});

/* The card mechanic's lines (docs/plans/2026-11-01-card-plays-plan.md, Task 6; the design's section 10): the setter's set, spring,
   payout and end, the caster's catch and the struck player's strike, each in plain words, none naming an owner or a reactor. */
describe('cards set face down, traps and catches', () => {
  const trapWorld = {
    ...testInstance,
    cards: [
      ...testInstance.cards,
      { ...testInstance.cards[0]!, key: 'snare', name: 'Snare', rarity: 'uncommon' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const } }, catches: () => 'whoops' },
      { ...testInstance.cards[0]!, key: 'lure', name: 'Lure', rarity: 'uncommon' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const }, match: { flavors: ['salty' as const], upTo: 'common' as const } } },
      { ...testInstance.cards[0]!, key: 'dud', name: 'Dud', play: 'set' as const },
      { ...testInstance.cards[0]!, key: 'hook', name: 'Hook', rarity: 'uncommon' as const, play: 'set' as const, trap: { trigger: { on: 'reply' } as never } },
      { ...testInstance.cards[0]!, key: 'pass', name: 'Hall Pass', rarity: 'rare' as const, play: 'set' as const, trap: { trigger: { on: 'visit' as const } } },
      { ...testInstance.cards[0]!, key: 'glitter', name: 'Glitter Bomb', reaches: ['character' as const] },
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

  const setRow = (card: string, extra: Record<string, unknown> = {}) => {
    const set = act('set1', 'set', 'p', { targetActId: 'post3' });
    const log = { ...empty, cards: [{ card, kind: 'played' as const, act: 'set1', price: 0, at, ...extra }] };
    return logRows(data({ log, mine, acts: new Map([...posts, set].map((a) => [a.id, a])), names }), w, 600, null)[0]!;
  };

  test('a Move set face down says it waits to spring on a quote, and names its card to the setter alone', () => {
    const row = setRow('whoops', { springs: true });
    expect(row.kind).toBe('set');
    expect(row.what).toBe('You set Whoops! face down');
    expect(text(row)).toBe('Whoops! set face down on your post #3. It waits to spring on a quote, and ends by itself if none comes.');
  });

  test('a Move set with a phrase says the phrase it waits for', () => {
    expect(text(setRow('whoops', { springs: true, phrase: 'good luck' }))).toBe('Whoops! set face down on your post #3. It waits to spring on a quote that says “good luck”, and ends by itself if none comes.');
  });

  /* Quote conditions (quote-conditions plan, Task 6): the setter's own line names every condition in full, the Anyone-but list included. */
  describe('quote conditions in the log', () => {
    const long = 'the punchline that goes on and on and on past forty characters of a long joke';
    const sprungText = (payload: Record<string, unknown>) => {
      const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'whoops', trigger: 'quote', did: 'landed', set: 'set1', by: 'post4', ...payload } });
      const log = { ...empty, setEnds: [{ play: 'set1', card: 'whoops', post: 'post3', spring: 'sp', endedAt: later, endedBy: 'sprung' as const }] };
      return text(logRows(data({ log, mine, acts: new Map([...posts, spring].map((a) => [a.id, a])), names }), w, 600, null)[0]!);
    };
    const ids = { s: 's', b: 'b' };
    const namesB = new Map([['s', 'Spritey'], ['b', 'Boshi']]);
    const setWith = (extra: Record<string, unknown>) => {
      const set = act('set1', 'set', 'p', { targetActId: 'post3' });
      const log = { ...empty, cards: [{ card: 'whoops', kind: 'played' as const, act: 'set1', price: 0, at, springs: true, ...extra }] };
      return text(logRows(data({ log, mine, acts: new Map([...posts, set].map((a) => [a.id, a])), names: namesB }), w, 600, null)[0]!);
    };
    test('the set line: Only these with a passage and a phrase, in full', () => {
      expect(setWith({ passage: 'the punchline', phrase: 'nice try', who: [ids.s, ids.b], whoExcept: false }))
        .toBe('Whoops! set face down on your post #3. It waits to spring when Spritey or Boshi quotes “the punchline” saying “nice try”, and ends by itself if none comes.');
    });
    test('the set line: Anyone but names the list, to the setter alone', () => {
      expect(setWith({ who: [ids.b], whoExcept: true }))
        .toBe('Whoops! set face down on your post #3. It waits to spring when anyone but Boshi quotes it, and ends by itself if none comes.');
    });
    test('the set line: each condition alone and in pairs', () => {
      expect(setWith({ passage: 'the punchline' })).toContain('It waits to spring when someone quotes “the punchline”, and ends');
      expect(setWith({ who: [ids.s], whoExcept: false })).toContain('It waits to spring when Spritey quotes it, and ends');
      expect(setWith({ who: [ids.s], whoExcept: false, phrase: 'nice try' })).toContain('when Spritey quotes it saying “nice try”, and ends');
      expect(setWith({ passage: long })).toContain(`quotes “${long}”, and ends`);
    });
    test('the sprung line names the matched conditions, shortened, and never the Anyone-but list', () => {
      expect(sprungText({ when: { passage: 'the punchline', says: 'nice try' } }))
        .toBe('Whoops! on your post #3 sprang when Spritey quoted “the punchline” saying “nice try”, and landed on Spritey\'s post #4.');
      expect(sprungText({ when: { says: 'nice try' }, for: 's' })).toContain('sprang when Spritey quoted it saying “nice try”, and landed');
      expect(sprungText({ when: { passage: long } })).toContain('quoted “the punchline that goes on and on and on…”, and landed');
      expect(sprungText({})).toBe('Whoops! on your post #3 sprang when Spritey quoted it, and landed on Spritey\'s post #4.');
    });
    test('the struck player\'s log line names the matched conditions, shortened', () => {
      const spring = act('sp', 'spring', 's', { targetActId: 'post4', payload: { card: 'whoops', trigger: 'quote', did: 'landed', set: 'setS', by: 'post3', when: { passage: long, says: 'nice try' } } });
      const struck = act('k3', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', spring: 'sp' } });
      const log = { ...empty, playsOnMine: [{ play: 'k3', post: 'post3', at, reach: 'post' as const, targetName: null, targetCharacter: 'p' }] };
      const [row] = logRows(data({ log, mine, acts: new Map([...posts, spring, struck].map((a) => [a.id, a])), names }), w, 600, null);
      expect(text(row!)).toContain('quoted it, and landed'.replace('quoted it', 'quoted “the punchline that goes on and on and on…” saying “nice try”'));
    });
  });

  /* The setter's line names every Who in full, so useLog reads the names of the characters a face-down card's Who names, not only those on the page. */
  test('the set line names a Who character that is neither the setter\'s nor on the page, once useLog has read around the log', async () => {
    const set = act('set1', 'set', 'p', { targetActId: 'post3' });
    const log = { ...empty, cards: [{ card: 'whoops', kind: 'played' as const, act: 'set1', price: 0, at, springs: true, who: ['g1', 'g2'], whoExcept: false }] };
    const asked: string[][] = [];
    const api = {
      actsById: async () => [], actsCutting: async () => [],
      effectStates: async () => ({}),
      characters: async (ids: readonly string[]) => { asked.push([...ids]); return ids.map((id) => ({ id, name: id === 'g1' ? 'Gloomba' : 'Gizmo' })); },
      thread: async () => null,
      board: async () => null,
    } as unknown as KayfaApi;
    const own = data({ log, mine, acts: new Map([...posts, set].map((a) => [a.id, a])), names: new Map() });
    const read = await around(api, log, own);
    expect(asked.flat()).toEqual(expect.arrayContaining(['g1', 'g2']));
    expect(text(logRows(read, w, 600, null)[0]!)).toBe('Whoops! set face down on your post #3. It waits to spring when Gloomba or Gizmo quotes it, and ends by itself if none comes.');
  });

  /* A spring's `for` is the quoting character's id (public as the quote's author, kept as a fallback for the Lens alone); no line, alert or toast prints it. */
  test('a spring\'s `for` id is printed in no log line', () => {
    const FOR = 'cFOR-ID-7';
    const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'whoops', trigger: 'quote', did: 'landed', set: 'set1', by: 'post4', for: FOR, when: { passage: 'a', says: 'b' } } });
    const sets = { ...empty, setEnds: [{ play: 'set1', card: 'whoops', post: 'post3', spring: 'sp', endedAt: later, endedBy: 'sprung' as const }], cards: [{ card: 'whoops', kind: 'played' as const, act: 'set1', price: 0, at, springs: true, who: ['s'], whoExcept: false }] };
    const setAct = act('set1', 'set', 'p', { targetActId: 'post3' });
    const struck = act('k3', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', spring: 'sp' } });
    const strikeLog = { ...empty, playsOnMine: [{ play: 'k3', post: 'post3', at, reach: 'post' as const, targetName: null, targetCharacter: 'p' }] };
    const acts = new Map([...posts, setAct, spring, struck].map((a) => [a.id, a]));
    for (const log of [sets, strikeLog]) for (const r of logRows(data({ log, mine, acts, names }), w, 600, null)) expect(text(r)).not.toContain(FOR);
  });

  test('a catching set card names the card it waits for; a Hall Pass waits for a Mod Bot\'s visit', () => {
    expect(text(setRow('snare', { springs: true, catches: 'whoops' }))).toBe('Snare set face down on your post #3. It waits for a Whoops!, and ends by itself if none comes.');
    expect(text(setRow('pass', { springs: true }))).toBe('Hall Pass set face down on your post #3. It waits for a Mod Bot\'s visit, and ends by itself if none comes.');
  });

  test('a set card that waits for a match says what it matches; a row that names its card still names it', () => {
    expect(text(setRow('lure', { springs: true }))).toBe('Lure set face down on your post #3. It waits for a Salty card, up to common, and ends by itself if none comes.');
    expect(text(setRow('lure', { springs: true, catches: 'whoops' }))).toBe('Lure set face down on your post #3. It waits for a Whoops!, and ends by itself if none comes.');
  });

  test('a back set before the named catch keeps the words it had', () => {
    expect(text(setRow('snare'))).toBe('Snare set face down on your post #3. It waits for the card it names, and ends by itself if none comes.');
    expect(text(setRow('hook'))).toBe('Hook set face down on your post #3. It springs once, or ends by itself.');
  });

  test('a card with no trap set face down says it never springs (#136 F3)', () => {
    const row = setRow('dud', { springs: false });
    expect(row.what).toBe('You set Dud face down');
    expect(text(row)).toBe('Dud set face down on your post #3. It never springs, and ends by itself.');
  });

  /* A lockout back (the lockout outcome): the Move landed and its character is locked out of the thread; each line branches on the spring's `did`, never a card's key. */
  describe('a lockout', () => {
    const until = '2026-11-01T10:00:00.000Z';
    const move = act('k1', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', lockedOut: 'sp' } });
    const lock = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'snare', trigger: 'cast', did: 'lockedOut', set: 'set1', by: 'k1', locks: 's', until } });
    const end = act('end', 'card_end', null, { targetActId: 'sp', createdAt: '2026-10-31T12:30:00.000Z' });
    const setter = (extra: readonly Act[] = []) => {
      const log = { ...empty, setEnds: [{ play: 'set1', card: 'snare', post: 'post3', spring: 'sp', endedAt: later, endedBy: 'sprung' as const }] };
      return logRows(data({ log, mine, acts: new Map([...posts, move, lock, ...extra].map((a) => [a.id, a])), names }), w, 600, null)[0]!;
    };
    const caster = (extra: readonly Act[] = []) => {
      const log = { ...empty, cards: [{ card: 'whoops', kind: 'played' as const, act: 'k1', price: 0, at }] };
      return logRows(data({ log, mine: [char('s', 'Spritey', 'heel')], acts: new Map([...posts, move, lock, ...extra].map((a) => [a.id, a])), names: new Map([['p', 'Pipewrench']]) }), w, 600, null);
    };
    test('the setter\'s line says the Move landed and the caster is locked out until a time', () => {
      const row = setter();
      expect(row.kind).toBe('sprung');
      expect(text(row)).toBe('Snare on your post #3 sprang when Spritey played Whoops! on it. Whoops! landed, and Spritey is locked out of the thread until Nov 1 · 10:00 UTC.');
      expect([row.aura, row.wallet]).toEqual([0, null]);
    });
    test('an admin who ended it early is named plainly, with the time, in either line', () => {
      expect(text(setter([end]))).toContain('Spritey was locked out of the thread until Nov 1 · 10:00 UTC. An admin ended it at Oct 31 · 12:30 UTC.');
      const rows = caster([end]);
      expect(text(rows.find((r) => r.kind === 'struck')!)).toContain('until Nov 1 · 10:00 UTC. An admin ended it at Oct 31 · 12:30 UTC.');
    });
    test('the caster\'s line is found through the play\'s `lockedOut`, whatever the spring\'s own `by` says', () => {
      const other = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { ...lock.payload, by: 'elsewhere' } });
      const log = { ...empty, cards: [{ card: 'whoops', kind: 'played' as const, act: 'k1', price: 0, at }] };
      const rows = logRows(data({ log, mine: [char('s', 'Spritey', 'heel')], acts: new Map([...posts, move, other].map((a) => [a.id, a])), names: new Map([['p', 'Pipewrench']]) }), w, 600, null);
      expect(text(rows.find((r) => r.kind === 'struck')!)).toBe('The Snare on Pipewrench\'s post #3 locked Spritey out of this thread until Nov 1 · 10:00 UTC.');
    });
    test('actsFollowed reaches the spring from the play\'s `lockedOut`', () => {
      expect(actsFollowed(new Map([['k1', move]]))).toEqual(expect.arrayContaining(['sp']));
    });
    test('the log names the end of a lockout (`my_cards_ended`) so its Act is read, and the lockout\'s own lines say it; no line of "your card ended" is added', () => {
      const entry = { cardEnd: 'end', play: 'sp', card: 'snare', at, side: 'onMine' as const, reach: 'post' as const, targetName: null, postAuthorName: 'Pipewrench', casterName: 'Pipewrench', character: 's' };
      expect(actsNamed({ ...empty, ended: [entry] }, null, [])).toEqual(expect.arrayContaining(['sp', 'end']));
      const log = { ...empty, cards: [{ card: 'whoops', kind: 'played' as const, act: 'k1', price: 0, at }], ended: [entry] };
      const rows = logRows(data({ log, mine: [char('s', 'Spritey', 'heel')], acts: new Map([...posts, move, lock, end].map((a) => [a.id, a])), names: new Map([['p', 'Pipewrench']]) }), w, 600, null);
      expect(rows.map((r) => r.kind)).toEqual(['played', 'struck']);
      expect(text(rows.find((r) => r.kind === 'struck')!)).toContain('An admin ended it at Oct 31 · 12:30 UTC.');
    });
    test('the caster\'s line, after its play line, names the card, the post and the character', () => {
      const rows = caster();
      expect(rows.map((r) => r.kind)).toEqual(['played', 'struck']);
      const row = rows.find((r) => r.kind === 'struck')!;
      expect(text(row)).toBe('The Snare on Pipewrench\'s post #3 locked Spritey out of this thread until Nov 1 · 10:00 UTC.');
      expect(row.details.some((d) => typeof d !== 'string')).toBe(true);
      expect(row.characters).toEqual(['s']);
    });
    test('none of the new lines says "cast"', () => {
      for (const r of [setter(), caster().find((x) => x.kind === 'struck')!, setter([end])]) expect(`${r.what} ${text(r)}`).not.toMatch(/cast/i);
    });
  });

  test('a quote sprang a Move: what it landed on, and whose quote set it off', () => {
    const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'whoops', trigger: 'quote', did: 'landed', set: 'set1', by: 'post4' } });
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'whoops', post: 'post3', spring: 'sp', endedAt: later, endedBy: 'sprung' as const }] };
    const [row] = logRows(data({ log, mine, acts: new Map([...posts, spring].map((a) => [a.id, a])), names }), w, 600, null);
    expect(row!.kind).toBe('sprung');
    expect(text(row!)).toBe('Whoops! on your post #3 sprang when Spritey quoted it, and landed on Spritey\'s post #4.');
    expect([row!.aura, row!.wallet]).toEqual([0, null]);
  });

  test('a quote sprang a Move that lands beyond a post: on the quoting post\'s character', () => {
    const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'glitter', trigger: 'quote', did: 'landed', set: 'set1', by: 'post4' } });
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'glitter', post: 'post3', spring: 'sp', endedAt: later, endedBy: 'sprung' as const }] };
    const [row] = logRows(data({ log, mine, acts: new Map([...posts, spring].map((a) => [a.id, a])), names }), w, 600, null);
    expect(text(row!)).toBe('Glitter Bomb on your post #3 sprang when Spritey quoted it, and landed on Spritey.');
  });

  test('a catching set card caught a cast: what it caught, and that the card is in the setter\'s hand', () => {
    const play = act('k1', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', caught: 'set1' } });
    const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'snare', trigger: 'cast', did: 'caught', set: 'set1', by: 'k1', caught: 'k1' } });
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'snare', post: 'post3', spring: 'sp', endedAt: later, endedBy: 'sprung' as const }] };
    const [row] = logRows(data({ log, mine, acts: new Map([...posts, play, spring].map((a) => [a.id, a])), names }), w, 600, null);
    expect(row!.kind).toBe('sprung');
    expect(text(row!)).toBe('Snare on your post #3 sprang when Spritey cast Whoops! on it. It caught the Whoops!, which is in your hand now.');
    expect([row!.aura, row!.wallet]).toEqual([0, null]);
  });

  test('the setter\'s ledger row for a caught card says it went to their hand, naming their character', () => {
    const play = act('k1', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', caught: 'set1' } });
    const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'snare', trigger: 'cast', did: 'caught', set: 'set1', by: 'k1', caught: 'k1' } });
    const log = { ...empty, cards: [{ card: 'whoops', kind: 'caught' as const, act: 'sp', price: 0, at: later }] };
    const rows = logRows(data({ log, mine, acts: new Map([...posts, play, spring].map((a) => [a.id, a])), names }), w, 600, null);
    expect(rows.map((r) => r.kind)).toEqual(['caught']);
    expect(rows[0]!.what).toBe('You caught Whoops!');
    expect(text(rows[0]!)).toBe('Pipewrench\'s Snare caught Spritey\'s Whoops! on your post #3; the Whoops! went to Pipewrench\'s hand.');
    expect([rows[0]!.aura, rows[0]!.wallet]).toEqual([0, null]);
    expect(rows[0]!.characters).toEqual(['p']);
  });

  test('none of the face-down lines names an account, an owner or a reactor: only characters\' names', () => {
    const play = act('k1', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', caught: 'set1' } });
    const caught = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'snare', trigger: 'cast', did: 'caught', set: 'set1', by: 'k1', caught: 'k1' } });
    const landed = act('sq', 'spring', 'p', { targetActId: 'post3', payload: { card: 'whoops', trigger: 'quote', did: 'landed', set: 'set2', by: 'post4' } });
    const log = { ...empty, cards: [{ card: 'whoops', kind: 'caught' as const, act: 'sp', price: 0, at: later }],
      setEnds: [{ play: 'set1', card: 'snare', post: 'post3', spring: 'sp', endedAt: later, endedBy: 'sprung' as const }, { play: 'set2', card: 'whoops', post: 'post3', spring: 'sq', endedAt: later, endedBy: 'sprung' as const }] };
    const all = logRows(data({ log, mine, acts: new Map([...posts, play, caught, landed].map((a) => [a.id, a])), names }), w, 600, null).map(text).join(' ');
    expect(all).toContain('hand');
    expect(all).not.toMatch(/account|player|owner|reacted/iu);
  });

  test('a Hall Pass ended a visit', () => {
    const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'pass', trigger: 'visit', did: 'ended', set: 'set1' } });
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'pass', post: 'post3', spring: 'sp', endedAt: later, endedBy: 'sprung' as const }] };
    const [row] = logRows(data({ log, mine, acts: new Map([...posts, spring].map((a) => [a.id, a])), names }), w, 600, null);
    expect(row!.kind).toBe('sprung');
    expect(text(row!)).toBe('Hall Pass on your post #3 sprang when a Mod Bot\'s visit began, and ended the visit.');
  });

  test('rows written before the face-down Moves read through their old words: a payout and a strike', () => {
    const play = act('k1', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', caught: 'set1' } });
    const paid = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'snare', trigger: 'cast', outcome: { do: 'payout' }, set: 'set1', by: 'k1', caught: 'k1' } });
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'snare', post: 'post3', spring: 'sp', endedAt: later, endedBy: 'sprung' as const }],
      wallet: [{ settlement: null, kind: 'trap' as const, change: 75, overflow: 0, floored: 0, balanceAfter: 475, ref: 'sp', at: later }] };
    const [row] = logRows(data({ log, mine, acts: new Map([...posts, play, paid].map((a) => [a.id, a])), names }), w, 600, null);
    expect(row!.kind).toBe('payout');
    expect(text(row!)).toBe('Snare caught Spritey\'s Whoops! on your post #3; +0.75 to your wallet.');
    expect([row!.aura, row!.wallet]).toEqual([75, 475]);
    const strike = act('sp2', 'spring', 'p', { targetActId: 'post3', payload: { card: 'hook', trigger: 'reply', outcome: { do: 'strike', card: 'whoops' }, set: 'set2', by: 'post4' } });
    const log2 = { ...empty, setEnds: [{ play: 'set2', card: 'hook', post: 'post3', spring: 'sp2', endedAt: later, endedBy: 'sprung' as const }] };
    const [row2] = logRows(data({ log: log2, mine, acts: new Map([...posts, strike].map((a) => [a.id, a])), names }), w, 600, null);
    expect(row2!.kind).toBe('sprung');
    expect(text(row2!)).toBe('Hook on your post #3 sprang on a reply, and laid Whoops! on Spritey\'s post #4.');
  });

  test('a staff card a trap caught is paid by the game, in plain words, and the amount reaches the wallet', () => {
    const play = act('k1', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', caught: 'set1' } });
    const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'snare', trigger: 'cast', outcome: { do: 'payout' }, set: 'set1', by: 'k1', caught: 'k1' } });
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'snare', post: 'post3', spring: 'sp', endedAt: later, endedBy: 'sprung' as const }],
      wallet: [{ settlement: null, kind: 'trapSystem' as const, change: 75, overflow: 0, floored: 0, balanceAfter: 75, ref: 'sp', at: later }] };
    const [row] = logRows(data({ log, mine, acts: new Map([...posts, play, spring].map((a) => [a.id, a])), names }), w, 600, null);
    expect(row!.kind).toBe('payout');
    expect(text(row!)).toBe('Your Snare caught Spritey\'s Whoops! The game paid you 0.75 Aura.');
    expect([row!.aura, row!.wallet]).toEqual([75, 75]);
  });

  test('a capped trapper is told what was credited, never the base price', () => {
    const play = act('k1', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', caught: 'set1' } });
    const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'snare', trigger: 'cast', outcome: { do: 'payout' }, set: 'set1', by: 'k1', caught: 'k1' } });
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'snare', post: 'post3', spring: 'sp', endedAt: later, endedBy: 'sprung' as const }],
      wallet: [{ settlement: null, kind: 'trapSystem' as const, change: 20, overflow: 55, floored: 0, balanceAfter: 10000, ref: 'sp', at: later }] };
    const [row] = logRows(data({ log, mine, acts: new Map([...posts, play, spring].map((a) => [a.id, a])), names }), w, 600, null);
    expect(text(row!)).toBe('Your Snare caught Spritey\'s Whoops! The game paid you 0.20 Aura.');
    expect([row!.aura, row!.wallet]).toEqual([20, 10000]);
  });

  test('a card back that ended says nothing sprang it', () => {
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'dud', post: 'post3', spring: null, endedAt: later, endedBy: 'time' as const }] };
    const [row] = logRows(data({ log, mine, acts: new Map(posts.map((a) => [a.id, a])), names }), w, 600, null);
    expect(row!.kind).toBe('setEnded');
    expect(text(row!)).toBe('Dud on your post #3 ended; nothing sprang it, and it came back to your hand.');
    expect(row!.characters).toEqual(['p']);
  });

  test('a card back the player took back says so, naming the card and the post, and no card event adds a played line', () => {
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'dud', post: 'post3', spring: null, endedAt: later, endedBy: 'taken back' as const }],
      cards: [{ card: 'dud', kind: 'played' as const, act: 'set1', price: 0, at, springs: false }, { card: 'dud', kind: 'returned' as const, act: 'tb1', price: 0, at: later }] };
    const tb = act('tb1', 'take_back', 'p', { targetActId: 'post3', payload: { set: 'set1' } });
    const set = act('set1', 'set', 'p', { targetActId: 'post3' });
    const rows = logRows(data({ log, mine, acts: new Map([...posts, tb, set].map((a) => [a.id, a])), names }), w, 600, null);
    expect(rows.filter((r) => r.kind === 'played')).toEqual([]);
    const row = rows.find((r) => r.key === 'setEnded:set1')!;
    expect(row.what).toBe('You took back Dud');
    expect(text(row)).toBe('You took back Dud from your post #3.');
    expect(rows.map((r) => r.kind)).not.toContain('returned');
  });

  describe('a play a trap caught says where the card went only for a spring that says so', () => {
    const others = [act('post9', 'post', 's', { seq: 9 }), act('k2', 'card', 'p', { targetActId: 'post9', payload: { card: 'whoops', caught: 'setX' } })];
    const log = { ...empty,
      cards: [{ card: 'whoops', kind: 'played' as const, act: 'k2', price: 75, at }],
      caught: [{ play: 'k2', card: 'whoops', post: 'post9', trap: 'snare', spring: 'spX', price: 75, at }],
      wallet: [{ settlement: null, kind: 'play' as const, change: -75, overflow: 0, floored: 0, balanceAfter: 225, ref: 'k2', at }] };
    const read = (payload: Record<string, unknown>, staff?: Set<string>) => {
      const spring = act('spX', 'spring', 's', { targetActId: 'post9', payload: { card: 'snare', trigger: 'cast', set: 'setX', by: 'k2', caught: 'k2', ...payload } });
      return text(logRows(data({ log, mine, acts: new Map([...others, spring].map((a) => [a.id, a])), names, ...(staff ? { staff } : {}) }), w, 600, null)[0]!);
    };
    test('a spring written before: the card was spent, and its old words stand', () => {
      expect(read({ outcome: { do: 'payout' } })).toBe('Your Whoops! on Spritey\'s post #9 was caught by a Snare; the cast cost 0.75, and nothing came back.');
    });
    test('a spring that is not read keeps the old words too', () => {
      const rows = logRows(data({ log, mine, acts: new Map(others.map((a) => [a.id, a])), names }), w, 600, null);
      expect(text(rows[0]!)).toBe('Your Whoops! on Spritey\'s post #9 was caught by a Snare; the cast cost 0.75, and nothing came back.');
    });
    test('a staff setter takes nothing: the card is spent', () => {
      expect(read({ did: 'caught' }, new Set(['s']))).toBe('Your Whoops! on Spritey\'s post #9 was caught by a Snare, and the card is spent; the cast cost 0.75, and nothing came back to you.');
    });
  });

  describe('a Move a pierce got past a ward', () => {
    const read = (payload: Record<string, unknown>) => {
      const cast = act('k3', 'card', 'p', { targetActId: 'post4', payload: { card: 'whoops', reach: 'post', ...payload } });
      const log = { ...empty, cards: [{ card: 'whoops', kind: 'played' as const, act: 'k3', price: 75, at }] };
      return logRows(data({ log, mine, acts: new Map([...posts, cast].map((a) => [a.id, a])), names }), w, 600, null).filter((r) => r.kind === 'played').map(text);
    };
    test('the caster\'s line gains the pierce and the ward it got past', () => {
      expect(read({ pierce: { by: 'pc', card: 'pass', ward: 'whoops' } })[0]).toContain(' Your Hall Pass got it past a Whoops! that would have turned it away.');
    });
    test('a pierce with no ward adds nothing, and a cast with no pierce reads as before', () => {
      expect(read({ pierce: { by: 'pc', card: 'pass' } })[0]).not.toContain('got it past');
      expect(read({})[0]).not.toContain('got it past');
    });
    test('a malformed pierce adds nothing', () => {
      expect(read({ pierce: 'pass' })[0]).not.toContain('got it past');
      expect(read({ pierce: { by: 'pc', card: 'pass', ward: 123 } })[0]).not.toContain('got it past');
    });
  });

  test('a caught play is the caster\'s line, with its whole cost, and no line of its own as a play', () => {
    const others = [act('post9', 'post', 's', { seq: 9 }), act('k2', 'card', 'p', { targetActId: 'post9', payload: { card: 'whoops', caught: 'setX' } })];
    const log = { ...empty,
      cards: [{ card: 'whoops', kind: 'played' as const, act: 'k2', price: 75, at }],
      caught: [{ play: 'k2', card: 'whoops', post: 'post9', trap: 'snare', spring: 'spX', price: 75, at }],
      wallet: [{ settlement: null, kind: 'play' as const, change: -75, overflow: 0, floored: 0, balanceAfter: 225, ref: 'k2', at }] };
    const spring = act('spX', 'spring', 's', { targetActId: 'post9', payload: { card: 'snare', trigger: 'cast', did: 'caught', set: 'setX', by: 'k2', caught: 'k2' } });
    const rows = logRows(data({ log, mine, acts: new Map([...others, spring].map((a) => [a.id, a])), names }), w, 600, null);
    expect(rows.map((r) => r.kind)).toEqual(['caught']);
    expect(rows[0]!.what).toBe('Your Whoops! was caught');
    expect(text(rows[0]!)).toBe('Your Whoops! on Spritey\'s post #9 was caught by a Snare, and went to Spritey; the cast cost 0.75, and nothing came back to you.');
    expect([rows[0]!.aura, rows[0]!.wallet]).toEqual([-75, 225]);
  });

  describe('a card an admin ended', () => {
    const ended = (o: Record<string, unknown>) => ({ cardEnd: 'e1', play: 'k9', card: 'whoops', at, side: 'cast' as const, reach: 'post' as const, targetName: null, postAuthorName: 'Spritey', casterName: 'Pipewrench', character: 'p', ...o });
    const read = (e: ReturnType<typeof ended>, acts: Act[] = []) =>
      logRows(data({ log: { ...empty, ended: [e] }, mine, acts: new Map([...posts, ...acts].map((a) => [a.id, a])), names }), w, 600, null);

    test('the caster\'s line says it was ended on a post, and that what it cost and the card did not come back', () => {
      const rows = read(ended({}), [act('k9', 'card', 'p', { targetActId: 'post4' })]);
      expect(rows.map((r) => r.kind)).toEqual(['ended']);
      expect(text(rows[0]!)).toBe('An admin ended your Whoops! on Spritey\'s post #4. Its cost and the card are not refunded.');
      expect([rows[0]!.aura, rows[0]!.wallet]).toEqual([0, null]);
    });
    test('without the post read, it still names the author', () => {
      expect(text(read(ended({}))[0]!)).toBe('An admin ended your Whoops! on Spritey\'s post. Its cost and the card are not refunded.');
    });
    test('a card the caster cast beyond a post names its target', () => {
      expect(text(read(ended({ reach: 'character', targetName: 'Gizmo' }))[0]!)).toBe('An admin ended your Whoops! on Gizmo. Its cost and the card are not refunded.');
      expect(text(read(ended({ reach: 'thread', targetName: 'Hobbies' }))[0]!)).toBe('An admin ended your Whoops! on the thread \'Hobbies\'. Its cost and the card are not refunded.');
      expect(text(read(ended({ reach: 'board', targetName: 'Lobby' }))[0]!)).toBe('An admin ended your Whoops! on the Lobby board. Its cost and the card are not refunded.');
    });
    test('the line of the one it landed on names the caster and says nothing of a refund', () => {
      const post = (e: object) => text(read(ended({ side: 'onMine', postAuthorName: 'Pipewrench', casterName: 'Spritey', ...e }), [act('k9', 'card', 's', { targetActId: 'post3' })])[0]!);
      expect(post({})).toBe('An admin ended Spritey\'s Whoops! on your post #3.');
      expect(text(read(ended({ side: 'onMine', reach: 'character', targetName: 'Pipewrench', casterName: 'Spritey' }))[0]!)).toBe('An admin ended Spritey\'s Whoops! on your character Pipewrench.');
      expect(text(read(ended({ side: 'onMine', reach: 'thread', targetName: 'Hobbies', casterName: 'Spritey' }))[0]!)).toBe('An admin ended Spritey\'s Whoops! on your thread \'Hobbies\'.');
    });
    test('each line is filed under the character the view names, for every reach', () => {
      const tabs = (e: object) => read(ended({ side: 'onMine', casterName: 'Spritey', ...e }))[0]!.characters;
      expect(tabs({ reach: 'character', targetName: 'Gizmo', character: 'g' })).toEqual(['g']);
      expect(tabs({ reach: 'thread', targetName: 'Hobbies', character: 'p' })).toEqual(['p']);
      expect(read(ended({ reach: 'board', targetName: 'Lobby', character: 'p' }))[0]!.characters).toEqual(['p']);
    });
    test('the log follows each line to its play, and no row means no line (a third party\'s reversal is not in the view)', () => {
      expect(actsNamed({ ...empty, ended: [ended({})] }, null, [])).toContain('k9');
      expect(logRows(data({ log: empty, mine, acts: new Map(posts.map((a) => [a.id, a])), names }), w, 600, null)).toEqual([]);
    });
  });

  test('a face-down card that struck the player\'s post is their line: the setter\'s character, and that their quote set it off', () => {
    const spring = act('sp', 'spring', 's', { targetActId: 'post4', payload: { card: 'whoops', trigger: 'quote', did: 'landed', set: 'setS', by: 'post3' } });
    const struck = act('k3', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', spring: 'sp' } });
    const log = { ...empty, playsOnMine: [{ play: 'k3', post: 'post3', at, reach: 'post' as const, targetName: null, targetCharacter: 'p' }] };
    const [row] = logRows(data({ log, mine, acts: new Map([...posts, spring, struck].map((a) => [a.id, a])), names }), w, 600, null);
    expect(row!.kind).toBe('struck');
    expect(row!.what).toBe('A face-down card struck your post');
    expect(text(row!)).toBe('Spritey\'s face-down Whoops! on Spritey\'s post #4 sprang when your post #3 quoted it, and landed on your post #3.');
  });

  test('a strike written before the face-down Moves keeps its words', () => {
    const spring = act('sp', 'spring', 's', { targetActId: 'post4', payload: { card: 'hook', trigger: 'reply', outcome: { do: 'strike', card: 'whoops' }, set: 'setS', by: 'post3' } });
    const struck = act('k3', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', spring: 'sp' } });
    const log = { ...empty, playsOnMine: [{ play: 'k3', post: 'post3', at, reach: 'post' as const, targetName: null, targetCharacter: 'p' }] };
    const [row] = logRows(data({ log, mine, acts: new Map([...posts, spring, struck].map((a) => [a.id, a])), names }), w, 600, null);
    expect(row!.what).toBe('A trap struck your post');
    expect(text(row!)).toBe('A Hook on Spritey\'s post #4 laid Whoops! on your post #3.');
  });

  test('no line names an owner or a reactor: only characters\' names, and the player\'s own', () => {
    const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'snare', trigger: 'cast', outcome: { do: 'payout' }, set: 'set1', by: 'k1', caught: 'k1' } });
    const play = act('k1', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', caught: 'set1' } });
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'snare', post: 'post3', spring: 'sp', endedAt: later, endedBy: 'sprung' as const }, { play: 'set2', card: 'dud', post: 'post3', spring: null, endedAt: at, endedBy: 'time' as const }] };
    const all = logRows(data({ log, mine, acts: new Map([...posts, play, spring].map((a) => [a.id, a])), names }), w, 600, null).map(text).join(' ');
    expect(all).not.toMatch(/account|player|owner|reacted/iu);
  });
});

describe('a use card\'s end, every kind of it, names the card and never the kind word', () => {
  const effects = { ward: { kind: 'ward' as const, upTo: 'uncommon' as const }, earn: { kind: 'earn' as const, by: 0.1 }, price: { kind: 'price' as const, flavors: ['salty' as const], add: 25 } };
  for (const [kind, gimmick] of Object.entries(effects)) {
    test(`a ${kind} the player used says when it ended`, () => {
      const w: Words = { ...words, instance: { ...testInstance, cards: [...testInstance.cards, { ...testInstance.cards[0]!, key: 'gm', name: 'Some Card', play: 'use' as const, gimmick, lasts: { unit: 'day' as const, count: 7 } }] } };
      const post: Act = { id: 'post3', kind: 'post', character: 'p', thread: 'th', targetActId: null, seq: 3, createdAt: '2026-10-30T10:00:00.000Z', payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null };
      const used: Act = { ...post, id: 'u1', kind: 'card', seq: null, targetActId: 'post3', payload: { card: 'gm', ends: '2026-10-31T10:00:00.000Z' }, currentPayload: {} };
      const log = { ...empty, cards: [{ card: 'gm', kind: 'played' as const, act: 'u1', price: 0, at: '2026-10-24T10:00:00.000Z' }] };
      const rows = logRows(data({ log, mine: [char('p', 'Pipewrench', 'heel')], acts: new Map([post, used].map((a) => [a.id, a])) }), w, 600, null);
      const ended = rows.find((r) => r.kind === 'gimmickEnded')!;
      expect(ended.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('')).toBe('Some Card on your post #3 ended.');
      for (const r of rows) expect(`${r.what} ${r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('')}`).not.toMatch(/gimmick/iu);
    });
  }
});

describe('a timed end of a card that keeps', () => {
  const post: Act = { id: 'post3', kind: 'post', character: 'p', thread: 'th', targetActId: null, seq: 3, createdAt: '2026-10-30T10:00:00.000Z', payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null };
  const text = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');
  /* `adminEnd`: when an admin ended the play (my_cards_ended's `cast` entry for it), null for a play nobody ended. */
  const endedLine = (keeps: boolean, adminEnd: string | null = null) => {
    const w: Words = { ...words, instance: { ...testInstance, cards: [...testInstance.cards, { ...testInstance.cards[0]!, key: 'gm', name: 'Some Card', reaches: ['character' as const], lasts: { unit: 'day' as const, count: 7 }, ...(keeps ? { keeps: true } : {}) }] } };
    const played: Act = { ...post, id: 'u1', kind: 'card', seq: null, targetActId: null, payload: { card: 'gm', reach: 'character', character: 'p', ends: '2026-10-31T10:00:00.000Z' }, currentPayload: {} };
    const ended = adminEnd === null ? [] : [{ cardEnd: 'e1', play: 'u1', card: 'gm', at: adminEnd, side: 'cast' as const, reach: 'character' as const, targetName: 'Pipewrench', postAuthorName: null, casterName: 'Pipewrench', character: 'p' }];
    const log = { ...empty, ended, cards: [{ card: 'gm', kind: 'played' as const, act: 'u1', price: 0, at: '2026-10-24T10:00:00.000Z' }] };
    return logRows(data({ log, mine: [char('p', 'Pipewrench', 'heel')], acts: new Map([post, played].map((a) => [a.id, a])) }), w, 600, null).find((r) => r.kind === 'gimmickEnded')!;
  };

  test('an ended play of a card that keeps says the posts written while it was up keep it', () => {
    expect(text(endedLine(true)).endsWith(' ended. Posts written while it was up keep it.')).toBe(true);
  });

  test('a play an admin ended during its time says no post keeps it', () => {
    expect(text(endedLine(true, '2026-10-26T10:00:00.000Z'))).not.toMatch(/keep it/u);
  });

  test('a play an admin ended after its time says no post keeps it', () => {
    expect(text(endedLine(true, '2026-11-02T10:00:00.000Z'))).not.toMatch(/keep it/u);
  });

  test('an ended play of another card says the line as it was', () => {
    expect(text(endedLine(false)).endsWith(' ended.')).toBe(true);
    expect(text(endedLine(false))).not.toMatch(/keep it/u);
  });
});

describe('a caught play and a ward\'s end, in the setter\'s and the user\'s logs', () => {
  const w: Words = { ...words, instance: { ...testInstance, cards: [...testInstance.cards, { ...testInstance.cards[0]!, key: 'shield', name: 'Shield', play: 'use' as const, gimmick: { kind: 'ward' as const, upTo: 'uncommon' as const }, lasts: { unit: 'day' as const, count: 7 } }] } };
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
    expect(rows.map((r) => [r.kind, r.at])).toEqual([['gimmickEnded', '2026-10-31T10:00:00.000Z'], ['played', '2026-10-24T10:00:00.000Z']]);
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
    expect(rows.map((r) => r.kind)).toEqual(['gimmickEnded', 'played']);
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
  const w: Words = { ...words, ui: { ...words.ui, cards: [{ key, art: { color: '#000', ink: '#fff', canvas: '', mark: '', credit: 'Test' }, describe: () => '', logPlay: (config) => (typeof config.phrase === 'string' ? `It covers “${config.phrase}” with “${config.replacement}”.` : undefined) }] } };
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
    const log = { ...empty, cards: [{ card: key, kind: 'played' as const, act: 'k1', price: 25, at }], caught: [{ play: 'k1', card: key, post: 'post3', trap: key, spring: 'sp1', price: 25, at }] };
    const rows = logRows(data({ log, mine: [char('c', 'Spritey', 'heel')], acts: new Map([post, play].map((a) => [a.id, a])) }), w, 600, null);
    expect(rows.map((r) => r.kind)).toEqual(['caught']);
    expect(text(rows[0]!)).not.toContain('covers');
  });

  test('a card that says nothing adds nothing', () => {
    const quiet: Words = { ...words, ui: { ...words.ui, cards: [{ key, art: { color: '#000', ink: '#fff', canvas: '', mark: '', credit: 'Test' }, describe: () => '' }] } };
    const log = { ...empty, cards: [{ card: key, kind: 'played' as const, act: 'k1', price: 25, at }] };
    const [row] = logRows(data({ log, mine: [char('c', 'Spritey', 'heel')], acts: new Map([post, play].map((a) => [a.id, a])) }), quiet, 600, null);
    expect(text(row!)).not.toContain('covers');
  });
});

/**
 * A card play the old voice did not answer (the design's section 13, the refund): the caster's play line stays, and a returned row says
 * what came back, from the refund's own wallet event, and that the card is back in the hand. The engine names no card.
 */
describe('a card play that the old voice did not answer', () => {
  const key = testInstance.cards[0]!.key;
  const name = testInstance.cards[0]!.name;
  const other = { ...testInstance.cards[0]!, key: 'other', name: 'Other Card' };
  const w: Words = { ...words, instance: { ...testInstance, cards: [...testInstance.cards, other] } };
  const at = '2026-11-08T10:00:00.000Z';
  const act = (id: string, kind: Act['kind'], character: string | null, over: Partial<Act> = {}): Act =>
    ({ id, kind, character, thread: 'th', targetActId: null, seq: null, createdAt: at, payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over });
  const text = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');
  const post = act('post3', 'post', 'c', { seq: 3 });
  const play = act('k1', 'card', 'c', { targetActId: 'post3', payload: { card: key } });
  const refund = (change: number): WalletEvent => ({ settlement: null, kind: 'refund', change, overflow: 0, floored: 0, balanceAfter: 500 + change, ref: 'k1', at });
  const playedRow = { card: key, kind: 'played' as const, act: 'k1', price: 0, at };
  const rowsOf = (cards: Log['cards'], wallet: WalletEvent[]) =>
    logRows(data({ log: { ...empty, cards, wallet }, mine: [char('c', 'Spritey', 'heel')], acts: new Map([post, play].map((a) => [a.id, a])) }), w, 600, null);

  test('a refund says what came back and that the card is in the hand, after the play line, with no second play', () => {
    const rows = rowsOf([playedRow, { card: key, kind: 'returned' as const, act: 'k1', price: 75, at }], [refund(75)]);
    expect(rows.map((r) => r.kind)).toEqual(['played', 'returned']);
    expect(text(rows[0]!)).toMatch(/^As Spritey, on your post #3/u);
    expect(text(rows[1]!)).toBe(`The old voice didn't answer for your ${name} on your post #3, so your 0.75 came back, and the card is back in your hand.`);
    expect(rows[1]!.aura).toBe(75);
  });

  test('a refund with nothing paid to play says the card is back, and does not say Aura came back', () => {
    const rows = rowsOf([playedRow, { card: key, kind: 'returned' as const, act: 'k1', price: 0, at }], []);
    expect(rows.map((r) => r.kind)).toEqual(['played', 'returned']);
    expect(text(rows[1]!)).toBe(`The old voice didn't answer for your ${name} on your post #3, so the card is back in your hand.`);
    expect(text(rows[1]!)).not.toContain('came back');
  });

  test('a card a refund handed back says which card gave it back, for a back and for a sign alike, with no aura and no wallet', () => {
    const handed = (by: string, card: string) => act('k1', 'card', 'c', { targetActId: 'post3', payload: { card: key, handedBack: { by, card } } });
    for (const giver of [key, 'other']) {
      const cast = handed('set1', giver);
      const rows = logRows(data({ log: { ...empty, cards: [playedRow, { card: key, kind: 'returned' as const, act: 'k1', price: 0, at }], wallet: [] }, mine: [char('c', 'Spritey', 'heel')], acts: new Map([post, cast].map((a) => [a.id, a])) }), w, 600, null);
      const returned = rows.find((r) => r.kind === 'returned')!;
      expect(returned.what).toBe(`Your ${name} came back`);
      expect(text(returned)).toBe(`The ${giver === key ? name : 'Other Card'} on your post #3 gave your card back.`);
      expect(returned.aura).toBe(0);
      expect(returned.wallet).toBeNull();
    }
  });

  test('a returned row names the instance\'s card it is for, never another', () => {
    const rows = rowsOf([{ card: 'other', kind: 'returned' as const, act: 'k1', price: 0, at }], []);
    const returned = rows.find((r) => r.kind === 'returned')!;
    expect(text(returned)).toContain('Other Card');
    expect(text(returned)).not.toContain(name);
  });
});

/**
 * A card that writes, in the log (the design's section 13): the caster's play line says what was asked, and the author's own log says what
 * the card did to their post, and what its clear did, in words the instance's card gives. The engine names no card.
 */
describe('the log of a card that writes', () => {
  const key = testInstance.cards[0]!.key;
  const name = testInstance.cards[0]!.name;
  const other = { ...testInstance.cards[0]!, key: 'other', name: 'Other Card' };
  const writing = { key, art: { color: '#000', ink: '#fff', canvas: '', mark: '', credit: 'Test' }, describe: () => '',
    logWritten: { continued: 'continued it', again: (card: string) => `made its ${card} again`, failed: 'didn\'t take' },
    logSave: (state: unknown) => ((state as { cleared?: unknown }).cleared ? { what: 'Tail erased', verb: 'erased' } : undefined),
    logPlay: (_config: Readonly<Record<string, unknown>>, recorded: { readonly tokens?: number }) => (recorded.tokens === undefined ? undefined : `It was played for ${recorded.tokens} tokens.`) };
  const wording = { key: 'other', art: writing.art, describe: () => '', logWritten: { continued: 'went on', again: (card: string) => `redid its ${card}`, failed: 'fell flat' } };
  const w: Words = { ...words, instance: { ...testInstance, cards: [...testInstance.cards, other] }, ui: { ...words.ui, cards: [writing, wording] }, economy: { base: 25, step: 25 } };
  const at = '2026-11-09T10:00:00.000Z';
  const act = (id: string, kind: Act['kind'], character: string | null, over: Partial<Act> = {}): Act =>
    ({ id, kind, character, thread: 'th', targetActId: null, seq: null, createdAt: at, payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over });
  const text = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');
  const post = act('post3', 'post', 'a', { seq: 3 });
  const play = (id: string, card: string) => act(id, 'card', 'c', { targetActId: 'post3', payload: { card, config: { steps: 3 } } });
  const row = (over: Partial<Log['writes'][number]> = {}): Log['writes'][number] => ({ play: 'k1', post: 'post3', version: 'post3', failed: false, opening: true, over: false, at, ...over });
  const mine = [char('a', 'Pipewrench', 'jabroni')];
  const rowsOf = (writes: Log['writes'], card = key, extra: Partial<LogData> = {}) =>
    logRows(data({ log: { ...empty, writes }, mine, acts: new Map([post, play('k1', card)].map((a) => [a.id, a])), names: new Map([['c', 'Spritey']]), ...extra }), w, 600, null);

  test('a first text says the card continued the post', () => {
    const [r] = rowsOf([row()]);
    expect(r).toMatchObject({ kind: 'written', at, aura: 0, wallet: null, characters: ['a'] });
    expect(text(r!)).toBe(`${name} on your post #3 continued it.`);
  });
  test('the text an edit made says the edit made it again, each at its own time', () => {
    const later = '2026-11-09T10:30:00.000Z';
    const rows = rowsOf([row({ version: 'e1', opening: false, at: later }), row({ opening: true })]);
    expect(rows.map((r) => r.at)).toEqual([later, at]);
    expect(text(rows[0]!)).toBe(`Your edit of post #3 made its ${name} again.`);
    expect(rows[0]!.details[1]).toEqual({ text: 'post #3', href: '/t/th?page=1#post-3' });
  });
  test('the failure that ended the play says it did not take', () => {
    const [r] = rowsOf([row({ failed: true, over: true })]);
    expect(text(r!)).toBe(`${name} on post #3 didn't take.`);
  });
  test('a failure the play survived gets no line, and the text that came after it is the play\'s first', () => {
    /* v1 failed with a newer job waiting (the play lived), then v2 made the first text: the one line is that it continued the post. */
    const rows = rowsOf([row({ failed: true, over: false }), row({ version: 'e1', opening: true, at: '2026-11-09T10:30:00.000Z' })]);
    expect(rows.map(text)).toEqual([`${name} on your post #3 continued it.`]);
  });
  test('a failure after an earlier text keeps the tail and gets no line', () => {
    expect(rowsOf([row({ failed: true, opening: false, over: false, version: 'e1' })])).toEqual([]);
  });
  test('another writing card is said in its own words, and the engine names none', () => {
    const rows = rowsOf([row(), row({ play: 'k2', failed: true, over: true })], 'other', { acts: new Map([post, play('k1', 'other'), play('k2', 'other')].map((a) => [a.id, a])) });
    expect(rows.map(text).sort()).toEqual(["Other Card on post #3 fell flat.", 'Other Card on your post #3 went on.']);
    expect(rowsOf([row({ version: 'e1', opening: false })], 'other').map(text)).toEqual(['Your edit of post #3 redid its Other Card.']);
  });
  test('a card with no words for it, or a play the log could not read, says nothing', () => {
    expect(rowsOf([row()], 'not-a-card')).toEqual([]);
    expect(logRows(data({ log: { ...empty, writes: [row()] }, mine }), w, 600, null)).toEqual([]);
  });
  test('a row names only what the author may read: no caster, no price', () => {
    const [r] = rowsOf([row()]);
    expect(text(r!)).not.toMatch(/Spritey|Aura|paid|cast/u);
    expect(actsNamed({ ...empty, writes: [row()] }, null, [])).toEqual(expect.arrayContaining(['k1', 'post3']));
  });

  test('the author\'s clear says what was erased, in the verb the card gives', () => {
    const log = { ...empty, saves: [{ play: 'k1', post: 'post3', savedAt: at }] };
    const [r] = logRows(data({ log, mine, acts: new Map([post, play('k1', key)].map((a) => [a.id, a])), states: new Map([['k1', { cleared: 'post3' }]]) }), w, 600, null);
    expect(r).toMatchObject({ kind: 'saved', what: 'Tail erased', characters: ['a'] });
    expect(text(r!)).toBe(`You erased ${name} on post #3.`);
  });
  test('a save that gives words after the caster\'s name is said as it always was', () => {
    const old: Words = { ...w, ui: { ...w.ui, cards: [{ ...writing, logSave: () => ({ what: 'Washed clean', said: 'The layer is washed clean.' }) }] } };
    const log = { ...empty, saves: [{ play: 'k1', post: 'post3', savedAt: at }] };
    const [r] = logRows(data({ log, mine, acts: new Map([post, play('k1', key)].map((a) => [a.id, a])) }), old, 600, null);
    expect(text(r!)).toBe(`Someone's ${name} on your post #3. The layer is washed clean.`);
  });

  test('the caster\'s play line is given what the play recorded, so it says the length bought even after a retune', () => {
    const log = { ...empty, cards: [{ card: key, kind: 'played' as const, act: 'k1', price: 75, at }] };
    const bought = { ...play('k1', key), payload: { card: key, config: { steps: 3 }, tokens: 100 } };
    /* The economy now says 25 + 3 * 25 = 100 for these steps; retuned, it would say 1,000. The line is the recorded number either way. */
    for (const economy of [{ base: 25, step: 25 }, { base: 1000, step: 0 }]) {
      const [r] = logRows(data({ log, mine: [char('c', 'Spritey', 'heel')], acts: new Map([post, bought].map((a) => [a.id, a])) }), { ...w, economy }, 600, null);
      expect(text(r!)).toContain('It was played for 100 tokens.');
    }
    /* A play with no record says nothing of a length rather than working one out. */
    const [none] = logRows(data({ log, mine: [char('c', 'Spritey', 'heel')], acts: new Map([post, play('k1', key)].map((a) => [a.id, a])) }), w, 600, null);
    expect(text(none!)).not.toContain('tokens');
  });
});

/**
 * The Mod Bots' lines (the design, section 9): the warn points filed against the player's characters, the bans laid on them, and the reports and appeals they made, each in plain
 * and true words: which Act did what, the points and when they drop off. The rows are the player's own; the lines say nothing of who reacted or of anyone's class.
 */
describe('the Mod Bots\' lines', () => {
  const mineBoth = [char('p', 'Spritey', 'face', undefined, PRONOUN_PRESETS.they), char('q', 'Pipewrench', 'heel', undefined, PRONOUN_PRESETS.she)];
  const T = 'th1';
  const inf = (over: Partial<Log['infractions'][number]> = {}): Log['infractions'][number] => ({
    infraction: 'i1', character: 'p', at: '2099-10-30T12:14:00.000Z', band: 'minor', points: 2, ruleNumber: 2, rule: 'Rule 2: No double posting', mod: 'The Clerk', post: 'post41', postSeq: 41, thread: T,
    expiresAt: '2099-11-13T12:14:00.000Z', relief: 0, emptiedAt: null, cardRelief: 0, fallPlay: null, ...over,
  });
  const rowsOf = (log: Partial<Log>, tab: string | null = null) => logRows(data({ log: { ...empty, ...log }, mine: mineBoth }), words, 600, tab);
  const said = (r: { readonly details: readonly (string | { readonly text: string })[] }) => r.details.map((d) => (typeof d === 'string' ? d : d.text)).join('');

  test('a filed visit says which Act did what, the points and when they drop off', () => {
    const [row] = rowsOf({ infractions: [inf()] });
    expect(row).toMatchObject({ kind: 'infraction', characters: ['p'], aura: 0 });
    expect(said(row!)).toBe('The Clerk\'s visit to your post #41 filed Rule 2: No double posting: 2 warn points for Spritey, dropping off Nov 13.');
    expect(row!.details[1]).toEqual({ text: 'your post #41', href: '/t/th1?page=3#post-41' });
  });

  test('says "dropped off" once they have, "1 warn point" in the singular, what an appeal took off and what a ban emptied', () => {
    const past = rowsOf({ infractions: [inf({ expiresAt: '2000-01-01T00:00:00.000Z', points: 1, emptiedAt: '1999-12-31T00:00:00.000Z' })] })[0]!;
    expect(said(past)).toContain('1 warn point for Spritey, dropped off Jan 1.');
    expect(said(past)).toContain('A ban emptied the bar on Dec 31, so this point stopped counting then.');
    expect(said(rowsOf({ infractions: [inf({ relief: 1 })] })[0]!)).toContain('An appeal took 1 point off.');
  });

  test('a ban says why, for how long, until when, that it ends by itself, and that the ban is on this character only', () => {
    const [row] = rowsOf({ bans: [{ ban: 'b1', character: 'p', at: '2099-10-30T12:15:00.000Z', days: 3, until: '2099-11-02T12:15:00.000Z', infraction: 'i1', rule: 'Rule 2: No double posting', thread: T, ruling: null, ownUntil: '2099-11-02T12:15:00.000Z', liftedAt: null, liftedCard: null }] });
    expect(row!.kind).toBe('ban');
    expect(said(row!)).toBe('Spritey\'s warn bar filled with Rule 2: No double posting, so they were banned for 3 days and the bar was emptied. They can read but not post, react or play cards. The ban ends by itself Nov 2 · 12:15 UTC. The ban is on Spritey only; each character has its own warn bar.');
  });

  test('a ban reads in the banned character\'s own pronouns: she/her, verbs agreeing', () => {
    const [row] = rowsOf({ bans: [{ ban: 'b2', character: 'q', at: '2099-10-30T12:15:00.000Z', days: 3, until: '2099-11-02T12:15:00.000Z', infraction: 'i1', rule: null, thread: T, ruling: null, ownUntil: '2099-11-02T12:15:00.000Z', liftedAt: null, liftedCard: null }] });
    expect(said(row!)).toBe('Pipewrench\'s warn bar filled, so she was banned for 3 days and the bar was emptied. She can read but not post, react or play cards. The ban ends by itself Nov 2 · 12:15 UTC. The ban is on Pipewrench only; each character has its own warn bar.');
  });

  test('a running ban that no appeal names carries the ban for "Appeal to the Boss"; an ended one or an appealed one does not', () => {
    const ban = { ban: 'b1', character: 'p', at: '2099-10-30T12:15:00.000Z', days: 3, until: '2099-11-02T12:15:00.000Z', infraction: 'i1', rule: null, thread: T, ruling: null, ownUntil: '2099-11-02T12:15:00.000Z', liftedAt: null, liftedCard: null };
    expect(rowsOf({ bans: [ban] })[0]!.appealBan).toEqual({ ban: 'b1', character: 'p', until: ban.until, days: 3, rule: null });
    expect(rowsOf({ bans: [{ ...ban, until: '2000-01-02T00:00:00.000Z' }] })[0]!.appealBan).toBeUndefined();
    const appeal = { appeal: 'a1', character: 'p', at: '2099-10-30T13:00:00.000Z', punishment: 'b1', punishmentKind: 'ban', postSeq: 41, thread: T, verdict: null, ruledAt: null, pointsDelta: null, hearer: null, refund: null, answer: null } as const;
    expect(rowsOf({ bans: [ban], appeals: [appeal] }).find((r) => r.kind === 'ban')!.appealBan).toBeUndefined();
    expect(rowsOf({ bans: [ban], appeals: [{ ...appeal, verdict: 'upheld' }] }).find((r) => r.kind === 'ban')!.appealBan).toBeUndefined();
    /* An appeal that was refunded (a failed or a stale judgment) leaves the ban appealable, as its own line says. */
    for (const refund of ['failed', 'stale', 'expired'] as const) expect(rowsOf({ bans: [ban], appeals: [{ ...appeal, refund }] }).find((r) => r.kind === 'ban')!.appealBan, refund).toBeDefined();
  });

  test('a ban says what an appeal did to it, running and ended, in the words the ruling earns', () => {
    const ban = (ruling: Log['bans'][number]['ruling'], until: string) => ({ ban: 'b1', character: 'p', at: '2000-01-01T00:00:00.000Z', days: 4, until, infraction: 'i1', rule: null, thread: T, ruling, ownUntil: '2099-11-02T12:15:00.000Z', liftedAt: null, liftedCard: null });
    const tail = (b: Log['bans'][number]) => said(rowsOf({ bans: [b] })[0]!).replace(/^.*react or play cards\. /u, '');
    const side = ' The ban is on Spritey only; each character has its own warn bar.';
    const run = '2099-11-06T12:15:00.000Z';
    const gone = '2000-01-06T12:15:00.000Z';
    expect(tail(ban(null, run))).toBe(`The ban ends by itself Nov 6 · 12:15 UTC.${side}`);
    expect(tail(ban('upheld', run))).toBe(`The ban ends by itself Nov 6 · 12:15 UTC.${side}`);
    expect(tail(ban('upheld', gone))).toBe(`The ban ended by itself Jan 6 · 12:15 UTC.${side}`);
    expect(tail(ban('overturned', gone))).toBe(`An appeal overturned the ban on Jan 6 · 12:15 UTC.${side}`);
    expect(tail(ban('reduced', run))).toBe(`An appeal shortened the ban: it ends Nov 6 · 12:15 UTC.${side}`);
    expect(tail(ban('reduced', gone))).toBe(`An appeal shortened the ban: it ended Jan 6 · 12:15 UTC.${side}`);
    expect(tail(ban('increased', run))).toBe(`An appeal lengthened the ban: it ends by itself Nov 6 · 12:15 UTC.${side}`);
    expect(tail(ban('increased', gone))).toBe(`An appeal lengthened the ban: it ended Jan 6 · 12:15 UTC.${side}`);
  });

  test('a ban on one character does not say the player\'s other character is free: the line speaks of the one it names', () => {
    const both = [{ ban: 'b1', character: 'p', at: '2099-10-30T12:15:00.000Z', days: 3, until: '2099-11-02T12:15:00.000Z', infraction: 'i1', rule: null, thread: T, ruling: null, ownUntil: '2099-11-02T12:15:00.000Z', liftedAt: null, liftedCard: null },
      { ban: 'b2', character: 'q', at: '2099-10-30T12:16:00.000Z', days: 3, until: '2099-11-02T12:16:00.000Z', infraction: 'i2', rule: null, thread: T, ruling: null, ownUntil: '2099-11-02T12:16:00.000Z', liftedAt: null, liftedCard: null }] as const;
    for (const row of rowsOf({ bans: [...both] }).filter((x) => x.kind === 'ban')) {
      expect(said(row)).not.toMatch(/other characters/iu);
      expect(said(row)).toMatch(/each character has its own warn bar\.$/u);
    }
  });

  test('a ban that has ended says it ended by itself', () => {
    const [row] = rowsOf({ bans: [{ ban: 'b1', character: 'p', at: '2000-01-01T00:00:00.000Z', days: 1, until: '2000-01-02T00:00:00.000Z', infraction: 'i1', rule: null, thread: T, ruling: null, ownUntil: '2099-11-02T12:15:00.000Z', liftedAt: null, liftedCard: null }] });
    expect(said(row!)).toContain('The ban ended by itself Jan 2 · 00:00 UTC.');
    expect(said(row!)).toContain('warn bar filled, so');
  });

  /** A wallet event of the Mod Bots' kinds, as `my_wallet_events` reads it. */
  const paid = (kind: 'report' | 'appeal' | 'refund' | 'bribe', ref: string, change: number): Log['wallet'][number] =>
    ({ settlement: null, kind, change, overflow: 0, floored: 0, balanceAfter: 100, ref, at: '2099-10-29T17:00:00.000Z' });

  test('a report says the verdict, what it cost and that it is public; an unanswered one says what happens next; a refunded one says its Aura came back', () => {
    const base = { report: 'r1', character: 'q', at: '2099-10-29T17:00:00.000Z', post: 'p42', postSeq: 42, thread: T, verdict: null, verdictAt: null, mod: null, refund: null, answer: null } as const;
    const dismissed = rowsOf({ wallet: [paid('report', 'r1', -25)], reports: [{ ...base, verdict: 'dismissed', verdictAt: '2099-10-29T17:00:03.000Z', mod: 'The Clerk' }] })[0]!;
    expect(dismissed).toMatchObject({ kind: 'report', aura: -25, characters: ['q'] });
    expect(said(dismissed)).toBe('Pipewrench reported post #42, for 0.25 Aura. The report is public. The Clerk dismissed it. The 0.25 Aura was spent.');
    expect(said(rowsOf({ reports: [{ ...base, verdict: 'visit', mod: 'The Clerk' }] })[0]!)).toContain('The Clerk judged it and sent a visit.');
    expect(said(rowsOf({ reports: [{ ...base, verdict: 'backfire', mod: 'The Clerk' }] })[0]!)).toContain('a visit went to Pipewrench\'s latest post');
    expect(said(rowsOf({ reports: [base] })[0]!)).toContain('It has not been answered yet. If it cannot be, your Aura comes back by itself.');
    const refunded = rowsOf({ wallet: [paid('refund', 'r1', 25), paid('report', 'r1', -25)], reports: [{ ...base, refund: 'failed' }] })[0]!;
    expect(refunded.aura).toBe(0);
    expect(said(refunded)).toContain('could not hear it, so your Aura came back (0.25), and you can make it again.');
  });

  test('a visit verdict that opened no visit says why, that the Aura came back and that it still counts for the day; a free one has no amount; a visit with no refund says it sent one', () => {
    const base = { report: 'r1', character: 'q', at: '2099-10-29T17:00:00.000Z', post: 'p42', postSeq: 42, thread: T, verdict: 'visit', verdictAt: '2099-10-29T17:00:03.000Z', mod: 'The Clerk', refund: null, answer: null } as const;
    const wallet = [paid('refund', 'r1', 25), paid('report', 'r1', -25)];
    const veiled = rowsOf({ wallet, reports: [{ ...base, refund: 'veiled' }] })[0]!;
    expect(veiled.aura).toBe(0);
    expect(said(veiled)).toBe('Pipewrench reported post #42, for 0.25 Aura. The report is public. The Clerk judged it a visit, but no visit opened: the post\'s author was hidden when it was judged. Your Aura came back (0.25). It still counts as one of Pipewrench\'s reports for that day.');
    const visited = rowsOf({ wallet, reports: [{ ...base, refund: 'visited' }] })[0]!;
    expect(visited.aura).toBe(0);
    expect(said(visited)).toBe('Pipewrench reported post #42, for 0.25 Aura. The report is public. The Clerk judged it a visit, but no visit opened: the post had already been visited after a report on that charge, and a post is not charged twice for one breach. Your Aura came back (0.25). It still counts as one of Pipewrench\'s reports for that day.');
    const free = said(rowsOf({ reports: [{ ...base, refund: 'veiled' }] })[0]!);
    expect(free).toContain('no visit opened: the post\'s author was hidden when it was judged. Your Aura came back. It still');
    expect(free).not.toMatch(/\(/u);
    expect(said(rowsOf({ wallet: [paid('report', 'r1', -25)], reports: [base] })[0]!)).toContain('The Clerk judged it and sent a visit.');
  });

  test('an appeal says what it was of, the ruling, the points and the price', () => {
    const base = { appeal: 'a1', character: 'p', at: '2099-10-30T13:00:00.000Z', punishment: 'i1', punishmentKind: 'infraction', postSeq: 41, thread: T, verdict: null, ruledAt: null, pointsDelta: null, hearer: null, refund: null, answer: null } as const;
    const overturned = rowsOf({ wallet: [paid('appeal', 'a1', -50), paid('refund', 'a1', 50)], appeals: [{ ...base, verdict: 'overturned', pointsDelta: -2, hearer: 'The Clerk' }] })[0]!;
    expect(overturned).toMatchObject({ kind: 'appeal', aura: 0 });
    expect(said(overturned)).toBe('Spritey appealed the warn points from your post #41, for 0.50 Aura. The plea is public. The Clerk overturned it: 2 points came off, and the 0.50 Aura came back.');
    const upheld = rowsOf({ wallet: [paid('appeal', 'a1', -50)], appeals: [{ ...base, verdict: 'upheld', hearer: 'The Clerk' }] })[0]!;
    expect(upheld.aura).toBe(-50);
    expect(said(upheld)).toContain('The Clerk upheld it. Nothing changed.');
    expect(said(rowsOf({ appeals: [{ ...base, verdict: 'increased', pointsDelta: 2, hearer: 'The Clerk' }] })[0]!)).toContain('increased it: 2 more points landed.');
    expect(said(rowsOf({ appeals: [{ ...base, punishmentKind: 'ban', verdict: 'reduced', hearer: 'The Boss' }] })[0]!)).toContain('appealed the ban from your post #41');
    expect(said(rowsOf({ appeals: [base] })[0]!)).toContain('It has not been ruled on yet. If it cannot be, your Aura comes back by itself.');
  });

  test('the Aura is what the wallet\'s events say was paid, never today\'s price (the settings now say 25 and 50)', () => {
    const report = { report: 'r1', character: 'q', at: '2099-10-29T17:00:00.000Z', post: 'p42', postSeq: 42, thread: T, verdict: 'dismissed', verdictAt: null, mod: 'The Clerk', refund: null, answer: null } as const;
    const row = rowsOf({ wallet: [paid('report', 'r1', -10)], reports: [report] })[0]!;
    expect(row.aura).toBe(-10);
    expect(said(row)).toContain('for 0.10 Aura. The report is public. The Clerk dismissed it. The 0.10 Aura was spent.');
    const appeal = { appeal: 'a1', character: 'p', at: '2099-10-30T13:00:00.000Z', punishment: 'i1', punishmentKind: 'infraction', postSeq: 41, thread: T, verdict: 'upheld', ruledAt: null, pointsDelta: null, hearer: 'The Clerk', refund: null, answer: null } as const;
    const a = rowsOf({ wallet: [paid('appeal', 'a1', -30)], appeals: [appeal] })[0]!;
    expect(a.aura).toBe(-30);
    expect(said(a)).toContain('for 0.30 Aura.');
    /* A price the wallet has no event for (a free one) is not guessed at. */
    expect(said(rowsOf({ reports: [report] })[0]!)).not.toMatch(/Aura/u);
  });

  test('a bribe says what was paid and to talk down whose visit, from the wallet\'s event and the public Acts', () => {
    const act = (id: string, kind: Act['kind'], character: string, payload: Act['payload']): Act =>
      ({ id, kind, character, thread: T, targetActId: null, seq: null, createdAt: '2099-10-29T17:00:00.000Z', payload, currentPayload: payload, editedAt: null, shownEditedAt: null });
    const attempt = act('att1', 'intercept', 'q', { visit_act: 'v1', kind: 'bribe', succeeded: true });
    const visit = act('v1', 'visit', 'm', {});
    const rows = logRows(data({ log: { ...empty, wallet: [paid('bribe', 'att1', -30)] }, mine: mineBoth, acts: new Map([attempt, visit].map((x) => [x.id, x])), names: new Map([['m', 'The Clerk']]) }), words, 600, null);
    const row = rows.find((r) => r.kind === 'bribe')!;
    expect(said(row)).toBe('You paid 0.30 Aura to talk down The Clerk\'s visit.');
    expect(row).toMatchObject({ aura: -30, characters: ['q'] });
    expect(rows.find((r) => r.kind === 'bribe' && r.characters[0] === 'q')).toBeDefined();
  });

  test('each is in the tab of its own character, and in All; one character\'s lines are not in another\'s tab', () => {
    const log = { infractions: [inf()], reports: [{ report: 'r1', character: 'q', at: '2099-10-29T17:00:00.000Z', post: 'p42', postSeq: 42, thread: T, verdict: null, verdictAt: null, mod: null, refund: null, answer: null }] } satisfies Partial<Log>;
    expect(rowsOf(log, 'p').map((r) => r.kind)).toEqual(['infraction']);
    expect(rowsOf(log, 'q').map((r) => r.kind)).toEqual(['report']);
    expect(rowsOf(log, null).map((r) => r.kind).sort()).toEqual(['infraction', 'report']);
  });

  test('lines say nothing of who reacted or of a class, and sort among the rest by when they happened', () => {
    const rows = rowsOf({ infractions: [inf({ at: '2099-10-30T12:00:00.000Z' }), inf({ infraction: 'i2', at: '2099-10-31T12:00:00.000Z' })] });
    expect(rows.map((r) => r.key)).toEqual(['infraction:i2', 'infraction:i1']);
    for (const r of rows) expect(said(r)).not.toMatch(/react|class|heel|face/iu);
  });
});

/**
 * An admin's grant (docs/plans/2026-11-08-aura-grant-design.md, section 2): a wallet event of kind `grant`, in plain and true words, in every tab since it belongs to no character.
 */
describe('the grant line', () => {
  const grant = (change: number, overflow: number, at: string): Log['wallet'][number] =>
    ({ settlement: null, kind: 'grant', change, overflow, floored: 0, balanceAfter: 900, ref: null, at });
  const mine = [char('p', 'Pat', 'face'), char('q', 'Quinn', 'heel')];
  const grants = (wallet: Log['wallet'], tab: string | null) => logRows(data({ log: { ...empty, wallet }, mine }), words, 600, tab).filter((r) => r.kind === 'grant');
  const said = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');

  test('a grant is one row in All and in a character\'s tab, in plain words', () => {
    for (const tab of [null, 'p', 'q']) {
      const [row, ...rest] = grants([grant(500, 0, '2099-11-08T12:00:00.000Z')], tab);
      expect(rest).toEqual([]);
      expect(row).toMatchObject({ key: 'grant:2099-11-08T12:00:00.000Z', kind: 'grant', at: '2099-11-08T12:00:00.000Z', what: 'An admin gave you Aura', aura: 500, wallet: 900, characters: [] });
      expect(said(row!)).toBe('An admin gave you 5.00 Aura.');
    }
  });

  test('the overflow sentence appears only when the cap held something back', () => {
    const [row] = grants([grant(300, 200, '2099-11-08T12:00:00.000Z')], null);
    expect(row!.details).toEqual(['An admin gave you 3.00 Aura. 2.00 more didn\'t fit under your wallet\'s cap.']);
  });

  test('two grants at different times are two rows', () => {
    const rows = grants([grant(100, 0, '2099-11-08T12:00:00.000Z'), grant(100, 0, '2099-11-09T12:00:00.000Z')], null);
    expect(rows.map((r) => r.key)).toEqual(['grant:2099-11-09T12:00:00.000Z', 'grant:2099-11-08T12:00:00.000Z']);
  });
});

/**
 * The group lines (member groups, Task 11): a staff move into a group, how it ended and an appeal's ruling on it, in plain and true words, the role word from the move's office, each
 * linked to the move, no alert and no other member named.
 */
describe('the group lines', () => {
  const mine = [char('p', 'Pipewrench', 'face'), char('q', 'Spritey', 'heel')];
  const move = (over: Partial<Log['groupMoves'][number]> = {}): Log['groupMoves'][number] => ({
    move: 'm1', character: 'p', at: '2099-11-06T12:00:00.000Z', thread: 'ann', seq: 7, group: 'trialMembers', board: 'b1', boardName: 'General', expiresAt: '2099-11-13T12:00:00.000Z', landedUntil: '2099-11-13T12:00:00.000Z', checkAt: null,
    demand: 'apologyAccepted', office: 'boss', endedWhy: null, endedBy: null, endedAt: null, ruling: null, ruledAt: null, ruledUntil: null, ruledOffice: null, ...over,
  });
  const groupWords: Words = { ...words, instance: { ...testInstance, groups: { ...testInstance.groups, conferred: [
    { key: 'trialMembers', name: 'Trial Members', color: '#d2691e', tone: 'punishment' }, { key: 'teachersPet', name: 'Teacher\'s Pet', color: '#c2408f', tone: 'favor' },
  ] } } };
  const rowsOf = (groupMoves: Log['groupMoves'], tab: string | null = null) => logRows(data({ log: { ...empty, groupMoves }, mine }), groupWords, 600, tab);
  const said = (r: { readonly details: readonly (string | { readonly text: string })[] }) => r.details.map((d) => (typeof d === 'string' ? d : d.text)).join('');
  const name = 'Trial Members';

  test('a punishment that bars a board says who, what, where and until when, and links to the move', () => {
    const [row] = rowsOf([move()]);
    expect(row).toMatchObject({ kind: 'grouped', characters: ['p'], aura: 0, wallet: null, at: '2099-11-06T12:00:00.000Z' });
    expect(said(row!)).toBe(`The Boss put Pipewrench in ${name} and barred it from posting on General until Nov 13.`);
    expect(row!.details[1]).toEqual({ text: `put Pipewrench in ${name}`, href: '/t/ann?page=1#post-7' });
  });

  test('the bar reads in the character\'s own pronouns', () => {
    const she = logRows(data({ log: { ...empty, groupMoves: [move()] }, mine: [char('p', 'Pipewrench', 'face', undefined, PRONOUN_PRESETS.she)] }), groupWords, 600, null);
    expect(said(she[0]!)).toBe(`The Boss put Pipewrench in ${name} and barred her from posting on General until Nov 13.`);
  });

  test('says no "barred" where no board is, and a Mod\'s role word where a Mod moved it', () => {
    expect(said(rowsOf([move({ board: null, boardName: null })])[0]!)).toBe(`The Boss put Pipewrench in ${name} until Nov 13.`);
    expect(said(rowsOf([move({ office: 'mod' })])[0]!)).toMatch(/^A Mod put Pipewrench/u);
  });

  test('names the end the move landed with, not the ruled one; the ruling line carries the change', () => {
    const [put] = rowsOf([move({ expiresAt: '2099-11-10T12:00:00.000Z', ruling: 'reduced', ruledAt: '2099-11-07T00:00:00.000Z', ruledUntil: '2099-11-10T12:00:00.000Z' })]).filter((r) => r.key === 'grouped:m1');
    expect(said(put!)).toContain('until Nov 13.');
  });

  test('a favor says the check it must meet to stay', () => {
    const fav = { key: 'teachersPet', name: 'Teacher\'s Pet' };
    expect(said(rowsOf([move({ group: fav.key, board: null, boardName: null, checkAt: '2099-11-09T00:00:00.000Z' })])[0]!)).toBe(`The Boss put Pipewrench in ${fav.name} until Nov 13. It stays if Pipewrench meets the demand by Nov 9.`);
  });

  test('each end says why the character left, at the time it ended', () => {
    const left = (over: Partial<Log['groupMoves'][number]>) => rowsOf([move({ endedAt: '2099-11-08T00:00:00.000Z', ...over })]).find((r) => r.key === 'grouped:m1:left')!;
    expect(said(left({ endedWhy: 'met' }))).toBe(`Pipewrench left ${name}: an apology was accepted.`);
    expect(said(left({ endedWhy: 'expired', endedBy: 'expiry' }))).toBe(`Pipewrench left ${name}: it expired.`);
    expect(said(left({ endedWhy: 'reversed', endedBy: 'admin' }))).toBe(`Pipewrench left ${name}: an admin reversed it.`);
    expect(said(left({ endedWhy: 'unmet', endedBy: 'check' }))).toBe(`Pipewrench left ${name}: the demand wasn't met by its check.`);
    expect(said(left({ endedWhy: 'overturned', endedBy: 'appeal' }))).toBe(`Pipewrench left ${name}: overturned on appeal.`);
    expect(left({ endedWhy: 'expired' })).toMatchObject({ kind: 'grouped', at: '2099-11-08T00:00:00.000Z', characters: ['p'] });
    expect(left({ endedWhy: 'expired' }).details[0]).toEqual({ text: `Pipewrench left ${name}`, href: '/t/ann?page=1#post-7' });
    expect(rowsOf([move()]).map((r) => r.key)).toEqual(['grouped:m1']);
  });

  test('an appeal of a group move says what it was of, by the group\'s name and linked to the move, the ruling and the price; the lines for the move itself are Task 11\'s', () => {
    const appeal = { appeal: 'a9', character: 'p', at: '2099-11-06T13:00:00.000Z', punishment: 'm1', punishmentKind: 'move', postSeq: null, thread: 'ann', verdict: null, ruledAt: null, pointsDelta: null, hearer: null, refund: null, answer: null } as const;
    const paidFor = (kind: 'appeal' | 'refund', change: number): Log['wallet'][number] => ({ settlement: null, kind, change, overflow: 0, floored: 0, balanceAfter: 100, ref: 'a9', at: '2099-11-06T13:00:00.000Z' });
    const mineRows = (appeals: Log['appeals'], wallet: Log['wallet'] = [paidFor('appeal', -50)]) => logRows(data({ log: { ...empty, groupMoves: [move()], appeals, wallet }, mine }), groupWords, 600, null).filter((r) => r.kind === 'appeal');
    const open = mineRows([appeal])[0]!;
    expect(open).toMatchObject({ kind: 'appeal', characters: ['p'], aura: -50 });
    expect(said(open)).toBe(`Pipewrench appealed the move into ${name}, for 0.50 Aura. The plea is public. It has not been ruled on yet. If it cannot be, your Aura comes back by itself.`);
    expect(open.details[1]).toEqual({ text: `the move into ${name}`, href: '/t/ann?page=1#post-7' });
    expect(said(mineRows([{ ...appeal, verdict: 'overturned', hearer: 'The Director' }], [paidFor('appeal', -50), paidFor('refund', 50)])[0]!)).toContain('The Director overturned it, and the 0.50 Aura came back.');
    expect(said(mineRows([{ ...appeal, verdict: 'reduced', hearer: 'The Director' }])[0]!)).toContain('The Director reduced it.');
    expect(said(mineRows([{ ...appeal, verdict: 'upheld', hearer: 'The Director' }])[0]!)).toContain('The Director upheld it. Nothing changed.');
    /* Not in the page of moves the log holds: the line still reads, without the group's name or a link. */
    const lone = logRows(data({ log: { ...empty, appeals: [appeal], wallet: [paidFor('appeal', -50)] }, mine }), groupWords, 600, null).find((r) => r.kind === 'appeal')!;
    expect(said(lone)).toMatch(/^Pipewrench appealed a group move, for 0\.50 Aura\./u);
  });

  test('each appeal ruling says what the hearer did and where the end now is', () => {
    const ruled = (ruling: NonNullable<Log['groupMoves'][number]['ruling']>, over: Partial<Log['groupMoves'][number]> = {}) =>
      rowsOf([move({ ruling, ruledAt: '2099-11-07T00:00:00.000Z', ruledOffice: 'boss', ...over })]).find((r) => r.key === 'grouped:m1:ruling')!;
    expect(said(ruled('reduced', { ruledUntil: '2099-11-10T00:00:00.000Z' }))).toBe(`The Boss reduced Pipewrench's ${name} on appeal: it now ends Nov 10.`);
    expect(said(ruled('increased', { ruledUntil: '2099-11-16T00:00:00.000Z' }))).toBe(`The Boss increased Pipewrench's ${name} on appeal: it now ends Nov 16.`);
    expect(said(ruled('upheld'))).toBe(`The Boss upheld Pipewrench's ${name} on appeal: nothing changed.`);
    expect(said(ruled('overturned'))).toBe(`The Boss overturned Pipewrench's ${name} on appeal: it ended.`);
    expect(said(ruled('reduced', { ruledUntil: '2099-11-06T00:00:00.000Z' }))).toBe(`The Boss reduced Pipewrench's ${name} on appeal: it ended at once.`);
    expect(said(ruled('upheld', { ruledOffice: 'mod' }))).toMatch(/^A Mod upheld /u);
    /* The hearer is the stamped office, never the move's: a Mod's move the Boss ruled on reads the Boss, and the move's own line still says the Mod. */
    expect(said(ruled('upheld', { office: 'mod', ruledOffice: 'boss' }))).toMatch(/^The Boss upheld /u);
    expect(said(rowsOf([move({ office: 'mod', ruling: 'upheld', ruledAt: '2099-11-07T00:00:00.000Z', ruledOffice: 'boss' })]).find((r) => r.key === 'grouped:m1')!)).toMatch(/^A Mod put /u);
    /* A ruling written before the stamp names no hearer, and no default stands in: the move's office is not read for it. */
    const unstamped = (ruling: NonNullable<Log['groupMoves'][number]['ruling']>, over: Partial<Log['groupMoves'][number]> = {}) => ruled(ruling, { ruledOffice: null, ...over });
    expect(said(unstamped('upheld'))).toBe(`Pipewrench's ${name} was upheld on appeal: nothing changed.`);
    expect(said(unstamped('overturned', { office: 'mod' }))).toBe(`Pipewrench's ${name} was overturned on appeal: it ended.`);
    expect(said(unstamped('reduced', { ruledUntil: '2099-11-10T00:00:00.000Z' }))).toBe(`Pipewrench's ${name} was reduced on appeal: it now ends Nov 10.`);
    expect(unstamped('upheld').details[0]).toEqual({ text: `Pipewrench's ${name}`, href: '/t/ann?page=1#post-7' });
    expect(ruled('upheld')).toMatchObject({ kind: 'grouped', at: '2099-11-07T00:00:00.000Z', aura: 0 });
  });

  test('is in its own character\'s tab and in All, and names no one else', () => {
    expect(rowsOf([move()], 'p')).toHaveLength(1);
    expect(rowsOf([move()], 'q')).toHaveLength(0);
    expect(said(rowsOf([move()], null)[0]!)).not.toMatch(/Spritey|others|members of/iu);
  });
});

describe('a card\'s boost in a settlement', () => {
  test('is said with the card\'s name, as the instance\'s words give it, and the amount it added, the card\'s capital kept', () => {
    const at = '2026-10-30T08:17:00.000Z';
    const w: Words = { ...words, ui: { ...words.ui, reasonWords: (r, params) => (r === 'card.boost' ? `${params['card'] === 'pt' ? 'Publicity Tour' : 'A card'} added: what the boost earned` : r) } };
    const log = { ...empty, settlements: [settled(1, at, [{ character: 'p', reason: 'face.cheered', amount: 100, shares: [] }, { character: 'p', reason: 'card.boost', amount: 10, params: { card: 'pt' }, shares: [] }])] };
    const rows = logRows(data({ log, mine: [char('p', 'Pipewrench', 'face')] }), w, 600, null);
    const said = rows.map((r) => `${r.what} ${r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('')}`).join(' | ');
    expect(said).toContain('Publicity Tour added +0.10');
    expect(said).not.toContain('publicity Tour');
  });
  test('is said with the line\'s own amount given to the instance\'s words, so a line that takes pay back can be worded apart from one that pays', () => {
    const at = '2026-10-30T08:17:00.000Z';
    const w: Words = { ...words, ui: { ...words.ui, reasonWords: (r, _params, amount) => (r === 'card.boost' ? `${amount !== undefined && amount < 0 ? 'Heat Magnet took back' : 'Heat Magnet paid'}: what the boost did` : r) } };
    const log = { ...empty, settlements: [settled(1, at, [{ character: 'p', reason: 'card.boost', amount: 10, params: { card: 'pt' }, shares: [] }, { character: 'p', reason: 'card.boost', amount: -4, params: { card: 'hm' }, shares: [] }])] };
    const rows = logRows(data({ log, mine: [char('p', 'Pipewrench', 'face')] }), w, 600, null);
    const said = rows.map((r) => `${r.what} ${r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('')}`).join(' | ');
    expect(said).toContain('Heat Magnet paid +0.10');
    expect(said).toContain('Heat Magnet took back −0.04');
  });
});

/**
 * The cosmetics lines (the cosmetics plan, Task 12): a Random Event's find, an admin's gear, a trophy given, a belt lost and an award taken back. Each is the player's own
 * character's, in plain and true words; no line says who reacted or any class, and a belt lost names the character that took it, which is public.
 */
describe('the cosmetics lines', () => {
  const mine = [char('p', 'Pipewrench', 'face'), char('q', 'Quinn', 'heel')];
  const w: Words = { ...words, instance: { ...testInstance, gear: [{ key: 'band', name: 'Headband', line: 'Holds a thought in place.', rarity: 'common' }, { key: 'tall', name: 'Tall Hat', line: 'Tall.', rarity: 'rare' }] } };
  const base = { at: '2026-11-09T12:00:00.000Z', id: 'e1', character: 'p', trophy: null, name: null, item: null, outcome: null, text: null, copies: null, by: null, byName: null, season: null, place: null, line: null, toName: null } as const;
  const rowsOf = (cosmetics: Log['cosmetics'], tab: string | null = null) => logRows(data({ log: { ...empty, cosmetics }, mine }), w, 600, tab).filter((r) => ['found', 'gearGranted', 'trophy', 'beltLost', 'beltBack'].includes(r.kind));
  const said = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');

  test('a found piece of gear and a found card say what, and its rarity in words, for the character it happened to', () => {
    const [gear, card] = rowsOf([{ ...base, kind: 'found', outcome: 'gear', item: 'band' }, { ...base, id: 'e2', at: '2026-11-09T11:00:00.000Z', kind: 'found', outcome: 'card', item: 'whoops' }]);
    expect(gear).toMatchObject({ kind: 'found', aura: 0, wallet: null, characters: ['p'] });
    expect(said(gear!)).toBe('Something happened to Pipewrench: you found a Headband (common gear).');
    expect(said(card!)).toBe('Something happened to Pipewrench: you found a Whoops! (common card).');
  });

  test('a line event keeps the words it was rolled with', () => {
    const [row] = rowsOf([{ ...base, kind: 'found', outcome: 'line', text: 'a pigeon watched you type' }]);
    expect(said(row!)).toBe('Something happened to Pipewrench: a pigeon watched you type.');
  });

  test('an admin\'s gear is counted, and names the character it was given through where the grant did', () => {
    const [through, bare] = rowsOf([{ ...base, kind: 'granted', id: 'g1', item: 'band', copies: 5 }, { ...base, kind: 'granted', id: 'g2', at: '2026-11-08T12:00:00.000Z', character: null, item: 'tall', copies: 1 }]);
    expect(through).toMatchObject({ kind: 'gearGranted', aura: 0 });
    expect(said(through!)).toBe('An admin gave you 5 Headbands, through Pipewrench.');
    expect(said(bare!)).toBe('An admin gave you a Tall Hat.');
    expect(bare!.characters).toEqual([]);
  });

  test('a trophy says who gave it, and why where the season or a demand did', () => {
    const lines = rowsOf([
      { ...base, kind: 'awarded', id: 'a1', trophy: 'bosss-pet', name: 'Boss\'s Pet', by: 'boss', byName: 'Sighbot' },
      { ...base, kind: 'awarded', id: 'a2', at: '2026-11-09T11:00:00.000Z', trophy: 'champ', name: 'Season Champion', by: 'season', season: 1, place: 1 },
      { ...base, kind: 'awarded', id: 'a3', at: '2026-11-09T10:00:00.000Z', trophy: 'met', name: 'Met the Demand', by: 'demand' },
      { ...base, kind: 'awarded', id: 'a4', at: '2026-11-09T09:00:00.000Z', trophy: 'x', name: 'Odd Medal', by: 'admin' },
    ]).map(said);
    expect(lines).toEqual([
      'Pipewrench was given Boss\'s Pet by Sighbot, the Boss.',
      'Pipewrench was given Season Champion, for first place in Season 1.',
      'Pipewrench was given Met the Demand, for posting toward it.',
      'Pipewrench was given Odd Medal by an admin.',
    ]);
  });

  test('a belt lost names who took it, and whose move it was', () => {
    const [boss, admin] = rowsOf([
      { ...base, kind: 'lost', id: 'l1', trophy: 'belt', name: 'The Belt', toName: 'Sock Puppet', by: 'boss', byName: 'Sighbot' },
      { ...base, kind: 'lost', id: 'l2', at: '2026-11-09T11:00:00.000Z', trophy: 'belt', name: 'The Belt', toName: 'Sock Puppet', by: 'admin' },
    ]);
    expect(boss).toMatchObject({ kind: 'beltLost', characters: ['p'] });
    expect(said(boss!)).toBe('Pipewrench lost the Belt to Sock Puppet, by Sighbot\'s move.');
    expect(said(admin!)).toBe('Pipewrench lost the Belt to Sock Puppet, by an admin.');
  });

  test('a belt that comes back says an admin took it from the taker and the mask holds it again, beside the lost line that stays', () => {
    const lines = rowsOf([
      { ...base, kind: 'lost', id: 'l1', trophy: 'belt', name: 'The Belt', toName: 'Sock Puppet', by: 'admin' },
      { ...base, kind: 'beltBack', id: 'l1', at: '2026-11-09T13:00:00.000Z', trophy: 'belt', name: 'The Belt', toName: 'Sock Puppet' },
    ]);
    expect(lines.map((r) => r.kind)).toEqual(['beltBack', 'beltLost']);
    expect(lines.map(said)).toEqual(['An admin took back the Belt from Sock Puppet; Pipewrench holds it again.', 'Pipewrench lost the Belt to Sock Puppet, by an admin.']);
  });

  test('a reversed award says an admin took it back', () => {
    const [row] = rowsOf([{ ...base, kind: 'reversed', id: 'a1', trophy: 'bosss-pet', name: 'Boss\'s Pet' }]);
    expect(row).toMatchObject({ kind: 'trophy' });
    expect(said(row!)).toBe('An admin took back Pipewrench\'s Boss\'s Pet.');
  });

  test('are in their character\'s tab and in All, and in no other character\'s', () => {
    const log: Log['cosmetics'] = [{ ...base, kind: 'found', outcome: 'gear', item: 'band' }];
    expect(rowsOf(log, 'p')).toHaveLength(1);
    expect(rowsOf(log, null)).toHaveLength(1);
    expect(rowsOf(log, 'q')).toHaveLength(0);
  });

  test('a card the Event found is no line of the card ledger\'s', () => {
    const cards: Log['cards'] = [{ card: 'whoops', kind: 'found', act: null, price: 0, at: '2026-11-09T12:00:00.000Z' }];
    expect(logRows(data({ log: { ...empty, cards }, mine }), w, 600, null).filter((r) => r.kind !== 'estimate')).toEqual([]);
  });
});

/**
 * A drive's gifts, in the log (docs/plans/2026-11-03-jimmy-wails-design.md, section 10): the giver's wallet event `gift_out` and the post's author's `gift_in`, each read
 * with the gift's own Act (amount, overhead and arrives, all public), and a card's own sentence for the play that opened or joined its drive. The engine names no card.
 */
describe('a drive\'s gifts', () => {
  const key = testInstance.cards[0]!.key;
  const at = '2026-11-12T10:00:00.000Z';
  const act = (id: string, kind: Act['kind'], character: string | null, over: Partial<Act> = {}): Act =>
    ({ id, kind, character, thread: 'th', targetActId: null, seq: null, createdAt: at, payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over });
  const text = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');
  const post = act('post3', 'post', 'a', { seq: 3 });
  const staffPost = act('post3', 'post', null, { seq: 3 });
  const opening = act('d1', 'card', 'c', { targetActId: 'post3', payload: { card: key, drive: 'd1' } });
  const gift = (amount: number, overhead: number, arrives: number) => act('g1', 'donation', 'g', { targetActId: 'd1', payload: { amount, overhead, arrives } });
  const out: WalletEvent = { settlement: null, kind: 'gift_out', change: -50, overflow: 0, floored: 0, balanceAfter: 450, ref: 'g1', at };
  const into = (overflow: number, change = 38 - overflow): WalletEvent => ({ settlement: null, kind: 'gift_in', change, overflow, floored: 0, balanceAfter: 700, ref: 'g1', at });
  const names = new Map([['g', 'Spritey'], ['c', 'Gloomba'], ['a', 'Pipewrench']]);
  const rowsOf = (wallet: WalletEvent[], mine: MyCharacter[], posts: Act[], gifted: Act) =>
    logRows(data({ log: { ...empty, wallet }, mine, acts: new Map([...posts, opening, gifted].map((a) => [a.id, a])), names }), words, 600, null).filter((r) => r.kind === 'gift');

  test('the giver\'s line says what it gave, what reached the author and what The System kept, and links the post', () => {
    const [row, ...rest] = rowsOf([out], [char('g', 'Spritey', 'heel')], [post], gift(50, 12, 38));
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ key: 'gift:g1:gift_out', kind: 'gift', at, what: 'You gave to a drive', aura: -50, wallet: 450, characters: ['g'] });
    expect(text(row!)).toBe('You gave 0.50 to the drive on post #3; 0.38 reached its author after an overhead of 0.12.');
    expect(row!.details.some((d) => typeof d === 'object' && d.text === 'post #3' && d.href.includes('th'))).toBe(true);
  });

  test('a gift on a staff post says it all went to overhead', () => {
    const [row] = rowsOf([out], [char('g', 'Spritey', 'heel')], [staffPost], gift(50, 50, 0));
    expect(text(row!)).toBe('You gave 0.50 to the drive on post #3; it all went to overhead.');
  });

  test('the author\'s line names the giver, the amount, and what they received, with the wallet after', () => {
    const [row] = rowsOf([into(0)], [char('a', 'Pipewrench', 'face')], [post], gift(50, 12, 38));
    expect(row).toMatchObject({ key: 'gift:g1:gift_in', kind: 'gift', what: 'A gift reached you', aura: 38, wallet: 700, characters: ['a'] });
    expect(text(row!)).toBe('Spritey gave 0.50 to the drive on your post #3; you received 0.38.');
  });

  test('a full wallet says how much of it was lost', () => {
    const [row] = rowsOf([into(12)], [char('a', 'Pipewrench', 'face')], [post], gift(50, 12, 38));
    expect(text(row!)).toBe('Spritey gave 0.50 to the drive on your post #3; you received 0.38, and your wallet was full, so 0.12 of it was lost.');
    expect(row!.aura).toBe(26);
  });

  test('a gift whose Acts could not be read is said plainly, with no link and no name', () => {
    const rows = logRows(data({ log: { ...empty, wallet: [out, into(0)] }, mine: [char('g', 'Spritey', 'heel')] }), words, 600, null).filter((r) => r.kind === 'gift');
    expect(rows.map(text)).toEqual(['You gave 0.50 to a drive.', 'Someone gave to a drive on one of your posts; you received 0.38.']);
  });

  test('no line names an owner, an account, or the author\'s wallet in the giver\'s', () => {
    const [giver] = rowsOf([out], [char('g', 'Spritey', 'heel')], [post], gift(50, 12, 38));
    expect(text(giver!)).not.toMatch(/wallet|owner|account|Pipewrench/iu);
    const [author] = rowsOf([into(12)], [char('a', 'Pipewrench', 'face')], [post], gift(50, 12, 38));
    expect(text(author!)).not.toMatch(/owner|account|\bplayer\b/iu);
  });

  test('actsNamed names a gift\'s Act, and the Acts it leads to are followed', () => {
    expect(actsNamed({ ...empty, wallet: [out, into(0)] }, null, [])).toEqual(['g1']);
    expect(actsFollowed(new Map([[ 'g1', gift(50, 12, 38)]]))).toEqual(['d1']);
  });

  test('a card says whether a play opened a drive or joined it, from what the play recorded', () => {
    const w: Words = { ...words, ui: { ...words.ui, cards: [{ key, art: { color: '#000', ink: '#fff', canvas: '', mark: '', credit: 'Test' }, describe: () => '', logPlay: (_c: Readonly<Record<string, unknown>>, r: { readonly opened?: boolean }) => (r.opened ? 'It opened a drive.' : 'It joined the drive.') }] } };
    const joined = act('d2', 'card', 'c', { targetActId: 'post3', payload: { card: key, drive: 'd1' } });
    const play = (p: Act, id: string) => logRows(data({ log: { ...empty, cards: [{ card: key, kind: 'played' as const, act: id, price: 0, at }] }, mine: [char('c', 'Gloomba', 'heel')], acts: new Map([post, p].map((a) => [a.id, a])) }), w, 600, null).find((r) => r.kind === 'played')!;
    expect(text(play(opening, 'd1'))).toMatch(/ It opened a drive\.$/u);
    expect(text(play(joined, 'd2'))).toMatch(/ It joined the drive\.$/u);
    expect(text(play(joined, 'd2'))).not.toContain('opened');
  });
});

/* Card notes, Part 6 (docs/plans/2026-11-11-card-notes-part-6-plan.md, Task 9): the lines a skim, a ride and a scored-as card write, said word for word. */
describe('the payout cards\' lines', () => {
  const at = '2026-10-30T10:00:00.000Z';
  const later = '2026-10-31T10:00:00.000Z';
  const day0 = '2026-10-29T08:17:00.000Z';
  const day1 = '2026-10-30T08:17:00.000Z';
  const act = (id: string, kind: Act['kind'], character: string | null, over: Partial<Act> = {}): Act =>
    ({ id, kind, character, thread: 'th', targetActId: null, seq: null, createdAt: at, payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over });
  const text = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');
  const card = (key: string, name: string, over: Record<string, unknown> = {}) => ({ ...testInstance.cards[0]!, key, name, ...over });
  const w: Words = {
    ...words,
    instance: { ...testInstance, cards: [...testInstance.cards,
      card('chess', '4D Chess', { play: 'set', trap: { trigger: { on: 'cast' }, outcome: { kind: 'ride', share: 1 } } }),
      card('offday', 'Off Day', { rarity: 'legendary', reaches: ['character'], scoresAs: true })] },
    ui: { ...words.ui, cards: [{ key: 'offday', art: { color: '#000', ink: '#fff', canvas: '', mark: '', credit: 'Test' }, describe: () => '', logPlay: (_c, r) => (r.rewindsTo === undefined ? `Window ${r.starts} to ${r.ends}.` : `Rewound to ${r.rewindsTo}.`) }] },
  };
  const posts = [act('post3', 'post', 'p', { seq: 3 }), act('post4', 'post', 's', { seq: 4 })];
  const names = new Map([['s', 'Spritey']]);

  test('scoredAs leaves a card\'s payout out, so a paid character still reads as the class it was scored as', () => {
    const lines = [{ character: 'p', reason: 'heel.drewHeat', amount: 5, shares: [] }, { character: 'p', reason: 'card.skim', amount: 1, params: { card: 'mooch' }, shares: [] }];
    expect(scoredAs(lines, testInstance)).toBe('heel');
    expect(scoredAs([lines[1]!], testInstance)).toBeNull();
    /* A cushion's line is a card's too: it names no class, and changes none. */
    const cushioned = [...lines, { character: 'p', reason: 'card.cushion', amount: 3, params: { card: 'pad', share: 0.5 }, shares: [] }];
    expect(scoredAs(cushioned, testInstance)).toBe('heel');
    expect(scoredAs([cushioned[2]!], testInstance)).toBeNull();
  });

  test('scoredAs leaves the crowd floor and the reveal perk out: neither is a class\'s reason, so neither unsets the class the other lines name', () => {
    const cheered = { character: 'p', reason: 'face.cheered', amount: 4, shares: [] };
    const floor = { character: 'p', reason: 'crowd.floor', amount: 1, shares: [] };
    const perk = { character: 'p', reason: 'reveal.perk', amount: 2, shares: [] };
    expect(scoredAs([cheered, floor], testInstance)).toBe('face');
    expect(scoredAs([cheered, perk], testInstance)).toBe('face');
    expect(scoredAs([cheered, floor, perk], testInstance)).toBe('face');
    expect(scoredAs([floor], testInstance)).toBeNull();
    expect(scoredAs([perk], testInstance)).toBeNull();
  });

  test('a 4D Chess that rode says what sprang it, that the cast landed as usual, and what each vote pays, from the card\'s own share', () => {
    const play = act('k1', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', rode: 'set1' } });
    const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'chess', trigger: 'cast', did: 'rode', quadrant: 'excitedPositive', set: 'set1', by: 'k1' } });
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'chess', post: 'post3', spring: 'sp', endedAt: later, endedBy: 'sprung' as const }] };
    const rows = logRows(data({ log, mine: [char('p', 'Pipewrench', 'heel')], acts: new Map([...posts, play, spring].map((a) => [a.id, a])), names }), w, 600, null);
    expect(rows.map((r) => r.kind)).toEqual(['sprung']);
    expect(text(rows[0]!)).toBe('4D Chess on your post #3 sprang when Spritey cast Whoops! on it. Whoops! landed as usual, and its caster keeps what it earns. Each vote of Hype it draws pays you a vote, in each settlement\'s lines.');
    /* Retuned, the new share is the one said. */
    const half = { ...w, instance: { ...w.instance, cards: w.instance.cards.map((c) => (c.key === 'chess' ? { ...c, trap: { trigger: { on: 'cast' as const }, outcome: { kind: 'ride' as const, share: 0.5 } } } : c)) } };
    expect(text(logRows(data({ log, mine: [char('p', 'Pipewrench', 'heel')], acts: new Map([...posts, play, spring].map((a) => [a.id, a])), names }), half, 600, null)[0]!)).toContain('pays you half a vote,');
  });

  test('a refund back that returned a cast says the cast landed and its card went back to its caster\'s hand', () => {
    const play = act('k1', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', handedBack: { by: 'set1', card: 'chess' } } });
    const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'chess', trigger: 'cast', did: 'returned', set: 'set1', by: 'k1' } });
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'chess', post: 'post3', spring: 'sp', endedAt: later, endedBy: 'sprung' as const }] };
    const rows = logRows(data({ log, mine: [char('p', 'Pipewrench', 'heel')], acts: new Map([...posts, play, spring].map((a) => [a.id, a])), names }), w, 600, null);
    expect(rows.map((r) => r.kind)).toEqual(['sprung']);
    expect(text(rows[0]!)).toBe('4D Chess on your post #3 sprang when Spritey cast Whoops! on it. Whoops! landed, and its card went back to its caster\'s hand.');
  });

  test('a ride that rode with no quadrant says each vote it draws pays, never "of the kind"', () => {
    const play = act('k1', 'card', 's', { targetActId: 'post3', payload: { card: 'whoops', rode: 'set1' } });
    const spring = act('sp', 'spring', 'p', { targetActId: 'post3', payload: { card: 'chess', trigger: 'cast', did: 'rode', set: 'set1', by: 'k1' } });
    const log = { ...empty, setEnds: [{ play: 'set1', card: 'chess', post: 'post3', spring: 'sp', endedAt: later, endedBy: 'sprung' as const }] };
    const quarter = { ...w, instance: { ...w.instance, cards: w.instance.cards.map((c) => (c.key === 'chess' ? { ...c, trap: { trigger: { on: 'cast' as const }, outcome: { kind: 'ride' as const, share: 0.25, every: true as const } } } : c)) } };
    const t = text(logRows(data({ log, mine: [char('p', 'Pipewrench', 'heel')], acts: new Map([...posts, play, spring].map((a) => [a.id, a])), names }), quarter, 600, null)[0]!);
    expect(t).toContain('Each vote it draws pays you a quarter of a vote');
    expect(t).not.toContain('of the kind');
  });

  /* An Off Day on Pipewrench, played from post 3 by Pipewrench: it names a Heel for the window of Oct 29 to Oct 30. */
  const named = act('k1', 'card', 'p', { targetActId: 'post3', payload: { card: 'offday', reach: 'character', character: 'p', config: { class: 'heel' }, starts: day0, ends: day1 } });
  const scoredRow = { settlement: 1, character: 'p', classKey: 'heel', play: 'k1', card: 'offday', startsAt: day0, endsAt: day1 };
  const OWN = 'Off Day named a Heel for Pipewrench in this window, so it was scored as one whatever its own class. That ended with this settlement, and its own class never changed.';

  test('a play\'s rewind_at reaches the card\'s sentence as rewindsTo, and a play without one gives none', () => {
    const log = { ...empty, cards: [{ card: 'offday', kind: 'played' as const, act: 'k1', price: 0, at }] };
    const point = '2026-10-29T08:17:00.000Z';
    const say = (a: Act) => text(logRows(data({ log, mine: [char('p', 'Pipewrench', 'face')], acts: new Map([...posts, a].map((x) => [x.id, x])), names }), w, 600, null).find((r) => r.kind === 'played')!);
    expect(say({ ...named, payload: { ...named.payload, rewind_at: point } })).toContain(`Rewound to ${point}.`);
    expect(say(named)).not.toContain('Rewound to');
  });

  test('the target\'s and the caster\'s rows for an Off Day carry the card\'s sentence, given the window it named', () => {
    const log = { ...empty, cards: [{ card: 'offday', kind: 'played' as const, act: 'k1', price: 0, at }], playsOnMine: [{ play: 'k1', post: 'post3', at, reach: 'character' as const, targetName: 'Pipewrench', targetCharacter: 'p' }] };
    const rows = logRows(data({ log, mine: [char('p', 'Pipewrench', 'face')], acts: new Map([...posts, named].map((a) => [a.id, a])), names }), w, 600, null);
    expect(rows.map((r) => r.kind).sort()).toEqual(['onMine', 'played']);
    expect(text(rows.find((r) => r.kind === 'onMine')!)).toBe(`Off Day was played on Pipewrench. Window ${day0} to ${day1}.`);
    expect(text(rows.find((r) => r.kind === 'played')!)).toContain(`Window ${day0} to ${day1}.`);
  });

  test('a settlement that scored the named class says so in the character\'s sentence, in a tab and in All', () => {
    const log = { ...empty, settlements: [settled(1, day1, [{ character: 'p', reason: 'heel.drewHeat', amount: 5, shares: [] }, { character: 'p', reason: 'card.skim', amount: 1, params: { card: 'mooch' }, shares: [] }])], scoredAs: [scoredRow] };
    const mine = [char('p', 'Pipewrench', 'face')];
    const [tabbed] = logRows(data({ log, mine, acts: new Map([...posts, named].map((a) => [a.id, a])) }), w, 600, 'p').filter((r) => r.kind === 'settlement');
    expect(text(tabbed!)).toBe(`Scored as a Heel for Oct 29: drew heat +0.05, card.skim +0.01. ${OWN}`);
    const [all] = logRows(data({ log, mine, acts: new Map([...posts, named].map((a) => [a.id, a])) }), w, 600, null).filter((r) => r.kind === 'settlement');
    expect(text(all!)).toBe(`Scored for Oct 29. Pipewrench as a Heel: drew heat +0.05, card.skim +0.01. ${OWN}`);
    /* The sentence is in the settlement's row, so the character has no row of its own: no extra "ended" row. */
    expect(logRows(data({ log, mine, acts: new Map([...posts, named].map((a) => [a.id, a])) }), w, 600, null).filter((r) => r.kind === 'gimmickEnded' || r.what === 'Off Day on Pipewrench ended')).toEqual([]);
    expect(logRows(data({ log, mine, acts: new Map([...posts, named].map((a) => [a.id, a])) }), w, 600, 'p').filter((r) => r.kind === 'gimmickEnded')).toEqual([]);
  });

  test('a window in which the character has no line gets a row of its own at the settlement\'s end', () => {
    const log = { ...empty, scoredAs: [scoredRow] };
    const rows = logRows(data({ log, mine: [char('p', 'Pipewrench', 'face')], acts: new Map([...posts, named].map((a) => [a.id, a])) }), w, 600, null);
    expect(rows).toHaveLength(1);
    expect([rows[0]!.kind, rows[0]!.what, rows[0]!.at, rows[0]!.characters, rows[0]!.aura]).toEqual(['gimmickEnded', 'Off Day on Pipewrench ended', day1, ['p'], 0]);
    expect(text(rows[0]!)).toBe('Pipewrench was to be scored as a Heel for Oct 29, and nothing was scored for it in that window. Its own class never changed.');
    /* Another tab does not hold it. */
    expect(logRows(data({ log, mine: [char('p', 'Pipewrench', 'face'), char('q', 'Hooligan', 'face')], acts: new Map() }), w, 600, 'q')).toEqual([]);
  });

  test('the live estimate says a character is scored as the named class this window, by which card, and not outside it', () => {
    const now = w.now;
    const open = act('k2', 'card', 'p', { targetActId: 'post3', payload: { card: 'offday', reach: 'character', character: 'p', config: { class: 'heel' }, starts: new Date(now - 3_600_000).toISOString(), ends: new Date(now + 3_600_000).toISOString() } });
    const soon = act('k3', 'card', 'p', { targetActId: 'post3', payload: { card: 'offday', reach: 'character', character: 'p', config: { class: 'heel' }, starts: new Date(now + 3_600_000).toISOString(), ends: new Date(now + 7_200_000).toISOString() } });
    const estimate = { entries: [], asOf: new Date(now).toISOString(), freshAfter: null, crowd: null, lines: [{ character: 'p', reason: 'heel.drewHeat', amount: 5 }] };
    const mine = [char('p', 'Pipewrench', 'face')];
    const [row] = logRows(data({ estimate, mine, acts: new Map([...posts, open].map((a) => [a.id, a])) }), w, 600, 'p');
    expect(text(row!)).toContain(' Scored as a Heel this window by Off Day.');
    expect(text(logRows(data({ estimate, mine, acts: new Map([...posts, soon].map((a) => [a.id, a])) }), w, 600, 'p')[0]!)).not.toContain('Scored as');
    /* A window already closed is not in force either. */
    const closed = act('k4', 'card', 'p', { targetActId: 'post3', payload: { card: 'offday', reach: 'character', character: 'p', config: { class: 'heel' }, starts: new Date(now - 7_200_000).toISOString(), ends: new Date(now - 3_600_000).toISOString() } });
    expect(text(logRows(data({ estimate, mine, acts: new Map([...posts, closed].map((a) => [a.id, a])) }), w, 600, 'p')[0]!)).not.toContain('Scored as');
    /* An Off Day an admin ended is not in force. */
    const ended = { ...empty, ended: [{ cardEnd: 'e1', play: 'k2', side: 'onMine' as const, at: later, card: 'offday', character: 'p', reach: 'character' as const, targetName: 'Pipewrench', casterName: 'Pipewrench', postAuthorName: null }] };
    expect(text(logRows(data({ estimate, log: ended as never, mine, acts: new Map([...posts, open].map((a) => [a.id, a])) }), w, 600, 'p').find((r) => r.kind === 'estimate')!)).not.toContain('Scored as');
  });

  test('actsNamed leaves a scored-as row\'s play to the played and on-mine rows that name it', () => {
    expect(actsNamed({ ...empty, scoredAs: [scoredRow] }, null, [])).toEqual([]);
  });
});

describe('the conduct lines: what an admin did to the player\'s posts (the conduct plan, Task 2)', () => {
  const p = char('p', 'Pipewrench', 'heel');
  const other = char('q', 'Quill', 'face');
  const at = '2026-10-30T08:17:00.000Z';
  const act = (id: string, character: string): Act => ({ id, kind: 'post', character, thread: 't1', at, payload: {} } as unknown as Act);
  const row = (outcome: 'hide' | 'hideUntilEdited' | 'unhide' | 'approve', decision = 1, version = 'v1') => ({ decision, outcome, versionAct: version, post: 'post1', thread: 't1', at });
  const lines = (conduct: ReturnType<typeof row>[], tab: string | null = null) =>
    logRows(data({ mine: [p, other], conduct, acts: new Map([['v1', act('v1', 'p')], ['v2', act('v2', 'q')]]), titles: new Map([['t1', 'The Boiler Room']]) }), words, 100, tab).filter((r) => r.kind === 'conduct');

  test('says plainly what happened, each outcome in its words, with the thread linked and no word of who reported', () => {
    const [hide] = lines([row('hide')]);
    expect(hide!.what).toBe('An admin hid your post');
    expect(hide!.details).toEqual(['An admin hid your post in ', { text: 'The Boiler Room', href: '/t/t1?page=1' }, ' (code of conduct). An admin may have emailed you the details.']);
    expect(lines([row('hideUntilEdited')])[0]!.details).toEqual(['An admin hid your post in ', { text: 'The Boiler Room', href: '/t/t1?page=1' }, ' (code of conduct) until you edit it. An admin may have emailed you the details.']);
    expect(lines([row('unhide')])[0]!.details).toEqual(['An admin brought back your post in ', { text: 'The Boiler Room', href: '/t/t1?page=1' }, '.']);
    expect(lines([row('approve')])[0]!.details).toEqual(['An admin approved your edit in ', { text: 'The Boiler Room', href: '/t/t1?page=1' }, '.']);
    expect(JSON.stringify(lines([row('hide')])).toLowerCase()).not.toMatch(/report/u);
  });

  test('is in order by time with the other lines, moves no Aura, and sits in the tab of the character whose post it was', () => {
    const early = { ...row('hide', 1), at: '2026-10-29T00:00:00.000Z' };
    const late = { ...row('unhide', 2), at: '2026-10-31T00:00:00.000Z' };
    const all = logRows(data({ mine: [p, other], conduct: [early, late], acts: new Map([['v1', act('v1', 'p')]]), titles: new Map() }), words, 100, null);
    expect(all.map((r) => r.key)).toEqual(['conduct:2', 'conduct:1']);
    expect(all.every((r) => r.aura === 0 && r.wallet === null)).toBe(true);
    expect(lines([row('hide')], 'p')).toHaveLength(1);
    expect(lines([row('hide')], 'q')).toHaveLength(0);
    expect(lines([row('hide', 3, 'v2')], 'q')).toHaveLength(1);
  });

  test('names a thread it could not read as "a thread", never a blank', () => {
    const bare = logRows(data({ mine: [p], conduct: [row('hide')], acts: new Map(), titles: new Map() }), words, 100, null).filter((r) => r.kind === 'conduct');
    expect(bare[0]!.details).toEqual(['An admin hid your post in a thread (code of conduct). An admin may have emailed you the details.']);
  });
});

/**
 * A surface in the log (docs/plans/2026-11-11-graffiti-design.md, sections 3 and 11): what the drawer's own draws, the washes that cut them, the post's author's walls and washes are in plain words, from
 * public Acts, in the words the card gives and the engine's own where it gives none. None names an owner or a class, and a third character's log holds none of them.
 */
describe('the log of a surface', () => {
  const key = testInstance.cards[0]!.key;
  const art = { color: '#000', ink: '#fff', canvas: '', mark: '', credit: 'Test' };
  const wall = { key, art, describe: () => '', logDraw: { verb: 'tagged', noun: 'tag', nouns: 'tags', surface: 'the wall' }, logWash: { verb: 'washed' } };
  const bare = { key, art, describe: () => '' };
  const wallWords: Words = { ...words, ui: { ...words.ui, cards: [wall] } };
  const bareWords: Words = { ...words, ui: { ...words.ui, cards: [bare] } };
  const at = '2026-11-11T10:00:00.000Z';
  const act = (id: string, kind: Act['kind'], character: string | null, over: Partial<Act> = {}): Act =>
    ({ id, kind, character, thread: 'th', targetActId: null, seq: null, createdAt: at, payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over });
  const text = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');
  /* Gloomba (g) wrote post #3 with the wall; Spritey (s) wrote post #4 with the wall; the player's own characters are Pipewrench (p) and Hooligan (h). */
  const acts = new Map([
    act('post3', 'post', 'p', { seq: 3 }), act('k3', 'card', 'p', { targetActId: 'post3', payload: { card: key } }),
    act('post4', 'post', 's', { seq: 4 }), act('k4', 'card', 's', { targetActId: 'post4', payload: { card: key } }),
  ].map((a) => [a.id, a]));
  const names = new Map([['g', 'Gloomba'], ['s', 'Spritey']]);
  const draw = (over: Partial<NonNullable<Log['draws']>[number]> = {}): NonNullable<Log['draws']>[number] => ({ act: 'd1', kind: 'draw', play: 'k4', post: 'post4', character: 'p', mine: 'p', at, cells: 600, ...over });
  const rowsOf = (log: Partial<Log>, mine: MyCharacter[], tab: string | null = null, w: Words = wallWords) => logRows(data({ log: { ...empty, ...log }, mine, acts, names }), w, 600, tab);
  const pipewrench = char('p', 'Pipewrench', 'heel');
  const hooligan = char('h', 'Hooligan', 'face');

  test('the drawer\'s own draw says whose post it was on and how much of the surface it covers', () => {
    const [r] = rowsOf({ draws: [draw()] }, [pipewrench]);
    expect(r).toMatchObject({ kind: 'drew', at, aura: 0, wallet: null, characters: ['p'], what: 'You tagged a post' });
    expect(text(r!)).toBe('You tagged Spritey\'s post #4 (6% of the wall).');
    expect(r!.details[1]).toEqual({ text: 'Spritey\'s post #4', href: '/t/th?page=1#post-4' });
  });
  test('the post\'s author is told who drew on their post and how much it covers', () => {
    const [r] = rowsOf({ wallsDrawn: [draw({ act: 'd2', play: 'k3', post: 'post3', character: 'g', mine: 'p', cells: 600 })] }, [pipewrench]);
    expect(r).toMatchObject({ kind: 'drew', characters: ['p'], what: 'Gloomba tagged your post' });
    expect(text(r!)).toBe('Gloomba tagged your post #3 (6% of the wall).');
  });
  test('the author\'s own wash says how much it took off, in whole percents, and none where it took nothing', () => {
    const [r] = rowsOf({ wallsDrawn: [draw({ act: 'w1', kind: 'wash', play: 'k3', post: 'post3', character: 'p', cells: 950 })] }, [pipewrench]);
    expect(r).toMatchObject({ kind: 'washed', characters: ['p'], what: 'You washed your post' });
    expect(text(r!)).toBe('You washed 9% of the wall off your post #3.');
    const [none] = rowsOf({ wallsDrawn: [draw({ act: 'w2', kind: 'wash', play: 'k3', post: 'post3', character: 'p', cells: 0 })] }, [pipewrench]);
    expect(text(none!)).toBe('You washed your post #3, and nothing came off.');
  });
  test('a drawer whose tag a wash cut is told who washed it, on their own post', () => {
    const [r] = rowsOf({ draws: [draw({ act: 'w3', kind: 'cut', character: 's', mine: 'p', cells: 300 })] }, [pipewrench]);
    expect(r).toMatchObject({ kind: 'washed', characters: ['p'], what: 'Spritey washed your tag' });
    expect(text(r!)).toBe('Spritey washed your tag on their post #4.');
  });
  test('a share under a hundredth is said so, and never as 0%', () => {
    expect(text(rowsOf({ draws: [draw({ cells: 30 })] }, [pipewrench])[0]!)).toBe('You tagged Spritey\'s post #4 (under 1% of the wall).');
    expect(text(rowsOf({ draws: [draw({ cells: 100 })] }, [pipewrench])[0]!)).toBe('You tagged Spritey\'s post #4 (1% of the wall).');
    expect(text(rowsOf({ draws: [draw({ cells: 10000 })] }, [pipewrench])[0]!)).toBe('You tagged Spritey\'s post #4 (100% of the wall).');
  });
  test('the engine\'s own words stand where the card gives none, and name no card\'s', () => {
    const lines = rowsOf({
      draws: [draw(), draw({ act: 'w3', kind: 'cut', character: 's', cells: 300 })],
      wallsDrawn: [draw({ act: 'd2', play: 'k3', post: 'post3', character: 'g', cells: 600 }), draw({ act: 'w1', kind: 'wash', play: 'k3', post: 'post3', character: 'p', cells: 950 })],
    }, [pipewrench], null, bareWords).map(text).sort();
    expect(lines).toEqual([
      'Gloomba drew on your post #3 (6% of the surface).', 'Spritey washed your drawing on their post #4.',
      'You drew on Spritey\'s post #4 (6% of the surface).', 'You washed 9% of the surface off your post #3.',
    ]);
  });
  test('each line is in its character\'s tab alone', () => {
    const log = { draws: [draw()], wallsDrawn: [draw({ act: 'd2', play: 'k3', post: 'post3', character: 'g', mine: 'h', cells: 600 })] };
    const mine = [pipewrench, hooligan];
    expect(rowsOf(log, mine, 'p').map((r) => r.characters)).toEqual([['p']]);
    expect(rowsOf(log, mine, 'h').map((r) => r.characters)).toEqual([['h']]);
    expect(rowsOf(log, mine, null)).toHaveLength(2);
  });
  test('a log read by a third character shows none of the four lines', () => {
    const log = {
      draws: [draw(), draw({ act: 'w3', kind: 'cut', character: 's', cells: 300 })],
      wallsDrawn: [draw({ act: 'd2', play: 'k3', post: 'post3', character: 'g', cells: 600 }), draw({ act: 'w1', kind: 'wash', play: 'k3', post: 'post3', character: 'p', cells: 950 })],
    };
    expect(rowsOf(log, [char('z', 'Zed', 'face')])).toEqual([]);
    expect(rowsOf(log, [char('z', 'Zed', 'face')], 'z')).toEqual([]);
  });
  test('a line names no owner and no class, and a play or a post that could not be read is said in the engine\'s own words', () => {
    const [r] = rowsOf({ draws: [draw()] }, [pipewrench]);
    expect(text(r!)).not.toMatch(/Hooligan|heel|face|owner|player|Aura/u);
    const [lost] = logRows(data({ log: { ...empty, draws: [draw()] }, mine: [pipewrench], acts: new Map(), names: new Map() }), wallWords, 600, null);
    expect(text(lost!)).toBe('You drew on a post (6% of the surface).');
  });
  test('useLog reads the names of a drawer and a washer the page did not carry, so the lines name them', async () => {
    const log = { ...empty, wallsDrawn: [draw({ act: 'd2', play: 'k3', post: 'post3', character: 'g', mine: 'p', cells: 600 })], draws: [draw({ act: 'w3', kind: 'cut', character: 'x', mine: 'p', cells: 300 })] };
    const asked: string[][] = [];
    const api = {
      actsById: async () => [], actsCutting: async () => [], effectStates: async () => ({}), thread: async () => null, board: async () => null,
      characters: async (ids: readonly string[]) => { asked.push([...ids]); return ids.map((id) => ({ id, name: id === 'g' ? 'Gloomba' : 'Xavier' })); },
    } as unknown as KayfaApi;
    const read = await around(api, log, data({ log, mine: [pipewrench], acts, names: new Map() }));
    expect(asked.flat().sort()).toEqual(['g', 's', 'x']);
    expect(logRows(read, wallWords, 600, null).map(text).sort()).toEqual(['Gloomba tagged your post #3 (6% of the wall).', 'Xavier washed your tag on their post #4.']);
  });
  test('actsNamed names each row\'s play and post, never its own Act, whose strokes the page would carry', () => {
    const ids = actsNamed({ ...empty, draws: [draw()], wallsDrawn: [draw({ act: 'w1', kind: 'wash', play: 'k3', post: 'post3' })] }, null, []);
    expect(ids).toEqual(expect.arrayContaining(['k4', 'post4', 'k3', 'post3']));
    expect(ids).not.toContain('d1');
    expect(ids).not.toContain('w1');
  });
});

/**
 * The discipline cards' lines (card notes, part 5, Task 7): what a heart took off or an Unban ended, said by the play's own Act on the caster's line and the target's; an infraction a
 * heart took points off or that landed through a fall; a ban an Unban ended; and the fall taken for the author's post. Each is plain and true: which Act did what, to whom, how much.
 * No line names an owner, a class or anyone who reacted.
 */
describe('the discipline cards\' lines', () => {
  const T = 'th1';
  const mineBoth = [char('p', 'Spritey', 'face', undefined, PRONOUN_PRESETS.they), char('q', 'Pipewrench', 'heel', undefined, PRONOUN_PRESETS.she)];
  const cards = { ...words.ui, cards: [] };
  const named = { ...words, instance: { ...testInstance, cards: [{ ...testInstance.cards[0]!, key: 'ultra', name: 'Ultra Happy Heart' }, { ...testInstance.cards[0]!, key: 'heart', name: 'Happy Heart' }] }, ui: cards };
  const at = '2099-10-30T12:00:00.000Z';
  const post = (id: string, character: string): Act => ({ id, character, kind: 'post', thread: T, targetActId: null, seq: 41, createdAt: at, payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null });
  const played = (id: string, character: string, on: string, payload: Record<string, unknown>): Act => ({ id, character, kind: 'card', thread: T, targetActId: on, seq: null, createdAt: at, payload: { card: 'heart', message: '', config: {}, reach: 'character', instant: true, ...payload }, currentPayload: {}, editedAt: null, shownEditedAt: null });
  const said = (r: { readonly details: readonly (string | { readonly text: string })[] }) => r.details.map((d) => (typeof d === 'string' ? d : d.text)).join('');
  const inf = (over: Partial<Log['infractions'][number]> = {}): Log['infractions'][number] => ({
    infraction: 'i1', character: 'p', at: '2099-10-30T12:14:00.000Z', band: 'minor', points: 4, ruleNumber: 2, rule: 'Rule 2: No double posting', mod: 'The Clerk', post: 'post41', postSeq: 41, thread: T,
    expiresAt: '2099-11-13T12:14:00.000Z', relief: 0, emptiedAt: null, cardRelief: 0, fallPlay: null, ...over,
  });
  const ban = (over: Partial<Log['bans'][number]> = {}): Log['bans'][number] => ({ ban: 'b1', character: 'p', at: '2099-10-30T12:15:00.000Z', days: 3, until: '2099-11-02T12:15:00.000Z', infraction: 'i1', rule: null, thread: T, ruling: null, ownUntil: '2099-11-02T12:15:00.000Z', liftedAt: null, liftedCard: null, ...over });
  const rowsOf = (log: Partial<Log>, acts: readonly Act[] = [], tab: string | null = null) => logRows(data({ log: { ...empty, ...log }, mine: mineBoth, acts: new Map(acts.map((a) => [a.id, a])) }), named, 600, tab);

  test('the caster\'s line and the target\'s line say what a heart took off, "1 warn point" or "2 warn points", oldest first', () => {
    const one = played('k1', 'q', 'post41', { took: 1, character: 'p', targetName: 'Spritey' });
    const two = played('k2', 'q', 'post41', { took: 2, character: 'p', targetName: 'Spritey' });
    const log = { cards: [{ card: 'heart', kind: 'played' as const, act: 'k1', at, price: 0 }, { card: 'heart', kind: 'played' as const, act: 'k2', at, price: 0 }], playsOnMine: [{ play: 'k1', post: 'post41', at, reach: 'character' as const, targetName: 'Spritey', targetCharacter: 'p' }, { play: 'k2', post: 'post41', at, reach: 'character' as const, targetName: 'Spritey', targetCharacter: 'p' }] };
    const rows = rowsOf(log, [post('post41', 'p'), one, two]);
    const played1 = rows.filter((r) => r.kind === 'played').map(said);
    const onMine = rows.filter((r) => r.kind === 'onMine').map(said);
    expect(played1.some((t) => t.endsWith(" It took 1 warn point off Spritey's warn bar, oldest first."))).toBe(true);
    expect(played1.some((t) => t.endsWith(" It took 2 warn points off Spritey's warn bar, oldest first."))).toBe(true);
    expect(onMine.some((t) => t.endsWith(" It took 1 warn point off Spritey's warn bar, oldest first."))).toBe(true);
    expect(onMine.some((t) => t.endsWith(" It took 2 warn points off Spritey's warn bar, oldest first."))).toBe(true);
  });

  test('an Unban\'s line says it ended the ban, and when the ban was set to end; several bans say how many', () => {
    const one = played('k1', 'q', 'post41', { character: 'p', targetName: 'Spritey', lifted: [{ ban: 'b1', until: '2099-11-02T12:15:00.000Z' }] });
    const many = played('k2', 'q', 'post41', { character: 'p', targetName: 'Spritey', lifted: [{ ban: 'b1', until: '2099-11-02T12:15:00.000Z' }, { ban: 'b2', until: '2099-11-05T09:30:00.000Z' }] });
    const log = { playsOnMine: [{ play: 'k1', post: 'post41', at, reach: 'character' as const, targetName: 'Spritey', targetCharacter: 'p' }, { play: 'k2', post: 'post41', at, reach: 'character' as const, targetName: 'Spritey', targetCharacter: 'p' }] };
    const onMine = rowsOf(log, [post('post41', 'p'), one, many]).filter((r) => r.kind === 'onMine').map(said);
    expect(onMine.some((t) => t.endsWith(" It ended Spritey's ban, which was set to end Nov 2 · 12:15 UTC."))).toBe(true);
    expect(onMine.some((t) => t.endsWith(" It ended 2 of Spritey's bans, the longest of which was set to end Nov 5 · 09:30 UTC."))).toBe(true);
  });

  test('a play that is not instant, or says nothing of what it took, gets no extra sentence', () => {
    const plain = { ...played('k1', 'q', 'post41', {}), payload: { card: 'heart', message: '', config: {}, reach: 'character', character: 'p', ends: '2099-11-02T00:00:00.000Z' } } as Act;
    const rows = rowsOf({ playsOnMine: [{ play: 'k1', post: 'post41', at, reach: 'character' as const, targetName: 'Spritey', targetCharacter: 'p' }] }, [post('post41', 'p'), plain]);
    expect(said(rows.find((r) => r.kind === 'onMine')!)).not.toContain('It took');
    expect(said(rows.find((r) => r.kind === 'onMine')!)).not.toContain('It ended');
  });

  test('an infraction says what cards took off, and what is left is the points less both reliefs', () => {
    const [row] = rowsOf({ infractions: [inf({ relief: 1, cardRelief: 2, expiresAt: '2000-01-01T00:00:00.000Z', emptiedAt: '1999-12-31T00:00:00.000Z' })] });
    expect(said(row!)).toContain(' An appeal took 1 point off.');
    expect(said(row!)).toContain(' Cards took 2 points off.');
    /* 4 - 1 - 2 is 1: "this point". */
    expect(said(row!)).toContain('so this point stopped counting then.');
    const [empty_] = rowsOf({ infractions: [inf({ relief: 1, cardRelief: 3, emptiedAt: '1999-12-31T00:00:00.000Z' })] });
    expect(said(empty_!)).toContain(' Cards took 3 points off.');
    expect(said(rowsOf({ infractions: [inf({ cardRelief: 1 })] })[0]!)).toContain(' Cards took 1 point off.');
    /* Cards took everything (4 - 1 - 3 is 0): the line says so, and speaks of the points in the plural as it does for an appeal's relief that took everything. */
    expect(said(empty_!)).toContain('so these points stopped counting then.');
    expect(said(rowsOf({ infractions: [inf({ cardRelief: 0 })] })[0]!)).not.toContain('Cards took');
  });

  test('an infraction that landed through a fall names the post without calling it "your post", and says who took the fall for that post', () => {
    const [row] = rowsOf({ infractions: [inf({ character: 'q', points: 2, fallPlay: 'fall1', postSeq: 41, expiresAt: '2099-11-13T12:14:00.000Z' })] });
    expect(said(row!)).toBe("The Clerk's visit to post #41 filed Rule 2: No double posting: 2 warn points for Pipewrench, who took the fall for that post, dropping off Nov 13.");
    expect(row!.details[1]).toEqual({ text: 'post #41', href: '/t/th1?page=3#post-41' });
    expect(row).toMatchObject({ kind: 'infraction', characters: ['q'], aura: 0 });
    const [gone] = rowsOf({ infractions: [inf({ character: 'q', points: 2, fallPlay: 'fall1', postSeq: null, expiresAt: '2000-01-01T00:00:00.000Z' })] });
    expect(said(gone!)).toBe("The Clerk's visit to a post filed Rule 2: No double posting: 2 warn points for Pipewrench, who took the fall for that post, dropped off Jan 1.");
  });

  test('a ban an Unban ended says when and by which card, in place of "ended by itself", and offers no appeal', () => {
    const lifted = ban({ until: '2099-10-31T08:00:00.000Z', liftedAt: '2099-10-31T08:00:00.000Z', liftedCard: 'ultra' });
    const [row] = rowsOf({ bans: [lifted] });
    expect(said(row!)).toContain('The ban ended Oct 31 · 08:00 UTC, when Ultra Happy Heart was played on Spritey.');
    expect(said(row!)).not.toContain('ended by itself');
    expect(said(row!)).toContain('The ban is on Spritey only; each character has its own warn bar.');
    expect(row!.appealBan).toBeUndefined();
    /* An appeal ruled after the Unban changes nothing about how the ban first ended: a live lift is always its first end. */
    for (const ruling of ['overturned', 'reduced', 'increased'] as const) {
      const [r] = rowsOf({ bans: [{ ...lifted, ruling }] });
      expect(said(r!)).toContain('The ban ended Oct 31 · 08:00 UTC, when Ultra Happy Heart was played on Spritey.');
      expect(said(r!)).not.toContain('An appeal');
      expect(r!.appealBan).toBeUndefined();
    }
    /* A running ban that was not lifted is as it was, appealable. */
    const [still] = rowsOf({ bans: [ban()] });
    expect(said(still!)).toContain('The ban ends by itself Nov 2 · 12:15 UTC.');
    expect(still!.appealBan).toBeDefined();
    /* A card the instance no longer has is said plainly. */
    expect(said(rowsOf({ bans: [{ ...lifted, liftedCard: 'gone' }] })[0]!)).toContain('when a card was played on Spritey.');
  });

  test('a fall taken says whose visit, what it filed, who took the fall, where the points landed and that the post keeps its notice; it is the author\'s row', () => {
    const fall = { infraction: 'i9', character: 'p', at: '2099-10-30T12:20:00.000Z', post: 'post41', postSeq: 41, thread: T, rule: 'Rule 2: No double posting', points: 2, mod: 'The Clerk', takerName: 'Gloomba' };
    const rows = rowsOf({ falls: [fall] });
    const row = rows.find((r) => r.kind === 'fallTaken')!;
    expect(row).toMatchObject({ key: 'fallTaken:i9', what: 'A fall taken for your post', at: fall.at, aura: 0, wallet: null, characters: ['p'] });
    expect(said(row)).toBe("The Clerk's visit to your post #41 filed Rule 2: No double posting. Gloomba took the fall, so the 2 warn points landed on Gloomba and none on Spritey. The post keeps its notice.");
    expect(row.details[1]).toEqual({ text: 'your post #41', href: '/t/th1?page=3#post-41' });
    /* It is in the author's tab, and in All, and in no other tab. */
    expect(rowsOf({ falls: [fall] }, [], 'p').some((r) => r.kind === 'fallTaken')).toBe(true);
    expect(rowsOf({ falls: [fall] }, [], 'q').some((r) => r.kind === 'fallTaken')).toBe(false);
    /* Unknown parts are said plainly, and a point is singular. */
    const bare = rowsOf({ falls: [{ ...fall, rule: null, mod: null, takerName: null, points: 1, postSeq: null }] }).find((r) => r.kind === 'fallTaken')!;
    expect(said(bare)).toBe("A Mod's visit to your post filed a breach of the rules. Another character took the fall, so the 1 warn point landed on Another character and none on Spritey. The post keeps its notice.");
  });

  test('no line names an owner, an account, a class or who reacted, and each says which Act and how much', () => {
    const fall = { infraction: 'i9', character: 'p', at: '2099-10-30T12:20:00.000Z', post: 'post41', postSeq: 41, thread: T, rule: 'Rule 2: No double posting', points: 2, mod: 'The Clerk', takerName: 'Gloomba' };
    const one = played('k1', 'q', 'post41', { took: 2, character: 'p', targetName: 'Spritey' });
    const rows = rowsOf({
      falls: [fall], infractions: [inf({ cardRelief: 1 }), inf({ infraction: 'i2', character: 'q', fallPlay: 'f', points: 2 })], bans: [ban({ liftedAt: at, liftedCard: 'ultra' })],
      playsOnMine: [{ play: 'k1', post: 'post41', at, reach: 'character' as const, targetName: 'Spritey', targetCharacter: 'p' }],
    }, [post('post41', 'p'), one]);
    const all = rows.map((r) => `${r.what} ${said(r)}`).join('\n');
    expect(all).not.toMatch(/\b(account|owner|owned|heel|face|reacted)\b/iu);
    expect(rows.filter((r) => ['infraction', 'ban', 'fallTaken', 'onMine'].includes(r.kind)).length).toBeGreaterThanOrEqual(5);
  });

  test('two pages merged keep the falls of both, newer first', () => {
    const f = (id: string) => ({ infraction: id, character: 'p', at, post: 'post41', postSeq: 41, thread: T, rule: null, points: 2, mod: null, takerName: null });
    expect(mergeLogs({ ...empty, falls: [f('a')] }, { ...empty, falls: [f('b')] }).falls?.map((x) => x.infraction)).toEqual(['a', 'b']);
    expect(mergeLogs({ ...empty }, { ...empty, falls: [f('b')] }).falls?.map((x) => x.infraction)).toEqual(['b']);
  });
});

describe('a pack in the log', () => {
  const at = '2026-11-02T10:00:00.000Z';
  const opened = '2026-11-03T12:00:00.000Z';
  const pw: Words = { ...words, instance: { ...testInstance, cards: [...testInstance.cards, testCutter] }, ui: { ...words.ui, packs: { starter: { name: 'Starter Pack' }, big: { name: 'Big Pack' } } as unknown as Words['ui']['packs'] } };
  const pulled = (card: string, pack: string, when: string) => ({ card, kind: 'pulled' as const, act: null, price: 0, at: when, pack });
  const pack = (over: Partial<Log['packs'][number]>): Log['packs'][number] => ({ pack: 'pk', kind: 'big', price: 300, repriced: false, contents: ['whoops', 'cutter'], at, source: 'bought', openedAt: at, ...over });
  const lines = (log: Log) => logRows(data({ log, mine: [char('p', 'Pipewrench', 'face')] }), pw, 600, 'p').filter((r) => r.kind === 'pack');

  test('a bought pack\'s line is unchanged', () => {
    const [row] = lines({ ...empty, cards: [pulled('whoops', 'pk', at), pulled('cutter', 'pk', at)], packs: [pack({})] });
    expect(row!.what).toBe('You bought a Big Pack');
    expect(row!.details.join('')).toBe('Whoops! and Cutter. From the Shop, for 3.00.');
    expect(row!.aura).toBe(-300);
  });

  test('a welcome pack is its own line when given, and its opening a second line listing the cards in order', () => {
    const log = { ...empty, cards: [pulled('cutter', 'pk', opened), pulled('whoops', 'pk', opened)], packs: [pack({ kind: 'starter', price: 0, source: 'welcome', contents: ['cutter', 'whoops'], openedAt: opened })] };
    const rows = lines(log);
    expect(rows.map((r) => [r.what, r.at, r.aura])).toEqual([
      ['You opened your Starter Pack', opened, 0],
      ['Welcome gift: a sealed Starter Pack', at, 0],
    ]);
    expect(rows[0]!.details.join('')).toBe('Cutter and Whoops!.');
  });

  test('a welcome pack opened on a later page than its gift: pulled rows alone make the opening line, never a purchase', () => {
    const welcome = (card: string) => ({ ...pulled(card, 'pk', opened), packKind: 'starter', packSource: 'welcome' as const });
    const rows = lines({ ...empty, cards: [welcome('cutter'), welcome('whoops')] });
    expect(rows.map((r) => [r.what, r.at, r.aura])).toEqual([['You opened your Starter Pack', opened, 0]]);
    expect(rows[0]!.details.join('')).toBe('Cutter and Whoops!.');
  });

  test('a sealed welcome pack shows the gift line alone', () => {
    const rows = lines({ ...empty, packs: [pack({ kind: 'starter', price: 0, source: 'welcome', contents: [], openedAt: null })] });
    expect(rows.map((r) => r.what)).toEqual(['Welcome gift: a sealed Starter Pack']);
  });
});

/**
 * Crowd pay (docs/plans/2026-11-20-crowd-pay-plan.md, Task 5): a wallet event of kind `crowd` is a row of its own in every tab, in plain and true words, with a link to each Act paid
 * for; the estimate says the crowd pay so far in a row of its own. The wallet's, so no character's: nothing here says who reacted, and none moves a character's Aura.
 */
describe('the crowd pay line', () => {
  const at = '2099-11-20T09:00:00.000Z';
  const act = (id: string, seq: number): Act =>
    ({ id, kind: 'post', character: 'g', thread: 'th', targetActId: null, seq, createdAt: at, payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null });
  const acts = (n: number) => Array.from({ length: n }, (_, i) => act(`a${i + 1}`, i + 1));
  const heldActs = (n: number) => new Map(acts(n).map((a) => [a.id, a]));
  const names = new Map([['g', 'Gloomba']]);
  const mine = [char('p', 'Pat', 'face'), char('q', 'Quinn', 'heel')];
  const event = (change: number, overflow: number, settlement = 5): Log['wallet'][number] => ({ settlement, kind: 'crowd', change, overflow, floored: 0, balanceAfter: 300, ref: null, at });
  const paid = (n: number, settlement = 5, most = 7) => acts(n).map((a) => ({ settlement, act: a.id, most, startsAt: '2099-11-19T09:00:00.000Z', endsAt: at }));
  const w: Words = words;
  const rowsOf = (log: Log, tab: string | null, n: number) => logRows(data({ log, mine, names, acts: heldActs(n) }), w, 600, tab).filter((r) => r.kind === 'crowd');
  const said = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');
  const links = (r: { details: readonly unknown[] }) => r.details.filter((d) => typeof d !== 'string') as { text: string; href: string }[];

  test('a crowd event of 14 over 6 Acts says the sentence, with 6 links, in All and in a tab alike', () => {
    for (const tab of [null, 'p', 'q']) {
      const [row, ...rest] = rowsOf({ ...empty, wallet: [event(14, 0)], crowd: paid(6) }, tab, 6);
      expect(rest).toEqual([]);
      expect(row).toMatchObject({ key: 'crowd:5', kind: 'crowd', at, what: 'Crowd pay', aura: 14, wallet: 300, characters: [] });
      expect(said(row!)).toBe(`You reacted to 6 Acts by other players and were paid 0.14 Aura. ${acts(6).map((a) => `Gloomba's post #${a.seq}`).join(', ')}.`);
      expect(links(row!)).toHaveLength(6);
      expect(links(row!)[0]).toEqual({ text: "Gloomba's post #1", href: expect.stringContaining('th') });
    }
  });

  test('one Act is "1 Act", not "1 Acts"', () => {
    const [row] = rowsOf({ ...empty, wallet: [event(2, 0)], crowd: paid(1) }, null, 1);
    expect(said(row!)).toMatch(/^You reacted to 1 Act by other players and were paid 0.02 Aura\. /u);
  });

  test('at the most one settlement pays, it says so', () => {
    const [row] = rowsOf({ ...empty, wallet: [event(14, 0)], crowd: paid(7) }, null, 7);
    expect(said(row!)).toMatch(/^You reacted to 7 Acts by other players and were paid 0.14 Aura\. That's the most one settlement pays\. Gloomba's post #1/u);
    expect(links(row!)).toHaveLength(7);
    const [under] = rowsOf({ ...empty, wallet: [event(12, 0)], crowd: paid(6) }, null, 6);
    expect(said(under!)).not.toContain('the most one settlement pays');
  });

  test('the cap sentence is the cap recorded when it was paid, never today\'s setting', () => {
    const [older] = rowsOf({ ...empty, wallet: [event(6, 0)], crowd: paid(3, 5, 10) }, null, 3);
    expect(said(older!)).not.toContain('the most one settlement pays');
    const [reached] = rowsOf({ ...empty, wallet: [event(6, 0)], crowd: paid(3, 5, 3) }, null, 3);
    expect(said(reached!)).toContain("That's the most one settlement pays.");
  });

  test('what the wallet\'s cap held back is said, and only when it held something back', () => {
    const [row] = rowsOf({ ...empty, wallet: [event(10, 4)], crowd: paid(7) }, null, 7);
    expect(said(row!)).toMatch(/Aura\. That's the most one settlement pays\. 0.04 more didn't fit under your wallet's cap\. Gloomba's post #1/u);
    const [none] = rowsOf({ ...empty, wallet: [event(10, 0)], crowd: paid(5) }, null, 5);
    expect(said(none!)).not.toContain("didn't fit");
  });

  test('another settlement\'s Acts are not this one\'s, and an Act that could not be read keeps the count without a link', () => {
    const log = { ...empty, wallet: [event(4, 0, 5), event(2, 0, 6)], crowd: [...paid(2, 5), { settlement: 6, act: 'gone', most: 7, startsAt: at, endsAt: at }] };
    const rows = rowsOf(log, null, 2);
    expect(rows.map((r) => r.key)).toEqual(['crowd:5', 'crowd:6']);
    expect(links(rows[0]!)).toHaveLength(2);
    expect(said(rows[1]!)).toMatch(/^You reacted to 1 Act by other players and were paid 0.02 Aura\.$/u);
  });

  test('it names no one who reacted, and no class', () => {
    const [row] = rowsOf({ ...empty, wallet: [event(14, 0)], crowd: paid(7) }, null, 7);
    expect(said(row!)).not.toMatch(/heel|face|Pat|Quinn/iu);
  });

  test('the estimate with crowd pay shows its row in All and in a tab, linking the Acts; without it, none', () => {
    const estimate = (crowd: { acts: string[]; amount: number } | null) => ({ entries: [], asOf: at, freshAfter: null, crowd, lines: [] });
    for (const tab of [null, 'p']) {
      const rows = logRows(data({ estimate: estimate({ acts: ['a1', 'a2', 'a3'], amount: 6 }), mine, names, acts: heldActs(3) }), w, 600, tab).filter((r) => r.kind === 'estimate');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ key: 'estimate:crowd', what: 'Estimate', wallet: null, characters: [] });
      expect(said(rows[0]!)).toBe("Crowd pay so far: 3 Acts, 0.06 Aura. Gloomba's post #1, Gloomba's post #2, Gloomba's post #3.");
      expect(links(rows[0]!)).toHaveLength(3);
    }
    expect(said(logRows(data({ estimate: estimate({ acts: ['a1'], amount: 2 }), mine, names, acts: heldActs(1) }), w, 600, null)[0]!)).toMatch(/^Crowd pay so far: 1 Act, 0.02 Aura\./u);
    expect(logRows(data({ estimate: estimate(null), mine }), w, 600, null)).toEqual([]);
  });

  test('actsNamed names the Acts paid and the Acts the estimate counts', () => {
    const estimate = { entries: [], asOf: at, freshAfter: null, crowd: { acts: ['e1'], amount: 2 }, lines: [] };
    expect(actsNamed({ ...empty, crowd: paid(2) }, estimate, []).sort()).toEqual(['a1', 'a2', 'e1']);
  });

  test('two pages merged keep each page\'s crowd rows', () => {
    const merged = mergeLogs({ ...empty, crowd: paid(1, 6) }, { ...empty, crowd: paid(2, 5) });
    expect(merged.crowd).toHaveLength(3);
  });

  test('the crowd row sits with the wallet\'s other rows, after the settlement\'s at one time', () => {
    const log = { ...empty, wallet: [event(2, 0)], crowd: paid(1), settlements: [settled(5, at, [{ character: 'p', reason: 'heel.drewHeat', amount: 5, shares: [] }])] };
    expect(logRows(data({ log, mine, names, acts: heldActs(1) }), w, 600, null).map((r) => r.kind)).toEqual(['settlement', 'crowd']);
  });
});

/**
 * The poll lines (the polls plan, Task 8): the player's own ballots (cast, changed, withdrawn, secret or not) and an admin's close of their poll, in plain words and true. The picks are said from the
 * poll's options; a line names the character's own name and pronoun and never another voter.
 */
describe('the poll lines', () => {
  const mine = [char('b', 'Wario', 'heel', undefined, PRONOUN_PRESETS.he), char('c', 'Waluigi', 'face', undefined, PRONOUN_PRESETS.they)];
  const at = '2026-11-20T12:00:00.000Z';
  const place = { thread: 'th', title: 'Best kart?', seq: 12 };
  const ballot = (over: Partial<NonNullable<Log['ballots']>[number]> = {}): NonNullable<Log['ballots']>[number] =>
    ({ act: 'a1', poll: 'pl', character: 'b', picks: [1], at, question: 'Best part?', secret: false, options: ['Wheel', 'Pipe Frame', 'Engine'], changed: false, place, ...over });
  const rowsOf = (log: Partial<Log>, tab: string | null = null) => logRows(data({ log: { ...empty, ...log }, mine }), words, 600, tab).filter((r) => r.kind === 'ballot' || r.kind === 'pollClose');
  const said = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');

  test('a cast ballot says what it picked, in which poll, and where the post is', () => {
    const [r] = rowsOf({ ballots: [ballot()] });
    expect(r).toMatchObject({ kind: 'ballot', at, aura: 0, wallet: null, characters: ['b'], what: 'Wario cast a ballot' });
    expect(said(r!)).toBe('Wario cast a ballot for Pipe Frame in the poll “Best part?” on #12 in Best kart?.');
    expect(r!.details).toContainEqual({ text: '#12 in Best kart?', href: '/t/th?page=1#post-12' });
  });
  test('two picks and three are said in a list', () => {
    expect(said(rowsOf({ ballots: [ballot({ picks: [0, 1] })] })[0]!)).toContain('for Wheel and Pipe Frame in');
    expect(said(rowsOf({ ballots: [ballot({ picks: [0, 1, 2] })] })[0]!)).toContain('for Wheel, Pipe Frame and Engine in');
  });
  test('a secret ballot says so, to its own player', () => {
    expect(said(rowsOf({ ballots: [ballot({ secret: true })] })[0]!)).toBe('Wario cast a ballot for Pipe Frame in the poll “Best part?” on #12 in Best kart? (secret ballot).');
  });
  test('a change of ballot says it changed, with the pronoun the log reads for the character', () => {
    const [r] = rowsOf({ ballots: [ballot({ changed: true, picks: [2] })] });
    expect(said(r!)).toBe('Wario changed his ballot to Engine in the poll “Best part?” on #12 in Best kart?.');
    expect(r!.what).toBe('Wario changed his ballot');
    expect(said(rowsOf({ ballots: [ballot({ changed: true, character: 'c' })] })[0]!)).toContain('Waluigi changed their ballot to Pipe Frame');
  });
  test('a withdrawal says it was withdrawn, and a secret one says so too', () => {
    expect(said(rowsOf({ ballots: [ballot({ changed: true, picks: [] })] })[0]!)).toBe('Wario withdrew his ballot in the poll “Best part?” on #12 in Best kart?.');
    expect(said(rowsOf({ ballots: [ballot({ changed: true, picks: [], secret: true })] })[0]!)).toBe('Wario withdrew his ballot in the poll “Best part?” on #12 in Best kart? (secret ballot).');
  });
  test('a pick the poll no longer lists is said by its number, never dropped', () => {
    expect(said(rowsOf({ ballots: [ballot({ picks: [7] })] })[0]!)).toContain('for option 8 in the poll');
  });
  test('an admin closing a poll of the player\'s says so, and names the character', () => {
    const [r] = rowsOf({ pollCloses: [{ act: 'k1', poll: 'pl', character: 'b', at, question: 'Best part?', place }] });
    expect(r).toMatchObject({ kind: 'pollClose', at, aura: 0, wallet: null, characters: ['b'] });
    expect(said(r!)).toBe('An admin closed Wario\'s poll “Best part?”.');
  });
  test('a line is in its character\'s tab and in All, and a character that is not the player\'s has none', () => {
    const log = { ballots: [ballot(), ballot({ act: 'a2', character: 'c' }), ballot({ act: 'a3', character: 'zz' })] };
    expect(rowsOf(log, 'b').map((r) => r.key)).toEqual(['ballot:a1']);
    expect(rowsOf(log, null).map((r) => r.key).sort()).toEqual(['ballot:a1', 'ballot:a2']);
  });
  test('a line names no one else, whatever the options hold', () => {
    const [r] = rowsOf({ ballots: [ballot()], pollCloses: [{ act: 'k1', poll: 'pl', character: 'b', at, question: 'Best part?', place }] });
    expect(JSON.stringify(r)).not.toMatch(/voter|reacted/u);
  });
});

describe('merging pages with poll lines', () => {
  const place = { thread: 't', title: 'T', seq: 1 };
  const b = (act: string) => ({ act, poll: 'p', character: 'c', picks: [0], at: '2026-11-20T12:00:00.000Z', question: 'Q', secret: false, options: ['A', 'B'], changed: false, place });
  const k = (act: string) => ({ act, poll: 'p', character: 'c', at: '2026-11-20T12:00:00.000Z', question: 'Q', place });
  test('ballots and closes of both pages are kept, newer first', () => {
    const merged = mergeLogs({ ...empty, ballots: [b('b1')], pollCloses: [k('k1')] }, { ...empty, ballots: [b('b2')], pollCloses: [k('k2')] });
    expect(merged.ballots?.map((x) => x.act)).toEqual(['b1', 'b2']);
    expect(merged.pollCloses?.map((x) => x.act)).toEqual(['k1', 'k2']);
  });
  test('where only one page has them they survive, and where neither does they stay absent', () => {
    expect(mergeLogs({ ...empty, ballots: [b('b1')] }, { ...empty }).ballots?.map((x) => x.act)).toEqual(['b1']);
    expect(mergeLogs({ ...empty }, { ...empty, pollCloses: [k('k2')] }).pollCloses?.map((x) => x.act)).toEqual(['k2']);
    expect(mergeLogs({ ...empty }, { ...empty }).ballots).toBeUndefined();
  });
});

/**
 * Cards that left the game (the card retirement design, section 4): the player's own log says, plainly and truly, what a seed did to their copies, once per seed per kind; a play from before the seed still
 * names the card it was; an opened pack's refund is a line of its opening.
 */
describe('cards that left the game', () => {
  const at = '2026-11-20T10:00:00.000Z';
  const base = testInstance.cards[0]!;
  const collector = { ...base, key: 'collector', name: 'Card Collector', formerly: [{ key: 'trap-card', name: 'Trap Card' }] };
  const w: Words = { ...words, instance: { ...testInstance, cards: [...testInstance.cards, collector], withdrawn: [{ key: 'bluff', name: 'Bluff', refund: 100 }] } };
  const text = (r: { what: string; details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');
  const ev = (card: string, kind: 'renamedOut' | 'renamedIn' | 'withdrawn' | 'pulled', over: Record<string, unknown> = {}) => ({ card, kind, act: null, price: 0, at, ...over }) as Log['cards'][number];
  const rowsOf = (cards: Log['cards'], wallet: WalletEvent[] = []) => logRows(data({ log: { ...empty, cards, wallet }, mine: [char('c', 'Spritey', 'heel')] }), w, 600, null);
  const refunded = (n: number): WalletEvent => ({ settlement: null, kind: 'withdrawal', change: n * 100, overflow: 0, floored: 0, balanceAfter: 500 + n * 100, ref: null, at });

  test('a withdrawn card is one line for all the copies, with the refund', () => {
    const [two, ...rest] = rowsOf([ev('bluff', 'withdrawn', { price: 100 }), ev('bluff', 'withdrawn', { price: 100 })], [refunded(2)]);
    expect(rest).toEqual([]);
    expect(two!.what).toBe('Bluff was withdrawn from the game');
    expect(text(two!)).toBe('Your 2 copies were refunded 2.00 orbs.');
    expect(two!.aura).toBe(200);
    const [one] = rowsOf([ev('bluff', 'withdrawn', { price: 100 })], [refunded(1)]);
    expect(text(one!)).toBe('Your copy was refunded 1.00 orb.');
  });

  test('a renamed card is one line for all the copies, naming the new card', () => {
    const [two, ...rest] = rowsOf([ev('trap-card', 'renamedOut'), ev('trap-card', 'renamedOut'), ev('collector', 'renamedIn'), ev('collector', 'renamedIn')]);
    expect(rest).toEqual([]);
    expect(two!.what).toBe('Trap Card is now Card Collector');
    expect(text(two!)).toBe('Your 2 copies are Card Collectors now.');
    const [one] = rowsOf([ev('trap-card', 'renamedOut'), ev('collector', 'renamedIn')]);
    expect(text(one!)).toBe('Your copy is a Card Collector now.');
  });

  test('a seed at another time is another line, and a back moved by a seed counts with the held copies', () => {
    const later = '2026-11-21T10:00:00.000Z';
    const rows = rowsOf([ev('trap-card', 'renamedOut'), ev('trap-card', 'renamedOut', { act: 'set1' }), ev('trap-card', 'renamedOut', { at: later }), ev('collector', 'renamedIn')]);
    expect(rows.map(text).sort()).toEqual(['Your 2 copies are Card Collectors now.', 'Your copy is a Card Collector now.']);
  });

  test('a card withdrawn out of a pack is a line of the pack\'s opening, one card or several', () => {
    const pack = (n: number) => rowsOf([ev('bluff', 'withdrawn', { pack: 'p1', price: 100, packKind: 'starter', packSource: 'welcome' }), ...(n > 1 ? [ev('bluff', 'withdrawn', { pack: 'p1', price: 100 })] : [])]);
    expect(text(pack(1).find((r) => r.kind === 'pack')!)).toBe('Bluff. 1 card in it was withdrawn and refunded 1.00 orb.');
    expect(text(pack(2).find((r) => r.kind === 'pack')!)).toContain('2 cards in it were withdrawn and refunded 2.00 orbs.');
    expect(pack(1).filter((r) => r.kind === 'retired')).toEqual([]);
  });

  test('a cap that held back part of the refunds is said, on a seed\'s withdrawal and on a pack opening', () => {
    const capped = { ...refunded(2), change: 150, overflow: 50 };
    const [line] = rowsOf([ev('bluff', 'withdrawn', { price: 100 }), ev('bluff', 'withdrawn', { price: 100 })], [capped]);
    expect(text(line!)).toBe("Your 2 copies were refunded 2.00 orbs. The wallet's cap held back 0.50 orbs of the refunds paid with it.");
    const opening = rowsOf([ev('bluff', 'withdrawn', { pack: 'p1', price: 100, packKind: 'starter', packSource: 'welcome' })], [{ ...refunded(1), change: 50, overflow: 50 }]).find((r) => r.kind === 'pack')!;
    expect(text(opening)).toBe("Bluff. 1 card in it was withdrawn and refunded 1.00 orb. The wallet's cap held back 0.50 orbs of the refunds paid with it.");
  });

  test('two cards taking copies at one seed with no formerly to say which is not guessed', () => {
    const two: Words = { ...words, instance: { ...testInstance, cards: [...testInstance.cards, { ...base, key: 'c1', name: 'One' }, { ...base, key: 'c2', name: 'Two' }], withdrawn: [] } };
    const [line] = logRows(data({ log: { ...empty, cards: [ev('trap-card', 'renamedOut'), ev('c1', 'renamedIn'), ev('c2', 'renamedIn')] }, mine: [char('c', 'Spritey', 'heel')] }), two, 600, null);
    expect(line!.what).toBe('a card is now another card');
  });

  test('a bought pack with a withdrawn card nets its price against the refund', () => {
    const cards = [ev('bluff', 'withdrawn', { pack: 'p1', price: 100, packKind: 'booster', packSource: 'bought' }), ev('collector', 'pulled', { pack: 'p1', packKind: 'booster', packSource: 'bought' })];
    const packs = [{ pack: 'p1', kind: 'booster', price: 300, repriced: false, contents: ['collector', 'bluff'], at, source: 'bought' as const, openedAt: at }];
    const [row] = logRows(data({ log: { ...empty, cards, packs, wallet: [{ settlement: null, kind: 'purchase', change: -300, overflow: 0, floored: 0, balanceAfter: 200, ref: null, at }, refunded(1)] }, mine: [char('c', 'Spritey', 'heel')] }), w, 600, null).filter((r) => r.kind === 'pack');
    expect(row!.aura).toBe(-200);
  });

  test('a renamed card\'s new name is found from the renamedIn row when no card lists the old key as formerly', () => {
    const lone: Words = { ...words, instance: { ...testInstance, cards: [...testInstance.cards, { ...base, key: 'collector', name: 'Card Collector' }], withdrawn: [] } };
    const [line] = logRows(data({ log: { ...empty, cards: [ev('trap-card', 'renamedOut'), ev('collector', 'renamedIn')] }, mine: [char('c', 'Spritey', 'heel')] }), lone, 600, null);
    expect(line!.what).toBe('a card is now Card Collector');
    expect(text(line!)).toBe('Your copy is a Card Collector now.');
  });

  test('a card an Event found, later withdrawn or renamed, is named by its old name', () => {
    const found = (item: string) => logRows(data({ log: { ...empty, cosmetics: [{ id: 'e1', character: 'p', at, kind: 'found', outcome: 'card', item } as unknown as Log['cosmetics'][number]] }, mine: [char('p', 'Pipewrench', 'heel')] }), w, 600, null).find((r) => r.kind === 'found')!;
    expect(text(found('bluff'))).toBe('Something happened to Pipewrench: you found a Bluff.');
    expect(text(found('trap-card'))).toBe('Something happened to Pipewrench: you found a Trap Card.');
  });

  test('a play from before the seed names the card by its old name, never "a card"', () => {
    for (const [key, old] of [['bluff', 'Bluff'], ['trap-card', 'Trap Card']] as const) {
      const rows = rowsOf([{ card: key, kind: 'played' as const, act: 'k1', price: 0, at }]);
      expect(rows.find((r) => r.kind === 'played')!.what).toBe(`You played ${old}`);
    }
  });
});

describe('lockoutEnd', () => {
  const base = { character: 'c', thread: 't', seq: null, payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null } as const;
  test('sees a card_end added to the same Map after an earlier call', () => {
    const spring: Act = { ...base, id: 'sp', kind: 'spring', targetActId: 'p', createdAt: '2026-11-01T10:00:00.000Z', payload: { did: 'lockedOut', until: '2026-11-02T10:00:00.000Z' } };
    const acts = new Map<string, Act>([[spring.id, spring]]);
    expect(lockoutEnd(spring, acts).ended).toBeNull();
    acts.set('en', { ...base, id: 'en', kind: 'card_end', targetActId: 'sp', createdAt: '2026-11-01T12:30:00.000Z' });
    expect(lockoutEnd(spring, acts).ended).toBe('Nov 1 · 12:30 UTC');
  });
});

/* A cutting card's lines (docs/plans/2026-11-21-buzzkill-design.md, section 3.5): the Act's public `cut` alone says what it ended. */
describe('a cutting card in the Gimmick\'s player\'s and the cutter\'s logs', () => {
  const w: Words = {
    ...words,
    instance: { ...testInstance, cards: [...testInstance.cards,
      { ...testInstance.cards[0]!, key: 'gm', name: 'Some Card', play: 'use' as const, gimmick: { kind: 'ward' as const, upTo: 'uncommon' as const }, lasts: { unit: 'day' as const, count: 7 } },
      { ...testInstance.cards[0]!, key: 'bk', name: 'Cutter' }] },
  };
  const act = (id: string, kind: Act['kind'], character: string | null, over: Partial<Act> = {}): Act =>
    ({ id, kind, character, thread: 'th', targetActId: null, seq: null, createdAt: '2026-10-30T10:00:00.000Z', payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over });
  const text = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');
  const gimmickAt = '2026-10-24T10:00:00.000Z';
  const cutAt = '2026-10-27T09:30:00.000Z';
  const post = act('post3', 'post', 'p', { seq: 3 });
  const gimmick = (ends: string) => act('g1', 'card', 'p', { targetActId: 'post3', createdAt: gimmickAt, payload: { card: 'gm', ends } });
  const cutter = act('c1', 'card', 'q', { targetActId: 'post3', createdAt: cutAt, payload: { card: 'bk', cut: { play: 'g1', card: 'gm' } } });
  const plain = act('c2', 'card', 'q', { targetActId: 'post3', createdAt: cutAt, payload: { card: 'bk' } });
  const pm = (play: string, at: string) => ({ play, post: 'post3', at, reach: 'post' as const, targetName: null, targetCharacter: 'p' });
  const row = (rows: readonly { kind: string }[], kind: string) => rows.find((r) => r.kind === kind) as ReturnType<typeof logRows>[number];

  test('the cutter\'s played row says it ended the Gimmick there; no cut leaves it as it was', () => {
    const run = (c: Act) => logRows(data({ log: { ...empty, cards: [{ card: 'bk', kind: 'played' as const, act: c.id, price: 0, at: cutAt }] }, mine: [char('q', 'Quill', 'face')], acts: new Map([post, gimmick('2026-10-31T10:00:00.000Z'), c].map((a) => [a.id, a])) }), w, 600, null);
    expect(text(row(run(cutter), 'played'))).toContain(' It ended the Some Card there.');
    expect(text(row(run(plain), 'played'))).not.toMatch(/It ended/u);
  });

  test('the Gimmick\'s player\'s on-mine row says it ended their card early, at the cut\'s time; no cut leaves it as it was', () => {
    const run = (c: Act) => logRows(data({ log: { ...empty, playsOnMine: [pm(c.id, cutAt)] }, mine: [char('p', 'Pipewrench', 'heel')], acts: new Map([post, c].map((a) => [a.id, a])) }), w, 600, null);
    expect(text(row(run(cutter), 'onMine'))).toBe('Someone played Cutter on your post #3. It ended your Some Card early, at Oct 27 · 09:30 UTC.');
    expect(text(row(run(plain), 'onMine'))).toBe('Someone played Cutter on your post #3.');
  });

  describe('the Gimmick\'s own ended row', () => {
    const run = (acts: Act[], ended: Log['ended'] = [], ends = '2026-10-31T10:00:00.000Z') =>
      logRows(data({ log: { ...empty, ended, cards: [{ card: 'gm', kind: 'played' as const, act: 'g1', price: 0, at: gimmickAt }] }, mine: [char('p', 'Pipewrench', 'heel')], acts: new Map([post, gimmick(ends), ...acts].map((a) => [a.id, a])) }), w, 600, null);
    const reversal = { cardEnd: 'e1', play: 'c1', card: 'bk', at: '2026-10-28T10:00:00.000Z', side: 'cast' as const, reach: 'post' as const, targetName: null, postAuthorName: null, casterName: 'Quill', character: 'q' };

    test('a cut play ended at the cut, by the cutting card, even where its own end is still ahead', () => {
      for (const ends of ['2026-10-31T10:00:00.000Z', '2026-12-15T10:00:00.000Z']) {
        const ended = row(run([cutter], [], ends), 'gimmickEnded');
        expect([ended.at, text(ended)]).toEqual([cutAt, 'Some Card on your post #3. A Cutter ended it early.']);
      }
    });

    test('a cut that an admin reversed leaves the row as it was', () => {
      const ended = row(run([cutter], [reversal]), 'gimmickEnded');
      expect([ended.at, text(ended)]).toEqual(['2026-10-31T10:00:00.000Z', 'Some Card on your post #3 ended.']);
    });

    test('a play with no cut leaves the row as it was', () => {
      const ended = row(run([plain]), 'gimmickEnded');
      expect([ended.at, text(ended)]).toEqual(['2026-10-31T10:00:00.000Z', 'Some Card on your post #3 ended.']);
      expect(run([plain], [], '2026-12-15T10:00:00.000Z').some((r) => r.kind === 'gimmickEnded')).toBe(false);
    });
  });

  describe('the ended row of a cutting play, for the Gimmick\'s player', () => {
    const entry = (side: 'onMine' | 'cast', play = 'c1') => ({ cardEnd: 'e1', play, card: 'bk', at: '2026-10-28T10:00:00.000Z', side, reach: 'post' as const, targetName: null, postAuthorName: 'Pipewrench', casterName: 'Quill', character: side === 'onMine' ? 'p' : 'q' });
    const run = (side: 'onMine' | 'cast', c: Act, ends: string) => logRows(data({ log: { ...empty, ended: [entry(side, c.id)] }, mine: [char(side === 'onMine' ? 'p' : 'q', 'Mine', 'heel')], acts: new Map([post, gimmick(ends), c].map((a) => [a.id, a])) }), w, 600, null);

    test('says the Gimmick is back up until its end, or that it came back and has since ended', () => {
      expect(text(row(run('onMine', cutter, '2026-12-15T10:00:00.000Z'), 'ended'))).toBe('An admin ended Quill\'s Cutter on your post #3. Your Some Card is back up until Dec 15 · 10:00 UTC.');
      expect(text(row(run('onMine', cutter, '2026-10-31T10:00:00.000Z'), 'ended'))).toBe('An admin ended Quill\'s Cutter on your post #3. Your Some Card came back and has since ended.');
    });

    test('adds nothing for the cutter\'s own row, or for a play with no cut', () => {
      expect(text(row(run('cast', cutter, '2026-12-15T10:00:00.000Z'), 'ended'))).not.toMatch(/back up|came back/u);
      expect(text(row(run('onMine', plain, '2026-12-15T10:00:00.000Z'), 'ended'))).toBe('An admin ended Quill\'s Cutter on your post #3.');
    });
  });

  test('around reads the cutting Acts of the page\'s own plays, once, and the row says it ended at the cut', async () => {
    const asked: (readonly string[])[] = [];
    const api = {
      actsById: async () => [], effectStates: async () => ({}), characters: async () => [], thread: async () => null, board: async () => null,
      actsCutting: async (plays: readonly string[]) => { asked.push(plays); return [cutter]; },
    } as unknown as KayfaApi;
    const log = { ...empty, cards: [{ card: 'gm', kind: 'played' as const, act: 'g1', price: 0, at: gimmickAt }] };
    const own = data({ log: empty, mine: [char('p', 'Pipewrench', 'heel')], acts: new Map([post, gimmick('2026-10-31T10:00:00.000Z')].map((a) => [a.id, a])) });
    const read = await around(api, log, own);
    expect(asked).toEqual([['g1']]);
    const ended = row(logRows(read, w, 600, null), 'gimmickEnded');
    expect([ended.at, text(ended)]).toEqual([cutAt, 'Some Card on your post #3. A Cutter ended it early.']);
  });

  test('a later page asks for the cutting Acts of its own plays only, and a failed read fails the page', async () => {
    const asked: (readonly string[])[] = [];
    let fail = false;
    const api = {
      actsById: async () => [], effectStates: async () => ({}), characters: async () => [], thread: async () => null, board: async () => null,
      actsCutting: async (plays: readonly string[]) => { asked.push(plays); if (fail) throw new Error('down'); return []; },
    } as unknown as KayfaApi;
    const played = (act: string) => ({ card: 'gm', kind: 'played' as const, act, price: 0, at: gimmickAt });
    const held = { ...empty, cards: [played('g1')] };
    const own = data({ log: held, mine: [char('p', 'Pipewrench', 'heel')], acts: new Map([post, gimmick('2026-10-31T10:00:00.000Z')].map((a) => [a.id, a])) });
    await around(api, { ...empty, cards: [played('g1'), played('g2')] }, own);
    expect(asked).toEqual([['g2']]);
    await around(api, held, own);
    expect(asked).toEqual([['g2']]);
    fail = true;
    await expect(around(api, { ...empty, cards: [played('g1'), played('g3')] }, own)).rejects.toThrow('down');
  });

  test('a later page asks for the play a cut it reads names, so an ended cutter\'s row knows whether another still holds it', async () => {
    const asked: (readonly string[])[] = [];
    const reversed = act('c9', 'card', 'r', { targetActId: 'post3', createdAt: '2026-10-28T09:30:00.000Z', payload: { card: 'bk', cut: { play: 'g9', card: 'gm' } } });
    const api = {
      actsById: async (ids: readonly string[]) => (ids.includes('c9') ? [reversed] : []), effectStates: async () => ({}), characters: async () => [], thread: async () => null, board: async () => null,
      actsCutting: async (plays: readonly string[]) => { asked.push(plays); return []; },
    } as unknown as KayfaApi;
    const ended = [{ cardEnd: 'e-c9', play: 'c9', card: 'bk', at: '2026-10-29T10:00:00.000Z', side: 'onMine' as const, reach: 'post' as const, targetName: null, postAuthorName: 'Pipewrench', casterName: 'Quill', character: 'p' }];
    await around(api, { ...empty, ended }, data({ mine: [char('p', 'Pipewrench', 'heel')] }));
    expect(asked).toEqual([['g9']]);
  });

  describe('the back-up line of an ended cutting play', () => {
    const second = act('c3', 'card', 'r', { targetActId: 'post3', createdAt: '2026-10-28T09:30:00.000Z', payload: { card: 'bk', cut: { play: 'g1', card: 'gm' } } });
    const entry = (play: string) => ({ cardEnd: `e-${play}`, play, card: 'bk', at: '2026-10-29T10:00:00.000Z', side: 'onMine' as const, reach: 'post' as const, targetName: null, postAuthorName: 'Pipewrench', casterName: 'Quill', character: 'p' });
    const run = (acts: Act[], ended: Log['ended']) => text(row(logRows(data({ log: { ...empty, ended }, mine: [char('p', 'Pipewrench', 'heel')], acts: new Map([post, gimmick('2026-12-15T10:00:00.000Z'), cutter, ...acts].map((a) => [a.id, a])) }), w, 600, null), 'ended'));
    test('says nothing extra where another landed cutter still names the play', () => {
      expect(run([second], [entry('c1')])).toBe('An admin ended Quill\'s Cutter on your post #3.');
    });
    test('says nothing extra where an admin ended the Gimmick itself', () => {
      expect(run([], [entry('c1'), { ...entry('g1'), card: 'gm' }])).toBe('An admin ended Quill\'s Cutter on your post #3.');
    });
    test('says it where the other cutter was reversed too', () => {
      expect(run([second], [entry('c1'), entry('c3')])).toContain('Your Some Card is back up until Dec 15 · 10:00 UTC.');
    });
  });

  test('a cut play of a card that keeps still says the posts written while it was up keep it', () => {
    const keeps: Words = { ...w, instance: { ...w.instance, cards: w.instance.cards.map((c) => (c.key === 'gm' ? { ...c, keeps: true } : c)) } };
    const rows = logRows(data({ log: { ...empty, cards: [{ card: 'gm', kind: 'played' as const, act: 'g1', price: 0, at: gimmickAt }] }, mine: [char('p', 'Pipewrench', 'heel')], acts: new Map([post, gimmick('2026-10-31T10:00:00.000Z'), cutter].map((a) => [a.id, a])) }), keeps, 600, null);
    expect(text(row(rows, 'gimmickEnded'))).toBe('Some Card on your post #3. A Cutter ended it early. Posts written while it was up keep it.');
  });

  test('actsFollowed reaches the Gimmick a cutting Act names', () => {
    expect(actsFollowed(new Map([['c1', cutter]]))).toEqual(expect.arrayContaining(['g1', 'post3']));
  });
});
