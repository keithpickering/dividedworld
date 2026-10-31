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
 * account (and, for the player's moments, puts this device's HUD on Pipewrench) and returns the
 * route. The fake must have been made for the moment (`createBoardsFake`), because the clock is
 * what its estimate, its cooldowns and "next settlement" are read against.
 *
 * Where the fixture is less than the real thing, it says so:
 *  - Posts and reactions need accounts to make them: four more players (Ringside 1 to 4) hold the
 *    crowd's reactions, which one player cannot (a player reacts once to a kind on a post).
 *  - Card plays are written in time order between the posts, as they happened. A play takes no number
 *    in its thread (supabase/migrations/0035_card_takes_no_seq.sql), so the posts are #41 to #46 with
 *    no gap whenever it falls, and `engine/ui/cards/` draws each as the tag on its post.
 *  - The marker the production bundle is checked for is the fake's (`FAKE_BACKEND_MARKER`); the
 *    fixture carries no marker of its own.
 *  - The Whoops! on #41 is Mrs. Hooligan's play of a card the player bought before the timeline begins;
 *    #41 is short, so the play costs nothing and moves no wallet (the timeline shows none), and the log
 *    reads it from the card ledger alone, in Mrs. Hooligan's lines and Spritey's, not Pipewrench's.
 *  - The settlement at Oct 29 08:17 (scoring the window from Oct 28; the log says "for Oct 28") was made before the shares were kept (supabase/migrations/0034_ledger_shares.sql),
 *    so it has its lines and none, as the log shares plan's Task 4 asks; the wallet before it is seeded
 *    as it stood, with no history behind it.
 *  - Stick Around's release sentence is the play's own setting (its `config`), seeded on #44's play.
 */
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { createFake } from '../../../../engine/ui/data/fake.ts';
import { hudKey } from '../../../../engine/ui/player.tsx';
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
const MINUTE = 60_000;
const thread = (id: string, post?: number) => `/t/${id}?page=3${post === undefined ? '' : `#post-${post}`}`;

/** The daily settlements (the instance's cron is 08:17 UTC): the one before the day shown, the one after it, and the next. */
const SETTLE_1 = utc(29, 8, 17);
const SETTLE_2 = utc(30, 8, 17);
const SETTLE_3 = utc(31, 8, 17);

/** When each thing happened on Oct 29 and 30; the moments below sit beside these. */
const POSTED = { 41: utc(29, 21, 14), 42: utc(29, 21, 20), 43: utc(29, 21, 31), 44: utc(29, 21, 40), 45: utc(29, 21, 43), 46: utc(29, 21, 46) } as const;
const WHOOPS_ON_41_AT = utc(29, 21, 16);
const STICK_AROUND_AT = utc(29, 21, 41);
const BOUGHT_AT = utc(29, 20, 10);
const PLAYED_AT = utc(29, 21, 52);
const TURNED_AT = utc(30, 0, 35);
/*
 * The two classes said in public, which only Rankings draws (board 13): Thwompson's long before the
 * night (it posts nowhere the boards show), and Gloomba's after the last board of its thread, 06-turn
 * at 00:35, so no postbit of Gloomba's on boards 01 to 05 says it. Thwompson's player asks a Turn,
 * announced, after the Hold board's 21:41, and the Oct 30 settlement makes it and announces it.
 */
const THWOMPSON_REVEALED_AT = utc(8, 9, 31);
const GLOOMBA_REVEALED_AT = utc(30, 1, 13);
const THWOMPSON_TURNS_AT = utc(30, 2, 5);

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
  // Between #46 (21:46) and Pipewrench's play at 21:52: the second Whoops! is armed, not yet played.
  '01-main': moment(POSTED[46] + MINUTE, 'player', (id) => thread(id)),
  '02-phone': moment(POSTED[46] + MINUTE, 'player', (id) => thread(id)),
  // Ten minutes after #42, with its reactions in, before #43.
  '03-react': moment(POSTED[42] + 10 * MINUTE, 'rival', (id) => thread(id, 42)),
  // The minute before the play, which the form is open for.
  '05-cards': moment(PLAYED_AT - MINUTE, 'player', (id) => thread(id, 46)),
  // The minute before the Turn, which the modal is open to choose.
  '06-turn': moment(TURNED_AT - MINUTE, 'player', () => '/characters'),
  // The minute before the buy.
  '07-vending': moment(BOUGHT_AT - MINUTE, 'player', () => '/vending'),
  '08-hold': moment(STICK_AROUND_AT, 'reader', (id) => thread(id, 44)),
  // The first load after the settlement, three minutes on.
  '09-settlement': moment(SETTLE_2 + 3 * MINUTE, 'player', () => '/log/settlement'),
  // The plan's 08:30, thirteen minutes after the settlement.
  '10-roster': moment(SETTLE_2 + 13 * MINUTE, 'player', () => '/characters'),
  '11-settings': moment(SETTLE_2 + 13 * MINUTE, 'player', () => '/settings'),
  '12-log': moment(SETTLE_2 + 13 * MINUTE, 'player', () => '/log'),
  // Rankings, at the Roster board's time: the standings as the Oct 30 settlement left them.
  '13-rankings': moment(SETTLE_2 + 13 * MINUTE, 'player', () => '/rankings'),
});
export type MomentName = keyof typeof MOMENTS;

