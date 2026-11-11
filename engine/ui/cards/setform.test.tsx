/**
 * The play form's two ways for a Move, and a set card's one (docs/plans/2026-11-07-face-down-moves-plan.md, Task 8; the design's section 8):
 * on one's own post a Move offers "Play it now" and "Set face down" (a radio pair, Play chosen); Set swaps the price and message rows for what
 * the set does and keeps the card's own settings; a set card opens as Set with no choice and says what it does, from its rules. The cards are
 * the engine's test set; none is a Divided World card.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, refuse, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { Frame } from '../frame/Frame.tsx';
import { hudKey } from '../player.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { LoadedThread } from '../loaded.tsx';
import { landing } from './land.ts';
import type { CardUi, ConfigFormProps } from './types.ts';

const base = { priceKey: 'x.price', playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}) };
const blot: CardRules = { ...base, key: 'blot', name: 'Blot', alignment: 'salty', rarity: 'common', canApply: (t, e, _config, now) => landsOn({ key: 'blot' }, t, e, now) };
const spark: CardRules = { ...base, key: 'spark', name: 'Spark', alignment: 'sweet', rarity: 'common', reaches: ['character'], canApply: () => ok(undefined) };
const snare: CardRules = { ...base, key: 'snare', name: 'Snare', alignment: 'salty', rarity: 'uncommon', play: 'set', trap: { trigger: { on: 'cast' } }, catches: (c) => (c as { card?: string }).card ?? '', canApply: () => ok(undefined),
  validateConfig: (c) => (typeof (c as { card?: unknown } | undefined)?.card === 'string' ? ok(c) : refuse('the card is the key of the card to catch')) };
const pass: CardRules = { ...base, key: 'pass', name: 'Pass', alignment: 'sweet', rarity: 'uncommon', play: 'set', trap: { trigger: { on: 'visit' } }, canApply: () => ok(undefined) };
const dud: CardRules = { ...base, key: 'dud', name: 'Dud', alignment: 'pepperoni', rarity: 'common', play: 'set', trap: { trigger: { on: 'visit' } }, canApply: () => ok(undefined) };
const shield: CardRules = { ...base, key: 'shield', name: 'Shield', alignment: 'sweet', rarity: 'common', play: 'use', canApply: () => ok(undefined) };
const instance: Instance = { ...testInstance, cards: [blot, spark, snare, pass, dud, shield], settings: { ...testInstance.settings, economy: { 'x.price': 100 }, setLasts: { unit: 'day', count: 7 } } };

/** The card's own setting, in the form: one radio, to see that a Set keeps it, and the castable cards it was handed, to see the picker's list. */
function Ink({ config, onChange, id, castable }: ConfigFormProps) {
  return (
    <fieldset>
      <legend>Ink color</legend>
      <label><input type="radio" name={`${id}-ink`} aria-label="Magenta" checked={config?.color === 'm'} onChange={() => onChange({ color: 'm' })} /></label>
      <ul aria-label="Castable cards">{(castable ?? []).map((f) => <li key={f.key}>{f.name}</li>)}</ul>
    </fieldset>
  );
}
/** A picker as a catching set card's: one radio for each castable card, nothing chosen until the player chooses. */
function Pick({ config, onChange, id, castable }: ConfigFormProps) {
  return (
    <fieldset>
      <legend>The card it waits for</legend>
      {(castable ?? []).map((f) => <label key={f.key}><input type="radio" name={`${id}-catch`} aria-label={f.name} checked={config?.card === f.key} onChange={() => onChange({ card: f.key })} /></label>)}
    </fieldset>
  );
}
const art = (color: string) => ({ color, ink: '#000', canvas: '', mark: `/${color}.svg`, credit: 'Test' });
const cards: CardUi[] = [
  { key: 'blot', art: art('pink'), describe: () => 'Splats.', ConfigForm: Ink },
  { key: 'spark', art: art('cyan'), describe: () => 'Sparkles.' },
  { key: 'snare', art: art('red'), describe: () => 'Catches.', ConfigForm: Pick },
  { key: 'pass', art: art('blue'), describe: () => 'Passes.' },
  { key: 'dud', art: art('orange'), describe: () => 'Nothing.' },
  { key: 'shield', art: art('green'), describe: () => 'Shields.' },
];

