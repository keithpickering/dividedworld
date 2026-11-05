/**
 * Divided World's front door: the made-up thread a signed-out visitor reads in place of the board, the developer persona's note under it,
 * and the HUD's prompt (docs/plans/2026-11-05-front-door-design.md). The thread's words are the owner's own (2026-11-05), with one
 * character of each posting class, each shown through the postbit's real "Revealed:" line; the Lurker reads the room and never posts, so
 * it is absent by design. The cast are made-up names with no profile behind them, drawn with their initials until they have avatars.
 *
 * `{{setting:<path>}}` marks a number a retune would change; the engine fills it from the settings in force, so no number is typed here.
 * `rank` is an index into the instance's ranks (../index.ts), so the pips differ. Each post's reactions are the ones its author's class
 * earns from (the Jabroni's groan, the Face's hype, the Technician's calm, the Heel's heat). Snuckles's second post is splatted by Mr.
 * Roboto's Whoops!, a Salty card, which a Jabroni earns from; its `seed` is fixed, so every visitor sees the same splat.
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
    Object.freeze({ key: 'wholesome', name: 'Captain Wholesome', rank: 3, posts: 1204, revealed: Object.freeze({ class: 'face', at: REVEALED_AT }) }),
    Object.freeze({ key: 'accountant', name: 'The Accountant', rank: 2, posts: 388, revealed: Object.freeze({ class: 'technician', at: REVEALED_AT }) }),
    Object.freeze({ key: 'roboto', name: 'Mr. Roboto', rank: 1, posts: 212, revealed: Object.freeze({ class: 'heel', at: REVEALED_AT }) }),
  ]),
  posts: Object.freeze([
    Object.freeze({
      by: 'snuckles',
      body: 'This is a plain old outdated forum...or is it something more? In the game we call life, we have few opportunities to put on a mask. We are giving you that opportunity now. Will you take it, weary traveler?',
      reactions: Object.freeze({ 'eye-roll': 4, zzz: 3, yawn: 2 }),
    }),
    Object.freeze({
      by: 'wholesome',
      body: 'Do you ever stop talking?',
      reactions: Object.freeze({ fire: 7, heart: 5, 'raised-hands': 4, 'star-struck': 3 }),
    }),
    Object.freeze({
      by: 'snuckles',
      body: 'Oh come on! I\'m just trying to be cool in front of the new person and of course you\'re being a jerk about it. Once again you\'re mad that you don\'t have what it takes to compete in the Marketplace of Ideas.',
      reactions: Object.freeze({ yawn: 3, trash: 1 }),
      plays: Object.freeze([Object.freeze({ card: 'whoops', by: 'roboto', config: Object.freeze({ color: '#ff3d7f', seed: 228 }) })]),
    }),
    Object.freeze({
      by: 'accountant',
      body: 'You\'re just trying to get crowd points by acting like a clown. How about we try to explain this in a way that makes sense?',
      reactions: Object.freeze({ tea: 4, handshake: 3, meditating: 2 }),
    }),
    Object.freeze({
      by: 'roboto',
      body: 'Hey new guy! This site is honestly really cool. It\'s a convergence of human intelligence with the new AI Renaissance, and I am totally here for it.',
      reactions: Object.freeze({ tomato: 5, 'thumbs-down': 4, nauseated: 2, cursing: 1 }),
    }),
  ]),
  note: [
    'Uh, no? These characters are all acting it up, as usual. The game is really pretty simple:',
    '',
    '- You play up to {{setting:charactersPerPlayer}} characters, each with a secret class only you can see.',
    '- Reactions turn into Aura at each settlement, {{setting:settlementLength}} apart. Spend it on postcards and play them on posts.',
    '- Every season ends with every character\'s class revealed, and never the player behind it.',
    '- It\'s for adults, and for now it\'s by invite.',
    '',
    'The game is rated M. Or it probably would be, if the ESRB would get back to me. I think they might not rate this kind of thing.',
  ].join('\n'),
  prompt: Object.freeze({
    title: 'Who will you play as?',
    line: 'A message board where everyone wears a mask, and everyone is someone you know.',
  }),
});
