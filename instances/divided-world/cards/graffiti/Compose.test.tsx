/**
 * Drawing on the post (plan Task 10; design sections 6, 8 and 11): the card's `Compose`, which the engine mounts in the post's effect slot,
 * and `DrawMode`, the same drawing as the Draw tile opens on a wall already there. jsdom has no layout and no canvas, so the body's box is
 * the `box` the slot measured (rects sit at 0, 0 and the box is the size), `paintWall` is watched where it is called (the painter's own
 * pixels are spray.test.tsx's), and what the drawing holds is read from the attributes it publishes. The cursor is the whoops module's own
 * (cursor.test.tsx); here it is watched.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ComposeProps } from '../../../../engine/ui/cards/types.ts';
import type { Act, Answer } from '../../../../engine/ui/data/api.ts';
import { LOST_ANSWER } from '../../../../engine/ui/data/api.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { cursor } from '../whoops/cursor.ts';
import { CANS } from '../graffiti.ts';
import { Compose, DrawMode, type DrawModeProps } from './Compose.tsx';
import * as spray from './spray.ts';

vi.mock('../whoops/cursor.ts', () => ({ cursor: { over: vi.fn(), press: vi.fn(), leave: vi.fn() } }));
vi.mock('./spray.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./spray.ts')>()), paintWall: vi.fn() }));

const player = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../../../engine/ui/player.tsx', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../../engine/ui/player.tsx')>()), usePlayer: () => player.value }));

const BOX = { w: 600, h: 400 };
const ASK = 'Leave without tagging? Your drawing isn\'t saved.';
const POST = { id: 'post-1', character: 'someone', kind: 'post', thread: 't', payload: {}, currentPayload: {}, targetActId: null, seq: 41, createdAt: '2026-10-29T21:14:00.000Z', editedAt: null, shownEditedAt: null } as unknown as Act;
const ok = async (): Promise<Answer<unknown>> => ({ ok: true, value: {} });

beforeEach(() => {
  vi.clearAllMocks();
  player.value = { session: { signedIn: true, account: 'acct-1' }, hudCharacter: { id: 'c1' }, actingCharacters: [{ id: 'c1' }] };
  HTMLCanvasElement.prototype.getContext = (() => ({})) as unknown as HTMLCanvasElement['getContext'];
  try { localStorage.clear(); } catch { /* none here */ }
});
const unders: HTMLElement[] = [];
afterEach(() => { vi.useRealTimers(); for (const el of unders.splice(0)) el.remove(); });

function mountCompose(o: { readonly mode?: 'cast' | 'set'; readonly submit?: ComposeProps['submit'] } = {}) {
  /* The element around the post's words, which the engine owns and the card draws into. */
  const under = document.createElement('div');
  document.body.append(under);
  unders.push(under);
  const props = { post: POST, mode: o.mode ?? 'cast', box: BOX, under, submit: vi.fn(o.submit ?? ok), cancel: vi.fn(), hold: vi.fn(), children: <p>The post&apos;s words.</p> } satisfies ComposeProps;
  const world = renderInWorld(<Compose {...props} />);
  return { ...world, props, under, surface: under.querySelector('[data-kb-draw-surface]') as HTMLElement };
}

function mountDraw(o: Partial<DrawModeProps> = {}) {
  const props: DrawModeProps = { mode: 'cast', box: BOX, wall: null, covered: 0, most: 4000, dockHost: null, asks: true, submit: vi.fn(ok), cancel: vi.fn(), done: vi.fn(), hold: vi.fn(), onDraft: vi.fn(), overlayStyle: {}, ...o };
  const world = renderInWorld(<DrawMode {...props} />);
  return { ...world, props, surface: world.container.querySelector('[data-kb-draw-surface]') as HTMLElement };
}

const px = (x: number, y: number): [number, number] => [x * BOX.w, y * BOX.h];
const strokes = (surface: HTMLElement) => Number(surface.dataset.kbStrokes);

