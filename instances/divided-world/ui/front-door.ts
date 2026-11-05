/**
 * Divided World's front door: the made-up thread a signed-out visitor reads in place of the board, the developer persona's note under it,
 * and the HUD's prompt (docs/plans/2026-11-05-front-door-design.md). The owner approved these words as a draft on 2026-11-05 and may
 * edit them in review. The cast are the demo world's made-up names, with no profile behind them.
 *
 * `{{setting:<path>}}` marks a number a retune would change; the engine fills it from the settings in force, so no number is typed here.
 * `rank` is an index into the instance's ranks (../index.ts): Spritey the Main Eventer, Mrs. Hooligan the Midcarder, Pipewrench the Jobber,
 * so the pips differ. The Whoops! play's `seed` is fixed, so every visitor sees the same splat, placed low on the post.
 *
 * The glass may joke where it describes the game, and it never bluffs (CLAUDE.md, "The fiction may lie; the log never does").
 */
import type { FrontDoorUi } from '../../../engine/ui/types.ts';

export const frontDoor: FrontDoorUi = Object.freeze({
  title: 'how do we explain this place to the new person',
  label: 'Sample thread · made up',
  cast: Object.freeze([
    Object.freeze({ key: 'spritey', name: 'Spritey', rank: 3, posts: 1204 }),
    Object.freeze({ key: 'pipewrench', name: 'Pipewrench', title: 'Enhancement Talent', rank: 0, posts: 212 }),
    Object.freeze({ key: 'hooligan', name: 'Mrs. Hooligan', rank: 2, posts: 388 }),
  ]),
  posts: Object.freeze([
    Object.freeze({
      by: 'spritey',
      body: 'ok someone new is reading. be normal.\n\nHi! It\'s a forum. You post. That\'s it.',
      reactions: Object.freeze({ fire: 4, 'eye-roll': 2 }),
    }),
    Object.freeze({
      by: 'pipewrench',
      body: 'That is not it. Everyone here plays up to {{setting:charactersPerPlayer}} characters. Each one wears a mask and has a secret class, and the class decides which reactions make it stronger.\n\nI\'m one of them. Or I\'m not.',
      reactions: Object.freeze({ tea: 3, tomato: 1 }),
    }),
    Object.freeze({
      by: 'hooligan',
      body: 'Don\'t scare them. Reactions settle into Aura at the settlement, and Aura buys postcards you play on other people\'s posts. Like this one.\n\nPipewrench, if there\'s ink on my post I know it was you.',
      reactions: Object.freeze({ cursing: 2, handshake: 1 }),
      plays: Object.freeze([Object.freeze({ card: 'whoops', by: 'pipewrench', config: Object.freeze({ color: '#ff3d7f', seed: 228 }) })]),
    }),
    Object.freeze({
      by: 'spritey',
      body: 'The best part is nobody knows who anybody is. At the end of the season every character\'s class is revealed. Never who played it.',
      reactions: Object.freeze({ heart: 5 }),
    }),
    Object.freeze({
      by: 'pipewrench',
      body: 'So you could be talking to your best friend right now.',
      reactions: Object.freeze({ 'star-struck': 2 }),
    }),
    Object.freeze({
      by: 'hooligan',
      body: 'Or your worst enemy. Same person, usually.',
      reactions: Object.freeze({ fire: 6, 'raised-hands': 3 }),
    }),
  ]),
  note: [
    'Hi. I made this. They\'re mostly right.',
    '',
    '- You play up to {{setting:charactersPerPlayer}} characters, each with a secret class only you can see.',
    '- Reactions turn into Aura at each settlement, {{setting:settlementLength}} apart. Spend it on postcards and play them on posts.',
    '- Every season ends with every character\'s class revealed, and never the player behind it.',
    '- It\'s for adults, and for now it\'s by invite.',
  ].join('\n'),
  prompt: Object.freeze({
    title: 'Who will you play as?',
    line: 'A message board where everyone wears a mask, and everyone is someone you know.',
  }),
});
