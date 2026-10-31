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
import { landsOnPost, ok, refuse, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { LOST_ANSWER } from '../data/api.ts';
import { plainRefusal } from './faces.ts';
import { Frame } from '../frame/Frame.tsx';
import { hudKey, usePlayer } from '../player.tsx';
import { usePlay } from './play.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { EffectStrip } from './Effects.tsx';
import type { CardUi, ConfigFormProps } from './types.ts';

const economy = { 'whoops.price': 100, 'whoops.perLength': 25, 'whoops.lengthStep': 500, 'stick.price': 100 };

const whoopsRules: CardRules<{ color: string }> = {
  key: 'whoops', name: 'Whoops!', alignment: 'salty', priceKey: 'whoops.price', stack: 3,
  playPrice: (settings, target) => settings.economy['whoops.perLength']! * Math.floor(target.length / settings.economy['whoops.lengthStep']!),
  canApply: (target, effects) => landsOnPost(whoopsRules, target, effects),
  validateConfig: (config) => {
    const color = typeof config === 'object' && config !== null ? (config as { color?: unknown }).color : undefined;
    return typeof color === 'string' ? ok({ color }) : refuse('the ink is a color');
  },
};
const stickRules: CardRules = {
  key: 'stick-around', name: 'Stick Around', alignment: 'sweet', priceKey: 'stick.price',
  playPrice: () => 0,
  canApply: (target, effects) => landsOnPost({ key: 'stick-around' }, target, effects),
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
  { key: 'whoops', art: { color: '#ff3d7f', ink: '#14030a' }, ConfigForm: Ink, describe: () => 'Splats a post.', surcharge: () => 'Long post, +0.25 per 500 characters' },
  { key: 'stick-around', art: { color: '#2ee6ff', ink: '#03141a' }, describe: () => 'Holds a reader.' },
];

class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

function world() {
  const fake = buildWorld({ postMaxLength: 1000 }, instance);
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
  renderIn(w.fake, <Frame><ThreadScreen thread={w.thread} /></Frame>, { path: `/t/${w.thread}`, instance, cards: ui, settings: { postMaxLength: 1000 } });
  await screen.findByRole('article', { name: /^Post 4 /u });
  await screen.findByRole('button', { name: /^Hand, 3 postcards/u });
}
const post = (seq: number) => document.getElementById(`post-${seq}`)!;
const handButton = () => screen.getByRole('button', { name: /^Hand, \d postcards?/u });
const drawer = () => screen.getByRole('region', { name: 'Your hand' });
const here = (seq: number) => within(post(seq)).queryByRole('button', { name: 'Play Whoops! here' });
const arm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(handButton());
  await user.click(within(drawer()).getAllByRole('button', { name: 'Whoops!, Salty postcard' })[0]!);
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
    expect(within(drawer()).getAllByRole('button', { name: 'Whoops!, Salty postcard' })).toHaveLength(2);
    expect(within(drawer()).getByRole('button', { name: 'Stick Around, Sweet postcard' })).toBeInTheDocument();
  });
});