class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Observer);
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Post 2 is another player's; post 3 is the HUD's own (Pipewrench); post 4 is another of the player's masks' (Mrs. Hooligan). */
function world(held: Record<string, number> = { blot: 2, spark: 1, snare: 1, pass: 1, dud: 1, shield: 1 }) {
  const fake = buildWorld({ postMaxLength: 1000 }, instance);
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const hooligan = fake.seed.character(me, 'Mrs. Hooligan', 'face');
  const gloomba = fake.seed.character(other, 'Gloomba', 'heel');
  const { thread } = fake.seed.thread('general', gloomba, 'A thread', 'post 1');
  fake.seed.post(thread, gloomba, 'post 2');
  fake.seed.post(thread, pipe, 'post 3');
  fake.seed.post(thread, hooligan, 'post 4');
  fake.seed.cards(me, held);
  fake.seed.wallet(me, 462);
  fake.signInAs(me);
  localStorage.setItem(hudKey(me), pipe);
  return { fake, thread, pipe, hooligan, me };
}
async function open(w: ReturnType<typeof world>) {
  renderIn(w.fake, <Frame><LoadedThread thread={w.thread} /></Frame>, { path: `/t/${w.thread}`, instance, cards, settings: { postMaxLength: 1000 } });
  await screen.findByRole('article', { name: /^Post 4 /u });
  await screen.findByRole('button', { name: /^Hand, \d+ postcards?/u });
}
const post = (seq: number) => document.getElementById(`post-${seq}`)!;
/** Arm a card from the hand by its name, and press its mark on the post. */
async function armAndOpen(user: ReturnType<typeof userEvent.setup>, card: string, markName: string, seq: number) {
  await user.click(screen.getByRole('button', { name: /^Hand, \d+ postcards?/u }));
  await user.click(within(screen.getByRole('region', { name: 'Your hand' })).getAllByRole('button', { name: new RegExp(`^${card},`, 'u') })[0]!);
  await user.click(await within(post(seq)).findByRole('button', { name: markName }));
  return screen.findByRole('dialog');
}

