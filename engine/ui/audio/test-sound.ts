/**
 * The sound page's deps, faked, for the screens' tests (the Settings and welcome sound rows): `fakeSound()` swaps the page's mixer for one
 * over a context that decodes every file to a second and a half, and says which files were fetched, so a test sees a preview play.
 */
import { vi } from 'vitest';
import type { AudioContextLike, SourceLike } from './mixer.ts';
import { resetSound } from './sound.ts';

const param = () => ({ value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() });

export function fakeSound(): { readonly fetched: ReturnType<typeof vi.fn>; readonly sources: SourceLike[] } {
  const sources: SourceLike[] = [];
  const fetched = vi.fn(async (_src: string) => new ArrayBuffer(8));
  const makeContext = (): AudioContextLike => ({
    currentTime: 0, destination: {},
    resume: vi.fn(async () => {}), suspend: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => ({ duration: 1.5 })),
    createGain: () => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() }),
    createBufferSource: () => { const s = { buffer: null, loop: false, onended: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }; sources.push(s); return s; },
  });
  resetSound({ makeContext, fetchBytes: fetched });
  return { fetched, sources };
}
