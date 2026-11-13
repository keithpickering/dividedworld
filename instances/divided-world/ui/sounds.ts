/**
 * Divided World's laugh track: the audience's sounds, each with its caption and the ink of its dot.
 * The files are in `sounds/`, listed in `sounds/sounds.json` (tools/check-sounds.mjs holds the two to each other).
 * The engine plays them on the game bus (engine/ui/audio/types.ts), each with the `gain` that brings its measured
 * loudness (the manifest's `lufs` and `peak`, written by tools/measure-sounds.mjs) to the same level.
 */
import type { SoundsUi, SoundSlot } from '../../../engine/ui/audio/types.ts';
import manifest from './sounds/sounds.json' with { type: 'json' };
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

/** The loudness every sound is brought to, in LUFS. */
export const TARGET_LUFS = -18;
/** The peak no sound is brought above, in dBFS. */
export const CEILING_DBFS = -1;

/** A multiplier that brings a sound to TARGET_LUFS, and no further than puts its peak at CEILING_DBFS. */
export function gainOf(m: { lufs: number; peak: number }): number {
  return 10 ** (Math.min(TARGET_LUFS - m.lufs, CEILING_DBFS - m.peak) / 20);
}

const measured = new Map(manifest.map((e) => [e.file, e]));

const slot = (key: string, file: string, src: string, caption: string, ink: string, loop?: true): SoundSlot => {
  const m = measured.get(file);
  if (!m) throw new Error(`sounds/sounds.json has no entry for ${file} (tools/check-sounds.mjs holds that there is one)`);
  return Object.freeze({ key, src, bus: 'game', caption, ink, gain: gainOf(m), ...(loop ? { loop } : {}) });
};

export const sounds: SoundsUi = Object.freeze({
  slots: Object.freeze([
    slot('laugh-track.laugh-1', 'laugh-1.mp3', laugh1, LAUGH, 'var(--kb-pepperoni)'),
    slot('laugh-track.laugh-2', 'laugh-2.mp3', laugh2, LAUGH, 'var(--kb-pepperoni)'),
    slot('laugh-track.laugh-3', 'laugh-3.mp3', laugh3, LAUGH, 'var(--kb-pepperoni)'),
    slot('laugh-track.cheer-1', 'cheer-1.mp3', cheer1, CHEER, 'var(--kb-sweet)'),
    slot('laugh-track.cheer-2', 'cheer-2.mp3', cheer2, CHEER, 'var(--kb-sweet)'),
    slot('laugh-track.cheer-3', 'cheer-3.mp3', cheer3, CHEER, 'var(--kb-sweet)'),
    slot('laugh-track.boo-1', 'boo-1.mp3', boo1, BOO, 'var(--kb-salty)'),
    slot('laugh-track.boo-2', 'boo-2.mp3', boo2, BOO, 'var(--kb-salty)'),
    slot('laugh-track.boo-3', 'boo-3.mp3', boo3, BOO, 'var(--kb-salty)'),
    slot('laugh-track.titter', 'titter.mp3', titter, 'The audience titters', 'var(--kb-pepperoni)', true),
    slot('laugh-track.ooh', 'ooh.mp3', ooh, 'The audience goes “ooh”', 'var(--kb-sweet)', true),
    slot('laugh-track.grumble', 'grumble.mp3', grumble, 'A grumble rises', 'var(--kb-salty)', true),
  ]),
  preview: Object.freeze({ game: 'laugh-track.laugh-1' }),
});
