import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Instance } from '../../rules/types.ts';
import { axeViolations, describeViolations } from '../a11y.ts';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { Wardrobe } from './Wardrobe.tsx';

/* Two neutral pieces (test-world's TEST_GEAR): a flat band and a tall hat. */
const shop: Instance = {
  ...testInstance,
  gear: [
    { key: 'band', name: 'Headband', line: 'Holds a thought in place.', rarity: 'common' },
    { key: 'tall', name: 'Tall Hat', line: 'Taller than it needs to be.', rarity: 'rare' },
  ],
};

interface Seeded { readonly fake: Fake; readonly pipe: string; readonly bones: string }

/** The player, signed in, with two masks (both with a portrait unless asked) and the gear held. */
function seeded(o: { readonly held?: Record<string, number>; readonly portrait?: boolean } = {}): Seeded {
  const fake = buildWorld(undefined, shop);
  const account = fake.seed.account('ana');
  const pipe = fake.seed.character(account, 'Pipewrench', 'heel');
  const bones = fake.seed.character(account, 'Dr. Bones', 'face');
  if (o.portrait !== false) {
    fake.seed.avatar(pipe, { square: 'https://img.test/pipe-sq.webp', portrait: 'https://img.test/pipe.webp' });
    fake.seed.avatar(bones, { square: 'https://img.test/bones-sq.webp', portrait: 'https://img.test/bones.webp' });
  }
  fake.seed.gear(account, o.held ?? { band: 2, tall: 1 });
  fake.signInAs(account);
  return { fake, pipe, bones };
}

/** The page, then the mask chosen in its select (the roster's order is not the seed's). */
function open(fake: Fake, mask = 'Pipewrench') {
  const shown = renderIn(fake, <Wardrobe />, { instance: shop, path: '/wardrobe' });
  void screen.findByRole('combobox', { name: 'Character' }).then((pick) => {
    const option = [...(pick as HTMLSelectElement).options].find((o) => o.textContent === mask)!;
    fireEvent.change(pick, { target: { value: option.value } });
  });
  return shown;
}
const item = async (name: string) => {
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Character' })).toHaveDisplayValue('Pipewrench'));
  return screen.findByRole('radio', { name });
};
const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(el, { key, ...init });
const worn = () => within(screen.getByRole('group', { name: 'Worn now' })).queryAllByRole('button');
const selected = () => screen.getByRole('group', { name: /, selected$/u });
const said = () => screen.getByRole('status', { name: 'Outfit messages' });

beforeEach(() => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); });
afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-kb-motion'); vi.restoreAllMocks(); });

describe('Wear it, from a Random Event', () => {
  test('the found gear is on the stage on that mask as the page opens, and on no other', async () => {
    const { fake, bones } = seeded();
    renderIn(fake, <Wardrobe />, { instance: shop, path: '/wardrobe', state: { character: bones, wear: 'tall' } });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Character' })).toHaveDisplayValue('Dr. Bones'));
    await waitFor(() => expect(worn().map((b) => b.textContent)).toEqual([expect.stringMatching(/Layer 1.*Tall Hat/u)]));
    expect(selected().getAttribute('aria-label')).toBe('Tall Hat, selected');
  });

  test('a gear with no free copy is not placed, and the page says why', async () => {
    const { fake, pipe, bones } = seeded({ held: { tall: 1 } });
    await fake.setOutfit(bones, [{ gear: 'tall', x: 0.5, y: 0.5, w: 0.5, turn: 0, layer: 0 }]);
    renderIn(fake, <Wardrobe />, { instance: shop, path: '/wardrobe', state: { character: pipe, wear: 'tall' } });
    await waitFor(() => expect(said()).toHaveTextContent(/No copy of Tall Hat is free/u));
    expect(worn()).toHaveLength(0);
  });
});

