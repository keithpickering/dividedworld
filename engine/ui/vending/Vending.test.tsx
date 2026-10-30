import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import type { CardUi } from '../cards/types.ts';
import type { Fake } from '../data/fake.ts';
import { testInstance, renderIn, buildWorld } from '../test-world.tsx';
import { Vending } from './Vending.tsx';

/* Two cards at 1.00; the salty one costs up to 2.00 more on a long post, never more than 3.00 in all. */
const ok = { ok: true as const, value: undefined };
const stick: CardRules = { key: 'stick', name: 'Stick Around', alignment: 'sweet', priceKey: 'stick.price', playPrice: () => 0, canApply: () => ok, validateConfig: (c) => ({ ok: true, value: c }) };
const whoops: CardRules = {
  key: 'whoops', name: 'Whoops!', alignment: 'salty', priceKey: 'whoops.price', stack: 3,
  playPrice: (_s, t) => Math.min(200, Math.floor(t.length / 5)), canApply: () => ok, validateConfig: (c) => ({ ok: true, value: c }),
};
const shop: Instance = { ...testInstance, cards: [stick, whoops], settings: { ...testInstance.settings, economy: { 'stick.price': 100, 'whoops.price': 100 } } };
const art = { color: '#2ee6ff', ink: '#03141a' };
const faces: CardUi[] = [
  { key: 'stick', art, describe: () => 'A Sweet card. Holds each reader on a post.' },
  { key: 'whoops', art: { ...art, color: '#ff3d7f' }, describe: () => 'A Salty card. Splats a post in your ink.' },
];

/** The player, signed in, with a wallet of `wallet` hundredths and two cards in hand. */
function seeded(wallet: number) {
  const fake = buildWorld(undefined, shop);
  const account = fake.seed.account('ana');
  fake.seed.character(account, 'Pipewrench', 'heel');
  fake.seed.wallet(account, wallet);
  fake.seed.cards(account, { stick: 1, whoops: 1 });
  fake.signInAs(account);
  return fake;
}

function open(fake: Fake) {
  return renderIn(fake, <Vending />, { instance: shop, cards: faces, path: '/vending' });
}

const orbSolids = () => [...document.querySelectorAll<HTMLElement>('.kb-vending-wallet .kb-orb')].map((o) => Number(o.style.getPropertyValue('--kb-solid')));

beforeEach(() => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); });
afterEach(() => { document.documentElement.removeAttribute('data-kb-motion'); vi.useRealTimers(); });

