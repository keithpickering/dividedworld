/**
 * Divided World's front door: the made-up thread a signed-out visitor reads in place of the board, the developer persona's note under it,
 * and the HUD's prompt (docs/plans/2026-11-23-wiggler-front-door-design.md). The thread is the forum's half of the Wiggler thread
 * (docs/plans/2026-11-22-wiggler-thread-design.md): an earnest sprite sheet, a Heel's insult, a confused Jabroni, a rant taped over, the
 * Face's burn, the shading critique, the "fix", the AI accusation and the exit. The Mods' half stays with the film. The words are the owner's.
 *
 * The cast is one character of each posting class, each shown through the postbit's real "Revealed:" line; the Lurker reads the room and
 * never posts, so it is absent by design. They are made-up names with no profile behind them. Hotel Bro (the Heel) has no pictures yet, so the
 * postbit draws his initial.
 *
 * `{{setting:<path>}}` marks a number a retune would change; the engine fills it from the settings in force, so no number is typed here.
 * `rank` is an index into the instance's ranks (../index.ts), so the pips differ.
 *
 * The counts are a quiet thread's: a post gets nought to two reactions of one kind, and only the hits get several. #3 (the burn on the
 * sheet) is thrown tomatoes, #5's seven thumbs-ups answer Hotel Bro's complaint about the one on #3, and #6's skulls are Chadluminum's burn landing.
 * A visitor's own reactions are added on their screen alone (docs/plans/2026-11-07-front-door-play-design.md).
 *
 * Where each card sits, and why:
 * - **Graffiti on #1**, the opener, drawn by Serious Deer, Hotel Bro and D-Guy on Snuckles's sheet: the wall is the critique, and a visitor
 *   sees a surface card before anything else.
 * - **Whoops! on #3**, thrown by Chadluminum in `#e8402a`, a custom hex near the 🍅 so the splat reads as "your post got lots of tomatoes"
 *   (seed 1, picked from a scan of seeds for one that covers most of the words). Hotel Bro, whose post it is, has washed part of it, twice over the
 *   line of words and once through the middle (about 55% of the ink is left on a desktop board): the play's saved state is his wash, so the words read at first, with heavier ink at the
 *   splat's edges and core. The Lens reports the wash truthfully, and a visitor can scrub further on their own screen.
 * - **Autocorrect x3 on #5** at layers 1 to 3, each a different caster's tape over Hotel Bro's rant.
 * - **Overreaction on #6**, D-Guy's skull, counted under its local key (`x-1f480`), with two Feelin' Fabs (a stack that glows) and a Steel Chair.
 * - **Feelin' Fab on #2** and **Below the Fold on #9**, the thread's small plays.
 *
 * The graffiti and the wash are shapes (./front-door/marks.ts: an arrow, a ring, "??", a heart, a scribble, wash passes across bands) turned into
 * the cards' own strokes with a fixed seed, so every visitor sees the same hand-drawn marks; move one by changing a number. Their `aspect`s are
 * the post bodies' width over height as measured on a desktop board. The two sprite sheets are bundled (`?url`) and written root-relative; the
 * page makes them absolute against its own origin.
 *
 * The glass may joke where it describes the game, and it never bluffs (CLAUDE.md, "The fiction may lie; the log never does").
 */
import type { FrontDoorUi } from '../../../engine/ui/types.ts';
import snucklesPortrait from './avatars/snuckles_portrait.png?url';
import snucklesSquare from './avatars/snuckles_square.png?url';
import chadPortrait from './avatars/robochad_portrait.jpg?url';
import chadSquare from './avatars/robochad_square.jpg?url';
import deerPortrait from './avatars/deer_portrait.jpg?url';
import deerSquare from './avatars/deer_square.jpg?url';
import dguyPortrait from './avatars/dguy_portrait.jpg?url';
import dguySquare from './avatars/dguy_square.jpg?url';
import sheet from './front-door/wiggler-sheet.gif?url';
import sheetShadow from './front-door/wiggler-sheet-dropshadow.gif?url';
import { arrow, glyphs, heart, ring, scribble, tag, washPasses } from './front-door/marks.ts';

