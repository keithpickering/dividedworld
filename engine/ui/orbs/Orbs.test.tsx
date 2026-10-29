import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Orbs } from './Orbs.tsx';

const orbEls = () => [...document.querySelectorAll<HTMLElement>('.kb-orb')];
const solid = (el: HTMLElement) => Number(el.style.getPropertyValue('--kb-solid'));

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.setAttribute('data-kb-motion', 'full');
});
afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-kb-motion');
});

describe('the orbs', () => {
  test('draw the settled wallet, the hatched gain and the figures', () => {
    render(<Orbs settled={240} pending={85} cap={600} />);
    expect(screen.getByRole('img', { name: 'Wallet 2.40 of 6 orbs, 0.85 pending until the next settlement (estimate)' })).toBeInTheDocument();
    expect(orbEls().map(solid)).toEqual([1, 1, 0.4, 0, 0, 0]);
    expect(orbEls()[3]!.style.getPropertyValue('--kb-gain-to')).toBe('0.25');
    expect(screen.getByText('2.40')).toBeInTheDocument();
    expect(screen.getByText('+0.85 pending')).toBeInTheDocument();
  });
  test('a loss is a pale band and its figure is negative', () => {
    render(<Orbs settled={240} pending={-30} cap={600} />);
    expect(orbEls()[2]!.style.getPropertyValue('--kb-loss-from')).toBe('0.1');
    expect(screen.getByText('−0.30 pending')).toBeInTheDocument();
  });
  test('past the cap is said', () => {
    render(<Orbs settled={500} pending={140} cap={600} />);
    expect(screen.getByText('+0.40 past the cap')).toBeInTheDocument();
  });
  test('each orb takes its own color token', () => {
    render(<Orbs settled={0} pending={0} cap={600} />);
    expect(orbEls()[4]!.style.getPropertyValue('--kb-orb-color')).toBe('var(--kb-orb-5)');
  });
});

describe('the cascade at a settlement', () => {
  test('one orb a second from the last wallet seen, a flash on each that fills, ending on the new wallet', () => {
    const { rerender } = render(<Orbs settled={140} pending={0} cap={600} />);
    rerender(<Orbs settled={360} pending={0} cap={600} cascadeFrom={140} />);
    expect(orbEls().map(solid)).toEqual([1, 0.4, 0, 0, 0, 0]);
    act(() => vi.advanceTimersByTime(0));
    expect(orbEls().map(solid)).toEqual([1, 1, 0, 0, 0, 0]);
    expect(orbEls()[1]!.classList.contains('kb-orb--flash')).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(orbEls().map(solid)).toEqual([1, 1, 1, 0, 0, 0]);
    expect(orbEls()[2]!.classList.contains('kb-orb--flash')).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(orbEls().map(solid)).toEqual([1, 1, 1, 0.6, 0, 0]);
    expect(orbEls()[3]!.classList.contains('kb-orb--flash')).toBe(false);
  });
  test('reduced motion shows the end state at once, with no flash', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    const { rerender } = render(<Orbs settled={140} pending={0} cap={600} />);
    rerender(<Orbs settled={360} pending={0} cap={600} cascadeFrom={140} />);
    expect(orbEls().map(solid)).toEqual([1, 1, 1, 0.6, 0, 0]);
    expect(document.querySelectorAll('.kb-orb--flash')).toHaveLength(0);
  });
  test('the accessible name says the new wallet throughout, never a frame of the animation', () => {
    const { rerender } = render(<Orbs settled={140} pending={0} cap={600} />);
    rerender(<Orbs settled={360} pending={0} cap={600} cascadeFrom={140} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Wallet 3.60 of 6 orbs');
  });
});
