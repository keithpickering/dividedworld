/**
 * The Lens (docs/plans/2026-10-31-marks-and-the-lens-design.md, section 2): one floating, non-modal glass panel opened by a
 * mark. Its tabs are the post's card kinds, in the marks' order; its three rows are State (the card's view), Act (the
 * kit) and Who (a play's row: the #97 panel's content, reached for every play of the kind). It never dims or blocks the
 * page, and closes by Esc, its ×, its mark, another post's Lens or leaving the page, giving focus back to the mark.
 */
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { landsOn, ok, refuse, type CardRules } from '../../rules/cards.ts';
import { dayAndTime } from '../characters/format.ts';
import { viewProblems, wordsProblems } from './lens-words.ts';
import type { Id } from '../data/api.ts';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { axeViolations, describeViolations } from '../a11y.ts';
import { createPlays } from './plays.ts';
import { endsWords } from './marks.ts';
import { createTallies } from '../thread/tallies.ts';
import { createMine } from '../reactions/mine.ts';
import { fadeOf, Lens, LensProvider, moreBelow, useLensFor, useLensStore } from './Lens.tsx';
import lensCss from './lens.css?raw';
import type { CardUi, EffectProps } from './types.ts';
import { LoadedThread } from '../loaded.tsx';
import { glassInk } from './ink.ts';

/* These tests close a Lens and open another in the same step and look at the one page that results, as under Off: at full motion the closed one stays, inert, until its exit ends (glass/layer.test.tsx). */
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  document.documentElement.setAttribute('data-kb-motion', 'reduce');
});
afterEach(() => { document.documentElement.removeAttribute('data-kb-motion'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** A phone (40em or less) is also a sheet's width; a tablet (up to 64em) is a sheet's width with a desktop's marks. */
function width(phone: boolean, tablet = false) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: (phone && q.includes('max-width: 40em')) || ((phone || tablet) && q.includes('max-width: 64em')), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }) as unknown as MediaQueryList);
}

/* Six kinds, so a post can carry more marks than a strip draws; k1 stacks (three layers), the rest do not. */
const KEYS = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'] as const;
const instance = {
  ...testInstance,
  cards: KEYS.map((key, i) => ({ ...testInstance.cards[0]!, key, name: `Card ${i + 1}`, ...(key === 'k1' ? { stack: 3 } : {}) })),
};
const art = { color: 'red', ink: 'white', canvas: '', mark: '/mark.svg', credit: 'Test' };
const cardUi = (key: string, extra: Partial<CardUi> = {}): CardUi => ({ key, describe: () => 'Does a thing. And more.', summary: 'Does a thing.', art, ...extra });

const run = vi.fn();
/** An effect that says everything a view can: its State lines, a report, an Act control and a note for its first play. */
function Said({ plays, show, children }: EffectProps) {
  const first = plays[0]!.id;
  useEffect(() => {
    show({
      progress: 0.5, state: '3 layers · top: yellow', ends: 'Ends when you scrub it off.', yours: false, report: 'The last save did not get through.',
      controls: [{ kind: 'press', label: 'Wash it', run }], notes: { [first]: 'Layer 1 of 3, on top' },
    });
  }, [first, show]);
  return <>{children}</>;
}
const cards: CardUi[] = KEYS.map((k) => cardUi(k, k === 'k1' ? { Effect: Said } : {}));

function world(settings?: Parameters<typeof buildWorld>[0]) {
  const fake = buildWorld(settings, instance);
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const third = fake.seed.account('third');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const gloomba = fake.seed.character(third, 'Gloomba', 'heel');
  const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const second = fake.seed.post(thread, spritey, 'post 2');
  const third_ = fake.seed.post(thread, spritey, 'post 3');
  fake.signInAs(me);
  const play = (kind: string, by: Id = spritey, on: Id = second, layer?: number) => {
    fake.clock.advance(60_000);
    return fake.seed.card(by, on, kind, { message: `${kind} by ${by}`, ...(layer ? { layer } : {}) });
  };
  return { fake, me, other, thirdAccount: third, pipe, spritey, gloomba, thread, second, third: third_, play };
}
type World = ReturnType<typeof world>;
const open = (w: { fake: Fake; thread: Id }, ui: readonly CardUi[] = cards) =>
  renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance, cards: ui });
const article = (seq: number) => screen.findByRole('article', { name: new RegExp(`^Post ${seq} `, 'u') });
const markOf = async (seq: number, card: string) => within(await article(seq)).findByRole('button', { name: new RegExp(`^${card}, \\d plays?`, 'u') });
const lens = () => screen.getByRole('dialog', { name: 'Cards on this post' });
const tab = (name: string) => within(lens()).getByRole('tab', { name });
const whoButton = () => within(lens()).getByRole('button', { name: /^\d+ plays? · / });
const rows = () => [...lens().querySelectorAll<HTMLElement>('[data-kb-play]')].map((r) => r.getAttribute('data-kb-play')!);

