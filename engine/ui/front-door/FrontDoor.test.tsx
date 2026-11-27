import { lazy, useEffect } from 'react';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import type { EffectProps, CardUi } from '../cards/types.ts';
import { ok, refuse, type CardRules } from '../../rules/cards.ts';
import { cellsOf, count, type SurfaceStroke } from '../../rules/surface.ts';
import { KayfaProvider, useKayfa } from '../context.tsx';
import type { FrontDoorPost } from '../types.ts';
import { buildWorld, renderIn, renderInWorld, testInstance } from '../test-world.tsx';
import { FrontDoor } from './FrontDoor.tsx';

/* A card of the test's own with an effect: it wraps the words, says one control, and reports what save and release answer. */
let seen: EffectProps | null = null;
const test_card: CardUi = {
  key: 'whoops',
  Effect: (props) => {
    seen = props;
    const { show } = props;
    useEffect(() => { show({ progress: 0, state: 'inked', yours: true, controls: [{ kind: 'hold', label: 'Hold to scrub', start: () => {}, stop: () => {} }], notes: {} }); }, [show]);
    return <div data-testid="effect">{props.children}</div>;
  },
  describe: () => 'A test card.',
  art: { color: 'currentColor', ink: 'currentColor', canvas: '', mark: '', credit: 'Test' },
};

/* A card that keeps a state (`validateState`), and one with a surface; each says what its effect was handed. */
const rulesOf = (key: string, extra: Partial<CardRules>): CardRules => ({ ...testInstance.cards[0]!, key, name: key, stack: 1, reaches: ['post' as const], ...extra } as CardRules);
const stroke = (y: number): SurfaceStroke => ({ width: 0.1, aspect: 1, points: [[0.1, y], [0.9, y]] });
const checkDraw = (input: unknown) => (typeof input === 'object' && input !== null && Array.isArray((input as { strokes?: unknown }).strokes)
  ? ok({ strokes: (input as { strokes: SurfaceStroke[] }).strokes, payload: { strokes: (input as { strokes: unknown[] }).strokes } }) : refuse('strokes'));
const noted = rulesOf('noted', { validateState: (s: unknown) => ok(s) });
const noWash = () => refuse('a staged wall is never washed');
const slab = rulesOf('slab', { surface: { limitKey: 'slab.limit', mostLive: 48, coats: { line: 20, most: 40 }, validateDraw: checkDraw, validateWash: noWash } });
const doorInstance = { ...testInstance, cards: [...testInstance.cards, noted, slab], settings: { ...testInstance.settings, cardSettings: { 'slab.limit': 40 } } };
let notedSeen: EffectProps | null = null;
let wallSeen: EffectProps | null = null;
const plain = (key: string, keep: (p: EffectProps) => void): CardUi => ({ key, Effect: (props) => { keep(props); return <div>{props.children}</div>; }, describe: () => key, art: { color: 'currentColor', ink: 'currentColor', canvas: '', mark: '', credit: 'Test' } });
const notedUi = plain('noted', (p) => { notedSeen = p; });
const slabUi = plain('slab', (p) => { wallSeen = p; });
const wallPost = (strokes: readonly SurfaceStroke[], extra: readonly { by: string; draw: unknown }[] = []): FrontDoorPost => ({
  by: 'bo', body: 'A wall.', reactions: {}, plays: [{ card: 'slab', by: 'ann', config: {}, draws: [...strokes.map((s, i) => ({ by: i === 0 ? 'ann' : 'bo', draw: { strokes: [s] } })), ...extra] }],
});
/** The front door with posts of the test's own, on an instance that has the two cards. */
function WithDoor({ posts, after = [] }: { readonly posts?: readonly FrontDoorPost[]; readonly after?: readonly FrontDoorPost[] }) {
  const k = useKayfa();
  return <KayfaProvider value={{ ...k, instance: doorInstance, ui: { ...k.ui, frontDoor: { ...k.ui.frontDoor, posts: [...(posts ?? k.ui.frontDoor.posts), ...after] } } }}><FrontDoor /></KayfaProvider>;
}
const drawWith = (posts: readonly FrontDoorPost[]) => renderInWorld(<WithDoor posts={posts} />, { cards: [test_card, notedUi, slabUi], instance: doorInstance });
const draw = () => renderInWorld(<FrontDoor />, { cards: [test_card] });