const NAMES = Object.keys(MOMENTS);

/** A fake whose clock is the moment's, for `seedBoards`. */
export function createBoardsFake(moment: MomentName): Fake {
  return createFake({ instance, settings: fallbackSettings, now: () => MOMENTS[moment].at });
}

/** The moment a name or an address's parameter says, or an Error that lists the moments there are (a missing name included). */
export function assertMoment(name: string | null): MomentName {
  if (name === null || name === '') throw new Error(`The boards fixture needs a moment: add moment=<name> to the address. The moments are: ${NAMES.join(', ')}.`);
  if (!Object.hasOwn(MOMENTS, name)) throw new Error(`There is no moment named "${name}". The moments are: ${NAMES.join(', ')}.`);
  return name as MomentName;
}

/** The long post, #46: 812 characters, as the plan says; its length prices the play below. */
const LONG_POST_LENGTH = 812;
const LONG_POST = (() => {
  const line = 'I did not splat anything. I want that on the record before the record is the splat. ';
  const end = 'Check the card Acts if you do not believe me. They are public, and so is every one of you.';
  let body = '';
  while ([...body + line + end].length <= LONG_POST_LENGTH) body += line;
  return (body + end).padEnd(LONG_POST_LENGTH, '.').slice(0, LONG_POST_LENGTH);
})();

/** #41, Spritey's: short, so a Whoops! on it costs nothing past the card (`surchargeOn`). */
const POST_41 = [
  'Third time this week. I wrote four whole paragraphs about the level editor update and somebody dumped a bucket of ink on it before anyone got past the first sentence.',
  'I\'m not mad. I\'m documenting. Whoever you are, I can see the color you picked, and I will remember it.',
  'Posting the full changelog again below in case it gets splatted a fourth time. Scroll down if you can still read.',
].join('\n\n');

const FILLER = [
  'Anyone else seeing this?',
  'I was here for the first one and I am still here.',
  'This thread is a lot.',
  'No notes. Well, one note. Fewer splats.',
  'Bumping so it does not sink under the Level Editor threads.',
  'Somebody check the Acts.',
  'I have a theory and it has a color.',
];

/*
 * The money, in hundredths of an orb, derived from the instance's own prices so the timeline reads as
 * arithmetic (glass plan, section 2.1): the wallet after the Oct 29 settlement, less the Whoops! bought
 * at 20:10, less the long post's surcharge at the 21:52 play (the card was paid for at the machine, #78), plus what the Oct 30 settlement scored.
 */
const economy = instance.settings.economy;
/** The ink of the board's Whoops!: magenta, the Cards board's first swatch, and the seed the server chose for the play. */
const WHOOPS_INK = { color: '#ff2bd6', seed: 20261029 };
const WALLET_START = 562;
/** What the settlement at Oct 29 08:17 scored (for Oct 28; the board's "for Oct 29" is the next one, Oct 30 08:17) for the player's three characters, made before shares were kept: it brings the wallet to WALLET_START. */
const SCORED_OCT_28 = [['pipewrench', 'heel.drewHeat', 25], ['hooligan', 'face.cheered', 15], ['spritey', 'jabroni.drewTheGroan', 10]] as const;
/** What a Whoops! play costs on a post of this text: the card is paid for once, at the machine (#78), so only what a long post adds. */
const surchargeOn = (body: string) => economy['whoops.perLength']! * Math.floor([...body].length / economy['whoops.lengthStep']!);
const LONG_POST_COST = surchargeOn(LONG_POST);
/** The settlement's scoring as a Heel: drew heat, stole thunder (the play on #46), a polite shrug. */
const SCORED = [['heel.drewHeat', 20], ['heel.stoleThunder', 20], ['heel.shrugged', -5]] as const;
/**
 * The post each of those was shared on, and the quadrant (engine/rules/settle.ts's shareEntries, which the settlement writes):
 * the heat on Pipewrench's #43, the thunder on the play's own Act on #46 (a card's lift is weighed on the card), and the shrug on #43.
 */
