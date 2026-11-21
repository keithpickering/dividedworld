/**
 * The stage a hype-video shot is filmed on (tools/hype/; docs/plans/2026-11-14-hype-video-storyboard.md): a small world of its own on the
 * fake, drawn as the app draws it, with the fake handed to the page as `window.__kbStage`, so a shot script can play the parts of the
 * other players while the camera runs (land a Whoops! on the post, wash a coat as its author) the way the other board stories hand their
 * probes over. Only the end-to-end build's story route and Storybook draw it; the app exposes nothing.
 *
 * The cast is the Front Door's (instances/divided-world/ui/front-door.ts): the same five made-up names, classes and avatars a visitor
 * meets before signing in, so the video's people are the ones the door already introduced. The film's player is behind Snuckles and
 * Human Josh; the other three are other players'. The thread is written for the video: a sincere post about a sprite sheet, and what a
 * board does to one. The sheet is the owner's own (wiggler-sheet.gif, his first submission, from 2005), named in the post by an https
 * address the camera answers (tools/hype/stage.mjs), since a post shows a picture from nowhere else.
 *
 * The address dresses the stage: `skin=<theme key>` is the forum skin, as the player's own preference (`default` when absent), and
 * `as=<a character's name>` signs in that character's player in place of Snuckles's, and `view=` picks the screen (`VIEW`). Tips are off and motion is full, always: the
 * film's player has met every card, and the film is of the motion.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { applyAppearance } from '../../../../engine/ui/appearance.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';
import type { World } from '../../../../engine/ui/story.tsx';
import { packStroke } from '../../cards/whoops/points.ts';
import { BRUSH_PX, brushOf } from '../../cards/whoops/scrub.ts';
import fangamePortrait from '../avatars/fangame-portrait.webp?url';
import fangameSquare from '../avatars/fangame-square.webp?url';
import { frontDoor } from '../front-door.ts';
import LINES from './staff-lines.json';
import { LoadedIndex, LoadedProfile } from '../../../../engine/ui/loaded.tsx';

/** What the world's seed made, for the page and the shot scripts: the thread, the post the gag is played on, and who is who. */
interface Made {
  readonly thread: string;
  /** The post the ink lands on: its Act, its number in the thread, and its author. */
  readonly target: { readonly act: string; readonly seq: number; readonly character: string };
  /** The cast by the Front Door's names. */
  readonly cast: Readonly<Record<string, string>>;
  readonly me: string;
  /** The montage's posts, by what each is for: its number in the thread. */
  readonly scenes: Readonly<Record<string, number>>;
  /** The Staff's threads (the argument the Boss walks into, and his farewell) and the staff themselves, by key. */
  readonly threads: Readonly<Record<string, string>>;
  readonly staff: Readonly<Record<string, string>>;
}
interface Stage extends Made { readonly fake: Fake; readonly whoops: { readonly packStroke: typeof packStroke; readonly brushOf: typeof brushOf; readonly BRUSH_PX: number } }
declare global { interface Window { __kbStage?: Stage } }

let made: Made | null = null;

const HOUR = 3_600_000;
const ASKED = new URLSearchParams(globalThis.location?.search ?? '');
const SKIN = ASKED.get('skin') ?? 'default';
/** Which screen the stage shows: `thread` (the sprite sheet thread), `thread:<key>` (another of its threads), `index`, or `profile:<a staff key or a character's name>`. */
const VIEW = ASKED.get('view') ?? 'thread';
/**
 * Whether Snuckles's first post shows its sprite sheet. Only a film asks for it (`sheet=1`): the picture's address is answered by the
 * camera and by nothing else, so a story opened without one (Storybook, the accessibility sweeps) names no address it would have to fetch.
 */
const SHEET = ASKED.get('sheet') === '1';
/** Whose player the film's is, by a character's name: the cold open is watched by someone who is not the post's author, since a player cannot react to their own post. */
const AS = ASKED.get('as');