function drag(el: HTMLElement, points: readonly (readonly [number, number])[]) {
  const [first, ...rest] = points.map(([x, y]) => px(x, y));
  act(() => { fireEvent.pointerDown(el, { clientX: first![0], clientY: first![1], pointerId: 1, button: 0, pointerType: 'mouse' }); });
  for (const [x, y] of rest) act(() => { fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' }); });
  const [lx, ly] = rest[rest.length - 1] ?? first!;
  act(() => { fireEvent.pointerUp(el, { clientX: lx, clientY: ly, pointerId: 1, pointerType: 'mouse' }); });
}
const LINE = [[0.2, 0.3], [0.4, 0.3], [0.6, 0.3]] as const;
const tag = () => screen.getByRole('button', { name: /^(Tag it|Set it)$/ });

describe('Compose, on the post a card is played on', () => {
  test('draws the post\'s words as given, and the drawing and its surface in the element around them, lifted so no other card\'s ink takes a press there', () => {
    const { container, surface, under } = mountCompose();
    expect(container).toHaveTextContent('The post\'s words.');
    expect(surface).not.toBeNull();
    expect(under.contains(surface)).toBe(true);
    expect(under.querySelector('canvas[data-kb-effect-ink]')).not.toBeNull();
    expect(surface.hasAttribute('data-kb-over-ink')).toBe(true);
    expect(strokes(surface)).toBe(0);
  });

  test('draws nothing before the words\' box is measured, and nothing without the element around them', () => {
    const under = document.createElement('div');
    const { container } = renderInWorld(<Compose post={POST} mode="cast" box={null} under={under} submit={ok} cancel={() => {}} hold={() => {}}><p>The post&apos;s words.</p></Compose>);
    expect(container).toHaveTextContent('The post\'s words.');
    expect(under.querySelector('canvas')).toBeNull();
    expect(screen.getByText('Draw something first')).toBeInTheDocument();
  });

  test('a press draws, with the can and the cap chosen, and Tag it sends it as the first draw with an empty configuration', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountCompose();
    await user.click(screen.getByRole('radio', { name: 'Pink' }));
    await user.click(screen.getByRole('radio', { name: 'Fat' }));
    drag(surface, LINE);
    expect(strokes(surface)).toBe(1);
    await user.click(tag());
    expect(props.submit).toHaveBeenCalledTimes(1);
    const [config, first] = vi.mocked(props.submit).mock.calls[0]!;
    expect(config).toEqual({});
    expect(first).toEqual({ strokes: [{ can: 'pink', cap: 'fat', aspect: 1.5, points: [[0.2, 0.3], [0.4, 0.3], [0.6, 0.3]] }] });
  });

  test('keeps points in shares of the box to 4 decimals, and thins the ones a pixel or two apart', () => {
    const { surface, props } = mountCompose();
    drag(surface, [[0.123456, 0.3], [0.1236, 0.3], [0.3, 0.3333333]]);
    act(() => { screen.getByRole('button', { name: 'Tag it' }).click(); });
    const first = vi.mocked(props.submit).mock.calls[0]![1] as { strokes: { points: number[][] }[] };
    expect(first.strokes[0]!.points).toEqual([[0.1235, 0.3], [0.3, 0.3333]]);
  });

  test('a stroke drawn is painted on the post as the model adds it, under what the post wears', () => {
    const { surface } = mountCompose();
    drag(surface, LINE);
    const last = vi.mocked(spray.paintWall).mock.calls.at(-1)!;
    expect(last[3]).toHaveLength(1);
    expect(last[3][0]!.kind).toBe('draw');
    expect((last[3][0]!.payload as { strokes: unknown[] }).strokes).toHaveLength(1);
  });

  test('Tag it waits for a drawing, and the toolbar counts it: Wall 0% of 40% grows', async () => {
    const user = userEvent.setup();
    const { surface } = mountCompose();
    await user.click(screen.getByRole('radio', { name: 'Fat' }));
    expect(tag()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Draw something first')).toBeInTheDocument();
    expect(screen.getByText('Wall 0% of 40%')).toBeInTheDocument();
    drag(surface, [[0.05, 0.3], [0.5, 0.3], [0.95, 0.3]]);
    expect(tag()).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByText('Wall 0% of 40%')).toBeNull();
    expect(screen.getByText(/^Wall \d+% of 40%$/)).toBeInTheDocument();
  });

  test('says it holds work once there are strokes, and that it holds none when Undo has taken them all', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountCompose();
    expect(props.hold).not.toHaveBeenCalledWith(ASK);
    drag(surface, LINE);
    expect(props.hold).toHaveBeenLastCalledWith(ASK);
    drag(surface, [[0.2, 0.6], [0.5, 0.6]]);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(strokes(surface)).toBe(1);
    expect(props.hold).toHaveBeenLastCalledWith(ASK);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(strokes(surface)).toBe(0);
    expect(props.hold).toHaveBeenLastCalledWith(null);
  });

  test('Cancel goes to the engine, which asks first when work is held; Compose asks nothing itself', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountCompose();
    drag(surface, LINE);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(ASK)).toBeNull();
  });

  test('a refusal is shown in the toolbar, in the database\'s words, and the drawing is kept and can be sent again', async () => {
    const user = userEvent.setup();
    const submit = vi.fn<ComposeProps['submit']>()
      .mockResolvedValueOnce({ ok: false, error: 'This tag would take the wall to 46%; its limit is 40%.' })
      .mockResolvedValueOnce({ ok: true, value: {} });
    const { surface } = mountCompose({ submit });
    drag(surface, LINE);
    await user.click(tag());
    expect(await screen.findByRole('alert')).toHaveTextContent('This tag would take the wall to 46%; its limit is 40%.');
    expect(strokes(surface)).toBe(1);
    expect(tag()).toHaveAttribute('aria-disabled', 'false');
    await user.click(tag());
    expect(submit).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  test('an answer that never came is shown in the glass\'s plain words, and the drawing is kept', async () => {
    const user = userEvent.setup();
    const { surface } = mountCompose({ submit: async () => ({ ok: false, error: LOST_ANSWER, uncertain: true }) });
    drag(surface, LINE);
    await user.click(tag());
    expect(await screen.findByRole('alert')).toHaveTextContent(LOST_ANSWER);
    expect(strokes(surface)).toBe(1);
  });

  test('set on one\'s own post, the button is Set it and sends the same', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountCompose({ mode: 'set' });
    drag(surface, LINE);
    await user.click(screen.getByRole('button', { name: 'Set it' }));
    expect(props.submit).toHaveBeenCalledTimes(1);
  });
});

