import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MODES, tokensOf } from '../contrast.ts';
import { renderInWorld } from '../test-world.tsx';
import { GroupBar } from './GroupBar.tsx';
import { GLOSS_SHARE, LETTERING, LIP_SHARE, STRIPE_SHARE, faceStops, reading } from './group-bar-face.ts';

const engine = readFileSync(join(process.cwd(), 'engine/ui/tokens.css'), 'utf8');
const css = readFileSync(join(process.cwd(), 'engine/ui/postbit/postbit.css'), 'utf8');
const tokens = tokensOf(engine);

const look = { key: 'regulars', name: 'Regulars', color: '#2f6fb0', stripe: false, staff: false };

describe('the group bar', () => {
  test('is the group name as real text, in the group color as a custom property', () => {
    renderInWorld(<GroupBar look={look} />);
    const bar = screen.getByText('Regulars');
    expect(bar.tagName).toBe('SPAN');
    expect(bar.className).toContain('kb-group-bar');
    expect(bar.style.getPropertyValue('--kb-group-color')).toBe('#2f6fb0');
    expect(bar).not.toHaveAttribute('data-kb-stripe');
  });

  test('a striped group says so, for the stylesheet to draw the stripes', () => {
    renderInWorld(<GroupBar look={{ ...look, key: 'trialMembers', name: 'Trial Members', stripe: true }} />);
    expect(screen.getByText('Trial Members')).toHaveAttribute('data-kb-stripe', '');
  });

  test('the stylesheet draws the shares the contrast reading measures, and the capitals are the stylesheet\'s over real text', () => {
    expect(css).toContain(`var(--kb-group-color) ${100 - GLOSS_SHARE}%, var(--kb-group-bar-gloss)`);
    expect(css).toContain(`var(--kb-group-color) ${100 - LIP_SHARE}%, var(--kb-group-bar-halo)`);
    expect(css).toContain(`var(--kb-group-color) ${100 - STRIPE_SHARE}%, var(--kb-group-bar-halo)`);
    expect(css).toMatch(/\.kb-group-bar\s*\{[^}]*text-transform:\s*uppercase/u);
  });
});

describe('the bar\'s lettering', () => {
  test('at the glyph edge, where the outline meets the face, the ink holds 4.5:1 in every mode, even on a very light color', () => {
    for (const mode of MODES) for (const color of ['#7a7a7a', '#f0f0f0', '#ffff00']) expect(reading(color, tokens[mode], false).edge, `${color} in ${mode}`).toBeGreaterThanOrEqual(LETTERING);
  });

  test('poison: a weak halo (mid gray) is measured as failing at the edge, and so is a halo the stylesheet does not draw as an outline', () => {
    const weak = { ...tokens.light, '--kb-group-bar-halo': '#888888' };
    expect(reading('#d4a017', weak, false).edge).toBeLessThan(LETTERING);
    const shadow = /\.kb-group-bar\s*\{[^}]*?text-shadow:([^;]*);/u.exec(css)![1]!.split(',').map((x) => x.trim().replace(/\s+/gu, ' '));
    expect(shadow.length).toBeGreaterThanOrEqual(8);
    for (const part of shadow) expect(part).toMatch(/^(?:0|-?1px) (?:0|-?1px) 0 var\(--kb-group-bar-halo\)$/u);
  });

  test('poison: a white-ish color is measured as failing alone, and a dark one as holding', () => {
    expect(reading('#f0f0f0', tokens.light, false).alone).toBe(false);
    expect(reading('#202040', tokens.light, false).alone).toBe(true);
  });

  test('the face is the gloss, the color and the lip; a stripe is the color and a darker one', () => {
    expect(faceStops('#2f6fb0', tokens.light, false)).toHaveLength(3);
    expect(faceStops('#2f6fb0', tokens.light, true)).toEqual(['#2f6fb0', expect.stringMatching(/^#[0-9a-f]{6}$/u)]);
  });
});