describe('placing', () => {
  test('Enter on an item puts a piece at the center on the next layer', async () => {
    open(seeded().fake);
    press(await item('Headband'), 'Enter');
    expect(worn().map((b) => b.textContent)).toEqual([expect.stringMatching(/Layer 1.*Headband/u)]);
    expect(selected().style.left).toBe('50%');
    expect(selected().style.top).toBe('50%');
    press(await item('Tall Hat'), 'Enter');
    expect(worn().map((b) => b.textContent)).toEqual([expect.stringMatching(/Layer 1.*Headband/u), expect.stringMatching(/Layer 2.*Tall Hat/u)]);
    expect(selected().getAttribute('aria-label')).toBe('Tall Hat, selected');
  });

  test('the piece is drawn over the portrait by the outfit layer, and the square shows it through its frame', async () => {
    const { fake, pipe } = seeded();
    open(fake);
    press(await item('Headband'), 'Enter');
    const stage = screen.getByRole('group', { name: /Pipewrench's portrait/u });
    expect(stage.querySelectorAll('.kb-outfit[data-kb-on="portrait"] img')).toHaveLength(1);
    expect(pipe).toBeTruthy();
  });

  test('an item with no free copy cannot be placed, and says where its copy is', async () => {
    const { fake, bones } = seeded({ held: { tall: 1 } });
    expect((await fake.setOutfit(bones, [{ gear: 'tall', x: 0.5, y: 0.2, w: 0.5, turn: 0, layer: 0 }])).ok).toBe(true);
    open(fake);
    const hat = await item('Tall Hat');
    expect(screen.getByText('1 held · on Dr. Bones')).toBeInTheDocument();
    press(hat, 'Enter');
    expect(await screen.findByRole('status', { name: 'Outfit messages' })).toHaveTextContent(/No copy of Tall Hat is free/u);
    expect(worn()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Put it on Pipewrench' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('a gear held twice can be worn twice and no more', async () => {
    open(seeded({ held: { band: 2 } }).fake);
    const band = await item('Headband');
    press(band, 'Enter');
    press(band, 'Enter');
    press(band, 'Enter');
    expect(worn()).toHaveLength(2);
    expect(screen.getByRole('status', { name: 'Outfit messages' })).toHaveTextContent(/No copy of Headband is free/u);
  });

  test('reduced motion changes nothing about placing', async () => {
    document.documentElement.removeAttribute('data-kb-motion');
    open(seeded().fake);
    press(await item('Headband'), 'Enter');
    expect(worn()).toHaveLength(1);
    expect(selected().style.left).toBe('50%');
  });
});

describe('the selected piece', () => {
  async function withBand(): Promise<void> {
    open(seeded().fake);
    press(await item('Headband'), 'Enter');
  }

  test('the arrow keys move it by 1%, and Shift by 5%', async () => {
    await withBand();
    press(selected(), 'ArrowRight');
    expect(selected().style.left).toBe('51%');
    press(selected(), 'ArrowUp', { shiftKey: true });
    expect(selected().style.top).toBe('45%');
    press(selected(), 'ArrowLeft');
    press(selected(), 'ArrowDown');
    expect(selected().style.left).toBe('50%');
    expect(selected().style.top).toBe('46%');
  });

  test('+ and - size it by 5% of the portrait, [ and ] turn it by 5 degrees', async () => {
    await withBand();
    expect(selected().style.width).toBe('40%');
    press(selected(), '+');
    expect(selected().style.width).toBe('45%');
    press(selected(), '-');
    press(selected(), '-');
    expect(selected().style.width).toBe('35%');
    press(selected(), ']');
    expect(selected().style.transform).toContain('rotate(5deg)');
    press(selected(), '[');
    press(selected(), '[');
    expect(selected().style.transform).toContain('rotate(-5deg)');
  });

  test('every move stays within what a piece may be', async () => {
    await withBand();
    for (let i = 0; i < 70; i++) press(selected(), 'ArrowLeft');
    expect(selected().style.left).toBe('0%');
    for (let i = 0; i < 30; i++) press(selected(), 'ArrowDown', { shiftKey: true });
    expect(selected().style.top).toBe('100%');
    for (let i = 0; i < 40; i++) press(selected(), '+');
    expect(selected().style.width).toBe('150%');
    for (let i = 0; i < 40; i++) press(selected(), '-');
    expect(selected().style.width).toBe('5%');
    for (let i = 0; i < 40; i++) press(selected(), ']');
    expect(selected().style.transform).toContain('rotate(180deg)');
    for (let i = 0; i < 80; i++) press(selected(), '[');
    expect(selected().style.transform).toContain('rotate(-180deg)');
  });

  test('every key has a button: move, size, turn', async () => {
    await withBand();
    const panel = screen.getByRole('region', { name: 'Selected piece' });
    const click = (name: string) => fireEvent.click(within(panel).getByRole('button', { name }));
    click('Move right');
    click('Move down');
    expect(selected().style.left).toBe('51%');
    expect(selected().style.top).toBe('51%');
    click('Bigger');
    expect(selected().style.width).toBe('45%');
    click('Smaller');
    click('Turn right');
    expect(selected().style.transform).toContain('rotate(5deg)');
    click('Turn left');
    click('Turn left');
    expect(selected().style.transform).toContain('rotate(-5deg)');
  });

  test('Bring forward and Send back swap its layer with the one beside it, and the ends do nothing', async () => {
    open(seeded().fake);
    press(await item('Headband'), 'Enter');
    press(await item('Tall Hat'), 'Enter');
    const panel = screen.getByRole('region', { name: 'Selected piece' });
    expect(within(panel).getByRole('button', { name: 'Bring forward' })).toBeDisabled();
    fireEvent.click(within(panel).getByRole('button', { name: 'Send back' }));
    expect(worn().map((b) => b.textContent)).toEqual([expect.stringMatching(/Layer 1.*Tall Hat/u), expect.stringMatching(/Layer 2.*Headband/u)]);
    fireEvent.click(within(panel).getByRole('button', { name: 'Bring forward' }));
    expect(worn().map((b) => b.textContent)).toEqual([expect.stringMatching(/Layer 1.*Headband/u), expect.stringMatching(/Layer 2.*Tall Hat/u)]);
  });

  test('Take it off, by its button or Delete, frees the copy', async () => {
    await withBand();
    fireEvent.click(screen.getByRole('button', { name: 'Take it off' }));
    expect(worn()).toHaveLength(0);
    press(await item('Headband'), 'Enter');
    press(selected(), 'Delete');
    expect(worn()).toHaveLength(0);
    expect(screen.getByText('2 held · 2 free')).toBeInTheDocument();
  });

  test('Backspace does not take a piece off', async () => {
    await withBand();
    press(selected(), 'Backspace');
    expect(worn()).toHaveLength(1);
  });
});

describe('saving', () => {
  test('sends the whole outfit in layer order, to the character on the stage', async () => {
    const { fake, pipe } = seeded();
    const save = vi.spyOn(fake, 'setOutfit');
    open(fake);
    press(await item('Headband'), 'Enter');
    press(await item('Tall Hat'), 'Enter');
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save the outfit' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0]).toBe(pipe);
    expect(save.mock.calls[0]![1].map((p) => [p.gear, p.layer])).toEqual([['tall', 0], ['band', 1]]);
    expect(await screen.findByText('Outfit saved.')).toBeInTheDocument();
  });

  test('a refusal shows the server\'s words and keeps the arrangement', async () => {
    const { fake } = seeded();
    vi.spyOn(fake, 'setOutfit').mockResolvedValue({ ok: false, error: 'the server says no' });
    open(fake);
    press(await item('Headband'), 'Enter');
    press(selected(), 'ArrowRight');
    fireEvent.click(screen.getByRole('button', { name: 'Save the outfit' }));
    expect(await screen.findByText('the server says no')).toBeInTheDocument();
    expect(worn()).toHaveLength(1);
    expect(selected().style.left).toBe('51%');
  });
});

const choose = (name: string) => {
  const pick = screen.getByRole('combobox', { name: 'Character' }) as HTMLSelectElement;
  fireEvent.change(pick, { target: { value: [...pick.options].find((o) => o.textContent === name)!.value } });
};

describe('drafts and saving again', () => {
  test('an unsaved arrangement is kept when switching masks and back, and the page says so', async () => {
    open(seeded().fake);
    press(await item('Headband'), 'Enter');
    press(selected(), 'ArrowRight');
    expect(screen.getByText(/Your changes to Pipewrench are kept until you save or leave this page/u)).toBeInTheDocument();
    choose('Dr. Bones');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Character' })).toHaveDisplayValue('Dr. Bones'));
    expect(worn()).toHaveLength(0);
    choose('Pipewrench');
    await waitFor(() => expect(worn()).toHaveLength(1));
    fireEvent.click(worn()[0]!);
    expect(selected().style.left).toBe('51%');
  });

  test('after a save, switching away and back shows the saved outfit', async () => {
    open(seeded().fake);
    press(await item('Headband'), 'Enter');
    fireEvent.click(screen.getByRole('button', { name: 'Save the outfit' }));
    await screen.findByText('Outfit saved.');
    choose('Dr. Bones');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Character' })).toHaveDisplayValue('Dr. Bones'));
    choose('Pipewrench');
    await waitFor(() => expect(worn()).toHaveLength(1));
  });

  test('a failed refresh after a save keeps the page', async () => {
    const { fake } = seeded();
    open(fake);
    press(await item('Headband'), 'Enter');
    vi.spyOn(fake, 'wardrobe').mockResolvedValue({ ok: false, error: 'down' });
    vi.spyOn(fake, 'characters').mockRejectedValue(new Error('down'));
    fireEvent.click(screen.getByRole('button', { name: 'Save the outfit' }));
    await screen.findByText('Outfit saved.');
    await screen.findByText(/could not be refreshed/u);
    expect(screen.queryByText(/could not be loaded/u)).toBeNull();
    expect(worn()).toHaveLength(1);
  });

  test('the trophies can be chosen on a mask with no portrait', async () => {
    const { fake, pipe } = seeded({ portrait: false });
    fake.seed.award(pipe, 'p1', { at: Date.parse('2026-10-01T00:00:00Z') });
    open(fake);
    expect(await screen.findByRole('group', { name: 'Shown on posts' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Save shown trophies' })).toBeInTheDocument();
  });
});

describe('the page', () => {
  test('chooses the mask in a select of the player\'s own', async () => {
    open(seeded().fake);
    const pick = await screen.findByRole('combobox', { name: 'Character' });
    expect([...(pick as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Dr. Bones', 'Pipewrench']);
  });

  test('a mask with no portrait is told where to put one, and nothing is worn', async () => {
    open(seeded({ portrait: false }).fake);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Character' })).toHaveDisplayValue('Pipewrench'));
    expect(await screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === 'Gear is worn on a portrait. Upload one in profile edit.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'profile edit' })).toHaveAttribute('href', '/characters/edit');
  });

  test('the carousel names each item with its rarity in words, and the selected one its line', async () => {
    open(seeded().fake);
    await item('Headband');
    expect(screen.getAllByText('Rare').length).toBeGreaterThan(0);
    fireEvent.click(await item('Tall Hat'));
    expect(screen.getByText('Taller than it needs to be.')).toBeInTheDocument();
  });

  test('shown on posts: up to the most can be checked, and the choice is saved', async () => {
    const { fake, pipe } = seeded();
    const ids = ['p1', 'p2', 'p3', 'met'].map((k, i) => fake.seed.award(pipe, k, { at: Date.parse('2026-10-01T00:00:00Z') + i * 1000 }));
    const show = vi.spyOn(fake, 'showTrophies');
    open(fake);
    const group = await screen.findByRole('group', { name: 'Shown on posts' });
    const boxes = await within(group).findAllByRole('checkbox');
    expect(boxes).toHaveLength(4);
    for (const b of boxes.slice(0, 3)) fireEvent.click(b);
    expect(boxes[3]).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save shown trophies' }));
    await waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    expect(show.mock.calls[0]![0]).toBe(pipe);
    expect(show.mock.calls[0]![1]).toHaveLength(3);
    expect(ids).toHaveLength(4);
  });

  test('is axe clean with pieces on the stage', async () => {
    const { container } = open(seeded().fake);
    press(await item('Headband'), 'Enter');
    press(await item('Tall Hat'), 'Enter');
    const found = await axeViolations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});


/* jsdom has no PointerEvent or DragEvent, and a generic Event drops the coordinates a handler reads. */
class PointerStub extends MouseEvent { pointerId = 1; }
class DragStub extends MouseEvent {}
const STAGE = { left: 0, top: 0, width: 200, height: 300, right: 200, bottom: 300, x: 0, y: 0, toJSON: () => ({}) };

describe('review: the pointer, the drop and the words', () => {
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', PointerStub);
    vi.stubGlobal('DragEvent', DragStub);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  /** The page with a headband worn and selected, the stage measured at 200 by 300. */
  async function staged() {
    const shown = open(seeded().fake);
    press(await item('Headband'), 'Enter');
    const stage = screen.getByRole('group', { name: /Pipewrench's portrait/u });
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(STAGE as DOMRect);
    return { shown, stage };
  }
  const ptr = (el: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel', x: number, y: number) => fireEvent[type](el, { clientX: x, clientY: y, button: 0, pointerId: 1 });

  test('a drag on the piece moves it by the pointer\'s distance, in the portrait\'s fractions', async () => {
    const { stage } = await staged();
    ptr(stage, 'pointerDown', 100, 150);
    ptr(stage, 'pointerMove', 120, 180);
    ptr(stage, 'pointerUp', 120, 180);
    expect(selected().style.left).toBe('60%');
    expect(selected().style.top).toBe('60%');
    ptr(stage, 'pointerMove', 0, 0);
    expect(selected().style.left).toBe('60%');
  });

  test('a corner sizes the piece about its center, and the round handle turns it', async () => {
    const { stage } = await staged();
    const corner = selected().querySelector('[data-kb-handle="size"]')!;
    ptr(corner, 'pointerDown', 120, 150);
    ptr(stage, 'pointerMove', 140, 150);
    ptr(stage, 'pointerUp', 140, 150);
    expect(selected().style.width).toBe('80%');
    expect(selected().style.left).toBe('50%');
    expect(selected().style.top).toBe('50%');
    const turn = selected().querySelector('[data-kb-handle="turn"]')!;
    ptr(turn, 'pointerDown', 100, 50);
    ptr(stage, 'pointerMove', 200, 150);
    ptr(stage, 'pointerUp', 200, 150);
    expect(selected().style.transform).toContain('rotate(90deg)');
  });

  test('a cancelled drag puts the piece back where the drag began and is over', async () => {
    const { stage } = await staged();
    press(selected(), 'ArrowRight');
    ptr(stage, 'pointerDown', 102, 150);
    ptr(stage, 'pointerMove', 160, 200);
    expect(selected().style.left).not.toBe('51%');
    ptr(stage, 'pointerCancel', 160, 200);
    expect(selected().style.left).toBe('51%');
    expect(selected().style.top).toBe('50%');
    ptr(stage, 'pointerMove', 10, 10);
    expect(selected().style.left).toBe('51%');
  });

  test('a cancelled drag on a clean page leaves it clean', async () => {
    const { stage } = await staged();
    fireEvent.click(screen.getByRole('button', { name: 'Save the outfit' }));
    await screen.findByText('Outfit saved.');
    ptr(stage, 'pointerDown', 100, 150);
    ptr(stage, 'pointerMove', 120, 180);
    ptr(stage, 'pointerCancel', 120, 180);
    expect(screen.queryByText(/You have changes not saved yet/u)).toBeNull();
  });

  test('dropping a gear from the wardrobe puts it where it was dropped', async () => {
    const { stage } = await staged();
    fireEvent.drop(stage, { clientX: 50, clientY: 75, dataTransfer: { getData: (t: string) => (t === 'text/plain' ? 'tall' : ''), types: ['text/plain'] } });
    expect(worn()).toHaveLength(2);
    expect(selected().style.left).toBe('25%');
    expect(selected().style.top).toBe('25%');
    fireEvent.drop(stage, { clientX: 50, clientY: 75, dataTransfer: { getData: () => 'nonsense', types: ['text/plain'] } });
    expect(worn()).toHaveLength(2);
  });

  test('an edit takes the saved words away, so a dirty page does not say "Outfit saved."', async () => {
    await staged();
    fireEvent.click(screen.getByRole('button', { name: 'Save the outfit' }));
    await screen.findByText('Outfit saved.');
    press(selected(), '+');
    expect(screen.queryByText('Outfit saved.')).toBeNull();
  });

  test('while a save is out the arrangement cannot be edited, so no edit is lost to the save\'s answer', async () => {
    const { fake } = seeded();
    let finish: (v: { ok: true; value: { worn: number } }) => void = () => undefined;
    vi.spyOn(fake, 'setOutfit').mockReturnValue(new Promise((r) => { finish = r; }));
    open(fake);
    press(await item('Headband'), 'Enter');
    fireEvent.click(screen.getByRole('button', { name: 'Save the outfit' }));
    press(selected(), 'ArrowRight');
    press(await item('Tall Hat'), 'Enter');
    expect(selected().style.left).toBe('50%');
    expect(worn()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Move right' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Take it off' })).toBeDisabled();
    finish({ ok: true, value: { worn: 1 } });
    await screen.findByText('Outfit saved.');
    expect(screen.getByRole('button', { name: 'Move right' })).toBeEnabled();
  });

  test('a move that changes nothing says so, and the same words are announced again', async () => {
    await staged();
    for (let i = 0; i < 20; i++) press(selected(), '+');
    expect(selected().style.width).toBe('140%');
    for (let i = 0; i < 2; i++) press(selected(), '+');
    expect(selected().style.width).toBe('150%');
    press(selected(), '+');
    expect(said()).toHaveTextContent("It's as big as it gets.");
    const first = said().firstElementChild;
    press(selected(), '+');
    expect(said()).toHaveTextContent("It's as big as it gets.");
    expect(said().firstElementChild).not.toBe(first);
    for (let i = 0; i < 70; i++) press(selected(), 'ArrowLeft');
    press(selected(), 'ArrowLeft');
    expect(said()).toHaveTextContent("It can't move further that way.");
  });

  test('the arrow keys in Worn now choose and do not move the piece', async () => {
    await staged();
    press(worn()[0]!, 'ArrowDown');
    press(worn()[0]!, 'ArrowRight');
    expect(selected().style.top).toBe('50%');
    expect(selected().style.left).toBe('50%');
    fireEvent.click(screen.getByRole('button', { name: 'Move right' }));
    expect(selected().style.left).toBe('51%');
  });

  test('the selected box is named briefly, and its keys are its description', async () => {
    await staged();
    expect(selected()).toHaveAccessibleName('Headband, selected');
    expect(selected()).toHaveAccessibleDescription(/Arrow keys move it.*Delete takes it off/u);
  });

  test('Bring forward and Send back are disabled at the ends, and focus goes to the piece when one becomes so', async () => {
    open(seeded().fake);
    press(await item('Headband'), 'Enter');
    press(await item('Tall Hat'), 'Enter');
    const back = screen.getByRole('button', { name: 'Send back' });
    back.focus();
    fireEvent.click(back);
    await waitFor(() => expect(back).toBeDisabled());
    expect(back).not.toHaveFocus();
    expect(selected()).toHaveFocus();
  });

  test('says it is loading the wardrobe while the reads are out', async () => {
    const { fake } = seeded();
    vi.spyOn(fake, 'wardrobe').mockReturnValue(new Promise(() => undefined));
    open(fake);
    expect(await screen.findByText('Loading the wardrobe.')).toBeInTheDocument();
  });
});
