/**
 * The stage's world (docs/plans/2026-11-14-hype-video-storyboard.md; docs/plans/2026-11-21-commentary-video-plan.md, Task 4): the made-up
 * forum a hype-video shot is filmed on, seeded on the in-memory backend. Stage.board.stories.tsx draws it; Stage.test.tsx seeds it and
 * holds it to what the shots rely on. A story of its own (its address dresses it: `skin=`, `as=`, `view=`, `sheet=`) is the only thing
 * that draws it, so no screen, rule or payload of the app is added.
 *
 * The cast is the film's own (FILM_CAST below): five made-up names, classes and avatars, copied from the Front Door's five
 * (instances/divided-world/ui/front-door.ts). The film moves to Hotel Bro in #1006's build.
 * Two players are behind them. The film's first is Snuckles and Human Josh. The second is Chadluminum and D-Guy, who are one person
 * (the commentary's node 7: "so the argument you've been watching is, I think, mostly, one person"). Serious Deer is a third player's.
 * D-Guy is a Heel and Chadluminum a Face. A crowd of made-up characters, one player each, is the audience: they react, and they wrote
 * the posts at the foot of the thread, each wearing one live effect.
 *
 * What is set face down before a camera runs is set through the backend's own `setCard`, as its owner (the seed's `set` keeps no catch,
 * no quadrant and no phrase, so a Rope Break so set would catch nothing): Rope Break on Snuckles's first post, 4D Chess on D-Guy's review
 * naming Whoops! and the Heat quadrant, and a Steel Chair on Chadluminum's kind post, waiting for "to be fair". `Made.ready` settles when
 * that, and the drawing of Graffiti's wall, is done; the story draws nothing before it.
 */
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import type { Instance } from '../../../../engine/rules/types.ts';
import type { FrontDoorCharacter } from '../../../../engine/ui/types.ts';
import { hudKey } from '../../../../engine/ui/player.tsx';
import { cardOf } from '../../../../engine/ui/story.tsx';
import fangamePortrait from '../avatars/fangame-portrait.webp?url';
import fangameSquare from '../avatars/fangame-square.webp?url';
import snucklesPortrait from '../avatars/snuckles_portrait.png?url';
import snucklesSquare from '../avatars/snuckles_square.png?url';
import chadPortrait from '../avatars/robochad_portrait.jpg?url';
import chadSquare from '../avatars/robochad_square.jpg?url';
import deerPortrait from '../avatars/deer_portrait.jpg?url';
import deerSquare from '../avatars/deer_square.jpg?url';
import joshPicture from '../avatars/human.jpg?url';
import dguyPortrait from '../avatars/dguy_portrait.jpg?url';
import dguySquare from '../avatars/dguy_square.jpg?url';
import LINES from './staff-lines.json';
import { installForecast } from './forecast.ts';

const HOUR = 3_600_000;

/** When the film's cast revealed their classes: a fixed day, so the postbit's dated line reads the same for every visitor. */
const REVEALED_AT = '2026-10-03T12:00:00Z';

/** The film's cast: the five made-up characters the thread is written by, each with its name, rank, post count, revealed class and avatars. */
export const FILM_CAST: readonly FrontDoorCharacter[] = Object.freeze([
  Object.freeze({ key: 'snuckles', name: 'Snuckles', rank: 0, posts: 2817, revealed: Object.freeze({ class: 'jabroni', at: REVEALED_AT }), avatarPortrait: snucklesPortrait, avatarSquare: snucklesSquare }),
  Object.freeze({ key: 'wholesome', name: 'Chadluminum', rank: 3, posts: 1204, revealed: Object.freeze({ class: 'face', at: REVEALED_AT }), avatarPortrait: chadPortrait, avatarSquare: chadSquare }),
  Object.freeze({ key: 'accountant', name: 'Serious Deer', rank: 2, posts: 388, revealed: Object.freeze({ class: 'technician', at: REVEALED_AT }), avatarPortrait: deerPortrait, avatarSquare: deerSquare }),
  Object.freeze({ key: 'roboto', name: 'Human Josh', rank: 1, posts: 212, revealed: Object.freeze({ class: 'heel', at: REVEALED_AT }), avatarPortrait: joshPicture, avatarSquare: joshPicture }),
  Object.freeze({ key: 'tweener', name: 'D-Guy', rank: 4, posts: 1224, revealed: Object.freeze({ class: 'tweener', at: REVEALED_AT }), avatarPortrait: dguyPortrait, avatarSquare: dguySquare }),
]);

