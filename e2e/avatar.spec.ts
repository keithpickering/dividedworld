import { expect, test } from '@playwright/test';
import { webpChunks, webpProblem, webpSize } from '../engine/ui/profile-edit/webp.ts';

/* Safari's canvas gives a PNG when asked for a WebP; a page can be made to do the same. */
const PNG_ONLY = () => {
  const real = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string, q?: number) {
    return real.call(this, cb, type === 'image/webp' ? 'image/png' : type, q);
  };
};

for (const fallback of [false, true]) {
test(`cuts and re-encodes an avatar in the browser, and the files carry no metadata chunk${fallback ? ' (a canvas that gives only PNG: the WebAssembly encoder writes the WebP)' : ''}`, async ({ page }) => {
  const wasm: string[] = [];
  if (fallback) await page.addInitScript(PNG_ONLY);
  page.on('response', (r) => { if (r.url().endsWith('.wasm')) wasm.push(r.url()); });
  await page.goto('/characters');
  await page.getByRole('row', { name: /^Pipewrench/u }).getByRole('link', { name: 'Edit profile' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Edit Pipewrench' })).toBeVisible();

  /* A picture the player owns: 600 by 1500, drawn here, handed to the file input. */
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 1500;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 600, 1500);
    grad.addColorStop(0, '#e33');
    grad.addColorStop(1, '#33e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 600, 1500);
    ctx.fillStyle = '#fff';
    ctx.fillRect(200, 100, 200, 200);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const files = new DataTransfer();
    files.items.add(new File([blob], 'me.png', { type: 'image/png' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('group', { name: 'Portrait frame' })).toBeVisible();
  await expect(page.getByText(/Portrait: 600 by 1200 pixels/u)).toBeVisible();

  /* Move the square a little with the keyboard, then save. */
  await page.getByRole('group', { name: 'Square frame' }).focus();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('button', { name: 'Save the avatar' }).click();
  await expect(page.getByText('Avatar saved.')).toBeVisible();

  const sent = await page.evaluate(() => (globalThis as unknown as { __kbAvatars: { square: number[]; portrait: number[]; keys: string[] }[] }).__kbAvatars.at(-1)!);
  /* The WebAssembly encoder is fetched only where the canvas could not write WebP. */
  expect(wasm.length > 0).toBe(fallback);
  expect(sent.keys.sort()).toEqual(['character', 'portrait', 'portraitFrame', 'square', 'squareFrame']);
  const square = Uint8Array.from(sent.square);
  const portrait = Uint8Array.from(sent.portrait);
  for (const file of [square, portrait]) {
    expect(webpProblem(file)).toBeNull();
    const read = webpChunks(file);
    expect(read.ok).toBe(true);
    const kinds = read.ok ? read.chunks.map((c) => c.kind) : [];
    expect(kinds).not.toContain('EXIF');
    expect(kinds).not.toContain('XMP ');
    expect(kinds).not.toContain('ICCP');
  }
  expect(webpSize(square)).toEqual({ width: 256, height: 256 });
  const p = webpSize(portrait)!;
  expect(p.width).toBeGreaterThanOrEqual(256);
  expect(p.width).toBeLessThanOrEqual(512);
  expect(p.height).toBeGreaterThanOrEqual(p.width);
  expect(p.height).toBeLessThanOrEqual(2 * p.width);
  expect(square.length).toBeLessThanOrEqual(100_000);
  expect(portrait.length).toBeLessThanOrEqual(400_000);
});
}

/* A 48 megapixel photo is opened shrunk, not whole, and an avatar is still cut from it. */
test('opens a 48 megapixel photo at a longest side of 4096 and cuts an avatar from it', async ({ page }) => {
  await page.goto('/characters');
  await page.getByRole('row', { name: /^Pipewrench/u }).getByRole('link', { name: 'Edit profile' }).click();
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8000;
    canvas.height = 6000;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 8000, 6000);
    grad.addColorStop(0, '#e33');
    grad.addColorStop(1, '#33e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 8000, 6000);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.8));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const files = new DataTransfer();
    files.items.add(new File([blob], 'big.jpg', { type: 'image/jpeg' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('group', { name: 'Portrait frame' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Portrait: 3072 by 3072 pixels/u)).toBeVisible();
  await page.getByRole('button', { name: 'Save the avatar' }).click();
  await expect(page.getByText('Avatar saved.')).toBeVisible();
});

/* What the cropper shows is the shrunk picture too: the stage image is never the 48 megapixel original. */
test('shows the shrunk picture, not the original, in the stage', async ({ page }) => {
  await page.goto('/characters');
  await page.getByRole('row', { name: /^Pipewrench/u }).getByRole('link', { name: 'Edit profile' }).click();
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8000;
    canvas.height = 6000;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#4a8';
    ctx.fillRect(0, 0, 8000, 6000);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.8));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const files = new DataTransfer();
    files.items.add(new File([blob], 'big.jpg', { type: 'image/jpeg' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('group', { name: 'Portrait frame' })).toBeVisible({ timeout: 15_000 });
  const stage = page.locator('img[src^="blob:"]').first();
  await expect(stage).toBeVisible();
  await expect.poll(() => stage.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  expect(await stage.evaluate((img: HTMLImageElement) => Math.max(img.naturalWidth, img.naturalHeight))).toBeLessThanOrEqual(4096);
});

/* A phone's photo is stored turned and carries an EXIF orientation; the picture opens as it is meant to be seen. */
for (const orientation of [6, 8]) {
  test(`opens a large JPEG with EXIF orientation ${orientation} at its oriented size, and the frames match it`, async ({ page }) => {
    await page.goto('/characters');
    await page.getByRole('row', { name: /^Pipewrench/u }).getByRole('link', { name: 'Edit profile' }).click();
    await page.evaluate(async (o) => {
      const canvas = document.createElement('canvas');
      canvas.width = 6000;
      canvas.height = 4500;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#a48';
      ctx.fillRect(0, 0, 6000, 4500);
      const jpeg = new Uint8Array(await (await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.8))).arrayBuffer());
      /* An APP1 EXIF segment holding one tag, Orientation, right after the start of image. */
      const exif = [0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0];
      const withExif = new Uint8Array([...jpeg.subarray(0, 2), ...exif, ...jpeg.subarray(2)]);
      const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      const files = new DataTransfer();
      files.items.add(new File([withExif], 'phone.jpg', { type: 'image/jpeg' }));
      input.files = files.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, orientation);
    await expect(page.getByRole('group', { name: 'Portrait frame' })).toBeVisible({ timeout: 15_000 });
    /* 6000 by 4500 turned a quarter is 4500 by 6000, shrunk to 3072 by 4096; its whole is a portrait of that shape. */
    await expect(page.getByText(/Portrait: 3072 by 4096 pixels/u)).toBeVisible();
    await page.getByRole('button', { name: 'Save the avatar' }).click();
    await expect(page.getByText('Avatar saved.')).toBeVisible();
  });
}
