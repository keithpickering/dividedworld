/**
 * The boards' season: one coherent forum, seeded onto the in-memory backend as it stood at the moment
 * each board in docs/research/2026-10-29-two-worlds/ is drawn (docs/plans/2026-10-30-glass-to-the-boards-plan.md,
 * section 2.1; section 3 lists every place it departs from a board, and why). The board match opens
 * the e2e build at `?fixture=boards&moment=<name>` and compares the screen to its board, so this is
 * the data a board is held to: a test that wants other data seeds its own fake and leaves these
 * moments as they are.
 *
 * It names Divided World's characters, classes and cards, so it is the composition root's, beside
 * demo.ts; the engine's own tests never import it. It seeds only through `fake.seed`.
 *
 * A moment is a clock time, an account and a route. `seedBoards` seeds only what has happened by the
 * moment's time (a post, a purchase, a settlement dated after it is not there), signs in the moment's
 * account and returns the route. The fake must have been made for the moment (`createBoardsFake`),
 * because the clock is what its estimate, its cooldowns and "next settlement" are read against.
 *
 * Where the fixture is less than the real thing, it says so:
 *  - Posts and reactions need accounts to make them: four more players (Ringside 1 to 4) hold the
 *    crowd's reactions, which one player cannot (a player reacts once to a kind on a post).
 *  - A card play takes a number in its thread, as the server's does; the plays are written after the
 *    moment's posts so that #41 to #46 are the posts (see `plays` below), which the cards part reconciles.
 *  - The Whoops! on #41 is a card Act by Mrs. Hooligan with no spend in Pipewrench's wallet, which the
 *    timeline does not show (the player owns both); the plan seeds it that way.
 *  - Stick Around's release sentence is a card's effect state, not part of its Act; the cards part
 *    seeds it when it draws the Hold board.
 */
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { createFake } from '../../../../engine/ui/data/fake.ts';
import { instance } from '../../../../instances/divided-world/index.ts';
import { fallbackSettings } from '../settings.ts';

export type Account = 'player' | 'rival' | 'reader';

/** The three accounts' addresses, as `verifyCode` takes them (the fake accepts its test code for any known address). */
export const EMAILS: Readonly<Record<Account, string>> = Object.freeze({
  player: 'player@boards.test',
  rival: 'rival@boards.test',
  reader: 'reader@boards.test',
});

const utc = (day: number, hour: number, minute: number) => Date.UTC(2026, 9, day, hour, minute);
const thread = (id: string, post?: number) => `/t/${id}?page=3${post === undefined ? '' : `#post-${post}`}`;

/**
 * Each board that has a moment: its UTC clock time, its account and the route it opens on (the thread's
 * id is made when the fixture is seeded). Board 04 (the orbs) has none, being a story. The routes of the
 * Vending Machine, the settlement and the log are the ones those parts are planned to take; the screens
 * come with their parts.
 */
export interface Moment {
  readonly at: number;
  readonly account: Account;
  /** The address the board is drawn at, given the thread's id (the moments with no thread ignore it). */
  readonly route: (thread: string) => string;
}
const moment = (at: number, account: Account, route: (thread: string) => string): Moment => Object.freeze({ at, account, route });

export const MOMENTS = Object.freeze({
  '01-main': moment(utc(29, 21, 47), 'player', (id) => thread(id)),
  '02-phone': moment(utc(29, 21, 47), 'player', (id) => thread(id)),
  '03-react': moment(utc(29, 21, 30), 'rival', (id) => thread(id, 42)),
  '05-cards': moment(utc(29, 21, 51), 'player', (id) => thread(id, 46)),
  '06-turn': moment(utc(30, 0, 35), 'player', () => '/characters'),
  '07-vending': moment(utc(29, 20, 9), 'player', () => '/vending'),
  '08-hold': moment(utc(29, 21, 41), 'reader', (id) => thread(id, 44)),
  '09-settlement': moment(utc(30, 8, 20), 'player', () => '/log/settlement'),
  '10-roster': moment(utc(30, 8, 30), 'player', () => '/characters'),
  '11-settings': moment(utc(30, 8, 30), 'player', () => '/settings'),
  '12-log': moment(utc(30, 8, 30), 'player', () => '/log'),
});
export type MomentName = keyof typeof MOMENTS;

