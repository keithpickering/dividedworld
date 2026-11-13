import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Captions, FADE_MS, SAID_MS } from './Captions.tsx';
import { createCaptions, type Captions as Store } from './captions.ts';

let store: Store;
beforeEach(() => { store = createCaptions(); });
afterEach(() => {
  document.documentElement.removeAttribute('data-kb-motion');
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

  describe('over a dialog', () => {
    const rect = (r: { left: number; top: number; right: number; bottom: number }) => ({ ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) });
    const withDialog = (box: { left: number; top: number; right: number; bottom: number }) => {
      const scrim = document.createElement('div');
      scrim.className = 'kb-glass kb-glass-overlay';
      const dialog = document.createElement('div');
      dialog.className = 'kb-glass-dialog';
      dialog.setAttribute('role', 'dialog');
      scrim.append(dialog);
      document.body.append(scrim);
      dialog.getBoundingClientRect = () => rect(box);
      return scrim;
    };
    /* The bar rests at 730 to 760, and a lift moves it as the transform would. */
    const measure = (el: HTMLElement) => {
      if (!el.classList.contains('kb-captions-bar')) return rect({ left: 0, top: 0, right: 0, bottom: 0 });
      const lift = parseFloat(el.style.getPropertyValue('--kb-captions-lift') || '0');
      return rect({ left: 540, top: 730 - lift, right: 740, bottom: 760 - lift });
    };

    afterEach(() => { document.querySelectorAll('.kb-glass-overlay').forEach((el) => el.remove()); });

    test('a bar clear of the dialog is raised above its scrim, and keeps its place', async () => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return measure(this); });
      const scrim = withDialog({ left: 400, top: 100, right: 880, bottom: 600 });
      render(<Captions store={store} />);
      act(() => store.say({ text: 'Cheers', ms: 60_000 }));
      await waitFor(() => expect(bar()?.getAttribute('data-over-scrim')).toBe('true'));
      expect((bar() as HTMLElement).style.getPropertyValue('--kb-captions-lift')).toBe('0px');
      scrim.remove();
      await waitFor(() => expect(bar()?.getAttribute('data-over-scrim')).toBeNull());
    });

    test('a bar that meets the dialog is lifted to rest above it', async () => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return measure(this); });
      const scrim = withDialog({ left: 0, top: 400, right: 1280, bottom: 790 });
      render(<Captions store={store} />);
      act(() => store.say({ text: 'Cheers', ms: 60_000 }));
      await waitFor(() => expect(bar()?.getAttribute('data-over-scrim')).toBe('true'));
      expect((bar() as HTMLElement).style.getPropertyValue('--kb-captions-lift')).toBe('370px');
      scrim.remove();
    });

    test('with no dialog the bar is not raised and carries no lift', () => {
      render(<Captions store={store} />);
      act(() => store.say({ text: 'Cheers', ms: 60_000 }));
      expect(bar()?.getAttribute('data-over-scrim')).toBeNull();
      expect((bar() as HTMLElement).style.getPropertyValue('--kb-captions-lift')).toBe('');
    });
  });

  const osReduces = () => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('prefers-reduced-motion'), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  const goesAtOnce = () => {
    vi.useFakeTimers();
    try {
      render(<Captions store={store} />);
      act(() => store.say({ text: 'Boo', ms: 100 }));
      expect(bar()).not.toBeNull();
      act(() => { vi.advanceTimersByTime(100); });
      return bar() === null;
    } finally {
      vi.useRealTimers();
    }
  };

  test('under the player\'s reduced motion it goes at once, with no fade to wait for', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    expect(goesAtOnce()).toBe(true);
  });

  test('under the device\'s reduced motion, with no choice made, it goes at once', () => {
    osReduces();
    expect(goesAtOnce()).toBe(true);
  });

  test('the player\'s full motion beats the device\'s reduced motion: the fade is waited for', () => {
    osReduces();
    document.documentElement.setAttribute('data-kb-motion', 'full');
    expect(goesAtOnce()).toBe(false);
  });

  test('a short say leaves the live region after SAID_MS even though the say ended sooner', () => {
    vi.useFakeTimers();
    try {
      render(<Captions store={store} />);
      act(() => store.say({ text: 'Boo', ms: 500 }));
      act(() => { vi.advanceTimersByTime(600); });
      expect(status().textContent).toBe('Boo');
      act(() => { vi.advanceTimersByTime(SAID_MS); });
      expect(status().textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  test('saying the same words twice replaces the live region\'s node, so it is announced again', () => {
    render(<Captions store={store} />);
    act(() => store.say({ text: 'Boo', ms: 5000 }));
    const first = status().querySelector('p');
    act(() => store.say({ text: 'Boo', ms: 5000 }));
    const second = status().querySelector('p');
    expect(second?.textContent).toBe('Boo');
    expect(second).not.toBe(first);
  });

  test('a say during the fade-out keeps the bar', () => {
    vi.useFakeTimers();
    try {
      render(<Captions store={store} />);
      act(() => store.say({ text: 'One', ms: 100 }));
      act(() => { vi.advanceTimersByTime(100); });
      expect(bar()?.getAttribute('data-leaving')).toBe('true');
      act(() => store.say({ text: 'Two', ms: 5000 }));
      act(() => { vi.advanceTimersByTime(FADE_MS * 2); });
      expect(bar()?.textContent).toBe('Two');
      expect(bar()?.getAttribute('data-leaving')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test('unmounting removes --kb-captions-measured', () => {
    const view = render(<Captions store={store} />);
    act(() => store.say({ text: 'Cheers', ms: 5000 }));
    expect(document.documentElement.style.getPropertyValue('--kb-captions-measured')).not.toBe('');
    view.unmount();
    expect(document.documentElement.style.getPropertyValue('--kb-captions-measured')).toBe('');
  });
});
