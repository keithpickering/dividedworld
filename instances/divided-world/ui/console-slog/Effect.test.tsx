/**
 * Console Slog's terminal on a post (docs/plans/2026-11-27-season-two-cards-design.md, section 3; plan Task 8): a fresh key press or a tap types out the
 * next characters, a held key's repeats count for nothing, a steady rhythm makes each press worth more, the place is kept in the reader's browser and
 * survives a remount, the last character out releases the reader, and a released reader reads the post as written. Time is the test's own: `Date` is faked
 * and every pause is advanced, so a press's rhythm is exactly what the test says.
 */
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { viewProblems } from '../../../../engine/ui/cards/lens-words.ts';
import { NO_INK } from '../../../../engine/ui/cards/claims.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { ConsoleSlogEffect } from './Effect.tsx';

const NAME = 'Console Slog: press any key or tap to type out this post';
const postOf = (body: string): Act => ({ id: 'p1', character: 'author', kind: 'post', thread: 't1', targetActId: null, seq: 4471, createdAt: '2026-11-28T10:00:00Z', payload: { body }, currentPayload: { body }, editedAt: null } as unknown as Act);
/* Each test its own play: reader memory is the page's, so a play's place would otherwise carry from one test to the next. */
let n = 0;
let play: CardPlay;
const SIXTY = 'abcdefghij'.repeat(12);