/** When the sample cast revealed their classes: a fixed day, so the postbit's dated line reads the same for every visitor. */
const REVEALED_AT = '2026-10-03T12:00:00Z';

/** Post #1's body, as the Effect measures it at a desktop board: width over height (the graffiti is drawn at it). */
const SHEET_ASPECT = 1.71;
/** Post #3's body, the same. */
const BURN_ASPECT = 2.8;

export const frontDoor: FrontDoorUi = Object.freeze({
  title: 'Look At My Wiggler Sprites',
  label: 'Sample thread · made up',
  cast: Object.freeze([
    Object.freeze({ key: 'snuckles', name: 'Snuckles', rank: 0, posts: 2817, revealed: Object.freeze({ class: 'jabroni', at: REVEALED_AT }), avatarPortrait: snucklesPortrait, avatarSquare: snucklesSquare }),
    Object.freeze({ key: 'hotelbro', name: 'Hotel Bro', rank: 1, posts: 212, revealed: Object.freeze({ class: 'heel', at: REVEALED_AT }) }),
    Object.freeze({ key: 'chadluminum', name: 'Chadluminum', rank: 3, posts: 1204, revealed: Object.freeze({ class: 'face', at: REVEALED_AT }), avatarPortrait: chadPortrait, avatarSquare: chadSquare }),
    Object.freeze({ key: 'deer', name: 'Serious Deer', rank: 2, posts: 388, revealed: Object.freeze({ class: 'technician', at: REVEALED_AT }), avatarPortrait: deerPortrait, avatarSquare: deerSquare }),
    Object.freeze({ key: 'dguy', name: 'D-Guy', rank: 4, posts: 1224, revealed: Object.freeze({ class: 'tweener', at: REVEALED_AT }), avatarPortrait: dguyPortrait, avatarSquare: dguySquare }),
  ]),
  posts: Object.freeze([
    Object.freeze({
      by: 'snuckles',
      body: `Hi divided world, it's ya boy Snuckles here with my first ever sprite sheet. He's an original character I invented after I saw him in a Mario game.\n\n[img]${sheet}[/img]\n\nLet me know what you think!`,
      reactions: Object.freeze({ heart: 1 }),
      plays: Object.freeze([Object.freeze({
        card: 'graffiti', by: 'deer', config: Object.freeze({}),
        draws: Object.freeze([
          { by: 'deer', draw: tag('red', 'stock', SHEET_ASPECT, ring([0.069, 0.36], 0.045, 0.05, 3), arrow([0.27, 0.435], [0.118, 0.375], SHEET_ASPECT, 4)) },
          { by: 'hotelbro', draw: tag('black', 'stock', SHEET_ASPECT, glyphs('??', [0.175, 0.45], 0.13, SHEET_ASPECT, 5)) },
          { by: 'hotelbro', draw: tag('black', 'fat', SHEET_ASPECT, scribble({ x0: 0.032, y0: 0.64, x1: 0.168, y1: 0.66 }, 6)) },
          { by: 'dguy', draw: tag('pink', 'stock', SHEET_ASPECT, heart([0.272, 0.868], 0.07, SHEET_ASPECT, 7)) },
        ]),
      })]),
    }),
    Object.freeze({
      by: 'dguy',
      body: 'The walk looks like it was hard to make 💪',
      reactions: Object.freeze({ heart: 1 }),
      plays: Object.freeze([Object.freeze({ card: 'feelin-fab', by: 'snuckles', config: Object.freeze({}) })]),
    }),
    Object.freeze({
      by: 'hotelbro',
      body: 'OF COURSE YOUR SPRITES LOOK LIKE THIS WITH THOSE STEAMBOAT WILLIE ASS FINGERS',
      reactions: Object.freeze({ tomato: 5, 'thumbs-up': 1 }),
      plays: Object.freeze([Object.freeze({
        card: 'whoops', by: 'chadluminum', config: Object.freeze({ color: '#e8402a', seed: 1 }),
        state: washPasses([{ top: 0, bottom: 0.14 }, { top: 0, bottom: 0.14 }, { top: 0.3, bottom: 0.6 }], { aspect: BURN_ASPECT, width: 0.06, seed: 1 }),
        reactions: Object.freeze({ laughing: 2 }),
      })]),
    }),
    Object.freeze({
      by: 'snuckles',
      body: 'I don\'t understand. Is that good or bad? Steamboat Willie is a classic.',
      reactions: Object.freeze({ laughing: 1 }),
    }),
    Object.freeze({
      by: 'hotelbro',
      body: 'Who was that react from?! Come fight me like a man and I\'ll show ya where to put that thumbs up.',
      reactions: Object.freeze({ 'thumbs-up': 7, tomato: 2 }),
      plays: Object.freeze([
        Object.freeze({ card: 'autocorrect', by: 'dguy', layer: 1, config: Object.freeze({ phrase: 'a man', replacement: 'a Goomba' }) }),
        Object.freeze({ card: 'autocorrect', by: 'chadluminum', layer: 2, config: Object.freeze({ phrase: 'where', replacement: 'how' }) }),
        Object.freeze({ card: 'autocorrect', by: 'deer', layer: 3, config: Object.freeze({ phrase: 'put that thumbs up', replacement: 'do the Mario' }), reactions: Object.freeze({ laughing: 2 }) }),
      ]),
    }),
    Object.freeze({
      by: 'chadluminum',
      body: 'Big talk from a guy whose girlfriend went to 7 hotels in one night.',
      reactions: Object.freeze({ 'x-1f480': 4, fire: 2, 'hundred-points': 1 }),
      plays: Object.freeze([
        Object.freeze({ card: 'overreaction', by: 'dguy', config: Object.freeze({ emoji: '💀', quadrant: 'boredNegative' }) }),
        Object.freeze({ card: 'feelin-fab', by: 'deer', layer: 1, config: Object.freeze({}) }),
        Object.freeze({ card: 'feelin-fab', by: 'snuckles', layer: 2, config: Object.freeze({}) }),
        Object.freeze({ card: 'steel-chair', by: 'hotelbro', config: Object.freeze({}) }),
      ]),
    }),
    Object.freeze({
      by: 'deer',
      body: 'You would do well to address the pillow shading.',
      reactions: Object.freeze({ 'light-bulb': 1 }),
    }),
    Object.freeze({
      by: 'snuckles',
      body: `What's shading?\n\nEDIT: ok I looked it up. I think I fixed it.\n\n[img]${sheetShadow}[/img]`,
      reactions: Object.freeze({ facepalm: 2 }),
    }),
    Object.freeze({
      by: 'deer',
      body: 'After analyzing the pixels in this sprite sheet I have come to the unfortunate conclusion that it was created with the assistance of generative AI.',
      reactions: Object.freeze({ 'thumbs-down': 1 }),
      plays: Object.freeze([Object.freeze({ card: 'below-the-fold', by: 'hotelbro', config: Object.freeze({}) })]),
    }),
    Object.freeze({
      by: 'snuckles',
      body: 'That does it! I\'ll kindly take my Wigglers elsewhere!!!',
      reactions: Object.freeze({ laughing: 2 }),
    }),
  ]),
  note: [
    'Uh, no?',
    '',
    'These characters are all acting it up, as usual. The game is pretty simple:',
    '',
    '- You play up to {{setting:charactersPerPlayer}} anonymous characters, each with a secret class only you can see.',
    '- Each class benefits from a different posting style. Figure out how the crowd responds to your character, and play it up!',
    '- Crowd reactions turn into Aura at each settlement, {{setting:settlementLength}} apart. Spend Aura on booster packs to get Cards, add effects to posts, and get even more reactions.',
    '- Evade Mod Bots and appease the almighty Administrator. Learn what they like and you might be able to sweet-talk them!',
    '',
    'This is rated M. Or it probably would be, if the ESRB would get back to me. I think they might not rate this kind of thing.',
  ].join('\n'),
  prompt: Object.freeze({
    title: 'Who will you play?',
    line: 'Divided World: a kayfabe social deduction game disguised as a 2003 message board',
  }),
});