describe('opening and closing', () => {
  test('a mark opens the Lens on its tab, and the mark says it is open', async () => {
    width(false);
    const w = world();
    w.play('k1'); w.play('k2');
    open(w);
    const mark = await markOf(2, 'Card 2');
    expect(mark).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(mark);
    expect(mark).toHaveAttribute('aria-expanded', 'true');
    expect(within(lens()).getAllByRole('tab').map((t) => t.textContent)).toEqual(expect.arrayContaining(['Card 1', 'Card 2']));
    expect(tab('Card 2')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Card 1')).toHaveAttribute('aria-selected', 'false');
    /* Focus moved to the open tab. */
    expect(tab('Card 2')).toHaveFocus();
  });

  test('"+N" opens the Lens on the first kind the strip hides', async () => {
    width(false);
    const w = world();
    for (const k of KEYS) w.play(k);
    open(w);
    const post = await article(2);
    await userEvent.click(await within(post).findByRole('button', { name: /^\+2 more cards/u }));
    /* Newest is billed first: k6 k5 k4 k3 are shown, k2 and k1 are hidden. */
    expect(tab('Card 2')).toHaveAttribute('aria-selected', 'true');
  });

  test('pressing the same mark closes it', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    const mark = await markOf(2, 'Card 2');
    await userEvent.click(mark);
    expect(lens()).toBeInTheDocument();
    await userEvent.click(mark);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mark).toHaveAttribute('aria-expanded', 'false');
  });

  test('Esc and its × close it, and focus returns to the mark', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    const mark = await markOf(2, 'Card 2');
    await userEvent.click(mark);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(mark).toHaveFocus());

    await userEvent.click(mark);
    await userEvent.click(within(lens()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(mark).toHaveFocus());
  });

  test('a press on the post\'s body leaves it open', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(within(await article(2)).getByText('post 2'));
    await userEvent.pointer({ keys: '[MouseLeft]', target: document.body });
    expect(lens()).toBeInTheDocument();
  });

  test('opening another post\'s Lens closes the first', async () => {
    width(false);
    const w = world();
    w.play('k2'); w.play('k3', w.spritey, w.third);
    open(w);
    const first = await markOf(2, 'Card 2');
    await userEvent.click(first);
    await userEvent.click(await markOf(3, 'Card 3'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(tab('Card 3')).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('aria-expanded', 'false');
  });

  test('the arrow keys move between tabs, one stop in the Tab order', async () => {
    width(false);
    const w = world();
    w.play('k1'); w.play('k2'); w.play('k3');
    open(w);
    await userEvent.click(await markOf(2, 'Card 3'));
    const stops = within(lens()).getAllByRole('tab').filter((t) => t.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(tab('Card 3')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Card 2')).toHaveFocus();
    expect(tab('Card 2')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    /* Wraps at the start. */
    expect(tab('Card 1')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Card 3')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('what the Lens says and offers', () => {
  test('State shows the view\'s lines and its report; a card with no effect says its summary', async () => {
    width(false);
    const w = world();
    w.play('k1'); w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 1'));
    const panel = within(lens()).getByRole('tabpanel');
    expect(panel).toHaveTextContent('3 layers · top: yellow');
    expect(panel).toHaveTextContent('Ends when you scrub it off.');
    expect(panel).toHaveTextContent('The last save did not get through.');
    await userEvent.click(tab('Card 2'));
    expect(within(lens()).getByRole('tabpanel')).toHaveTextContent('Does a thing.');
  });

  test('a status that reads each play\'s configuration says it in the Lens, as the engine hands it over', async () => {
    width(false);
    const w = world();
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.second, 'k2', { config: { quadrant: 'calmPositive' }, message: 'named' });
    const reads: CardUi[] = cards.map((c) => (c.key === 'k2' ? { ...c, status: (plays) => `Names ${String(plays[0]?.config.quadrant)}` } : c));
    open(w, reads);
    await userEvent.click(await markOf(2, 'Card 2'));
    expect(within(lens()).getByRole('tabpanel')).toHaveTextContent('Names calmPositive');
  });

  test('a ward with several conditions shows its full list in the report line', async () => {
    width(false);
    const warded = {
      ...instance,
      cards: instance.cards.map((c) => (c.key === 'k2' ? { ...c, play: 'use' as const, gimmick: { kind: 'ward' as const, upTo: 'uncommon' as const, flavors: ['salty' as const, 'sweet' as const], cards: ['k3', 'k4'] }, lasts: { unit: 'day' as const, count: 7 } } : c)),
    };
    const fake = buildWorld(undefined, warded);
    const me = fake.seed.account('me');
    const spritey = fake.seed.character(fake.seed.account('other'), 'Spritey', 'face');
    fake.seed.character(me, 'Pipewrench', 'heel');
    const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
    const second = fake.seed.post(thread, spritey, 'post 2');
    fake.signInAs(me);
    fake.clock.advance(60_000);
    fake.seed.card(spritey, second, 'k2', { ends: new Date(fake.clock.now() + 3_600_000).toISOString() });
    renderIn(fake, <LoadedThread thread={thread} />, { path: `/t/${thread}`, instance: warded, cards });
    await userEvent.click(await markOf(2, 'Card 2'));
    const report = lens().querySelector('.kb-lens-report');
    expect(report).toHaveTextContent('Turns away cards up to uncommon, Salty and Sweet cards, Card 3 and Card 4.');
    expect(within(lens()).getByRole('tabpanel')).toHaveTextContent('Turns away some cards');
  });

  test('the Lens of a live no-quote play says it cannot be quoted and when it ends', async () => {
    width(false);
    const stops = {
      ...instance,
      cards: instance.cards.map((c) => (c.key === 'k2' ? { ...c, play: 'use' as const, gimmick: { kind: 'noQuote' as const }, lasts: { unit: 'day' as const, count: 7 } } : c)),
    };
    const fake = buildWorld(undefined, stops);
    const me = fake.seed.account('me');
    const spritey = fake.seed.character(fake.seed.account('other'), 'Spritey', 'face');
    fake.seed.character(me, 'Pipewrench', 'heel');
    const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
    const second = fake.seed.post(thread, spritey, 'post 2');
    fake.signInAs(me);
    fake.clock.advance(60_000);
    const ends = new Date(fake.clock.now() + 3_600_000).toISOString();
    fake.seed.card(spritey, second, 'k2', { ends });
    renderIn(fake, <LoadedThread thread={thread} />, { path: `/t/${thread}`, instance: stops, cards });
    await userEvent.click(await markOf(2, 'Card 2'));
    const panel = within(lens()).getByRole('tabpanel');
    expect(panel).toHaveTextContent('Cannot be quoted');
    expect(panel).toHaveTextContent(/Ends /u);
  });

  test('the Lens of a cast earn reads "Earns 10% more from some reactions", whatever its play', async () => {
    width(false);
    const earns = {
      ...instance,
      cards: instance.cards.map((c) => (c.key === 'k3' ? { ...c, play: 'cast' as const, gimmick: { kind: 'earn' as const, by: 0.1, quadrants: ['excitedPositive' as const], group: 'test' } } : c)),
    };
    const fake = buildWorld(undefined, earns);
    const me = fake.seed.account('me');
    const spritey = fake.seed.character(fake.seed.account('other'), 'Spritey', 'face');
    fake.seed.character(me, 'Pipewrench', 'heel');
    const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
    const second = fake.seed.post(thread, spritey, 'post 2');
    fake.signInAs(me);
    fake.clock.advance(60_000);
    fake.seed.card(spritey, second, 'k3', { ends: new Date(fake.clock.now() + 3_600_000).toISOString() });
    renderIn(fake, <LoadedThread thread={thread} />, { path: `/t/${thread}`, instance: earns, cards });
    await userEvent.click(await markOf(2, 'Card 3'));
    expect(within(lens()).getByRole('tabpanel')).toHaveTextContent('Earns 10% more from some reactions');
  });

  test('Act draws the view\'s controls from the kit, and a card with none has no Act row', async () => {
    width(false);
    const w = world();
    w.play('k1'); w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 1'));
    run.mockClear();
    await userEvent.click(within(lens()).getByRole('button', { name: 'Wash it' }));
    expect(run).toHaveBeenCalledTimes(1);
    await userEvent.click(tab('Card 2'));
    expect(within(lens()).queryByRole('button', { name: 'Wash it' })).toBeNull();
  });

  test('Who is folded, and unfolds to its rows in billing order for a card that does not stack', async () => {
    width(false);
    const w = world();
    const early = w.play('k2', w.spritey);
    const late = w.play('k2', w.gloomba);
    /* The early play has drawn a reaction, so it is billed first. */
    w.fake.seed.react(w.me, w.pipe, early, 'fire');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    expect(rows()).toEqual([]);
    const who = whoButton();
    expect(who).toHaveAccessibleName('2 plays · Spritey, Gloomba');
    expect(who).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(who);
    expect(who).toHaveAttribute('aria-expanded', 'true');
    expect(rows()).toEqual([early, late]);
    await userEvent.click(who);
    expect(rows()).toEqual([]);
  });

  describe('the faces in Who', () => {
    /** Pipewrench has a picture, Spritey and Gloomba have none. */
    function faced() {
      const w = world();
      w.fake.seed.avatar(w.pipe, { square: 'data:image/webp;base64,AAAA' });
      return w;
    }
    const squares = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('.kb-lens-row-avatar')];

    test('folded, the button holds one face per distinct caster, up to three, in the words\' order, and its name is unchanged', async () => {
      width(false);
      const w = faced();
      w.play('k2', w.spritey);
      w.play('k2', w.gloomba);
      w.play('k2', w.spritey);
      w.play('k2', w.pipe);
      open(w);
      await userEvent.click(await markOf(2, 'Card 2'));
      const who = whoButton();
      expect(who).toHaveAccessibleName('4 plays · Pipewrench, Spritey, Gloomba');
      const faces = [...who.querySelectorAll<HTMLElement>('.kb-lens-face')];
      expect(faces.map((f) => f.textContent)).toEqual(['', 'S', 'G']);
      expect(faces[0]!.querySelector('img')).toHaveAttribute('src', 'data:image/webp;base64,AAAA');
      faces.forEach((f) => expect(f).toHaveAttribute('aria-hidden', 'true'));
    });

    test('a fourth distinct caster gets no face in the fold', async () => {
      width(false);
      const w = faced();
      const fourth = w.fake.seed.character(w.me, 'Fourth', 'face');
      [w.spritey, w.gloomba, w.pipe, fourth].forEach((c) => w.play('k2', c));
      open(w);
      await userEvent.click(await markOf(2, 'Card 2'));
      expect(whoButton().querySelectorAll('.kb-lens-face')).toHaveLength(3);
    });

    test('unfolded, each row has a square: the picture, or the first letter', async () => {
      width(false);
      const w = faced();
      const a = w.play('k2', w.spritey);
      const b = w.play('k2', w.pipe);
      open(w);
      await userEvent.click(await markOf(2, 'Card 2'));
      await userEvent.click(whoButton());
      const row = (id: Id) => lens().querySelector<HTMLElement>(`[data-kb-play="${id}"]`)!;
      const first = row(a).querySelector<HTMLElement>('.kb-lens-row-head .kb-lens-row-avatar')!;
      expect(first).toHaveAttribute('aria-hidden', 'true');
      expect(first).toHaveTextContent('S');
      expect(first.querySelector('img')).toBeNull();
      const second = row(b).querySelector<HTMLElement>('.kb-lens-row-head .kb-lens-row-avatar')!;
      expect(second.querySelector('img')).toHaveAttribute('src', 'data:image/webp;base64,AAAA');
      expect(row(a).querySelector('.kb-lens-row-head .kb-lens-by')).not.toBeNull();
    });

    test('a staff play\'s square is the first letter of the staff word', async () => {
      width(false);
      const w = world();
      const clerk = w.fake.seed.staff('clerk', 'The Clerk', 'mod');
      const id = w.play('k2', clerk);
      open(w);
      await userEvent.click(await markOf(2, 'Card 2'));
      await userEvent.click(whoButton());
      const row = lens().querySelector<HTMLElement>(`[data-kb-play="${id}"]`)!;
      const name = row.querySelector('.kb-lens-who')!.textContent!;
      expect(row.querySelector('.kb-lens-row-avatar')).toHaveTextContent([...name][0]!);
    });

    test('a play with no caster (the staff\'s own) gets the staff word\'s first letter, folded and unfolded', async () => {
      width(false);
      const w = world();
      const plays = createPlays();
      plays.add([{ id: 'staff-play', character: null, kind: 'card', thread: w.thread, targetActId: w.second, seq: null, createdAt: '2026-10-01T00:00:00Z', payload: { card: 'k2' }, currentPayload: { card: 'k2' }, editedAt: null, shownEditedAt: null }]);
      plays.setBilling(w.second, ['staff-play']);
      function Staffed() {
        const store = useLensStore();
        return <Lens open={{ owner: 'o', card: 'k2', opener: document.body }} store={store} post={w.second} plays={plays} tallies={createTallies()} mine={createMine()} compare={false} to={null}
          nameOf={(id) => (id === null ? 'The staff' : 'someone')} faceOf={() => null} onSpin={() => {}} />;
      }
      renderIn(w.fake, <LensProvider><Staffed /></LensProvider>, { path: '/', instance, cards });
      const who = await screen.findByRole('button', { name: /^1 play · / });
      expect(who).toHaveAccessibleName('1 play · The staff');
      const faces = who.querySelectorAll('.kb-lens-faces .kb-lens-face');
      expect(faces).toHaveLength(1);
      expect(faces[0]).toHaveTextContent('T');
      await userEvent.click(who);
      expect(document.querySelector('[data-kb-play="staff-play"] .kb-lens-row-avatar')).toHaveTextContent('T');
    });

    test('each row\'s square, and each face in the fold, carries its play\'s ink', async () => {
      width(false);
      document.documentElement.style.setProperty('--kb-glass-ink-neon', '#000000');
      onTestFinished(() => { document.documentElement.style.removeProperty('--kb-glass-ink-neon'); });
      const w = faced();
      const a = w.play('k2', w.spritey);
      w.play('k2', w.gloomba);
      open(w, cards.map((c) => (c.key === 'k2' ? { ...c, tag: () => '#ff9f43' } : c)));
      await userEvent.click(await markOf(2, 'Card 2'));
      const ink = (el: Element) => el.closest<HTMLElement>('[style*="--kb-play-ink"]')?.style.getPropertyValue('--kb-play-ink');
      const faces = [...whoButton().querySelectorAll('.kb-lens-face')];
      expect(faces).toHaveLength(2);
      faces.forEach((f) => expect(ink(f)).toBe('#ff9f43'));
      await userEvent.click(whoButton());
      expect(squares(lens())).toHaveLength(2);
      squares(lens()).forEach((s) => expect(ink(s)).toBe('#ff9f43'));
      expect(ink(lens().querySelector(`[data-kb-play="${a}"] .kb-lens-row-avatar`)!)).toBe('#ff9f43');
    });

    test('two characters that share a name show two faces and one name in the words', async () => {
      width(false);
      const w = world();
      const twin = w.fake.seed.character(w.me, 'Spritey', 'heel');
      w.play('k2', w.spritey);
      w.play('k2', twin);
      open(w);
      await userEvent.click(await markOf(2, 'Card 2'));
      const who = whoButton();
      expect(who).toHaveAccessibleName('2 plays · Spritey');
      expect(who.querySelectorAll('.kb-lens-face')).toHaveLength(2);
    });
  });

  test('a card whose rules stack lists its rows by layer, top first, whatever was billed first', async () => {
    width(false);
    const w = world();
    const one = w.play('k1', w.spritey, w.second, 1);
    const two = w.play('k1', w.gloomba, w.second, 2);
    const three = w.play('k1', w.pipe, w.second, 3);
    w.fake.seed.react(w.thirdAccount, w.gloomba, one, 'fire');
    open(w);
    await userEvent.click(await markOf(2, 'Card 1'));
    await userEvent.click(whoButton());
    expect(rows()).toEqual([three, two, one]);
  });

  test('a row says who played it in capitals, when, the message, the card\'s note and the threads spun', async () => {
    width(false);
    const w = world();
    const first = w.play('k1', w.spritey, w.second, 1);
    await w.fake.spin(first, w.pipe, 'All about the ink', '');
    open(w);
    await userEvent.click(await markOf(2, 'Card 1'));
    await userEvent.click(whoButton());
    const row = lens().querySelector<HTMLElement>(`[data-kb-play="${first}"]`)!;
    expect(row).toHaveTextContent(/Spritey · played Oct 29, 2026/u);
    expect(row.querySelector('.kb-lens-who')).toHaveTextContent('Spritey');
    expect(row.querySelector('blockquote')).toHaveTextContent(`“k1 by ${w.spritey}”`);
    expect(row).toHaveTextContent('Layer 1 of 3, on top');
    expect(row.querySelector('.kb-lens-note')).toHaveTextContent('Layer 1 of 3, on top');
    expect(await within(row).findByText('1 thread spun from this play')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'All about the ink' })).toHaveAttribute('href', expect.stringMatching(/^\/t\//u));
    expect(within(row).getByRole('link', { name: 'Go to post' })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-2`);
  });

  test('an ink too dark for the glass is drawn lifted, on the open tab and the row, so their words and edges read', async () => {
    width(false);
    /* The glass's key puts the tab's words on the root (applyGlass); this one writes them in Divided World's dark teal. */
    document.documentElement.style.setProperty('--kb-glass-ink-neon', '#03141a');
    onTestFinished(() => { document.documentElement.style.removeProperty('--kb-glass-ink-neon'); });
    const w = world();
    const first = w.play('k1', w.spritey, w.second, 1);
    open(w, cards.map((c) => (c.key === 'k1' ? { ...c, tag: () => '#14030a' } : c)));
    await userEvent.click(await markOf(2, 'Card 1'));
    await userEvent.click(whoButton());
    const lifted = glassInk('#14030a', '#03141a')!;
    expect(lifted).not.toBe('#14030a');
    expect(lens().style.getPropertyValue('--kb-lens-ink')).toBe(lifted);
    expect(lens().querySelector<HTMLElement>(`[data-kb-play="${first}"]`)!.style.getPropertyValue('--kb-play-ink')).toBe(lifted);
    /* A change of key (high contrast) writes the tab's words in another ink, and the lift is measured again against it. */
    act(() => { document.documentElement.style.setProperty('--kb-glass-ink-neon', '#000000'); });
    await waitFor(() => expect(lens().style.getPropertyValue('--kb-lens-ink')).toBe(glassInk('#14030a', '#000000')));
    expect(glassInk('#14030a', '#000000')).not.toBe(lifted);
  });

  test('a row carries its play\'s ink as a bar, and its note stands above its caster', async () => {
    width(false);
    /* The glass's key resolves the tab's words on the root, as the app's stylesheet does (web/src/main.tsx); a test page has none. */
    document.documentElement.style.setProperty('--kb-glass-ink-neon', '#000000');
    onTestFinished(() => { document.documentElement.style.removeProperty('--kb-glass-ink-neon'); });
    const w = world();
    const first = w.play('k1', w.spritey, w.second, 1);
    open(w, cards.map((c) => (c.key === 'k1' ? { ...c, tag: () => '#ff9f43' } : c)));
    await userEvent.click(await markOf(2, 'Card 1'));
    await userEvent.click(whoButton());
    const row = lens().querySelector<HTMLElement>(`[data-kb-play="${first}"]`)!;
    expect(row.style.getPropertyValue('--kb-play-ink')).toBe('#ff9f43');
    const note = row.querySelector('.kb-lens-note')!;
    const by = row.querySelector('.kb-lens-by')!;
    expect(note.compareDocumentPosition(by) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('a play with more public reactions than its post says so, in words that are not the settlement\'s', async () => {
    width(false);
    const w = world();
    const drawn = w.play('k2', w.spritey);
    const quiet = w.play('k2', w.gloomba);
    w.fake.seed.react(w.me, w.pipe, drawn, 'fire');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    const row = (id: Id) => lens().querySelector<HTMLElement>(`[data-kb-play="${id}"]`)!;
    expect(row(drawn)).toHaveTextContent('More reactions than the post');
    expect(row(quiet)).not.toHaveTextContent('More reactions than the post');
    /* A card whose view says nothing of a play draws no note line for it: the view's notes are the only source. */
    expect(row(quiet).querySelector('.kb-lens-note')).toBeNull();
    expect(lens()).not.toHaveTextContent(/outdraw/iu);
  });

  test('a row\'s React calls the API with the play\'s Act, and the row counts it in place', async () => {
    width(false);
    const w = world();
    const theirs = w.play('k2', w.spritey);
    const react = vi.spyOn(w.fake, 'react');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    await userEvent.click(within(lens()).getByRole('button', { name: 'React' }));
    const picker = screen.getByRole('dialog', { name: 'React to Spritey\'s Card 2' });
    await userEvent.click(within(picker).getByRole('button', { name: 'Tea, Calm' }));
    await waitFor(() => expect(react).toHaveBeenCalledWith(theirs, w.pipe, 'tea'));
    await waitFor(() => expect(within(lens()).getByRole('button', { name: /^Tea, 1/u })).toBeInTheDocument());
    expect(lens().querySelector('.kb-reactions')).toHaveAttribute('data-kb-over-ink');
    expect(lens().querySelector('[data-kb-look]')).toBeNull();
  });

  test('Esc closes a picker opened from the Lens first, and the Lens only the next time', async () => {
    width(false);
    const w = world();
    w.play('k2', w.spritey);
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    await userEvent.click(within(lens()).getByRole('button', { name: 'React' }));
    expect(screen.getByRole('dialog', { name: 'React to Spritey\'s Card 2' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'React to Spritey\'s Card 2' })).toBeNull();
    expect(lens()).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('the reader\'s own play says "Your play" and has no React', async () => {
    width(false);
    const w = world();
    const mine = w.play('k2', w.pipe);
    const theirs = w.play('k2', w.spritey);
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    const own = lens().querySelector<HTMLElement>(`[data-kb-play="${mine}"]`)!;
    const other = lens().querySelector<HTMLElement>(`[data-kb-play="${theirs}"]`)!;
    expect(within(own).getByText('Your play')).toBeInTheDocument();
    expect(within(own).queryByRole('button', { name: 'React' })).toBeNull();
    expect(within(other).queryByText('Your play')).toBeNull();
    expect(within(other).getByRole('button', { name: 'React' })).toBeInTheDocument();
  });

  test('every play of a kind is reachable by Spin thread and Go to post from its row', async () => {
    width(false);
    const w = world();
    w.play('k2', w.spritey); w.play('k2', w.gloomba); w.play('k2', w.pipe);
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    expect(rows()).toHaveLength(3);
    expect(within(lens()).getAllByRole('button', { name: 'Spin thread' })).toHaveLength(3);
    expect(within(lens()).getAllByRole('link', { name: 'Go to post' })).toHaveLength(3);
  });

  test('every control in a row is the kit\'s skewed tile, as Hold to scrub is: React, Spin thread and Go to post speak one shape', async () => {
    width(false);
    const w = world();
    w.play('k2', w.spritey); w.play('k2', w.gloomba);
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    const controls = [...lens().querySelectorAll<HTMLElement>('.kb-lens-row :is(button, a)')];
    expect(controls.map((c) => c.textContent)).toEqual(expect.arrayContaining(['+ React', 'Spin thread', 'Go to post']));
    for (const c of controls) {
      /* React is the meta tile (glass/meta-tile.css), the others the kit's: both skew, both stand their words upright. */
      const meta = c.classList.contains('kb-meta-tile');
      expect(c, c.textContent ?? '').toHaveClass(meta ? 'kb-meta-tile' : 'kb-kit-tile');
      expect(c.querySelector(meta ? ':scope > .kb-meta-tile-in' : ':scope > .kb-kit-tile-label'), `${c.textContent}'s words stand upright on the skew`).not.toBeNull();
    }
  });
});

describe('spinning from a play', () => {
  test('Spin thread closes the Lens and opens the spin form named for the play, which spins from the play', async () => {
    width(false);
    const w = world();
    const play = w.play('k2', w.spritey);
    const spin = vi.spyOn(w.fake, 'spin');
    open(w);
    const mark = await markOf(2, 'Card 2');
    await userEvent.click(mark);
    await userEvent.click(whoButton());
    await userEvent.click(within(lens()).getByRole('button', { name: 'Spin thread' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const form = within(await article(2)).getByRole('form', { name: 'Spin a thread from Spritey\'s Card 2' });
    expect(within(form).getByLabelText('Thread title')).toHaveFocus();
    await userEvent.type(within(form).getByLabelText('Thread title'), 'About the ink');
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(spin).toHaveBeenCalledWith(play, w.pipe, 'About the ink', ''));
  });

  test('a draft typed for the post survives a switch to a play and back, and each origin keeps its own', async () => {
    width(false);
    const w = world();
    w.play('k2', w.spritey);
    open(w);
    const post = await article(2);
    await userEvent.click(within(post).getByRole('button', { name: 'Spin thread' }));
    const forPost = within(post).getByRole('form', { name: 'Spin a thread from post 2' });
    await userEvent.type(within(forPost).getByLabelText('Thread title'), 'About the post');
    await userEvent.type(within(forPost).getByLabelText('Your opening post (optional)'), 'Words');

    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    await userEvent.click(within(lens()).getByRole('button', { name: 'Spin thread' }));
    const forPlay = within(post).getByRole('form', { name: 'Spin a thread from Spritey\'s Card 2' });
    expect(within(forPlay).getByLabelText('Thread title')).toHaveValue('');
    await userEvent.type(within(forPlay).getByLabelText('Thread title'), 'About the play');

    await userEvent.click(within(post).getByRole('button', { name: 'Spin thread', expanded: false }));
    const back = within(post).getByRole('form', { name: 'Spin a thread from post 2' });
    expect(within(back).getByLabelText('Thread title')).toHaveValue('About the post');
    expect(within(back).getByLabelText('Your opening post (optional)')).toHaveValue('Words');

    /* And the play's is there when it is opened again. */
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    await userEvent.click(within(lens()).getByRole('button', { name: 'Spin thread' }));
    expect(within(within(post).getByRole('form', { name: 'Spin a thread from Spritey\'s Card 2' })).getByLabelText('Thread title')).toHaveValue('About the play');
  });
});

describe('a Lens that does not block the page', () => {
  test('it is aria-modal="false" and nothing on the page is inert while it is open', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    expect(lens()).toHaveAttribute('aria-modal', 'false');
    /* Asserted on a post that stays on screen, never by counting across a document whose posts have gone. */
    const post = await article(2);
    expect(post).toBeInTheDocument();
    expect(post.closest('[inert]')).toBeNull();
    expect(document.querySelector('[inert]')).toBeNull();
    expect(within(post).getByRole('button', { name: 'Spin thread' })).toBeEnabled();
    await userEvent.click(within(post).getByRole('button', { name: 'Spin thread' }));
    expect(within(post).getByRole('form', { name: /^Spin a thread/u })).toBeInTheDocument();
    expect(lens()).toBeInTheDocument();
  });

  test('it is a sheet under 40em and a dock at the right on a desktop', async () => {
    width(false);
    const w = world();
    w.play('k2');
    const view = open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await act(async () => {});
    expect(lens()).toHaveAttribute('data-kb-lens', 'dock');
    view.unmount();
    width(true);
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await act(async () => {});
    expect(lens()).toHaveAttribute('data-kb-lens', 'sheet');
  });

  test('it is a sheet at a tablet\'s width too (up to 64em), where the dock would leave the post too narrow', async () => {
    width(false, true);
    const w = world();
    w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await act(async () => {});
    expect(lens()).toHaveAttribute('data-kb-lens', 'sheet');
  });
});


describe('the tablist', () => {
  test('has a label of its own, distinct from the dialog\'s', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    expect(within(lens()).getByRole('tablist', { name: 'Card kinds' })).toBeInTheDocument();
    expect(lens()).toHaveAccessibleName('Cards on this post');
  });

  test('focus moves to the open tab without scrolling the page', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    const mark = await markOf(2, 'Card 2');
    const real = HTMLElement.prototype.focus;
    const calls: Array<[Element, unknown]> = [];
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) { calls.push([this, options]); return real.call(this, options); });
    await userEvent.click(mark);
    const onTab = calls.filter(([el]) => el === tab('Card 2'));
    expect(onTab.length).toBeGreaterThan(0);
    expect(onTab[0]![1]).toEqual({ preventScroll: true });
  });
});

describe('Who across tabs', () => {
  test('stays unfolded when the tab changes, and is folded again by the next Lens', async () => {
    width(false);
    const w = world();
    const a = w.play('k2');
    const b = w.play('k3');
    open(w);
    await userEvent.click(await markOf(2, 'Card 3'));
    await userEvent.click(whoButton());
    expect(rows()).toEqual([b]);
    await userEvent.click(tab('Card 2'));
    expect(whoButton()).toHaveAttribute('aria-expanded', 'true');
    expect(rows()).toEqual([a]);
    await userEvent.click(tab('Card 3'));
    expect(rows()).toEqual([b]);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await markOf(2, 'Card 3'));
    expect(rows()).toEqual([]);
  });
});

