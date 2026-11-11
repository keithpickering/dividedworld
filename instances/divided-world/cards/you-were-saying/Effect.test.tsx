/**
 * You Were Saying?'s tail on a post (docs/plans/2026-11-07-you-were-saying-plan.md, Task 8; the design's sections 5, 6, 8 and 14): every
 * chained tail as one run of terminal text after the post's words, typed in each time the post comes into view, erased from the end by a
 * hold (a pointer or Backspace, one clock: erase.ts), back again when the hold stops early, saved as cleared when the author erases it
 * all. The observer is faked as Glitter Bomb's test fakes it and the timers are the test's own, so every second here is advanced.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Act, EffectState } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, CardView, EffectProps, Written } from '../../../../engine/ui/cards/types.ts';
import { ratio } from '../../../../engine/ui/contrast.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { YouWereSayingEffect } from './Effect.tsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.resolve(here, p), 'utf8');

const post: Act = { id: 'p1', character: 'author', kind: 'post', thread: 't1', targetActId: null, seq: 3, createdAt: '2026-11-07T10:00:00Z', payload: { body: 'The old voice' }, currentPayload: { body: 'The old voice' }, editedAt: null } as unknown as Act;
const playOf = (n: number): CardPlay => ({ id: `y${n}`, card: 'you-were-saying', layer: n, caster: `c${n}`, message: '', config: { steps: 0 }, playedAt: `2026-11-07T10:0${n}:00.000Z`, post: 'p1' });
const ok = async (play: string) => ({ ok: true as const, value: { play, savedAt: '2026-11-07T11:00:00.000Z' } });
/* 60 characters in one tail, 30 and 30 in two. */
const SIXTY = '0123456789'.repeat(6);
const text = (t: string): Written => ({ text: t });

let observers: { cb: IntersectionObserverCallback; seen: Set<Element> }[] = [];
class FakeObserver {
  readonly entry = { cb: undefined as unknown as IntersectionObserverCallback, seen: new Set<Element>() };
  constructor(cb: IntersectionObserverCallback) { this.entry.cb = cb; observers.push(this.entry); }
  observe(el: Element) { this.entry.seen.add(el); }
  unobserve(el: Element) { this.entry.seen.delete(el); }
  disconnect() { this.entry.seen.clear(); }
  takeRecords() { return []; }
}
/** The tail comes into view (or leaves it). */
const see = (showing: boolean) => act(() => {
  for (const o of observers) for (const el of o.seen) o.cb([{ target: el, isIntersecting: showing, intersectionRatio: showing ? 1 : 0 } as IntersectionObserverEntry], o as unknown as IntersectionObserver);
});
const tick = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });

interface Options {
  readonly plays?: CardPlay[]; readonly written?: Record<string, Written>; readonly states?: Record<string, EffectState>;
  readonly version?: string | null; readonly author?: boolean; readonly still?: boolean; readonly save?: EffectProps['save'];
}
interface Live { written: Record<string, Written>; states: Record<string, EffectState>; version: string | null }
function mount(o: Options = {}) {
  const save = vi.fn(o.save ?? (ok as unknown as EffectProps['save']));
  const views: (CardView | null)[] = [];
  const plays = o.plays ?? [playOf(1)];
  let set: (next: Partial<Live>) => void = () => {};
  function Host() {
    const [live, setLive] = useState<Live>({ written: o.written ?? { y1: text(SIXTY) }, states: o.states ?? {}, version: o.version === undefined ? 'v1' : o.version });
    set = (next) => setLive((was) => ({ ...was, ...next }));
    return (
      <YouWereSayingEffect
        post={post} plays={plays} states={live.states} released={new Set()} written={new Map(Object.entries(live.written))} {...(live.version === null ? {} : { version: live.version })}
        reader={{ author: o.author ?? false, caster: false }} place="thread" reach="post" still={o.still ?? false} save={save}
        release={async (play) => ({ ok: true, value: { play, releasedAt: '' } })} show={(v) => { views.push(v); }} met={() => {}} holdScreen={() => {}} marks={null} nameOf={() => 'Spritey'}
      >
        <p data-words>The old voice</p>
      </YouWereSayingEffect>
    );
  }
  const world = renderInWorld(<Host />, { settings: { cardSettings: { 'youWereSaying.eraseCps': 6, 'youWereSaying.retypeMs': 2000, 'youWereSaying.typeCps': 40 } } });
  return { ...world, save, views, change: (next: Partial<Live>) => act(() => set(next)), redraw: (w: Record<string, Written>) => act(() => set({ written: w })) };
}
const block = () => document.querySelector<HTMLElement>('[data-kb-tail]');
const blocks = () => [...document.querySelectorAll<HTMLElement>('[data-kb-tail]')];
const spans = () => [...document.querySelectorAll<HTMLElement>('[data-kb-tail] [data-play]')];
const shownText = () => spans().map((s) => s.textContent).join('');
const cursor = () => document.querySelector<HTMLElement>('[data-kb-cursor]');
const UNSAVED = 'It\'s erased on your screen, but it didn\'t save. Hold to try again.';
const status = () => document.querySelector<HTMLElement>('[role="status"][data-kb-report]')?.textContent?.replace(/ /gu, '') ?? '';
/** The pointer held on the block, and the same through Backspace on it. */
const pointer = { down: (el: HTMLElement) => fireEvent.pointerDown(el, { button: 0, pointerType: 'mouse' }), up: (el: HTMLElement) => fireEvent.pointerUp(el, { button: 0, pointerType: 'mouse' }) };
const key = { down: (el: HTMLElement) => fireEvent.keyDown(el, { key: 'Backspace' }), up: (el: HTMLElement) => fireEvent.keyUp(el, { key: 'Backspace' }) };
/** Typed in to the end, seen: every test that holds starts here. */
async function seenAndTyped() { await see(true); await tick(3000); }