beforeEach(() => {
  n++;
  play = { id: `s${n}`, card: 'console-slog', layer: 1, caster: 'caster', message: '', config: {}, playedAt: '2026-11-28T10:01:00.000Z', post: 'p1' };
  try { localStorage.clear(); } catch { /* the test's own storage */ }
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-28T12:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

interface Options { readonly releaseWith?: () => Promise<{ ok: boolean }>; readonly body?: string; readonly released?: boolean; readonly still?: boolean; readonly bands?: number; readonly reader?: { author: boolean; caster: boolean } }
function mount(o: Options = {}) {
  const release = vi.fn(async (id: string) => (o.releaseWith ? o.releaseWith() : { ok: true as const, value: { play: id, releasedAt: '2026-11-28T12:00:00.000Z' } }));
  const show = vi.fn<(view: CardView | null) => void>();
  const props = (body: string, released: boolean): EffectProps => ({
    covered: false, post: postOf(body), plays: [play], states: {}, released: released ? new Set([play.id]) : new Set(), written: new Map(), reader: o.reader ?? { author: false, caster: false }, place: 'thread', reach: 'post',
    still: o.still ?? false, moment: null, show, met: () => {}, ink: NO_INK, holdScreen: () => {}, marks: null, save: async () => ({ ok: false, error: 'no' }), release: release as unknown as EffectProps['release'],
    nameOf: () => 'Spritey', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null, children: <p data-words>As the author wrote it.</p>,
  });
  const settings = { cardSettings: { 'consoleSlog.rhythmMs': 450, 'consoleSlog.perStep': 5, 'consoleSlog.mostPerPress': 8, 'consoleSlog.drain': 12, 'consoleSlog.bands': o.bands ?? 16 } };
  /* The post is edited, and the play released, from outside: a host holds both, as the engine does. */
  let set: (next: { body: string; released: boolean }) => void = () => {};
  function Host() {
    const [now, setNow] = useState({ body: o.body ?? SIXTY, released: o.released ?? false });
    set = setNow;
    return <ConsoleSlogEffect {...props(now.body, now.released)} />;
  }
  const world = renderInWorld(<Host />, { settings });
  return { ...world, release, show, again: (body: string, released = false) => act(() => set({ body, released })) };
}
const region = () => screen.getByRole('button', { name: NAME });
const typed = () => document.querySelector('[data-kb-slog-shown]')?.textContent ?? '';
const press = (key = 'a', init: KeyboardEventInit = {}) => fireEvent.keyDown(region(), { key, ...init });
/** A slow mash: a pause past the rhythm before each press, so each is worth one character. */
const slow = (times: number, key = 'a') => { for (let i = 0; i < times; i++) { act(() => { vi.advanceTimersByTime(1000); }); press(key); } };
/** A fast mash: each press 100 ms after the last, in rhythm. */
const fast = (times: number): number[] => {
  const lengths: number[] = [];
  for (let i = 0; i < times; i++) { act(() => { vi.advanceTimersByTime(100); }); press(); lengths.push(typed().length); }
  return lengths;
};

describe('Console Slog', () => {
  test('is an empty command prompt with the post\'s number, a cursor and a button the page can name', () => {
    mount();
    expect(typed()).toBe('');
    expect(screen.getByText('C:\\DW\\POSTS> type 4471.txt')).toBeInTheDocument();
    expect(document.querySelector('[data-kb-cursor]')).not.toBeNull();
    expect(region()).toHaveAttribute('tabindex', '0');
    expect(screen.queryByText('As the author wrote it.')).toBeNull();
  });

  test('a key press reveals one character, and a held key\'s repeats reveal none', () => {
    mount();
    slow(1, 'x');
    expect(typed()).toBe('a');
    act(() => { vi.advanceTimersByTime(1000); });
    press('q', { repeat: true });
    press('q', { repeat: true });
    expect(typed()).toBe('a');
    slow(1);
    expect(typed()).toBe('ab');
  });

  test('only typing keys press: a shortcut, a modifier, Tab, function keys, arrows, paging, Escape and a composing key are left alone', () => {
    mount();
    const left = [{ key: 'Shift' }, { key: 'Control' }, { key: 'Tab' }, { key: 'Escape' }, { key: 'F5' }, { key: 'ArrowDown' }, { key: 'PageDown' }, { key: 'Home' }, { key: 'End' },
      { key: 'c', ctrlKey: true }, { key: 'r', metaKey: true }, { key: 'a', isComposing: true }, { key: 'Process' }];
    for (const init of left) {
      const notPrevented = fireEvent.keyDown(region(), init);
      expect(notPrevented, `${init.key} is not prevented`).toBe(true);
    }
    expect(typed()).toBe('');
    for (const key of [' ', 'Enter', 'Backspace', 'é']) {
      act(() => { vi.advanceTimersByTime(1000); });
      expect(fireEvent.keyDown(region(), { key }), `${key} is a press and is prevented`).toBe(false);
    }
    expect(typed().length).toBe(4);
  });

  test('a real tap (pointer down, then its click) reveals once, and a click with no pointer reveals once', () => {
    mount();
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.pointerDown(region());
    fireEvent.click(region(), { detail: 1 });
    expect(typed()).toBe('a');
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.click(region(), { detail: 0 });
    expect(typed()).toBe('ab');
  });

  test('a release that did not land (refused, or rejected) is tried again on the next press, once', async () => {
    for (const fail of [async () => ({ ok: false }), async () => { throw new Error('offline'); }]) {
      let calls = 0;
      const { release, unmount } = mount({ body: 'abc', releaseWith: async () => (calls++ === 0 ? fail() : { ok: true }) });
      slow(3);
      await act(async () => {});
      expect(release).toHaveBeenCalledTimes(1);
      slow(1);
      await act(async () => {});
      expect(release).toHaveBeenCalledTimes(2);
      slow(2);
      await act(async () => {});
      expect(release, 'once it landed it is not asked again').toHaveBeenCalledTimes(2);
      unmount();
      play = { ...play, id: `${play.id}-f` };
    }
  });

  test('what is stored under a reader\'s key that is no count reads as a fresh start, and a count past the post is clamped', () => {
    for (const stored of ['{"shown":-3}', '{"shown":"4"}', '{"shown":null}', '{"shown":1.5}', 'NaN', 'not json', '[]']) {
      play = { ...play, id: `${play.id}-g` };
      localStorage.setItem(`kb-reader:${play.id}`, stored);
      const { unmount } = mount();
      expect(typed(), stored).toBe('');
      unmount();
    }
    play = { ...play, id: `${play.id}-h` };
    localStorage.setItem(`kb-reader:${play.id}`, '{"shown":9999}');
    mount();
    expect(typed().length).toBe(SIXTY.length);
  });

  test('a tap or a click reveals the same, and a click that is no pointer (an assistive press) too', () => {
    mount();
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.pointerDown(region());
    expect(typed()).toBe('a');
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.click(region(), { detail: 0 });
    expect(typed()).toBe('ab');
  });

  test('twenty quick presses reveal more each as the streak builds, to the most, and a pause starts again at one', () => {
    mount();
    const lengths = fast(20);
    const each = lengths.map((l, i) => l - (lengths[i - 1] ?? 0));
    expect(each[0]).toBe(1);
    expect(each.at(-1)).toBeGreaterThan(each[0]!);
    expect(each).toEqual([...each].sort((a, b) => a - b));
    expect(Math.max(...each)).toBeLessThanOrEqual(8);
    expect(lengths.at(-1)).toBe(50);
    act(() => { vi.advanceTimersByTime(10_000); });
    press();
    expect(typed().length - 50).toBe(1);
  });

  test('the place survives a remount, from the reader\'s memory', () => {
    const first = mount();
    slow(7);
    expect(typed()).toBe('abcdefg');
    first.unmount();
    mount();
    expect(typed()).toBe('abcdefg');
    slow(1);
    expect(typed()).toBe('abcdefgh');
  });

  test('another play keeps its own place', () => {
    const first = mount();
    slow(4);
    first.unmount();
    play = { ...play, id: `${play.id}-other` };
    mount();
    expect(typed()).toBe('');
  });

  test('an edit keeps a reader\'s count, trimmed to the new length', () => {
    const { again, release } = mount();
    slow(30);
    again('abcdefghij abcdefghij');
    expect(typed()).toBe('abcdefghij abcdefghij');
    expect(release).toHaveBeenCalledWith(play.id);
    again(SIXTY);
    expect(typed().length).toBe(21);
  });

  test('the last unit out calls release, once', () => {
    const { release } = mount({ body: 'abc' });
    slow(2);
    expect(release).not.toHaveBeenCalled();
    slow(1);
    expect(typed()).toBe('abc');
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(play.id);
    slow(3);
    expect(release).toHaveBeenCalledTimes(1);
  });

  test('a released play draws the post as written, for the author and the caster too', () => {
    for (const reader of [{ author: false, caster: false }, { author: true, caster: false }, { author: false, caster: true }]) {
      const { unmount } = mount({ released: true, reader });
      expect(screen.getByText('As the author wrote it.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: NAME })).toBeNull();
      unmount();
    }
  });

  test('the same mash for the author and the caster: neither starts further along', () => {
    for (const reader of [{ author: true, caster: false }, { author: false, caster: true }]) {
      const { unmount } = mount({ reader });
      expect(typed()).toBe('');
      slow(1);
      expect(typed()).toBe('a');
      unmount();
      try { localStorage.clear(); } catch { /* */ }
      play = { ...play, id: `${play.id}-r` };
    }
  });

  test('a link works once all of it is out, text and address', () => {
    mount({ body: 'go [url=https://e.test/x]here[/url]' });
    slow(25);
    expect(typed()).toBe('go here [https://e.test/x');
    expect(screen.queryByRole('link')).toBeNull();
    slow(1);
    expect(typed()).toBe('go here [https://e.test/x]');
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://e.test/x');
  });

  test('a quote prints behind "> "', () => {
    mount({ body: '[quote=0f8fad5b-d9cb-469f-a165-70867728950e]hm[/quote]yes' });
    slow(9);
    expect(typed()).toBe('> hm\nyes');
  });

  test('an image prints its name line, then loads in green phosphor a band a press, and nothing reads a pixel of it', () => {
    mount({ body: '[img]https://e.test/pics/p.png[/img]', bands: 4 });
    slow(12);
    expect(typed()).toBe('[IMG] p.png\n');
    const box = () => document.querySelector<HTMLElement>('[data-kb-slog-image]');
    expect(box(), 'its box is laid out from the first press, hidden, so the post does not grow').not.toBeNull();
    expect(box()).toHaveAttribute('data-kb-bands-out', '0');
    expect(box()!.querySelector('.dw-slog-mask')).toHaveStyle({ top: '0%' });
    slow(2);
    expect(box()).toHaveAttribute('data-kb-bands-out', '2');
    expect(box()!.querySelector('img')).toHaveAttribute('src', 'https://e.test/pics/p.png');
    expect(box()!.querySelector('img')).toHaveAttribute('alt', '');
    expect(document.querySelector('canvas')).toBeNull();
    slow(2);
    expect(box()).toHaveAttribute('data-kb-bands-out', '4');
  });

  test('in History (still) the terminal is drawn whole, with no input and no blinking cursor', () => {
    mount({ still: true, body: 'abc def' });
    expect(screen.queryByRole('button', { name: NAME })).toBeNull();
    expect(document.querySelector('[data-kb-slog-shown]')?.textContent).toBe('abc def');
    expect(document.querySelector('[data-kb-cursor]')).toHaveAttribute('data-kb-still');
  });

  test('the Lens is told how far it has gone, in words that are true', () => {
    const { show } = mount({ body: 'abcdefghij' });
    slow(5);
    const view = show.mock.calls.filter((c) => c[0] !== null).at(-1)![0]!;
    expect(view.progress).toBeCloseTo(0.5);
    expect(view.state).toBe('5 of 10 typed for you');
    expect(view.yours).toBe(true);
    expect(viewProblems(view, { holds: false, covers: false })).toEqual([]);
  });
});