const NAMES = Object.keys(MOMENTS);

/** A fake whose clock is the moment's, for `seedBoards`. */
export function createBoardsFake(moment: MomentName): Fake {
  return createFake({ instance, settings: fallbackSettings, now: () => momentAt(moment) });
}

/** The moment a name or an address's parameter says, or an Error that lists the moments there are (a missing name included). */
export function assertMoment(name: string | null): MomentName {
  if (name === null || name === '') throw new Error(`The boards fixture needs a moment: add moment=<name> to the address. The moments are: ${NAMES.join(', ')}.`);
  if (!Object.hasOwn(MOMENTS, name)) throw new Error(`There is no moment named "${name}". The moments are: ${NAMES.join(', ')}.`);
  return name as MomentName;
}

const momentAt = (moment: string): number => MOMENTS[assertMoment(moment)].at;

/** The long post, #46: 812 characters, as the plan says. */
const LONG_POST = (() => {
  const line = 'I did not splat anything. I want that on the record before the record is the splat. ';
  const end = 'Check the card Acts if you do not believe me. They are public, and so is every one of you.';
  let body = '';
  while ([...body + line + end].length <= 812) body += line;
  return (body + end).padEnd(812, '.').slice(0, 812);
})();

const FILLER = [
  'Anyone else seeing this?',
  'I was here for the first one and I am still here.',
  'This thread is a lot.',
  'No notes. Well, one note. Fewer splats.',
  'Bumping so it does not sink under the Level Editor threads.',
  'Somebody check the Acts.',
  'I have a theory and it has a color.',
];

/** What has happened, as (when, what): the fixture applies the ones at or before the moment, in order. */
interface Step { readonly at: number; readonly run: () => void }

/**
 * Seed the season as of `moment` into `fake` (made with `createBoardsFake(moment)`), sign in the
 * moment's account and return the route to open. An unknown moment throws, naming the ones there are.
 */