describe('a stencil', () => {
  test('is previewed on the post before Tag it, and tags with the stencil, the can and the spot', async () => {
    const user = userEvent.setup();
    const { props } = mountCompose();
    await user.click(screen.getByRole('tab', { name: 'Stencils' }));
    expect(tag()).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('radio', { name: 'Crown' }));
    await user.click(screen.getByRole('radio', { name: 'Pink' }));
    await user.click(screen.getByRole('radio', { name: 'Top left' }));
    const shown = vi.mocked(spray.paintWall).mock.calls.at(-1)![3];
    expect(shown).toHaveLength(1);
    const drawn = (shown[0]!.payload as { strokes: { can: string; points: number[][] }[] }).strokes;
    expect(drawn).toHaveLength(4);
    expect(drawn.every((s) => s.can === 'pink')).toBe(true);
    expect(drawn.flatMap((s) => s.points).every(([x, y]) => x! <= 1 / 3 && y! <= 1 / 3)).toBe(true);
    expect(props.hold).toHaveBeenLastCalledWith(ASK);
    await user.click(tag());
    expect(props.submit).toHaveBeenCalledWith({}, { stencil: 'crown', can: 'pink', spot: 0 });
  });

  test('over the limit it says so with the figures and sends nothing', async () => {
    const user = userEvent.setup();
    const { props } = mountDraw({ most: 100 });
    await user.click(screen.getByRole('tab', { name: 'Stencils' }));
    await user.click(screen.getByRole('radio', { name: 'Big X' }));
    expect(screen.getByText(/^This tag would take the wall to \d+%; its limit is 1%$/)).toBeInTheDocument();
    await user.click(tag());
    expect(props.submit).not.toHaveBeenCalled();
  });
});