/** The plain link at the very foot of a post's Lens: the last stop in it. */
const reportToAdmins = () => within(lens()).getByRole('button', { name: 'Report to admins' });

describe('the Tab order around a Lens drawn at the end of the body', () => {
  test('Tab past its last control goes to the element after the mark, Shift+Tab before its first goes back to the mark, and it stays open', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    const mark = await markOf(2, 'Card 2');
    await userEvent.click(mark);
    /* The first stop is the open tab and the last is Report to admins, the plain link at the foot of the Lens (the conduct plan, Task 6). */
    expect(tab('Card 2')).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(mark).toHaveFocus();
    expect(lens()).toBeInTheDocument();
    reportToAdmins().focus();
    await userEvent.tab();
    expect(within(await article(2)).getByRole('link', { name: 'Permalink to post #2' })).toHaveFocus();
    expect(lens()).toBeInTheDocument();
  });

  test('a control the page hides right after the mark is skipped: Tab lands on the next one that can be seen', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    const mark = await markOf(2, 'Card 2');
    const link = within(await article(2)).getByRole('link', { name: 'Permalink to post #2' });
    for (const hide of ['display: none', 'visibility: hidden']) {
      const hidden = document.createElement('button');
      hidden.setAttribute('style', hide);
      hidden.textContent = 'hidden';
      mark.closest('header')!.insertBefore(hidden, link);
    }
    await userEvent.click(mark);
    reportToAdmins().focus();
    await userEvent.tab();
    expect(link).toHaveFocus();
  });
});

describe('the Lens follows its mark', () => {
  test('a mark that leaves the strip (it narrows) is replaced as the anchor by the "+N" that now hides its kind, and nothing is measured from a detached node', async () => {
    const listeners = new Set<() => void>();
    const query = { matches: false, media: '(max-width: 40em)', addEventListener: (_: string, l: () => void) => listeners.add(l), removeEventListener: (_: string, l: () => void) => listeners.delete(l), addListener: () => {}, removeListener: () => {} };
    vi.stubGlobal('matchMedia', () => query as unknown as MediaQueryList);
    const w = world();
    for (const k of KEYS) w.play(k);
    open(w);
    const post = await article(2);
    /* Billing is newest first: k6 k5 k4 k3 are drawn on a desktop, and k3 is the last. */
    const mark = await within(post).findByRole('button', { name: /^Card 3, 1 play/u });
    await userEvent.click(mark);
    const measured: Element[] = [];
    const real = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) { measured.push(this); return real.call(this); });
    query.matches = true;
    await act(async () => { for (const l of [...listeners]) l(); });
    expect(mark.isConnected).toBe(false);
    expect(lens()).toBeInTheDocument();
    measured.length = 0;
    await act(async () => { window.dispatchEvent(new Event('resize')); await new Promise((r) => setTimeout(r, 40)); });
    expect(measured.length).toBeGreaterThan(0);
    expect(measured.filter((el) => !el.isConnected)).toEqual([]);
    expect(measured.some((el) => el.classList.contains('kb-mark-more'))).toBe(true);
  });
});

describe('the first frame of a row', () => {
  test('has the count of threads spun from the play when the page has read it', async () => {
    width(false);
    const w = world();
    const play = w.play('k2', w.spritey);
    await w.fake.spin(play, w.pipe, 'All about the ink', '');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    /* A synchronous click: nothing but the first frame is drawn when it returns. */
    fireEvent.click(whoButton());
    const row = lens().querySelector<HTMLElement>(`[data-kb-play="${play}"]`)!;
    expect(within(row).getByText('1 thread spun from this play')).toBeInTheDocument();
  });
});

describe('the page\'s one Lens', () => {
  test('leaving the page closes it', () => {
    let grab!: ReturnType<typeof useLensStore>;
    function Probe() { grab = useLensStore(); return null; }
    const view = render(<LensProvider><Probe /></LensProvider>);
    grab.toggle({ owner: 'a', card: 'k1', opener: document.body });
    expect(grab.get()?.card).toBe('k1');
    view.unmount();
    expect(grab.get()).toBeNull();
  });

  test('opening a Lens wakes the strip that owns it and no other', () => {
    const renders = { a: 0, b: 0 };
    let grab!: ReturnType<typeof useLensStore>;
    function Strip({ owner }: { readonly owner: 'a' | 'b' }) {
      const store = useLensStore();
      grab = store;
      useLensFor(store, owner);
      renders[owner]++;
      return null;
    }
    render(<LensProvider><Strip owner="a" /><Strip owner="b" /></LensProvider>);
    const [a0, b0] = [renders.a, renders.b];
    act(() => grab.toggle({ owner: 'a', card: 'k1', opener: document.body }));
    expect([renders.a - a0, renders.b - b0]).toEqual([1, 0]);
    act(() => grab.toggle({ owner: 'b', card: 'k1', opener: document.body }));
    expect([renders.a - a0, renders.b - b0]).toEqual([2, 1]);
    act(() => grab.select('k2'));
    expect([renders.a - a0, renders.b - b0]).toEqual([2, 2]);
  });
});

export type { World };

/*
 * As it landed (docs/plans/2026-11-03-effect-history-plan.md, Task 5): a play's moment drawn in the post's body, in a glass frame,
 * one on the page at a time and gone with its Lens. Card 1 stacks, so a moment draws it still from what it had saved then; Card 2 is
 * a takeover that lifts the post, which a moment never replaces.
 */