describe('the machine as the Vending board draws it', () => {
  test('each slot is a button that names the card and its price, the selected one says so, and the rest are sealed', async () => {
    open(seeded(562));
    expect(await screen.findByRole('button', { name: 'Buy Stick Around, 1.00 orb' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops!, 1.00 orb' }));
    expect(screen.getByRole('button', { name: 'Buy Whoops!, 1.00 orb, selected' })).toHaveAttribute('aria-pressed', 'true');
    for (const code of ['B1', 'B2', 'C1', 'C2']) expect(screen.getByRole('img', { name: `Empty slot ${code}, waiting for a future postcard` })).toBeInTheDocument();
    expect(screen.getByText('4 slots empty')).toBeInTheDocument();
  });

  test('the price display and the buy button carry the selection, and nothing is bought before the buy button is pressed', async () => {
    const fake = seeded(562);
    const buy = vi.spyOn(fake, 'buyCard');
    open(fake);
    const none = await screen.findByRole('status', { name: 'Nothing selected' });
    expect(none).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops!, 1.00 orb' }));
    expect(screen.getByRole('status', { name: 'Selected: A2, Whoops!, 1.00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' })).toBeEnabled();
    expect(buy).not.toHaveBeenCalled();
  });

  test('the wallet panel says solid only, the wallet before and after, and the hand before and after', async () => {
    open(seeded(562));
    await screen.findByRole('button', { name: 'Buy Stick Around, 1.00 orb' });
    expect(screen.getByText(/Wallet · solid only/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Wallet: 5.62 of 6.00' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops!, 1.00 orb' }));
    expect(screen.getByRole('img', { name: 'Wallet: 5.62 of 6.00; buying Whoops! leaves 4.62' })).toBeInTheDocument();
    expect(document.querySelector('.kb-vending-sum')).toHaveTextContent('5.62 → 4.62');
    expect(screen.getByRole('link', { name: 'Your hand 2 → 3' })).toBeInTheDocument();
  });

  test('the machine is named by the instance, and "In the machine" lists each card with its price and its rules in plain words', async () => {
    open(seeded(562));
    await screen.findByRole('button', { name: 'Buy Stick Around, 1.00 orb' });
    expect(screen.getByRole('group', { name: 'Shop' })).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'In the machine' });
    expect(within(list).getByText('A Sweet card. Holds each reader on a post.')).toBeInTheDocument();
    expect(within(list).getByText('A Salty card. Splats a post in your ink.')).toBeInTheDocument();
    /* A card whose play costs more on a long post says so with a plus, and the price note says how much. */
    expect(within(list).getByText('1.00+')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops!, 1.00 orb' }));
    expect(screen.getByText('Playing it on a long post costs up to 2.00 more, never more than 3.00 in all.')).toBeInTheDocument();
  });
});

describe('buying', () => {
  test('spends the card\'s price from the wallet, the count rises by one, and the card is in the hand at once under reduced motion', async () => {
    const fake = seeded(562);
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Your hand 3 → 4' })).toBeInTheDocument());
    expect((await fake.myCards()).find((c) => c.card === 'whoops')?.held).toBe(2);
    expect((await fake.wallet()).balance).toBe(462);
    expect(screen.getByRole('img', { name: 'Wallet: 4.62 of 6.00; buying Whoops! leaves 3.62' })).toBeInTheDocument();
    expect(screen.getByText('Whoops! is in your hand. 4.62 is left, solid.')).toBeInTheDocument();
    expect(document.querySelector('.kb-vending-drop')).toBeNull();
  });

  test('with too little solid Aura it is refused in plain words before the server is asked, and nothing changes', async () => {
    const fake = seeded(62);
    const buy = vi.spyOn(fake, 'buyCard');
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb' }));
    expect(screen.getByText('Whoops! costs 1.00 and your wallet holds 0.62. Only solid Aura can be spent; the ghost estimate cannot.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Whoops! costs 1.00 and your wallet holds 0.62.');
    expect(buy).not.toHaveBeenCalled();
    expect((await fake.myCards()).find((c) => c.card === 'whoops')?.held).toBe(1);
  });

  test('a refusal the server makes after the screen\'s preview is said in plain words too, in orbs and not hundredths', async () => {
    const fake = seeded(562);
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb' }));
    /* The wallet is spent elsewhere between the preview and the press, so the server refuses what the preview allowed. */
    vi.spyOn(fake, 'buyCard').mockResolvedValue({ ok: false, error: 'that costs 100, and your wallet holds 62' });
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That costs 1.00, and your wallet holds 0.62.');
  });
});

describe('a lost answer, two presses in one tick, and a held answer', () => {
  test('a lost answer that did go through still updates the wallet and the hand, and the page says to look before trying again', async () => {
    const fake = seeded(562);
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb' }));
    fake.seed.loseNextAnswer(true);
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('look before you try again');
    /* The server did it before the answer was lost, so the rows read again show it. */
    await waitFor(() => expect(document.querySelector('.kb-vending-sum')).toHaveTextContent(/^4\.62/), { timeout: 800 });
    expect((await fake.myCards()).find((c) => c.card === 'whoops')?.held).toBe(2);
    expect(document.querySelector('.kb-vending-hand-count')).toHaveTextContent('3');
  });

  test('two presses in one tick buy once', async () => {
    const fake = seeded(562);
    const buy = vi.spyOn(fake, 'buyCard');
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb' }));
    const button = screen.getByRole('button', { name: 'Buy Whoops! · 1.00' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    await waitFor(() => expect(document.querySelector('.kb-vending-outcome')).toHaveTextContent(/is in your hand/));
    expect(buy).toHaveBeenCalledTimes(1);
    expect((await fake.wallet()).balance).toBe(462);
  });

  test('with two purchases in flight the hand\'s count is two behind what it holds', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    const fake = seeded(562);
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb' }));
    vi.useFakeTimers();
    for (let i = 0; i < 2; i++) {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' })); await Promise.resolve(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    }
    /* The hand holds 4 now; neither card has landed, so it reads 2 (and the pick would make 3). */
    expect(document.querySelector('.kb-vending-hand-count')).toHaveTextContent('2 → 3');
    await act(async () => { await vi.advanceTimersByTimeAsync(1500 + 400); });
    expect(document.querySelector('.kb-vending-hand-count')).toHaveTextContent('4 → 5');
  });

  /* Account A presses Buy and the answer is held; B signs in; then the answer lands. */
  function heldAnswer() {
    const fake = seeded(562);
    const other = fake.seed.account('bo');
    fake.seed.character(other, 'Sprocket', 'face');
    fake.seed.wallet(other, 300);
    fake.seed.cards(other, { stick: 1 });
    const real = fake.buyCard.bind(fake);
    let release: () => void = () => {};
    vi.spyOn(fake, 'buyCard').mockImplementation(async (card) => {
      const answer = await real(card);
      await new Promise<void>((resolve) => { release = resolve; });
      return answer;
    });
    return { fake, other, land: async () => { await act(async () => { release(); await Promise.resolve(); }); } };
  }

  const nothingOfA = async () => {
    await waitFor(() => expect(document.querySelector('.kb-vending-sum')).toHaveTextContent(/^3\.00$/), { timeout: 800 });
    expect(document.querySelector('.kb-vending-wallet')).not.toHaveTextContent(/is in your hand|4\.62/);
    expect(document.querySelector('.kb-vending-lcd')).toHaveAttribute('aria-label', 'Nothing selected');
    expect(document.querySelector('.kb-vending-buy')).toBeDisabled();
    expect(document.querySelector('.kb-vending-drop')).toBeNull();
    expect(document.querySelector('.kb-vending-hand-count')).toHaveTextContent(/^1$/);
  };

  test('an answer held while another account signs in shows nothing of the first account under the second', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    const { fake, other, land } = heldAnswer();
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' })).toBeDisabled());
    act(() => fake.signInAs(other));
    await land();
    await nothingOfA();
  });

  test('signing out and in as another account clears the first one\'s pick and its outcome too', async () => {
    const fake = seeded(562);
    const other = fake.seed.account('bo');
    fake.seed.character(other, 'Sprocket', 'face');
    fake.seed.wallet(other, 300);
    fake.seed.cards(other, { stick: 1 });
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    expect(await screen.findByText('Whoops! is in your hand. 4.62 is left, solid.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Buy Stick Around, 1.00 orb' }));
    act(() => fake.signInAs(null));
    act(() => fake.signInAs(other));
    await nothingOfA();
  });
});

describe('the cascade, backwards', () => {
  test('the wallet drains from the last orb down, one a second, from the wallet it had to the wallet it has', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    const fake = seeded(562);
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb' }));
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' })); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    /* The sixth orb (0.62 full) drains first; the fifth, still full, has not moved. */
    expect(orbSolids()).toEqual([1, 1, 1, 1, 1, 0]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(orbSolids()).toEqual([1, 1, 1, 1, 0.62, 0]);
  });
});

describe('the drop and the flight, under full motion', () => {
  test('the card enters the tray, the hand still counts what it held, and the count moves when the card lands', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    const fake = seeded(562);
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb' }));
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' })); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    /* In the tray and on its way: the hand has not received it, so it still reads what it held (the picked card is still picked, so 2 → 3), not 3 → 4. */
    const drop = document.querySelector('.kb-vending-tray .kb-vending-drop');
    expect(drop).not.toBeNull();
    expect(document.querySelector('.kb-vending-hand-count')).toHaveTextContent('2 → 3');
    /* Mid-flight a second on, it has still not landed. */
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(document.querySelector('.kb-vending-drop')).not.toBeNull();
    /* The card lands (its animation ends): the tray is empty and the hand holds three. */
    /* jsdom has no CSS animations, so React listens for the prefixed name there; a browser sends the plain one. Either ends the flight. */
    await act(async () => {
      const flying = document.querySelector('.kb-vending-drop')!;
      for (const name of ['animationend', 'webkitAnimationEnd']) fireEvent(flying, new Event(name, { bubbles: true }));
    });
    expect(document.querySelector('.kb-vending-drop')).toBeNull();
    expect(screen.getByRole('link', { name: 'Your hand 3 → 4' })).toBeInTheDocument();
  });

  test('a card whose landing is never reported still reaches the hand once the delivery time has passed', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    const fake = seeded(562);
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb' }));
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' })); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('link', { name: 'Your hand 2 → 3' })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500 + 400); });
    expect(document.querySelector('.kb-vending-drop')).toBeNull();
    expect(screen.getByRole('link', { name: 'Your hand 3 → 4' })).toBeInTheDocument();
  });
});
