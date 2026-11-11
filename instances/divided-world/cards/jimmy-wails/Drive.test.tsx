/**
 * Jimmy Wails's drive (plan Task 7): the amounts as buttons, what reaches the author, the total and the donor wall, a gift's result, and a drive that
 * has ended or sits in an ORIGIN box. The screen gives a gift's answer and counts it once (`EffectProps.give`); a stand-in here does the same for the
 * drive it holds.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../../../../engine/ui/a11y.ts';
import type { Drive as DriveOf, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { Drive, type DriveProps } from './Drive.tsx';

const gift = (n: number, amount: number, name: string | null = null) => ({ id: `g${n}`, character: `c${n}`, name, amount, at: `2026-11-0${n}T10:00:00.000Z` });
const drive = (over: Partial<DriveOf> = {}): DriveOf => ({ id: 'd1', plays: [], closes: '2026-11-20T10:00:00.000Z', open: true, total: 420, count: 11, gifts: [gift(3, 25), gift(2, 100)], more: false, ...over });
const names: Record<string, string> = { c1: 'Mario', c2: 'Luigi', c3: 'Peach' };
const nameOf: EffectProps['nameOf'] = (id) => (id === null ? 'Somebody' : names[id] ?? id);
const ok = (balance: number) => async () => ({ ok: true as const, value: { act: {} as never, balance } });

function mount(over: Partial<DriveProps> = {}) {
  const props: DriveProps = { drive: drive(), author: 'Pipewrench', amounts: [10, 25, 50, 100], overhead: 25, buttons: true, wallet: { balance: 500, cap: 1000 }, give: vi.fn(ok(475)), moreGifts: vi.fn(async () => {}), nameOf, ...over };
  return { props, ...render(<Drive {...props} />) };
}
const buttons = () => screen.queryAllByRole('button', { name: /^Give / });

describe('the buttons', () => {
  test('are four, each labeled with its amount', () => {
    mount();
    expect(buttons().map((b) => b.getAttribute('aria-label'))).toEqual(['Give 0.10 Aura to this drive', 'Give 0.25 Aura to this drive', 'Give 0.50 Aura to this drive', 'Give 1.00 Aura to this drive']);
  });

  test('one worth more than the wallet is disabled, and its description says so', () => {
    mount({ wallet: { balance: 30, cap: 1000 } });
    const [a, b, c, d] = buttons() as HTMLButtonElement[];
    expect([a!.disabled, b!.disabled, c!.disabled, d!.disabled]).toEqual([false, false, true, true]);
    expect(c!.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(c!.getAttribute('aria-describedby')!)!.textContent).toBe('You have 0.30 Aura, which is not enough for this.');
    expect(a!.getAttribute('aria-describedby')).toBeNull();
  });

  test('a wallet exactly the amount\'s is enough', () => {
    mount({ wallet: { balance: 25, cap: 1000 } });
    expect((buttons()[1] as HTMLButtonElement).disabled).toBe(false);
  });

  test('are all disabled, and say why, while the wallet is not known (signed out, or not yet loaded)', () => {
    mount({ wallet: null });
    for (const b of buttons() as HTMLButtonElement[]) {
      expect(b.disabled).toBe(true);
      expect(document.getElementById(b.getAttribute('aria-describedby')!)!.textContent).toBe('Giving is unavailable until your Aura balance shows.');
    }
  });
});

describe('what arrives', () => {
  test('is the amount less the overhead, from the split the database makes, for the first amount until another is pointed at', () => {
    mount();
    expect(screen.getByText('0.07 reaches Pipewrench after 25% overhead')).toBeTruthy();
    fireEvent.focus(buttons()[1]!);
    expect(screen.getByText('0.18 reaches Pipewrench after 25% overhead')).toBeTruthy();
    fireEvent.pointerEnter(buttons()[3]!);
    expect(screen.getByText('0.75 reaches Pipewrench after 25% overhead')).toBeTruthy();
  });
});

describe('the total and the wall', () => {
  test('are said, latest first, and "and N more" reads the next page', async () => {
    const { props } = mount({ drive: drive({ more: true }) });
    expect(screen.getByText('Raised 4.20 in 11 gifts')).toBeTruthy();
    const donors = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(donors).toEqual(['Peach 0.25 Aura', 'Luigi 1.00 Aura']);
    fireEvent.click(screen.getByRole('button', { name: 'and 9 more' }));
    await waitFor(() => expect(props.moreGifts).toHaveBeenCalledWith('d1'));
  });

  test('one gift is "1 gift"', () => {
    mount({ drive: drive({ total: 25, count: 1, gifts: [gift(3, 25)] }) });
    expect(screen.getByText('Raised 0.25 in 1 gift')).toBeTruthy();
  });

  test('a gift updates the total and the wall, and its result is announced politely', async () => {
    function Host() {
      const [d, setD] = useState(drive());
      const give: EffectProps['give'] = async (_id, amount) => {
        setD((was) => ({ ...was, total: was.total + amount, count: was.count + 1, gifts: [{ id: 'new', character: 'c1', name: null, amount, at: '2026-11-09T10:00:00.000Z' }, ...was.gifts] }));
        return ok(475)() as ReturnType<EffectProps['give']>;
      };
      return <Drive drive={d} author="Pipewrench" amounts={[10, 25, 50, 100]} overhead={25} buttons wallet={{ balance: 500, cap: 1000 }} give={give} moreGifts={async () => {}} nameOf={nameOf} />;
    }
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Give 0.25 Aura to this drive' }));
    await waitFor(() => expect(screen.getByText('Raised 4.45 in 12 gifts')).toBeTruthy());
    expect(screen.getAllByRole('listitem')[0]!.textContent).toBe('Mario 0.25 Aura');
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('You gave 0.25 Aura. 0.18 reached Pipewrench. You have 4.75 Aura left.');
  });

  test('a refusal shows its words in the same place', async () => {
    mount({ give: vi.fn(async () => ({ ok: false as const, error: 'this drive has ended' })) });
    fireEvent.click(screen.getByRole('button', { name: 'Give 0.10 Aura to this drive' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('this drive has ended'));
    expect(screen.getByRole('status').getAttribute('data-refused')).toBe('true');
  });

  test('a gift is sent once for one press, in hundredths, to this drive', async () => {
    const { props } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Give 1.00 Aura to this drive' }));
    await act(async () => {});
    expect(props.give).toHaveBeenCalledTimes(1);
    expect(props.give).toHaveBeenCalledWith('d1', 100);
  });
});

describe('the donor wall', () => {
  test('names a giver the thread has never heard from by the name the gift carries, and falls back to the thread\'s name for a gift with none', () => {
    mount({ drive: drive({ gifts: [gift(5, 50, 'Spritey'), gift(1, 25)] }) });
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Spritey 0.50 Aura', 'Mario 0.25 Aura']);
    expect(screen.queryByText('A character')).toBeNull();
  });
});

describe('a drive with no buttons', () => {
  test('that has ended says so with what it raised, and keeps its wall', () => {
    mount({ drive: drive({ open: false }) });
    expect(buttons()).toHaveLength(0);
    expect(screen.getByText('This drive has ended. It raised 4.20 in 11 gifts.')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  test('in the ORIGIN box (or a moment) gives none, though the drive is open', () => {
    mount({ buttons: false });
    expect(buttons()).toHaveLength(0);
    expect(screen.getByText('Raised 4.20 in 11 gifts')).toBeTruthy();
  });
});

describe('the drive and accessibility', () => {
  test('axe finds nothing on an open drive, a short wallet, or a closed one', async () => {
    for (const over of [{}, { wallet: { balance: 30, cap: 1000 } }, { wallet: null }, { drive: drive({ open: false, more: true }) }] as Partial<DriveProps>[]) {
      const { container, unmount } = mount(over);
      const found = await axeViolations(container);
      expect(found, describeViolations(found)).toEqual([]);
      unmount();
    }
  });
});