describe('review fixes', () => {
  test('a press on the post while the Stencils tab is open starts no stroke and holds no work', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountCompose();
    await user.click(screen.getByRole('tab', { name: 'Stencils' }));
    drag(surface, LINE);
    expect(strokes(surface)).toBe(0);
    expect(props.hold).not.toHaveBeenCalledWith(ASK);
    await user.click(screen.getByRole('tab', { name: 'Spray' }));
    expect(strokes(surface)).toBe(0);
    expect(screen.getByText('Draw something first')).toBeInTheDocument();
  });

  test('Stay returns focus to Cancel', async () => {
    const user = userEvent.setup();
    const { surface } = mountDraw();
    drag(surface, LINE);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  test('Cancel is off while a submit is out', async () => {
    const user = userEvent.setup();
    let release: (a: Answer<unknown>) => void = () => {};
    const { surface } = mountCompose({ submit: () => new Promise((done) => { release = done; }) });
    drag(surface, LINE);
    await user.click(tag());
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => { release({ ok: false, error: 'No.' }); });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  test('the preview is painted with the aspect that is stored, rounded to three figures', () => {
    const under = document.createElement('div');
    document.body.append(under);
    unders.push(under);
    const { container } = renderInWorld(<Compose post={POST} mode="cast" box={{ w: 601, h: 400 }} under={under} submit={ok} cancel={() => {}} hold={() => {}}><p>x</p></Compose>);
    void container;
    drag(under.querySelector('[data-kb-draw-surface]') as HTMLElement, LINE);
    const painted = (vi.mocked(spray.paintWall).mock.calls.at(-1)![3][0]!.payload as { strokes: { aspect: number }[] }).strokes[0]!.aspect;
    expect(painted).toBe(1.5);
  });
});

describe('the meter on a wall that is already there', () => {
  const stripe = { can: 'red', cap: 'fat', aspect: 1.5, points: [[0.05, 0.5], [0.95, 0.5]] };
  const wall = [{ kind: 'draw', payload: { strokes: [stripe] } }];
  const meterText = () => screen.getByText(/^Wall \d+% of 40%$/).textContent;

  test('counts a stroke over ink already there as nothing more, and one beside it as its own cells', () => {
    const { surface } = mountDraw({ wall, covered: 0 });
    const before = meterText();
    expect(before).not.toBe('Wall 0% of 40%');
    act(() => { screen.getByRole('radio', { name: 'Fat' }).click(); });
    drag(surface, [[0.05, 0.5], [0.5, 0.5], [0.95, 0.5]]);
    expect(strokes(surface)).toBe(1);
    expect(meterText()).toBe(before);
    drag(surface, [[0.1, 0.85], [0.5, 0.85], [0.9, 0.85]]);
    expect(meterText()).not.toBe(before);
  });

  test('washes the wall already has take ink out of it before the meter counts', () => {
    const washed = [...wall, { kind: 'wash', payload: { strokes: [{ aspect: 1.5, points: [[0, 0.5], [1, 0.5]] }] } }];
    mountDraw({ wall: washed });
    expect(meterText()).toBe('Wall 0% of 40%');
  });

  test('a wall whose strokes are not read yet starts from the cells the server says are covered', () => {
    mountDraw({ wall: null, covered: 3100 });
    expect(meterText()).toBe('Wall 31% of 40%');
  });

  test('over the limit, Tag it is not ready and the reason is under it', () => {
    const { surface, props } = mountDraw({ wall: null, covered: 3990 });
    act(() => { screen.getByRole('radio', { name: 'Fat' }).click(); });
    drag(surface, [[0.1, 0.8], [0.9, 0.8]]);
    expect(tag()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/^This tag would take the wall to \d+%; its limit is 40%$/)).toBeInTheDocument();
    act(() => { tag().click(); });
    expect(props.submit).not.toHaveBeenCalled();
  });
});

describe('the Draw tile\'s draw mode', () => {
  test('gives the drawing to the host to paint into the wall\'s layer, and clears it when it is gone', () => {
    const { surface, props, unmount } = mountDraw();
    drag(surface, LINE);
    const last = vi.mocked(props.onDraft!).mock.calls.at(-1)![0];
    expect(last?.kind).toBe('draw');
    unmount();
    expect(vi.mocked(props.onDraft!).mock.calls.at(-1)![0]).toBeNull();
  });

  test('sends the draw and is done when it lands, and the can is kept for the account', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountDraw();
    await user.click(screen.getByRole('radio', { name: 'Teal' }));
    drag(surface, LINE);
    await user.click(tag());
    expect(props.submit).toHaveBeenCalledWith({ strokes: [expect.objectContaining({ can: 'teal', cap: 'stock' })] });
    await vi.waitFor(() => expect(props.done).toHaveBeenCalled());
    try { expect(localStorage.getItem('kb-graffiti-can:acct-1')).toBe('teal'); } catch { /* storage is off here */ }
  });

  test('Cancel with nothing drawn leaves at once; with strokes it asks first, and Stay keeps the drawing', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountDraw();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.cancel).toHaveBeenCalledTimes(1);
    drag(surface, LINE);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText(ASK)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.queryByText(ASK)).toBeNull();
    expect(strokes(surface)).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(props.cancel).toHaveBeenCalledTimes(2);
  });

  test('Esc asks the same, and leaves at once with nothing drawn', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountDraw();
    await user.keyboard('{Escape}');
    expect(props.cancel).toHaveBeenCalledTimes(1);
    drag(surface, LINE);
    await user.keyboard('{Escape}');
    expect(props.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText(ASK)).toBeInTheDocument();
  });

  test('a card the engine mounts asks through the engine, so Esc here does nothing of its own', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountDraw({ asks: false });
    drag(surface, LINE);
    await user.keyboard('{Escape}');
    expect(props.cancel).not.toHaveBeenCalled();
    expect(screen.queryByText(ASK)).toBeNull();
  });
});