const world: World = (fake, instance) => {
  const now = Date.now();
  fake.seed.season({ number: 1, startsAt: new Date(now - 30 * 24 * HOUR).toISOString() });
  const me = fake.seed.account('hype-player', { seasoned: true });
  const others = ['hype-a', 'hype-b', 'hype-c'].map((n) => fake.seed.account(n, { seasoned: true }));
  /* The Front Door's cast, each with its class and its face. Snuckles and Human Josh are the player's masks. */
  const owner: Record<string, string> = { Snuckles: me, 'Human Josh': me, Chadluminum: others[0]!, 'Serious Deer': others[1]!, 'D-Guy': others[2]! };
  const cast: Record<string, string> = {};
  frontDoor.cast.forEach((c, i) => {
    const id = fake.seed.character(owner[c.name]!, c.name, c.revealed?.class ?? instance.classes[0]!.key, { at: now - (29 * 24 - i) * HOUR });
    fake.seed.avatar(id, { square: c.avatarSquare, portrait: c.avatarPortrait });
    cast[c.name] = id;
  });
  const who = (name: string) => cast[name]!;
  const t0 = now - 5 * HOUR;
  const { thread, act: first } = fake.seed.thread('general', who('Snuckles'), 'my first sprite sheet (please be normal)',
    `Posting my first sprite sheet: a Wiggler. Twelve frames of walking, and parts to build yer own.\n\n${SHEET ? '[img]https://dw.gripe/hype/wiggler-sheet.gif[/img]\n\n' : ''}I spent two weeks on the walk. Please be normal about this.`, { at: t0 });
  fake.seed.post(thread, who('Chadluminum'), 'This is wonderful and you should be proud. The walk has real warmth.', { at: t0 + 0.4 * HOUR });
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
  fake.seed.card(who('D-Guy'), appeal, 'jimmy-wails', { layer: 1, message: 'Please. He spent two weeks on twelve frames.', drawn: 'blue-shirt', at: day + 0.85 * HOUR });
  const filed = fake.seed.post(thread, who('Snuckles'), 'Is this the right board for sprite sheets? I looked for a sprite board and there was not one.', { at: day + HOUR });
  const mod = fake.seed.staff('ontopic', 'ONTOPIC 5.0', 'mod');
  const visit = fake.seed.visit(mod, filed, { at: day + 1.1 * HOUR, endsInMs: HOUR, line: 'A question about boards, asked on a board. I will allow that this is efficient.' });
  fake.seed.visitEnd(visit, { outcome: 'filed', line: 'Two stars. Filed.', at: day + 1.2 * HOUR });
  fake.seed.infraction(visit, { points: 6, at: day + 1.2 * HOUR });
  /* A post whose one use is off camera: the title cards' strip of tape is a real Autocorrect, landed on this post's "friends" and copied from it (tools/hype/shot-cards.mjs). */
  fake.seed.post(thread, who('Chadluminum'), 'We are all friends here.', { at: day + 1.4 * HOUR });
  /* A reader with no character in the thread: the one Stick Around can hold. */
  const reader = fake.seed.account('hype-reader', { seasoned: true });
  fake.seed.character(reader, 'Ringside', instance.classes[0]!.key, { at: now - 20 * 24 * HOUR });
  owner.Ringside = reader;
  const scenes = { kind: 7, recount: 8, review: 9, joke: 10, appeal: 11, filed: 12, friends: 13 };
  void [kind, recount, review];
  fake.seed.tally(first, { fire: 3, 'thumbs-up': 5 });
  fake.seed.tally(target, { fire: 4, 'thumbs-up': 2 });
  fake.seed.settle({ at: now - 20 * HOUR, wallet: { [me]: 240, ...Object.fromEntries(others.map((o) => [o, 180])) }, standings: Object.fromEntries(Object.values(cast).map((c, i) => [c, 60 + 25 * i])) });
  /* One of every card in the game, for the hand shot. */
  fake.seed.cards(me, Object.fromEntries(instance.cards.map((c) => [c.key, 1])));
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
  const viewer = AS === null ? me : owner[AS];
  if (viewer === undefined) throw new Error(`the stage has no character named "${AS}": the cast is ${Object.keys(owner).join(', ')}`);
  fake.signInAs(viewer);
  /* Brighter Effects is on (the owner, 2026-11-14): the film is of the effects. */
  void fake.setPreferences({ theme: SKIN, motion: 'full', effects: 'bright' });
  void fake.skipTips();
  /* The film's player has met every card, as a player meets one (a card is met by its own call, not as a preference): no first-time tip opens over a shot. */
  for (const c of instance.cards) void fake.meetCard(c.key);
  made = { thread, target: { act: target, seq: 4, character: who('Snuckles') }, cast, me, scenes, threads: { main: thread, argued: argued.thread, goodbye: goodbye.thread }, staff: { fangame, qc, ontopic: mod } };
  /* The story opens on the thread: its address is known only once it is seeded, so the seed sets it (the preview's `path` is fixed text). */
  const [view, of = ''] = VIEW.split(':');
  const shown = view === 'thread' ? made.threads[of || 'main'] : undefined;
  if (view === 'thread' && shown === undefined) throw new Error(`the stage has no thread "${of}": its threads are ${Object.keys(made.threads).join(', ')}`);
  globalThis.history.replaceState(null, '', view === 'index' ? '/' : view === 'profile' ? `/c/${made.staff[of] ?? cast[of]}` : `/t/${shown}`);
};

function Staged() {
  const { api, ui } = useKayfa();
  /*
   * The skin goes on the page as the app puts a player's on (the app's own shell does this; a story has no shell), and then its sheet is
   * moved to the end of the head. A story's page carries the house theme in its own bundle (.storybook/preview.tsx imports it), which
   * lands after the theme's link, so the house theme won every token the two share: a skin showed its own extras over the house's
   * colors (Fan Site's film strip on the house's dark gray, where its page is blue). In the app the skin's sheet is the only theme.
   */
  useEffect(() => {
    void api.preferences().then((p) => {
      applyAppearance(document, p, ui.themes, ui.glass);
      const sheet = document.querySelector('link#kb-theme');
      if (sheet) document.head.append(sheet);
    });
  }, [api, ui]);
  useEffect(() => {
    if (!made) return;
    window.__kbStage = { ...made, fake: api as Fake, whoops: { packStroke, brushOf, BRUSH_PX } };
    return () => { delete window.__kbStage; };
  }, [api]);
  if (!made) return <Frame><div aria-busy="true" /></Frame>;
  const [view, of = ''] = VIEW.split(':');
  return (
    <Frame>
      {view === 'index' ? <LoadedIndex /> : view === 'profile' ? <LoadedProfile id={made.staff[of] ?? made.cast[of] ?? ''} /> : <LoadedThread thread={made.threads[of || 'main'] ?? made.thread} />}
    </Frame>
  );
}

const meta: Meta<typeof Staged> = {
  /* Under Boards, as every story the end-to-end build's story route serves is (web/src/data/fixtures/stories.test.tsx holds their ids to it). */
  title: 'Boards/Hype stage',
  component: Staged,
  parameters: { world, layout: 'fullscreen' },
};
export default meta;

export const Main: StoryObj<typeof Staged> = {};
