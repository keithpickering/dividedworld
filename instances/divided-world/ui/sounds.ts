/**
 * Divided World's laugh track: the audience's sounds, each with its caption and the ink of its dot.
 * The files are in `sounds/`, listed in `sounds/sounds.json` (tools/check-sounds.mjs holds the two to each other).
 * The engine plays them on the game bus (engine/ui/audio/types.ts).
 */
import type { SoundsUi, SoundSlot } from '../../../engine/ui/audio/types.ts';
import laugh1 from './sounds/laugh-1.mp3?url';
import laugh2 from './sounds/laugh-2.mp3?url';
import laugh3 from './sounds/laugh-3.mp3?url';
import cheer1 from './sounds/cheer-1.mp3?url';
import cheer2 from './sounds/cheer-2.mp3?url';
import cheer3 from './sounds/cheer-3.mp3?url';
import boo1 from './sounds/boo-1.mp3?url';
import boo2 from './sounds/boo-2.mp3?url';
import boo3 from './sounds/boo-3.mp3?url';
import titter from './sounds/titter.mp3?url';
import ooh from './sounds/ooh.mp3?url';
import grumble from './sounds/grumble.mp3?url';

const LAUGH = 'The audience laughs';
const CHEER = 'The audience cheers';
const BOO = 'The audience boos';

const slot = (key: string, src: string, caption: string, ink: string, loop?: true): SoundSlot =>
  Object.freeze({ key, src, bus: 'game', caption, ink, ...(loop ? { loop } : {}) });

export const sounds: SoundsUi = Object.freeze({
  slots: Object.freeze([
    slot('laugh-track.laugh-1', laugh1, LAUGH, 'var(--kb-pepperoni)'),
    slot('laugh-track.laugh-2', laugh2, LAUGH, 'var(--kb-pepperoni)'),
    slot('laugh-track.laugh-3', laugh3, LAUGH, 'var(--kb-pepperoni)'),
    slot('laugh-track.cheer-1', cheer1, CHEER, 'var(--kb-sweet)'),
    slot('laugh-track.cheer-2', cheer2, CHEER, 'var(--kb-sweet)'),
    slot('laugh-track.cheer-3', cheer3, CHEER, 'var(--kb-sweet)'),
    slot('laugh-track.boo-1', boo1, BOO, 'var(--kb-salty)'),
    slot('laugh-track.boo-2', boo2, BOO, 'var(--kb-salty)'),
    slot('laugh-track.boo-3', boo3, BOO, 'var(--kb-salty)'),
    slot('laugh-track.titter', titter, 'The audience titters', 'var(--kb-pepperoni)', true),
    slot('laugh-track.ooh', ooh, 'The audience goes “ooh”', 'var(--kb-sweet)', true),
    slot('laugh-track.grumble', grumble, 'A grumble rises', 'var(--kb-salty)', true),
  ]),
  preview: Object.freeze({ game: 'laugh-track.laugh-1' }),
});
