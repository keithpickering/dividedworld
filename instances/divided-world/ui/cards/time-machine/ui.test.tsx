/**
 * Time Machine's effect (Effect.tsx, docs/plans/2026-11-21-time-machine-design.md, section 4.6): the engine has already swapped in the rewound words, so the
 * effect draws them under tape: scanlines and a tracking line over the post's content area, a read-out of the point's date at its top right, and, the first
 * time a play is drawn on a page, a 600 ms rewind of streaks. jsdom has no layout, so the content area's box is stubbed.
 */
import { act, cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ratio } from '../../../../../engine/ui/contrast.ts';
import { NO_INK } from '../../../../../engine/ui/cards/claims.ts';
import type { CardPlay, EffectProps } from '../../../../../engine/ui/cards/types.ts';
import type { Act } from '../../../../../engine/ui/data/api.ts';
import { TimeMachineEffect, STREAK_MS } from './Effect.tsx';
import { readOut } from './readout.ts';
import { ui } from './ui.ts';
import { timeMachine } from '../../../cards/time-machine.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const sheet = readFileSync(path.resolve(here, 'time-machine.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
const rule = (selector: string): string => new RegExp(`${selector.replace(/[.[\]]/gu, '\\$&')}\\s*\\{([^}]*)\\}`, 'u').exec(sheet)?.[1] ?? '';

const post = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-14T12:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null } as unknown as Act;
const POINT = '2026-11-14T21:02:00.000Z';
let n = 0;
const play = (extra: Partial<CardPlay> = {}): CardPlay => ({ id: `tm${++n}`, card: 'time-machine', layer: 1, caster: 'c2', message: '', config: { to: 'v1' }, playedAt: '2026-11-20T12:00:00Z', post: 'p1', rewindAt: POINT, ...extra });
const props = (plays: CardPlay[], extra: Partial<EffectProps> = {}): EffectProps => ({
  post, plays, states: {}, released: new Set(), written: new Map(), reader: { author: false, caster: false }, place: 'thread', reach: 'post', still: false, moment: null,
  show: () => {}, met: () => {}, ink: NO_INK, holdScreen: () => {}, marks: null, save: vi.fn(), release: vi.fn(), nameOf: () => 'Spritey', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null,
  children: <p data-kb-words>Old words.</p>, ...extra,
} as EffectProps);
/** The date as the reader's own time zone writes it, worked out here from the local getters and not the effect's formatter. */
const expected = (iso: string): string => {
  const d = new Date(iso);
  const hour = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
  return `${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()]} ${d.getDate()} ${hour}:${String(d.getMinutes()).padStart(2, '0')}${d.getHours() < 12 ? 'AM' : 'PM'}`;
};

const host = () => document.querySelector<HTMLElement>('.dw-tm')!;
const layer = () => document.querySelector<HTMLElement>('.dw-tm-layer')!;
const streaks = () => document.querySelectorAll('[data-tm-streak]');

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.removeAttribute('data-kb-motion');
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const area = this.hasAttribute('data-kb-content-area');
    return { x: 0, y: 0, left: area ? 10 : 0, top: area ? 20 : 0, right: 0, bottom: 0, width: area ? 300 : 280, height: area ? 140 : 120, toJSON: () => ({}) };
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-kb-content-area') ? 300 : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-kb-content-area') ? 140 : 0; });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); document.documentElement.removeAttribute('data-kb-motion'); });

