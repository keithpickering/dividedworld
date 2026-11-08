import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { Character } from '../data/api.ts';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';
import { Avatar } from './Avatar.tsx';

const character = (over: Partial<Character> = {}): Character => ({
  id: 'c1', name: 'Pipewrench', title: '', signature: '', avatarSquare: 'sq.webp', avatarPortrait: 'tall.webp',
  squareFrame: null, portraitFrame: null, pipStyle: 'default', pronouns: ENGINE_DEFAULT_PRONOUNS, joined: '2026-10-01', group: 'members', ...over,
});
const slot = (c: Character) => render(<Avatar character={c} />).container.querySelector('.kb-profile-avatar')!;

describe('the profile avatar', () => {
  test('a real portrait is marked as one, so its slot can take the portrait\'s own shape', () => {
    expect(slot(character())).toHaveAttribute('data-kb-slot', 'portrait');
  });

  test('a square standing in for a portrait keeps the tall slot, and the initial is no portrait', () => {
    expect(slot(character({ avatarPortrait: null }))).not.toHaveAttribute('data-kb-slot', 'portrait');
    expect(slot(character({ avatarPortrait: null, avatarSquare: null }))).not.toHaveAttribute('data-kb-slot', 'portrait');
  });
});

describe('the profile avatar slot, in the stylesheet', () => {
  const css = readFileSync('engine/ui/profile/profile.css', 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
  const rules = (selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter((m) => m[1]!.includes(selector)).map((m) => m[2]!);

  /* A portrait is any shape from 1:1 to 1:2 (profile-edit/frames.ts); a fixed 1:2 box with `cover` crops all but the tallest. */
  test('a portrait\'s slot takes the portrait\'s own shape, on a wide screen and on the phone', () => {
    const slots = rules('.kb-profile-avatar[data-kb-slot="portrait"]').filter((r) => !/\bimg\b/u.test(r));
    expect(slots.join('')).toMatch(/aspect-ratio:\s*auto\s*;/u);
    expect(slots.join('')).toMatch(/height:\s*auto\s*;/u);
    expect(rules('.kb-profile-avatar[data-kb-slot="portrait"] img').join('')).toMatch(/aspect-ratio:\s*auto 1 \/ 2\s*;/u);
    /* The phone's about layout fixes a 76 by 152 box; a portrait's slot must override it. */
    expect(css).toMatch(/\.kb-about \.kb-profile-avatar\[data-kb-slot="portrait"\]/u);
  });
});