/* The owner on #80's round 2: the play control is a glass tile, in the card's plate on a post whose effect has drawn one and under the post on a post that has none, and never in the 2003 action row. */
describe('where "Play Whoops! here" stands', () => {
  /** Whoops! given an effect that draws a plate with a readout and one tile, as the instance's does. */
  const withPlate: CardUi[] = [
    { ...cards[0]!, Effect: ({ slot, children }) => (
      <>
        {children}
        <EffectStrip slot={slot} card="whoops" readout={<span className="kb-plate-state">1 layer · 0% washed</span>}>
          <button type="button" className="kb-plate-tile">Hold to scrub</button>
        </EffectStrip>
      </>
    ) },
    cards[1]!,
  ];

  test('on a post with no plate the tile is under the post in its slot, a glass tile outside the 2003 body and action row', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    await arm(user);
    const tile = here(2)!;
    expect(tile).toHaveClass('kb-plate-tile', 'kb-play-here');
    expect(tile.closest('.kb-act-slot')).not.toBeNull();
    expect(tile.closest('.kb-act-links, .kb-act-main')).toBeNull();
    expect(tile.closest('.kb-effect-strip')).toBeNull();
    expect(tile).toHaveAttribute('data-kb-where', 'post');
  });

  test('on a post whose effect draws a plate the tile is in the plate, beside its readout and controls, and no second one is under the post', async () => {
    const user = userEvent.setup();
    const w = world();
    w.fake.seed.card(w.gloomba, w.ids[1]!, 'whoops', { message: 'one', layer: 1, config: { color: '#ff2bd6' } });
    await open(w, withPlate);
    await arm(user);
    const plate = post(2).querySelector('.kb-effect-strip') as HTMLElement;
    expect(plate).not.toBeNull();
    expect(post(2).querySelector('.kb-act-main')).not.toContainElement(plate);
    expect(plate).toHaveTextContent('1 layer · 0% washed');
    const tile = within(plate).getByRole('button', { name: 'Play Whoops! here' });
    expect(tile).toHaveAttribute('data-kb-where', 'plate');
    expect(within(post(2)).getAllByRole('button', { name: 'Play Whoops! here' })).toHaveLength(1);
    expect(tile.closest('.kb-act-links, .kb-act-main')).toBeNull();
    expect(within(plate).getByRole('button', { name: 'Hold to scrub' })).toBeInTheDocument();
  });

  /* Two effects each draw a plate on one post: the play tile stands in one of them, and the other going away does not take the tile out of the plate that remains. */
  test('with two plates on a post, one going away leaves the tile in the other', async () => {
    const user = userEvent.setup();
    const w = world();
    w.fake.seed.card(w.gloomba, w.ids[1]!, 'whoops', { message: 'one', layer: 1, config: { color: '#ff2bd6' } });
    w.fake.seed.card(w.gloomba, w.ids[1]!, 'stick-around', { message: 'two', layer: 1, config: {} });
    function Dropping({ slot, children }: { readonly slot: HTMLElement | null; readonly children: React.ReactNode }) {
      const [on, setOn] = useState(true);
      return (
        <>
          {children}
          {on && <EffectStrip slot={slot} card="stick-around"><button type="button" className="kb-plate-tile" onClick={() => setOn(false)}>Drop this plate</button></EffectStrip>}
        </>
      );
    }
    const two: CardUi[] = [
      { ...withPlate[0]! },
      { ...cards[1]!, Effect: Dropping },
    ];
    await open(w, two);
    await arm(user);
    const plates = () => [...post(2).querySelectorAll<HTMLElement>('.kb-effect-strip')];
    expect(plates()).toHaveLength(2);
    const tile = within(post(2)).getByRole('button', { name: 'Play Whoops! here' });
    expect(tile).toHaveAttribute('data-kb-where', 'plate');
    const drop = within(post(2)).getByRole('button', { name: 'Drop this plate' });
    /* The plate to lose is the one the tile is not in; if the tile is in the dropping plate, it is the other that is the remaining. */
    if (drop.closest('.kb-effect-strip')!.contains(tile)) {
      await user.click(drop);
      expect(plates()).toHaveLength(1);
      expect(within(post(2)).getByRole('button', { name: 'Play Whoops! here' })).toHaveAttribute('data-kb-where', 'plate');
      return;
    }
    await user.click(drop);
    expect(plates()).toHaveLength(1);
    expect(within(plates()[0]!).getByRole('button', { name: 'Play Whoops! here' })).toHaveAttribute('data-kb-where', 'plate');
    expect(within(post(2)).getAllByRole('button', { name: 'Play Whoops! here' })).toHaveLength(1);
  });
});