describe('the front door', () => {
  test('each post is drawn like a thread\'s: one .kb-act-grid under the article holds the postbit, meta and main', () => {
    draw();
    const articles = [...document.querySelectorAll('article.kb-act')];
    expect(articles).toHaveLength(2);
    for (const a of articles) {
      const grids = [...a.children].filter((c) => c.classList.contains('kb-act-grid'));
      expect(grids).toHaveLength(1);
      const kids = [...grids[0]!.children];
      expect(kids.some((c) => c.classList.contains('kb-act-meta'))).toBe(true);
      expect(kids.some((c) => c.classList.contains('kb-act-main'))).toBe(true);
      expect(kids.some((c) => c.classList.contains('kb-postbit'))).toBe(true);
      expect([...a.children].filter((c) => c.classList.contains('kb-act-meta') || c.classList.contains('kb-act-main'))).toHaveLength(0);
    }
  });

  test('the title is the h1, the label is visible, and the whole is a region named by the label', () => {
    draw();
    expect(screen.getByRole('heading', { level: 1, name: 'How do we explain this' })).toBeInTheDocument();
    expect(screen.getAllByText('Sample thread, made up').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Sample thread, made up' })).toBeInTheDocument();
  });

  test('each post shows its author as text, not a link', () => {
    draw();
    expect(screen.getAllByText('Ann').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bo').length).toBeGreaterThan(0);
    const bits = screen.getAllByRole('group', { name: /^About / });
    expect(bits).toHaveLength(2);
    for (const bit of bits) expect(within(bit).queryByRole('link')).toBeNull();
    expect(screen.getByText('Test Talent')).toBeInTheDocument();
  });

  test('the reactions are the thread\'s meta tiles, each post with React, and nothing in the post\'s foot', () => {
    draw();
    expect(screen.queryByRole('listitem', { name: /./ })).toBeNull();
    expect(document.querySelectorAll('.kb-chip')).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'React' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Tomato, 3. React' })).toHaveClass('kb-meta-tile');
    expect(screen.getByRole('button', { name: 'Fire, 2. React' })).toBeInTheDocument();
    expect(document.querySelector('.kb-act-foot')).toBeNull();
  });

  test('a reaction the visitor leaves lands on their screen: its count grows and it is theirs', async () => {
    draw();
    await userEvent.click(screen.getByRole('button', { name: 'Fire, 2. React' }));
    expect(await screen.findByRole('button', { name: 'Fire, 3, including yours, can\'t be taken back' })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'React' })[1]!);
    await userEvent.click(within(screen.getByRole('dialog', { name: /^React to Bo/ })).getByRole('button', { name: /^Tea, / }));
    expect(await screen.findByRole('button', { name: 'Tea, 2, including yours, can\'t be taken back' })).toBeInTheDocument();
  });

  test('a post with a play has its mark on the date row, and the mark opens the Lens with the card\'s controls, no Spin and no Go to post', async () => {
    draw();
    const mark = within(document.querySelector('[data-kb-seq="2"] .kb-act-meta') as HTMLElement).getByRole('button', { name: /Whoops/ });
    expect(document.querySelectorAll('.kb-mark')).toHaveLength(1);
    await userEvent.click(mark);
    const lens = await screen.findByRole('dialog', { name: 'Cards on this post' });
    expect(within(lens).getByRole('button', { name: 'Hold to scrub' })).toBeInTheDocument();
    await userEvent.click(within(lens).getByRole('button', { name: '1 play · Ann' }));
    expect(within(lens).queryByRole('button', { name: 'Spin thread' })).toBeNull();
    expect(within(lens).queryByRole('link', { name: 'Go to post' })).toBeNull();
    expect(within(lens).queryByRole('button', { name: 'As it landed' })).toBeNull();
    expect(within(lens).getByRole('button', { name: 'Fire, 1. React' })).toBeInTheDocument();
  });

  test('a post with a play of a card draws that card\'s effect around its words, once, and not on the other post', () => {
    draw();
    const effect = screen.getByTestId('effect');
    expect(effect).toHaveTextContent('It plays up to 3 characters.');
    expect(screen.getAllByTestId('effect')).toHaveLength(1);
    expect(seen!.plays).toHaveLength(1);
    expect(seen!.plays[0]).toMatchObject({ card: 'whoops', layer: 1, config: { seed: 7 }, message: '' });
    expect(seen!.reader).toEqual({ author: false, caster: false });
    expect(seen!.place).toBe('thread');
    expect(seen!.still).toBe(false);
    expect(seen!.nameOf(seen!.plays[0]!.caster)).toBe('Ann');
  });

  test('a play the instance names keeps that id, under the door\'s own prefix, so a card that rolls from its play\'s id rolls what the instance chose', () => {
    drawWith([{ by: 'ann', body: 'Named.', reactions: {}, plays: [{ id: 'pile-on-1', card: 'whoops', by: 'bo', config: { seed: 7 } }] }]);
    expect(seen!.plays[0]!.id).toBe('front-door:play:pile-on-1');
  });

  test('the card\'s controls are never drawn under the post', () => {
    draw();
    expect(screen.queryByRole('button', { name: 'Hold to scrub' })).toBeNull();
  });

  test('save and release refuse without asking anyone', async () => {
    draw();
    const saved = await seen!.save(seen!.plays[0]!.id, {});
    const released = await seen!.release(seen!.plays[0]!.id);
    expect(saved).toMatchObject({ ok: false, error: 'this is a sample post' });
    expect(released).toMatchObject({ ok: false, error: 'this is a sample post' });
  });

  test('a card with no effect draws the words alone', () => {
    renderInWorld(<FrontDoor />);
    expect(screen.queryByTestId('effect')).toBeNull();
    expect(screen.getByText('It plays up to 3 characters.')).toBeInTheDocument();
  });

  test('a setting marker in a post is filled from the settings', () => {
    draw();
    expect(screen.queryByText(/\{\{setting/)).toBeNull();
    expect(screen.getByText(/plays up to 3 characters/)).toBeInTheDocument();
  });

  test('the persona\'s note is a glass post with a hidden heading, and shows its filled text', () => {
    draw();
    expect(screen.getByRole('heading', { level: 2, name: /^A note from / })).toBeInTheDocument();
    expect(screen.getByText('A note. It is by invite.')).toBeInTheDocument();
  });

  test('the screen calls no API method of its own, now or later', async () => {
    /* Every method the backend has is wrapped and named when called; what the frame's providers call around a bare
       element is the baseline, and the front door may add none, even calls made after the first render settles. */
    const called = async (element: React.ReactElement, use: () => Promise<void> = async () => {}) => {
      const fake = buildWorld();
      const names = new Set<string>();
      for (const [key, value] of Object.entries(fake)) {
        if (typeof value === 'function' && key !== 'now') (fake as unknown as Record<string, unknown>)[key] = (...a: unknown[]) => { names.add(key); return (value as (...x: unknown[]) => unknown)(...a); };
      }
      const { unmount } = renderIn(fake, element, { cards: [test_card, slabUi] });
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      await use();
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      unmount();
      return names;
    };
    const baseline = await called(<p>nothing</p>);
    const withDoor = await called(<WithDoor after={[wallPost([stroke(0.2), stroke(0.6)])]} />, async () => {
      /* A reaction, a pick and an open Lens with a reaction to the play in it: none of them asks anyone. */
      await userEvent.click(screen.getByRole('button', { name: 'Fire, 2. React' }));
      await userEvent.click(screen.getAllByRole('button', { name: 'React' })[1]!);
      await userEvent.click(within(screen.getByRole('dialog', { name: /^React to Bo/ })).getByRole('button', { name: /^Tea, / }));
      await userEvent.click(screen.getByRole('button', { name: /Whoops/ }));
      const lens = await screen.findByRole('dialog', { name: 'Cards on this post' });
      await userEvent.click(within(lens).getByRole('button', { name: '1 play · Ann' }));
      await userEvent.click(within(lens).getByRole('button', { name: 'Fire, 1. React' }));
      await within(lens).findByRole('button', { name: 'Fire, 2, including yours, can\'t be taken back' });
      /* The wall's `near`, as an effect calls it when the wall comes into view: the staged page reads nothing. */
      await act(async () => { wallSeen!.surface!.near(); });
    });
    expect([...withDoor].filter((n) => !baseline.has(n))).toEqual([]);
  });

  test('a cast member the front door reveals carries the postbit\'s own revealed line, and one it does not carries none', () => {
    draw();
    expect(within(screen.getByRole('group', { name: 'About Bo' })).getByText(/^Revealed: Heel \(/u)).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'About Ann' })).queryByText(/^Revealed:/u)).toBeNull();
  });

  test("each cast member's postbit shows the rank the front door gives it", () => {
    draw();
    expect(within(screen.getByRole('group', { name: 'About Ann' })).getByText('Jobber')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'About Bo' })).getByText('Main Eventer')).toBeInTheDocument();
  });
});