describe('As it landed', () => {
  const strokes = vi.fn();
  function Washy({ plays, states, still, show, children }: EffectProps) {
    const washed = plays.map((p) => (states[p.id]?.state as { washed?: number } | undefined)?.washed ?? 0);
    useEffect(() => { show({ progress: null, state: `washed ${washed.join(', ')}`, yours: false, controls: [], notes: {} }); }, [show, washed.join()]);
    return <div data-kb-washy={still ? 'still' : 'live'} data-kb-washed={washed.join()} onPointerDown={still ? undefined : strokes}>{children}</div>;
  }
  const Lift = ({ children }: EffectProps) => <div data-kb-lift>{children}</div>;
  const lifted = cards.map((c) => (c.key === 'k1' ? { ...c, Effect: Washy } : c.key === 'k2' ? { ...c, Effect: Lift, takeover: true } : c));

  /* Card 1 lands on post 2 over nothing, is saved at 40%, then the post is edited, Card 2 lifts it, and the wash is finished. */
  async function landed(before?: (w: World) => void) {
    width(false);
    const w = world();
    before?.(w);
    const k1 = w.play('k1');
    w.fake.signInAs(w.other);
    const saved = await w.fake.saveEffect(k1, w.spritey, { washed: 0.4 });
    w.fake.clock.advance(60_000);
    const k1b = w.play('k1', w.gloomba, w.second, 2);
    await w.fake.edit(w.second, w.spritey, 'post 2, edited');
    w.play('k2');
    await w.fake.saveEffect(k1, w.spritey, { washed: 1 });
    w.fake.signInAs(w.me);
    expect(saved.ok).toBe(true);
    open(w, lifted);
    await userEvent.click(await markOf(2, 'Card 1'));
    await userEvent.click(whoButton());
    return { w, k1, k1b };
  }
  const landedButton = (play: Id) => within(lens().querySelector<HTMLElement>(`[data-kb-play="${play}"]`)!).getByRole('button', { name: 'As it landed' });
  const frame = async () => within(await article(2)).findByRole('group', { name: /^As it landed/u });

  test('draws the moment\'s version in place of the live body, still, inside the takeover\'s lift', async () => {
    const { k1b } = await landed();
    const button = landedButton(k1b);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    const post = await article(2);
    const box = await frame();
    expect(box.closest('[data-kb-lift]')).not.toBeNull();
    /* The words as they read then, and the wash as it was saved then: the first layer at 40%, the second as it landed. */
    expect(within(box).getByText('post 2')).toBeInTheDocument();
    expect(within(post).queryByText('post 2, edited')).toBeNull();
    await waitFor(() => expect(box.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washed', '0.4,0'));
    expect(box.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washy', 'still');
    expect(post.querySelector('[data-kb-washy="live"]')).toBeNull();
    /* The tag, and the frame's words: the still card's own, and what is named. */
    expect(within(box).getByText(/^As it landed/u)).toBeInTheDocument();
    expect(await within(box).findByText(/washed 0\.4, 0/u)).toBeInTheDocument();
    /* Pressed again, it is gone. */
    await userEvent.click(button);
    expect(within(await article(2)).queryByRole('group', { name: /^As it landed/u })).toBeNull();
    expect(within(await article(2)).getByText('post 2, edited')).toBeInTheDocument();
  });

  test('a moment taken before Card 2 names nothing of it, and one taken over Card 1 lists what else was there', async () => {
    const { k1 } = await landed();
    await userEvent.click(landedButton(k1));
    const box = await frame();
    expect(within(box).queryByText(/Also on the post then/u)).toBeNull();
    await waitFor(() => expect(box.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washed', '0'));
  });

  test('Esc, the ×, another post\'s Lens and Back to now each bring the live body back', async () => {
    const { k1b } = await landed((w) => { w.play('k3', w.spritey, w.third); });
    const back = async () => {
      await userEvent.click(await markOf(2, 'Card 1'));
      if (!within(lens()).queryByRole('button', { name: 'As it landed' })) await userEvent.click(whoButton());
      await userEvent.click(landedButton(k1b));
      await frame();
    };
    const live = async () => waitFor(async () => {
      expect(within(await article(2)).queryByRole('group', { name: /^As it landed/u })).toBeNull();
      expect(within(await article(2)).getByText('post 2, edited')).toBeInTheDocument();
    });
    await userEvent.click(landedButton(k1b));
    await frame();
    await userEvent.keyboard('{Escape}');
    await live();
    await back();
    await userEvent.click(within(lens()).getByRole('button', { name: 'Close' }));
    await live();
    await back();
    await userEvent.click(await markOf(3, 'Card 3'));
    await live();
    await userEvent.click(within(lens()).getByRole('button', { name: 'Close' }));
    await back();
    await userEvent.click(within(await frame()).getByRole('button', { name: 'Back to now' }));
    await live();
    expect(lens()).toBeInTheDocument();
  });

  test('while a moment shows, the marks stay pressable and no stroke reaches the live effect', async () => {
    const { k1b } = await landed();
    await userEvent.click(landedButton(k1b));
    const box = await frame();
    fireEvent.pointerDown(box.querySelector('[data-kb-washy]')!);
    fireEvent.pointerDown(within(box).getByText('post 2'));
    expect(strokes).not.toHaveBeenCalled();
    const mark = await markOf(2, 'Card 2');
    await userEvent.click(mark);
    expect(tab('Card 2')).toHaveAttribute('aria-selected', 'true');
  });

  test('As it landed is a busy button while the moment is read, shows the moment whole once it lands, and "Loading the moment" is gone', async () => {
    const { w, k1b } = await landed();
    let release!: () => void;
    const real = w.fake.playMoment.bind(w.fake);
    vi.spyOn(w.fake, 'playMoment').mockImplementationOnce((id) => new Promise((resolve) => { release = () => resolve(real(id)); }));
    await userEvent.click(landedButton(k1b));
    expect(landedButton(k1b)).toHaveAttribute('aria-busy', 'true');
    expect(landedButton(k1b)).toHaveAccessibleName('As it landed');
    expect(within(await article(2)).queryByRole('group', { name: /^As it landed/u })).toBeNull();
    expect(screen.queryByText('Loading the moment…')).toBeNull();
    await act(async () => { release(); });
    const box = await frame();
    expect(box.querySelector('[aria-busy="true"]')).toBeNull();
    expect(within(box).queryByText(/Loading/u)).toBeNull();
    expect(landedButton(k1b)).not.toHaveAttribute('aria-busy');
  });

  test('a moment that does not load shows nothing in the post and says so plainly under the button, which is pressed again to ask again', async () => {
    const { w, k1b } = await landed();
    const read = vi.spyOn(w.fake, 'playMoment').mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(landedButton(k1b));
    expect(await within(lens()).findByText('That didn\u2019t load. Try again.')).toBeInTheDocument();
    expect(within(await article(2)).queryByRole('group', { name: /^As it landed/u })).toBeNull();
    expect(landedButton(k1b)).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(landedButton(k1b));
    expect(await within(await frame()).findByText('post 2')).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
    /* The note clears in its own state update, which can land after the frame shows. */
    await waitFor(() => expect(within(lens()).queryByText('That didn\u2019t load. Try again.')).toBeNull());
  });

  test('Back to now gives focus back to the play\'s As it landed', async () => {
    const { k1b } = await landed();
    await userEvent.click(landedButton(k1b));
    const box = await frame();
    await userEvent.click(within(box).getByRole('button', { name: 'Back to now' }));
    expect(within(await article(2)).queryByRole('group', { name: /^As it landed/u })).toBeNull();
    await waitFor(() => expect(landedButton(k1b)).toHaveFocus());
    expect(landedButton(k1b)).toHaveAttribute('aria-pressed', 'false');
  });

  test('a read on its way is not sent again, and its answer is kept though the moment was hidden meanwhile', async () => {
    const { w, k1b } = await landed();
    let answer: (m: Awaited<ReturnType<typeof w.fake.playMoment>>) => void = () => {};
    const real = w.fake.playMoment.bind(w.fake);
    const read = vi.spyOn(w.fake, 'playMoment').mockImplementationOnce((id) => new Promise((resolve) => { answer = resolve; void real(id); }));
    await userEvent.click(landedButton(k1b));
    await userEvent.click(landedButton(k1b));
    await userEvent.click(landedButton(k1b));
    await act(async () => { answer(await real(k1b)); });
    expect(await within(await frame()).findByText('post 2')).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('a moment is read once for the page, however often it is shown', async () => {
    const { w, k1b } = await landed();
    const read = vi.spyOn(w.fake, 'playMoment');
    await userEvent.click(landedButton(k1b));
    await frame();
    await userEvent.click(landedButton(k1b));
    await userEvent.click(landedButton(k1b));
    await frame();
    expect(read).toHaveBeenCalledTimes(1);
  });
});


/* An admin's End this card (docs/plans/2026-11-05-bot-card-options-plan.md, Task 6): on a face-up play still in force, to an admin alone. */
describe('End this card', () => {
  const endButton = () => within(lens()).queryByRole('button', { name: 'End this card' });
  const unfold = async () => { await userEvent.click(whoButton()); };
  const openKind = async (n: number, card: string) => { await userEvent.click(await markOf(n, card)); await unfold(); };

  test('is offered to an admin on a live face-up play', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    w.play('k2');
    open(w);
    await openKind(2, 'Card 2');
    expect(endButton()).toBeInTheDocument();
  });

  test('is never offered to a player who is not an admin', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    await openKind(2, 'Card 2');
    expect(endButton()).toBeNull();
  });

  test('is not offered on a caught play', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.second, 'k2', { caught: w.third });
    open(w);
    await openKind(2, 'Card 2');
    expect(endButton()).toBeNull();
  });

  test('is not offered on an ended play, which reads Ended by an admin', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    const played = w.play('k2');
    expect((await w.fake.reverseCard(played)).ok).toBe(true);
    open(w);
    const mark = await markOf(2, 'Card 2');
    await userEvent.click(mark);
    expect(within(lens()).getByText('Ended by an admin', { selector: '.kb-lens-line' })).toBeInTheDocument();
    await unfold();
    expect(endButton()).toBeNull();
  });

  test('is not offered on a card back, even to an admin', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    w.fake.clock.advance(60_000);
    w.fake.seed.set(w.spritey, w.second, 'k2', { at: w.fake.clock.now() });
    open(w);
    await userEvent.click(await within(await article(2)).findByRole('button', { name: /^A card set face down/u }));
    await unfold();
    expect(endButton()).toBeNull();
  });

  test('asks first in plain words naming the card and its caster, then ends the play for everyone', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    const played = w.play('k2');
    const reverse = vi.spyOn(w.fake, 'reverseCard');
    open(w);
    await openKind(2, 'Card 2');
    await userEvent.click(endButton()!);
    const ask = screen.getByRole('dialog', { name: 'End this card?' });
    expect(within(ask).getByText('End this Card 2 by Spritey? Its layer comes off for everyone, and nothing is refunded.')).toBeInTheDocument();
    expect(reverse).not.toHaveBeenCalled();
    await userEvent.click(within(ask).getByRole('button', { name: 'End it' }));
    expect(reverse).toHaveBeenCalledWith(played);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'End this card?' })).toBeNull());
    expect(within(lens()).getByText('Ended by an admin', { selector: '.kb-lens-line' })).toBeInTheDocument();
    expect(endButton()).toBeNull();
  });

  test('is not offered on a Use that has worn off', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.second, 'k2', { ends: new Date(w.fake.clock.now() - 3_600_000).toISOString() });
    open(w);
    await openKind(2, 'Card 2');
    expect(endButton()).toBeNull();
  });

  test('is offered on a Use still ahead of its end, which the worn-off one beside it is not', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.second, 'k2', { ends: new Date(w.fake.clock.now() - 3_600_000).toISOString() });
    w.fake.seed.card(w.spritey, w.second, 'k2', { ends: new Date(w.fake.clock.now() + 3_600_000).toISOString() });
    open(w);
    await openKind(2, 'Card 2');
    expect(within(lens()).getAllByRole('button', { name: 'End this card' })).toHaveLength(1);
  });

  test('says Ended by an admin on the ended play of a kind alone, and offers End on the live one beside it', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    const live = w.play('k2');
    const ended = w.play('k2');
    expect((await w.fake.reverseCard(ended)).ok).toBe(true);
    open(w);
    await openKind(2, 'Card 2');
    const row = (id: Id) => lens().querySelector<HTMLElement>(`[data-kb-play="${id}"]`)!;
    expect(within(row(ended)).getByText('Ended by an admin')).toBeInTheDocument();
    expect(within(row(live)).queryByText('Ended by an admin')).toBeNull();
    expect(within(row(ended)).queryByRole('button', { name: 'End this card' })).toBeNull();
    expect(within(row(live)).getByRole('button', { name: 'End this card' })).toBeInTheDocument();
  });

  test('takes the layer off at once when no broadcast arrives, the Lens adding the end itself', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    w.play('k2');
    open(w);
    await openKind(2, 'Card 2');
    /* Every event the server would send is held and never delivered: only the Lens's own add can show the end. */
    w.fake.broadcast.hold();
    await userEvent.click(endButton()!);
    await userEvent.click(within(screen.getByRole('dialog', { name: 'End this card?' })).getByRole('button', { name: 'End it' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'End this card?' })).toBeNull());
    expect(within(lens()).getByText('Ended by an admin', { selector: '.kb-lens-line' })).toBeInTheDocument();
    expect(endButton()).toBeNull();
    expect(w.fake.broadcast.log.some((e) => e.event === 'act')).toBe(true);
  });

  test('End it is a busy button while the end is out: aria-busy, its name kept, and a second press ends once', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    w.play('k2');
    let release!: () => void;
    const real = w.fake.reverseCard.bind(w.fake);
    const reverse = vi.spyOn(w.fake, 'reverseCard').mockImplementation((play) => new Promise((resolve) => { release = () => resolve(real(play)); }));
    open(w);
    await openKind(2, 'Card 2');
    await userEvent.click(endButton()!);
    const dialog = screen.getByRole('dialog', { name: 'End this card?' });
    const end = within(dialog).getByRole('button', { name: 'End it' });
    await userEvent.click(end);
    expect(end).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('button', { name: 'End it' })).toBe(end);
    await userEvent.click(end);
    expect(reverse).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'End this card?' })).toBeNull());
  });

  test('cancel leaves the play as it was, and a refusal\'s words are shown in the dialog', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    w.play('k2');
    const reverse = vi.spyOn(w.fake, 'reverseCard').mockResolvedValueOnce({ ok: false, error: 'an admin has already ended that card' });
    open(w);
    await openKind(2, 'Card 2');
    await userEvent.click(endButton()!);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(reverse).not.toHaveBeenCalled();
    await userEvent.click(endButton()!);
    await userEvent.click(screen.getByRole('button', { name: 'End it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('an admin has already ended that card');
    expect(screen.getByRole('dialog', { name: 'End this card?' })).toBeInTheDocument();
  });
});


/*
 * A visit's tab (the Mod Bots design, section 9; docs/research/2026-11-06-mod-bots/01-on-a-visit.png and 02-filed-author.png): the Lens opens on the
 * visit, ahead of the card kinds. Its words are the glass's plain voice; the Mod's lines are quoted as its own.
 */
