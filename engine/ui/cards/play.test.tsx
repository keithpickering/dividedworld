/**
 * Playing a card (the cards plan's Task 3): from a post, "Play card" opens the hand with only the
 * cards that can land there; arming a card in the hand marks each post it can land on with "Play
 * Whoops! here"; either leads to the play form, a glass overlay, whose price is the rules' and
 * whose ways out are its own. The world is a thread of four posts in the Frame, with a hand of
 * three, a wallet of 4.62, a long post (812 characters, so Whoops! costs 0.25 more on it) and a
 * post that already carries three Whoops!.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useId, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, refuse, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { LOST_ANSWER } from '../data/api.ts';
import { plainRefusal } from './faces.ts';
import { LensHost } from './Lens.tsx';
import { Frame } from '../frame/Frame.tsx';
import { hudKey, usePlayer } from '../player.tsx';
import { usePlay } from './play.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import type { Answer } from '../data/api.ts';
import type { CardUi, ComposeProps, ConfigFormProps } from './types.ts';
import { LoadedThread } from '../loaded.tsx';

const economy = { 'whoops.price': 100, 'whoops.perLength': 25, 'whoops.lengthStep': 500, 'stick.price': 100 };

const whoopsRules: CardRules<{ color: string }> = {
  key: 'whoops', name: 'Whoops!', alignment: 'salty', rarity: 'common', stack: 3, reads: ['whoops.perLength', 'whoops.lengthStep'],
  playPrice: (settings, target) => settings.economy['whoops.perLength']! * Math.floor((target.reach === 'post' ? target.length : 0) / settings.economy['whoops.lengthStep']!),
  canApply: (target, effects, _config, now) => landsOn(whoopsRules, target, effects, now),
  validateConfig: (config) => {
    const color = typeof config === 'object' && config !== null ? (config as { color?: unknown }).color : undefined;
    return typeof color === 'string' ? ok({ color }) : refuse('the ink is a color');
  },
};
const stickRules: CardRules = {
  key: 'stick-around', name: 'Stick Around', alignment: 'sweet', rarity: 'common', 
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn({ key: 'stick-around' }, target, effects, now),
  validateConfig: (config) => ok(config),
};
const instance: Instance = { ...testInstance, cards: [whoopsRules, stickRules], settings: { ...testInstance.settings, economy } };

/** The card's own settings in the form: two inks, the first chosen when untouched. */
function Ink({ config, onChange, id }: ConfigFormProps) {
  const label = useId();
  useEffect(() => { if (config?.color === undefined) onChange({ color: '#ff2bd6' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <fieldset>
      <legend id={label}>Ink color</legend>
      <div role="radiogroup" aria-labelledby={label}>
        {[['Magenta', '#ff2bd6'], ['Cyan', '#19e3ff']].map(([name, color]) => (
          <label key={color}><input type="radio" name={`${id}-ink`} aria-label={name} checked={config?.color === color} onChange={() => onChange({ color })} /></label>
        ))}
      </div>
    </fieldset>
  );
}
const cards: CardUi[] = [
  { key: 'whoops', art: { color: '#ff3d7f', ink: '#14030a', canvas: '', mark: '/whoops-mark.svg', credit: 'Test' }, ConfigForm: Ink, describe: () => 'Splats a post.', surcharge: () => 'Long post, +0.25 per 500 characters' },
  { key: 'stick-around', art: { color: '#2ee6ff', ink: '#03141a', canvas: '', mark: '', credit: 'Test' }, describe: () => 'Holds a reader.' },
];

class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

/** The world; `server` is the instance the backend prices with, where an admin may have tuned the economy the screens were built with. */
function world(server: Instance = instance) {
  const fake = buildWorld({ postMaxLength: 1000 }, server);
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const hooligan = fake.seed.character(me, 'Mrs. Hooligan', 'face');
  const gloomba = fake.seed.character(other, 'Gloomba', 'heel');
  const { thread, act: p1 } = fake.seed.thread('general', gloomba, 'who keeps splatting', 'the first post');
  const p2 = fake.seed.post(thread, gloomba, 'x'.repeat(812));
  const p3 = fake.seed.post(thread, hooligan, 'my own, and short');
  const p4 = fake.seed.post(thread, gloomba, 'three on me');
  for (const layer of [1, 2, 3]) fake.seed.card(gloomba, p4, 'whoops', { message: `layer ${layer}`, layer, config: { color: '#ff2bd6' } });
  fake.seed.cards(me, { whoops: 2, 'stick-around': 1 });
  fake.seed.wallet(me, 462);
  fake.signInAs(me);
  /* The HUD is on Pipewrench, as the boards draw it: the player's choice on this device. */
  localStorage.setItem(hudKey(me), pipe);
  return { fake, thread, ids: [p1, p2, p3, p4], pipe, me, other, hooligan, gloomba };
}

async function open(w: ReturnType<typeof world>, ui: CardUi[] = cards) {
  /* The screens on the compiled instance, given the settings the backend reads, as the app gives them (web/src/App.tsx). */
  renderIn(w.fake, <Frame><LoadedThread thread={w.thread} /></Frame>, { path: `/t/${w.thread}`, instance, cards: ui, settings: { postMaxLength: 1000, cardEconomy: (await w.fake.settings()).cardEconomy } });
  await screen.findByRole('article', { name: /^Post 4 /u });
  await screen.findByRole('button', { name: /^Hand, 3 postcards/u });
}
const post = (seq: number) => document.getElementById(`post-${seq}`)!;
const handButton = () => screen.getByRole('button', { name: /^Hand, \d postcards?/u });
const drawer = () => screen.getByRole('region', { name: 'Your hand' });
const here = (seq: number) => within(post(seq)).queryByRole('button', { name: `Play Whoops! on post ${seq}` });
const arm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(handButton());
  await user.click(within(drawer()).getAllByRole('button', { name: 'Whoops!, Salty, Cast, common postcard' })[0]!);
};

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Observer);
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/* The owner: "why do we have "Play card" in this row at all anymore? It's a game act so it should be Glass": a card is played from the hand, armed, on the glass tile; no post's row offers it. */
describe('the post offers no "Play card"', () => {
  test('no post has one, with nothing armed or with a card armed, and the hand is reached from the HUD alone', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    expect(screen.queryByRole('button', { name: 'Play card' })).toBeNull();
    await arm(user);
    expect(screen.queryByRole('button', { name: 'Play card' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Play card' })).toBeNull();
    if (handButton().getAttribute('aria-expanded') !== 'true') await user.click(handButton());
    expect(within(drawer()).getAllByRole('button', { name: 'Whoops!, Salty, Cast, common postcard' })).toHaveLength(2);
    expect(within(drawer()).getByRole('button', { name: 'Stick Around, Sweet, Cast, common postcard' })).toBeInTheDocument();
  });
});

/* The ghost mark (marks-and-the-lens design, section 1): the armed card's play control is the last mark of the post's strip, in the post's date row, and never in the 2003 body or action row. */
describe('where the ghost mark stands', () => {
  test('on a post with no plays it is a mark of its own in the date row, a dashed "+" in the card\'s color, and in no body', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    expect(here(2)).toBeNull();
    await arm(user);
    const ghost = here(2)!;
    expect(ghost).toHaveClass('kb-ghost-mark');
    expect(ghost).toHaveTextContent('+');
    expect(ghost.closest('.kb-act-meta')).not.toBeNull();
    expect(ghost.closest('.kb-act-links, .kb-act-main')).toBeNull();
    expect(ghost.style.getPropertyValue('--kb-mark-color')).toBe('#ff3d7f');
    /* In the card's art as well as its color (the design, section 1), faint under the "+". */
    expect(ghost.querySelector('img.kb-ghost-icon')).toHaveAttribute('src', '/whoops-mark.svg');
  });

  test('on a post with a mark it ends the strip, after the marks', async () => {
    const user = userEvent.setup();
    const w = world();
    w.fake.seed.card(w.gloomba, w.ids[1]!, 'stick-around', { message: 'one', layer: 1, config: {} });
    await open(w);
    await arm(user);
    const strip = post(2).querySelector('.kb-act-meta .kb-marks') as HTMLElement;
    const buttons = within(strip).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName(/^Stick Around, 1 play, /u);
    expect(buttons[1]).toHaveAccessibleName('Play Whoops! on post 2');
  });

  test('a strip a takeover hosts (Stick Around\'s view) has no ghost mark: the play form would open under the view', async () => {
    const user = userEvent.setup();
    const w = world();
    renderIn(w.fake, <Frame><LensHost host={document.createElement('div')}><LoadedThread thread={w.thread} /></LensHost></Frame>, { path: `/t/${w.thread}`, instance, cards, settings: { postMaxLength: 1000, cardEconomy: (await w.fake.settings()).cardEconomy } });
    await screen.findByRole('article', { name: /^Post 4 /u });
    await screen.findByRole('button', { name: /^Hand, 3 postcards/u });
    await arm(user);
    expect(here(2)).toBeNull();
    expect(document.querySelector('.kb-ghost-mark')).toBeNull();
  });

  test('it opens the play form on its post', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    await arm(user);
    await user.click(here(2)!);
    expect(await screen.findByRole('dialog', { name: /Whoops!/u })).toBeInTheDocument();
  });
});

describe('the form opens whole', () => {
  test('the ghost mark is busy while the post is read, nothing opens until it lands, and the form\'s first render holds its content', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    await arm(user);
    let release!: () => void;
    const real = w.fake.actsById.bind(w.fake);
    const read = vi.spyOn(w.fake, 'actsById').mockImplementation((...args) => new Promise((resolve) => { release = () => resolve(real(...args)); }));
    await user.click(here(2)!);
    expect(here(2)).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('dialog', { name: /Whoops!/u })).toBeNull();
    await user.click(here(2)!);
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    const form = await screen.findByRole('dialog', { name: /Whoops!/u });
    expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeEnabled();
    expect(form.querySelector('[aria-busy="true"]')).toBeNull();
    expect(here(2)).not.toHaveAttribute('aria-busy');
  });

  test('Escape while the read is out cancels it: the mark stops spinning and no form opens', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    await arm(user);
    vi.spyOn(w.fake, 'actsById').mockImplementation(() => new Promise(() => undefined));
    await user.click(here(2)!);
    expect(here(2)).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Escape}');
    expect(document.querySelector('.kb-ghost-mark[aria-busy]')).toBeNull();
    expect(screen.queryByRole('dialog', { name: /Whoops!/u })).toBeNull();
  });

  test('the form opens at once from the answer read before it and reads the post again, so an edit in the gap reaches the price', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    await arm(user);
    const real = w.fake.actsById.bind(w.fake);
    const read = vi.spyOn(w.fake, 'actsById').mockImplementationOnce(async (...args) => (await real(...args)).map((a) => ({ ...a, currentPayload: { ...a.currentPayload, body: 'short' } })));
    await user.click(here(2)!);
    const form = await screen.findByRole('dialog', { name: /Whoops!/u });
    await waitFor(() => expect(within(form).getByText('To pay now').closest('div')).toHaveTextContent('0.25'));
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('Escape during the wait cancels the read and leaves the card armed', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    await arm(user);
    vi.spyOn(w.fake, 'actsById').mockImplementation(() => new Promise(() => undefined));
    await user.click(here(2)!);
    expect(here(2)).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Escape}');
    expect(here(2)).not.toHaveAttribute('aria-busy');
    expect(here(2)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Whoops!/u })).toBeNull();
  });

  test('a read that fails opens nothing and says so plainly', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    await arm(user);
    vi.spyOn(w.fake, 'actsById').mockRejectedValue(new Error('down'));
    await user.click(here(2)!);
    expect(await screen.findByRole('status', { name: 'Playing a card' })).toHaveTextContent('That didn\u2019t load. Try again.');
    expect(screen.queryByRole('dialog', { name: /Whoops!/u })).toBeNull();
  });
});