describe('the front door\'s saved states and surface draws', () => {
  test('a play with a state hands it to its effect under the play\'s id', () => {
    drawWith([{ by: 'ann', body: 'Hi.', reactions: {}, plays: [{ card: 'noted', by: 'bo', config: {}, state: { note: 'kept' } }] }]);
    const id = notedSeen!.plays[0]!.id;
    expect(notedSeen!.states[id]).toMatchObject({ state: { note: 'kept' } });
  });

  test('a surface play with two draws hands its effect the draws in order, with their drawers, and the cells they cover', () => {
    drawWith([wallPost([stroke(0.2), stroke(0.6)])]);
    const s = wallSeen!.surface!;
    expect(s.acts).toHaveLength(2);
    expect(s.acts!.map((a) => a.kind)).toEqual(['draw', 'draw']);
    expect(s.acts![0]!.character).toBe('front-door:ann');
    expect(s.acts![1]!.character).toBe('front-door:bo');
    expect(s.acts![0]!.payload).toEqual({ strokes: [stroke(0.2)] });
    expect(s.covered).toBe(count(cellsOf([stroke(0.2)])) + count(cellsOf([stroke(0.6)])));
    expect(s.covered).toBeGreaterThan(0);
  });

  test('overlapping draws each carry the cells they paint (ink over ink is paid for again, as a thread\'s wall counts it), and the shares sum to the cells covered', () => {
    drawWith([wallPost([stroke(0.2), stroke(0.25), stroke(0.6)])]);
    const s = wallSeen!.surface!;
    const [a, b, c] = [cellsOf([stroke(0.2)]), cellsOf([stroke(0.25)]), cellsOf([stroke(0.6)])];
    const shares = s.acts!.map((x) => (x as { share: number }).share);
    expect(shares).toEqual([count(a), count(b), count(c)]);
    expect(shares.reduce((x, y) => x + y, 0)).toBe(s.covered);
    expect(s.acts!.map((x) => (x as { places?: unknown }).places)).toEqual([[], [], []]);
  });

  test('a draw painted over wholly by a later one stays live, as a thread\'s would: only a wash takes a tag off', () => {
    const wide: SurfaceStroke = { width: 0.4, aspect: 1, points: [[0.0, 0.2], [1.0, 0.2]] };
    drawWith([wallPost([stroke(0.2), wide])]);
    const s = wallSeen!.surface!;
    expect(s.acts).toHaveLength(2);
    expect(s.covered).toBe(count(cellsOf([stroke(0.2)])) + count(cellsOf([wide])));
  });

  test('a draw that paints nothing is not staged as a live Act, and costs the wall nothing', () => {
    drawWith([wallPost([stroke(0.2)], [{ by: 'bo', draw: { strokes: [] } }])]);
    const s = wallSeen!.surface!;
    expect(s.acts).toHaveLength(1);
    expect(s.covered).toBe(count(cellsOf([stroke(0.2)])));
  });

  test('a draw the card\'s rules refuse is not staged, and the others are', () => {
    drawWith([wallPost([stroke(0.2)], [{ by: 'bo', draw: 'not a draw' }, { by: 'bo', draw: { strokes: [stroke(0.6)] } }])]);
    const s = wallSeen!.surface!;
    expect(s.acts).toHaveLength(2);
    expect(s.covered).toBe(count(cellsOf([stroke(0.2)])) + count(cellsOf([stroke(0.6)])));
  });
});

