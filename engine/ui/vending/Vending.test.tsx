import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import type { CardUi } from '../cards/types.ts';
import type { Fake } from '../data/fake.ts';
import { testInstance, renderIn, buildWorld } from '../test-world.tsx';
import * as motionPresets from '../glass/motion.ts';
import { feelTokens } from '../glass/motion-tokens.ts';
import { Vending } from './Vending.tsx';

/* The flight to the hand is watched, not replaced: `toHand` still runs, and the test reads what it was asked. */
vi.mock('../glass/motion.ts', async (original) => {
  const actual = await original<typeof import('../glass/motion.ts')>();
  return { ...actual, toHand: vi.fn(actual.toHand) };
});

/* Two cards at 1.00; the salty one costs up to 2.00 more on a long post, never more than 3.00 in all. */
const ok = { ok: true as const, value: undefined };
const stick: CardRules = { key: 'stick', name: 'Stick Around', alignment: 'sweet', rarity: 'common', playPrice: () => 0, canApply: () => ok, validateConfig: (c) => ({ ok: true, value: c }) };
const whoops: CardRules = {
  key: 'whoops', name: 'Whoops!', alignment: 'salty', rarity: 'common', stack: 3,
  playPrice: (_s, t) => Math.min(200, Math.floor((t.reach === 'post' ? t.length : 0) / 5)), canApply: () => ok, validateConfig: (c) => ({ ok: true, value: c }),
};
const shop: Instance = { ...testInstance, cards: [stick, whoops], machine: [{ item: { card: 'stick' }, availability: 'onSale', price: 100 }, { item: { card: 'whoops' }, availability: 'onSale', price: 100 }] };
const art = { color: '#2ee6ff', ink: '#03141a', canvas: '', mark: '', credit: 'Test' };
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

/* The sign: decoration picked at random when the screen opens; the group is named in plain words (docs/plans/2026-11-04-glass-polish-design.md, section 5). */
describe('the machine\'s marquee', () => {
  const sign = () => document.querySelector('.kb-vending-sign')!;
  const names = ['FIRST NAME', 'SECOND NAME', 'THIRD NAME'];
  test('draws the entry the random function picks, and the group keeps the shop\'s plain name', async () => {
    renderIn(seeded(300), <Vending />, { instance: shop, cards: faces, path: '/vending', copy: { shopName: 'Plain Shop', marquees: names }, random: () => 0.5 });
    expect(await screen.findByRole('group', { name: 'Plain Shop' })).toBeInTheDocument();
    expect(sign()).toHaveTextContent('SECOND NAME');
    expect(sign().closest('[aria-hidden="true"]')).not.toBeNull();
  });
  test('with no list draws the shop\'s name', async () => {
    renderIn(seeded(300), <Vending />, { instance: shop, cards: faces, path: '/vending', copy: { shopName: 'Plain Shop' } });
    await screen.findByRole('group', { name: 'Plain Shop' });
    expect(sign()).toHaveTextContent('Plain Shop');
  });
});

