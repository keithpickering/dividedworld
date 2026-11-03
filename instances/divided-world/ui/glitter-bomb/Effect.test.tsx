/**
 * Glitter Bomb's effect (docs/plans/2026-11-01-card-reach-plan.md, Task 7): the character's posts sparkle while it is up. It is
 * decoration, so its accessible path is reduced motion alone, which holds the sparkle still; and the words stay readable at the house
 * style's contrast with the sparkle on, in every mode.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { parseColor, ratio, tokensOf } from '../../../../engine/ui/contrast.ts';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { GLITTER_ALPHA, GLITTER_INKS, GlitterBombEffect } from './Effect.tsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.resolve(here, p), 'utf8');

const post: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-01T12:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null };
const play: CardPlay = { id: 'g1', card: 'glitter-bomb', layer: 1, caster: 'c2', message: '', config: {}, playedAt: '2026-11-01T12:00:00Z', post: 'p1', reach: 'character', on: 'c1', ends: '2099-01-01T00:00:00Z' };
const props = (): EffectProps => ({
  post, plays: [play], states: {}, released: new Set(), reader: { author: false, caster: false }, place: 'thread', reach: 'character',
  show: () => {}, met: () => {}, holdScreen: () => {}, marks: null, save: async () => ({ ok: false, error: 'no' }), release: async () => ({ ok: false, error: 'no' }), nameOf: () => 'Spritey',
  children: <p data-kb-words>Hello there.</p>,
});

afterEach(() => document.documentElement.removeAttribute('data-kb-motion'));

describe('Glitter Bomb', () => {
  test('sparkles around the words, never over them, and hides the sparkle from a screen reader', () => {
    render(<GlitterBombEffect {...props()} />);
    const box = document.querySelector('[data-kb-glitter]') as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.querySelector('[data-kb-words]')).toHaveTextContent('Hello there.');
    const sparkle = box.querySelector('.dw-glitter-sparkle') as HTMLElement;
    expect(sparkle).toHaveAttribute('aria-hidden', 'true');
    expect(sparkle.querySelectorAll('.dw-glint').length).toBeGreaterThan(0);
  });

  test('under reduced motion it draws no animation: the sparkle holds still', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    render(<GlitterBombEffect {...props()} />);
    const box = document.querySelector('[data-kb-glitter]') as HTMLElement;
    expect(box).toHaveAttribute('data-kb-moving', 'false');
    for (const glint of box.querySelectorAll<HTMLElement>('.dw-glint')) expect(glint.style.animationName).toBe('none');
    /* And the stylesheet holds it still too, for the device's own setting. */
    expect(read('glitter.css')).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.dw-glint \{\s*animation: none;\s*\}/u);
    expect(read('glitter.css')).toMatch(/\.dw-glitter\[data-kb-moving="false"\] \.dw-glint \{\s*animation: none;\s*\}/u);
  });

  test('holds still the moment the player reduces motion, on a post already drawn, and moves again when they undo it', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    render(<GlitterBombEffect {...props()} />);
    const box = () => document.querySelector('[data-kb-glitter]') as HTMLElement;
    expect(box()).toHaveAttribute('data-kb-moving', 'true');
    await act(async () => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); });
    await waitFor(() => expect(box()).toHaveAttribute('data-kb-moving', 'false'));
    for (const glint of box().querySelectorAll<HTMLElement>('.dw-glint')) expect(glint.style.animationName).toBe('none');
    await act(async () => { document.documentElement.setAttribute('data-kb-motion', 'full'); });
    await waitFor(() => expect(box()).toHaveAttribute('data-kb-moving', 'true'));
  });

  test('moves where motion is not reduced', () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    render(<GlitterBombEffect {...props()} />);
    expect(document.querySelector('[data-kb-glitter]')).toHaveAttribute('data-kb-moving', 'true');
  });

  test('keeps the post\'s text at the house style\'s contrast with the sparkle on, in every mode, however the glints overlap', () => {
    const tokens = tokensOf(read('../../../../engine/ui/tokens.css'), read('../theme.css'));
    const mix = (fg: string, bg: string, a: number) => {
      const [f, b] = [parseColor(fg), parseColor(bg)];
      return `#${f.map((c, i) => Math.round(c * a + b[i]! * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
    };
    /* The layer is drawn at GLITTER_ALPHA, and nothing in it is lighter than solid: so one ink at GLITTER_ALPHA is the most a spot is covered. */
    render(<GlitterBombEffect {...props()} />);
    expect((document.querySelector('.dw-glitter-sparkle') as HTMLElement).style.opacity).toBe(String(GLITTER_ALPHA));
    const css = read('glitter.css').replace(/\/\*[\s\S]*?\*\//gu, '');
    expect(css).not.toMatch(/opacity/u);
    expect(css).not.toMatch(/mix-blend-mode|filter:/u);
    const rule = (selector: string) => { const at = css.indexOf(`${selector} {`); return at < 0 ? '' : css.slice(at, css.indexOf('}', at)); };
    expect(rule('.dw-glitter-sparkle')).toMatch(/pointer-events:\s*none/u);
    expect(rule('.dw-glitter-sparkle')).toMatch(/z-index:\s*0/u);
    expect(rule('.dw-glitter-words')).toMatch(/z-index:\s*1/u);
    expect(GLITTER_ALPHA).toBeGreaterThan(0);
    for (const [mode, t] of Object.entries(tokens)) {
      for (const surface of ['--kb-bg', '--kb-chip-bg']) {
        for (const ink of GLITTER_INKS) {
          const under = mix(ink, t[surface]!, GLITTER_ALPHA);
          for (const fg of ['--kb-fg', '--kb-link', '--kb-link-visited', '--kb-muted']) {
            expect(ratio(t[fg]!, under), `${mode}: ${fg} on ${ink} at ${GLITTER_ALPHA} over ${surface}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });
});
