/**
 * The stage's world (docs/plans/2026-11-14-hype-video-storyboard.md; docs/plans/2026-11-21-commentary-video-plan.md, Task 4): the made-up
 * forum a hype-video shot is filmed on, seeded on the in-memory backend. Stage.board.stories.tsx draws it; Stage.test.tsx seeds it and
 * holds it to what the shots rely on. A story of its own (its address dresses it: `skin=`, `as=`, `view=`, `sheet=`) is the only thing
 * that draws it, so no screen, rule or payload of the app is added.
 *
 * The cast is the Front Door's (instances/divided-world/ui/front-door.ts), less Human Josh, who is not in the video (the owner, 2026-11-22), and
 * plus Hotel Bro, a character of the stage's own with the owner's pixel art (hotel-bro.png) for a face. Four players are behind them: the
 * film's first is Snuckles and D-Guy (D-Guy took Human Josh's place and voice); Chadluminum is the second's alone, a Face; Serious Deer is a
 * third's; Hotel Bro, the Heel, is a fourth's. A crowd of made-up characters, one player each, is the audience: they react, they wrote the
 * four kind posts under Chadluminum's and the dressed posts after Hotel Bro's, each wearing live effects.
 *
 * The thread reads in the order the film scrolls it (`Made.posts`): the sheet, Chadluminum, four kind posts, Hotel Bro's insult, the dressed posts,
 * and the rest. The first page is the first twenty; the five leaving posts (stage-play.ts, `leave`) land after the twenty-fifth, on page 2.
 *
 * What is set face down before a camera runs is set through the backend's own `setCard`, as its owner (the seed's `set` keeps no catch,
 * no quadrant and no phrase, so a Rope Break so set would catch nothing): Rope Break on Snuckles's first post, 4D Chess on Hotel Bro's insult
 * naming Whoops! and the Heat quadrant, and a Steel Chair on Chadluminum's post, waiting for "to be fair". `Made.ready` settles when
 * that, and the drawing of Graffiti's wall, is done; the story draws nothing before it.
 */
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import type { Instance } from '../../../../engine/rules/types.ts';
import { hudKey } from '../../../../engine/ui/player.tsx';
import { cardOf } from '../../../../engine/ui/story.tsx';
import fangamePortrait from '../avatars/fangame-portrait.webp?url';
import fangameSquare from '../avatars/fangame-square.webp?url';
import hotelBroPortrait from './hotel-bro-portrait.png?url';
import hotelBroSquare from './hotel-bro.png?url';
import { frontDoor } from '../front-door.ts';
import LINES from './staff-lines.json';
import { GPT2_POST } from './gpt2.ts';
import { tags } from './graffiti-shapes.ts';
import { installForecast } from './forecast.ts';

const HOUR = 3_600_000;

/** The phrase the Steel Chair on Chadluminum's post waits for: a post that quotes it and says this springs the chair. */
export const CHAIR_PHRASE = 'to be fair';

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
  /** The cast by the Front Door's names, and the crowd by theirs: each name's character. */
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
  /** The boards the Staff's lines name (Help, Movies & TV, ...), by the name the Mods say, each its slug: they are on the stage's index, so a line about the premise of Help sits on a board called Help. */
  readonly lineBoards: Readonly<Record<string, string>>;
  /** Settles when what is set face down, and the wall that is drawn, is done: a story draws nothing before. */
  readonly ready: Promise<void>;
}

/** Who is not on the stage: the Front Door's cast has Human Josh, and the video does not. */
const LEFT = ['Human Josh'];

/** The Heel, a character of the stage's own: his face is the owner's pixel art, and his player's hand holds the Whoops! he plays. */
export const HEEL = { name: 'Hotel Bro', class: 'heel', square: hotelBroSquare, portrait: hotelBroPortrait } as const;

/** What each character says as they leave (the owner's words, 2026-11-22), in the order the film posts them. */
export const LEAVING: Readonly<Record<string, string>> = {
  Snuckles: "That's it! I'll kindly take my Wigglers elsewhere!!!",
  'Hotel Bro': "I can't wait to fuggetabout you clowns, capiche?",
  'Serious Deer': "I didn't do anything but ok.",
  'D-Guy': "that's all, folks \u{1F62C}",
  Chadluminum: "I've really tried for a long time, but I just don't think this is going to work. See you all around.",
};