describe('what a press does', () => {
  test('a press on the toolbar draws nothing', async () => {
    const { surface } = mountDraw();
    act(() => { fireEvent.pointerDown(screen.getByRole('radio', { name: 'Pink' }), { clientX: 300, clientY: 200, pointerId: 1, button: 0, pointerType: 'mouse' }); });
    expect(strokes(surface)).toBe(0);
  });

  test('a press that is not the main button draws nothing', () => {
    const { surface } = mountDraw();
    act(() => { fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, pointerId: 1, button: 2, pointerType: 'mouse' }); });
    expect(strokes(surface)).toBe(0);
  });

  test('a tap with a mouse is a dab: a stroke of one point', () => {
    const { surface } = mountDraw();
    drag(surface, [[0.5, 0.5]]);
    expect(strokes(surface)).toBe(1);
  });
});

describe('the cursor', () => {
  test('a mouse over the post shows the drawn can in the can\'s color, pressed while it draws, and gone when the pointer leaves', () => {
    const { surface } = mountDraw();
    act(() => { fireEvent.pointerMove(surface, { clientX: 100, clientY: 100, pointerId: 1, pointerType: 'mouse' }); });
    expect(cursor.over).toHaveBeenLastCalledWith(surface, expect.objectContaining({ pointerType: 'mouse' }), 'can', CANS.cyan);
    act(() => { fireEvent.pointerDown(surface, { clientX: 100, clientY: 100, pointerId: 1, button: 0, pointerType: 'mouse' }); });
    expect(cursor.press).toHaveBeenLastCalledWith(true);
    act(() => { fireEvent.pointerUp(surface, { clientX: 100, clientY: 100, pointerId: 1, pointerType: 'mouse' }); });
    expect(cursor.press).toHaveBeenLastCalledWith(false);
    act(() => { fireEvent.pointerLeave(surface, { pointerType: 'mouse' }); });
    expect(cursor.leave).toHaveBeenCalledWith(surface);
  });

  test('takes the color of the can picked', async () => {
    const user = userEvent.setup();
    const { surface } = mountDraw();
    await user.click(screen.getByRole('radio', { name: 'Pink' }));
    act(() => { fireEvent.pointerMove(surface, { clientX: 100, clientY: 100, pointerId: 1, pointerType: 'mouse' }); });
    expect(cursor.over).toHaveBeenLastCalledWith(surface, expect.anything(), 'can', CANS.pink);
  });
});

describe('the bounds a draw keeps to', () => {
  test('past 120 strokes no more are taken, and it says so plainly; Undo makes room', async () => {
    const user = userEvent.setup();
    const { surface } = mountDraw();
    for (let i = 0; i < 120; i++) drag(surface, [[(i % 100) / 100 + 0.005, 0.5]]);
    expect(strokes(surface)).toBe(120);
    expect(screen.queryByRole('status')).toBeNull();
    drag(surface, [[0.5, 0.9]]);
    expect(strokes(surface)).toBe(120);
    expect(screen.getByRole('status')).toHaveTextContent('120 strokes');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByRole('status')).toBeNull();
    drag(surface, [[0.5, 0.9]]);
    expect(strokes(surface)).toBe(120);
  });

  test('a stroke longer than 300 points goes on in the next stroke, and Undo takes the whole of it', async () => {
    const user = userEvent.setup();
    const { surface } = mountDraw();
    const long = Array.from({ length: 450 }, (_, i): [number, number] => [0.02 + (i % 2 ? 0.5 : 0), 0.02 + (i / 450) * 0.9]);
    drag(surface, long);
    expect(strokes(surface)).toBe(2);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(strokes(surface)).toBe(0);
  });
});