/** What the world's address asks for: the skin, whose player is signed in, which screen, and whether Snuckles's post shows its sprite sheet. */
export interface StageOptions {
  readonly skin: string;
  readonly as: string | null;
  readonly view: string;
  readonly sheet: boolean;
}

/** What the world's seed made, for the page and the shot scripts: the thread, the post the gag is played on, and who is who. */
export interface Made {
  readonly thread: string;
  /** The post the ink lands on in round 1: its Act, its number in the thread, and its author. */
  readonly target: { readonly act: string; readonly seq: number; readonly character: string };
  /** The cast by the film's names, and the crowd by theirs: each name's character. */
  readonly cast: Readonly<Record<string, string>>;
  readonly me: string;
  /** The montage's posts, by what each is for: its number in the thread. */
  readonly scenes: Readonly<Record<string, number>>;
  /** The Staff's threads (the argument the Boss walks into, and his farewell) and the staff themselves, by key. */
  readonly threads: Readonly<Record<string, string>>;
  readonly staff: Readonly<Record<string, string>>;
  /** Whose player each character is: a name's account. A character's player is the one who may act as it. */
  readonly owners: Readonly<Record<string, string>>;
  /** The account the page is signed in as, which is `as=`'s character's player (the film's first player's when there is none). */
  readonly viewer: string;
  /** The character the HUD plays as: the one `as=` names, else the film's first player's Snuckles. */
  readonly played: string;
  /** The commentary's posts, by what each is for: its number in the main thread. */
  readonly posts: Readonly<Record<string, number>>;
  /** The same posts' Acts. */
  readonly acts: Readonly<Record<string, string>>;
  /** The cards set face down before the camera runs, by what each is: the set's Act. */
  readonly sets: Readonly<Record<string, string>>;
  /** The crowd's names, in the order they were made. */
  readonly crowd: readonly string[];
  /** The Boss's two boards, by slug: the one merged and the one it was merged into. */
  readonly boards: { readonly palace: string; readonly minus: string };
  /** Settles when what is set face down, and the wall that is drawn, is done: a story draws nothing before. */
  readonly ready: Promise<void>;
}

/** The cast's classes where the commentary changes the film's own. */
const CLASSES: Readonly<Record<string, string>> = { 'D-Guy': 'heel' };

/** The crowd: the audience of the sprite sheet thread, and the authors of the five dressed posts at its foot. One player each. */
export const CROWD = ['Ringside', 'Front Row', 'Nosebleeds', 'Aisle Seat', 'Back Row', 'Concessions'] as const;

/** A wave across a post's body: a stroke with no two points on a line, as Graffiti's own wall story draws one. */
function wave(y: number, x0: number, x1: number, amp: number, n = 24): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return [Math.round((x0 + (x1 - x0) * t) * 1e4) / 1e4, Math.round((y + amp * Math.sin(t * Math.PI * 2)) * 1e4) / 1e4] as [number, number];
  });
}