describe('arming a card', () => {
  test('each post the card can land on shows "Play Whoops! here", and a post already carrying three shows none', async () => {
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
    const armed = within(drawer()).getByRole('button', { name: 'Whoops!, Salty postcard, armed: pick a post' });
    expect(armed.closest('li')).toHaveTextContent('Armed · pick a post');
    expect(within(drawer()).getAllByRole('button', { name: 'Whoops!, Salty postcard' })).toHaveLength(1);
  });

  test('the button belongs to its post: its name is the card\'s and the post describes it', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    await arm(user);
    expect(here(2)).toHaveAccessibleDescription(/Post 2 by Gloomba/u);
  });

  test('Esc puts the card back and leaves the hand open; pressing the armed card does the same', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    await arm(user);
    await user.keyboard('{Escape}');
    expect(here(2)).toBeNull();
    expect(handButton()).toHaveAttribute('aria-expanded', 'true');
    expect(within(drawer()).getAllByRole('button', { name: 'Whoops!, Salty postcard' })).toHaveLength(2);
    /* A second Esc is the hand's own. */
    await user.keyboard('{Escape}');
    expect(handButton()).toHaveAttribute('aria-expanded', 'false');
    await arm(user);
    expect(here(2)).toBeInTheDocument();
    await user.click(within(drawer()).getByRole('button', { name: 'Whoops!, Salty postcard, armed: pick a post' }));
    expect(here(2)).toBeNull();
  });

  test('it is said to a screen reader when a card is armed and when it is put back', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    await arm(user);
    expect(screen.getByRole('status', { name: 'Playing a card' })).toHaveTextContent('Whoops! is armed. Press Play Whoops! here on a post, or Esc to put it back.');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('status', { name: 'Playing a card' })).toHaveTextContent('Whoops! is put back.');
  });
});

describe('the play form', () => {
  const playHere = async (user: ReturnType<typeof userEvent.setup>, seq: number) => {
    await arm(user);
    await user.click(within(post(seq)).getByRole('button', { name: 'Play Whoops! here' }));
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
    /* Whoops! was paid for at the machine: the long post is what it costs now. */
    expect(within(form).getByText('Long post, +0.25 per 500 characters').closest('div')).toHaveTextContent('0.25');
    expect(within(form).getByText('To pay now').closest('div')).toHaveTextContent('0.25');
    expect(within(form).getByRole('img', { name: 'Wallet after playing: 4.37 of 6.00' })).toBeInTheDocument();
    expect(within(form).getByRole('link', { name: /Gloomba's post #2/u })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-2`);
    expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeEnabled();
    expect(within(form).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Close' })).toBeInTheDocument();
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

  test('on a post by another of the player\'s own characters it says so, and not on anyone else\'s', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const own = await playHere(user, 3);
    expect(own).toHaveTextContent('You play both. It costs the same; your log will say so.');
    await user.click(within(own).getByRole('button', { name: 'Cancel' }));
    await user.click(within(post(1)).getByRole('button', { name: 'Play Whoops! here' }));
    const theirs = await screen.findByRole('dialog', { name: 'Whoops!' });
    expect(theirs).not.toHaveTextContent('You play both');
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
    const tags = await within(post(2)).findByRole('list', { name: 'Cards played on this post' });
    expect(tags).toHaveTextContent('Pipewrench played Whoops! on this post: “you dropped your ink”');
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
    expect(await within(post(2)).findByRole('list', { name: 'Cards played on this post' })).toBeInTheDocument();
    await waitFor(() => expect(handButton()).toHaveAccessibleName('Hand, 2 postcards'));
    await act(async () => {});
  });
});

describe('from the Task 3 quality review', () => {
  const playHere = async (user: ReturnType<typeof userEvent.setup>, seq: number) => {
    await arm(user);
    await user.click(within(post(seq)).getByRole('button', { name: 'Play Whoops! here' }));
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
      renderIn(w.fake, <Frame><Probe /><ThreadScreen thread={w.thread} /></Frame>, { path: `/t/${w.thread}`, instance, cards, settings: { postMaxLength: 1000 } });
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
    ])('%s on the armed route gives focus back to the post\'s "Play Whoops! here"', async (_name, leave) => {
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
