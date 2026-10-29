import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AvatarUpload } from '../data/api.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { bytesOf, type Picture, type PictureIo } from './crops.ts';
import { webpBlob } from './fixtures.ts';
import { AvatarEditor } from './Cropper.tsx';
import { webpProblem } from './webp.ts';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const pic = (width: number, height: number, url = 'blob:mine'): Picture => ({ width, height, url, source: {} as CanvasImageSource, release: () => {} });

function io(loaded: { file?: Picture; stored?: Picture | Error; exif?: boolean } = {}) {
  const encode = vi.fn((_p: Picture, _c: unknown, out: { width: number; height: number }) => Promise.resolve(webpBlob(out.width, out.height, { exif: loaded.exif })));
  const api: PictureIo = {
    loadFile: vi.fn(() => Promise.resolve(loaded.file ?? pic(400, 2000))),
    loadUrl: vi.fn(() => (loaded.stored instanceof Error ? Promise.reject(loaded.stored) : Promise.resolve(loaded.stored ?? pic(400, 800, 'https://avatars.fake.test/p.webp')))),
    encode,
  };
  return { api, encode };
}

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const pipe = fake.seed.character(me, 'Pipewrench', 'face');
  fake.signInAs(me);
  return { fake, me, pipe };
}

async function mount(w: ReturnType<typeof world>, cropIo: PictureIo, onSaved = vi.fn()) {
  const [character] = await w.fake.characters([w.pipe]);
  renderIn(w.fake, <AvatarEditor character={character!} onSaved={onSaved} io={cropIo} />);
  return onSaved;
}
const pick = async () => {
  await userEvent.upload(screen.getByLabelText('Choose a picture'), new File([Uint8Array.from([1, 2, 3])], 'me.png', { type: 'image/png' }));
  await screen.findByRole('group', { name: 'Portrait frame' });
};
const portrait = () => screen.getByRole('group', { name: 'Portrait frame' });
const square = () => screen.getByRole('group', { name: 'Square frame' });

