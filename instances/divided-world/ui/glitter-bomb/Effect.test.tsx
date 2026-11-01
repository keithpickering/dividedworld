/**
 * Glitter Bomb's effect (docs/plans/2026-11-01-card-reach-plan.md, Task 7): the character's posts sparkle while it is up. It is
 * decoration, so its accessible path is reduced motion alone, which holds the sparkle still; and the words stay readable at the house
 * style's contrast with the sparkle on, in every mode.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/react';
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
  show: () => {}, met: () => {}, marks: null, save: async () => ({ ok: false, error: 'no' }), release: async () => ({ ok: false, error: 'no' }), nameOf: () => 'Spritey',
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
    expect(read('glitter.css')).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.dw-glint[\s\S]*animation: none/u);
    expect(read('glitter.css')).toMatch(/\[data-kb-moving="false"\] \.dw-glint[\s\S]*animation: none/u);
  });

  test('moves where motion is not reduced', () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    render(<GlitterBombEffect {...props()} />);
    expect(document.querySelector('[data-kb-glitter]')).toHaveAttribute('data-kb-moving', 'true');
  });

  test('keeps the post\'s text at the house style\'s contrast with the sparkle on, in every mode', () => {
    const tokens = tokensOf(read('../../../../engine/ui/tokens.css'), read('../theme.css'));
    const mix = (fg: string, bg: string, a: number) => {
      const [f, b] = [parseColor(fg), parseColor(bg)];
      return `#${f.map((c, i) => Math.round(c * a + b[i]! * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
    };
    expect(GLITTER_ALPHA).toBeGreaterThan(0);
    for (const [mode, t] of Object.entries(tokens)) {
      for (const ink of GLITTER_INKS) {
        const under = mix(ink, t['--kb-bg']!, GLITTER_ALPHA);
        for (const fg of ['--kb-fg', '--kb-link', '--kb-muted']) {
          expect(ratio(t[fg]!, under), `${mode}: ${fg} on ${ink} at ${GLITTER_ALPHA}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
