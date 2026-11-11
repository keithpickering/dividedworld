import { renderInWorld } from '../test-world.tsx';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { Character } from '../data/api.ts';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';
import { Avatar } from './Avatar.tsx';

const character = (over: Partial<Character> = {}): Character => ({
  id: 'c1', name: 'Pipewrench', title: '', signature: '', avatarSquare: 'sq.webp', avatarPortrait: 'tall.webp',
  squareFrame: null, portraitFrame: null, portraitTallness: null, outfit: [], trophies: [], pipStyle: 'default', pronouns: ENGINE_DEFAULT_PRONOUNS, joined: '2026-10-01', group: 'members', ...over,
});
const slot = (c: Character) => renderInWorld(<Avatar character={c} />).container.querySelector('.kb-profile-avatar')!;

describe('the profile avatar', () => {
  test('a real portrait is marked as one, so its slot can take the portrait\'s own shape', () => {
    expect(slot(character())).toHaveAttribute('data-kb-slot', 'portrait');
  });

  test('a square standing in for a portrait keeps the tall slot, and the initial is no portrait', () => {
    expect(slot(character({ avatarPortrait: null }))).not.toHaveAttribute('data-kb-slot', 'portrait');
    expect(slot(character({ avatarPortrait: null, avatarSquare: null }))).not.toHaveAttribute('data-kb-slot', 'portrait');
  });
});

describe('gear on the profile avatar', () => {
  test('a portrait wears its pieces and takes its tallness as the slot\'s aspect ratio', () => {
    const el = slot(character({ portraitTallness: 1.5, outfit: [{ gear: 'band', x: 0.5, y: 0, w: 0.5, turn: 0, layer: 0 }] }));
    expect((el as HTMLElement).style.aspectRatio).toBe('1 / 1.5');
    expect(el.querySelector('.kb-outfit')).toHaveAttribute('aria-hidden', 'true');
    expect(el.querySelectorAll('.kb-outfit img')).toHaveLength(1);
  });

  test('a mask with no portrait wears nothing', () => {
    expect(slot(character({ avatarPortrait: null, outfit: [{ gear: 'band', x: 0.5, y: 0, w: 0.5, turn: 0, layer: 0 }] })).querySelector('.kb-outfit')).toBeNull();
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
    expect(rules('.kb-profile-avatar[data-kb-slot="portrait"] > img').join('')).toMatch(/aspect-ratio:\s*auto 1 \/ 2\s*;/u);
    /* The phone's about layout fixes a 76 by 152 box; a portrait's slot must override it. */
    expect(css).toMatch(/\.kb-about \.kb-profile-avatar\[data-kb-slot="portrait"\]/u);
  });

  /* The design (cosmetics, section 2): gear may reach past the portrait, but the text around it always wins. */
  test('the avatar cell is its own layer, and the label, value and signature cells are above it, each on its own ground', () => {
    const decl = (sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter((m) => m[1]!.split(',').some((x) => x.trim() === sel)).map((m) => m[2]!).join('');
    const z = (d: string) => Number(/z-index:\s*(-?\d+)/u.exec(d)?.[1] ?? 'NaN');
    const cell = decl('.kb-about .kb-about-avatar');
    expect(cell).toMatch(/isolation:\s*isolate/u);
    expect(cell).toMatch(/position:\s*relative/u);
    expect(z(cell)).toBe(0);
    for (const sel of ['.kb-table.kb-about th.kb-about-label', '.kb-about .kb-about-value', '.kb-about .kb-about-sig']) {
      const d = decl(sel);
      expect(d, sel).toMatch(/position:\s*relative/u);
      expect(z(d), sel).toBeGreaterThan(z(cell));
    }
    expect(decl('.kb-table.kb-about th.kb-about-label')).toMatch(/background:\s*var\(--kb-row-3\)/u);
  });
});