export function seedBoards(fake: Fake, moment: MomentName): string {
  const now = momentAt(moment);
  if (fake.clock.now() !== now) throw new Error(`The fake's clock is not ${moment}'s: make it with createBoardsFake("${moment}").`);
  const { seed } = fake;

  /* ---- who: always here, the season began on Oct 1 ---- */
  seed.season({ number: 1, startsAt: new Date(utc(1, 0, 0)).toISOString() });
  const player = seed.account('player', { email: EMAILS.player });
  const rival = seed.account('rival', { email: EMAILS.rival });
  const reader = seed.account('reader', { email: EMAILS.reader });
  const crowd = [1, 2, 3, 4].map((n) => seed.account(`ringside-${n}`, { email: `ringside-${n}@boards.test` }));
  const pipewrench = seed.character(player, 'Pipewrench', 'heel', { at: utc(1, 12, 0) });
  const hooligan = seed.character(player, 'Mrs. Hooligan', 'face', { at: utc(2, 12, 0) });
  const spritey = seed.character(player, 'Spritey', 'jabroni', { at: utc(3, 12, 0) });
  const gloomba = seed.character(rival, 'Gloomba', 'heel', { at: utc(4, 12, 0) });
  const thwompson = seed.character(reader, 'Thwompson', 'lurker', { at: utc(5, 12, 0) });
  const fans = crowd.map((account, i) => seed.character(account, `Ringside ${i + 1}`, 'lurker', { at: utc(6, 12, i) }));
  const turns = seed.thread('the-system', null, 'Season 1: Who Turned', 'Every Turn, as it was announced.', { at: utc(1, 12, 0) });
  seed.season({ number: 1, turnsThread: turns.thread });

  /* ---- the thread: #1 to #40 as filler, then page 3 ---- */
  const opener = seed.thread('general', spritey, 'who keeps splatting my posts', 'Third thread this week and I am out of patience. Who keeps splatting my posts?', { at: utc(28, 12, 0) });
  const posts: Record<number, string> = { 1: opener.act };
  const mask = [hooligan, pipewrench, gloomba, spritey];
  for (let n = 2; n <= 40; n++) {
    posts[n] = seed.post(opener.thread, mask[n % mask.length]!, `${FILLER[n % FILLER.length]} (#${n})`, { at: utc(28, 12, 0) + (n - 1) * 20 * 60_000 });
  }

  const steps: Step[] = [];
  const when = (day: number, hour: number, minute: number, run: () => void) => steps.push({ at: utc(day, hour, minute), run });
  /*
   * A card play is an Act that takes a number in its thread, as the server's does, so one written
   * between two posts would move every post after it (the boards number #41 to #46 without a gap).
   * The plays are written after the moment's posts, dated as they happened: a post keeps its number
   * at every moment, and a card's own number is the thread's next.
   */
  const plays: Step[] = [];
  const play = (day: number, hour: number, minute: number, character: string, target: number, card: string, message: string) =>
    plays.push({ at: utc(day, hour, minute), run: () => { seed.card(character, posts[target]!, card, { message, at: utc(day, hour, minute) }); } });
  const post = (n: number, character: string, body: string, day: number, hour: number, minute: number, quote?: number) =>
    when(day, hour, minute, () => { posts[n] = seed.post(opener.thread, character, body, { at: utc(day, hour, minute), ...(quote === undefined ? {} : { quote: posts[quote]! }) }); });

  post(41, spritey, [
    'Third time this week. I wrote four whole paragraphs about the level editor update and somebody dumped a bucket of ink on it before anyone got past the first sentence.',
    'I\'m not mad. I\'m documenting. Whoever you are, I can see the color you picked, and I will remember it.',
    'Posting the full changelog again below in case it gets splatted a fourth time. Scroll down if you can still read.',
  ].join('\n\n'), 29, 21, 14);
  play(29, 21, 16, hooligan, 41, 'whoops', 'you dropped your ink');
  post(42, hooligan, [
    'Magenta is a very popular color. Half this board would pick magenta. I would pick something classier, personally, if I were the kind of person who did that, which I\'m not.',
    'Also you double-posted the changelog in the other thread so honestly it\'s a public service.',
  ].join('\n\n'), 29, 21, 20, 41);
  post(43, pipewrench, 'Can confirm Mrs. Hooligan has never once been seen in the same thread as a bucket of ink. Suspicious in its own way, if you think about it.', 29, 21, 31);
  post(44, spritey, [
    '[b]Level editor 2.3: the full changelog (again)[/b]',
    'Pipes can now face any of four directions. Diagonal pipes were tried and are not coming back.',
    'Undo goes back 200 steps instead of 20.\nThe tile picker remembers your last three tilesets.\nWater no longer flows uphill when the level is resized.\nCustom music loops at the point you set, not at the start of the file.\nFixed the crash when an enemy was placed inside another enemy.\nFixed a second, different crash when that happened in water.',
    'Every one of these was requested in this forum. You\'re welcome. Please read it this time.',
  ].join('\n\n'), 29, 21, 40);
  play(29, 21, 41, gloomba, 44, 'stick-around', 'required reading');
  post(45, gloomba, 'I read the whole changelog and I have a question about the water. Mostly I have a question about who keeps splatting these.', 29, 21, 43);
  post(46, gloomba, LONG_POST, 29, 21, 46);
  play(29, 21, 52, pipewrench, 46, 'whoops', 'you dropped your ink');

  /* ---- reactions: the Main board's chips, the rival's own Tea on #42, then #43's four ---- */
  const [r1, r2, r3, r4] = fans as [string, string, string, string];
  const [a1, a2, a3, a4] = crowd as [string, string, string, string];
  when(29, 21, 23, () => {
    for (const [account, character] of [[a1, r1], [a2, r2], [a3, r3], [a4, r4]] as const) seed.react(account, character, posts[41]!, 'fire');
    for (const [account, character] of [[a1, r1], [a2, r2]] as const) seed.react(account, character, posts[41]!, 'eye-roll');
    seed.react(a3, r3, posts[41]!, 'tea');
  });
  when(29, 21, 29, () => {
    for (const [account, character] of [[a1, r1], [a2, r2], [a3, r3]] as const) seed.react(account, character, posts[42]!, 'angry');
    for (const [account, character] of [[a1, r1], [a2, r2]] as const) seed.react(account, character, posts[42]!, 'tomato');
    seed.react(a3, r3, posts[42]!, 'handshake');
    seed.react(rival, gloomba, posts[42]!, 'tea');
  });
  when(29, 22, 4, () => {
    seed.react(a1, r1, posts[43]!, 'tomato');
    seed.react(a2, r2, posts[43]!, 'tomato');
    seed.react(a3, r3, posts[43]!, 'angry');
    seed.react(a4, r4, posts[43]!, 'cursing');
  });

  /* ---- Pipewrench's timeline: wallets, hands, what is pending, the Turn and the settlements ---- */
  const drewHeat = (amount: number) => ({ character: pipewrench, reason: 'heel.drewHeat', amount });
  when(29, 8, 17, () => {
    seed.settle({
      at: utc(29, 8, 17), debut: false, turns: false,
      wallet: { [player]: 562, [rival]: 300, [reader]: 120 },
      standings: { [spritey]: 650, [hooligan]: 420, [pipewrench]: 295, [gloomba]: 180, [thwompson]: 40 },
    });
    seed.nextSettlementAt(utc(30, 8, 17));
    seed.cards(player, { whoops: 1, 'stick-around': 1 });
    seed.estimate(player, { entries: [drewHeat(30)] });
  });
  when(29, 20, 10, () => { seed.wallet(player, 462); seed.cards(player, { whoops: 2, 'stick-around': 1 }); });
  when(29, 21, 52, () => {
    seed.wallet(player, 337);
    seed.cards(player, { whoops: 1, 'stick-around': 1 });
    seed.estimate(player, { entries: [drewHeat(20), { character: pipewrench, reason: 'heel.stoleThunder', amount: 20 }, { character: pipewrench, reason: 'heel.shrugged', amount: -5 }] });
  });
  when(30, 0, 35, () => seed.turn(pipewrench, 'face', { loudness: 'announced', showFrom: true, showTo: false }));
  when(30, 8, 17, () => {
    seed.settle({ at: utc(30, 8, 17), debut: false, turns: true, wallet: { [player]: 372 }, standings: { [pipewrench]: 330 } });
    seed.announceTurn(pipewrench, turns.thread, { was: 'heel', at: utc(30, 8, 17) });
    seed.nextSettlementAt(utc(31, 8, 17));
    seed.estimate(player, {});
  });

  // Stable by time: steps given in the order a day happened stay in it where two share a minute.
  for (const step of [...steps.filter((s) => s.at <= now).sort((a, b) => a.at - b.at), ...plays.filter((s) => s.at <= now).sort((a, b) => a.at - b.at)]) step.run();

  fake.signInAs({ player, rival, reader }[MOMENTS[moment].account]);
  // A property the bundler keeps, so a production build that carries this fixture can be found by name (tools/check-web-bundle.mjs).
  Object.defineProperty(fake, 'KAYFA_FAKE_BACKEND', { value: 'boards', configurable: true });
  return MOMENTS[moment].route(opener.thread);
}
