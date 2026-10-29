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
