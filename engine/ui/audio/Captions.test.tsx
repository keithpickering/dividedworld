import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Captions } from './Captions.tsx';
import { createCaptions, type Captions as Store } from './captions.ts';

let store: Store;
beforeEach(() => { store = createCaptions(); });
afterEach(() => {
  document.documentElement.style.removeProperty('--kb-captions-measured');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const status = () => screen.getByRole('status');
const bar = () => document.querySelector('.kb-captions-bar');

describe('the caption bar', () => {
  test('is in the page with a polite live region, and draws nothing with nothing to say', () => {
    render(<Captions store={store} />);
    expect(status().getAttribute('aria-live')).toBe('polite');
    expect(bar()).toBeNull();
    expect(status().textContent).toBe('');
  });

  test('a say draws its words in sentence case and the live region holds them', () => {
    render(<Captions store={store} />);
    act(() => store.say({ text: 'Crowd laughs', ink: 'var(--kb-glass-salty)', ms: 5000 }));
    expect(bar()?.textContent).toBe('Crowd laughs');
    expect(status().textContent).toBe('Crowd laughs');
    expect(bar()?.getAttribute('aria-hidden')).toBe('true');
    const dot = bar()?.querySelector<HTMLElement>('.kb-captions-dot');
    expect(dot?.style.background).toContain('--kb-glass-salty');
  });

  test('it goes after ms', async () => {
    render(<Captions store={store} />);
    act(() => store.say({ text: 'Boo', ms: 40 }));
    expect(bar()).not.toBeNull();
    await waitFor(() => expect(bar()).toBeNull(), { timeout: 2000 });
  });

  test('a hold is drawn in italic and is not announced', () => {
    render(<Captions store={store} />);
    act(() => store.hold('loop', { text: 'Crowd murmuring' }));
    expect(bar()?.textContent).toBe('Crowd murmuring');
    expect(bar()?.getAttribute('data-held')).toBe('true');
    expect(status().textContent).toBe('');
  });

  test('a say over a hold is announced, and the hold is back drawn after it', async () => {
    render(<Captions store={store} />);
    act(() => store.hold('loop', { text: 'Crowd murmuring' }));
    act(() => store.say({ text: 'Boom', ms: 40 }));
    expect(bar()?.textContent).toBe('Boom');
    expect(bar()?.getAttribute('data-held')).toBeNull();
    expect(status().textContent).toBe('Boom');
    await waitFor(() => expect(bar()?.textContent).toBe('Crowd murmuring'), { timeout: 2000 });
    expect(bar()?.getAttribute('data-held')).toBe('true');
  });

  test('--kb-captions-measured is set while a caption shows (its height and the gap under it) and cleared after', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 30, width: 100, top: 0, left: 0, right: 100, bottom: 30, x: 0, y: 0, toJSON: () => ({}) });
    const root = document.documentElement;
    render(<Captions store={store} />);
    expect(root.style.getPropertyValue('--kb-captions-measured')).toBe('');
    act(() => store.say({ text: 'Cheers', ms: 40 }));
    expect(root.style.getPropertyValue('--kb-captions-measured')).toBe('40px');
    await waitFor(() => expect(root.style.getPropertyValue('--kb-captions-measured')).toBe(''), { timeout: 2000 });
  });

  test('under reduced motion it goes at once, with no fade to wait for', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('prefers-reduced-motion'), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.useFakeTimers();
    try {
      render(<Captions store={store} />);
      act(() => store.say({ text: 'Boo', ms: 100 }));
      expect(bar()).not.toBeNull();
      act(() => { vi.advanceTimersByTime(100); });
      expect(bar()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