describe('a visit\'s tab', () => {
  const HOUR = 3_600_000;
  const QUIZ = { kind: 'quiz', question: 'Which form is used to request another form?', choices: ['Form 1-A', 'Form 0', 'Form 27-B/6'], answer: 'Form 0' } as const;

  /** A visit on Spritey's post 2, and on Pipewrench's post 4 where `mine` is set: the reader plays Pipewrench. */
  function visited(o: { challenge?: Parameters<Fake['seed']['visit']>[2] extends infer T ? T extends { challenge?: infer C } ? C : never : never; mine?: boolean; endsInMs?: number } = {}) {
    const w = world();
    const clerk = w.fake.seed.staff('clerk', 'The Clerk', 'mod', { pronouns: PRONOUN_PRESETS.they });
    const post = o.mine ? w.fake.seed.post(w.thread, w.pipe, 'post 4') : w.second;
    const visit = w.fake.seed.visit(clerk, post, { at: w.fake.clock.now(), endsInMs: o.endsInMs ?? 161 * 60_000, line: 'Routine inspection.', ...(o.challenge ? { challenge: o.challenge } : {}) });
    return { ...w, clerk, post, visit, seq: o.mine ? 4 : 2 };
  }
  const openVisit = (w: ReturnType<typeof visited>) =>
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance, cards, copy: { modRole: 'A Moderator' } });
  const visitMark = async (seq: number) => within(await article(seq)).findByRole('button', { name: /Opens the visit\.$/u });
  const visitLens = () => screen.getByRole('dialog', { name: /^Visit/u });
  /** Tab until the control has the focus, as a keyboard reader reaches it (the Lens's tab, its close cross, then its controls). */
  const tabTo = async (el: HTMLElement) => { for (let i = 0; i < 8 && document.activeElement !== el; i++) await userEvent.tab(); expect(el).toHaveFocus(); };
  /** Opens the visit's Lens and waits for its story to be read: the challenge is drawn from it. */
  const press = async (w: ReturnType<typeof visited>) => {
    await userEvent.click(await visitMark(w.seq));
    const l = visitLens();
    await waitFor(() => expect(l.querySelector('.kb-visit')).not.toHaveAttribute('aria-busy'));
    return l;
  };
  /** The filing of the visit and what it put on its author, as the tick writes them. */
  const file = (w: ReturnType<typeof visited>, by: Id = w.spritey) => {
    w.fake.seed.visitEnd(w.visit, { outcome: 'filed', line: 'Stamped, initialed, and filed under D.' });
    return w.fake.seed.infraction(w.visit, { points: 2 });
  };

  test('the visit\'s tab is busy while the story is read, and its panel then enters whole: no aria-busy block, no "Reading"', async () => {
    const w = visited();
    openVisit(w);
    let release!: () => void;
    const real = w.fake.visitStory.bind(w.fake);
    vi.spyOn(w.fake, 'visitStory').mockImplementation((...args) => new Promise((resolve) => { release = () => resolve(real(...args)); }));
    await userEvent.click(await visitMark(w.seq));
    const l = visitLens();
    expect(within(l).getByRole('tab', { name: /^On a visit/u })).toHaveAttribute('aria-busy', 'true');
    expect(l.querySelector('.kb-visit')).toBeNull();
    await act(async () => { release(); });
    await waitFor(() => expect(l.querySelector('.kb-visit')).not.toBeNull());
    expect(l.querySelector('.kb-visit')).not.toHaveAttribute('aria-busy');
    expect(l.querySelector('[aria-busy="true"]')).toBeNull();
    expect(within(l).getByRole('tab', { name: /^On a visit/u })).not.toHaveAttribute('aria-busy');
  });

  /** The Lens opened on the card's tab, the visit's tab among the others. */
  const onCardTab = async (w: ReturnType<typeof visited>) => {
    width(false);
    w.play('k1');
    openVisit(w);
    await userEvent.click(await markOf(w.seq, 'Card 1'));
    const l = visitLens();
    expect(within(l).getByRole('tab', { name: 'Card 1' })).toHaveAttribute('aria-selected', 'true');
    return l;
  };

  test('a visit read that fails from another tab says so plainly and stays on that tab', async () => {
    const w = visited();
    const l = await onCardTab(w);
    vi.spyOn(w.fake, 'visitStory').mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(within(l).getByRole('tab', { name: 'On a visit' }));
    expect(await within(l).findByText('That didn\u2019t load. Try again.')).toBeInTheDocument();
    expect(within(l).getByRole('tab', { name: 'Card 1' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(within(l).getByRole('tab', { name: 'On a visit' }));
    await waitFor(() => expect(within(l).getByRole('tab', { name: 'On a visit' })).toHaveAttribute('aria-selected', 'true'));
    expect(within(l).queryByText('That didn\u2019t load. Try again.')).toBeNull();
  });

  test('pressing another tab while the visit is read does not take the reader back when it lands', async () => {
    const w = visited();
    const l = await onCardTab(w);
    let release!: () => void;
    const real = w.fake.visitStory.bind(w.fake);
    vi.spyOn(w.fake, 'visitStory').mockImplementationOnce((...args) => new Promise((resolve) => { release = () => resolve(real(...args)); }));
    await userEvent.click(within(l).getByRole('tab', { name: 'On a visit' }));
    await userEvent.click(within(l).getByRole('tab', { name: 'Card 1' }));
    await act(async () => { release(); });
    await waitFor(() => expect(within(l).getByRole('tab', { name: 'On a visit' })).not.toHaveAttribute('aria-busy'));
    expect(within(l).getByRole('tab', { name: 'Card 1' })).toHaveAttribute('aria-selected', 'true');
    expect(within(l).getByRole('tab', { name: 'On a visit' })).toHaveAttribute('aria-selected', 'false');
  });

  test('the tab read again after leaving it is a fresh story, not the one drawn before', async () => {
    const w = visited();
    const l = await onCardTab(w);
    const read = vi.spyOn(w.fake, 'visitStory');
    await userEvent.click(within(l).getByRole('tab', { name: 'On a visit' }));
    await waitFor(() => expect(l.querySelector('.kb-visit')).not.toBeNull());
    await userEvent.click(within(l).getByRole('tab', { name: 'Card 1' }));
    await userEvent.click(within(l).getByRole('tab', { name: 'On a visit' }));
    await waitFor(() => expect(l.querySelector('.kb-visit')).not.toBeNull());
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('is first of the Lens\'s tabs, ahead of the card kinds, and is the one open', async () => {
    width(false);
    const w = visited();
    w.play('k1');
    openVisit(w);
    const l = await press(w);
    expect(l).toHaveAccessibleName('Visit and cards on this post');
    expect(within(l).getAllByRole('tab').map((t) => t.textContent)).toEqual(['On a visit', 'Card 1']);
    expect(within(l).getByRole('tab', { name: 'On a visit' })).toHaveAttribute('aria-selected', 'true');
    expect(within(l).getByRole('tab', { name: 'On a visit' })).toHaveFocus();
    /* The arrow key moves to the cards' tab, which draws its own State, and back. */
    await userEvent.keyboard('{ArrowRight}');
    expect(within(visitLens()).getByRole('tab', { name: 'Card 1' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(within(visitLens()).getByRole('tab', { name: 'On a visit' })).toHaveAttribute('aria-selected', 'true');
  });

  describe('while it is open', () => {
    test('says who is visiting, the charge and what lands on whom and when, in the glass\'s plain words', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      openVisit(w);
      const l = await press(w);
      expect(within(l).getByRole('heading', { name: 'The Clerk is on a visit' })).toBeInTheDocument();
      expect(l).toHaveTextContent('Charge: Rule 2: No double posting (minor, 2 warn points).');
      expect(l).toHaveTextContent(/If nobody talks it down by .*, Spritey's warn bar gains 2 warn points and this post is marked as breaking Rule 2\./u);
    });

    test('says plainly that the time is up while it waits for its filing', async () => {
      width(false);
      const w = visited({ challenge: QUIZ, endsInMs: -60_000 });
      openVisit(w);
      const l = await press(w);
      expect(l).toHaveTextContent(/The time is up, so it files at the next check unless it is talked down first\./u);
    });

    test('a quiz is the Mod\'s question, quoted, and its answers as full-width block buttons, one to a row', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      openVisit(w);
      const l = await press(w);
      expect(within(l).getByRole('heading', { name: 'Talk it down' })).toBeInTheDocument();
      expect(l).toHaveTextContent('The Clerk asks: “Which form is used to request another form?”');
      const group = within(l).getByRole('group', { name: /Answers to The Clerk's question/u });
      const choices = within(group).getAllByRole('button');
      expect(choices.map((c) => c.textContent)).toEqual(['Form 1-A', 'Form 0', 'Form 27-B/6']);
      for (const c of choices) expect(c).toHaveClass('kb-visit-choice');
      expect(l).toHaveTextContent('One try for Pipewrench. An answer other than The Clerk\'s, and The Clerk visits Pipewrench\'s next post within 24 hours, charging Obstruction (minor, 2 warn points). There is no timer.');
      expect(within(l).getByRole('status')).toBeEmptyDOMElement();
    });

    test('a right answer reached and pressed by keyboard talks it down: the result is said in the status region, and the tab and the mark follow', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      openVisit(w);
      const l = await press(w);
      await tabTo(within(l).getByRole('button', { name: 'Form 0' }));
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(within(l).getByRole('status')).toHaveTextContent('Pipewrench got past The Clerk. The visit is over, and nothing landed on Spritey.'));
      expect(within(visitLens()).getByRole('tab', { name: 'Talked down' })).toBeInTheDocument();
      expect(within(await article(2)).getByRole('button', { name: /^The Clerk's visit to this post was talked down/u })).toHaveTextContent('Talked down');
      /* The try ended the visit and took the challenge with the button that was pressed: focus is on the open tab, not lost to the page. */
      expect(within(visitLens()).getByRole('tab', { name: 'Talked down' })).toHaveFocus();
    });

    test('a wrong answer says so and the tail; the answers stay, spent, and one try is all it takes', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      openVisit(w);
      const l = await press(w);
      await tabTo(within(l).getByRole('button', { name: 'Form 1-A' }));
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(within(l).getByRole('status')).toHaveTextContent('That was not the answer. The Clerk will visit Pipewrench\'s next post within 24 hours.'));
      const first = within(l).getByRole('button', { name: 'Form 1-A' });
      expect(first).toHaveAttribute('aria-disabled', 'true');
      expect(first).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(within(l).getByRole('button', { name: 'Form 0' }));
      expect((await w.fake.visitStory(w.thread, w.visit, w.second)).attempts).toHaveLength(1);
      expect(within(visitLens()).getByRole('tab', { name: 'On a visit' })).toBeInTheDocument();
    });

    test('a try the server took is spent here even when the story cannot be read again, and a right one ends the visit', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      const real = w.fake.visitStory.bind(w.fake);
      let reads = 0;
      w.fake.visitStory = async (...a) => { if (++reads > 1) throw new Error('offline'); return real(...a); };
      openVisit(w);
      const l = await press(w);
      await tabTo(within(l).getByRole('button', { name: 'Form 0' }));
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(within(l).getByRole('status')).toHaveTextContent('Pipewrench got past The Clerk.'));
      await waitFor(() => expect(within(visitLens()).getByRole('tab', { name: 'Talked down' })).toBeInTheDocument());
      expect((await real(w.thread, w.visit, w.second)).attempts).toHaveLength(1);
    });

    test('a wrong try the server took leaves the answers spent when the story cannot be read again', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      const real = w.fake.visitStory.bind(w.fake);
      let reads = 0;
      w.fake.visitStory = async (...a) => { if (++reads > 1) throw new Error('offline'); return real(...a); };
      openVisit(w);
      const l = await press(w);
      await tabTo(within(l).getByRole('button', { name: 'Form 1-A' }));
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(within(l).getByRole('status')).toHaveTextContent('That was not the answer'));
      await waitFor(() => expect(within(l).getByRole('button', { name: 'Form 0' })).toHaveAttribute('aria-disabled', 'true'));
    });

    test('a refusal is said in the server\'s words, in the same region', async () => {
      width(false);
      const w = visited({ challenge: { kind: 'bribe', price: 50 } });
      openVisit(w);
      const l = await press(w);
      await userEvent.click(within(l).getByRole('button', { name: 'Pay 0.50 Aura' }));
      await waitFor(() => expect(within(l).getByRole('status')).toHaveTextContent('that costs 0.50, and your wallet holds 0.00'));
    });

    test('draws no try before its story is read, and none for a visit the story says has ended', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      /* The page was read while the visit was open; it filed before the Lens read its story. */
      let release!: () => void;
      const held = new Promise<void>((r) => { release = r; });
      const real = w.fake.visitStory.bind(w.fake);
      w.fake.visitStory = async (...a) => { await held; return real(...a); };
      openVisit(w);
      const mark = await visitMark(w.seq);
      w.fake.seed.visitEnd(w.visit, { outcome: 'filed', line: 'Filed.' });
      w.fake.seed.infraction(w.visit, { points: 2 });
      await userEvent.click(mark);
      const l = visitLens();
      expect(within(l).queryByRole('group')).toBeNull();
      expect(within(l).queryByRole('heading', { name: 'Talk it down' })).toBeNull();
      release();
      await within(l).findByRole('tab', { name: 'Filed' });
      expect(within(l).queryByRole('group')).toBeNull();
      expect(within(l).queryByRole('button', { name: /^Form/u })).toBeNull();
      expect(within(l).queryByRole('heading', { name: 'Talk it down' })).toBeNull();
    });

    test('a bribe is one button with its price, which ends the visit', async () => {
      width(false);
      const w = visited({ challenge: { kind: 'bribe', price: 50 } });
      w.fake.seed.wallet(w.me, 200);
      openVisit(w);
      const l = await press(w);
      expect(l).toHaveTextContent('The Clerk will go for a price, and the price goes nowhere. One try for Pipewrench.');
      await userEvent.click(within(l).getByRole('button', { name: 'Pay 0.50 Aura' }));
      await waitFor(() => expect(within(visitLens()).getByRole('tab', { name: 'Talked down' })).toBeInTheDocument());
      expect(within(visitLens()).getByRole('status')).toHaveTextContent('Pipewrench got past The Clerk.');
    });

    test('a distraction asks for no answer and no price: any card cast on the thread talks it down', async () => {
      width(false);
      const w = visited({ challenge: { kind: 'distraction' } });
      openVisit(w);
      const l = await press(w);
      expect(l).toHaveTextContent('The Clerk is not moved by an answer or a price. Any card cast on this thread talks it down.');
      expect(within(l).queryByRole('group')).toBeNull();
      expect(within(l).queryByRole('button', { name: /^Pay/u })).toBeNull();
    });

    test('a reader with no mask to try as is told where to pick one', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      w.fake.signInAs(w.fake.seed.account('lurker'));
      openVisit(w);
      const l = await press(w);
      expect(l).toHaveTextContent('Pick a mask in the HUD to try.');
    });

    test('offers no Appeal: there is nothing to appeal yet', async () => {
      width(false);
      const w = visited({ challenge: QUIZ, mine: true });
      openVisit(w);
      const l = await press(w);
      expect(within(l).queryByRole('button', { name: /^Appeal/u })).toBeNull();
    });
  });

  describe('once filed', () => {
    test('says what landed on whom and when it drops off, and "Filed" names the tab and the mark', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      file(w);
      openVisit(w);
      const mark = await visitMark(w.seq);
      expect(mark).toHaveTextContent('Filed');
      await userEvent.click(mark);
      const l = visitLens();
      expect(within(l).getByRole('tab', { name: 'Filed' })).toHaveAttribute('aria-selected', 'true');
      expect(within(l).getByRole('heading', { name: 'The Clerk filed their report' })).toBeInTheDocument();
      await waitFor(() => expect(l).toHaveTextContent(/Rule 2: No double posting: a minor breach\. Spritey's warn bar gained 2 points; they drop off on [A-Z][a-z]{2} \d{1,2}\. The bar now stands at 2 of 10\. The post keeps its words under the notice\./u));
      /* Nothing to talk down any more. */
      expect(within(l).queryByRole('heading', { name: 'Talk it down' })).toBeNull();
    });

    test('the bar now is read with the story: a stale page value never appears, and an expired infraction shows none', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      file(w);
      openVisit(w);
      const mark = await visitMark(w.seq);
      /* The page was read with the bar at 2; another visit filed before the Lens opened, so the bar stands at 6. */
      const other = w.fake.seed.visit(w.clerk, w.third, { at: w.fake.clock.now() });
      w.fake.seed.visitEnd(other, { outcome: 'filed', line: 'Filed.' });
      w.fake.seed.infraction(other, { points: 4, band: 'moderate' });
      await userEvent.click(mark);
      const l = visitLens();
      await within(l).findByText(/The bar now stands at 6 of 10\./u);
      expect(l).not.toHaveTextContent(/2 of 10/u);
    });

    test('an expired infraction says what it did and shows no bar', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      w.fake.seed.visitEnd(w.visit, { outcome: 'filed', line: 'Filed.' });
      w.fake.seed.infraction(w.visit, { points: 2, at: w.fake.clock.now() - 30 * 24 * HOUR, expiresAt: w.fake.clock.now() - 16 * 24 * HOUR });
      openVisit(w);
      const l = await press(w);
      await within(l).findByText(/they dropped off on/u);
      expect(l).not.toHaveTextContent(/of 10/u);
    });

    test('a filing whose infraction cannot be read says only that the visit filed, with no number', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      w.fake.seed.visitEnd(w.visit, { outcome: 'filed', line: 'Filed.' });
      openVisit(w);
      const l = await press(w);
      expect(l).toHaveTextContent('The Clerk filed their report');
      expect(l).toHaveTextContent('The visit filed.');
      expect(l).not.toHaveTextContent(/\d+ (warn )?points?/u);
      expect(l).not.toHaveTextContent(/of 10/u);
    });

    test('Appeal, with its price and terms, is the author\'s current mask\'s alone, and opens the form', async () => {
      width(false);
      const w = visited({ challenge: QUIZ, mine: true });
      const inf = file(w);
      openVisit(w);
      const l = await press(w);
      const appeal = await within(l).findByRole('button', { name: 'Appeal · 0.50 Aura' });
      expect(l).toHaveTextContent('The Clerk hears it, or whoever has taken their place. It is refunded if overturned. It may be upheld, reduced, or increased by up to 2 warn points. One appeal per filing, and your plea is public.');
      appeal.focus();
      await userEvent.keyboard('{Enter}');
      /* The post provides AppealCtx (Task 13): the same panel moves to the Appeal form, whose tab takes the focus. */
      const form = await screen.findByRole('dialog', { name: 'Appeal on this post' });
      expect(within(form).getByRole('tab', { name: 'Appeal' })).toHaveFocus();
      expect(within(form).getByRole('form', { name: 'Appeal' })).toBeInTheDocument();
      void inf;
    });

    test('another player\'s reader sees the state and no Appeal', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      file(w);
      openVisit(w);
      const l = await press(w);
      await within(l).findByText(/gained 2 points/u);
      expect(within(l).queryByRole('button', { name: /^Appeal/u })).toBeNull();
    });

    test('the author\'s own other mask sees no Appeal either: it is the current mask\'s', async () => {
      width(false);
      const w = visited({ challenge: QUIZ, mine: true });
      file(w);
      const other = w.fake.seed.character(w.me, 'Second Mask', 'face');
      /* The HUD's character is changed on this device, as the picker does. */
      localStorage.setItem(`kb-hud:${w.me}`, other);
      openVisit(w);
      await userEvent.click(await visitMark(w.seq));
      const l = visitLens();
      await within(l).findByText(/gained 2 points/u);
      expect(within(l).queryByRole('button', { name: /^Appeal/u })).toBeNull();
    });

    test('an appeal waiting says so and offers no second one; a ruling is said', async () => {
      width(false);
      const w = visited({ challenge: QUIZ, mine: true });
      const inf = file(w);
      const appeal = w.fake.seed.appeal(w.pipe, inf, 'I was posting a changelog.');
      openVisit(w);
      let l = await press(w);
      await within(l).findByText(/An appeal of it is waiting to be heard\. If it cannot be heard, the fee is refunded\./u);
      expect(within(l).queryByRole('button', { name: /^Appeal/u })).toBeNull();
      await userEvent.click(await visitMark(w.seq));
      w.fake.seed.ruling(appeal, w.clerk, 'overturned', { line: 'Fine. Fine!' });
      await userEvent.click(await visitMark(w.seq));
      l = visitLens();
      await within(l).findByText(/The Clerk heard an appeal of it and overturned it, so the points are gone\./u);
    });

    test('points that have dropped off are not appealed', async () => {
      width(false);
      const w = visited({ challenge: QUIZ, mine: true });
      w.fake.seed.visitEnd(w.visit, { outcome: 'filed', line: 'Filed.' });
      w.fake.seed.infraction(w.visit, { points: 2, at: w.fake.clock.now() - 30 * 24 * HOUR, expiresAt: w.fake.clock.now() - 16 * 24 * HOUR });
      openVisit(w);
      const l = await press(w);
      await within(l).findByText(/they dropped off on/u);
      expect(within(l).queryByRole('button', { name: /^Appeal/u })).toBeNull();
    });
  });

  describe('when it ended another way', () => {
    test('talked down, it says who and that nothing landed', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      const attempt = w.fake.seed.report(w.gloomba, w.second, 'unused');
      w.fake.seed.visitEnd(w.visit, { outcome: 'intercepted', by: attempt, line: 'Gloomba got past The Clerk\'s quiz.' });
      openVisit(w);
      const l = await press(w);
      expect(within(l).getByRole('tab', { name: 'Talked down' })).toHaveAttribute('aria-selected', 'true');
      expect(within(l).getByRole('heading', { name: 'The Clerk was talked down' })).toBeInTheDocument();
      expect(l).toHaveTextContent(/Nothing landed on Spritey\./u);
      expect(within(l).queryByRole('heading', { name: 'Talk it down' })).toBeNull();
    });

    test('dropped, it says it could not be filed and that nothing landed', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      w.fake.seed.visitEnd(w.visit, { outcome: 'dropped', line: 'This visit could not be filed and was dropped.' });
      openVisit(w);
      const l = await press(w);
      expect(within(l).getByRole('tab', { name: 'Dropped' })).toHaveAttribute('aria-selected', 'true');
      expect(within(l).getByRole('heading', { name: 'The Clerk could not be filed and was dropped' })).toBeInTheDocument();
      expect(l).toHaveTextContent(/The visit could not be filed and was dropped on .*Nothing landed on Spritey\./u);
      /* The words about the visit send nobody to an admin; the post's own Report to admins link, at the foot of every Lens (the conduct plan), is not the visit's words. */
      expect((l.textContent ?? '').replace('Report to admins', '')).not.toMatch(/admin/u);
    });

    test('trapped, it says a trap on the post ended it', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      w.fake.seed.visitEnd(w.visit, { outcome: 'trapped', line: 'A trap set on this post sprang as the visit began, and the visit ended.' });
      openVisit(w);
      const l = await press(w);
      expect(within(l).getByRole('tab', { name: 'Trapped' })).toBeInTheDocument();
      expect(l).toHaveTextContent(/A trap set on this post sprang when the visit began/u);
      expect(l).toHaveTextContent(/Nothing landed on Spritey\./u);
    });
  });

  describe('how it went', () => {
    test('is a fold of Lens rows, each the Act with React and Spin thread, the Mod\'s words quoted and its role named', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      /* Dated by the real clock, as the visit is: the rows are in the order the Acts happened. */
      const report = w.fake.seed.report(w.gloomba, w.second, 'Third time this week.', { at: w.fake.clock.now() - 2 * 60_000 });
      w.fake.seed.verdict(report, w.clerk, 'visit', { line: 'Noted. Inspecting.', visit: w.visit, at: w.fake.clock.now() - 60_000 });
      w.fake.seed.visitEnd(w.visit, { outcome: 'filed', line: 'Stamped, initialed, and filed under D.', at: w.fake.clock.now() + 60_000 });
      w.fake.seed.infraction(w.visit, { points: 2 });
      openVisit(w);
      const l = await press(w);
      const fold = await within(l).findByRole('button', { name: /^How it went · 4 acts$/u });
      expect(fold).toHaveAttribute('aria-expanded', 'false');
      fold.focus();
      await userEvent.keyboard('{Enter}');
      expect(fold).toHaveAttribute('aria-expanded', 'true');
      const rows = [...l.querySelectorAll<HTMLElement>('.kb-lens-row')];
      expect(rows).toHaveLength(4);
      expect(rows[0]).toHaveTextContent('Gloomba · reported this post');
      expect(rows[0]).toHaveTextContent('“Third time this week.”');
      expect(rows[1]).toHaveTextContent('The Clerk · A Moderator · judged the report: they sent a visit');
      expect(rows[1]).toHaveTextContent('“Noted. Inspecting.”');
      expect(rows[2]).toHaveTextContent('began the visit');
      expect(rows[2]).toHaveTextContent('“Routine inspection.”');
      expect(rows[3]).toHaveTextContent('The Clerk · A Moderator · filed');
      expect(rows[3]).toHaveTextContent('“Stamped, initialed, and filed under D.”');
      for (const r of rows) {
        expect(within(r).getByRole('button', { name: 'Spin thread' })).toBeInTheDocument();
        expect(within(r).getByRole('button', { name: /React/u })).toBeInTheDocument();
      }
    });

    test('a quiz attempt is a row naming the answer, and Spin thread closes the Lens and opens the post\'s spin form for it', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      openVisit(w);
      const l = await press(w);
      await tabTo(within(l).getByRole('button', { name: 'Form 1-A' }));
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(within(l).getByRole('status')).toHaveTextContent('That was not the answer'));
      const fold = await within(l).findByRole('button', { name: /^How it went · 2 acts$/u });
      await userEvent.click(fold);
      const row = [...l.querySelectorAll<HTMLElement>('.kb-lens-row')].find((r) => r.textContent!.includes('tried the quiz'))!;
      expect(row).toHaveTextContent('Pipewrench · tried the quiz and was wrong');
      expect(row).toHaveTextContent('“Form 1-A”');
      await userEvent.click(within(row).getByRole('button', { name: 'Spin thread' }));
      expect(screen.queryByRole('dialog', { name: /^Visit/u })).toBeNull();
      expect(document.getElementById(`spin-${w.second}`)!.children.length).toBeGreaterThan(0);
    });
  });

  describe('accessibility', () => {
    test.each(['open quiz', 'open bribe', 'open distraction', 'filed'] as const)('axe passes on the Lens with the %s tab open', async (which) => {
      width(false);
      const w = visited({ mine: which === 'filed', challenge: which === 'open bribe' ? { kind: 'bribe', price: 50 } : which === 'open distraction' ? { kind: 'distraction' } : QUIZ });
      if (which === 'filed') file(w);
      openVisit(w);
      const l = await press(w);
      if (which === 'filed') await within(l).findByRole('button', { name: /^Appeal/u });
      await userEvent.click(await within(l).findByRole('button', { name: /^How it went/u }));
      const v = await axeViolations(l);
      expect(v, describeViolations(v)).toEqual([]);
    });

    test('every control in the tab is a button, a link or a tab: the challenge has no timer and no pointer-only control', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      openVisit(w);
      const l = await press(w);
      await within(l).findByRole('button', { name: /^How it went/u });
      for (const el of l.querySelectorAll<HTMLElement>('[onclick], [role="button"]')) expect(el.tagName, el.outerHTML).toBe('BUTTON');
      expect(l.querySelector('progress, [role="timer"], [role="progressbar"]')).toBeNull();
    });
  });
});