describe('the effect', () => {
  test('it draws the post\'s words, the read-out with the point\'s date, and the hidden label', () => {
    render(<TimeMachineEffect {...props([play()])} />);
    expect(host().textContent).toContain('Old words.');
    expect(readOut(POINT)).toBe(expected(POINT));
    const out = document.querySelector('.dw-tm-readout')!;
    expect(out.getAttribute('aria-hidden')).toBe('true');
    expect(out.textContent).toBe(`◀◀ PLAY ${expected(POINT)}`);
    const label = document.querySelector('.kb-visually-hidden')!;
    expect(label.textContent).toBe(`Showing this post as it was on ${expected(POINT)}`);
    expect(label.closest('[aria-hidden="true"]'), 'the label is for assistive technology, so it is not inside what is hidden from it').toBeNull();
  });

  test('the date reads 12-hour in uppercase: midnight and noon', () => {
    const at = (h: number) => new Date(2026, 10, 3, h, 5).toISOString();
    expect([readOut(at(0)), readOut(at(12)), readOut(at(13))]).toEqual(['NOV 3 12:05AM', 'NOV 3 12:05PM', 'NOV 3 1:05PM']);
  });

  test('a play with no point draws the words and no read-out and no label', () => {
    render(<TimeMachineEffect {...props([play({ rewindAt: undefined })])} />);
    expect(host().textContent).toContain('Old words.');
    expect(document.querySelector('.dw-tm-readout')).toBeNull();
    expect(document.querySelector('.kb-visually-hidden')).toBeNull();
  });

  test('with no plays it draws only the words', () => {
    render(<TimeMachineEffect {...props([])} />);
    expect(document.querySelector('.dw-tm')).toBeNull();
    expect(document.body.textContent).toContain('Old words.');
  });
});

describe('the rewind', () => {
  test('the first draw of a play streaks for 600 ms; drawn again on the same page it does not', () => {
    const p = play();
    render(<TimeMachineEffect {...props([p])} />);
    expect(STREAK_MS).toBe(600);
    expect(streaks().length).toBeGreaterThan(0);
    act(() => { vi.advanceTimersByTime(599); });
    expect(streaks().length).toBeGreaterThan(0);
    act(() => { vi.advanceTimersByTime(2); });
    expect(streaks().length).toBe(0);
    cleanup();
    render(<TimeMachineEffect {...props([p])} />);
    expect(streaks().length, 'once per play per page load').toBe(0);
  });

  test('every streak crosses the whole area and is done within the 600 ms the rewind is held', () => {
    render(<TimeMachineEffect {...props([play()])} />);
    expect(layer().style.getPropertyValue('--dw-tm-w'), 'the area\'s width, which the streaks travel').toBe('280px');
    expect(sheet).toMatch(/translateX\(calc\(-1 \* \(var\(--dw-tm-w[^)]*\) \+ 100%\)\)\)/u);
    for (const s of streaks() as NodeListOf<HTMLElement>) expect(parseFloat(s.style.animationDelay) + parseFloat(s.style.animationDuration), 'delay plus duration').toBeLessThanOrEqual(STREAK_MS);
  });

  test('under reduced motion there is no streak, and the tracking line is held still', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    render(<TimeMachineEffect {...props([play()])} />);
    expect(streaks().length).toBe(0);
    const track = document.querySelector('.dw-tm-track')!;
    expect(track.hasAttribute('data-still')).toBe(true);
    expect(rule('.dw-tm-track[data-still]')).toMatch(/animation:\s*none/u);
  });

  test('with motion allowed the tracking line drifts for 9 s, wrapping', () => {
    render(<TimeMachineEffect {...props([play()])} />);
    expect(document.querySelector('.dw-tm-track')!.hasAttribute('data-still')).toBe(false);
    expect(rule('.dw-tm-track')).toMatch(/animation:\s*dw-tm-drift 9s linear infinite/u);
  });

  test('a moment and a History row draw no streak', () => {
    render(<TimeMachineEffect {...props([play()], { moment: { at: Date.parse('2026-11-21T00:00:00Z') } })} />);
    expect(streaks().length).toBe(0);
    cleanup();
    render(<TimeMachineEffect {...props([play()], { still: true })} />);
    expect(streaks().length).toBe(0);
  });
});