beforeEach(() => {
  vi.useFakeTimers();
  observers = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  document.documentElement.setAttribute('data-kb-motion', 'full');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-kb-motion');
});

describe('the tail', () => {
  test('draws the post\'s words and one block after them, marked as a tail', () => {
    mount();
    expect(document.querySelector('[data-words]')).not.toBeNull();
    expect(blocks()).toHaveLength(1);
    expect(document.querySelector('[data-words]')!.nextElementSibling).toBe(block());
  });

  test('types in each time the post comes into view, and replays when it comes back', async () => {
    mount();
    await see(true);
    expect(shownText()).toBe('');
    await tick(250);
    expect(shownText()).toBe(SIXTY.slice(0, 10));
    await tick(2000);
    expect(shownText()).toBe(SIXTY);
    await see(false);
    expect(shownText()).toBe(SIXTY);
    await see(true);
    expect(shownText()).toBe('');
    await tick(500);
    expect(shownText()).toBe(SIXTY.slice(0, 20));
  });

  test('a tear shows while it types and stops when it is done; the cursor stays at the end', async () => {
    mount();
    await see(true);
    await tick(250);
    expect(block()!.hasAttribute('data-kb-typing')).toBe(true);
    expect(cursor()).not.toBeNull();
    await tick(2000);
    expect(block()!.hasAttribute('data-kb-typing')).toBe(false);
    expect(cursor()).not.toBeNull();
    expect(block()!.lastElementChild).toBe(cursor());
  });

  test('stops every timer when it is full, when it is out of view and when it unmounts', async () => {
    const { unmount } = mount();
    await see(true);
    await tick(250);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await tick(3000);
    expect(vi.getTimerCount()).toBe(0);
    await see(true);
    await tick(250);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await see(false);
    expect(vi.getTimerCount()).toBe(0);
    await see(true);
    await tick(100);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a waiting generation draws the cursor and no words; the text that arrives types in', async () => {
    const m = mount({ written: { y1: { waiting: true } } });
    await see(true);
    await tick(1000);
    expect(shownText()).toBe('');
    expect(cursor()).not.toBeNull();
    expect(block()!.hasAttribute('data-kb-typing')).toBe(false);
    m.redraw({ y1: text(SIXTY) });
    expect(shownText()).toBe('');
    await tick(250);
    expect(shownText()).toBe(SIXTY.slice(0, 10));
    await tick(2000);
    expect(shownText()).toBe(SIXTY);
  });

  test('a chain draws the texts that exist, then the waiting cursor at the end', async () => {
    mount({ plays: [playOf(1), playOf(2)], written: { y1: text('First words.'), y2: { waiting: true } } });
    await seenAndTyped();
    expect(shownText()).toBe('First words.');
    expect(block()!.lastElementChild).toBe(cursor());
  });

  test('a play that failed is over: it draws nothing, and the others chain without it', async () => {
    mount({ plays: [playOf(1), playOf(2), playOf(3)], written: { y1: text('One. '), y2: { failed: true }, y3: text('Three.') } });
    await seenAndTyped();
    expect(spans().map((s) => s.dataset.play)).toEqual(['y1', 'y3']);
    expect(shownText()).toBe('One. Three.');
  });

  test('every play failed: no tail, no cursor, no block; the words stay', () => {
    mount({ plays: [playOf(1), playOf(2)], written: { y1: { failed: true }, y2: { failed: true } } });
    expect(block()).toBeNull();
    expect(cursor()).toBeNull();
    expect(document.querySelector('[data-words]')).not.toBeNull();
  });

  test('a play with nothing known yet draws nothing', () => {
    mount({ written: {} });
    expect(block()).toBeNull();
  });

  test('two plays are two spans in play order inside one block, which is the only focusable control', async () => {
    mount({ plays: [playOf(1), playOf(2)], written: { y1: text('a'.repeat(30)), y2: text('b'.repeat(30)) } });
    await seenAndTyped();
    expect(blocks()).toHaveLength(1);
    expect(spans().map((s) => s.dataset.play)).toEqual(['y1', 'y2']);
    expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(block()!.getAttribute('tabindex')).toBe('0');
    expect(block()!.getAttribute('role')).toBe('button');
  });

  test('a hold erases across the chained tails from the very end', async () => {
    mount({ plays: [playOf(1), playOf(2)], written: { y1: text('a'.repeat(30)), y2: text('b'.repeat(30)) } });
    await seenAndTyped();
    pointer.down(block()!);
    await tick(3000);
    expect(spans()[0]!.textContent).toBe('a'.repeat(30));
    expect(spans()[1]!.textContent).toBe('b'.repeat(12));
    await tick(3000);
    expect(spans()[1]!.textContent).toBe('');
    expect(spans()[0]!.textContent).toBe('a'.repeat(24));
  });

  test('its name says what it continued and how it is erased, from the whole text and not what has typed so far', async () => {
    mount({ plays: [playOf(1), playOf(2)], written: { y1: text(' First. '), y2: text('Second.') } });
    await see(true);
    const name = 'Continued by You Were Saying?: First. Second. Hold to erase, or press Enter to start erasing and Enter again to stop. It comes back if you stop.';
    expect(block()!.getAttribute('aria-label')).toBe(name);
    await tick(3000);
    expect(block()!.getAttribute('aria-label')).toBe(name);
  });
});