/** Seeds the world on `fake`, for `instance`. */
export function buildStage(fake: Fake, instance: Instance, options: StageOptions): Made {
  const now = Date.now();
  /*
   * The backend's own clock starts at a fixed day long before the page's, and an action made while the camera runs (a reaction, a cast, a post) is
   * dated by it: a quote written live would stand dated before the thread it is in, and a card that wears off would have worn off already.
   * So the clock is brought to the page's before anything is made, and what the page does from here is dated now.
   */
  fake.clock.advance(now - fake.clock.now());
  const lasts = (card: string) => cardOf(instance.cards, card).lasts !== undefined;
  /** The end a card that wears off is seeded with: well past any film. */
  const ends = new Date(now + 5 * 24 * HOUR).toISOString();
  fake.seed.season({ number: 1, startsAt: new Date(now - 30 * 24 * HOUR).toISOString() });
  const me = fake.seed.account('hype-player', { seasoned: true });
  const second = fake.seed.account('hype-a', { seasoned: true });
  const third = fake.seed.account('hype-b', { seasoned: true });
  /* The film's cast, each with its class and its face. Snuckles and Human Josh are the film's first player's; Chadluminum and D-Guy the second's. */
  const owner: Record<string, string> = { Snuckles: me, 'Human Josh': me, Chadluminum: second, 'D-Guy': second, 'Serious Deer': third };
  const cast: Record<string, string> = {};
  FILM_CAST.forEach((c, i) => {
    const id = fake.seed.character(owner[c.name]!, c.name, CLASSES[c.name] ?? c.revealed?.class ?? instance.classes[0]!.key, { at: now - (29 * 24 - i) * HOUR });
    fake.seed.avatar(id, { square: c.avatarSquare, portrait: c.avatarPortrait });
    cast[c.name] = id;
  });
  const who = (name: string) => cast[name]!;
  /* The crowd, one player each: the first is the reader who has no character in the thread but Ringside, the one Stick Around holds. */
  const crowdAccounts: string[] = [];
  for (const [i, name] of CROWD.entries()) {
    const account = fake.seed.account(i === 0 ? 'hype-reader' : `hype-crowd-${i}`, { seasoned: true });
    crowdAccounts.push(account);
    owner[name] = account;
    cast[name] = fake.seed.character(account, name, instance.classes[0]!.key, { at: now - (20 - i) * 24 * HOUR });
  }
  const t0 = now - 5 * HOUR;
  const { thread, act: first } = fake.seed.thread('general', who('Snuckles'), 'my first sprite sheet (please be normal)',
    `Posting my first sprite sheet: a Wiggler. Twelve frames of walking, and parts to build yer own.\n\n${options.sheet ? '[img]https://dw.gripe/hype/wiggler-sheet.gif[/img]\n\n' : ''}I spent two weeks on the walk cycle. Please be normal about this.`, { at: t0 });
  const kindWords = fake.seed.post(thread, who('Chadluminum'), 'This is wonderful and you should be proud. The walk has real warmth.', { at: t0 + 0.4 * HOUR });
  fake.seed.post(thread, who('Serious Deer'), 'Frame six of the walk has eleven colors. The palette you posted has ten.\n\nI am not upset. I am noting it.', { at: t0 + 0.9 * HOUR });
  const target = fake.seed.post(thread, who('Snuckles'),
    'Updated the sheet. The Wiggler blinks now, and I think the blink is really working.\n\nI also fixed frame six. Ten colors. You can count them.\n\nThank you all for being so normal about this.', { at: t0 + 2 * HOUR });
  fake.seed.post(thread, who('D-Guy'), 'Magenta is a very popular color. Half this board would pick magenta. I would pick something classier, personally, if I were the kind of person who did that, which I\'m not.', { at: t0 + 2.3 * HOUR });
  fake.seed.post(thread, who('Human Josh'), 'As a human, I also enjoy blinking.', { at: t0 + 2.6 * HOUR });
  /*
   * The montage's posts, each the stage for one card (tools/hype/shot-montage.mjs lands the cards that land on camera): a kind word for
   * Autocorrect to rewrite, the deer for a Glitter Bomb, a review for Stick Around to hold a reader on (the shot lands the card: a hold in the thread would take every other shot's reader too), a joke for a Laugh Track, an appeal
   * for Jimmy Wails, and a post a Mod Bot has been to, with the warning it left.
   */
  const day = t0 + 3 * HOUR;
  const kind = fake.seed.post(thread, who('Chadluminum'), 'I think Snuckles is a genuine talent and this sprite sheet is beautiful.\n\nI mean that sincerely.', { at: day });
  const recount = fake.seed.post(thread, who('Serious Deer'), 'I have recounted. It is ten colors.\n\nI withdraw my note, and I apologize to the palette.', { at: day + 0.2 * HOUR });
  const review = fake.seed.post(thread, who('D-Guy'), 'My full review of the sprite sheet, in nine parts. Part one: the walk. Part two: also the walk. Nobody leaves until part nine.', { at: day + 0.4 * HOUR });
  const joke = fake.seed.post(thread, who('Human Josh'), 'A sprite walks into a bar. The bartender says, "why the long frame?"\n\nAs a human, I laughed at this with my mouth.', { at: day + 0.6 * HOUR });
  fake.seed.card(who('D-Guy'), joke, 'laugh-track', { layer: 1, message: 'Laugh Track', config: { cues: [{ phrase: 'why the long frame?', sound: 'laugh' }, { phrase: 'As a human', sound: 'boo' }], seed: 7 }, at: day + 0.65 * HOUR });
  const appeal = fake.seed.post(thread, who('Snuckles'), 'I have spent two weeks on this walk cycle, and I am told that is "a lot for twelve frames". Here it is, and I hope somebody likes it.', { at: day + 0.8 * HOUR });
  /* A donation is not given to a drive its own player cast (the gift's button stays off), and the film's second player is now D-Guy's too: Serious Deer plays the appeal. */
  fake.seed.card(who('Serious Deer'), appeal, 'jimmy-wails', { layer: 1, message: 'Please. He spent two weeks on twelve frames.', drawn: 'blue-shirt', at: day + 0.85 * HOUR });
  const filed = fake.seed.post(thread, who('Snuckles'), 'Is this the right board for sprite sheets? I looked for a sprite board and there was not one.', { at: day + HOUR });
  const mod = fake.seed.staff('ontopic', 'ONTOPIC 5.0', 'mod');
  const visit = fake.seed.visit(mod, filed, { at: day + 1.1 * HOUR, endsInMs: HOUR, line: 'A question about boards, asked on a board. I will allow that this is efficient.' });
  fake.seed.visitEnd(visit, { outcome: 'filed', line: 'Two stars. Filed.', at: day + 1.2 * HOUR });
  fake.seed.infraction(visit, { points: 6, at: day + 1.2 * HOUR });
  /* A post whose one use is off camera: the title cards' strip of tape is a real Autocorrect, landed on this post's "friends" and copied from it (tools/hype/shot-cards.mjs). */
  fake.seed.post(thread, who('Chadluminum'), 'We are all friends here.', { at: day + 1.4 * HOUR });
  const scenes = { kind: 7, recount: 8, review: 9, joke: 10, appeal: 11, filed: 12, friends: 13 };
  void [kind, recount, review];

  /*
   * The commentary's posts, after the montage's, so no number of round 1 moves. D-Guy's review is the one the class node is filmed on; the
   * five below it are the foot of the thread the page scrolls down in node 8, each wearing one live effect (a card from a character of
   * another player than its author's, as a player's play is).
   */
  const dguy = fake.seed.post(thread, who('D-Guy'),
    'ok i watched the sprite sheet so you do not have to. 2/10.\n\ntwelve frames and none of them are walking. they are all just standing there in different poses.\n\ni respect the effort. i do not respect the result.', { at: day + 1.5 * HOUR });
  const dressed = [
    { by: 'Front Row', card: 'hot-box', text: 'ok i am just going to say it, the wiggler is the best thing posted here all week. i have been refreshing this thread for an hour.', config: { color: '#9370db' }, caster: 'Aisle Seat' },
    { by: 'Nosebleeds', card: 'glitter-bomb', text: 'this thread is the only reason i logged in today. 10/10 would refresh again.', config: {}, caster: 'Chadluminum' },
    { by: 'Aisle Seat', card: 'feelin-fab', text: 'snuckles you are a legend and i will not be taking questions.', config: {}, caster: 'Chadluminum' },
    { by: 'Back Row', card: 'graffiti', text: 'magenta forever. magenta or nothing.', config: {}, caster: 'Front Row' },
    { by: 'Concessions', card: 'autocorrect', text: 'we are all very supportive of this sprite sheet and its twelve frames.', config: { phrase: 'very supportive', replacement: 'deeply concerned' }, caster: 'Back Row' },
  ] as const;
  const dressedActs = dressed.map((d, i) => fake.seed.post(thread, who(d.by), d.text, { at: day + (1.6 + 0.07 * i) * HOUR }));
  /* Graffiti's wall is drawn by the caster, as a player; that is a call the backend answers after this seed returns, so it is in `ready`. */
  const walls: { play: string; by: string }[] = [];
  dressed.forEach((d, i) => {
    const act = dressedActs[i]!;
    if (d.card === 'glitter-bomb') {
      fake.seed.reach(who(d.caster), 'character', who(d.by), 'glitter-bomb', { post: act, ends: now + 5 * 24 * HOUR, message: 'You earned this.' });
      return;
    }
    const play = fake.seed.card(who(d.caster), act, d.card, { layer: 1, config: d.config, message: '', ...(lasts(d.card) ? { ends } : {}) });
    if (d.card === 'graffiti') walls.push({ play, by: d.caster });
  });

  fake.seed.tally(first, { fire: 3, 'thumbs-up': 5 });
  fake.seed.tally(target, { fire: 4, 'thumbs-up': 2 });
  const accounts = [me, second, third, ...crowdAccounts];
  fake.seed.settle({ at: now - 20 * HOUR, wallet: { [me]: 240, ...Object.fromEntries(accounts.slice(1).map((o) => [o, 180])) }, standings: Object.fromEntries(Object.values(cast).map((c, i) => [c, 60 + 25 * i])) });
  /*
   * The hands. The first player's holds one of every card in the game, for the hand shot, and two Rope Breaks so that setting one leaves
   * the hand whole. The second player's is small, so the commentary's node 3 finds its Whoops! at a glance, and holds the two cards its
   * masks set face down (a set spends the card).
   */
  fake.seed.cards(me, { ...Object.fromEntries(instance.cards.map((c) => [c.key, 1])), 'rope-break': 2 });
  fake.seed.cards(second, { whoops: 1, '4d-chess': 1, 'steel-chair': 1, 'hot-box': 1, 'laugh-track': 1, 'glitter-bomb': 1 });
  fake.seed.views(thread, 14);
  /*
   * The Staff (the storyboard's section 6). Every word a staff character says here is one it wrote in the second season rehearsal
   * (tools/hype/staff-lines.mjs takes them from the logs whole: staff-lines.json), with the rehearsal's posters renamed for this cast;
   * the players' posts around them are written for the video. FanGaME is the Boss, and QC-1000 the Mod he names after him.
   */
  const fangame = fake.seed.staff('fangame', 'FanGaME', 'boss', { title: 'Boss, Mario Fangame Expert, Level Designer (self-appointed)', signature: '[i]Demo releasing soon. Per my documentation, it is ninety percent done.[/i]', at: now - 60 * 24 * HOUR });
  fake.seed.avatar(fangame, { square: fangameSquare, portrait: fangamePortrait });
  const qc = fake.seed.staff('quality-control', 'QC-1000', 'mod', { title: 'Mod Bot: Submissions Desk', at: now - 60 * 24 * HOUR });
  const argued = fake.seed.thread('general', who('Serious Deer'), 'is a fangame a video game', 'I say it is a mod. A mod is not a game. I have a list.', { at: now - 30 * HOUR });
  fake.seed.post(argued.thread, who('D-Guy'), 'It has a title screen. Games have title screens. Next question.', { at: now - 29.6 * HOUR });
  fake.seed.post(argued.thread, who('Serious Deer'), 'A DVD menu has a title screen.', { at: now - 29.3 * HOUR });
  fake.seed.post(argued.thread, who('Chadluminum'), 'I think you are both right and I am proud of this thread.', { at: now - 29 * HOUR });
  fake.seed.staffPost(fangame, argued.thread, LINES.memo.text, { at: now - 28 * HOUR });
  fake.seed.staffPost(qc, argued.thread, LINES.declined.text, { at: now - 27 * HOUR });
  fake.seed.staffPost(mod, argued.thread, LINES.stars.text, { at: now - 26 * HOUR });
  const goodbye = fake.seed.thread('general', who('Snuckles'), 'so is the season over', 'Somebody said the Boss is leaving tonight. Does my sprite sheet still count?', { at: now - 4 * HOUR });
  fake.seed.staffPost(fangame, goodbye.thread, LINES.farewell.text, { at: now - 3.5 * HOUR });
  fake.seed.staffPost(qc, goodbye.thread, LINES.arrival.text, { at: now - 3.2 * HOUR });
  /* The Boss's moves, each with the reason he gave for it: two boards made, and the two merged when nobody came to his. */
  const palace = { name: 'Plumber Platformer Palace', premise: 'Mario fangames.', description: 'A board for Mario fangames.' };
  const minus = { name: 'World -1', premise: 'Everything else.', description: 'Everything that is not a Mario fangame.' };
  fake.seed.move('fangame', { board: '', name: '', body: LINES.created.text, at: now - 6 * 24 * HOUR, lasting: { kind: 'createBoard', params: palace } });
  fake.seed.move('fangame', { board: '', name: '', body: LINES.created.text, at: now - 6 * 24 * HOUR + 1000, lasting: { kind: 'createBoard', params: minus } });
  /*
   * The Boss's profile, filled in for the trailer (the owner, 2026-11-14: "a trailer is a good opportunity to exaggerate"): what he says of
   * himself, the season he leads, and a longer record of moves than the rehearsal gave him. These are written for the video, in his voice.
   */
  fake.seed.staffProfile('fangame', {
    interests: ['Mario fangames', 'Mario fangame demos', 'my own Mario fangame (releasing soon)', 'level design', 'memos', 'circling back', 'pipes (vertical)', 'pipes (horizontal, in theory)'],
    favorites: [who('Snuckles'), qc],
    mood: 'Fine. (I am fine.)',
    signature: 'Demo releasing soon. Per my documentation, it is ninety percent done.',
    at: now - HOUR,
  });
  fake.seed.career('fangame', { led: [{ season: 1, since: new Date(now - 30 * 24 * HOUR).toISOString(), until: null, how: 'seed' }], offices: [] });
  const ended = (name: string, days: number, why: 'met' | 'expired' | 'reversed', by: string) => {
    const move = fake.seed.move('fangame', { board: 'general', name, at: now - days * 24 * HOUR, expiresAt: now - (days - 3) * 24 * HOUR });
    fake.seed.endMove(move, { why, by, at: now - (days - 2) * 24 * HOUR });
  };
  ended('Mario Fangame General', 27, 'reversed', 'admin');
  ended('World 1-1 Appreciation Station', 23, 'expired', 'tick');
  ended('Mandatory Level Design Feedback Circle', 19, 'met', 'tick');
  ended('Demo Release Countdown Lounge', 15, 'expired', 'tick');
  ended('Pipe Maintenance (Do Not Enter)', 11, 'reversed', 'admin');
  ended('Demo Release Countdown Lounge II', 8, 'expired', 'tick');
  /* The slugs of the boards the merge is of: stage-play.ts makes them when the Boss merges them, so the index of round 1's shots is as it was. */
  const boards = { palace: 'plumber-platformer-palace', minus: 'world-minus-1' };

  /* Whose player is signed in, and which of their characters the HUD plays as. */
  const played = options.as ?? 'Snuckles';
  const viewer = owner[played];
  if (viewer === undefined) throw new Error(`the stage has no character named "${options.as}": the cast is ${Object.keys(owner).join(', ')}`);
  /* Brighter Effects is on (the owner, 2026-11-14): the film is of the effects. */
  const preferences = async () => {
    fake.signInAs(viewer);
    await fake.setPreferences({ theme: options.skin, motion: 'full', effects: 'bright' });
    await fake.skipTips();
    /* The film's player has met every card, as a player meets one (a card is met by its own call, not as a preference): no first-time tip opens over a shot. */
    for (const c of instance.cards) await fake.meetCard(c.key);
  };
  fake.signInAs(viewer);
  try { globalThis.localStorage?.setItem(hudKey(viewer), cast[played]!); } catch { /* a private window keeps nothing; the HUD plays its first character */ }

  /*
   * What is set face down, and the wall drawn, each as the player it is: the backend's own `setCard` and `draw`, so a back keeps the card
   * it catches, the quadrant it pays on and the phrase it waits for. Each is its player's alone, so the session is theirs for the call and
   * the film's player's again after.
   */
  const forecast = installForecast(fake, instance, thread);
  const sets: Record<string, string> = {};
  /** One call as `account`: the session is theirs while it is made, and the film's player's at once (the backend runs a call's body as it is made). */
  const as = <T,>(account: string, call: () => Promise<T>): Promise<T> => {
    fake.signInAs(account);
    try { return call(); } finally { fake.signInAs(viewer); }
  };
  /*
   * The page is told of the film's player's session and no other's: a part that signs in as another player for one call (stage-play.ts) would
   * otherwise have the player's provider read that player's screens, which empties the page for a moment and loses the reader's place.
   */
  const heard = fake.onSession.bind(fake);
  fake.onSession = (listener) => heard((s) => { if (s.account === null || s.account === viewer) listener(s); });
  const setOf = async (key: string, account: string, card: string, character: string, post: string, config: Record<string, unknown>, when?: { says?: string }) => {
    const done = await as(account, () => fake.setCard(card, character, post, config, when));
    if (!done.ok) throw new Error(`the stage's ${key} was refused: ${done.error}`);
    sets[key] = done.value.id;
  };
  const ready = (async () => {
    await preferences();
    await forecast.rest();
    await setOf('ropeBreak', me, 'rope-break', who('Snuckles'), first, {});
    await setOf('fourDChess', second, '4d-chess', who('D-Guy'), dguy, { card: 'whoops', quadrant: 'excitedNegative' });
    await setOf('steelChair', second, 'steel-chair', who('Chadluminum'), kindWords, {}, { says: 'to be fair' });
    for (const wall of walls) {
      const drawn = await as(owner[wall.by]!, () => fake.draw(wall.play, who(wall.by), { strokes: [
        { can: 'pink', cap: 'fat', aspect: 3, points: wave(0.3, 0.04, 0.9, 0.08) },
        { can: 'lime', cap: 'fat', aspect: 3, points: wave(0.6, 0.1, 0.95, 0.12) },
        { can: 'orange', cap: 'stock', aspect: 3, points: wave(0.82, 0.05, 0.7, 0.06) },
      ] }));
      if (!drawn.ok) throw new Error(`the stage's wall was refused: ${drawn.error}`);
    }
  })();
  const made: Made = {
    thread, target: { act: target, seq: 4, character: who('Snuckles') }, cast, me, scenes,
    threads: { main: thread, argued: argued.thread, goodbye: goodbye.thread }, staff: { fangame, qc, ontopic: mod },
    owners: { ...owner }, viewer, played,
    posts: { first: 1, kind: 2, review: 14, hotBox: 15, glitter: 16, fab: 17, graffiti: 18, autocorrect: 19 },
    acts: { first, kind: kindWords, review: dguy, hotBox: dressedActs[0]!, glitter: dressedActs[1]!, fab: dressedActs[2]!, graffiti: dressedActs[3]!, autocorrect: dressedActs[4]! },
    sets, crowd: CROWD, boards, ready,
  };
  /* The story opens on the thread: its address is known only once it is seeded, so the seed sets it (the preview's `path` is fixed text). */
  const [view, of = ''] = options.view.split(':');
  const shown = view === 'thread' ? made.threads[of || 'main'] : undefined;
  if (view === 'thread' && shown === undefined) throw new Error(`the stage has no thread "${of}": its threads are ${Object.keys(made.threads).join(', ')}`);
  globalThis.history.replaceState(null, '', view === 'index' ? '/' : view === 'profile' ? `/c/${made.staff[of] ?? cast[of]}` : `/t/${shown}`);
  return made;
}
