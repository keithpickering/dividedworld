/** Laugh Track's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { laughTrack } from '../../../cards/laugh-track.ts';
import { ConfigForm as LaughTrackConfigForm } from '../../laugh-track/ConfigForm.tsx';
import type { Settings } from '../../../../../engine/rules/types.ts';
import laughTrackCanvas from './art.webp?url';
import laughTrackMark from './mark.svg?url';
import laughTrackArt from './art.json';
import { orbs, setMoveWords } from '../words.ts';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const LaughTrackEffect = lazy(() => import('../../laugh-track/Effect.tsx').then((m) => ({ default: m.LaughTrackEffect })));

/*
 * Laugh Track (docs/plans/2026-11-11-laugh-track-design.md): Pepperoni's color. Its effect is the audience, heard and captioned as a
 * reader points at, taps or presses Enter on each cued phrase, never one inside a link: a bare address is left out of the places
 * (#602), so every place drawn is a button (ui/laugh-track/Effect.tsx); the form picks the cues
 * (ui/laugh-track/ConfigForm.tsx).
 */
export const ui: CardUi = {
  key: 'laugh-track',
  art: { color: '#d24a2c', ink: '#0d0301', canvas: laughTrackCanvas, mark: laughTrackMark, credit: laughTrackArt.credit, tagline: 'Give a post a studio audience.' },
  summary: 'Cues a studio audience to laugh, cheer or boo at the words you choose, wherever they appear in a post.',
  status: 'A studio audience on cue',
  hint: 'A Laugh Track: the audience stirs as you get close to certain words. Point at one, or tap it, to hear them react. Turn on Game sounds in Settings to hear it.',
  Effect: LaughTrackEffect,
  ConfigForm: LaughTrackConfigForm,
  sounds: [
    'laugh-track.laugh-1', 'laugh-track.laugh-2', 'laugh-track.laugh-3',
    'laugh-track.cheer-1', 'laugh-track.cheer-2', 'laugh-track.cheer-3',
    'laugh-track.boo-1', 'laugh-track.boo-2', 'laugh-track.boo-3',
    'laugh-track.titter', 'laugh-track.ooh', 'laugh-track.grumble',
  ],
  surcharge: (s: Settings) => `Many places, +${orbs(s.economy['laughTrack.perPlace'] ?? 0)} per place past ${s.economy['laughTrack.freePlaces'] ?? 0}`,
  describe: () =>
    `A Pepperoni card, ${laughTrack.rarity}. You choose up to five phrases in a post and give each a sound: the audience laughs, cheers or boos. Wherever a phrase appears in the post's own words, a reader can set the audience off. Every reaction is also shown as a caption, so it works with sound off. One audience fits on a post. ${setMoveWords('the quoting post')} Set face down, it waits for a quote that says its first phrase. It costs more to play the more places its phrases cover.`,
  logPlay: () => 'It gave the post a studio audience.',
};