/*
 * The Lens's frame, tabs and buttons (backfill-boards plan, Task 10; boards 28 and 29): the open tab filled in the card's ink and the others
 * outlined, one row of tabs that scrolls with the open one kept in view and a fade where more wait, a foot that fades only while more lies
 * below, and a play's actions as one grid. What a browser measures (the dock, the sheet, the last control above the HUD) is
 * e2e/lens-frame.spec.ts's.
 */
/** The rule a selector opens in lens.css, its body, with comments gone. */
const ruleOf = (selector: string): string => {
  const css = lensCss.replace(/\/\*[\s\S]*?\*\//gu, '');
  const at = css.split('\n').findIndex((l) => l.trim() === `${selector} {`);
  if (at < 0) throw new Error(`lens.css has no rule ${selector}`);
  const rest = css.split('\n').slice(at + 1);
  return rest.slice(0, rest.findIndex((l) => l.trim() === '}')).join('\n');
};

describe('the tabs', () => {
  test('the open tab is filled in the card\'s ink and the others are outlined, never the other way round', () => {
    const filled = ruleOf('.kb-lens-tab[aria-selected="true"]');
    expect(filled).toMatch(/background:\s*var\(--kb-lens-ink\)/u);
    expect(filled).toMatch(/color:\s*var\(--kb-glass-ink-neon\)/u);
    const rest = ruleOf('.kb-lens-tab');
    expect(rest).toMatch(/background:\s*transparent/u);
    expect(rest).toMatch(/border:\s*1px solid/u);
  });

  test('the open tab says it is open, the other does not, and it moves with the choice', async () => {
    width(false);
    const w = world();
    w.play('k1'); w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    expect(tab('Card 2')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Card 1')).toHaveAttribute('aria-selected', 'false');
    await userEvent.click(tab('Card 1'));
    expect(tab('Card 1')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Card 2')).toHaveAttribute('aria-selected', 'false');
  });

  test('the open tab is scrolled into view when the Lens opens and when another tab is chosen', async () => {
    width(false);
    const w = world();
    w.play('k1'); w.play('k2');
    open(w);
    const into = vi.mocked(Element.prototype.scrollIntoView);
    await userEvent.click(await markOf(2, 'Card 2'));
    expect(into.mock.instances).toContain(tab('Card 2'));
    expect(into).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'center' });
    into.mockClear();
    await userEvent.click(tab('Card 1'));
    expect(into.mock.instances).toEqual([tab('Card 1')]);
  });

  test('the strip says where more wait: none while they all fit, then at the end, at both ends, at the start', async () => {
    expect(fadeOf({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400 })).toBe('none');
    expect(fadeOf({ scrollLeft: 0, clientWidth: 330, scrollWidth: 700 })).toBe('end');
    expect(fadeOf({ scrollLeft: 120, clientWidth: 330, scrollWidth: 700 })).toBe('both');
    expect(fadeOf({ scrollLeft: 370, clientWidth: 330, scrollWidth: 700 })).toBe('start');
    width(false);
    const w = world();
    w.play('k1'); w.play('k2'); w.play('k3');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    const row = within(lens()).getByRole('tablist');
    const strip = row.parentElement!;
    /* A scroller jsdom does not lay out: its measures are given, and a scroll event reads them. */
    Object.defineProperty(row, 'clientWidth', { configurable: true, value: 330 });
    Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 700 });
    row.scrollLeft = 0;
    fireEvent.scroll(row);
    expect(strip).toHaveAttribute('data-kb-fade', 'end');
    row.scrollLeft = 150;
    fireEvent.scroll(row);
    expect(strip).toHaveAttribute('data-kb-fade', 'both');
  });
});

describe('the foot', () => {
  test('it fades only while scrollTop + clientHeight < scrollHeight', async () => {
    expect(moreBelow({ scrollTop: 0, clientHeight: 500, scrollHeight: 900 })).toBe(true);
    expect(moreBelow({ scrollTop: 399, clientHeight: 500, scrollHeight: 900 })).toBe(true);
    expect(moreBelow({ scrollTop: 400, clientHeight: 500, scrollHeight: 900 })).toBe(false);
    expect(moreBelow({ scrollTop: 0, clientHeight: 500, scrollHeight: 500 })).toBe(false);
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    const body = within(lens()).getByRole('tabpanel');
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 900 });
    body.scrollTop = 0;
    fireEvent.scroll(body);
    expect(lens()).toHaveAttribute('data-kb-more', 'true');
    body.scrollTop = 400;
    fireEvent.scroll(body);
    expect(lens()).toHaveAttribute('data-kb-more', 'false');
    expect(lens().querySelector('.kb-lens-fade')).not.toBeNull();
  });

  test('the fade follows the body\'s content: a row added after the Lens opened makes it more, without a scroll', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    const body = within(lens()).getByRole('tabpanel');
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 500, writable: true });
    fireEvent.scroll(body);
    expect(lens()).toHaveAttribute('data-kb-more', 'false');
    /* A live play adds a row; the body is taller, and nothing scrolled. */
    (body as unknown as { scrollHeight: number }).scrollHeight = 900;
    await act(async () => { body.append(document.createElement('div')); });
    await waitFor(() => expect(lens()).toHaveAttribute('data-kb-more', 'true'));
  });

  test('the fade is shown by the panel\'s own state and takes no pointer', () => {
    expect(ruleOf('.kb-lens-fade')).toMatch(/display:\s*none/u);
    expect(ruleOf('.kb-lens-fade')).toMatch(/pointer-events:\s*none/u);
    expect(ruleOf(".kb-lens[data-kb-more='true'] > .kb-lens-fade")).toMatch(/display:\s*block/u);
  });
});

describe('the post the Lens keeps whole', () => {
  test('a Lens opened from an Origin keeps the whole origin in view, as it does an article', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    const mark = await markOf(2, 'Card 2');
    /* The mark's nearest origin: the element that is measured to be kept beside the Lens. */
    const origin = mark.parentElement!;
    origin.classList.add('kb-origin');
    const measured = vi.spyOn(origin, 'getBoundingClientRect');
    await userEvent.click(mark);
    await act(async () => {});
    expect(measured, 'the origin is the post kept in view').toHaveBeenCalled();
  });
});

describe('the buttons, odd and even', () => {
  test('a foot with an odd number of tiles lets its last one span both columns, and an even one lets none', async () => {
    width(false);
    const w = world();
    w.play('k2', w.spritey);
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    const foot = lens().querySelector<HTMLElement>('.kb-lens-row-foot')!;
    const tiles = () => [...foot.querySelectorAll<HTMLElement>('.kb-react-button, .kb-kit-tile')];
    const spans = () => tiles().filter((t) => t.hasAttribute('data-kb-span'));
    expect(tiles()).toHaveLength(4);
    expect(spans()).toHaveLength(0);
    /* One tile gone (a card with no moment to look at): three are left, and the last stands across the row. */
    await act(async () => { foot.querySelector('.kb-lens-actions > .kb-kit-tile:nth-child(2)')!.remove(); });
    expect(tiles()).toHaveLength(3);
    await waitFor(() => expect(spans()).toEqual([tiles()[2]]));
    expect(ruleOf(".kb-lens-row-foot [data-kb-span]")).toMatch(/grid-column:\s*1\s*\/\s*-1/u);
  });
});

describe('the buttons', () => {
  test('a play\'s four actions are one grid of two by two, React, Spin thread, As it landed, Go to post, every one a tile', async () => {
    width(false);
    const w = world();
    w.play('k2', w.spritey);
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    const foot = lens().querySelector<HTMLElement>('.kb-lens-row-foot')!;
    const tiles = [...foot.querySelectorAll<HTMLElement>('.kb-react-button, .kb-kit-tile')];
    expect(tiles.map((t) => t.textContent?.trim())).toEqual(['+ React', 'Spin thread', 'As it landed', 'Go to post']);
    const grid = ruleOf('.kb-lens-row-foot');
    expect(grid).toMatch(/display:\s*grid/u);
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/u);
    /* The wrappers around the tiles take no box, so each tile is a cell of the grid. */
    expect(ruleOf('.kb-lens-row-foot .kb-reactions')).toMatch(/display:\s*contents/u);
    expect(ruleOf('.kb-lens-actions')).toMatch(/display:\s*contents/u);
    /* The React meta tile (36px) stands as tall as the kit tiles (44px), and the reaction tiles keep a line of their own over the grid. */
    expect(ruleOf('.kb-lens-row-foot .kb-react-button')).toMatch(/min-height:\s*44px/u);
    expect(ruleOf('.kb-lens-row-foot .kb-reaction-list')).toMatch(/grid-column:\s*1\s*\/\s*-1/u);
  });
});

