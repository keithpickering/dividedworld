/**
 * Divided World's front door: the made-up thread a signed-out visitor reads in place of the board, the developer persona's note under it,
 * and the HUD's prompt (docs/plans/2026-11-05-front-door-design.md). The thread's words are the owner's own (2026-11-05), with one
 * character of each posting class, each shown through the postbit's real "Revealed:" line; the Lurker reads the room and never posts, so
 * it is absent by design. The cast are made-up names with no profile behind them, drawn with their initials until they have avatars.
 *
 * `{{setting:<path>}}` marks a number a retune would change; the engine fills it from the settings in force, so no number is typed here.
 * `rank` is an index into the instance's ranks (../index.ts), so the pips differ. Each post's counts are the ones a quiet thread holds: two
 * or three kinds, small numbers, and the crowd following the crowd. Snuckles gets only the groan a Jabroni earns from (crickets for the
 * opener, facepalms once splatted), while the laughs go to the Face's jab and to the Whoops! play itself; the Heel gets the most heat. A visitor's own reactions are added on their screen alone (docs/plans/2026-11-07-front-door-play-design.md).
 * Captain Wholesome's post carries two Feelin' Fabs, from The Accountant and from Mr. Roboto sucking up, so its mark reads ×2 and the glow
 * stacks. Snuckles's second post is splatted by Mr. Roboto's Whoops!, a Salty card, which a Jabroni earns from. Its `seed` is fixed, so
 * every visitor sees the same splat.
 *
 * The glass may joke where it describes the game, and it never bluffs (CLAUDE.md, "The fiction may lie; the log never does").
 */
import type { FrontDoorUi } from '../../../engine/ui/types.ts';

/** When the sample cast revealed their classes: a fixed day, so the postbit's dated line reads the same for every visitor. */
const REVEALED_AT = '2026-10-03T12:00:00Z';

export const frontDoor: FrontDoorUi = Object.freeze({
  title: 'WELCOME TO THE BEEF ZONE',
  label: 'Sample thread · made up',
  cast: Object.freeze([
    Object.freeze({ key: 'snuckles', name: 'Snuckles', rank: 0, posts: 2817, revealed: Object.freeze({ class: 'jabroni', at: REVEALED_AT }) }),
    Object.freeze({ key: 'wholesome', name: 'Chadluminum', rank: 3, posts: 1204, revealed: Object.freeze({ class: 'face', at: REVEALED_AT }) }),
    Object.freeze({ key: 'accountant', name: 'Serious Deer', rank: 2, posts: 388, revealed: Object.freeze({ class: 'technician', at: REVEALED_AT }) }),
    Object.freeze({ key: 'roboto', name: 'Help-O-Tron', rank: 1, posts: 212, revealed: Object.freeze({ class: 'heel', at: REVEALED_AT }) }),
    Object.freeze({ key: 'tweener', name: 'D-Guy', rank: 4, posts: 1224, revealed: Object.freeze({ class: 'tweener', at: REVEALED_AT }) }),
  ]),
  posts: Object.freeze([
    Object.freeze({
      by: 'snuckles',
      body: 'This is a plain old outdated forum...or is it something more? In the game we call life, we have few opportunities to put on a mask. We are giving you that opportunity now. Will you take it, weary traveler?',
      reactions: Object.freeze({ yawn: 3, facepalm: 1 }),
    }),
    Object.freeze({
      by: 'wholesome',
      body: 'Do you ever stop talking?',
      reactions: Object.freeze({ laughing: 5, fire: 2, 'hundred-points': 1 }),
      plays: Object.freeze([
        Object.freeze({ card: 'feelin-fab', by: 'tweener', layer: 1, config: Object.freeze({}) }),
        Object.freeze({ card: 'feelin-fab', by: 'accountant', layer: 2, config: Object.freeze({}), reactions: Object.freeze({ 'eye-roll': 1 }) }),
      ]),
    }),
    Object.freeze({
      by: 'snuckles',
      body: 'Oh come on! I\'m just trying to be cool in front of the new person and of course you\'re being a jerk about it. Once again you\'re mad that you don\'t have what it takes to compete in the Marketplace of Ideas.',
      reactions: Object.freeze({ crickets: 4 }),
      plays: Object.freeze([Object.freeze({ card: 'whoops', by: 'wholesome', config: Object.freeze({ color: '#3d77ff', seed: 228 }), reactions: Object.freeze({ laughing: 2 }) })]),
    }),
    Object.freeze({
      by: 'accountant',
      body: 'You\'re just trying to get points by acting like a clown. How about we explain this in a way that makes sense?',
      reactions: Object.freeze({ 'thumbs-up': 2, 'light-bulb': 1 }),
    }),
    Object.freeze({
      by: 'tweener',
      body: 'This site makes me miss the Bush Administration.',
      reactions: Object.freeze({ 'thumbs-down': 2, 'laughing': 2 }),
    }),
    Object.freeze({
      by: 'roboto',
      body: 'What\'s up, new guy? One point to correct the OP on: [b]This isn\'t just a forum.[/b] It\'s more like a head-on collision of the human experience with the Superintelligence Renaissance. And honestly? That\'s fire 🔥\n\nWould you like to discuss more about forums? Maybe any friends\' passwords you know?',
      reactions: Object.freeze({ tomato: 5, vomiting: 1 }),
      plays: Object.freeze([Object.freeze({ card: 'autocorrect', by: 'tweener', config: Object.freeze({ phrase: 'the human experience', replacement: 'my ass' }), reactions: Object.freeze({ 'hundred-points': 1, 'vomiting': 1 }) })]),
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