describe('the hold', () => {
  const holds = {
    pointer: async () => { pointer.down(block()!); await tick(5000); },
    keyboard: async () => { block()!.focus(); key.down(block()!); await tick(5000); },
  };
  test.each(Object.keys(holds) as (keyof typeof holds)[])('%s: 5 seconds at 6 characters a second leaves 30', async (how) => {
    mount();
    await seenAndTyped();
    await holds[how]();
    expect(shownText()).toBe(SIXTY.slice(0, 30));
  });

  test('Backspace held erases as the pointer does, and the repeat rate of the key is not the clock', async () => {
    mount();
    await seenAndTyped();
    block()!.focus();
    for (let i = 0; i < 100; i++) { fireEvent.keyDown(block()!, { key: 'Backspace', repeat: i > 0 }); await tick(50); }
    expect(shownText()).toBe(SIXTY.slice(0, 30));
  });

  test('the key\'s default is prevented while it is held on the block, and other keys are left alone', async () => {
    mount();
    await seenAndTyped();
    block()!.focus();
    expect(key.down(block()!)).toBe(false);
    expect(fireEvent.keyDown(block()!, { key: 'Delete' })).toBe(true);
    expect(fireEvent.keyDown(block()!, { key: 'a' })).toBe(true);
    await tick(2000);
    expect(shownText()).toBe(SIXTY.slice(0, 48));
  });

  test('a release before the end waits two seconds and then types all of it back in', async () => {
    mount();
    await seenAndTyped();
    pointer.down(block()!);
    await tick(5000);
    pointer.up(block()!);
    await tick(1900);
    expect(shownText()).toBe(SIXTY.slice(0, 30));
    await tick(200);
    expect(shownText().length).toBeGreaterThan(30);
    await tick(1000);
    expect(shownText()).toBe(SIXTY);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('leaving the block, losing the pointer and losing focus each let go', async () => {
    mount();
    await seenAndTyped();
    pointer.down(block()!);
    await tick(1000);
    fireEvent.pointerLeave(block()!);
    await tick(1000);
    expect(shownText()).toBe(SIXTY.slice(0, 54));
    pointer.down(block()!);
    await tick(1000);
    fireEvent.pointerCancel(block()!);
    await tick(1000);
    expect(shownText()).toBe(SIXTY.slice(0, 48));
    block()!.focus();
    key.down(block()!);
    await tick(1000);
    fireEvent.blur(block()!);
    await tick(1000);
    expect(shownText()).toBe(SIXTY.slice(0, 42));
  });

  test('a pointer and a key held together are one hold, ended when both are up', async () => {
    mount();
    await seenAndTyped();
    block()!.focus();
    pointer.down(block()!);
    key.down(block()!);
    await tick(1000);
    pointer.up(block()!);
    await tick(1000);
    expect(shownText()).toBe(SIXTY.slice(0, 48));
    key.up(block()!);
    await tick(1000);
    expect(shownText()).toBe(SIXTY.slice(0, 48));
  });

  test('a press on it prevents the text selection, and the long-press menu is not opened while it is held', async () => {
    mount();
    await seenAndTyped();
    expect(pointer.down(block()!)).toBe(false);
    expect(fireEvent.contextMenu(block()!)).toBe(false);
    pointer.up(block()!);
  });

  test('a secondary button starts nothing', async () => {
    mount();
    await seenAndTyped();
    fireEvent.pointerDown(block()!, { button: 2, pointerType: 'mouse' });
    await tick(3000);
    expect(shownText()).toBe(SIXTY);
  });

  test('the stylesheet lets a finger scroll the page from the tail and keeps a hold from selecting', () => {
    const css = read('./tail.css');
    expect(css).toMatch(/touch-action:\s*pan-x pan-y pinch-zoom/u);
    expect(css).toMatch(/user-select:\s*none/u);
    expect(css).toMatch(/-webkit-touch-callout:\s*none/u);
    expect(css).toMatch(/\[data-kb-tail\]:focus-visible/u);
  });

  test('a screen reader hears the start and the end of an erase, and no progress between', async () => {
    mount();
    await seenAndTyped();
    const heard: string[] = [];
    const watch = new MutationObserver(() => heard.push(status()));
    watch.observe(document.body, { subtree: true, childList: true, characterData: true });
    expect(status()).toBe('');
    block()!.focus();
    key.down(block()!);
    await tick(500);
    expect(status()).toBe('Erasing. Keep holding to erase all of it.');
    await tick(3000);
    expect(status()).toBe('Erasing. Keep holding to erase all of it.');
    await tick(7000);
    expect(status()).toBe('Erased on your screen. It comes back when the page reloads.');
    expect(new Set(heard.filter(Boolean))).toEqual(new Set(['Erasing. Keep holding to erase all of it.', 'Erased on your screen. It comes back when the page reloads.']));
    expect(document.querySelector('[role="status"][data-kb-report]')!.getAttribute('aria-live')).toBe('polite');
    watch.disconnect();
  });
});

describe('a clear', () => {
  test('the author erasing the last character saves the cleared version on every live play, once each, and the tail is gone', async () => {
    const { save } = mount({ author: true, plays: [playOf(1), playOf(2), playOf(3)], written: { y1: text('a'.repeat(30)), y2: text('b'.repeat(30)), y3: { failed: true } } });
    await seenAndTyped();
    pointer.down(block()!);
    await tick(9000);
    expect(save).not.toHaveBeenCalled();
    await tick(2000);
    await tick(10_000);
    expect(save.mock.calls).toEqual([['y1', { cleared: 'v1' }], ['y2', { cleared: 'v1' }]]);
    expect(block()).toBeNull();
    expect(cursor()).toBeNull();
    expect(document.querySelector('[data-words]')).not.toBeNull();
  });

  test('a waiting play is saved too, since it is live on the post', async () => {
    const { save } = mount({ author: true, plays: [playOf(1), playOf(2)], written: { y1: text('a'.repeat(30)), y2: { waiting: true } } });
    await seenAndTyped();
    pointer.down(block()!);
    await tick(6000);
    expect(save.mock.calls.map((c) => c[0])).toEqual(['y1', 'y2']);
  });

  test('a reader\'s clear saves nothing and lasts while the page does', async () => {
    const { save } = mount({ author: false });
    await seenAndTyped();
    pointer.down(block()!);
    await tick(11_000);
    expect(save).not.toHaveBeenCalled();
    expect(block()).toBeNull();
    expect(status()).toBe('Erased on your screen. It comes back when the page reloads.');
    await see(false);
    await see(true);
    await tick(3000);
    expect(block()).toBeNull();
  });

  test('where the version is not known nothing is saved, and the author is told so and the tail comes back', async () => {
    const { save } = mount({ author: true, version: null });
    await seenAndTyped();
    pointer.down(block()!);
    await tick(11_000);
    expect(save).not.toHaveBeenCalled();
    expect(status()).toBe(UNSAVED);
    expect(block()).not.toBeNull();
  });

  test('a clear saved for the version drawn means no tail for anyone; one for an older version draws it', async () => {
    mount({ states: { y1: { state: { cleared: 'v1' }, savedAt: 'x' } } });
    expect(block()).toBeNull();
    expect(cursor()).toBeNull();
    cleanup();
    mount({ states: { y1: { state: { cleared: 'v0' }, savedAt: 'x' } } });
    expect(block()).not.toBeNull();
  });

  test('a clear of one play leaves the others\' tails drawn', async () => {
    mount({ plays: [playOf(1), playOf(2)], written: { y1: text('One. '), y2: text('Two.') }, states: { y1: { state: { cleared: 'v1' }, savedAt: 'x' } } });
    await seenAndTyped();
    expect(spans().map((s) => s.dataset.play)).toEqual(['y2']);
    expect(shownText()).toBe('Two.');
  });

  test('an edit makes a new version with no clear, so the tail comes back and types in again', async () => {
    const m = mount({ author: false, version: 'v1', states: { y1: { state: { cleared: 'v1' }, savedAt: 'x' } }, written: { y1: text('Old.') } });
    expect(block()).toBeNull();
    await m.change({ version: 'v2', written: { y1: text('Again, longer.') } });
    expect(block()).not.toBeNull();
    await see(true);
    await tick(100);
    expect(shownText()).toBe('Agai');
    await tick(3000);
    expect(shownText()).toBe('Again, longer.');
  });

  test('a clear the reader made on this version is not carried to the next one an edit makes', async () => {
    const m = mount({ author: false });
    await seenAndTyped();
    pointer.down(block()!);
    await tick(11_000);
    expect(block()).toBeNull();
    await m.change({ version: 'v2' });
    await see(true);
    await tick(3000);
    expect(shownText()).toBe(SIXTY);
  });

  test('focus lands where the tail was when a held key clears it, so the reader is not dropped', async () => {
    mount();
    await seenAndTyped();
    block()!.focus();
    key.down(block()!);
    await tick(11_000);
    expect(block()).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('[role="status"][data-kb-report]'));
  });
});

describe('reduced motion', () => {
  beforeEach(() => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); });

  test('the text shows at once, with no tear and a cursor that holds still', async () => {
    mount();
    expect(shownText()).toBe(SIXTY);
    await see(true);
    expect(shownText()).toBe(SIXTY);
    expect(block()!.hasAttribute('data-kb-typing')).toBe(false);
    expect(cursor()!.hasAttribute('data-kb-still')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('the hold erases at the same rate, and the retype is instant after the same wait', async () => {
    mount();
    await see(true);
    pointer.down(block()!);
    await tick(5000);
    expect(shownText()).toBe(SIXTY.slice(0, 30));
    pointer.up(block()!);
    await tick(1900);
    expect(shownText()).toBe(SIXTY.slice(0, 30));
    await tick(200);
    expect(shownText()).toBe(SIXTY);
  });

  test('a waiting generation\'s text arriving shows at once', async () => {
    const m = mount({ written: { y1: { waiting: true } } });
    await see(true);
    m.redraw({ y1: text(SIXTY) });
    expect(shownText()).toBe(SIXTY);
  });
});

describe('still (History, As it landed)', () => {
  test('draws the whole text with no cursor animation, takes no input and is not focusable', async () => {
    const { save, views } = mount({ still: true, author: true });
    expect(shownText()).toBe(SIXTY);
    expect(block()!.hasAttribute('tabindex')).toBe(false);
    expect(block()!.getAttribute('role')).not.toBe('button');
    expect(block()!.getAttribute('aria-label')).toBe('Continued by You Were Saying?');
    expect(cursor()?.hasAttribute('data-kb-still') ?? true).toBe(true);
    await see(true);
    await tick(1000);
    expect(shownText()).toBe(SIXTY);
    pointer.down(block()!);
    key.down(block()!);
    await tick(11_000);
    expect(shownText()).toBe(SIXTY);
    expect(save).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(views.at(-1)?.state).toBe('60 characters added');
  });

  test('says one character in the singular', () => {
    const { views } = mount({ still: true, written: { y1: text('!') } });
    expect(views.at(-1)?.state).toBe('1 character added');
  });

  test('where the snapshot says the version was cleared it draws nothing and says it was erased', () => {
    const { views } = mount({ still: true, states: { y1: { state: { cleared: 'v1' }, savedAt: 'x' } } });
    expect(block()).toBeNull();
    expect(views.at(-1)?.state).toBe('erased');
  });

  test('a state cleared for another version does not clear this one', () => {
    mount({ still: true, states: { y1: { state: { cleared: 'v0' }, savedAt: 'x' } } });
    expect(shownText()).toBe(SIXTY);
  });
});

describe('its colors', () => {
  const css = read('./tail.css');
  const pairs = [...css.matchAll(/--dw-ywst-ink:\s*(#[0-9a-f]{6});\s*--dw-ywst-ground:\s*(#[0-9a-f]{6});/giu)];
  test('the stylesheet carries a light pair and a dark one, each at 4.5:1 or better on its own ground', () => {
    expect(pairs).toHaveLength(3);
    for (const [, ink, ground] of pairs) expect(ratio(ink!, ground!)).toBeGreaterThanOrEqual(4.5);
  });
  test('the light ink is the mock\'s #0a6b2a', () => {
    expect(pairs[0]![1]!.toLowerCase()).toBe('#0a6b2a');
  });
});

const ENTER = (el: HTMLElement) => fireEvent.keyDown(el, { key: 'Enter' });
const gap = (ms: number) => act(() => { vi.setSystemTime(Date.now() + ms); });
const noteEl = () => document.querySelector<HTMLElement>('[role="status"][data-kb-report]')!;

describe('pressing while it types in', () => {
  test('erases from the full length: the display jumps to full and the cost is all of it held', async () => {
    mount();
    await see(true);
    await tick(500);
    expect(shownText()).toBe(SIXTY.slice(0, 20));
    pointer.down(block()!);
    expect(shownText()).toBe(SIXTY);
    await tick(9000);
    expect(block()).not.toBeNull();
    await tick(1100);
    expect(block()).toBeNull();
  });

  test('a 200-character tail pressed half a second in takes 200/6 seconds of hold', async () => {
    mount({ written: { y1: text('x'.repeat(200)) } });
    await see(true);
    await tick(500);
    pointer.down(block()!);
    await tick(33_000);
    expect(block()).not.toBeNull();
    await tick(500);
    expect(block()).toBeNull();
  });

  test('the same after it types back in following a release', async () => {
    mount();
    await seenAndTyped();
    pointer.down(block()!);
    await tick(5000);
    pointer.up(block()!);
    await tick(2100);
    expect(shownText().length).toBeLessThan(60);
    pointer.down(block()!);
    expect(shownText()).toBe(SIXTY);
  });
});

describe('a save that does not land', () => {
  const finish = async () => { await seenAndTyped(); pointer.down(block()!); await tick(11_000); };
  test('a rejected save says so plainly, near the post and visibly, and the tail comes back to hold again', async () => {
    mount({ author: true, save: (async () => { throw new Error('offline'); }) as unknown as EffectProps['save'] });
    await finish();
    expect(status()).toBe(UNSAVED);
    expect(block()).not.toBeNull();
    expect(block()!.contains(noteEl())).toBe(false);
    expect(noteEl().classList.contains('kb-visually-hidden')).toBe(false);
    expect(noteEl().getAttribute('aria-live')).toBe('polite');
    pointer.up(block()!);
    pointer.down(block()!);
    await tick(11_000);
    expect(block()).not.toBeNull();
  });

  test('an answer that is not ok is a failure too', async () => {
    mount({ author: true, save: (async () => ({ ok: false, error: 'no' })) as unknown as EffectProps['save'] });
    await finish();
    expect(status()).toBe(UNSAVED);
    expect(block()).not.toBeNull();
  });

  test('the author hears Erased only after every save resolves', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    mount({ author: true, save: (async (play: string) => { await gate; return { ok: true, value: { play, savedAt: '' } }; }) as unknown as EffectProps['save'] });
    await finish();
    expect(status()).not.toBe('Erased.');
    expect(status()).not.toBe(UNSAVED);
    await act(async () => { release(); await gate; });
    expect(status()).toBe('Erased.');
    expect(block()).toBeNull();
  });

  test('one of two saves failing is a failure', async () => {
    let n = 0;
    mount({ author: true, plays: [playOf(1), playOf(2)], written: { y1: text('a'.repeat(30)), y2: text('b'.repeat(30)) }, save: (async (play: string) => (++n === 1 ? { ok: true, value: { play, savedAt: '' } } : { ok: false })) as unknown as EffectProps['save'] });
    await finish();
    expect(status()).toBe(UNSAVED);
  });
});

describe('a hold that outlives the pointer', () => {
  test('pointer capture is taken on press and released on release', async () => {
    mount();
    await seenAndTyped();
    const el = block()!;
    const set = vi.fn(); const rel = vi.fn();
    Object.assign(el, { setPointerCapture: set, releasePointerCapture: rel });
    fireEvent.pointerDown(el, { button: 0, pointerType: 'mouse', pointerId: 7 });
    expect(set).toHaveBeenCalledWith(7);
    fireEvent.pointerUp(el, { button: 0, pointerType: 'mouse', pointerId: 7 });
    expect(rel).toHaveBeenCalledWith(7);
  });

  const letGo: Record<string, () => void> = {
    'the page being hidden': () => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); },
    'the window losing focus': () => { fireEvent.blur(window); },
    'a pointer cancel': () => { fireEvent.pointerCancel(block()!); },
    'a lost pointer capture': () => { fireEvent.lostPointerCapture(block()!); },
    'the element blurring': () => { fireEvent.blur(block()!); },
  };
  afterEach(() => { Reflect.deleteProperty(document, 'visibilityState'); });
  test.each(Object.keys(letGo))('%s lets go of a mouse hold', async (what) => {
    mount();
    await seenAndTyped();
    pointer.down(block()!);
    await tick(1000);
    await act(async () => { letGo[what]!(); });
    await tick(1000);
    expect(shownText()).toBe(SIXTY.slice(0, 54));
  });

  test('a key hold is let go of by the page being hidden', async () => {
    mount();
    await seenAndTyped();
    block()!.focus();
    key.down(block()!);
    await tick(1000);
    await act(async () => { letGo['the page being hidden']!(); });
    await tick(1000);
    expect(shownText()).toBe(SIXTY.slice(0, 54));
  });

  test('a gap in the ticks credits no hold time: a throttled timer cannot bank erase time', async () => {
    mount();
    await seenAndTyped();
    pointer.down(block()!);
    await tick(1000);
    await gap(8000);
    await tick(25);
    expect(shownText().length).toBeGreaterThanOrEqual(53);
    expect(block()).not.toBeNull();
    await tick(1000);
    expect(shownText().length).toBeGreaterThanOrEqual(53);
  });
});

describe('a way to erase without holding', () => {
  const NAMED = 'Continued by You Were Saying?: ' + SIXTY + '. Hold to erase, or press Enter to start erasing and Enter again to stop. It comes back if you stop.';
  test('the accessible name says both ways', async () => {
    mount();
    await see(true);
    expect(block()!.getAttribute('aria-label')).toBe(NAMED);
  });

  test('Enter starts an erase that goes on by itself and takes exactly as long as a hold, then saves', async () => {
    const { save } = mount({ author: true });
    await seenAndTyped();
    block()!.focus();
    ENTER(block()!);
    expect(status()).toBe('Erasing.');
    await tick(5000);
    expect(shownText()).toBe(SIXTY.slice(0, 30));
    await tick(4900);
    expect(block()).not.toBeNull();
    await tick(200);
    expect(block()).toBeNull();
    expect(save.mock.calls).toEqual([['y1', { cleared: 'v1' }]]);
    expect(status()).toBe('Erased.');
  });

  test('Space starts it too, and a held key repeating is not a second activation', async () => {
    mount();
    await seenAndTyped();
    fireEvent.keyDown(block()!, { key: ' ' });
    fireEvent.keyDown(block()!, { key: ' ', repeat: true });
    await tick(5000);
    expect(shownText()).toBe(SIXTY.slice(0, 30));
  });

  test('Enter twice stops it, which is a release: it waits and then types back in', async () => {
    mount();
    await seenAndTyped();
    ENTER(block()!);
    await tick(5000);
    ENTER(block()!);
    expect(status()).toBe('Stopped. It\'s coming back.');
    await tick(1900);
    expect(shownText()).toBe(SIXTY.slice(0, 30));
    await tick(200);
    expect(shownText().length).toBeGreaterThan(30);
    await tick(1000);
    expect(shownText()).toBe(SIXTY);
  });

  test('"Erasing." is not said again on a press from the waiting phase', async () => {
    mount();
    await seenAndTyped();
    ENTER(block()!);
    await tick(2000);
    ENTER(block()!);
    await tick(500);
    ENTER(block()!);
    expect(status()).toBe('Stopped. It\'s coming back.');
    await tick(1000);
    expect(shownText()).toBe(SIXTY.slice(0, 42));
  });

  test('Escape stops it', async () => {
    mount();
    await seenAndTyped();
    ENTER(block()!);
    await tick(2000);
    fireEvent.keyDown(block()!, { key: 'Escape' });
    await tick(1900);
    expect(shownText()).toBe(SIXTY.slice(0, 48));
    await tick(200);
    expect(shownText().length).toBeGreaterThan(48);
  });

  test('blur stops it, and so does the page being hidden', async () => {
    mount();
    await seenAndTyped();
    ENTER(block()!);
    await tick(2000);
    fireEvent.blur(block()!);
    await tick(1000);
    expect(shownText()).toBe(SIXTY.slice(0, 48));
    await tick(1100);
    await tick(2000);
    expect(shownText()).toBe(SIXTY);
    ENTER(block()!);
    await tick(2000);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    Reflect.deleteProperty(document, 'visibilityState');
    await tick(1000);
    expect(shownText()).toBe(SIXTY.slice(0, 48));
  });

  test('a click that is not a pointer hold (detail 0: a screen reader\'s activate, a switch) starts it; a pointer\'s click does not', async () => {
    mount();
    await seenAndTyped();
    fireEvent.click(block()!, { detail: 1 });
    await tick(1000);
    expect(shownText()).toBe(SIXTY);
    fireEvent.click(block()!);
    await tick(5000);
    expect(shownText()).toBe(SIXTY.slice(0, 30));
    fireEvent.click(block()!);
    expect(status()).toBe('Stopped. It\'s coming back.');
  });

  test('pressed while it types in it erases from the full length, and a gap in the ticks stops it', async () => {
    mount();
    await see(true);
    await tick(500);
    ENTER(block()!);
    expect(shownText()).toBe(SIXTY);
    await tick(1000);
    await gap(8000);
    await tick(25);
    expect(block()).not.toBeNull();
    expect(shownText().length).toBeGreaterThanOrEqual(53);
  });

  test('a reader\'s erase this way is the screen\'s own and saves nothing', async () => {
    const { save } = mount();
    await seenAndTyped();
    ENTER(block()!);
    await tick(10_500);
    expect(block()).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('newlines and long words', () => {
  test('the tail keeps its line breaks and breaks a long word', () => {
    const css = read('./tail.css');
    const rule = css.match(/\.dw-ywst\s*\{[^}]*\}/u)![0];
    expect(rule).toMatch(/white-space:\s*pre-wrap/u);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/u);
  });

  test('a paragraph break in the text is kept in the DOM, and nothing is added before the first word', async () => {
    mount({ written: { y1: text(' One.\n\nTwo.') } });
    await seenAndTyped();
    expect(block()!.textContent).toBe(' One.\n\nTwo.');
    expect(block()!.firstChild).toBe(spans()[0]);
    expect(document.querySelector('[data-words]')!.nextSibling).toBe(block());
  });
});

describe('focus and the waiting state', () => {
  test('a tail removed while it has focus (a clear saved elsewhere) leaves focus on the status, not the page', async () => {
    const m = mount({ author: true });
    await seenAndTyped();
    block()!.focus();
    expect(document.activeElement).toBe(block());
    await m.change({ states: { y1: { state: { cleared: 'v1' }, savedAt: 'x' } } });
    expect(block()).toBeNull();
    expect(document.activeElement).toBe(noteEl());
  });

  test('a tail still being written says so once, politely, and not on a loop', async () => {
    const m = mount({ written: { y1: { waiting: true } } });
    await see(true);
    expect(status()).toBe('You Were Saying? is still writing.');
    const heard: string[] = [];
    const watch = new MutationObserver(() => heard.push(status()));
    watch.observe(document.body, { subtree: true, childList: true, characterData: true });
    await tick(5000);
    expect(heard).toEqual([]);
    watch.disconnect();
    m.redraw({ y1: text(SIXTY) });
    await tick(3000);
    expect(status()).toBe('');
  });
});