describe('where it is drawn', () => {
  test('the layer fills the content area border to border, in a thread and in the ORIGIN box, whatever the post\'s padding', () => {
    for (const cls of ['kb-act-main', 'kb-origin-area']) {
      const { unmount } = render(<div className={cls} data-kb-content-area style={{ padding: '12px' }}><TimeMachineEffect {...props([play()])} /></div>);
      const l = layer();
      expect([l.style.left, l.style.top, l.style.width, l.style.height], cls).toEqual(['10px', '20px', '300px', '140px']);
      expect(l.hasAttribute('data-kb-effect-ink'), 'the thread\'s sheet lifts the layer over the words').toBe(true);
      expect(host().getAttribute('style') ?? '', 'the effect\'s own box adds no margin or padding').not.toMatch(/margin|padding/u);
      unmount();
    }
  });

  test('with no content area above it the layer is the effect\'s own box, from its top-left', () => {
    render(<TimeMachineEffect {...props([play()])} />);
    const l = layer();
    expect([l.style.left, l.style.top, l.style.width, l.style.height]).toEqual(['0px', '0px', '280px', '120px']);
  });

  test('every layer takes no pointer, so a link or spoiler in the words stays pressable', () => {
    expect(rule('.dw-tm-layer')).toMatch(/position:\s*absolute/u);
    expect(rule('.dw-tm-layer')).toMatch(/pointer-events:\s*none/u);
    expect(rule('.dw-tm-layer')).toMatch(/overflow:\s*hidden/u);
    expect(rule('.dw-tm-layer')).not.toMatch(/margin/u);
    for (const cls of ['.dw-tm-scan', '.dw-tm-track', '.dw-tm-readout', '.dw-tm-streaks']) expect(rule(cls), cls).toMatch(/pointer-events:\s*none/u);
  });
});

describe('the look', () => {
  test('the scanlines and the tracking line are the design\'s', () => {
    expect(rule('.dw-tm-scan')).toContain('repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.05) 0 1px, transparent 1px 3px)');
    const track = rule('.dw-tm-track');
    expect(track).toContain('linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.7), rgba(0, 0, 0, 0.12), transparent)');
    expect(track).toMatch(/height:\s*7px/u);
    expect(track).toMatch(/filter:\s*blur\(1px\)/u);
  });

  test('the read-out is bold 13px Courier in #0b7a5e, which is at least 4.5:1 on white', () => {
    const out = rule('.dw-tm-readout');
    expect(out).toMatch(/color:\s*#0b7a5e/u);
    expect(out).toMatch(/font:\s*bold 13px[^;]*Courier/u);
    expect(out).toMatch(/top:/u);
    expect(out).toMatch(/right:/u);
    expect(ratio('#0b7a5e', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the card\'s screen entry', () => {
  test('its words', () => {
    expect(ui.key).toBe('time-machine');
    expect(ui.art.tagline).toBe('Go back to better days.');
    expect(ui.summary).toBe('Played on a post. For 3 days it shows as it was at an earlier point you pick, and no card up to rare can be played on it.');
    expect(ui.status).toBe('Showing an earlier version');
    expect(ui.hint).toBe('This post is showing an earlier version. Its History has the rest.');
    expect(ui.Effect).toBeDefined();
  });

  test('describe is the summary\'s words with its numbers read from the rules: a changed lasts or upTo changes them', () => {
    const words = (lasts: string, upTo: string) => `Played on a post. For ${lasts} it shows as it was at an earlier point you pick, and no card up to ${upTo} can be played on it.`;
    expect(ui.describe({} as never)).toBe(words('3 days', 'rare'));
    expect(ui.describe({} as never)).toBe(ui.summary);
    const was = { lasts: timeMachine.lasts, rewind: timeMachine.rewind };
    try {
      (timeMachine as { lasts: unknown }).lasts = { unit: 'day', count: 5 };
      (timeMachine as { rewind: unknown }).rewind = { upTo: 'legendary' };
      expect(ui.describe({} as never)).toBe(words('5 days', 'legendary'));
    } finally { Object.assign(timeMachine, was); }
  });

  test('its log line names the date from what the play recorded, or says nothing without it', () => {
    expect(ui.logPlay!({ to: 'v1' }, { rewindsTo: POINT })).toBe(`That post shows as it was on ${new Date(POINT).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} until it ends.`);
    expect(ui.logPlay!({ to: 'v1' }, {})).toBeUndefined();
  });
});