const SHARED_ON = { 'heel.drewHeat': ['post-43', 'excitedNegative'], 'heel.stoleThunder': ['play-46', 'excitedNegative'], 'heel.shrugged': ['post-43', 'calmPositive'] } as const;
/** Before the play on #46 the estimate is all heat. */
const ESTIMATE_BEFORE_PLAY = 30;

/** What has happened, as (when, what): the fixture applies the ones at or before the moment, in order, handing each its own time. */
interface Step { readonly at: number; readonly run: (at: number) => void }

/**
 * Seed the season as of `moment` into `fake` (made with `createBoardsFake(moment)`), sign in the
 * moment's account and return the route to open. An unknown moment throws, naming the ones there are.
 */
export function seedBoards(fake: Fake, moment: MomentName): string {
  const now = MOMENTS[assertMoment(moment)].at;
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
  const when = (at: number, run: (at: number) => void) => steps.push({ at, run });
  /* A card play takes no number in its thread, so it is written where it happened, between the posts. */
  /* Each play's Act, by the post it landed on, once it is made: the Oct 30 settlement shares stolen thunder on Pipewrench's. */
  const plays: Record<number, string> = {};
  const play = (at: number, character: string, target: number, card: string, message: string, o: { config?: Readonly<Record<string, unknown>>; paid?: number } = {}) =>
    when(at, (when_) => {
      plays[target] = seed.card(character, posts[target]!, card, {
        message, at: when_, ...(card === 'whoops' ? { layer: 1, config: WHOOPS_INK } : o.config === undefined ? {} : { config: o.config }), ...(o.paid === undefined ? {} : { paid: o.paid }),
      });
    });
  const post = (n: keyof typeof POSTED, character: string, body: string, quote?: number) =>
    when(POSTED[n], (at) => { posts[n] = seed.post(opener.thread, character, body, { at, ...(quote === undefined ? {} : { quote: posts[quote]! }) }); });

  post(41, spritey, POST_41);
  play(WHOOPS_ON_41_AT, hooligan, 41, 'whoops', 'you dropped your ink', { paid: surchargeOn(POST_41) });
  post(42, hooligan, [
    'Magenta is a very popular color. Half this board would pick magenta. I would pick something classier, personally, if I were the kind of person who did that, which I\'m not.',
    'Also you double-posted the changelog in the other thread so honestly it\'s a public service.',
  ].join('\n\n'), 41);
  post(43, pipewrench, 'Can confirm Mrs. Hooligan has never once been seen in the same thread as a bucket of ink. Suspicious in its own way, if you think about it.');
  post(44, spritey, [
    '[b]Level editor 2.3: the full changelog (again)[/b]',
    'Pipes can now face any of four directions. Diagonal pipes were tried and are not coming back.',
    'Undo goes back 200 steps instead of 20.\nThe tile picker remembers your last three tilesets.\nWater no longer flows uphill when the level is resized.\nCustom music loops at the point you set, not at the start of the file.\nFixed the crash when an enemy was placed inside another enemy.\nFixed a second, different crash when that happened in water.',
    'Every one of these was requested in this forum. You\'re welcome. Please read it this time.',
  ].join('\n\n'));
  play(STICK_AROUND_AT, gloomba, 44, 'stick-around', 'required reading', { config: { sentence: 'I have read every word of Spritey\'s changelog and I feel changed.' } });
  post(45, gloomba, 'I read the whole changelog and I have a question about the water. Mostly I have a question about who keeps splatting these.');
  post(46, gloomba, LONG_POST);
  play(PLAYED_AT, pipewrench, 46, 'whoops', 'you dropped your ink', { paid: LONG_POST_COST });

  /* ---- reactions: the Main board's chips, the rival's own Tea on #42, then #43's four ---- */
  const [r1, r2, r3, r4] = fans as [string, string, string, string];
  const [a1, a2, a3, a4] = crowd as [string, string, string, string];
  when(POSTED[41] + 9 * MINUTE, () => {
    for (const [account, character] of [[a1, r1], [a2, r2], [a3, r3], [a4, r4]] as const) seed.react(account, character, posts[41]!, 'fire');
    for (const [account, character] of [[a1, r1], [a2, r2]] as const) seed.react(account, character, posts[41]!, 'eye-roll');
    seed.react(a3, r3, posts[41]!, 'tea');
  });
  when(POSTED[42] + 9 * MINUTE, () => {
    for (const [account, character] of [[a1, r1], [a2, r2], [a3, r3]] as const) seed.react(account, character, posts[42]!, 'angry');
    for (const [account, character] of [[a1, r1], [a2, r2]] as const) seed.react(account, character, posts[42]!, 'tomato');
    seed.react(a3, r3, posts[42]!, 'handshake');
    seed.react(rival, gloomba, posts[42]!, 'tea');
  });
  when(utc(29, 22, 4), () => {
    seed.react(a1, r1, posts[43]!, 'tomato');
    seed.react(a2, r2, posts[43]!, 'tomato');
    seed.react(a3, r3, posts[43]!, 'angry');
    seed.react(a4, r4, posts[43]!, 'cursing');
  });

  /* ---- Pipewrench's timeline: wallets, hands, what is pending, the Turn and the settlements ---- */
  const heat = (amount: number) => ({ character: pipewrench, reason: 'heel.drewHeat', amount });
  const named = { pipewrench, hooligan, spritey } as const;
  seed.wallet(player, WALLET_START - SCORED_OCT_28.reduce((sum, [, , amount]) => sum + amount, 0));
  when(SETTLE_1, (at) => {
    seed.settle({
      at, debut: false, turns: false, sharesKept: false,
      ledger: SCORED_OCT_28.map(([who, reason, amount]) => ({ character: named[who], reason, amount })),
      wallet: { [rival]: 300, [reader]: 120 },
      standings: { [spritey]: 650, [hooligan]: 420, [pipewrench]: 295, [gloomba]: 180, [thwompson]: 40 },
    });
    seed.nextSettlementAt(SETTLE_2);
    seed.cards(player, { whoops: 1, 'stick-around': 1 });
    seed.estimate(player, { entries: [heat(ESTIMATE_BEFORE_PLAY)] });
  });
  when(BOUGHT_AT, (at) => { seed.buy(player, 'whoops', { at }); });
  when(PLAYED_AT, () => {
    seed.cards(player, { whoops: 1, 'stick-around': 1 });
    seed.estimate(player, { entries: SCORED.map(([reason, amount]) => ({ character: pipewrench, reason, amount })) });
  });
  when(TURNED_AT, () => seed.turn(pipewrench, 'face', { loudness: 'announced', showFrom: true, showTo: false }));
  /* ---- the classes said in public, and Thwompson's Turn ---- */
  when(THWOMPSON_REVEALED_AT, (at) => {
    const lurking = seed.thread('general', thwompson, 'i read everything', 'Someone has to. Since you ask, here is what I am.', { at: at - MINUTE });
    seed.reveal(thwompson, lurking.thread, { at });
  });
  when(GLOOMBA_REVEALED_AT, (at) => {
    const said = seed.thread('general', gloomba, 'cards on the table', 'Fine. You want to know who I am? Here it is.', { at: at - MINUTE });
    seed.reveal(gloomba, said.thread, { at });
  });
  when(THWOMPSON_TURNS_AT, () => seed.turn(thwompson, 'heel', { loudness: 'announced', showFrom: false, showTo: false }));

  when(SETTLE_2, (at) => {
    const shareOn = { 'post-43': posts[43]!, 'play-46': plays[46]! };
    seed.settle({
      at, debut: false, turns: true,
      ledger: SCORED.map(([reason, amount]) => ({ character: pipewrench, reason, amount, shares: [{ act: shareOn[SHARED_ON[reason][0]], quadrant: SHARED_ON[reason][1], amount }] })),
    });
    seed.announceTurn(pipewrench, turns.thread, { was: 'heel', at });
    seed.announceTurn(thwompson, turns.thread, { at });
    seed.nextSettlementAt(SETTLE_3);
    seed.estimate(player, {});
  });

  // Stable by time: steps given in the order a day happened stay in it where two share a minute.
  for (const step of steps.filter((s) => s.at <= now).sort((a, b) => a.at - b.at)) step.run(step.at);

  fake.signInAs({ player, rival, reader }[MOMENTS[moment].account]);
  /*
   * The boards draw the player's HUD on Pipewrench. Which character the HUD shows is this device's
   * choice (engine/ui/player.tsx), not the server's, so the fixture makes it on the device, as the
   * player would by the swap; without it the HUD shows the first of the player's characters by name.
   */
  if (MOMENTS[moment].account === 'player') {
    try { globalThis.localStorage?.setItem(hudKey(player), pipewrench); } catch { /* a device that keeps nothing shows the default */ }
  }
  return MOMENTS[moment].route(opener.thread);
}
