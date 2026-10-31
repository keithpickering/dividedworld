import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Orb, Orbs } from './Orbs.tsx';

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
    expect(screen.getByText('/ 6.00')).toBeInTheDocument();
    expect(screen.getByText('+0.85 est.')).toBeInTheDocument();
  });
  test('a loss is a pale band and its figure is negative', () => {
    render(<Orbs settled={240} pending={-30} cap={600} />);
    expect(orbEls()[2]!.style.getPropertyValue('--kb-loss-from')).toBe('0.1');
    expect(screen.getByText('−0.30 est.')).toBeInTheDocument();
  });
  test('past the cap is said', () => {
    render(<Orbs settled={500} pending={140} cap={600} />);
    expect(screen.getByText('+0.40 past the cap')).toBeInTheDocument();
  });
  test('a wallet past its cap marks its last orb, hidden from a screen reader since the name says it', () => {
    render(<Orbs settled={500} pending={140} cap={600} />);
    const marks = document.querySelectorAll('.kb-orb-over');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toBe(orbEls()[5]!.querySelector('.kb-orb-over'));
    expect(marks[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('img', { name: /past the cap/ })).toBeInTheDocument();
  });
  test('a wallet within its cap has no mark', () => {
    render(<Orbs settled={500} pending={50} cap={600} />);
    expect(document.querySelector('.kb-orb-over')).toBeNull();
  });
  test('each orb takes its own gradient from the glass, by its place in the row', () => {
    render(<Orbs settled={0} pending={0} cap={600} />);
    expect(orbEls()[4]!.style.getPropertyValue('--kb-orb-color')).toBe('var(--kb-glass-orb-5-color)');
    expect(orbEls()[4]!.style.getPropertyValue('--kb-orb-highlight')).toBe('var(--kb-glass-orb-5-highlight)');
    expect(orbEls()[4]!.style.getPropertyValue('--kb-orb-shade')).toBe('var(--kb-glass-orb-5-shade)');
  });
  test('in the glass\'s look the settled fill is a liquid risen from the bottom, the gain a ghost above it, a loss a pale band', () => {
    render(<Orbs settled={240} pending={-30} cap={600} />);
    const third = orbEls()[2]!;
    expect(third.querySelector('.kb-orb-liquid')).not.toBeNull();
    expect(third.querySelector('.kb-orb-pale')).not.toBeNull();
    expect(third.querySelector('.kb-orb-gloss')).not.toBeNull();
    const { unmount } = render(<Orbs settled={240} pending={85} cap={600} />);
    expect(orbEls().at(-3)!.querySelector('.kb-orb-ghost')).not.toBeNull();
    unmount();
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

describe('from the Task 3 quality review', () => {
  test('a spend drains from the last orb down, ending on the new wallet, with no flash', () => {
    const { rerender } = render(<Orbs settled={360} pending={0} cap={600} />);
    rerender(<Orbs settled={140} pending={0} cap={600} cascadeFrom={360} />);
    expect(orbEls().map(solid)).toEqual([1, 1, 1, 0.6, 0, 0]);
    act(() => vi.advanceTimersByTime(0));
    expect(orbEls().map(solid)).toEqual([1, 1, 1, 0, 0, 0]);
    act(() => vi.advanceTimersByTime(2000));
    expect(orbEls().map(solid)).toEqual([1, 0.4, 0, 0, 0, 0]);
    expect(document.querySelectorAll('.kb-orb--flash')).toHaveLength(0);
  });
  test('a cascade from the wallet it already shows is no cascade', () => {
    render(<Orbs settled={240} pending={0} cap={600} cascadeFrom={240} />);
    expect(orbEls().map(solid)).toEqual([1, 1, 0.4, 0, 0, 0]);
  });
  test('the first frame of a cascade is the wallet it starts from, never the end', () => {
    render(<Orbs settled={360} pending={0} cap={600} cascadeFrom={140} />);
    expect(orbEls().map(solid)).toEqual([1, 0.4, 0, 0, 0, 0]);
  });
  test("the figure is held to the wallet's floor and cap, as the orbs and the name are", () => {
    render(<Orbs settled={-50} pending={0} cap={600} />);
    expect(screen.getByText('0.00')).toBeInTheDocument();
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Wallet 0.00 of 6 orbs');
  });
});

describe('the orbs drawn apart from the wallet (the Orbs board, 04)', () => {
  test('a row may leave its figures to the page around it, and keeps its name', () => {
    render(<Orbs settled={462} pending={30} cap={600} figures={false} />);
    expect(screen.getByRole('img', { name: 'Wallet 4.62 of 6 orbs, 0.30 pending until the next settlement (estimate)' })).toBeInTheDocument();
    expect(screen.queryByText('4.62')).toBeNull();
    expect(screen.queryByText('/ 6.00')).toBeNull();
    expect(screen.queryByText('+0.30 est.')).toBeNull();
  });
  test('one orb is drawn alone from its fill and its place in the row, out of the reading order', () => {
    const { container } = render(<Orb fill={{ solid: 0.46, gainFrom: 0.46, gainTo: 0.66, lossFrom: 0.36, lossTo: 0.46 }} place={3} />);
    const orb = container.querySelector<HTMLElement>('.kb-orb')!;
    expect(orb).toHaveAttribute('aria-hidden', 'true');
    expect(orb.style.getPropertyValue('--kb-solid')).toBe('0.46');
    expect(orb.style.getPropertyValue('--kb-gain-to')).toBe('0.66');
    expect(orb.style.getPropertyValue('--kb-loss-from')).toBe('0.36');
    expect(orb.style.getPropertyValue('--kb-orb-color')).toBe('var(--kb-glass-orb-4-color)');
  });
  test("a still frame of the cascade's beat holds its flash or its shine, and moves nothing", () => {
    const full = { solid: 1, gainFrom: 0, gainTo: 0, lossFrom: 0, lossTo: 0 };
    const { container } = render(<><Orb fill={full} place={4} beat="flash" /><Orb fill={full} place={4} beat="shine" /><Orb fill={full} place={4} /></>);
    const [flash, shine, plain] = [...container.querySelectorAll<HTMLElement>('.kb-orb')];
    expect(flash).toHaveAttribute('data-kb-beat', 'flash');
    expect(shine).toHaveAttribute('data-kb-beat', 'shine');
    expect(plain).not.toHaveAttribute('data-kb-beat');
    expect(container.querySelector('.kb-orb--flash')).toBeNull();
  });
});

describe('the fills stand where their fractions say', () => {
  test('the gain and the loss are raised to where they start, not left at the bottom with the liquid', () => {
    render(<Orbs settled={462} pending={30} cap={600} />);
    const fifth = orbEls()[4]!;
    expect(getComputedStyle(fifth.querySelector('.kb-orb-liquid')!).bottom).toBe('0px');
    expect(getComputedStyle(fifth.querySelector('.kb-orb-ghost')!).bottom).toBe('calc(var(--kb-gain-from) * 100%)');
    expect(getComputedStyle(fifth.querySelector('.kb-orb-pale')!).bottom).toBe('calc(var(--kb-loss-from) * 100%)');
  });
});
