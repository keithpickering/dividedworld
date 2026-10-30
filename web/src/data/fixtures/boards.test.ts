/**
 * The boards' fixture (web/src/data/fixtures/boards.ts): one season, seen at the moment each board
 * is drawn. Every case reads through the KayfaApi the screens use, never the fake's own state, and
 * a case that wants other data seeds its own fake: the fixture's moments are what the board match
 * compares, so nothing here edits them (MOMENTS is frozen, and a test of it says so).
 */
import { describe, expect, it } from 'vitest';
import { rankIndex } from '../../../../engine/rules/ranks.ts';
import { FAKE_BACKEND_MARKER, TEST_CODE, type Fake } from '../../../../engine/ui/data/fake.ts';
import { instance } from '../../../../instances/divided-world/index.ts';
import { hudKey } from '../../../../engine/ui/player.tsx';
import { createBoardsFake, EMAILS, MOMENTS, seedBoards, type MomentName } from './boards.ts';

const NAMES = Object.keys(MOMENTS) as MomentName[];
const iso = (d: number, h: number, m: number) => new Date(Date.UTC(2026, 9, d, h, m)).toISOString();

async function load(moment: MomentName) {
  const fake = createBoardsFake(moment);
  const route = seedBoards(fake, moment);
  const thread = /^\/t\/([^?#]+)/.exec(route)?.[1] ?? (await threadOf(fake));
  return { fake, route, thread };
}
/** The one thread of the season, read as any signed-in or signed-out visitor reads the board. */
async function threadOf(fake: Fake): Promise<string> {
  const general = (await fake.boards()).find((b) => b.slug === 'general')!;
  return (await fake.threads(general.id, { offset: 0, limit: 5 })).threads[0]?.id ?? '';
}
const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
};
async function mine(fake: Fake) {
  return (await fake.myCharacters()).map((c) => c.name).sort();
}
async function nameOf(fake: Fake, id: string | null) {
  return id === null ? null : (await fake.characters([id]))[0]?.name ?? null;
}
/** The thread's posts, in order, apart from the card plays that take their own numbers after them. */
async function postsOf(fake: Fake, thread: string) {
  const last = must(await fake.thread(thread)).lastSeq;
  return (await fake.acts(thread, 1, last)).filter((a) => a.kind === 'post');
}
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe('the moments', () => {
  it('names a moment for each board that has one, in the order the boards are numbered', () => {
    expect(NAMES).toEqual(['01-main', '02-phone', '03-react', '05-cards', '06-turn', '07-vending', '08-hold', '09-settlement', '10-roster', '11-settings', '12-log', '13-rankings']);
  });

  it('is frozen, so a test cannot move a board by editing a moment', () => {
    expect(Object.isFrozen(MOMENTS)).toBe(true);
    expect(() => { (MOMENTS as Record<string, unknown>)['01-main'] = null; }).toThrow();
  });

  const ROUTES: Record<MomentName, RegExp> = {
    '01-main': /^\/t\/[^?#]+\?page=3$/,
    '02-phone': /^\/t\/[^?#]+\?page=3$/,
    '03-react': /^\/t\/[^?#]+\?page=3#post-42$/,
    '05-cards': /^\/t\/[^?#]+\?page=3#post-46$/,
    '06-turn': /^\/characters$/,
    '07-vending': /^\/vending$/,
    '08-hold': /^\/t\/[^?#]+\?page=3#post-44$/,
    '09-settlement': /^\/log\/settlement$/,
    '10-roster': /^\/characters$/,
    '11-settings': /^\/settings$/,
    '12-log': /^\/log$/,
    '13-rankings': /^\/rankings$/,
  };
  const WHO: Record<MomentName, readonly string[]> = {
    '01-main': ['Mrs. Hooligan', 'Pipewrench', 'Spritey'],
    '02-phone': ['Mrs. Hooligan', 'Pipewrench', 'Spritey'],
    '03-react': ['Gloomba'],
    '05-cards': ['Mrs. Hooligan', 'Pipewrench', 'Spritey'],
    '06-turn': ['Mrs. Hooligan', 'Pipewrench', 'Spritey'],
    '07-vending': ['Mrs. Hooligan', 'Pipewrench', 'Spritey'],
    '08-hold': ['Thwompson'],
    '09-settlement': ['Mrs. Hooligan', 'Pipewrench', 'Spritey'],
    '10-roster': ['Mrs. Hooligan', 'Pipewrench', 'Spritey'],
    '11-settings': ['Mrs. Hooligan', 'Pipewrench', 'Spritey'],
    '12-log': ['Mrs. Hooligan', 'Pipewrench', 'Spritey'],
    '13-rankings': ['Mrs. Hooligan', 'Pipewrench', 'Spritey'],
  };

  it.each(NAMES)('%s loads: the route is the board\'s, the moment\'s account is signed in, and the clock is the moment\'s', async (moment) => {
    const { fake, route } = await load(moment);
    expect(route).toMatch(ROUTES[moment]);
    expect(fake.clock.now()).toBe(MOMENTS[moment].at);
    expect((await fake.session()).signedIn).toBe(true);
    expect(await mine(fake)).toEqual([...WHO[moment]].sort());
  });

  it.each(NAMES.filter((n) => MOMENTS[n].account === 'player'))('%s: this device has the HUD on Pipewrench, as the boards draw it (the device\'s own choice, never the server\'s)', async (moment) => {
    globalThis.localStorage.clear();
    const { fake } = await load(moment);
    const account = must((await fake.session()).account);
    expect(await nameOf(fake, globalThis.localStorage.getItem(hudKey(account)))).toBe('Pipewrench');
  });

  it('refuses a fake whose clock is not the moment\'s, since the moment is what its Acts are dated against', () => {
    const fake = createBoardsFake('01-main');
    expect(() => seedBoards(fake, '12-log')).toThrow(/clock/);
  });

  it('refuses a moment it does not have, and lists the ones it has', () => {
    const fake = createBoardsFake('01-main');
    expect(() => seedBoards(fake, 'nope' as MomentName)).toThrow(new RegExp(`nope.*${NAMES.join('.*')}`));
  });
});

/* Pipewrench's timeline, the Log board's set (glass plan, section 2.1). */
describe('Pipewrench through the season', () => {
  const AT: Record<string, { wallet: number; pending: number; hand: number; rank: string; class: string; turning: boolean }> = {
    '07-vending': { wallet: 562, pending: 30, hand: 2, rank: 'Enhancement Talent', class: 'heel', turning: false },
    '01-main': { wallet: 462, pending: 30, hand: 3, rank: 'Enhancement Talent', class: 'heel', turning: false },
    '02-phone': { wallet: 462, pending: 30, hand: 3, rank: 'Enhancement Talent', class: 'heel', turning: false },
    '05-cards': { wallet: 462, pending: 30, hand: 3, rank: 'Enhancement Talent', class: 'heel', turning: false },
    '06-turn': { wallet: 337, pending: 35, hand: 2, rank: 'Enhancement Talent', class: 'heel', turning: true },
    '09-settlement': { wallet: 372, pending: 0, hand: 2, rank: 'Midcarder', class: 'face', turning: false },
    '10-roster': { wallet: 372, pending: 0, hand: 2, rank: 'Midcarder', class: 'face', turning: false },
    '11-settings': { wallet: 372, pending: 0, hand: 2, rank: 'Midcarder', class: 'face', turning: false },
    '12-log': { wallet: 372, pending: 0, hand: 2, rank: 'Midcarder', class: 'face', turning: false },
    '13-rankings': { wallet: 372, pending: 0, hand: 2, rank: 'Midcarder', class: 'face', turning: false },
  };

  it.each(Object.entries(AT))('at %s: wallet, what is pending, the hand, the rank and the Turn are the timeline\'s', async (moment, want) => {
    const { fake } = await load(moment as MomentName);
    expect(await fake.wallet()).toEqual({ balance: want.wallet, cap: 600 });
    expect(sum((await fake.estimate()).entries.map((e) => e.amount))).toBe(want.pending);
    expect(sum((await fake.myCards()).map((c) => c.held))).toBe(want.hand);
    const me = must((await fake.myCharacters()).find((c) => c.name === 'Pipewrench'));
    const standing = must((await fake.standingAmounts([me.id]))[me.id]);
    expect(instance.ranks[rankIndex(instance.ranks, standing)]!.name).toBe(want.rank);
    expect(me.class).toBe(want.class);
    expect(me.pendingTurn !== null).toBe(want.turning);
  });

  it('chooses its Turn to Face, announced with its old class, and says when it takes effect', async () => {
    const { fake } = await load('06-turn');
    const me = must((await fake.myCharacters()).find((c) => c.name === 'Pipewrench'));
    expect(me.pendingTurn).toEqual({ class: 'face', loudness: 'announced', showFrom: true, showTo: false, takesEffectAt: iso(30, 8, 17) });
  });

  it('is on cooldown after the settlement until the month ends, and the Turn is announced with its old class', async () => {
    const { fake } = await load('10-roster');
    const me = must((await fake.myCharacters()).find((c) => c.name === 'Pipewrench'));
    expect(me.classSince).toBe(iso(30, 8, 17));
    expect(me.turnOpensAt).toBe(iso(30, 8, 17).replace('2026-10-30', '2026-11-29'));
    const turned = await fake.turnsAnnounced([me.id]);
    expect(turned).toEqual([expect.objectContaining({ character: me.id, was: 'heel', at: iso(30, 8, 17) })]);
  });

  it('shows the estimate of the 21:52 play as the settlement scored it: drew heat, stole thunder, a polite shrug', async () => {
    const { fake } = await load('06-turn');
    expect((await fake.estimate()).entries.map((e) => [e.reason, e.amount])).toEqual([['heel.drewHeat', 20], ['heel.stoleThunder', 20], ['heel.shrugged', -5]]);
  });
});

describe('the thread', () => {
  it('holds posts #41 to #46 on page 3, by the characters and at the times section 2.1 lists, with #1 to #40 before them', async () => {
    const { fake, thread } = await load('01-main');
    expect(must(await fake.thread(thread)).title).toBe('who keeps splatting my posts');
    const perPage = (await fake.settings()).postsPerPage;
    const acts = await postsOf(fake, thread);
    expect(acts.map((a) => a.seq)).toEqual(Array.from({ length: 46 }, (_, i) => i + 1));
    expect(Math.ceil(acts.length / perPage)).toBe(3);
    const page3 = acts.filter((a) => a.seq! > 2 * perPage);
    expect(page3.map((a) => a.seq)).toEqual([41, 42, 43, 44, 45, 46]);
    const authors = await Promise.all(page3.map((a) => nameOf(fake, a.character)));
    expect(authors).toEqual(['Spritey', 'Mrs. Hooligan', 'Pipewrench', 'Spritey', 'Gloomba', 'Gloomba']);
    expect(page3.slice(0, 4).map((a) => a.createdAt)).toEqual([iso(29, 21, 14), iso(29, 21, 20), iso(29, 21, 31), iso(29, 21, 40)]);
    expect([...String(page3[5]!.payload.body)]).toHaveLength(812);
    expect(Math.max(...acts.slice(0, 40).map((a) => Date.parse(a.createdAt)))).toBeLessThan(Date.parse(iso(29, 21, 14)));
  });

  it.each([['07-vending', 40], ['03-react', 42], ['08-hold', 44], ['01-main', 46]] as const)('at %s only what has happened has: the last post is #%i', async (moment, last) => {
    const { fake, thread } = await load(moment);
    const posts = await postsOf(fake, thread);
    expect(posts.map((a) => a.seq)).toEqual(Array.from({ length: last }, (_, i) => i + 1));
  });

  it('writes the card plays after the moment\'s posts, dated as they happened, so a post keeps its number whenever the moment is', async () => {
    const { fake, thread } = await load('06-turn');
    const all = await fake.acts(thread, 1, must(await fake.thread(thread)).lastSeq);
    expect(all.slice(0, 46).every((a) => a.kind === 'post')).toBe(true);
    expect(all.slice(46).map((a) => [a.seq, a.kind, a.createdAt])).toEqual([[47, 'card', iso(29, 21, 16)], [48, 'card', iso(29, 21, 41)], [49, 'card', iso(29, 21, 52)]]);
  });

  it('puts the cards on the posts the boards show: Whoops! on #41 by Mrs. Hooligan, Stick Around on #44 by Gloomba, and Pipewrench\'s Whoops! on #46 only from 21:52', async () => {
    const { fake, thread } = await load('01-main');
    const [p41, p44, p46] = (await postsOf(fake, thread)).filter((a) => [41, 44, 46].includes(a.seq!));
    const play = async (post: string) => (await fake.cardsOn(post, 10)).map((a) => ({ card: a.payload.card, message: a.payload.message }));
    expect(await play(p41!.id)).toEqual([{ card: 'whoops', message: 'you dropped your ink' }]);
    expect(await Promise.all((await fake.cardsOn(p41!.id, 10)).map((a) => nameOf(fake, a.character)))).toEqual(['Mrs. Hooligan']);
    expect(await play(p44!.id)).toEqual([{ card: 'stick-around', message: 'required reading' }]);
    expect(await Promise.all((await fake.cardsOn(p44!.id, 10)).map((a) => nameOf(fake, a.character)))).toEqual(['Gloomba']);
    expect(await play(p46!.id)).toEqual([]);
    const later = await load('06-turn');
    const on46 = (await postsOf(later.fake, later.thread))[45]!;
    const plays = await later.fake.cardsOn(on46.id, 10);
    expect(plays.map((a) => [a.payload.card, a.payload.message, a.createdAt])).toEqual([['whoops', 'you dropped your ink', iso(29, 21, 52)]]);
    expect(await nameOf(later.fake, plays[0]!.character)).toBe('Pipewrench');
  });

  it('has the Main board\'s chips on #41 and #42, with the rival\'s Tea among #42\'s, and #43\'s four from 22:04', async () => {
    const { fake, thread } = await load('01-main');
    const posts = (await postsOf(fake, thread)).slice(40, 43);
    const tallies = await fake.tallies(posts.map((a) => a.id));
    expect(tallies[posts[0]!.id]).toEqual({ fire: 4, 'eye-roll': 2, tea: 1 });
    expect(tallies[posts[1]!.id]).toEqual({ angry: 3, tomato: 2, handshake: 1, tea: 1 });
    expect(tallies[posts[2]!.id]).toEqual({});
    const later = await load('06-turn');
    const third = (await postsOf(later.fake, later.thread))[42]!;
    expect(sum(Object.values((await later.fake.tallies([third.id]))[third.id]!))).toBe(4);
  });

  it('gives the player no reaction of their own anywhere on it: their characters\' posts are not reacted to by them', async () => {
    const { fake, thread } = await load('01-main');
    const ids = (await postsOf(fake, thread)).map((a) => a.id);
    expect(await fake.myReactions(ids)).toEqual([]);
  });
});

describe('the rival', () => {
  it('has the Tea on Mrs. Hooligan\'s #42 as its own row, and only that one', async () => {
    const { fake, thread } = await load('03-react');
    const post42 = (await postsOf(fake, thread))[41]!;
    const reactions = await fake.myReactions((await postsOf(fake, thread)).map((a) => a.id));
    expect(reactions).toHaveLength(1);
    expect(reactions[0]).toMatchObject({ act: post42.id, kind: 'tea' });
    expect(await nameOf(fake, reactions[0]!.character)).toBe('Gloomba');
  });

  it('is the same Tea at the Main moment, seen from the rival\'s own sign-in, and the player does not own it', async () => {
    const { fake, thread } = await load('01-main');
    const post42 = (await postsOf(fake, thread))[41]!;
    expect(await fake.myReactions([post42.id])).toEqual([]);
    expect(await fake.verifyCode(EMAILS.rival, TEST_CODE)).toMatchObject({ ok: true });
    expect(await fake.myReactions([post42.id])).toEqual([expect.objectContaining({ act: post42.id, kind: 'tea' })]);
  });
});

describe('the reader', () => {
  it('owns none of the Hold board\'s characters, only Thwompson, which no board shows', async () => {
    const { fake, thread } = await load('08-hold');
    expect(await mine(fake)).toEqual(['Thwompson']);
    const shown = new Set(await Promise.all((await postsOf(fake, thread)).slice(40).map((a) => nameOf(fake, a.character))));
    expect(shown).toEqual(new Set(['Spritey', 'Mrs. Hooligan', 'Pipewrench']));
    for (const name of [...shown, 'Gloomba']) expect(await mine(fake)).not.toContain(name);
    expect(await fake.myCharacters()).toHaveLength(1);
  });

  it('has Gloomba\'s Stick Around on #44 to be held by, at 21:41', async () => {
    const { fake, thread } = await load('08-hold');
    const p44 = (await postsOf(fake, thread))[43]!;
    expect((await fake.cardsOn(p44.id, 10)).map((a) => a.payload.card)).toEqual(['stick-around']);
  });
});

/* The Rankings board's season: every character in the standings' order, two of the others' classes said in public. */
describe('the rankings', () => {
  async function page(moment: MomentName) {
    const { fake } = await load(moment);
    const standings = await fake.standingsPage(0, 50);
    const ids = standings.map((s) => s.character);
    const named = async <T extends { character: string }>(rows: readonly T[]) => Promise.all(rows.map(async (r) => ({ ...r, name: await nameOf(fake, r.character) })));
    return { fake, standings, reveals: await named(await fake.classReveals(ids)), turns: await named(await fake.turnsAnnounced(ids)) };
  }

  it('at 13-rankings, ranks the season as the Oct 30 settlement left it, the crowd last', async () => {
    const { standings } = await page('13-rankings');
    expect(standings.map((s) => [s.place, s.name, s.standing])).toEqual([
      [1, 'Spritey', 650], [2, 'Mrs. Hooligan', 420], [3, 'Pipewrench', 330], [4, 'Gloomba', 180], [5, 'Thwompson', 40],
      [6, 'Ringside 1', 0], [6, 'Ringside 2', 0], [6, 'Ringside 3', 0], [6, 'Ringside 4', 0],
    ]);
  });

  it('at 13-rankings, Gloomba has said its class in public after the night\'s boards, and Thwompson long before, Turning, announced, since', async () => {
    const { reveals, turns } = await page('13-rankings');
    expect(reveals.map((r) => [r.name, r.class, r.at, r.via])).toEqual([
      ['Thwompson', 'lurker', iso(8, 9, 31), 'act'],
      ['Gloomba', 'heel', iso(30, 1, 13), 'act'],
    ]);
    expect(turns.map((t) => [t.name, t.at, t.was])).toEqual([['Pipewrench', iso(30, 8, 17), 'heel'], ['Thwompson', iso(30, 8, 17), null]]);
  });

  it('moves no other board: no reveal of Gloomba by the last thread moment, and Thwompson is still a Lurker on the Hold board', async () => {
    for (const moment of ['01-main', '02-phone', '03-react', '05-cards', '06-turn'] as const) {
      const { reveals } = await page(moment);
      expect(reveals.map((r) => r.name)).not.toContain('Gloomba');
    }
    const { fake } = await load('08-hold');
    expect((await fake.myCharacters()).map((c) => [c.name, c.class, c.pendingTurn])).toEqual([['Thwompson', 'lurker', null]]);
  });
});

describe('the marker', () => {
  it('is the fake\'s own constant: seeding adds none of its own', async () => {
    const { fake } = await load('01-main');
    expect(fake.marker).toBe(FAKE_BACKEND_MARKER);
    expect(Object.getOwnPropertyDescriptor(fake, FAKE_BACKEND_MARKER)).toBeUndefined();
  });
});

/* A fact about the engine today, pinned so a change to either side is seen (see the fixture's header). */
describe('card plays in the thread', () => {
  it('at 01-main page 3 holds the six posts and then the card Acts, at seqs above 46', async () => {
    const { fake, thread } = await load('01-main');
    const perPage = (await fake.settings()).postsPerPage;
    const page3 = await fake.acts(thread, 2 * perPage + 1, 3 * perPage);
    expect(page3.map((a) => [a.seq, a.kind])).toEqual([
      ...[41, 42, 43, 44, 45, 46].map((n) => [n, 'post']),
      [47, 'card'], [48, 'card'],
    ]);
  });
});