describe('a finger', () => {
  interface Finger { readonly id: number; readonly at: readonly [number, number] }
  function touch(target: HTMLElement, type: 'touchstart' | 'touchmove' | 'touchend', down: readonly Finger[], changed: readonly Finger[]): boolean {
    const list = (fingers: readonly Finger[]) => fingers.map((f) => ({ identifier: f.id, clientX: f.at[0], clientY: f.at[1], target }));
    const event = new TouchEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { touches: { value: list(down) }, targetTouches: { value: list(down) }, changedTouches: { value: list(changed) } });
    act(() => { target.dispatchEvent(event); });
    return event.defaultPrevented;
  }

  test('a quick vertical swipe scrolls the page and draws nothing', () => {
    const { surface } = mountDraw();
    const [x, y] = px(0.5, 0.5);
    touch(surface, 'touchstart', [{ id: 1, at: [x, y] }], [{ id: 1, at: [x, y] }]);
    const prevented = touch(surface, 'touchmove', [{ id: 1, at: [x, y + 30] }], [{ id: 1, at: [x, y + 30] }]);
    touch(surface, 'touchend', [], [{ id: 1, at: [x, y + 30] }]);
    expect(prevented).toBe(false);
    expect(strokes(surface)).toBe(0);
  });

  test('a sideways swipe draws, and the page\'s scroll is refused for it', () => {
    const { surface } = mountDraw();
    const [x, y] = px(0.3, 0.5);
    touch(surface, 'touchstart', [{ id: 1, at: [x, y] }], [{ id: 1, at: [x, y] }]);
    const prevented = touch(surface, 'touchmove', [{ id: 1, at: [x + 30, y] }], [{ id: 1, at: [x + 30, y] }]);
    touch(surface, 'touchmove', [{ id: 1, at: [x + 90, y] }], [{ id: 1, at: [x + 90, y] }]);
    touch(surface, 'touchend', [], [{ id: 1, at: [x + 90, y] }]);
    expect(prevented).toBe(true);
    expect(strokes(surface)).toBe(1);
  });

  test('a hold draws, with a puff of nothing here and the stroke kept', () => {
    vi.useFakeTimers();
    const { surface } = mountDraw();
    const [x, y] = px(0.3, 0.5);
    touch(surface, 'touchstart', [{ id: 1, at: [x, y] }], [{ id: 1, at: [x, y] }]);
    act(() => { vi.advanceTimersByTime(200); });
    touch(surface, 'touchend', [], [{ id: 1, at: [x, y] }]);
    expect(strokes(surface)).toBe(1);
  });

  test('a second finger is the page\'s: it draws nothing and ends a stroke under way where it got to', () => {
    const { surface } = mountDraw();
    const [x, y] = px(0.3, 0.5);
    touch(surface, 'touchstart', [{ id: 1, at: [x, y] }], [{ id: 1, at: [x, y] }]);
    touch(surface, 'touchmove', [{ id: 1, at: [x + 30, y] }], [{ id: 1, at: [x + 30, y] }]);
    touch(surface, 'touchstart', [{ id: 1, at: [x + 30, y] }, { id: 2, at: [x + 100, y + 50] }], [{ id: 2, at: [x + 100, y + 50] }]);
    const prevented = touch(surface, 'touchmove', [{ id: 1, at: [x + 60, y] }, { id: 2, at: [x + 100, y + 80] }], [{ id: 2, at: [x + 100, y + 80] }]);
    expect(prevented).toBe(false);
    expect(strokes(surface)).toBe(1);
  });

  test('draws nothing with a finger on the toolbar', () => {
    const { surface } = mountDraw();
    const dock = screen.getByRole('group', { name: 'Graffiti tools' });
    const [x, y] = px(0.3, 0.5);
    touch(dock, 'touchstart', [{ id: 1, at: [x, y] }], [{ id: 1, at: [x, y] }]);
    touch(dock, 'touchmove', [{ id: 1, at: [x + 60, y] }], [{ id: 1, at: [x + 60, y] }]);
    expect(strokes(surface)).toBe(0);
  });
});