describe('the machine as the Vending board draws it', () => {
  test('each slot is a button that names the card and its price, the selected one says so, and the rest are sealed', async () => {
    open(seeded(562));
    expect(await screen.findByRole('button', { name: 'Buy Stick Around, 1.00 orb, common Cast' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    expect(screen.getByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast, selected' })).toHaveAttribute('aria-pressed', 'true');
    for (const code of ['B1', 'B2', 'C1', 'C2']) expect(screen.getByRole('img', { name: `Empty slot ${code}, waiting for a future postcard` })).toBeInTheDocument();
    expect(screen.getByText('4 slots empty')).toBeInTheDocument();
  });

  test('a price an admin has tuned is the one the slot, the display and the button say, and the purchase pays it', async () => {
    const fake = seeded(562);
    fake.seed.slot({ card: 'whoops' }, { price: 250 });
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 2.50 orbs, common Cast' }));
    expect(screen.getByRole('status', { name: 'Selected: A2, Whoops!, 2.50' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 2.50' }));
    await waitFor(() => expect(document.querySelector('.kb-vending-sum')).toHaveTextContent('3.12'));
  });

  test('a price that moved after the look is refused in plain words, and the machine is read again to show the new one', async () => {
    const fake = seeded(562);
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    fake.seed.slot({ card: 'whoops' }, { price: 175 });
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    expect(await screen.findByText('The price is now 1.75, not 1.00.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Buy Whoops!, 1.75 orbs, common Cast/ })).toBeInTheDocument();
  });

  test('the price display and the buy button carry the selection, and nothing is bought before the buy button is pressed', async () => {
    const fake = seeded(562);
    const buy = vi.spyOn(fake, 'buyCard');
    open(fake);
    const none = await screen.findByRole('status', { name: 'Nothing selected' });
    expect(none).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    expect(screen.getByRole('status', { name: 'Selected: A2, Whoops!, 1.00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' })).toBeEnabled();
    expect(buy).not.toHaveBeenCalled();
  });

  test('the head is the board\'s yellow column head in the side column, and "Your hand" is a game piece like the HUD\'s Hand button, not a GlassButton', async () => {
    open(seeded(562));
    await screen.findByRole('button', { name: 'Buy Stick Around, 1.00 orb, common Cast' });
    const side = document.querySelector('.kb-vending-side')!;
    expect(side.querySelector('.kb-vending-head .kb-vending-eyebrow')).toHaveTextContent('Spend Aura');
    expect(side.querySelector('.kb-vending-head h1.kb-vending-title')).toHaveTextContent('Vending Machine');
    expect(document.querySelector('.kb-page-head')).toBeNull();
    expect(side.querySelector('.kb-vending-head')).toHaveAttribute('data-kb-calm-region');
    const hand = screen.getByRole('link', { name: /^Your hand/ });
    expect(hand).toHaveClass('kb-vending-hand', 'kb-glass-skew');
    expect(hand).not.toHaveAttribute('data-kb-kind');
    expect(hand.querySelector('.kb-vending-hand-word.kb-glass-upright')).toHaveTextContent('Your hand');
  });

  test('on the phone the head\'s box does not reach past the column, which would scroll the page sideways', () => {
    const css = readFileSync('engine/ui/vending/vending.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = css.match(/:where\(:root\[data-kb-layout='phone'\]\) \.kb-vending-head \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/margin:\s*-16px 0/);
    expect(rule).toMatch(/padding:\s*16px 0/);
  });

  test('the wallet panel says solid only, the wallet before and after, and the hand before and after', async () => {
    open(seeded(562));
    await screen.findByRole('button', { name: 'Buy Stick Around, 1.00 orb, common Cast' });
    expect(screen.getByText(/Wallet · solid only/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Wallet: 5.62 of 6.00' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    expect(screen.getByRole('img', { name: 'Wallet: 5.62 of 6.00; buying Whoops! leaves 4.62' })).toBeInTheDocument();
    expect(document.querySelector('.kb-vending-sum')).toHaveTextContent('5.62 → 4.62');
    expect(screen.getByRole('link', { name: 'Your hand 2 → 3' })).toBeInTheDocument();
  });

  test('the machine is named by the instance, the price note says what a long post costs, and the sealed slots keep their line', async () => {
    open(seeded(562));
    await screen.findByRole('button', { name: 'Buy Stick Around, 1.00 orb, common Cast' });
    expect(screen.getByRole('group', { name: 'Shop' })).toBeInTheDocument();
    /* The list of what is in the machine is gone at every width (it grows with every card added): the info buttons carry the rules. */
    expect(screen.queryByRole('region', { name: 'In the machine' })).toBeNull();
    expect(screen.queryByText('A Sweet card. Holds each reader on a post.')).toBeNull();
    expect(screen.getByText('4 slots empty')).toBeInTheDocument();
    expect(screen.getByText('More postcards arrive in later seasons.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    expect(screen.getByText('Playing it on a long post costs up to 2.00 more, never more than 3.00 in all.')).toBeInTheDocument();
  });
});

describe('the info button on each card\'s slot', () => {
  test('each stocked slot has a button named for its card, and a sealed slot has none', async () => {
    open(seeded(562));
    expect(await screen.findByRole('button', { name: 'About Stick Around' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About Whoops!' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^About / })).toHaveLength(2);
    for (const code of ['B1', 'B2', 'C1', 'C2']) {
      const sealed = screen.getByRole('img', { name: `Empty slot ${code}, waiting for a future postcard` });
      expect(within(sealed).queryByRole('button')).toBeNull();
    }
  });

  test('it opens a dialog named for the card with the card\'s rules in plain words', async () => {
    open(seeded(562));
    fireEvent.click(await screen.findByRole('button', { name: 'About Whoops!' }));
    const dialog = screen.getByRole('dialog', { name: 'Whoops!' });
    /* The face's plate holds the summary, which a card with no summary of its own draws as its rules: the rules' own line is the one read. */
    expect(dialog.querySelector('.kb-vending-about-says')).toHaveTextContent('A Salty card. Splats a post in your ink.');
    expect(within(dialog).queryByText('A Sweet card. Holds each reader on a post.')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  test('it is the card\'s info: its face at the sheet\'s size, the slot and kind over the title, and the price in words', async () => {
    open(seeded(562));
    fireEvent.click(await screen.findByRole('button', { name: 'About Whoops!' }));
    const dialog = screen.getByRole('dialog', { name: 'Whoops!' });
    /* The face is the Postcard at the sheet's size, an article, beside the rules and never an image of its own. */
    const face = dialog.querySelector('.kb-postcard[data-kb-card="whoops"]');
    expect(face).not.toBeNull();
    expect(face).toHaveAttribute('data-size', 'sheet');
    expect(face!.tagName).toBe('ARTICLE');
    /* The title is the dialog's heading; the slot's code and the card's kind (the instance's word for how it is played) are over it. */
    expect(within(dialog).getByRole('heading', { name: 'Whoops!' })).toBeInTheDocument();
    expect(within(dialog).getByText('Slot A2 · Cast')).toBeInTheDocument();
    /* Its price in words, and a long post's extra said, never a bare "1.00+". */
    expect(dialog.querySelector('.kb-vending-about-price')).toHaveTextContent(/^1\.00 to buy · more to play on a long post$/u);
    expect(dialog.textContent).not.toContain('1.00+');
  });

  test('the card info\'s title is the large display size (the play form\'s), and the medium one on the phone (the boards draw 60px and 40px)', () => {
    const css = readFileSync('engine/ui/vending/vending.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/[.[\]()':=-]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(rule('.kb-vending-about-dialog--card .kb-glass-dialog-head')).toMatch(/font-size:\s*var\(--kb-glass-size-display-l\)/);
    expect(rule(":where(:root[data-kb-layout='phone']) .kb-vending-about-dialog--card .kb-glass-dialog-head")).toMatch(/font-size:\s*var\(--kb-glass-size-display-m\)/);
  });

  test('a card whose play costs nothing more says its price alone', async () => {
    open(seeded(562));
    fireEvent.click(await screen.findByRole('button', { name: 'About Stick Around' }));
    const dialog = screen.getByRole('dialog', { name: 'Stick Around' });
    expect(dialog.querySelector('.kb-vending-about-price')).toHaveTextContent(/^1\.00 to buy$/u);
    expect(dialog.textContent).not.toContain('long post');
    expect(within(dialog).getByText('Slot A1 · Cast')).toBeInTheDocument();
    expect(dialog.querySelector('.kb-postcard[data-kb-card="stick"]')).toHaveAttribute('data-size', 'sheet');
  });

  test('Close puts focus back on the info button', async () => {
    open(seeded(562));
    const about = await screen.findByRole('button', { name: 'About Stick Around' });
    about.focus();
    fireEvent.click(about);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Stick Around' })).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    /* Given back in the microtask after the commit that closes the dialog. */
    await waitFor(() => expect(about).toHaveFocus());
  });

  test('Esc closes the overlay alone, and focus is back on the info button', async () => {
    open(seeded(562));
    const about = await screen.findByRole('button', { name: 'About Whoops!' });
    about.focus();
    fireEvent.click(about);
    const dialog = screen.getByRole('dialog', { name: 'Whoops!' });
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { dialog.dispatchEvent(esc); });
    expect(screen.queryByRole('dialog')).toBeNull();
    /* Given back in the microtask after the commit that closes the dialog. */
    await waitFor(() => expect(about).toHaveFocus());
    /* The overlay answered the key, so the page under it (the glass's Back) is told it was handled. */
    expect(esc.defaultPrevented).toBe(true);
  });

  test('opening it selects no slot, leaves the price display as it was, and spends nothing', async () => {
    const fake = seeded(562);
    const buy = vi.spyOn(fake, 'buyCard');
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Stick Around, 1.00 orb, common Cast' }));
    fireEvent.click(screen.getByRole('button', { name: 'About Whoops!' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    /* The pick stays the one made before, and the other slot was never selected. */
    expect(screen.getByRole('button', { name: 'Buy Stick Around, 1.00 orb, common Cast, selected' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('status', { name: 'Selected: A1, Stick Around, 1.00' })).toBeInTheDocument();
    expect(buy).not.toHaveBeenCalled();
    expect((await fake.wallet()).balance).toBe(562);
  });

  test('with nothing selected, opening it leaves the display at "Nothing selected"', async () => {
    open(seeded(562));
    fireEvent.click(await screen.findByRole('button', { name: 'About Stick Around' }));
    expect(screen.getByRole('status', { name: 'Nothing selected' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy' })).toBeDisabled();
  });
});

describe('buying', () => {
  test('spends the card\'s price from the wallet, the count rises by one, and the card is in the hand at once under reduced motion', async () => {
    const fake = seeded(562);
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    expect(screen.getByText('Whoops! costs 1.00 and your wallet holds 0.62. Only solid Aura can be spent; the ghost estimate cannot.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Whoops! costs 1.00 and your wallet holds 0.62.');
    expect(buy).not.toHaveBeenCalled();
    expect((await fake.myCards()).find((c) => c.card === 'whoops')?.held).toBe(1);
  });

  test('a refusal the server makes after the screen\'s preview is said in plain words too, in orbs and not hundredths', async () => {
    const fake = seeded(562);
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    fake.seed.loseNextAnswer(true);
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('look before you try again');
    /* The server did it before the answer was lost, so the rows read again show it. */
    await waitFor(() => expect(document.querySelector('.kb-vending-sum')).toHaveTextContent(/^4\.62/), { timeout: 800 });
    expect((await fake.myCards()).find((c) => c.card === 'whoops')?.held).toBe(2);
    expect(document.querySelector('.kb-vending-hand-count')).toHaveTextContent('3');
  });

  test('Buy is a busy button while the purchase is out: aria-busy, its name kept, and a second press buys once', async () => {
    const fake = seeded(562);
    let release!: () => void;
    const real = fake.buyCard.bind(fake);
    const buy = vi.spyOn(fake, 'buyCard').mockImplementation((...args) => new Promise((resolve) => { release = () => resolve(real(...args)); }));
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    const button = screen.getByRole('button', { name: 'Buy Whoops! · 1.00' });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' })).toBe(button);
    fireEvent.click(button);
    expect(buy).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(document.querySelector('.kb-vending-outcome')).toHaveTextContent(/is in your hand/));
  });

  test('two presses in one tick buy once', async () => {
    const fake = seeded(562);
    const buy = vi.spyOn(fake, 'buyCard');
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    vi.useFakeTimers();
    for (let i = 0; i < 2; i++) {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' })); await Promise.resolve(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    }
    /* The hand holds 4 now; neither card has landed, so it reads 2 (and the pick would make 3). */
    expect(document.querySelector('.kb-vending-hand-count')).toHaveTextContent('2 → 3');
    await act(async () => { await vi.advanceTimersByTimeAsync(deliveryMs + 400); });
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
    vi.spyOn(fake, 'buyCard').mockImplementation(async (slot) => {
      const answer = await real(slot);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' })).toHaveAttribute('aria-busy', 'true'));
    act(() => fake.signInAs(other));
    await land();
    await nothingOfA();
  });

  test('a stale answer for the first account landing after the second has picked a slot leaves the second account\'s pick alone', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    const { fake, other, land } = heldAnswer();
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' })).toHaveAttribute('aria-busy', 'true'));
    act(() => fake.signInAs(other));
    /* The second account's page has loaded once its wallet shows. */
    await waitFor(() => expect(document.querySelector('.kb-vending-sum')).toHaveTextContent(/^3\.00$/), { timeout: 800 });
    fireEvent.click(screen.getByRole('button', { name: 'Buy Stick Around, 1.00 orb, common Cast' }));
    await land();
    /* Only change()'s account check keeps the first account's answer from replacing what the second holds. */
    expect(screen.getByRole('button', { name: 'Buy Stick Around, 1.00 orb, common Cast, selected' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('signing out and in as another account clears the first one\'s pick and its outcome too', async () => {
    const fake = seeded(562);
    const other = fake.seed.account('bo');
    fake.seed.character(other, 'Sprocket', 'face');
    fake.seed.wallet(other, 300);
    fake.seed.cards(other, { stick: 1 });
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    expect(await screen.findByText('Whoops! is in your hand. 4.62 is left, solid.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Buy Stick Around, 1.00 orb, common Cast' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' })); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    /* The sixth orb (0.62 full) drains first; the fifth, still full, has not moved. */
    expect(orbSolids()).toEqual([1, 1, 1, 1, 1, 0]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(orbSolids()).toEqual([1, 1, 1, 1, 0.62, 0]);
  });
});

/* The Smooth feel's delivery of a single card: the drop, the rest and the flight, as the preset says. */
const deliveryMs = motionPresets.deliveryMs({ name: 'smooth', ...feelTokens('smooth') });

describe('the drop and the flight, under full motion', () => {
  test('the card enters the tray, the hand still counts what it held, and the count moves when the card lands', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    const fake = seeded(562);
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    /* In the tray and on its way: the hand has not received it, so it still reads what it held (the picked card is still picked, so 2 → 3), not 3 → 4. */
    await waitFor(() => expect(document.querySelector('.kb-vending-tray .kb-vending-drop')).not.toBeNull());
    expect(document.querySelector('.kb-vending-hand-count')).toHaveTextContent('2 → 3');
    await new Promise((r) => setTimeout(r, 300));
    expect(document.querySelector('.kb-vending-drop')).not.toBeNull();
    expect(document.querySelector('.kb-vending-hand-count')).toHaveTextContent('2 → 3');
    /* The flight ends (the drop, the rest and the flight: the feel's delivery time): the tray is empty and the hand holds three. */
    await waitFor(() => expect(document.querySelector('.kb-vending-drop')).toBeNull(), { timeout: 3000 });
    expect(screen.getByRole('link', { name: 'Your hand 3 → 4' })).toBeInTheDocument();
  });

  test('a card whose landing is never reported still reaches the hand once the delivery time has passed', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    const fake = seeded(562);
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' })); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('link', { name: 'Your hand 2 → 3' })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(deliveryMs + 400); });
    expect(document.querySelector('.kb-vending-drop')).toBeNull();
    expect(screen.getByRole('link', { name: 'Your hand 3 → 4' })).toBeInTheDocument();
  });
});

describe('a second buy while a card is flying (booster packs plan, Task 10)', () => {
  test('the hand counts each card as it lands: both flying, the first landed, the second landed; no flight lost and none stuck', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    document.documentElement.setAttribute('data-kb-motion-feel', 'smooth');
    const fake = seeded(562);
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    const count = () => document.querySelector('.kb-vending-hand-count');
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    await waitFor(() => expect(document.querySelectorAll('.kb-vending-drop')).toHaveLength(1));
    /* Partway through the first card's delivery, the second is bought. */
    await new Promise((r) => setTimeout(r, 300));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    await waitFor(() => expect(document.querySelectorAll('.kb-vending-drop')).toHaveLength(2));
    /* The hand holds four; neither has landed, so it reads the two it held. */
    expect(count()).toHaveTextContent('2 → 3');
    /* The first lands (the second is still on its way): three, and one card still flying. */
    await waitFor(() => expect(count()).toHaveTextContent('3 → 4'), { timeout: 3000 });
    expect(document.querySelectorAll('.kb-vending-drop')).toHaveLength(1);
    /* The second lands: all four, nothing flying, and the count is not past what the hand holds. */
    await waitFor(() => expect(count()).toHaveTextContent('4 → 5'), { timeout: 3000 });
    expect(document.querySelector('.kb-vending-drop')).toBeNull();
    expect((await fake.myCards()).find((c) => c.card === 'whoops')?.held).toBe(3);
  });
});

describe('the single buy\'s flight (booster packs plan, Task 10)', () => {
  const rectOf = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) });

  test('the flying card is aimed at the hand link\'s measured rect, from the card\'s own box', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    document.documentElement.setAttribute('data-kb-motion-feel', 'smooth');
    const toHand = vi.mocked(motionPresets.toHand);
    toHand.mockClear();
    const fake = seeded(562);
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    /* A test double's rects: the link is where the page puts it today, the card in the tray. */
    const link = document.querySelector('.kb-vending-hand')!;
    vi.spyOn(link, 'getBoundingClientRect').mockReturnValue(rectOf(40, 60, 170, 52));
    const proto = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('kb-vending-drop') ? rectOf(500, 600, 86, 129) : link === this ? rectOf(40, 60, 170, 52) : rectOf(0, 0, 0, 0);
    });
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' })); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(document.querySelector('.kb-vending-tray .kb-vending-drop')).not.toBeNull();
    /* Not before the card has dropped and rested. */
    expect(toHand).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(380 + 210 + 20); });
    expect(toHand).toHaveBeenCalledTimes(1);
    const [feel, from, to, delay] = toHand.mock.calls[0]!;
    expect(feel?.name).toBe('smooth');
    expect(from).toMatchObject({ x: 500, y: 600, width: 86, height: 129 });
    expect(to).toMatchObject({ x: 40, y: 60, width: 170, height: 52 });
    expect(delay).toBe(0);
    proto.mockRestore();
  });

  test('the stylesheet has no fixed keyframes for the drop: the flight is the preset\'s', () => {
    const css = readFileSync('engine/ui/vending/vending.css', 'utf8');
    expect(css).not.toMatch(/@keyframes\s+kb-vending-drop/u);
    expect(css).not.toMatch(/animation:[^;]*kb-vending-drop/u);
  });
});

/* #89 P2-1 and P3-2: the purchase's outcome is said into a region already on the page, and the removed list's names are gone. */
describe('what the machine says to a screen reader', () => {
  test('the outcome is written into a polite region that was on the page, empty, before it spoke', async () => {
    const fake = seeded(562);
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    const region = document.querySelector<HTMLElement>('.kb-vending-outcome[role="status"]');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('');
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    await waitFor(() => expect(region).toHaveTextContent(/is in your hand/));
    expect(document.querySelector('.kb-vending-outcome[role="status"]')).toBe(region);
  });

  test('a refusal is said at once, in a region that was on the page, empty, before it spoke', async () => {
    const fake = seeded(562);
    vi.spyOn(fake, 'buyCard').mockResolvedValue({ ok: false, error: 'the Vending Machine is closed' });
    open(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Whoops!, 1.00 orb, common Cast' }));
    const region = screen.getByRole('alert');
    expect(region).toHaveTextContent('');
    fireEvent.click(screen.getByRole('button', { name: 'Buy Whoops! · 1.00' }));
    await waitFor(() => expect(region).toHaveTextContent('The Vending Machine is closed.'));
    expect(screen.getByRole('alert')).toBe(region);
  });

  test('no element or rule names the removed list', async () => {
    open(seeded(562));
    await screen.findByText('More postcards arrive in later seasons.');
    expect(document.querySelector('[class*="kb-vending-list"], [class*="kb-vending-item"]')).toBeNull();
    expect(readFileSync('engine/ui/vending/vending.css', 'utf8')).not.toMatch(/kb-vending-(list|item)/u);
    /* The line about the empty slots is its own, and wears nothing of an empty slot's drawing. */
    const line = screen.getByText('More postcards arrive in later seasons.').parentElement!;
    expect(line).toHaveClass('kb-vending-empty-line');
    expect(line).not.toHaveClass('kb-vending-sealed');
  });
});


/*
 * The machine with a pack in it (the booster packs plan, Task 5): a Booster in A1, two commons, an uncommon, and a rare that is hidden (it comes in packs
 * and is not sold on its own). The Booster's four first pulls roll commons; the hit pull rolls an uncommon (3 in 4) or the rare (1 in 4).
 */
const ruleOf = (key: string, name: string, rarity: CardRules['rarity'], alignment: CardRules['alignment'] = 'sweet'): CardRules => ({ key, name, alignment, rarity, playPrice: () => 0, canApply: () => ok, validateConfig: (c) => ({ ok: true, value: c }) });
const trap = ruleOf('trap', 'Trap Card', 'uncommon', 'pepperoni');
const main = ruleOf('main', 'Main Event', 'rare');
const stocked: Instance = {
  ...testInstance, cards: [stick, whoops, trap, main],
  packs: [{ key: 'booster', pulls: [{ weights: { common: 1 } }, { weights: { common: 1 } }, { weights: { common: 1 } }, { weights: { common: 1 } }, { weights: { uncommon: 3, rare: 1 } }] }],
  machine: [
    { item: { pack: 'booster' }, availability: 'onSale', price: 300 }, { item: { card: 'stick' }, availability: 'onSale', price: 100 },
    { item: { card: 'whoops' }, availability: 'onSale', price: 100 }, { item: { card: 'trap' }, availability: 'onSale', price: 150 },
    { item: { card: 'main' }, availability: 'hidden', price: 300 },
  ],
};
const stockedFaces: CardUi[] = [...faces, { key: 'trap', art: { ...art, color: '#ff3d7f' }, describe: () => 'A Pepperoni card. Catches a play.' }, { key: 'main', art, describe: () => 'A Sweet card. Pins a thread.' }];
const packsUi = { booster: { name: 'Booster', art: { color: '#ffd93d', ink: '#1a1403', canvas: '', mark: '', credit: 'Test' } } };

function stockedWorld(wallet: number) {
  const fake = buildWorld(undefined, stocked);
  const account = fake.seed.account('ana');
  fake.seed.character(account, 'Pipewrench', 'heel');
  fake.seed.wallet(account, wallet);
  fake.seed.cards(account, { stick: 1, whoops: 1 });
  fake.signInAs(account);
  return fake;
}
const openStocked = (fake: Fake) => renderIn(fake, <Vending />, { instance: stocked, cards: stockedFaces, packs: packsUi, path: '/vending' });
const slotNames = () => [...document.querySelectorAll<HTMLElement>('.kb-vending-slots .kb-vending-slot')].map((e) => e.getAttribute('aria-label')!);
const BOOSTER = 'Buy Booster, 3.00 orbs, a pack of 5 postcards';

describe('the machine\'s slots, from the machine', () => {
  test('draws the machine\'s slots in their order, a pack among them, and no hidden slot; the places left are sealed', async () => {
    openStocked(stockedWorld(562));
    await screen.findByRole('button', { name: BOOSTER });
    expect(slotNames()).toEqual([
      BOOSTER, 'Buy Stick Around, 1.00 orb, common Cast', 'Buy Whoops!, 1.00 orb, common Cast', 'Buy Trap Card, 1.50 orbs, uncommon Cast',
      'Empty slot C1, waiting for a future postcard', 'Empty slot C2, waiting for a future postcard',
    ]);
    expect(screen.queryByRole('button', { name: /Main Event/u })).toBeNull();
    expect(screen.getByText('2 slots empty')).toBeInTheDocument();
  });

  test('says nothing of empty slots before the first look has answered', async () => {
    const fake = stockedWorld(562);
    let answer: (s: Awaited<ReturnType<Fake['machine']>>) => void = () => {};
    const real = fake.machine.bind(fake);
    vi.spyOn(fake, 'machine').mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    openStocked(fake);
    await screen.findByRole('group', { name: 'Shop' });
    expect(screen.queryByText(/slots? empty/u)).toBeNull();
    expect(screen.queryByRole('img', { name: /^Empty slot/u })).toBeNull();
    expect(document.querySelector('.kb-vending-slots')).toHaveAttribute('aria-busy', 'true');
    await act(async () => { answer(await real()); });
    expect(await screen.findByText('2 slots empty')).toBeInTheDocument();
    expect(document.querySelector('.kb-vending-slots')).not.toHaveAttribute('aria-busy');
  });

  test('a machine that cannot be read says so plainly, draws no slot and no price, and Try again reads it again', async () => {
    const fake = stockedWorld(562);
    const read = vi.spyOn(fake, 'machine').mockRejectedValueOnce(new Error('down'));
    openStocked(fake);
    expect(await screen.findByText('The machine can\'t be read right now.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Buy / })).toBeNull();
    expect(screen.queryByText(/slots? empty/u)).toBeNull();
    read.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: BOOSTER })).toBeInTheDocument();
    expect(screen.queryByText('The machine can\'t be read right now.')).toBeNull();
  });

  test('a sold out slot is greyed and says it is sold out; it cannot be selected', async () => {
    const fake = stockedWorld(562);
    fake.seed.slot({ card: 'stick' }, { availability: 'soldOut' });
    openStocked(fake);
    const slot = await screen.findByRole('button', { name: 'Stick Around, sold out' });
    expect(slot).toHaveAttribute('aria-disabled', 'true');
    expect(slot.closest('.kb-vending-cell')).toHaveAttribute('data-kb-sold', '');
    fireEvent.click(slot);
    expect(screen.getByRole('status', { name: 'Nothing selected' })).toBeInTheDocument();
    expect(slot).not.toHaveAttribute('aria-pressed', 'true');
    /* Its info is still there: what the card is can be read. */
    expect(screen.getByRole('button', { name: 'About Stick Around' })).toBeInTheDocument();
  });

  test('a price the Boss moved shows the admin\'s price struck through beside the new one, and the slot\'s name says it was marked up', async () => {
    const fake = stockedWorld(562);
    fake.seed.slot({ card: 'trap' }, { price: 225, move: { kind: 'repriceSlot', act: 'a1', ends: '2026-11-08T20:00:00Z', demand: null, progress: null, was: 150, percent: 150, hours: null } });
    openStocked(fake);
    const slot = await screen.findByRole('button', { name: 'Buy Trap Card, 2.25 orbs, marked up from 1.50, uncommon Cast' });
    const shelf = slot.closest('.kb-vending-cell')!.querySelector('.kb-vending-shelf')!;
    expect(shelf.querySelector('s')).toHaveTextContent('1.50');
    expect(shelf).toHaveTextContent('2.25');
  });

  test('a pulled slot reads the move\'s words: on the slot, and in the Boss\'s moves beside the machine, with its way out and how far it is', async () => {
    const fake = stockedWorld(562);
    const [board] = await fake.boardNames();
    fake.seed.slot({ card: 'whoops' }, {
      availability: 'soldOut',
      move: { kind: 'pullSlot', act: 'a2', ends: '2026-11-09T12:00:00Z', was: 100, percent: null, hours: null,
        demand: { kind: 'distinctCharactersOnBoard', params: { board: board!.id, count: 12 } }, progress: { done: 7, of: 12, met: false, checkedAt: '2026-11-07T10:00:00Z' } },
    });
    openStocked(fake);
    expect(await screen.findByRole('button', { name: 'Whoops!, sold out: pulled by the Boss until Nov 9' })).toHaveAttribute('aria-disabled', 'true');
    const moves = await screen.findByRole('region', { name: 'The Boss\'s moves' });
    expect(moves).toHaveTextContent(`Whoops! is pulled until Nov 9, or sooner if its demand is met: 12 different characters to post in ${board!.name} (7 of 12 so far). It still comes in Boosters.`);
  });

  test('a sold out slot\'s card info says what its chip says in place of a price to buy, and keeps the face and the rules', async () => {
    const fake = stockedWorld(562);
    fake.seed.slot({ card: 'stick' }, { availability: 'soldOut' });
    openStocked(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'About Stick Around' }));
    const dialog = screen.getByRole('dialog', { name: 'Stick Around' });
    expect(dialog.querySelector('.kb-vending-about-price')).toHaveTextContent(/^Sold out$/u);
    expect(dialog.textContent).not.toContain('to buy');
    expect(dialog.querySelector('.kb-postcard[data-kb-card="stick"]')).not.toBeNull();
    expect(dialog.querySelector('.kb-vending-about-says')).not.toBeEmptyDOMElement();
  });

  test('a pulled slot\'s card info says it was pulled and until when', async () => {
    const fake = stockedWorld(562);
    fake.seed.slot({ card: 'whoops' }, {
      availability: 'soldOut',
      move: { kind: 'pullSlot', act: 'a2', ends: '2026-11-09T12:00:00Z', was: 100, percent: null, hours: null, demand: null, progress: null },
    });
    openStocked(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'About Whoops!' }));
    const dialog = screen.getByRole('dialog', { name: 'Whoops!' });
    expect(dialog.querySelector('.kb-vending-about-price')).toHaveTextContent(/^Pulled by the Boss until Nov 9$/u);
    expect(dialog.textContent).not.toContain('to buy');
  });

  test('a price the Boss moved is said as the current price in words, with no struck old price and no "+"', async () => {
    const fake = stockedWorld(562);
    fake.seed.slot({ card: 'trap' }, { price: 225, move: { kind: 'repriceSlot', act: 'a1', ends: '2026-11-08T20:00:00Z', demand: null, progress: null, was: 150, percent: 150, hours: null } });
    openStocked(fake);
    fireEvent.click(await screen.findByRole('button', { name: 'About Trap Card' }));
    const dialog = screen.getByRole('dialog', { name: 'Trap Card' });
    const price = dialog.querySelector('.kb-vending-about-price')!;
    expect(price.textContent).toMatch(/^2\.25 to buy/u);
    expect(dialog.querySelector('s')).toBeNull();
    expect(dialog.textContent).not.toContain('1.50');
    expect(dialog.textContent).not.toContain('+');
  });

  test('a flash sale and a markup are each worded plainly, and a machine with no move in force has no Boss\'s moves', async () => {
    const fake = stockedWorld(562);
    openStocked(fake);
    await screen.findByRole('button', { name: BOOSTER });
    expect(screen.queryByRole('region', { name: 'The Boss\'s moves' })).toBeNull();
    cleanup();
    const other = stockedWorld(562);
    other.seed.slot({ card: 'main' }, { availability: 'onSale', price: 300, move: { kind: 'flashSale', act: 'a3', ends: '2026-11-08T21:00:00Z', demand: null, progress: null, was: 300, percent: null, hours: 24 } });
    other.seed.slot({ card: 'trap' }, { price: 225, move: { kind: 'repriceSlot', act: 'a1', ends: '2026-11-08T20:00:00Z', demand: { kind: 'postsOnBoard', params: { board: 'none', count: 20 } }, progress: { done: 4, of: 20, met: false, checkedAt: null }, was: 150, percent: 150, hours: null } });
    openStocked(other);
    const moves = await screen.findByRole('region', { name: 'The Boss\'s moves' });
    expect(within(moves).getByText(/^Main Event is on flash sale/u).parentElement).toHaveTextContent(/Main Event is on flash sale at 3\.00 until Nov 8, \d\d?:00 [AP]M\./u);
    expect(within(moves).getByText(/^Trap Card is marked up/u).parentElement).toHaveTextContent('Trap Card is marked up from 1.50 to 2.25 until Nov 8, or sooner if its demand is met: 20 new posts on its board.');
  });
});

describe('a pack in the machine', () => {
  test('its info lists its odds plainly: each pull\'s table, and each card\'s chance in the hit pull', async () => {
    openStocked(stockedWorld(562));
    fireEvent.click(await screen.findByRole('button', { name: 'About Booster' }));
    const dialog = screen.getByRole('dialog', { name: 'Booster' });
    const table = within(dialog).getByRole('table', { name: 'Booster odds' });
    expect(within(table).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Cards 1 to 4, each', 'Card 5, the hit']);
    const rows = within(table).getAllByRole('row').filter((r) => within(r).queryAllByRole('cell').length === 2).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
    expect(rows).toEqual([['Common', '100%'], ['Trap Card', '75%'], ['Main Event', '25%']]);
  });

  test('a rarity is drawn as a gem whose glyph says it by shape, in the table as on a card', async () => {
    const fake = stockedWorld(562);
    openStocked(fake);
    fireEvent.click(await screen.findByRole('button', { name: BOOSTER }));
    const gems = [...document.querySelectorAll('.kb-vending-odds .kb-gem')].map((g) => [g.getAttribute('data-kb-gem'), g.getAttribute('data-kb-rarity')]);
    expect(gems).toEqual([['●', 'common'], ['◆', 'uncommon'], ['★', 'rare']]);
    for (const g of document.querySelectorAll('.kb-vending-odds .kb-gem')) expect(g).toHaveAttribute('aria-hidden', 'true');
  });

  test('selected, the pack shows five small backs, the last gold, and what opening does; the odds and what is not sold on its own stand beside the machine', async () => {
    openStocked(stockedWorld(562));
    fireEvent.click(await screen.findByRole('button', { name: BOOSTER }));
    expect(screen.getByRole('button', { name: `${BOOSTER}, selected` })).toHaveAttribute('aria-pressed', 'true');
    const inPack = screen.getByRole('region', { name: 'In this pack' });
    const backs = [...inPack.querySelectorAll('.kb-postcard-back')];
    expect(backs.map((b) => b.hasAttribute('data-hit'))).toEqual([false, false, false, false, true]);
    expect(inPack).toHaveTextContent('Five cards, the last one at least uncommon. It opens as soon as you buy it.');
    const aside = screen.getByRole('complementary', { name: 'About the Booster' });
    expect(within(aside).getByRole('table', { name: 'Booster odds' })).toBeInTheDocument();
    expect(aside).toHaveTextContent('Main Event isn\'t sold on its own. Within a rarity, every card is equally likely.');
    expect(screen.getByRole('status', { name: 'Selected: A1, Booster, 3.00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy Booster · 3.00' })).toBeEnabled();
    expect(document.querySelector('.kb-vending-sum')).toHaveTextContent('5.62 → 2.62');
    expect(screen.getByRole('link', { name: 'Your hand 2 → 7' })).toBeInTheDocument();
  });

  test('a card selected has no pack\'s odds or backs beside it', async () => {
    openStocked(stockedWorld(562));
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Stick Around, 1.00 orb, common Cast' }));
    expect(screen.queryByRole('region', { name: 'In this pack' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: /^About the/u })).toBeNull();
  });

  test('a stale pack price is refused in the server\'s words, no reveal opens, and the machine is read again to show the new price', async () => {
    const fake = stockedWorld(562);
    openStocked(fake);
    fireEvent.click(await screen.findByRole('button', { name: BOOSTER }));
    fake.seed.slot({ pack: 'booster' }, { price: 350 });
    fireEvent.click(screen.getByRole('button', { name: 'Buy Booster · 3.00' }));
    expect(await screen.findByText('The price is now 3.50, not 3.00.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByRole('button', { name: /^Buy Booster, 3\.50 orbs, a pack of 5 postcards/u })).toBeInTheDocument();
    expect((await fake.wallet()).balance).toBe(562);
  });

  test('a pack that sold out meanwhile is refused in the server\'s words, and the machine shows it sold out', async () => {
    const fake = stockedWorld(562);
    openStocked(fake);
    fireEvent.click(await screen.findByRole('button', { name: BOOSTER }));
    fake.seed.slot({ pack: 'booster' }, { availability: 'soldOut' });
    fireEvent.click(screen.getByRole('button', { name: 'Buy Booster · 3.00' }));
    expect(await screen.findByText('This slot is sold out.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Booster, sold out' })).toBeInTheDocument();
  });

  test('too little solid Aura is refused before the server is asked', async () => {
    const fake = stockedWorld(262);
    const buy = vi.spyOn(fake, 'buyPack');
    openStocked(fake);
    fireEvent.click(await screen.findByRole('button', { name: BOOSTER }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Booster · 3.00' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Booster costs 3.00 and your wallet holds 2.62.');
    expect(buy).not.toHaveBeenCalled();
  });
});

describe('buying a pack opens the reveal', () => {
  /** The pack bought: the answer the machine gave, kept so a test can say what was shown is what was answered. */
  function buyBooster() {
    const fake = stockedWorld(562);
    const answers: string[][] = [];
    const real = fake.buyPack.bind(fake);
    vi.spyOn(fake, 'buyPack').mockImplementation(async (slot) => { const a = await real(slot); if (a.ok) answers.push([...a.value.contents]); return a; });
    openStocked(fake);
    return { fake, answers };
  }
  const press = async () => {
    fireEvent.click(await screen.findByRole('button', { name: BOOSTER }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Booster · 3.00' }));
    return screen.findByRole('dialog', { name: 'Opening a Booster' });
  };
  const names: Record<string, string> = { stick: 'Stick Around', whoops: 'Whoops!', trap: 'Trap Card', main: 'Main Event' };

  test('the five cards are in the hand, in the answer\'s order, before any is turned', async () => {
    const { fake, answers } = buyBooster();
    await press();
    expect(answers).toHaveLength(1);
    const contents = answers[0]!;
    expect(contents).toHaveLength(5);
    const hand = Object.fromEntries((await fake.myCards()).map((c) => [c.card, c.held]));
    const expected: Record<string, number> = { stick: 1, whoops: 1 };
    for (const c of contents) expected[c] = (expected[c] ?? 0) + 1;
    expect(hand).toEqual(expected);
    expect((await fake.wallet()).balance).toBe(262);
    expect(screen.getByRole('dialog').querySelector('.kb-opening-count')!).toHaveTextContent('0 of 5 turned over');
    /* The reveal shows what was answered: turned one at a time, the names are the answer's, in its order. */
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: /^Turn the next card$/u }));
    const shown = within(screen.getByRole('list', { name: 'The pack, in the order it was pulled' })).getAllByRole('listitem').map((li) => li.getAttribute('aria-label')!.split(':')[1]!.split(',')[0]!.trim());
    expect(shown).toEqual(contents.map((c) => names[c]));
    expect(shown[4]).toMatch(/^(Trap Card|Main Event)$/u);
  });

  test('Esc before every card is turned closes the reveal, and the hand still holds all five', async () => {
    const { fake } = buyBooster();
    await press();
    fireEvent.click(screen.getByRole('button', { name: 'Turn the next card' }));
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { screen.getByRole('dialog').dispatchEvent(esc); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await fake.myCards()).reduce((n, c) => n + c.held, 0)).toBe(7);
    expect(document.querySelector('.kb-vending-hand-count')).toHaveTextContent('7');
  });

  test('focus goes back to the pack\'s slot when it closes', async () => {
    buyBooster();
    await press();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: `${BOOSTER}, selected` })).toHaveFocus());
  });

  test('the words of what was bought are said as the purchase\'s outcome, and the wallet shows what is left', async () => {
    buyBooster();
    await press();
    expect(document.querySelector('.kb-vending-outcome[role="status"]')).toHaveTextContent('Booster opened: its 5 cards are in your hand. 2.62 is left, solid.');
    expect(screen.getByRole('img', { name: /^Wallet: 2\.62 of 6\.00/u })).toBeInTheDocument();
  });

  test('after a pack is bought the machine is read again, so a slot that changed meanwhile shows what it is now', async () => {
    const fake = stockedWorld(562);
    const read = vi.spyOn(fake, 'machine');
    openStocked(fake);
    fireEvent.click(await screen.findByRole('button', { name: BOOSTER }));
    const before = read.mock.calls.length;
    fake.seed.slot({ card: 'trap' }, { availability: 'soldOut' });
    fireEvent.click(screen.getByRole('button', { name: 'Buy Booster · 3.00' }));
    await screen.findByRole('dialog', { name: 'Opening a Booster' });
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before));
    expect(await screen.findByRole('button', { name: 'Trap Card, sold out' })).toBeInTheDocument();
  });

  test('after a single card is bought the machine is read again', async () => {
    const fake = stockedWorld(562);
    const read = vi.spyOn(fake, 'machine');
    openStocked(fake);
    fireEvent.click(await screen.findByRole('button', { name: /^Buy Whoops!/u }));
    const before = read.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /^Buy Whoops! · / }));
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before));
  });

  test('a card the instance does not know is shown plainly in the reveal and counted, in step with the outcome line', async () => {
    const fake = stockedWorld(562);
    const real = fake.buyPack.bind(fake);
    vi.spyOn(fake, 'buyPack').mockImplementation(async (slot) => {
      const a = await real(slot);
      return a.ok ? { ok: true, value: { ...a.value, contents: [...a.value.contents.slice(0, 4), 'ghost'] } } : a;
    });
    openStocked(fake);
    fireEvent.click(await screen.findByRole('button', { name: BOOSTER }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Booster · 3.00' }));
    await screen.findByRole('dialog', { name: 'Opening a Booster' });
    expect(document.querySelector('.kb-vending-outcome[role="status"]')).toHaveTextContent('its 5 cards are in your hand');
    expect(screen.getByRole('dialog').querySelector('.kb-opening-count')!).toHaveTextContent('0 of 5 turned over');
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: /^Turn the next card$/u }));
    const ghost = within(screen.getByRole('list', { name: 'The pack, in the order it was pulled' })).getAllByRole('listitem')[4]!;
    /* It claims no rarity, alignment or way to play it: the name says only what is true, and the face draws no gem or tag. */
    expect(ghost).toHaveAccessibleName(/^Card 5: A card this machine no longer has(, the card shown)?$/u);
    expect(ghost.querySelector('.kb-postcard-gem, .kb-postcard-tag, .kb-postcard-play')).toBeNull();
    expect(ghost.querySelector('.kb-postcard')).not.toHaveAttribute('data-kb-alignment');
    expect(screen.getByRole('dialog').querySelector('.kb-opening-tag')).toHaveTextContent(/^A card this machine no longer has$/u);
    expect(screen.getByRole('dialog')).toHaveTextContent('All five are in your hand');
  });

  test('another account signing in while the reveal is open shows nothing of it', async () => {
    const fake = stockedWorld(562);
    const other = fake.seed.account('bo');
    fake.seed.character(other, 'Sprocket', 'face');
    fake.seed.wallet(other, 300);
    openStocked(fake);
    fireEvent.click(await screen.findByRole('button', { name: BOOSTER }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Booster · 3.00' }));
    await screen.findByRole('dialog', { name: 'Opening a Booster' });
    act(() => fake.signInAs(other));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