/* A play whose first generation failed was refunded and is over (0149): the Lens says so in plain words and offers an admin no End this card, since there is nothing to end. */
describe('a play that did not take', () => {
  const writing = { ...instance.cards[1]!, key: 'kw', name: 'Card W', stack: 3, writes: { tokens: () => 40, frame: () => ({ prompt: '', stop: [] as string[] }) } };
  const own = { ...instance, cards: [...instance.cards, writing] };
  const ui = [...cards, cardUi('kw')];
  function writingWorld() {
    const fake = buildWorld(undefined, own);
    const me = fake.seed.account('me');
    const other = fake.seed.account('other');
    fake.seed.character(me, 'Pipewrench', 'heel');
    const spritey = fake.seed.character(other, 'Spritey', 'face');
    const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
    const second = fake.seed.post(thread, spritey, 'post 2');
    fake.signInAs(me);
    const play = () => { fake.clock.advance(60_000); return fake.seed.card(spritey, second, 'kw', { message: '' }); };
    return { fake, me, thread, second, play };
  }
  const drawn = (w: { fake: Fake; thread: Id }) => renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance: own, cards: ui });
  const openW = async () => { await userEvent.click(await within(await article(2)).findByRole('button', { name: /^Card W, \d plays?/u })); await userEvent.click(whoButton()); };
  const row = (id: Id) => lens().querySelector<HTMLElement>(`[data-kb-play="${id}"]`)!;

  test('reads "Didn\'t take" as the state and in its row, says its text never arrived, and offers an admin no End this card, while a live play beside it does', async () => {
    width(false);
    const w = writingWorld();
    w.fake.seed.admin(w.me);
    const live = w.play();
    const lost = w.play();
    w.fake.seed.text(lost, w.second, { failed: true }, { quiet: true });
    drawn(w);
    await openW();
    expect(within(row(lost)).getByText("Didn't take. Its text never arrived, so it is not in effect on this post.")).toBeInTheDocument();
    expect(within(row(lost)).queryByRole('button', { name: 'End this card' })).toBeNull();
    expect(within(row(live)).getByRole('button', { name: 'End this card' })).toBeInTheDocument();
    expect(within(row(live)).queryByText(/Didn't take/u)).toBeNull();
    /* It stays an Act the room can react to. */
    expect(within(row(lost)).getByRole('button', { name: /react/iu })).toBeInTheDocument();
    /* Nothing says an admin did anything (the Report to admins button at the foot is a button, and says nothing of this play). */
    expect(within(lens()).queryByText(/admin/iu, { ignore: 'button' })).toBeNull();
  });

  test('its effect is not drawn: the card\'s effect is given the plays that took alone', async () => {
    width(false);
    const w = writingWorld();
    const lost = w.play();
    w.play();
    w.fake.seed.text(lost, w.second, { failed: true }, { quiet: true });
    const Count = ({ plays, children }: EffectProps) => <><span data-testid="effect-plays">{plays.length}</span>{children}</>;
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance: own, cards: [...cards, cardUi('kw', { Effect: Count })] });
    expect((await screen.findByTestId('effect-plays')).textContent).toBe('1');
  });

  test('a kind whose plays all did not take reads "Didn\'t take" as its state', async () => {
    width(false);
    const w = writingWorld();
    w.fake.seed.admin(w.me);
    const lost = w.play();
    w.fake.seed.text(lost, w.second, { failed: true }, { quiet: true });
    drawn(w);
    await userEvent.click(await within(await article(2)).findByRole('button', { name: /^Card W, 1 play/u }));
    expect(within(lens()).getByText("Didn't take", { selector: '.kb-lens-line' })).toBeInTheDocument();
    await userEvent.click(whoButton());
    expect(within(lens()).queryByRole('button', { name: 'End this card' })).toBeNull();
  });
});

describe('taking a back back', () => {
  const takeButton = () => within(lens()).queryByRole('button', { name: 'Take back' });
  const openBack = async (seq: number) => {
    await userEvent.click(await within(await article(seq)).findByRole('button', { name: /^A card set face down/u }));
    await userEvent.click(whoButton());
  };
  const mine = () => {
    const w = world();
    const post = w.fake.seed.post(w.thread, w.pipe, 'my own post');
    w.fake.clock.advance(60_000);
    w.fake.seed.set(w.pipe, post, 'k2', { at: w.fake.clock.now() });
    return w;
  };

  test('is offered on the setter\'s own live back, with its words, and nowhere else', async () => {
    width(false);
    const w = mine();
    w.fake.clock.advance(60_000);
    w.fake.seed.set(w.spritey, w.second, 'k3', { at: w.fake.clock.now() });
    open(w);
    await openBack(4);
    expect(takeButton()).not.toBeNull();
    expect(within(lens()).getByText('Take this card back into your hand. The card back leaves the post.')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await openBack(2);
    expect(takeButton()).toBeNull();
  });

  test('follows the end the server stored: a back set ten days ago whose end is twenty days off is live, can be taken back and says when it ends', async () => {
    width(false);
    const w = world();
    const post = w.fake.seed.post(w.thread, w.pipe, 'my own post');
    /* The screen's setLasts is seven days: ten days on, a back worked out from it would be over. */
    w.fake.seed.set(w.pipe, post, 'k2', { at: w.fake.clock.now() - 10 * 86_400_000, endsAt: w.fake.clock.now() + 20 * 86_400_000 });
    const [set] = await w.fake.cardsOn(post, 10);
    open(w);
    await openBack(4);
    expect(takeButton()).not.toBeNull();
    expect(lens().querySelector('.kb-lens-ends')!.textContent).toBe(`${endsWords(set!.endsAt!)}, unless it springs first.`);
  });

  test('a back whose stored end has passed is gone and cannot be taken back, though the setting would still give it days', async () => {
    width(false);
    const w = world();
    const post = w.fake.seed.post(w.thread, w.pipe, 'my own post');
    w.fake.seed.set(w.pipe, post, 'k2', { at: w.fake.clock.now() - 86_400_000, endsAt: w.fake.clock.now() - 3_600_000 });
    open(w);
    await article(4);
    expect(within(await article(4)).queryByRole('button', { name: /^A card set face down/u })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Take back' })).toBeNull();
  });

  test('calls takeBack with the setter\'s character and the back, and closes the Lens once it is back', async () => {
    width(false);
    const w = mine();
    const call = vi.spyOn(w.fake, 'takeBack');
    open(w);
    await openBack(4);
    await userEvent.click(takeButton()!);
    expect(call).toHaveBeenCalledWith(w.pipe, expect.any(String));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cards on this post' })).toBeNull());
    /* The mark is gone with the back: focus goes to the post, not to the page's body. */
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('post-4')));
  });

  test('says the refusal in plain words, and stays open', async () => {
    width(false);
    const w = mine();
    vi.spyOn(w.fake, 'takeBack').mockResolvedValue({ ok: false, error: 'there is no face-down card to take back there' } as never);
    open(w);
    await openBack(4);
    await userEvent.click(takeButton()!);
    expect(await within(lens()).findByRole('alert')).toHaveTextContent('There is no face-down card to take back there.');
  });
});

/**
 * A surface play's tab (docs/plans/2026-11-11-graffiti-design.md, sections 3 and 8): below the play's own Who row, one row for each live draw and wash, oldest first, with who, when, what the card names of the
 * draw and the share of the surface it still owns; and one line for the older draws that left the live list. The words are the card's, and the engine's own where it gives none.
 */
describe('a surface play\'s tab', () => {
  const stroke = (y: number, width: number) => ({ width, aspect: 1, points: [[0, y], [1, y]] as [number, number][] });
  const check = (input: unknown) => (typeof input === 'object' && input !== null && Array.isArray((input as { strokes?: unknown }).strokes)
    ? ok({ strokes: (input as { strokes: never[] }).strokes, payload: { strokes: (input as { strokes: unknown[] }).strokes, colors: (input as { colors?: unknown }).colors } }) : refuse('strokes'));
  const slab = { ...testInstance.cards[0]!, key: 'slab', name: 'Slab', stack: 1, reaches: ['post' as const], surface: { limitKey: 'slab.limit', mostLive: 48, validateDraw: check, validateWash: check } } as unknown as CardRules;
  const surfaced = { ...testInstance, cards: [slab], settings: { ...testInstance.settings, cardSettings: { 'slab.limit': 40 } } };
  const slabUi = (extra: Partial<CardUi> = {}) => [cardUi('slab', { describeDraw: (p) => (typeof p.colors === 'string' ? p.colors : ''), logDraw: { verb: 'tagged', noun: 'tag', nouns: 'tags', surface: 'the wall' }, ...extra })];

  /* Spritey wrote post 2; Gloomba played the slab on it; the reader (Pipewrench) is a third party. */
  async function wall(oldOnes = 0) {
    const fake = buildWorld(undefined, surfaced);
    const me = fake.seed.account('me'); const other = fake.seed.account('other'); const third = fake.seed.account('third');
    fake.seed.character(me, 'Pipewrench', 'heel');
    const spritey = fake.seed.character(other, 'Spritey', 'face');
    const gloomba = fake.seed.character(third, 'Gloomba', 'heel');
    const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
    const post = fake.seed.post(thread, spritey, 'post 2');
    fake.clock.advance(60_000);
    const play = fake.seed.card(gloomba, post, 'slab', { message: 'a wall' });
    const as = async (account: Id, run: () => Promise<unknown>) => { fake.signInAs(account); fake.clock.advance(60_000); const a = await run() as { ok: boolean }; expect(a.ok).toBe(true); };
    /* Old tags, painted over wholly by the next one at the same cells. */
    for (let i = 0; i < oldOnes; i++) await as(third, () => fake.draw(play, gloomba, { strokes: [stroke(0.8, 0.02)], colors: 'black' }));
    await as(other, () => fake.draw(play, spritey, { strokes: [stroke(0.8, 0.06)], colors: 'white' }));
    await as(third, () => fake.draw(play, gloomba, { strokes: [stroke(0.2, 0.06)], colors: 'pink and lime' }));
    await as(other, () => fake.wash(play, spritey, { strokes: [stroke(0.8, 0.02)] }));
    fake.signInAs(me);
    return { fake, thread, play };
  }
  const openSlab = async (w: { fake: Fake; thread: Id }, ui: readonly CardUi[] = slabUi()) => {
    width(false);
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance: surfaced, cards: ui });
    await userEvent.click(await within(await article(2)).findByRole('button', { name: /^Slab, 1 play/u }));
    return lens();
  };
  const draws = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>('[data-kb-surface-act]')];
  const said = (el: HTMLElement) => el.querySelector('.kb-lens-by')!.textContent!.replace(/\s+/g, ' ').trim();

  test('lists each live draw and wash oldest first, with who, what the card names and the share of the wall each draw still owns', async () => {
    const box = await openSlab(await wall());
    await waitFor(() => expect(draws(box)).toHaveLength(3));
    const [white, pink, washed] = draws(box).map(said);
    /* Spritey's white tag covered 600 cells and the wash took 200 back: 400 are still its own. Gloomba's pink tag owns its 600. */
    expect(white).toMatch(/^Spritey · .+ · white · 4% of the wall$/u);
    expect(pink).toMatch(/^Gloomba · .+ · pink and lime · 6% of the wall$/u);
    expect(washed).toMatch(/^Spritey · .+ · washed$/u);
    expect(draws(box).map((r) => r.getAttribute('data-kb-surface-act'))).toHaveLength(3);
    expect(within(box).getByRole('list', { name: 'Drawn and washed' })).toBeInTheDocument();
    expect(box.querySelectorAll('[data-kb-surface-act] time')).toHaveLength(3);
  });
  test('sits below the Who row, which is still the play\'s own', async () => {
    const box = await openSlab(await wall());
    await waitFor(() => expect(draws(box)).toHaveLength(3));
    const who = whoButton();
    expect(who.compareDocumentPosition(draws(box)[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(rows()).toHaveLength(0);
    await userEvent.click(who);
    expect(rows()).toHaveLength(1);
    expect(draws(box)).toHaveLength(3);
  });
  test('says how many older draws are no longer live, in the card\'s words', async () => {
    const box = await openSlab(await wall(2));
    await waitFor(() => expect(draws(box)).toHaveLength(3));
    expect(within(box).getByText('and 2 older tags, washed or painted over')).toBeInTheDocument();
  });
  test('says one older draw in the singular, and nothing where none left the list', async () => {
    const one = await openSlab(await wall(1));
    await waitFor(() => expect(draws(one)).toHaveLength(3));
    expect(within(one).getByText('and 1 older tag, washed or painted over')).toBeInTheDocument();
  });
  test('adds no older line where every draw is live', async () => {
    const box = await openSlab(await wall(0));
    await waitFor(() => expect(draws(box)).toHaveLength(3));
    expect(box.textContent).not.toMatch(/older/u);
  });
  test('the engine\'s own words stand where the card gives none, and name no card\'s', async () => {
    const box = await openSlab(await wall(2), [cardUi('slab')]);
    await waitFor(() => expect(draws(box)).toHaveLength(3));
    expect(draws(box).map(said).map((t) => t.replace(/^(\w+) · .+? · /u, '$1 · '))).toEqual(['Spritey · 4% of the surface', 'Gloomba · 6% of the surface', 'Spritey · washed']);
    expect(within(box).getByText('and 2 older drawings, washed or painted over')).toBeInTheDocument();
  });
  test('a tab of a card with no surface has no such rows', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    expect(lens().querySelectorAll('[data-kb-surface-act]')).toHaveLength(0);
    expect(within(lens()).queryByRole('list', { name: 'Drawn and washed' })).toBeNull();
  });
  test('names no owner and no class: only the characters the Acts name', async () => {
    const box = await openSlab(await wall());
    await waitFor(() => expect(draws(box)).toHaveLength(3));
    expect(draws(box).map(said).join(' ')).not.toMatch(/heel|face|owner|player|Pipewrench/u);
  });
});

/*
 * The discipline cards' Lens (card notes, part 5, Task 7): what a heart took off, what an Unban ended, a fall waiting and a fall spent, and a watch, in the engine's own plain
 * words under the card's status heading. The cards are the engine's own test cards, found by their rules; the heading is the card's own (`status`), given the live plays.
 */