describe('arming a card', () => {
  test('each post the card can land on shows its ghost mark, "Play Whoops! on post N", and a post already carrying three shows none', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    expect(here(1)).toBeNull();
    await arm(user);
    expect(here(1)).toBeInTheDocument();
    expect(here(2)).toBeInTheDocument();
    expect(here(3)).toBeInTheDocument();
    expect(here(4)).toBeNull();
    /* The armed card says so in its name and carries its tag; the other copy does not. */
    const armed = within(drawer()).getByRole('button', { name: 'Whoops!, Salty, Cast, common postcard, armed: pick a post' });
    expect(armed.closest('li')).toHaveTextContent('Armed · pick a post');
    expect(within(drawer()).getAllByRole('button', { name: 'Whoops!, Salty, Cast, common postcard' })).toHaveLength(1);
  });

  test('the button belongs to its post: its name is the card\'s and the post\'s number', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    await arm(user);
    expect(here(2)).toHaveAccessibleName('Play Whoops! on post 2');
    expect(here(3)).toHaveAccessibleName('Play Whoops! on post 3');
  });

  test('Esc puts the card back and leaves the hand open; pressing the armed card does the same', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    await arm(user);
    await user.keyboard('{Escape}');
    expect(here(2)).toBeNull();
    expect(handButton()).toHaveAttribute('aria-expanded', 'true');
    expect(within(drawer()).getAllByRole('button', { name: 'Whoops!, Salty, Cast, common postcard' })).toHaveLength(2);
    /* A second Esc is the hand's own. */
    await user.keyboard('{Escape}');
    expect(handButton()).toHaveAttribute('aria-expanded', 'false');
    await arm(user);
    expect(here(2)).toBeInTheDocument();
    await user.click(within(drawer()).getByRole('button', { name: 'Whoops!, Salty, Cast, common postcard, armed: pick a post' }));
    expect(here(2)).toBeNull();
  });

  test('it is said to a screen reader when a card is armed and when it is put back', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    await arm(user);
    expect(screen.getByRole('status', { name: 'Playing a card' })).toHaveTextContent('Whoops! is armed. Press Play Whoops! on a post, the dashed + mark beside its date, to play it there, or Esc to put it back.');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('status', { name: 'Playing a card' })).toHaveTextContent('Whoops! is put back.');
  });
});