/** The crowd: the audience of the sprite sheet thread, and the authors of the five dressed posts at its foot. One player each. */
export const CROWD = ['Ringside', 'Front Row', 'Nosebleeds', 'Aisle Seat', 'Back Row', 'Concessions'] as const;

/**
 * The boards the Staff's lines name, by the name the Mods say them: the stage makes each, so the Mod's opener "suspects the premise of Help"
 * on a post that is on a board called Help (the instance's own boards are General and Staff Announcements alone).
 */
export const LINE_BOARDS: Readonly<Record<string, { readonly slug: string; readonly description: string }>> = {
  Help: { slug: 'help', description: 'Stuck? Ask. This board is for asking.' },
  'Movies & TV': { slug: 'movies-tv', description: 'What you watched, what you are watching, and what you wish you had not.' },
  'Video Games': { slug: 'video-games', description: 'What you are playing.' },
  'Arts & Crafts': { slug: 'arts-and-crafts', description: 'Show your work.' },
  'Pointless Post Palace': { slug: 'pointless-post-palace', description: 'Posts with no point. Nonsense on a board that asks for nonsense.' },
};

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
  const fourth = fake.seed.account('hype-c', { seasoned: true });
  /* The Front Door's cast, each with its class and its face. Snuckles and D-Guy are the film's first player's; Chadluminum the second's alone. */
  const owner: Record<string, string> = { Snuckles: me, 'D-Guy': me, Chadluminum: second, 'Serious Deer': third, [HEEL.name]: fourth };
  const cast: Record<string, string> = {};
  frontDoor.cast.filter((c) => !LEFT.includes(c.name)).forEach((c, i) => {
    const id = fake.seed.character(owner[c.name]!, c.name, c.revealed?.class ?? instance.classes[0]!.key, { at: now - (29 * 24 - i) * HOUR });
    fake.seed.avatar(id, { square: c.avatarSquare, portrait: c.avatarPortrait });
    cast[c.name] = id;
  });
  cast[HEEL.name] = fake.seed.character(fourth, HEEL.name, HEEL.class, { at: now - 25 * 24 * HOUR });
  fake.seed.avatar(cast[HEEL.name]!, { square: HEEL.square, portrait: HEEL.portrait });
  const who = (name: string) => cast[name]!;
  /* The crowd, one player each: the first is the reader who has no character in the thread but Ringside, the one Stick Around holds. */
  const crowdAccounts: string[] = [];
  for (const [i, name] of CROWD.entries()) {
    const account = fake.seed.account(i === 0 ? 'hype-reader' : `hype-crowd-${i}`, { seasoned: true });
    crowdAccounts.push(account);
    owner[name] = account;
    cast[name] = fake.seed.character(account, name, instance.classes[0]!.key, { at: now - (20 - i) * 24 * HOUR });
  }
  for (const [name, b] of Object.entries(LINE_BOARDS)) fake.seed.board(b.slug, name, b.description);
  const t0 = now - 5 * HOUR;
  /*
   * The thread is seeded in the order the film scrolls it, so a slow scroll down from the top tells the story: the sheet, Chadluminum's
   * line, four kind words from the crowd (dressed in rainbows, positive reactions and Sweet cards), Hotel Bro's insult, then the posts
   * the effects are filmed on. A post's number is its place in this order (`posts` and `scenes`, at the foot of this function).
   */
  const { thread, act: first } = fake.seed.thread('general', who('Snuckles'), 'my first sprite sheet (please be normal)',
    `Hi divided world, it's ya boy Snuckles here with my first ever sprite sheet. He's an original character I invented after I saw him in a Mario game.\n\n${options.sheet ? '[img]https://dw.gripe/hype/wiggler-sheet.gif[/img]\n\n' : ''}When he walks his legs move.`, { at: t0 });
  const chadWords = fake.seed.post(thread, who('Chadluminum'), 'Some go their whole lives wondering. Only a few among us truly achieve the greatness of making a Sprite Sheet', { at: t0 + 0.4 * HOUR });
  /*
   * The kind stretch (the owner: "fab rainbows, positive reactions, sweets etc."). Each word is a crowd character's. Feelin' Fab is on two of
   * the four, stacked twice on the third; the tallies are positive only (who reacted is nobody's to see, so a count is all a seed holds);
   * Hype-Up is cast by another character, and Required Reading is the author's own on their own post (a Gimmick, `play: 'use'`).
   * Stage.test.tsx replays each card through its own `canApply`.
   */
  const kind = [
    { by: 'Concessions', text: 'Good job! Looks cool', tally: { fire: 4, heart: 2 }, plays: [{ by: 'Back Row', card: 'feelin-fab' }] },
    { by: 'Back Row', text: 'not too shabby', tally: { 'thumbs-up': 5, 'light-bulb': 2 }, plays: [{ by: 'Ringside', card: 'hype-up' }] },
    { by: 'Aisle Seat', text: "I'll use it in my game!", tally: { heart: 3, 'hundred-points': 3, fire: 1 }, plays: [{ by: 'Nosebleeds', card: 'feelin-fab' }, { by: 'Ringside', card: 'feelin-fab' }] },
    { by: 'Front Row', text: 'The walk looks like it was hard to make \u{1F4AA}', tally: { 'hundred-points': 2, 'thumbs-up': 3, 'light-bulb': 1, fire: 2 }, plays: [{ by: 'Front Row', card: 'required-reading' }] },
  ] as const;
  const kindActs = kind.map((k, i) => fake.seed.post(thread, who(k.by), k.text, { at: t0 + (0.5 + 0.1 * i) * HOUR }));
  kind.forEach((k, i) => {
    fake.seed.tally(kindActs[i]!, k.tally);
    k.plays.forEach((p, layer) => {
      const stacked = k.plays.slice(0, layer).filter((q) => q.card === p.card).length + 1;
      fake.seed.card(who(p.by), kindActs[i]!, p.card, { layer: stacked, config: {}, message: '', ...(lasts(p.card) ? { ends } : {}) });
    });
  });
  const heel = fake.seed.post(thread, who(HEEL.name),
    'OF COURSE YOUR SPRITES LOOK LIKE THIS WITH THOSE STEAMBOAT WILLIE ASS FINGERS', { at: t0 + 0.9 * HOUR });
  const dressed = [
    { by: 'Front Row', card: 'hot-box', text: 'ok i am just going to say it: this wiggler is making me wiggle in all kinds of ways \u{1F440}', config: { color: '#9370db' }, caster: 'Aisle Seat' },
    { by: 'Nosebleeds', card: 'glitter-bomb', text: 'this thread is the only reason i logged in today. 10/10 would refresh again.', config: {}, caster: 'Chadluminum' },
    { by: 'Aisle Seat', card: 'feelin-fab', text: 'snuckles you are a legend and i will not be taking questions.', config: {}, caster: 'Chadluminum' },
    { by: 'Back Row', card: 'graffiti', text: 'magenta forever. magenta or nothing.', config: {}, caster: 'Front Row' },
    { by: 'Concessions', card: 'autocorrect', text: 'we are all very supportive of this sprite sheet and its twelve frames.', config: { phrase: 'very supportive', replacement: 'deeply concerned' }, caster: 'Back Row' },
  ] as const;
  const dressedActs = dressed.map((d, i) => fake.seed.post(thread, who(d.by), d.text, { at: t0 + (1 + 0.07 * i) * HOUR }));
  /* The post You Were Saying? ran on with in the owner's test instance, word for word (gpt2-tail.txt): the film types the card's real tail under it. */
  const gpt2Act = fake.seed.post(thread, who('D-Guy'), GPT2_POST, { at: t0 + 1.4 * HOUR });
  /*
   * Serious Deer's post, folded by a live Below the Fold that Back Row played (a character of another player than its author's, as a player's play is): the folded bar shows to a reader as
   * the one bar, and a press on it opens the words.
   */
  const foldAct = fake.seed.post(thread, who('Serious Deer'), "I've analyzed this sprite sheet's pixels and come to the unfortunate conclusion that it was created using generative AI.", { at: t0 + 1.5 * HOUR });
  fake.seed.card(who('Back Row'), foldAct, 'below-the-fold', { layer: 1, config: {}, message: '', ...(lasts('below-the-fold') ? { ends } : {}) });
  const target = fake.seed.post(thread, who('Snuckles'),
    'Updated the sheet. The Wiggler blinks now, and I think the blink is really working.\n\nI also fixed frame six. Ten colors. You can count them.\n\nThank you all for being so normal about this.', { at: t0 + 1.6 * HOUR });
  /*
   * The montage's posts, each the stage for one card (tools/hype/shot-montage.mjs lands the cards that land on camera): a kind word for
   * Autocorrect to rewrite, a review for Stick Around to hold a reader on (the shot lands the card: a hold in the thread would take every other shot's reader too), a joke for a Laugh Track, an appeal
   * for Jimmy Wails, and a post a Mod Bot has been to, with the warning it left. The rest of the old thread (the deer's recount, the friends' line and three
   * fillers) is on page 2, after these.
   */
  const day = t0 + 1.7 * HOUR;
  fake.seed.post(thread, who('Chadluminum'), 'I think Snuckles is a genuine talent and this sprite sheet is beautiful.\n\nI mean that sincerely.', { at: day });
  fake.seed.post(thread, who(HEEL.name), 'My full review of the sprite sheet, in nine parts. Part one: the walk. Part two: also the walk. Nobody leaves until part nine.', { at: day + 0.2 * HOUR });
  const joke = fake.seed.post(thread, who('D-Guy'), 'A sprite walks into a bar. The bartender says, "why the long frame?"\n\nAs a human, I laughed at this with my mouth.', { at: day + 0.4 * HOUR });
  fake.seed.card(who(HEEL.name), joke, 'laugh-track', { layer: 1, message: 'Laugh Track', config: { cues: [{ phrase: 'why the long frame?', sound: 'laugh' }, { phrase: 'As a human', sound: 'boo' }], seed: 7 }, at: day + 0.45 * HOUR });
  const appeal = fake.seed.post(thread, who('Snuckles'), 'I have spent two weeks on this walk cycle, and I am told that is "a lot for twelve frames". Here it is, and I hope somebody likes it.', { at: day + 0.6 * HOUR });
  /* A donation is not given to a drive its own player cast (the gift's button stays off): Serious Deer plays the appeal. */
  fake.seed.card(who('Serious Deer'), appeal, 'jimmy-wails', { layer: 1, message: 'Please. He spent two weeks on twelve frames.', drawn: 'blue-shirt', at: day + 0.65 * HOUR });
  const filed = fake.seed.post(thread, who('Snuckles'), 'Is this the right board for sprite sheets? I looked for a sprite board and there was not one.', { at: day + 0.8 * HOUR });
  const mod = fake.seed.staff('ontopic', 'ONTOPIC 5.0', 'mod');
  /* Real words, both: the opener and the filing are lines ONTOPIC 5.0 wrote in the rehearsal (staff-lines.json), the opener the first arc's day one's (it names Movies & TV, and this post is on General: the filmed visits are on a board of the line's own, `staff.visit`). */
  const visit = fake.seed.visit(mod, filed, { at: day + 0.9 * HOUR, endsInMs: HOUR, line: LINES.openerOtLooking.text });
  fake.seed.visitEnd(visit, { outcome: 'filed', line: LINES.filingOtPatience.text, at: day + HOUR });
  fake.seed.infraction(visit, { points: 6, at: day + HOUR });
  /* Page 2, before the leaving posts: the deer's recount; a post whose one use is off camera (the title cards' strip of tape is a real Autocorrect, landed on this post's "friends" and copied from it, tools/hype/shot-cards.mjs); and the thread's old fillers, by the new cast. */
  fake.seed.post(thread, who('Serious Deer'), 'I have recounted. It is ten colors.\n\nI withdraw my note, and I apologize to the palette.', { at: day + 1.1 * HOUR });
  fake.seed.post(thread, who('Chadluminum'), 'We are all friends here.', { at: day + 1.2 * HOUR });
  fake.seed.post(thread, who('Serious Deer'), 'Frame six of the walk has eleven colors. The palette you posted has ten.\n\nI am not upset. I am noting it.', { at: day + 1.3 * HOUR });
  fake.seed.post(thread, who(HEEL.name), 'Magenta is a very popular color. Half this board would pick magenta. I would pick something classier, personally, if I were the kind of person who did that, which I\'m not.', { at: day + 1.4 * HOUR });
  fake.seed.post(thread, who('D-Guy'), 'As a human, I also enjoy blinking.', { at: day + 1.5 * HOUR });
  const scenes = { kind: 16, review: 17, joke: 18, appeal: 19, filed: 20, recount: 21, friends: 22 };
  /* Graffiti's wall is drawn by the caster, as a player; that is a call the backend answers after this seed returns, so it is in `ready`. */
  const walls: { play: string; by: string }[] = [];
  dressed.forEach((d, i) => {
    const act = dressedActs[i]!;
    if (d.card === 'glitter-bomb') {
      fake.seed.reach(who(d.caster), 'character', who(d.by), 'glitter-bomb', { post: act, ends: now + 5 * 24 * HOUR, message: 'You earned this.' });
      return;
    }
    /* An Autocorrect's author may not peel it for 24 hours (`autocorrect.holdHours`): this one was played more than a day ago, so the film's author of the post peels it (tools/hype/shot-closeups.mjs, b-autocorrect-peel). */
    const play = fake.seed.card(who(d.caster), act, d.card, { layer: 1, config: d.config, message: '', ...(lasts(d.card) ? { ends } : {}), ...(d.card === 'autocorrect' ? { at: now - 26 * HOUR } : {}) });
    if (d.card === 'graffiti') walls.push({ play, by: d.caster });
  });

  fake.seed.tally(first, { fire: 3, 'thumbs-up': 5 });
  fake.seed.tally(target, { fire: 4, 'thumbs-up': 2 });
  const accounts = [me, second, third, fourth, ...crowdAccounts];
  fake.seed.settle({ at: now - 20 * HOUR, wallet: { [me]: 240, ...Object.fromEntries(accounts.slice(1).map((o) => [o, 180])) }, standings: Object.fromEntries(Object.values(cast).map((c, i) => [c, 60 + 25 * i])) });
  /*
   * The hands. The first player's holds one of every card in the game, for the hand shot, and two Rope Breaks so that setting one leaves
   * the hand whole. Hotel Bro's player's is small, so a Whoops! is found at a glance, and holds the 4D Chess he sets face down (a set spends
   * the card). Chadluminum's player holds the Steel Chair he sets, and the rest the crowd's casts name.
   */
  fake.seed.cards(me, { ...Object.fromEntries(instance.cards.map((c) => [c.key, 1])), 'rope-break': 2 });
  fake.seed.cards(fourth, { whoops: 2, '4d-chess': 1, 'laugh-track': 1 });
  fake.seed.cards(second, { 'steel-chair': 1, 'hot-box': 1, 'glitter-bomb': 1 });
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
  fake.seed.post(argued.thread, who(HEEL.name), 'It has a title screen. Games have title screens. Next question.', { at: now - 29.6 * HOUR });
  fake.seed.post(argued.thread, who('Serious Deer'), 'A DVD menu has a title screen.', { at: now - 29.3 * HOUR });
  fake.seed.post(argued.thread, who('Chadluminum'), 'I think you are both right and I am proud of this thread.', { at: now - 29 * HOUR });
  fake.seed.staffPost(fangame, argued.thread, LINES.memo.text, { at: now - 28 * HOUR });
  fake.seed.staffPost(qc, argued.thread, LINES.declined.text, { at: now - 27 * HOUR });
  fake.seed.staffPost(mod, argued.thread, LINES.stars.text, { at: now - 26 * HOUR });
  const goodbye = fake.seed.thread('general', who('Snuckles'), 'so is the season over', 'Somebody said the Boss is leaving tonight. Does my sprite sheet still count?', { at: now - 4 * HOUR });
  fake.seed.staffPost(fangame, goodbye.thread, LINES.posted.text, { at: now - 3.5 * HOUR });
  fake.seed.staffPost(qc, goodbye.thread, LINES.followup.text, { at: now - 3.2 * HOUR });
  /*
   * The Boss's moves: two boards made, long ago, with no reason on their notices. The reason the rehearsal gave ("The board is arguing whether a fangame is a video game. World -1
   * settles it ...") is for a board made while the camera runs (`staff.created()`), and it was seeded twice, once on each board, which made a take of the announcements show the
   * same words three times (docs/plans/2026-11-21-commentary-video-revision-plan.md, Task R7: "two identical Created a board posts").
   */
  const palace = { name: 'Plumber Platformer Palace', premise: 'Mario fangames.', description: 'A board for Mario fangames.' };
  const minus = { name: 'World -1', premise: 'Everything else.', description: 'Everything that is not a Mario fangame.' };
  fake.seed.move('fangame', { board: '', name: '', body: '', at: now - 6 * 24 * HOUR, lasting: { kind: 'createBoard', params: palace } });
  fake.seed.move('fangame', { board: '', name: '', body: '', at: now - 6 * 24 * HOUR + 1000, lasting: { kind: 'createBoard', params: minus } });
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
    await setOf('fourDChess', fourth, '4d-chess', who(HEEL.name), heel, { card: 'whoops', quadrant: 'excitedNegative' });
    await setOf('steelChair', second, 'steel-chair', who('Chadluminum'), chadWords, {}, { says: CHAIR_PHRASE });
    for (const wall of walls) {
      /* One draw to a shape, as a player's hand draws one: a word, an underline, an arrow, a face, a heart and a scribble-out (graffiti-shapes.ts). */
      for (const shape of tags()) {
        const drawn = await as(owner[wall.by]!, () => fake.draw(wall.play, who(wall.by), { strokes: shape.strokes.map((s) => ({ ...s })) }));
        if (!drawn.ok) throw new Error(`the stage's wall (${shape.kind}) was refused: ${drawn.error}`);
      }
    }
  })();
  const made: Made = {
    thread, target: { act: target, seq: 15, character: who('Snuckles') }, cast, me, scenes,
    threads: { main: thread, argued: argued.thread, goodbye: goodbye.thread }, staff: { fangame, qc, ontopic: mod },
    owners: { ...owner }, viewer, played,
    /* The commentary's posts, by key: the film's slow scroll in order (the sheet, Chadluminum, four kind words, Hotel Bro's insult, the dressed posts). Page 1 holds the first twenty. */
    posts: { first: 1, chad: 2, kind1: 3, kind2: 4, kind3: 5, kind4: 6, heel: 7, hotBox: 8, glitter: 9, fab: 10, graffiti: 11, autocorrect: 12, gpt2: 13, fold: 14 },
    acts: { first, chad: chadWords, kind1: kindActs[0]!, kind2: kindActs[1]!, kind3: kindActs[2]!, kind4: kindActs[3]!, heel, hotBox: dressedActs[0]!, glitter: dressedActs[1]!, fab: dressedActs[2]!, graffiti: dressedActs[3]!, autocorrect: dressedActs[4]!, gpt2: gpt2Act, fold: foldAct },
    sets, crowd: CROWD, boards, lineBoards: Object.fromEntries(Object.entries(LINE_BOARDS).map(([name, b]) => [name, b.slug])), ready,
  };
  /* The story opens on the thread: its address is known only once it is seeded, so the seed sets it (the preview's `path` is fixed text). */
  const [view, of = ''] = options.view.split(':');
  const shown = view === 'thread' ? made.threads[of || 'main'] : undefined;
  if (view === 'thread' && shown === undefined) throw new Error(`the stage has no thread "${of}": its threads are ${Object.keys(made.threads).join(', ')}`);
  globalThis.history.replaceState(null, '', view === 'index' ? '/' : view === 'profile' ? `/c/${made.staff[of] ?? cast[of]}` : `/t/${shown}`);
  return made;
}