describe('the discipline cards\' Lens', () => {
  const DAY = 86_400_000;
  const mk = (key: string, name: string, reaches: ('post' | 'character')[], discipline: NonNullable<CardRules['discipline']>, extra: Partial<CardRules> = {}): CardRules => ({
    key, name, alignment: 'sweet', rarity: 'uncommon', reaches, discipline, ...extra,
    playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}),
    canApply: (t, e, _config, now) => landsOn({ key, reaches, discipline }, t, e, now),
  });
  const shop = {
    ...instance,
    cards: [
      mk('t-heart', 'T Heart', ['character'], { kind: 'relief', points: 'lightestBand' }),
      mk('t-super', 'T Super', ['character'], { kind: 'relief', points: 'all' }),
      mk('t-ultra', 'T Ultra', ['character'], { kind: 'unban' }),
      mk('t-fall', 'T Fall', ['post'], { kind: 'fall' }),
      mk('t-watch', 'T Watch', ['character'], { kind: 'watch', weight: 2 }, { lasts: { unit: 'day', count: 7 } }),
      mk('t-watch3', 'T Watch Three', ['character'], { kind: 'watch', weight: 3 }, { lasts: { unit: 'day', count: 7 } }),
    ],
  };
  /* The headings the Divided World faces give, as the instance's: the fall's is a function of the live plays on the post. */
  const faces: CardUi[] = [
    cardUi('t-heart', { status: 'Took points off' }), cardUi('t-super', { status: 'Emptied a warn bar' }), cardUi('t-ultra', { status: 'Ended a ban' }),
    cardUi('t-fall', { status: (plays) => (plays.length > 0 ? 'Waiting to take the fall' : 'Took the fall') }),
    cardUi('t-watch', { status: 'Told on' }), cardUi('t-watch3', { status: 'Told on a lot' }),
  ];
  function disciplined() {
    const fake = buildWorld(undefined, shop);
    const me = fake.seed.account('me');
    const other = fake.seed.account('other');
    const third = fake.seed.account('third');
    const boss = fake.seed.account('boss', { admin: true });
    const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
    const spritey = fake.seed.character(other, 'Spritey', 'face');
    const gloomba = fake.seed.character(third, 'Gloomba', 'heel');
    const clerk = fake.seed.staff('clerk', 'The Clerk', 'mod', { pronouns: PRONOUN_PRESETS.they });
    const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
    const second = fake.seed.post(thread, spritey, 'post 2');
    fake.seed.wallet(third, 500);
    fake.seed.wallet(me, 500);
    fake.seed.cards(third, { 't-heart': 3, 't-super': 3, 't-ultra': 3, 't-fall': 3, 't-watch': 3, 't-watch3': 3 });
    fake.seed.cards(me, { 't-fall': 3 });
    /* A filing on Spritey's post 2, `ago` ago, as the tick writes it (the Clerk's visit, then its infraction); a fall waiting on the post takes it. */
    const filed = (points: number, ago: number, post = second) => fake.seed.infraction(fake.seed.visit(clerk, post, { at: fake.clock.now() - ago }), { points, at: fake.clock.now() - ago });
    const as = async <T,>(account: Id, run: () => Promise<T>): Promise<T> => { fake.signInAs(account); const out = await run(); fake.signInAs(me); return out; };
    const play = async (account: Id, card: string, by: Id, target: Id, on: 'post' | 'character' = 'character') => {
      fake.clock.advance(60_000);
      const answer = await as(account, () => (on === 'post' ? fake.playCard(card, by, target, {}, '') : fake.playCard(card, by, target, {}, '', 'character', second)));
      if (!answer.ok) throw new Error(`the play was refused: ${answer.error}`);
      return answer.value;
    };
    fake.signInAs(me);
    return { fake, me, other, third, boss, pipe, spritey, gloomba, clerk, thread, second, filed, as, play };
  }
  type W = ReturnType<typeof disciplined>;
  const openIt = (w: W) => renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance: shop, cards: faces, copy: { modRole: 'A Moderator' } });
  const markNamed = async (seq: number, name: string) => within(await article(seq)).findByRole('button', { name: new RegExp(`^${name}, \\d plays?`, 'u') });
  /** Opens the card's Lens and unfolds Who; the row's words are the play's. */
  const here = () => screen.getByRole('dialog', { name: /^(Visit and cards|Cards) on this (post|character)$/u });
  /** Unfolds Who if it is folded (it stays as it is when the tab changes). */
  const unfold = async () => {
    const who = within(here()).getByRole('button', { name: /^\d+ plays? · / });
    if (who.getAttribute('aria-expanded') !== 'true') await userEvent.click(who);
    return here();
  };
  const lensOf = async (seq: number, name: string) => {
    await userEvent.click(await markNamed(seq, name));
    return unfold();
  };
  const heading = () => here().querySelector('.kb-lens-line')!.textContent;

  test('a heart is a mark on the post it was played from, and its row says what it took off and when, with the singular and the plural', async () => {
    width(false);
    const w = disciplined();
    w.filed(1, 3 * DAY);
    const one = await w.play(w.third, 't-heart', w.gloomba, w.spritey);
    w.filed(4, 2 * DAY);
    const two = await w.play(w.third, 't-heart', w.gloomba, w.spritey);
    expect(one.payload.took).toBe(1);
    expect(two.payload.took).toBe(2);
    openIt(w);
    const l = await lensOf(2, 'T Heart');
    expect(heading()).toBe('Took points off');
    expect([...l.querySelectorAll<HTMLElement>('[data-kb-play]')].map((r) => r.getAttribute('data-kb-play'))).toEqual([two.id, one.id]);
    expect(l).toHaveTextContent(`Took 1 warn point off Spritey's warn bar on ${dayAndTime(one.createdAt)}.`);
    expect(l).toHaveTextContent(`Took 2 warn points off Spritey's warn bar on ${dayAndTime(two.createdAt)}.`);
    /* It is a play like any: reacted to and spun from, and it names the caster. */
    expect(within(l).getAllByRole('button', { name: 'Spin thread' })).toHaveLength(2);
    expect(l).toHaveTextContent('Gloomba · played');
  });

  test('a Super Happy Heart says all it took, and an Unban says it ended the ban and when', async () => {
    width(false);
    const w = disciplined();
    w.filed(4, 3 * DAY);
    w.filed(3, 2 * DAY);
    const sup = await w.play(w.third, 't-super', w.gloomba, w.spritey);
    expect(sup.payload.took).toBe(7);
    w.fake.seed.ban(w.spritey, w.fake.clock.now() + 3 * DAY, { days: 3 });
    const ultra = await w.play(w.third, 't-ultra', w.gloomba, w.spritey);
    openIt(w);
    let l = await lensOf(2, 'T Super');
    expect(l).toHaveTextContent(`Took 7 warn points off Spritey's warn bar on ${dayAndTime(sup.createdAt)}.`);
    await userEvent.click(await markNamed(2, 'T Ultra'));
    l = await unfold();
    expect(heading()).toBe('Ended a ban');
    expect(l).toHaveTextContent(`Ended Spritey's ban on ${dayAndTime(ultra.createdAt)}.`);
  });

  test('a fall waiting names whom the points land on, whom they do not, and how it ends; its heading is the card\'s own while a live play is passed', async () => {
    width(false);
    const w = disciplined();
    await w.play(w.me, 't-fall', w.pipe, w.second, 'post');
    openIt(w);
    const l = await lensOf(2, 'T Fall');
    expect(heading()).toBe('Waiting to take the fall');
    expect(l).toHaveTextContent('Ends when a visit to this post files, or when an admin ends it.');
    expect(l).toHaveTextContent("If a Mod Bot's visit to this post files, its warn points land on Pipewrench, not on Spritey. The post keeps its notice.");
    expect(l).not.toHaveTextContent('A visit to this post filed');
    expect(l).not.toHaveTextContent('Took the fall');
    /* The mark's own words say it too. */
    expect(await markNamed(2, 'T Fall')).toHaveAccessibleName(/Waiting to take the fall/u);
  });

  test('a fall a filing spent stays a mark and says so: "Took the fall", where the points landed, and no end to wait for', async () => {
    width(false);
    const w = disciplined();
    await w.play(w.me, 't-fall', w.pipe, w.second, 'post');
    w.filed(2, 1000);
    openIt(w);
    const l = await lensOf(2, 'T Fall');
    expect(heading()).toBe('Took the fall');
    expect(l).toHaveTextContent('A visit to this post filed, and its warn points landed on Pipewrench.');
    expect(l).not.toHaveTextContent("If a Mod Bot's visit");
    expect(l.querySelector('.kb-lens-ends')).toBeNull();
    expect(await markNamed(2, 'T Fall')).toHaveAccessibleName(/Took the fall/u);
  });

  test('a fall an admin ended is simply ended, never "Took the fall", and says nothing of a filing', async () => {
    width(false);
    const w = disciplined();
    const fall = await w.play(w.me, 't-fall', w.pipe, w.second, 'post');
    await w.as(w.boss, async () => { await w.fake.reverseCard(fall.id); });
    openIt(w);
    const l = await lensOf(2, 'T Fall');
    expect(heading()).toBe('Ended by an admin');
    expect(l).not.toHaveTextContent(/took the fall|visit to this post filed/iu);
    expect(l).toHaveTextContent('Ended by an admin');
  });

  test('a watch is a play on its character with a time up: twice, or N times, and the date it ends', async () => {
    width(false);
    const w = disciplined();
    const two = await w.play(w.third, 't-watch', w.gloomba, w.spritey);
    const three = await w.play(w.third, 't-watch3', w.gloomba, w.spritey);
    openIt(w);
    await article(2);
    const bit = within(document.getElementById('post-2')!.querySelector('.kb-postbit') as HTMLElement);
    await userEvent.click(await bit.findByRole('button', { name: /^T Watch, 1 play\b/u }));
    const l = await unfold();
    expect(l).toHaveAccessibleName('Cards on this character');
    expect(heading()).toBe('Told on');
    expect(l).toHaveTextContent(`Mod Bot patrols are twice as likely to look at Spritey's posts until ${dayAndTime(two.payload.ends as string)}. A patrol still judges each post against the rules.`);
    await userEvent.click(within(l).getByRole('tab', { name: 'T Watch Three' }));
    await unfold();
    expect(l).toHaveTextContent(`Mod Bot patrols are 3 times as likely to look at Spritey's posts until ${dayAndTime(three.payload.ends as string)}.`);
  });

  test('every heading and view passes the Lens\'s own checks, and no sentence names an owner or a class', async () => {
    width(false);
    const w = disciplined();
    w.filed(4, 2 * DAY);
    await w.play(w.third, 't-heart', w.gloomba, w.spritey);
    await w.play(w.me, 't-fall', w.pipe, w.second, 'post');
    openIt(w);
    for (const [seq, name] of [[2, 'T Heart'], [2, 'T Fall']] as const) {
      await userEvent.click(await markNamed(seq, name));
      const l = await unfold();
      expect(wordsProblems('state', heading()!)).toEqual([]);
      expect(viewProblems({ progress: null, state: heading()!, ends: l.querySelector('.kb-lens-ends')?.textContent ?? 'never', yours: false, controls: [], notes: {} }, { holds: false, covers: false })).toEqual([]);
      expect(l).not.toHaveTextContent(/\b(account|owner|owned|heel|face)\b/iu);
      await userEvent.click(await markNamed(seq, name));
    }
  });

  test.each(['heart', 'fall waiting', 'fall spent', 'watch'] as const)('axe passes on the Lens with the %s row open', async (which) => {
    width(false);
    const w = disciplined();
    if (which === 'heart') { w.filed(4, 2 * DAY); await w.play(w.third, 't-heart', w.gloomba, w.spritey); }
    if (which === 'fall waiting' || which === 'fall spent') await w.play(w.me, 't-fall', w.pipe, w.second, 'post');
    if (which === 'fall spent') w.filed(2, 1000);
    if (which === 'watch') await w.play(w.third, 't-watch', w.gloomba, w.spritey);
    openIt(w);
    const name = which === 'heart' ? 'T Heart' : which === 'watch' ? 'T Watch' : 'T Fall';
    await article(2);
    const scope = which === 'watch' ? within(document.getElementById('post-2')!.querySelector('.kb-postbit') as HTMLElement) : within(await article(2));
    await userEvent.click(await scope.findByRole('button', { name: new RegExp(`^${name}, \\d plays?`, 'u') }));
    await unfold();
    const v = await axeViolations(here());
    expect(v, describeViolations(v)).toEqual([]);
  });

  describe('the visit\'s panel with a fall on the post', () => {
    /** A visit on Spritey's post 2, with Pipewrench's fall waiting on it (or no fall at all). */
    async function visitedWithFall(o: { fall?: boolean } = {}) {
      const w = disciplined();
      if (o.fall !== false) await w.play(w.me, 't-fall', w.pipe, w.second, 'post');
      const visit = w.fake.seed.visit(w.clerk, w.second, { at: w.fake.clock.now(), endsInMs: 161 * 60_000, line: 'Routine inspection.' });
      return { ...w, visit };
    }
    const press = async () => {
      await userEvent.click(await within(await article(2)).findByRole('button', { name: /Opens the visit\.$/u }));
      const l = screen.getByRole('dialog', { name: /^Visit/u });
      await waitFor(() => expect(l.querySelector('.kb-visit')).not.toHaveAttribute('aria-busy'));
      return l;
    };
    const file = (w: Awaited<ReturnType<typeof visitedWithFall>>) => {
      w.fake.seed.visitEnd(w.visit, { outcome: 'filed', line: 'Filed.' });
      return w.fake.seed.infraction(w.visit, { points: 2 });
    };

    test('open, it names the fall\'s caster where it names the author, and says the caster took the fall', async () => {
      width(false);
      const w = await visitedWithFall();
      openIt(w);
      const l = await press();
      await waitFor(() => expect(l).toHaveTextContent(/If nobody talks it down by .*, Pipewrench's warn bar gains 2 warn points and this post is marked as breaking Rule 2\./u));
      expect(l).toHaveTextContent('Pipewrench took the fall for this post.');
      expect(l).not.toHaveTextContent("Spritey's warn bar gains");
    });

    test('open with no fall, it says what it said before', async () => {
      width(false);
      const w = await visitedWithFall({ fall: false });
      openIt(w);
      const l = await press();
      await waitFor(() => expect(l).toHaveTextContent("Spritey's warn bar gains 2 warn points"));
      expect(l).not.toHaveTextContent('took the fall');
    });

    test('filed, it names the infraction\'s own character, and says who took the fall for whom', async () => {
      width(false);
      const w = await visitedWithFall();
      file(w);
      openIt(w);
      const l = await press();
      await waitFor(() => expect(l).toHaveTextContent(/Rule 2: No double posting: a minor breach\. Pipewrench's warn bar gained 2 points; they drop off on [A-Z][a-z]{2} \d{1,2}\./u));
      expect(l).toHaveTextContent('Pipewrench took the fall for Spritey.');
      expect(l).not.toHaveTextContent("Spritey's warn bar gained");
    });

    test('Appeal is offered to the fall\'s caster, who owns the infraction, and not to the author it was spared from', async () => {
      width(false);
      const w = await visitedWithFall();
      file(w);
      openIt(w);
      let l = await press();
      await within(l).findByRole('button', { name: 'Appeal · 0.50 Aura' });
      /* The author's own mask reads the same story and is offered nothing. */
      cleanup();
      w.fake.signInAs(w.other);
      renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance: shop, cards: faces });
      l = await press();
      await within(l).findByText(/took the fall for Spritey/u);
      expect(within(l).queryByRole('button', { name: /^Appeal/u })).toBeNull();
    });

    test('axe passes on the filed tab of a fall', async () => {
      width(false);
      const w = await visitedWithFall();
      file(w);
      openIt(w);
      const l = await press();
      await within(l).findByRole('button', { name: /^Appeal/u });
      const v = await axeViolations(l);
      expect(v, describeViolations(v)).toEqual([]);
    });
  });
});
