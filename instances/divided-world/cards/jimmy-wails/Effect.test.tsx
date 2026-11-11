/**
 * Jimmy Wails's effect (plan Task 7): the post's words, then the latest drive's carousel and its drive; an earlier closed drive as a collapsed line.
 * The carousel runs on fake timers; reduced motion is the root's own override (`data-kb-motion`), as the player sets it.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../../../../engine/ui/a11y.ts';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, Drive, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { PLATES } from '../../ui/jimmy-wails/plates.ts';
import { ADVANCE_MS, JimmyWailsEffect } from './Effect.tsx';

const post = { id: 'post-1', character: 'author', kind: 'post', thread: 't', payload: { body: 'Hello' }, currentPayload: { body: 'Hello' }, targetActId: null, seq: 3, createdAt: '2026-11-03T09:00:00.000Z', editedAt: null, shownEditedAt: null } as unknown as Act;
const names: Record<string, string> = { author: 'Pipewrench', c1: 'Spritey', c2: 'Gloomba', c3: 'Toad' };
const play = (n: number, drawn = PLATES[n % PLATES.length]!.key): CardPlay => ({ id: `p${n}`, card: 'jimmy-wails', layer: n, caster: `c${(n % 3) + 1}`, message: `Appeal number ${n}`, config: {}, playedAt: `2026-11-03T10:0${n}:00.000Z`, post: 'post-1', drive: 'd1', drawn });
const gift = (n: number, amount: number) => ({ id: `g${n}`, character: 'c1', name: null, amount, at: `2026-11-0${n}T10:00:00.000Z` });
const drive = (over: Partial<Drive> = {}): Drive => ({ id: 'd1', plays: [play(1), play(2), play(3)], closes: '2026-11-20T10:00:00.000Z', open: true, total: 420, count: 11, gifts: [gift(3, 25)], more: false, ...over });

interface Options { readonly drives?: Drive[]; readonly place?: 'thread' | 'origin'; readonly wallet?: EffectProps['wallet']; readonly author?: boolean; readonly still?: boolean; readonly give?: EffectProps['give']; readonly economy?: Record<string, number> }

function mount(o: Options = {}) {
  const give = vi.fn(o.give ?? (async () => ({ ok: true as const, value: { act: {} as never, balance: 475 } })));
  function Host() {
    const [drives, setDrives] = useState(o.drives ?? [drive()]);
    const gives: EffectProps['give'] = async (id, amount) => {
      const answer = await give(id, amount);
      if (answer.ok) setDrives((all) => all.map((d) => (d.id === id ? { ...d, total: d.total + amount, count: d.count + 1, gifts: [{ id: 'new', character: 'c2', name: null, amount, at: '2026-11-09T10:00:00.000Z' }, ...d.gifts] } : d)));
      return answer;
    };
    return (
      <JimmyWailsEffect
        post={post} plays={drives.flatMap((d) => d.plays)} states={{}} released={new Set()} written={new Map()} reader={{ author: o.author ?? false, caster: false }} place={o.place ?? 'thread'}
        reach="post" still={o.still ?? false} save={async () => ({ ok: false, error: 'no' })} release={async () => ({ ok: false, error: 'no' })} show={() => {}} met={() => {}} holdScreen={() => {}} marks={null}
        nameOf={(id) => (id === null ? 'Somebody' : names[id] ?? id)} drives={drives} give={gives} moreGifts={async () => {}} wallet={'wallet' in o ? o.wallet! : { balance: 500, cap: 1000 }}
      >
        <p>Hello, this is the post.</p>
      </JimmyWailsEffect>
    );
  }
  const economy = o.economy ?? { 'jimmyWails.gift1': 10, 'jimmyWails.gift2': 25, 'jimmyWails.gift3': 50, 'jimmyWails.gift4': 100, 'jimmyWails.overhead': 25 };
  return { give, ...renderInWorld(<Host />, { settings: { cardEconomy: economy } }) };
}
const active = () => document.querySelector('.dw-jw-slide[data-active="true"]')!.getAttribute('aria-label');
const pass = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
const buttons = () => screen.queryAllByRole('button', { name: /^Give / });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.documentElement.removeAttribute('data-kb-motion'); });

describe('the effect', () => {
  test('draws the post\'s words unchanged, then the drive under them', () => {
    mount();
    const words = screen.getByText('Hello, this is the post.');
    const drive = screen.getByRole('complementary', { name: 'Donation drive' });
    expect(words.compareDocumentPosition(drive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('draws only the words where there is no drive', () => {
    mount({ drives: [] });
    expect(screen.getByText('Hello, this is the post.')).toBeTruthy();
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  test('each banner is drawn on the plate its own play was drawn on, with its own message and caster', () => {
    mount({ drives: [drive({ plays: [play(1, 'dark-logo'), play(2, 'close-up'), play(3, 'gone')] })] });
    const figures = [...document.querySelectorAll('figure')];
    expect(figures.map((f) => f.getAttribute('data-plate'))).toEqual(['dark-logo', 'close-up', PLATES[0]!.key]);
    expect(figures.map((f) => f.getAttribute('aria-label'))).toEqual(['Appeal from Gloomba', 'Appeal from Toad', 'Appeal from Spritey']);
  });

  test('an earlier closed drive is a collapsed line that opens its banners', () => {
    const earlier = drive({ id: 'd0', plays: [play(7)], open: false, total: 310, count: 7 });
    mount({ drives: [earlier, drive({ id: 'd1' })] });
    const line = screen.getByText('An earlier drive raised 3.10 in 7 gifts');
    const details = line.closest('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('figure')).not.toBeNull();
    expect(buttons()).toHaveLength(4);
  });
});

describe('the carousel', () => {
  test('shows "1 of 3" and advances every 8 seconds, then comes round', async () => {
    mount();
    expect(active()).toBe('1 of 3');
    expect(screen.getByText('1 of 3', { selector: '.dw-jw-count' })).toBeTruthy();
    await pass(ADVANCE_MS - 1);
    expect(active()).toBe('1 of 3');
    await pass(1);
    expect(active()).toBe('2 of 3');
    await pass(ADVANCE_MS * 2);
    expect(active()).toBe('1 of 3');
  });

  test('previous, next and the dots move it, and only the banner showing is in the reading order', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Next appeal' }));
    expect(active()).toBe('2 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Previous appeal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous appeal' }));
    expect(active()).toBe('3 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Show appeal 2' }));
    expect(active()).toBe('2 of 3');
    expect(screen.getByRole('button', { name: 'Show appeal 2' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getAllByRole('figure')).toHaveLength(1);
  });

  test('pauses while the pointer is over it', async () => {
    mount();
    const carousel = screen.getByRole('region', { name: 'Appeals' });
    fireEvent.pointerEnter(carousel);
    await pass(ADVANCE_MS * 2);
    expect(active()).toBe('1 of 3');
    fireEvent.pointerLeave(carousel);
    await pass(ADVANCE_MS);
    expect(active()).toBe('2 of 3');
  });

  test('pauses while focus is within it, and goes on when focus leaves it', async () => {
    mount();
    act(() => { screen.getByRole('button', { name: 'Show appeal 3' }).focus(); });
    await pass(ADVANCE_MS * 2);
    expect(active()).toBe('1 of 3');
    fireEvent.blur(screen.getByRole('button', { name: 'Show appeal 3' }), { relatedTarget: document.body });
    await pass(ADVANCE_MS);
    expect(active()).toBe('2 of 3');
  });

  test('a focus that moves between its own buttons does not let it go on', async () => {
    mount();
    const dot = screen.getByRole('button', { name: 'Show appeal 3' });
    fireEvent.focus(dot);
    fireEvent.blur(dot, { relatedTarget: screen.getByRole('button', { name: 'Next appeal' }) });
    await pass(ADVANCE_MS * 2);
    expect(active()).toBe('1 of 3');
  });

  test('pauses from its pause button until it is pressed again', async () => {
    mount();
    const pause = screen.getByRole('button', { name: 'Pause rotation' });
    fireEvent.click(pause);
    expect(pause.getAttribute('aria-pressed')).toBe('true');
    expect(pause.getAttribute('aria-label')).toBe('Pause rotation');
    await pass(ADVANCE_MS * 2);
    expect(active()).toBe('1 of 3');
    fireEvent.click(pause);
    await pass(ADVANCE_MS);
    expect(active()).toBe('2 of 3');
  });

  test('never advances by itself under reduced motion, swaps with no fade, and the buttons still move it', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    mount();
    expect(document.querySelector('.dw-jw-carousel')!.getAttribute('data-reduced')).toBe('true');
    await pass(ADVANCE_MS * 5);
    expect(active()).toBe('1 of 3');
    expect(screen.queryByRole('button', { name: 'Pause rotation' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next appeal' }));
    expect(active()).toBe('2 of 3');
  });

  test('a drive with one banner is the banner alone', () => {
    mount({ drives: [drive({ plays: [play(1)] })] });
    expect(screen.getAllByRole('figure')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Next appeal' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Appeals' })).toBeNull();
  });

  test('does not advance in a play\'s moment', async () => {
    mount({ still: true });
    await pass(ADVANCE_MS * 2);
    expect(active()).toBe('1 of 3');
    expect(screen.queryByRole('button', { name: 'Pause rotation' })).toBeNull();
  });
});

describe('the drive under it', () => {
  test('a button worth more than the wallet is disabled', () => {
    mount({ wallet: { balance: 40, cap: 1000 } });
    const [a, b, c] = buttons() as HTMLButtonElement[];
    expect([a!.disabled, b!.disabled, c!.disabled]).toEqual([false, false, true]);
  });

  test('a gift updates the total and the wall', async () => {
    mount();
    expect(screen.getByText('Raised 4.20 in 11 gifts')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Give 0.50 Aura to this drive' }));
    await act(async () => {});
    expect(screen.getByText('Raised 4.70 in 12 gifts')).toBeTruthy();
    expect(screen.getAllByRole('listitem')[0]!.textContent).toBe('Gloomba 0.50 Aura');
    expect(screen.getByRole('status').textContent).toContain('You gave 0.50 Aura. 0.37 reached Pipewrench.');
  });

  test('a closed drive has no buttons', () => {
    mount({ drives: [drive({ open: false })] });
    expect(buttons()).toHaveLength(0);
    expect(screen.getByText('This drive has ended. It raised 4.20 in 11 gifts.')).toBeTruthy();
  });

  test('the ORIGIN box has no buttons, and still shows the banners', () => {
    mount({ place: 'origin' });
    expect(buttons()).toHaveLength(0);
    expect(document.querySelectorAll('figure').length).toBeGreaterThan(0);
  });

  test('a play\'s moment has no buttons', () => {
    mount({ still: true });
    expect(buttons()).toHaveLength(0);
  });

  test('the post\'s author, reading their own post, sees the buttons too', () => {
    mount({ author: true });
    expect(buttons()).toHaveLength(4);
  });

  test('the amounts and the overhead are the economy\'s', () => {
    mount({ economy: { 'jimmyWails.gift1': 15, 'jimmyWails.gift2': 30, 'jimmyWails.gift3': 60, 'jimmyWails.gift4': 120, 'jimmyWails.overhead': 10 } });
    expect(buttons().map((b) => b.textContent)).toEqual(['0.15', '0.30', '0.60', '1.20']);
    expect(screen.getByText('0.13 reaches Pipewrench after The System\'s 10% overhead')).toBeTruthy();
  });

  test('an economy missing a key throws rather than showing a number', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => mount({ economy: { 'jimmyWails.gift1': 10 } })).toThrow(/economy "jimmyWails\.gift2" is not set/);
    quiet.mockRestore();
  });

  test('axe finds nothing on a drive with its carousel', async () => {
    vi.useRealTimers();
    const { container } = mount();
    const found = await axeViolations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});