describe('the avatar cropper', () => {
  test('takes one picture, never uploaded as it is, and shows two frames: the portrait, and the square at its top', async () => {
    const w = world();
    const { api } = io();
    await mount(w, api);
    expect(screen.getByText(/only the two crops are sent/u)).toBeInTheDocument();
    await pick();
    expect(portrait().style.cssText).toMatch(/left: 0%/u);
    expect(portrait().style.height).toBe('40%');
    /* The picture is 400 by 2000; the portrait is its top 2:1; the square is the top half of that. */
    expect(square().style.top).toBe('0%');
    expect(square().style.height).toBe('20%');
    expect(square().style.width).toBe('100%');
    expect(screen.getByText(/Portrait: 400 by 800 pixels/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save the avatar' })).toBeEnabled();
  });

  test('moves and resizes a frame with the keyboard: arrows move, plus and minus resize', async () => {
    const w = world();
    await mount(w, io().api);
    await pick();
    portrait().focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(portrait().style.top).toBe('2%');
    await userEvent.keyboard('-');
    expect(parseFloat(portrait().style.width)).toBeLessThan(100);
    expect(parseFloat(portrait().style.width)).toBeCloseTo(parseFloat(portrait().style.height) * 2.5, 0);
    await userEvent.keyboard('+');
    expect(parseFloat(portrait().style.width)).toBeCloseTo(100, 0);
    square().focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(parseFloat(square().style.top)).toBeGreaterThan(parseFloat(portrait().style.top));
  });

  test('refuses a portrait frame taller than 2:1, in plain words, and will not save it', async () => {
    const w = world();
    const setAvatar = vi.spyOn(w.fake, 'setAvatar');
    await mount(w, io().api);
    await pick();
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Make the portrait taller' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A portrait can be at most twice as tall as it is wide.');
    expect(screen.getByRole('button', { name: 'Save the avatar' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Make the portrait shorter' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save the avatar' })).toBeEnabled();
    expect(setAvatar).not.toHaveBeenCalled();
  });

  test('refuses a portrait wider than tall', async () => {
    const w = world();
    await mount(w, io({ file: pic(1000, 1000) }).api);
    await pick();
    for (let i = 0; i < 3; i++) await userEvent.click(screen.getByRole('button', { name: 'Make the portrait wider' }));
    // A whole-picture frame cannot grow wider; narrow the height instead.
    for (let i = 0; i < 5; i++) await userEvent.click(screen.getByRole('button', { name: 'Make the portrait shorter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A portrait is at least as tall as it is wide.');
    expect(screen.getByRole('button', { name: 'Save the avatar' })).toBeDisabled();
  });

  test('saves the portrait and the square cut from inside it, with their frames, and no original', async () => {
    const w = world();
    const setAvatar = vi.spyOn(w.fake, 'setAvatar');
    const { api, encode } = io();
    const onSaved = await mount(w, api);
    await pick();
    await userEvent.click(screen.getByRole('button', { name: 'Save the avatar' }));
    await waitFor(() => expect(setAvatar).toHaveBeenCalledTimes(1));
    const sent = setAvatar.mock.calls[0]![0] as AvatarUpload;
    expect(Object.keys(sent).sort()).toEqual(['character', 'portrait', 'portraitFrame', 'square', 'squareFrame']);
    expect(sent.character).toBe(w.pipe);
    expect(sent.portraitFrame).toEqual({ x: 0, y: 0, w: 1, h: 0.4 });
    expect(sent.squareFrame).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
    expect(webpProblem(await bytesOf(sent.square))).toBeNull();
    expect(webpProblem(await bytesOf(sent.portrait!))).toBeNull();
    expect(encode).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Avatar saved.'));
    expect((await w.fake.characters([w.pipe]))[0]!.avatarPortrait).not.toBeNull();
  });

  test('sends nothing when the encoded file carries EXIF, and says so', async () => {
    const w = world();
    const setAvatar = vi.spyOn(w.fake, 'setAvatar');
    await mount(w, io({ exif: true }).api);
    await pick();
    await userEvent.click(screen.getByRole('button', { name: 'Save the avatar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/carries metadata \(EXIF\)/u);
    expect(screen.getByRole('alert')).toHaveTextContent('nothing was sent');
    expect(setAvatar).not.toHaveBeenCalled();
  });

  test('shows a refusal from the server in its own words', async () => {
    const w = world();
    vi.spyOn(w.fake, 'setAvatar').mockResolvedValue({ ok: false, error: 'that character is retired; an admin can restore it' });
    await mount(w, io().api);
    await pick();
    await userEvent.click(screen.getByRole('button', { name: 'Save the avatar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('that character is retired; an admin can restore it');
  });

  test('says plainly when the file is not a picture', async () => {
    const w = world();
    const { api } = io();
    api.loadFile = vi.fn(() => Promise.reject(Object.assign(new Error('That file is not a picture this browser can read. Choose a JPEG, PNG, WebP or GIF.'), { name: 'CropError' })));
    await mount(w, api);
    await userEvent.upload(screen.getByLabelText('Choose a picture'), new File(['x'], 'x.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not a picture');
    expect(screen.queryByRole('group', { name: 'Portrait frame' })).toBeNull();
  });
});

describe('recropping the square', () => {
  async function withAvatar() {
    const w = world();
    expect((await w.fake.setAvatar({ character: w.pipe, square: webpBlob(256, 256), portrait: webpBlob(400, 800), squareFrame: { x: 0, y: 0.1, w: 1, h: 0.5 }, portraitFrame: { x: 0, y: 0, w: 1, h: 0.4 } })).ok).toBe(true);
    return w;
  }

  test('is offered only once a portrait is stored', async () => {
    const w = world();
    await mount(w, io().api);
    expect(screen.queryByRole('button', { name: /Recrop the square/u })).toBeNull();
  });

  test('cuts the square from the stored portrait and sends the square alone, with no portrait and no portrait frame', async () => {
    const w = await withAvatar();
    const setAvatar = vi.spyOn(w.fake, 'setAvatar');
    const { api } = io();
    await mount(w, api);
    await userEvent.click(screen.getByRole('button', { name: 'Recrop the square from my stored portrait' }));
    await screen.findByRole('group', { name: 'Square frame' });
    expect(screen.queryByRole('group', { name: 'Portrait frame' })).toBeNull();
    expect(api.loadUrl).toHaveBeenCalledWith((await w.fake.characters([w.pipe]))[0]!.avatarPortrait);
    expect(square().style.top).toBe('10%');
    square().focus();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.click(screen.getByRole('button', { name: 'Save the new square' }));
    await waitFor(() => expect(setAvatar).toHaveBeenCalledTimes(1));
    const sent = setAvatar.mock.calls[0]![0] as AvatarUpload;
    expect(sent.portrait).toBeNull();
    expect(sent.portraitFrame).toBeNull();
    expect(sent.squareFrame.y).toBeCloseTo(0.11);
    expect(Object.keys(sent)).not.toContain('source');
  });

  test('says plainly when the stored portrait cannot be read back', async () => {
    const w = await withAvatar();
    await mount(w, io({ stored: new Error('Your stored portrait could not be read back into this browser to cut a new square from it. Upload a picture again to set both.') }).api);
    await userEvent.click(screen.getByRole('button', { name: 'Recrop the square from my stored portrait' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be read back');
    expect(screen.getByLabelText('Choose a picture')).toBeInTheDocument();
  });
});