describe('the play form', () => {
  const playHere = async (user: ReturnType<typeof userEvent.setup>, seq: number) => {
    await arm(user);
    await user.click(within(post(seq)).getByRole('button', { name: `Play Whoops! on post ${seq}` }));
    return screen.findByRole('dialog', { name: 'Whoops!' });
  };

  test('is the card\'s ink, the message with its count, the cost, the wallet after and the HUD character to play as', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const form = await playHere(user, 2);
    expect(within(form).getByRole('radiogroup', { name: 'Ink color' })).toBeInTheDocument();
    expect(within(form).getByRole('radio', { name: 'Magenta' })).toBeChecked();
    const message = within(form).getByRole('textbox', { name: 'Your message' });
    expect(within(form).getByText('0 / 200')).toBeInTheDocument();
    await user.type(message, 'you dropped your ink');
    expect(within(form).getByText('20 / 200')).toBeInTheDocument();
    /* The board draws the count in the face's own figures; tabular ones are 4 to 5px wider at 21px, past the board match's tolerance on CI's browser. */
    expect(within(form).getByText('20 / 200')).not.toHaveClass('kb-num');
    /* Whoops! was paid for at the machine: the long post is what it costs now. */
    expect(within(form).getByText('Long post, +0.25 per 500 characters').closest('div')).toHaveTextContent('0.25');
    expect(within(form).getByText('To pay now').closest('div')).toHaveTextContent('0.25');
    expect(within(form).getByRole('img', { name: 'Wallet after playing: 4.37 of 6.00' })).toBeInTheDocument();
    expect(within(form).getByRole('link', { name: /Gloomba's post #2/u })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-2`);
    expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeEnabled();
    expect(within(form).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  test('a use card that raises the cast says which card adds how much, where, and the total includes it', async () => {
    const user = userEvent.setup();
    const vibes: CardRules = { key: 'good-vibes', name: 'Good Vibes', alignment: 'sweet', rarity: 'uncommon', play: 'use', reaches: ['thread'], gimmick: { kind: 'price', flavors: ['salty'], add: 25 }, lasts: { unit: 'day', count: 1 }, playPrice: () => 0, validateConfig: (c) => ok(c), canApply: (t, e, _c, now) => landsOn({ key: 'good-vibes', reaches: ['thread'] }, t, e, now) };
    const served: Instance = { ...instance, cards: [...instance.cards, vibes] };
    const w = world(served);
    w.fake.seed.reach(w.gloomba, 'thread', w.thread, 'good-vibes', { ends: Date.now() + 86_400_000 });
    renderIn(w.fake, <Frame><LoadedThread thread={w.thread} /></Frame>, { path: `/t/${w.thread}`, instance: served, cards, settings: { postMaxLength: 1000, cardEconomy: (await w.fake.settings()).cardEconomy } });
    await screen.findByRole('article', { name: /^Post 4 /u });
    await screen.findByRole('button', { name: /^Hand, 3 postcards/u });
    const form = await playHere(user, 2);
    expect(within(form).getByText('Good Vibes adds 0.25 in this thread.')).toBeInTheDocument();
    expect(within(form).getByText('To pay now').closest('div')).toHaveTextContent('0.50');
    expect(within(form).getByRole('img', { name: 'Wallet after playing: 4.12 of 6.00' })).toBeInTheDocument();
  });

  test('a short post costs nothing more, and the form says so', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const form = await playHere(user, 1);
    expect(within(form).getByText('To pay now').closest('div')).toHaveTextContent('0.00');
    expect(within(form).getByRole('img', { name: 'Wallet after playing: 4.62 of 6.00' })).toBeInTheDocument();
  });

  test('the message stops at 200 characters, counted as typed, and is plain text', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const form = await playHere(user, 1);
    const message = within(form).getByRole('textbox', { name: 'Your message' });
    await user.click(message);
    await user.paste(`${'a'.repeat(190)}😀`.repeat(1) + 'b'.repeat(40));
    expect(message).toHaveValue(`${'a'.repeat(190)}😀${'b'.repeat(9)}`);
    expect(within(form).getByText('200 / 200')).toBeInTheDocument();
    await user.type(message, 'more');
    expect(within(form).getByText('200 / 200')).toBeInTheDocument();
  });

  /* #89 P2-2: the message's limit is said, not only drawn: the counter speaks politely as it nears the limit, never on every key. */
  test('pasting past 200 characters leaves 200 and says the limit; a key far from it says nothing', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const form = await playHere(user, 1);
    const message = within(form).getByRole('textbox', { name: 'Your message' });
    const said = form.querySelector<HTMLElement>('[data-kb-count-said]');
    expect(said).not.toBeNull();
    expect(said).toHaveAttribute('aria-live', 'polite');
    await user.click(message);
    await user.type(message, 'hi');
    expect(said).toHaveTextContent('');
    await user.paste('x'.repeat(210));
    expect([...(message as HTMLTextAreaElement).value]).toHaveLength(200);
    expect(said).toHaveTextContent('200 of 200 characters: the message is full, and the rest was not kept.');
    expect(form.querySelector('[data-kb-count-said]')).toBe(said);
    /* Said again on a second paste past the limit: the region changes, so a screen reader hears it again. */
    const first = said!.textContent;
    await user.paste('y');
    expect(said).toHaveTextContent('200 of 200 characters: the message is full, and the rest was not kept.');
    expect(said!.textContent).not.toBe(first);
  });

  test('the counter speaks on entering its last 20 characters and on reaching the limit, takes back what stops being true, and says it again on a new crossing', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const form = await playHere(user, 1);
    const message = within(form).getByRole('textbox', { name: 'Your message' });
    const said = form.querySelector<HTMLElement>('[data-kb-count-said]')!;
    await user.click(message);
    await user.paste('x'.repeat(179));
    expect(said).toBeEmptyDOMElement();
    await user.type(message, 'x');
    expect(said).toHaveTextContent('20 characters left.');
    await user.type(message, 'x'.repeat(20));
    expect(said).toHaveTextContent('200 of 200 characters: the message is full.');
    await user.type(message, '{Backspace}');
    expect(said).toBeEmptyDOMElement();
    await user.type(message, 'x');
    expect(said).toHaveTextContent('200 of 200 characters: the message is full.');
    await user.type(message, '{Backspace}'.repeat(30));
    expect(said).toBeEmptyDOMElement();
    await user.type(message, 'x'.repeat(10));
    expect(said).toHaveTextContent('20 characters left.');
  }, 20_000);

  test('the price shown is the price the server charges', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const form = await playHere(user, 2);
    const shown = within(form).getByText('To pay now').closest('div')!.textContent!;
    await user.click(within(form).getByRole('button', { name: 'Play as Pipewrench' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const spent = 462 - (await w.fake.wallet()).balance;
    expect(shown).toContain((spent / 100).toFixed(2));
    expect(spent).toBe(25);
  });

  /* #86: the hand's postcards say their rules with the numbers the server prices with now, an admin's tuning included. */
  test('a number an admin has tuned is the one a hand\'s postcard says', async () => {
    const user = userEvent.setup();
    const w = world({ ...instance, settings: { ...instance.settings, economy: { ...economy, 'whoops.perLength': 150 } } });
    const saying = cards.map((c) => (c.key === 'whoops' ? { ...c, describe: (st: Instance['settings']) => `Splats a post for ${(st.economy['whoops.perLength']! / 100).toFixed(2)}.` } : c));
    await open(w, saying);
    await user.click(handButton());
    expect(within(drawer()).getAllByRole('button', { name: /^Whoops!, Salty, Cast, common postcard/u })[0]).toHaveAccessibleDescription('Splats a post for 1.50.');
  });

  /* #86: the server prices with the economy row an admin tunes; the form shows that price, not the compiled one. */
  test('a surcharge an admin has tuned is the one shown, and the one charged', async () => {
    const user = userEvent.setup();
    const tuned: Instance = { ...instance, settings: { ...instance.settings, economy: { ...economy, 'whoops.perLength': 40 } } };
    const w = world(tuned);
    await open(w);
    const form = await playHere(user, 2);
    expect(within(form).getByText('To pay now').closest('div')!.textContent).toContain('0.40');
    await user.click(within(form).getByRole('button', { name: 'Play as Pipewrench' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(462 - (await w.fake.wallet()).balance).toBe(40);
  });

  test('on a post by another of the player\'s own characters it says so, and not on anyone else\'s', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const own = await playHere(user, 3);
    expect(own).toHaveTextContent('You play both. It costs the same; your log will say so.');
    await user.click(within(own).getByRole('button', { name: 'Cancel' }));
    await user.click(within(post(1)).getByRole('button', { name: 'Play Whoops! on post 1' }));
    const theirs = await screen.findByRole('dialog', { name: 'Whoops!' });
    expect(theirs).not.toHaveTextContent('You play both');
  });

  test('a play on a staff post names it in lower case mid-sentence: "on the staff\'s post #1"', async () => {
    const user = userEvent.setup();
    const w = world();
    const sys = w.fake.seed.thread('announcements', null, 'Tally', 'the staff speak', { kind: 'post' });
    for (const i of [2, 3, 4]) w.fake.seed.post(sys.thread, null, `staff ${i}`, { kind: 'post' });
    await open({ ...w, thread: sys.thread });
    const form = await playHere(user, 1);
    expect(form).toHaveTextContent("the staff's post #1");
    expect(form).not.toHaveTextContent("The staff's post");
    await user.type(within(form).getByRole('textbox', { name: 'Your message' }), 'hello');
    await user.click(within(form).getByRole('button', { name: 'Play as Pipewrench' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status', { name: 'Playing a card' })).toHaveTextContent("Played Whoops! on the staff's post #1.");
  });

  test('playing lands the play as a tag on its post, takes a card out of the hand, drains the wallet and puts the card away', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const form = await playHere(user, 2);
    await user.click(within(form).getByRole('radio', { name: 'Cyan' }));
    await user.type(within(form).getByRole('textbox', { name: 'Your message' }), 'you dropped your ink');
    await user.click(within(form).getByRole('button', { name: 'Play as Pipewrench' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await within(post(2)).findByRole('button', { name: /^Whoops!, 1 play, .* Opens the cards on this post\.$/u })).toBeInTheDocument();
    await waitFor(() => expect(handButton()).toHaveAccessibleName('Hand, 2 postcards'));
    expect(await w.fake.myCards()).toEqual(expect.arrayContaining([{ card: 'whoops', held: 1 }]));
    expect(screen.getByRole('img', { name: /^Wallet 4\.37 of 6 orbs/u })).toBeInTheDocument();
    /* Armed no longer, and a status says what was played. */
    expect(here(1)).toBeNull();
    expect(screen.getByRole('status', { name: 'Playing a card' })).toHaveTextContent('Played Whoops! on Gloomba\'s post #2.');
    /* The play kept the ink the player chose. */
    const played = (await w.fake.cardsOn(w.ids[1]!, 10)).at(-1)!;
    expect(played.payload).toMatchObject({ card: 'whoops', layer: 1, message: 'you dropped your ink', config: { color: '#19e3ff' } });
  });

  test.each([
    ['Cancel', async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['Close', async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Close' }))],
    ['Esc', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
  ])('%s leaves without playing, and the card stays armed for another post', async (_name, leave) => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const played = vi.spyOn(w.fake, 'playCard');
    await playHere(user, 2);
    await leave(user);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(played).not.toHaveBeenCalled();
    expect(here(1)).toBeInTheDocument();
    expect(handButton()).toHaveAccessibleName('Hand, 3 postcards');
  });

  test('a refusal is said in plain words, in the form, and nothing is lost', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    vi.spyOn(w.fake, 'playCard').mockResolvedValueOnce({ ok: false, error: 'this post already carries 3 of that card, the most it takes', field: 'target' });
    const form = await playHere(user, 2);
    await user.click(within(form).getByRole('button', { name: 'Play as Pipewrench' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('This post already carries 3 of that card, the most it takes.');
    expect(screen.getByRole('dialog', { name: 'Whoops!' })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeEnabled();
  });

  test('a wallet that cannot pay is said before the server is asked, and the play waits', async () => {
    const user = userEvent.setup();
    const w = world();
    w.fake.seed.wallet(w.me, 10);
    await open(w);
    const played = vi.spyOn(w.fake, 'playCard');
    const form = await playHere(user, 2);
    expect(within(form).getByRole('status', { name: 'Cost' })).toHaveTextContent('That costs 0.25, and your wallet holds 0.10.');
    expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeDisabled();
    expect(played).not.toHaveBeenCalled();
  });

  test('a lost answer that did not go through is looked for, then offered again', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const lost = vi.spyOn(w.fake, 'playCard').mockResolvedValueOnce({ ok: false, error: LOST_ANSWER, uncertain: true });
    const rows = vi.spyOn(w.fake, 'myCards');
    const form = await playHere(user, 2);
    const before = rows.mock.calls.length;
    await user.click(within(form).getByRole('button', { name: 'Play as Pipewrench' }));
    const words = await within(form).findByRole('alert');
    expect(words).toHaveTextContent(plainRefusal(LOST_ANSWER));
    expect(words).toHaveTextContent('Your play is not on the post yet.');
    expect(rows.mock.calls.length).toBeGreaterThan(before);
    /* Never a blind resend: it waits for the player, who presses what the button now says. */
    expect(lost).toHaveBeenCalledTimes(1);
    await user.click(within(form).getByRole('button', { name: 'Play again anyway' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(lost).toHaveBeenCalledTimes(2);
    expect(await w.fake.cardsOn(w.ids[1]!, 10)).toHaveLength(1);
  });

  test('a lost answer for a play that did go through is found on the post, and the form finishes', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const real = w.fake.playCard.bind(w.fake);
    const lost = vi.spyOn(w.fake, 'playCard').mockImplementationOnce(async (...args) => {
      await real(...args);
      return { ok: false, error: LOST_ANSWER, uncertain: true };
    });
    const form = await playHere(user, 2);
    await user.click(within(form).getByRole('button', { name: 'Play as Pipewrench' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(lost).toHaveBeenCalledTimes(1);
    expect(await w.fake.cardsOn(w.ids[1]!, 10)).toHaveLength(1);
    expect(await within(post(2)).findByRole('button', { name: /^Whoops!, 1 play, .* Opens the cards on this post\.$/u })).toBeInTheDocument();
    await waitFor(() => expect(handButton()).toHaveAccessibleName('Hand, 2 postcards'));
    await act(async () => {});
  });
});

describe('from the Task 3 quality review', () => {
  const playHere = async (user: ReturnType<typeof userEvent.setup>, seq: number) => {
    await arm(user);
    await user.click(within(post(seq)).getByRole('button', { name: `Play Whoops! on post ${seq}` }));
    return screen.findByRole('dialog', { name: 'Whoops!' });
  };
  const threeOn = (w: ReturnType<typeof world>, post: number, live: boolean) => {
    for (const layer of [1, 2, 3]) w.fake.seed.card(w.gloomba, w.ids[post - 1]!, 'whoops', { message: `layer ${layer}`, layer, config: { color: '#ff2bd6' }, live });
  };
  /* The play is held until the test lets it go, so the form is mid-submit. */
  const held = (w: ReturnType<typeof world>) => {
    const real = w.fake.playCard.bind(w.fake);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const spy = vi.spyOn(w.fake, 'playCard').mockImplementation(async (...args) => { const answer = await real(...args); await gate; return answer; });
    return { spy, release };
  };

  describe('the post as it stands', () => {
    test('an edit that makes the post longer changes the length, the price, the wallet after and what Play does', async () => {
      const user = userEvent.setup();
      const w = world();
      await open(w);
      const form = await playHere(user, 3);
      expect(form).toHaveTextContent('17 characters long');
      expect(within(form).getByText('To pay now').closest('div')).toHaveTextContent('0.00');
      await act(async () => { await w.fake.edit(w.ids[2]!, w.hooligan, 'y'.repeat(1000)); });
      await waitFor(() => expect(form).toHaveTextContent('1000 characters long'));
      /* Two surcharges of 0.25: the rules' price for 1000 characters, not the 17 it was opened on. */
      expect(within(form).getByText('To pay now').closest('div')).toHaveTextContent('0.50');
      expect(within(form).getByRole('img', { name: 'Wallet after playing: 4.12 of 6.00' })).toBeInTheDocument();
      await user.click(within(form).getByRole('button', { name: 'Play as Pipewrench' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(462 - (await w.fake.wallet()).balance).toBe(50);
    });

    test('a wallet that held enough for the short post and not for the long one stops the play', async () => {
      const user = userEvent.setup();
      const w = world();
      w.fake.seed.wallet(w.me, 30);
      await open(w);
      const form = await playHere(user, 3);
      expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeEnabled();
      await act(async () => { await w.fake.edit(w.ids[2]!, w.hooligan, 'y'.repeat(1000)); });
      await waitFor(() => expect(within(form).getByRole('status', { name: 'Cost' })).toHaveTextContent('That costs 0.50, and your wallet holds 0.30.'));
      expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeDisabled();
    });
  });

  describe('a play that did not take (0149)', () => {
    /* A card that writes: its play whose first generation failed was refunded and is over, so it is no layer on the post. */
    const writing = { ...whoopsRules, writes: { tokens: () => 40, frame: () => ({ prompt: '', stop: [] as string[] }) } };
    const server: Instance = { ...instance, cards: [writing, stickRules] };
    const three = (w: ReturnType<typeof world>) => [1, 2, 3].map((layer) => w.fake.seed.card(w.gloomba, w.ids[1]!, 'whoops', { message: `layer ${layer}`, layer, config: { color: '#ff2bd6' } }));

    test('the form takes a cast on a post with two live plays and one that did not take, as the server does, and refuses once a third is live', async () => {
      const user = userEvent.setup();
      const w = world(server);
      const [, , lost] = three(w);
      w.fake.seed.text(lost!, w.ids[1]!, { failed: true }, { quiet: true });
      await open(w);
      const form = await playHere(user, 2);
      expect(within(form).queryByText(/already carries/u)).toBeNull();
      expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeEnabled();
      await user.click(within(form).getByRole('button', { name: 'Play as Pipewrench' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Whoops!' })).toBeNull());
      /* Three plays are live now, the one that did not take among four: a fourth is refused, in the form as at the server. */
      expect((await w.fake.cardsOn(w.ids[1]!, 10)).filter((a) => a.kind === 'card')).toHaveLength(4);
      await waitFor(() => expect(here(2)).toBeNull());
    });

    test('three live plays and none that failed leave no room', async () => {
      const user = userEvent.setup();
      const w = world(server);
      three(w);
      await open(w);
      await arm(user);
      expect(here(2)).toBeNull();
    });
  });

  describe('a post that cannot take the play any more', () => {
    test('a refusal because a fourth landed first re-reads the post: Play waits, says why, and the post stops offering it', async () => {
      const user = userEvent.setup();
      const w = world();
      await open(w);
      const form = await playHere(user, 2);
      /* Three others landed that this screen has not heard of: the server refuses, and nothing is mocked. */
      threeOn(w, 2, false);
      await user.click(within(form).getByRole('button', { name: 'Play as Pipewrench' }));
      expect(await within(form).findByRole('alert')).toHaveTextContent(/already carries 3/u);
      await waitFor(() => expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeDisabled());
      expect(within(form).getByRole('status', { name: 'Cost' })).toHaveTextContent(/already carries 3/u);
      await user.click(within(form).getByRole('button', { name: 'Cancel' }));
      expect(here(2)).toBeNull();
      expect(here(1)).toBeInTheDocument();
    });

    test('three Whoops! arriving live while the form is open do the same, and a submit that gets past the button plays nothing', async () => {
      const user = userEvent.setup();
      const w = world();
      await open(w);
      const form = await playHere(user, 2);
      const played = vi.spyOn(w.fake, 'playCard');
      await act(async () => { threeOn(w, 2, true); });
      await waitFor(() => expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeDisabled());
      expect(within(form).getByRole('status', { name: 'Cost' })).toHaveTextContent(/already carries 3/u);
      fireEvent.submit(form.querySelector('form')!);
      await act(async () => {});
      expect(played).not.toHaveBeenCalled();
      await user.click(within(form).getByRole('button', { name: 'Cancel' }));
      expect(here(2)).toBeNull();
    });
  });

  describe('another account', () => {
    test('an open form and an armed card are the account\'s: signed in as another they are gone, and do not come back', async () => {
      const user = userEvent.setup();
      const w = world();
      await open(w);
      await playHere(user, 2);
      act(() => w.fake.signInAs(w.other));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      act(() => w.fake.signInAs(w.me));
      await screen.findByRole('button', { name: /^Hand, 3 postcards/u });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(here(1)).toBeNull();
      expect(screen.getByRole('status', { name: 'Playing a card' })).toHaveTextContent('');
    });

    test('an answer held while the account changed shows nothing, and arms nothing', async () => {
      const user = userEvent.setup();
      const w = world();
      await open(w);
      const form = await playHere(user, 2);
      const { release } = held(w);
      await user.click(within(form).getByRole('button', { name: 'Play as Pipewrench' }));
      act(() => w.fake.signInAs(w.other));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await act(async () => { release(); });
      await act(async () => {});
      expect(screen.getByRole('status', { name: 'Playing a card' })).toHaveTextContent('');
      act(() => w.fake.signInAs(w.me));
      await screen.findByRole('button', { name: /^Hand, \d postcards?/u });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('status', { name: 'Playing a card' })).toHaveTextContent('');
    });
  });

  describe('pinned: the render-time keying besides the clearing effect', () => {
    test('in the very commit an account changes, the armed card and the open form already read as nothing', async () => {
      const user = userEvent.setup();
      const w = world();
      const seen: { account: string | null; armed: string | null }[] = [];
      function Probe() {
        const play = usePlay();
        const account = usePlayer().session.account;
        seen.push({ account, armed: play?.armed ?? null });
        return null;
      }
      renderIn(w.fake, <Frame><Probe /><LoadedThread thread={w.thread} /></Frame>, { path: `/t/${w.thread}`, instance, cards, settings: { postMaxLength: 1000 } });
      await screen.findByRole('button', { name: /^Hand, 3 postcards/u });
      await arm(user);
      expect(seen.some((s) => s.account === w.me && s.armed === 'whoops')).toBe(true);
      seen.length = 0;
      act(() => w.fake.signInAs(w.other));
      await screen.findByRole('button', { name: /^Hand, \d postcards?/u });
      /* The clearing effect runs after a commit, so a render under the new account that still read the card would be seen here. */
      const under = seen.filter((s) => s.account === w.other);
      expect(under.length).toBeGreaterThan(0);
      expect(under.every((s) => s.armed === null)).toBe(true);
    });
  });

  describe('guards', () => {
    test('a second submit while the first is out plays once, even past the button', async () => {
      const user = userEvent.setup();
      const w = world();
      await open(w);
      const form = await playHere(user, 2);
      const { spy, release } = held(w);
      const el = form.querySelector('form')!;
      fireEvent.submit(el);
      fireEvent.submit(el);
      expect(spy).toHaveBeenCalledTimes(1);
      await act(async () => { release(); });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test.each([
      ['Cancel', async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Cancel' }))],
      ['Esc', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
    ])('%s on the armed route gives focus back to the post\'s ghost mark', async (_name, leave) => {
      const user = userEvent.setup();
      const w = world();
      await open(w);
      await playHere(user, 2);
      await leave(user);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(here(2)).toHaveFocus());
    });

    test('when the post stops taking the card, its button goes and focus falls back to the post', async () => {
      const user = userEvent.setup();
      const w = world();
      await open(w);
      const form = await playHere(user, 2);
      await act(async () => { threeOn(w, 2, true); });
      await waitFor(() => expect(here(2)).toBeNull());
      await user.click(within(form).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(post(2)).toHaveFocus());
    });
  });

  test('the link to the post closes the form, as Cancel does, and the armed card stays armed', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const form = await playHere(user, 2);
    await user.click(within(form).getByRole('link', { name: /Gloomba's post #2/u }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.hash).toBe('#post-2');
    expect(here(1)).toBeInTheDocument();
  });
});

/*
 * A card whose play is made on the post itself (the graffiti plan's Task 5): `CardUi.Compose` mounts in the post's effect slot in place of the
 * play form. The card here draws nothing; its buttons stand for a stroke (`hold`), a play (`submit`) and a way out (`cancel`), and the engine
 * knows only what they say.
 */
describe('a card that is played on the post (CardUi.Compose)', () => {
  const taggerRules: CardRules = { key: 'tagger', name: 'Tagger', alignment: 'salty', rarity: 'common', playPrice: () => 0, canApply: (target, effects, _c, now) => landsOn({ key: 'tagger' }, target, effects, now), validateConfig: (config) => ok(config) };
  const ASK = 'Leave without tagging? Your drawing isn\'t saved.';
  let answered: Answer<unknown> | null = null;
  let seen: ComposeProps | null = null;
  function Draw(props: ComposeProps) {
    const { post, mode, submit, cancel, hold, children } = props;
    const [answer, setAnswer] = useState<Answer<unknown> | null>(null);
    seen = props;
    return (
      <div data-testid="compose" data-mode={mode} data-post={post.seq}>
        {children}
        <button type="button" onClick={() => hold(ASK)}>Scribble</button>
        <button type="button" onClick={() => hold(null)}>Wipe</button>
        <button type="button" onClick={() => void submit({ color: '#ff2bd6' }, { strokes: 1 }).then((a) => { answered = a; setAnswer(a); })}>Tag it</button>
        <button type="button" onClick={cancel}>Cancel drawing</button>
        {answer && !answer.ok && <p role="alert">{answer.error}</p>}
      </div>
    );
  }
  const tagger: CardUi = { key: 'tagger', art: { color: '#ffb000', ink: '#140f03', canvas: '', mark: '', credit: 'Test' }, Compose: Draw, describe: () => 'Tags a post.' };
  const withTagger: Instance = { ...instance, cards: [...instance.cards, taggerRules] };
  async function onPost() {
    const w = world(withTagger);
    w.fake.seed.cards(w.me, { whoops: 2, 'stick-around': 1, tagger: 2 });
    renderIn(w.fake, <Frame><LoadedThread thread={w.thread} /></Frame>, { path: `/t/${w.thread}`, instance: withTagger, cards: [...cards, tagger], settings: { postMaxLength: 1000, cardEconomy: (await w.fake.settings()).cardEconomy } });
    await screen.findByRole('article', { name: /^Post 4 /u });
    await screen.findByRole('button', { name: /^Hand, \d postcards?/u });
    return w;
  }
  const armTagger = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(handButton());
    await user.click(within(drawer()).getAllByRole('button', { name: /^Tagger, / })[0]!);
  };
  beforeEach(() => { answered = null; seen = null; });

  test('pressing its ghost mark mounts Compose on that post, as a cast, and the play form does not open', async () => {
    const user = userEvent.setup();
    const w = await onPost();
    await armTagger(user);
    await user.click(within(post(2)).getByRole('button', { name: 'Play Tagger on post 2' }));
    const compose = await within(post(2)).findByTestId('compose');
    expect(compose).toHaveAttribute('data-mode', 'cast');
    expect(within(compose).getByText('x'.repeat(812))).toBeInTheDocument();
    expect(seen!.post.id).toBe(w.ids[1]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('compose', { })).toBe(compose);
  });

  test('submit plays through playCard with the first draw, says it in the status, and closes the compose', async () => {
    const user = userEvent.setup();
    const w = await onPost();
    const played = vi.spyOn(w.fake, 'playCard');
    await armTagger(user);
    await user.click(within(post(2)).getByRole('button', { name: 'Play Tagger on post 2' }));
    await user.click(await screen.findByRole('button', { name: 'Tag it' }));
    await waitFor(() => expect(played).toHaveBeenCalledWith('tagger', w.pipe, w.ids[1], { color: '#ff2bd6' }, '', undefined, undefined, { strokes: 1 }));
    await waitFor(() => expect(screen.queryByTestId('compose')).toBeNull());
    expect(screen.getByRole('status', { name: 'Playing a card' })).toHaveTextContent('Played Tagger on Gloomba\'s post #2.');
    expect(answered).toMatchObject({ ok: true });
  });

  test('a refusal comes back to Compose, which stays mounted with its drawing', async () => {
    const user = userEvent.setup();
    const w = await onPost();
    vi.spyOn(w.fake, 'playCard').mockResolvedValueOnce({ ok: false, error: 'the wall is full', field: 'first' });
    await armTagger(user);
    await user.click(within(post(2)).getByRole('button', { name: 'Play Tagger on post 2' }));
    await user.click(await screen.findByRole('button', { name: 'Scribble' }));
    await user.click(screen.getByRole('button', { name: 'Tag it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('the wall is full');
    expect(screen.getByTestId('compose')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Playing a card' })).toHaveTextContent('The wall is full.');
  });

  test('Esc with nothing drawn closes it at once, and the card stays armed', async () => {
    const user = userEvent.setup();
    const w = await onPost();
    await armTagger(user);
    await user.click(within(post(2)).getByRole('button', { name: 'Play Tagger on post 2' }));
    await screen.findByTestId('compose');
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('compose')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(post(2)).getByRole('button', { name: 'Play Tagger on post 2' })).toBeInTheDocument();
    expect(w.ids.length).toBe(4);
  });

  test('Esc with a drawing asks in the card\'s words first: Stay keeps it, Leave closes it', async () => {
    const user = userEvent.setup();
    await onPost();
    await armTagger(user);
    await user.click(within(post(2)).getByRole('button', { name: 'Play Tagger on post 2' }));
    await user.click(await screen.findByRole('button', { name: 'Scribble' }));
    await user.keyboard('{Escape}');
    const ask = await screen.findByRole('dialog');
    expect(within(ask).getByText(ASK)).toBeInTheDocument();
    await user.click(within(ask).getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('compose')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave' }));
    expect(screen.queryByTestId('compose')).toBeNull();
  });

  test('Cancel and the armed card pressed again leave the same way, and a wiped drawing asks nothing', async () => {
    const user = userEvent.setup();
    await onPost();
    await armTagger(user);
    await user.click(within(post(2)).getByRole('button', { name: 'Play Tagger on post 2' }));
    await user.click(await screen.findByRole('button', { name: 'Scribble' }));
    await user.click(screen.getByRole('button', { name: 'Cancel drawing' }));
    expect(within(await screen.findByRole('dialog')).getByText(ASK)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    await user.click(screen.getByRole('button', { name: 'Wipe' }));
    await user.click(screen.getByRole('button', { name: 'Cancel drawing' }));
    expect(screen.queryByTestId('compose')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    /* The card is put back from the hand: with a drawing held, that asks too, and Leave puts the card back as well. */
    await user.click(within(post(2)).getByRole('button', { name: 'Play Tagger on post 2' }));
    await user.click(await screen.findByRole('button', { name: 'Scribble' }));
    await user.click(handButton());
    await user.click(within(drawer()).getAllByRole('button', { name: /^Tagger, / })[0]!);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave' }));
    expect(screen.queryByTestId('compose')).toBeNull();
    expect(within(post(2)).queryByRole('button', { name: 'Play Tagger on post 2' })).toBeNull();
  });

  test('a second compose replaces the first, after the same ask', async () => {
    const user = userEvent.setup();
    await onPost();
    await armTagger(user);
    await user.click(within(post(2)).getByRole('button', { name: 'Play Tagger on post 2' }));
    await user.click(await screen.findByRole('button', { name: 'Scribble' }));
    await user.click(within(post(4)).getByRole('button', { name: 'Play Tagger on post 4' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave' }));
    expect(within(post(2)).queryByTestId('compose')).toBeNull();
    expect(within(post(4)).getByTestId('compose')).toHaveAttribute('data-post', '4');
  });

  test('a drawing held asks the browser before the page is left, and nothing held does not', async () => {
    const user = userEvent.setup();
    await onPost();
    await armTagger(user);
    await user.click(within(post(2)).getByRole('button', { name: 'Play Tagger on post 2' }));
    await screen.findByTestId('compose');
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Scribble' }));
    const held = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
  });

  test('a link or Back while a drawing is held asks the same question: Stay keeps the page and the drawing, Leave goes on', async () => {
    const user = userEvent.setup();
    const w = await onPost();
    await armTagger(user);
    await user.click(within(post(2)).getByRole('button', { name: 'Play Tagger on post 2' }));
    await user.click(await screen.findByRole('button', { name: 'Scribble' }));
    const here = window.location.pathname;
    const link = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find((l) => new URL(l.href).origin === window.location.origin && new URL(l.href).pathname !== here && !l.closest('[aria-hidden="true"]'))!;
    const to = new URL(link.href).pathname;
    await user.click(link);
    const ask = await screen.findByRole('dialog');
    expect(within(ask).getByText(ASK)).toBeInTheDocument();
    expect(window.location.pathname).toBe(here);
    await user.click(within(ask).getByRole('button', { name: 'Stay' }));
    expect(window.location.pathname).toBe(here);
    expect(screen.getByTestId('compose')).toBeInTheDocument();
    /* Back is asked too: the address is put back while the reader answers. */
    const kept = window.history.state;
    window.history.replaceState(null, '', '/prev');
    window.history.pushState(kept, '', here);
    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeNull());
    expect(window.location.pathname).toBe(here);
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    await user.click(link);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(window.location.pathname).toBe(to));
    expect(w.ids.length).toBe(4);
  });

  test('with nothing held, a link goes at once', async () => {
    const user = userEvent.setup();
    await onPost();
    await armTagger(user);
    await user.click(within(post(2)).getByRole('button', { name: 'Play Tagger on post 2' }));
    await screen.findByTestId('compose');
    const here = window.location.pathname;
    const link = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find((l) => new URL(l.href).origin === window.location.origin && new URL(l.href).pathname !== here && !l.closest('[aria-hidden="true"]'))!;
    await user.click(link);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(window.location.pathname).toBe(new URL(link.href).pathname));
  });

  test('Set on one\'s own post mounts it as a set, and submit goes through setCard with the first draw', async () => {
    const user = userEvent.setup();
    const w = await onPost();
    const set = vi.spyOn(w.fake, 'setCard');
    await armTagger(user);
    expect(within(post(2)).queryByRole('button', { name: 'Set Tagger face down on post 2' })).toBeNull();
    await user.click(within(post(3)).getByRole('button', { name: 'Set Tagger face down on post 3' }));
    expect(await within(post(3)).findByTestId('compose')).toHaveAttribute('data-mode', 'set');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Tag it' }));
    await waitFor(() => expect(set).toHaveBeenCalledWith('tagger', w.hooligan, w.ids[2], { color: '#ff2bd6' }, undefined, { strokes: 1 }));
    await waitFor(() => expect(screen.queryByTestId('compose')).toBeNull());
  });
});
