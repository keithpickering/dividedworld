/**
 * The reveal's animations, asked of the browser's own list (`document.getAnimations()`): under Off no element of the reveal has a running animation after any
 * input (the design's amendment "The reveal's motion", Off; booster packs plan, Task 10).
 *
 * jsdom has no Web Animations, so the browser's list is stood in for by one that records every `Element.animate` and answers `document.getAnimations()` with the
 * ones still running. It is installed before anything runs (Motion decides once whether the browser has them), and it is proved first on the full motion, where
 * the same inputs do start animations, so an empty answer under Off is a finding and not a blind spot.
 */
import { fireEvent, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardRules } from '../../rules/cards.ts';
import { facesOf } from '../cards/faces.ts';
import type { CardUi } from '../cards/types.ts';
import { Layers } from '../glass/layer.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { PackOpening } from './PackOpening.tsx';

const ok = { ok: true as const, value: undefined };
const rule = (key: string, name: string, rarity: CardRules['rarity'], alignment: CardRules['alignment'] = 'sweet'): CardRules => ({
  key, name, alignment, rarity, playPrice: () => 0, canApply: () => ok, validateConfig: (c) => ({ ok: true, value: c }),
});
const rules = [rule('stick', 'Stick Around', 'common'), rule('whoops', 'Whoops!', 'common', 'salty'), rule('dud', 'Dud', 'common', 'pepperoni'), rule('trap', 'Trap Card', 'uncommon'), rule('main', 'Main Event', 'rare')];
const art = { color: '#2ee6ff', ink: '#03141a', canvas: '', mark: '', credit: 'Test' };
const uis: CardUi[] = rules.map((r) => ({ key: r.key, art, describe: () => `${r.name} does a thing.` }));
const faces = facesOf(rules, uis, testInstance.settings);
const face = (key: string) => faces.find((f) => f.key === key)!;
/* Four commons, then the hit: in the order the answer gave them. */
const pulled = ['whoops', 'stick', 'dud', 'stick', 'main'].map(face);
const packArt = { color: '#ffd93d', ink: '#1a1403', canvas: '', mark: '', credit: 'Test' };


interface Stand { playState: string; finished: Promise<unknown> }
const started: Stand[] = [];
const hadAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
const hadGet = Object.getOwnPropertyDescriptor(document, 'getAnimations');

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value() {
      const a = {
        playState: 'running', finished: new Promise(() => {}), currentTime: 0, startTime: null as number | null, playbackRate: 1, onfinish: null, oncancel: null, timeline: null,
        effect: { updateTiming() {}, getComputedTiming: () => ({}) },
        cancel() { a.playState = 'idle'; }, finish() { a.playState = 'finished'; }, play() {}, pause() {}, commitStyles() {}, persist() {}, updatePlaybackRate() {},
        addEventListener() {}, removeEventListener() {},
      };
      started.push(a);
      return a;
    },
  });
  Object.defineProperty(document, 'getAnimations', { configurable: true, value: () => started.filter((a) => a.playState === 'running') });
});
afterAll(() => {
  if (hadAnimate) Object.defineProperty(Element.prototype, 'animate', hadAnimate); else delete (Element.prototype as { animate?: unknown }).animate;
  if (hadGet) Object.defineProperty(document, 'getAnimations', hadGet); else delete (document as { getAnimations?: unknown }).getAnimations;
});
beforeEach(() => { started.length = 0; });
afterEach(() => { document.documentElement.removeAttribute('data-kb-motion'); document.documentElement.removeAttribute('data-kb-motion-feel'); vi.restoreAllMocks(); });

function open() {
  return renderIn(buildWorld(), <Layers><PackOpening name="Booster" art={packArt} cards={pulled} note={null} onClose={vi.fn()} /></Layers>);
}

const inputs = () => {
  fireEvent.keyDown(screen.getByRole('dialog'), { key: ' ' });
  fireEvent.click(screen.getByRole('button', { name: 'Turn the next card' }));
  fireEvent.click(screen.getByRole('button', { name: 'Turn all' }));
};

describe('animations running', () => {
  test('the same inputs start animations under a feel (the stand-in sees them)', () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    open();
    inputs();
    expect(document.getAnimations().length).toBeGreaterThan(0);
  });

  test('under Off no element of the reveal has a running animation after any input', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    open();
    expect(document.getAnimations()).toEqual([]);
    inputs();
    expect(document.getAnimations()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(document.getAnimations()).toEqual([]);
  });
});