describe('a Move on one\'s own post', () => {
  test('offers Play it now (chosen) and Set face down, labeled radios, on its own post and not on another\'s', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const dialog = await armAndOpen(user, 'Blot', 'Play Blot on post 3', 3);
    const group = within(dialog).getByRole('group', { name: 'How to play it' });
    expect(within(group).getByRole('radio', { name: 'Play it now' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Set face down' })).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Play as Pipewrench' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(await within(post(2)).findByRole('button', { name: 'Play Blot on post 2' }));
    const other = await screen.findByRole('dialog');
    expect(within(other).queryByRole('radio', { name: /^(Play it now|Set face down)$/u })).toBeNull();
    expect(within(other).queryByRole('group', { name: 'How to play it' })).toBeNull();
  });

  test('is reached by the keyboard: an arrow key moves the choice to Set face down', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const dialog = await armAndOpen(user, 'Blot', 'Play Blot on post 3', 3);
    within(dialog).getByRole('radio', { name: 'Play it now' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(within(dialog).getByRole('radio', { name: 'Set face down' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'Set face down' })).toHaveFocus();
  });

  test('Set swaps the price and message rows for one sentence and "Ends by itself", keeps the card\'s settings, and sends a set', async () => {
    const user = userEvent.setup();
    const w = world();
    const setCard = vi.spyOn(w.fake, 'setCard');
    const playCard = vi.spyOn(w.fake, 'playCard');
    await open(w);
    const dialog = await armAndOpen(user, 'Blot', 'Play Blot on post 3', 3);
    expect(within(dialog).getByLabelText('Your message')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'Set face down' }));
    expect(within(dialog).queryByLabelText('Your message')).toBeNull();
    expect(within(dialog).queryByText('To pay now')).toBeNull();
    expect(dialog.querySelector('[data-kb-sets]')).toHaveTextContent('Springs when someone quotes this post, and lands on the quoting post.');
    expect(dialog.querySelector('[data-kb-ends]')).toHaveTextContent('Ends by itself in 7 days.');
    await user.click(within(dialog).getByRole('radio', { name: 'Magenta' }));
    await user.click(within(dialog).getByRole('button', { name: 'Set face down as Pipewrench' }));
    await waitFor(() => expect(setCard).toHaveBeenCalledWith('blot', w.pipe, expect.any(String), { color: 'm' }));
    expect(playCard).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('Play sends a play, as before', async () => {
    const user = userEvent.setup();
    const w = world();
    const setCard = vi.spyOn(w.fake, 'setCard');
    const playCard = vi.spyOn(w.fake, 'playCard');
    await open(w);
    const dialog = await armAndOpen(user, 'Blot', 'Play Blot on post 3', 3);
    await user.click(within(dialog).getByRole('radio', { name: 'Magenta' }));
    await user.click(within(dialog).getByRole('button', { name: 'Play as Pipewrench' }));
    await waitFor(() => expect(playCard).toHaveBeenCalled());
    expect(setCard).not.toHaveBeenCalled();
  });

  test('says where it lands by the card\'s first reach, and Set on another mask\'s post is sent as that mask', async () => {
    const user = userEvent.setup();
    const w = world();
    const setCard = vi.spyOn(w.fake, 'setCard');
    await open(w);
    const dialog = await armAndOpen(user, 'Spark', 'Play Spark on post 4', 4);
    await user.click(within(dialog).getByRole('radio', { name: 'Set face down' }));
    expect(dialog.querySelector('[data-kb-sets]')).toHaveTextContent("Springs when someone quotes this post, and lands on the quoting post's writer.");
    await user.click(within(dialog).getByRole('button', { name: 'Set face down as Mrs. Hooligan' }));
    await waitFor(() => expect(setCard).toHaveBeenCalledWith('spark', w.hooligan, expect.any(String), {}));
  });

  test('the ghost\'s name follows the choice: after Set is chosen and the form is cancelled, the mark reads "Set Blot face down on post 3"', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const dialog = await armAndOpen(user, 'Blot', 'Play Blot on post 3', 3);
    await user.click(within(dialog).getByRole('radio', { name: 'Set face down' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    const mark = await within(post(3)).findByRole('button', { name: 'Set Blot face down on post 3' });
    expect(within(post(2)).getByRole('button', { name: 'Play Blot on post 2' })).toBeInTheDocument();
    await user.click(mark);
    expect(within(await screen.findByRole('dialog')).getByRole('radio', { name: 'Set face down' })).toBeChecked();
  });
});

describe('a set card', () => {
  test('opens as Set with no choice, says what it does from its rules, and shows only its own posts\' marks', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const dialog = await armAndOpen(user, 'Snare', 'Set Snare face down on post 3', 3);
    expect(within(dialog).queryByRole('group', { name: 'How to play it' })).toBeNull();
    expect(dialog.querySelector('[data-kb-sets]')).toHaveTextContent('Waits for the card it names to be cast on this post, and takes it.');
    expect(within(dialog).getByRole('button', { name: 'Set face down as Pipewrench' })).toBeInTheDocument();
    /* Only the cards cast on a post: no Use (Shield), no set card (Snare, Pass, Dud), no card beyond a post (Spark). */
    expect(within(dialog).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Blot']);
    expect(within(post(2)).queryByRole('button', { name: /face down on post/u })).toBeNull();
  });

  test('an untouched picker chooses nothing: Set waits, said in words the button is tied to, until the card\'s settings are accepted', async () => {
    const user = userEvent.setup();
    const w = world();
    const setCard = vi.spyOn(w.fake, 'setCard');
    await open(w);
    const dialog = await armAndOpen(user, 'Snare', 'Set Snare face down on post 3', 3);
    expect(within(dialog).getByRole('radio', { name: 'Blot' })).not.toBeChecked();
    const button = within(dialog).getByRole('button', { name: 'Set face down as Pipewrench' });
    expect(button).toBeDisabled();
    const hint = document.getElementById(button.getAttribute('aria-describedby')!)!;
    expect(hint).toHaveTextContent('Choose the card\'s settings above to set it.');
    expect(hint).toHaveAttribute('role', 'status');
    await user.click(within(dialog).getByRole('radio', { name: 'Blot' }));
    expect(button).toBeEnabled();
    expect(button.getAttribute('aria-describedby')).toBeNull();
    await user.click(button);
    await waitFor(() => expect(setCard).toHaveBeenCalledWith('snare', w.pipe, expect.any(String), { card: 'blot' }));
  });

  test('says its trigger: a visit ends', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const dialog = await armAndOpen(user, 'Pass', 'Set Pass face down on post 3', 3);
    expect(dialog.querySelector('[data-kb-sets]')).toHaveTextContent('Ends the next Mod Bot visit to this post when the visit starts.');
  });

  test('a Use has no Set choice', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const dialog = await armAndOpen(user, 'Shield', 'Use Shield on post 3', 3);
    expect(within(dialog).queryByRole('radio', { name: 'Set face down' })).toBeNull();
    expect(dialog.querySelector('[data-kb-sets]')).toBeNull();
  });
});

describe('landing, asked as a Set', () => {
  test('a Move lands face down where its cast is not offered, and a cast set card without a configuration still lands', () => {
    const ctx = { cards: instance.cards, setLasts: instance.settings.setLasts };
    const target = { id: 'p', kind: 'post', currentPayload: { body: 'x' } } as never;
    expect(landing(spark, target, [], { ...ctx, faceDown: true }).ok).toBe(true);
    expect(landing(snare, target, [], ctx).ok).toBe(true);
  });
});