describe('the front door with an effect that loads on first use', () => {
  test('the post shows its words before the effect lands, and inside it after', async () => {
    let land!: () => void;
    const gate = new Promise<void>((resolve) => { land = resolve; });
    const Effect = lazy(async () => { await gate; return { default: (props: EffectProps) => <div data-testid="effect">{props.children}</div> }; });
    renderInWorld(<FrontDoor />, { cards: [{ ...test_card, Effect }] });
    expect(screen.getByText('It plays up to 3 characters.')).toBeInTheDocument();
    expect(screen.queryByTestId('effect')).toBeNull();
    await act(async () => { land(); await gate; });
    expect(screen.getByTestId('effect')).toHaveTextContent('It plays up to 3 characters.');
  });
});

describe('the front door\'s pictures', () => {
  test('a root-relative picture in a staged post is drawn from the page\'s own origin', () => {
    drawWith([{ by: 'ann', body: '[img]/x/sheet.gif[/img]', reactions: {} }]);
    /* Over https it is an img; over http (this test's origin) the renderer shows the same address as a link. */
    const el = document.querySelector('article.kb-act img, article.kb-act a[href$="sheet.gif"]');
    expect(el?.getAttribute('src') ?? el?.getAttribute('href')).toBe(`${window.location.origin}/x/sheet.gif`);
  });

  test('a protocol-relative picture is not rewritten, and the parser treats it as it does anywhere', () => {
    drawWith([{ by: 'ann', body: '[img]//evil.example/a.gif[/img]', reactions: {} }]);
    const srcs = [...document.querySelectorAll('article.kb-act img, article.kb-act a')].map((i) => i.getAttribute('src') ?? i.getAttribute('href'));
    expect(srcs.some((s) => s?.includes('evil.example'))).toBe(false);
    expect(srcs.some((s) => s?.startsWith(window.location.origin))).toBe(false);
  });

  describe('a post wearing a card that folds the row', () => {
    let folded: EffectProps | null = null;
    const foldUi: CardUi = { ...plain('folder', (p) => { folded = p; }), foldsRow: true };
    const folder = rulesOf('folder', {});
    const foldInstance = { ...doorInstance, cards: [...doorInstance.cards, folder] };
    const foldPosts: readonly FrontDoorPost[] = [
      { by: 'bo', body: 'Folded words.', reactions: {}, plays: [{ card: 'folder', by: 'ann', config: {} }] },
      { by: 'ann', body: 'Plain words.', reactions: {}, plays: [{ card: 'noted', by: 'bo', config: {}, state: {} }] },
    ];
    function Fold() {
      const k = useKayfa();
      return <KayfaProvider value={{ ...k, instance: foldInstance, ui: { ...k.ui, frontDoor: { ...k.ui.frontDoor, posts: foldPosts } } }}><FrontDoor /></KayfaProvider>;
    }
    const drawFold = () => renderInWorld(<Fold />, { cards: [foldUi, notedUi, test_card], instance: foldInstance });
    const article = (seq: number) => document.querySelector<HTMLElement>(`#front-door-post-${seq}`)!;

    test('the post is folded behind a bar: the effect is given the fold, the article says so, and the grid is hidden', () => {
      drawFold();
      expect(folded!.fold).toMatchObject({ open: false });
      expect(article(1)).toHaveAttribute('data-kb-fold', 'folded');
      const bar = article(1).querySelector('.kb-fold-bar') as HTMLElement;
      expect(within(bar).getByRole('button', { name: /^Show post #1 by Bo/u })).toHaveAttribute('aria-expanded', 'false');
      expect(article(1).querySelector('.kb-act-grid')).toHaveAttribute('hidden');
    });

    test('the press opens the row, and the effect is told', async () => {
      drawFold();
      const grid = article(1).querySelector('.kb-act-grid') as HTMLElement;
      const press = within(article(1)).getByRole('button', { name: /^Show post #1/u });
      expect(press).toHaveAttribute('aria-controls', grid.id);
      expect(grid.id).not.toBe('');
      await userEvent.click(press);
      expect(press).toHaveAttribute('aria-expanded', 'true');
      expect(grid).not.toHaveAttribute('hidden');
      expect(article(1)).toHaveAttribute('data-kb-fold', 'open');
      expect(folded!.fold).toMatchObject({ open: true });
    });

    test('the marks sit in the bar, not on the date row', () => {
      drawFold();
      expect(article(1).querySelector('.kb-fold-bar .kb-mark')).not.toBeNull();
      expect(article(1).querySelector('.kb-act-meta .kb-mark')).toBeNull();
    });

    test('a post whose card does not fold has no bar and no mark of a fold, and its marks stay on its date row', () => {
      drawFold();
      expect(article(2).querySelector('.kb-fold-bar')).toBeNull();
      expect(article(2)).not.toHaveAttribute('data-kb-fold');
      expect(article(2).querySelector('.kb-act-grid')).not.toHaveAttribute('hidden');
      expect(article(2).querySelector('.kb-act-meta .kb-mark')).not.toBeNull();
    });
  });
});
