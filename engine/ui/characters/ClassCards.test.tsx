import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Marks } from './ClassCards.tsx';

describe('Marks', () => {
  test('a class with splits draws its two cells facing each other and one bar, named as one image', () => {
    const label = 'Earns from a room split between hype and heat, hurt by the shrug';
    render(<Marks id="m" marks={{ label, splits: ['excitedNegative', 'excitedPositive'], hurts: ['boredNegative', 'calmPositive'] }} />);
    const img = screen.getByRole('img', { name: label });
    expect([...img.children].map((c) => c.getAttribute('data-kb-mark'))).toEqual(['splits', 'splits', 'hurts', 'hurts', null]);
    expect([...img.children].map((c) => c.getAttribute('data-kb-toward'))).toEqual(['right', 'left', null, null, null]);
    const bars = img.querySelectorAll('.kb-class-split-bar');
    expect(bars).toHaveLength(1);
    expect(bars[0]!.getAttribute('aria-hidden')).toBe('true');
  });

  test('a class without splits has no bar', () => {
    render(<Marks id="m" marks={{ label: 'Earns from hype', earns: ['excitedPositive'] }} />);
    expect(screen.getByRole('img').querySelector('.kb-class-split-bar')).toBeNull();
  });
});
