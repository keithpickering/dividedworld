/** The browser's side of cropping: decoding a picture, drawing a crop on a canvas, encoding it as a WebP. Tested in a real browser (e2e/avatar.spec.ts); jsdom has no canvas. */
import { CropError, type Picture, type PictureIo } from './crops.ts';
import { bitmapIsAsked, fitsWithoutShrinking, NOT_A_PICTURE, planDecode, TOO_LARGE, webpFrom } from './decode.ts';
import { encodeWebpWasm } from './wasm-webp.ts';

const STORED_UNREADABLE = 'Your stored portrait could not be read back into this browser to cut a new square from it. Upload a picture again to set both.';

function load(src: string, crossOrigin: boolean): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

let resizeProbe: Promise<boolean> | null = null;

/**
 * Whether this browser's `createImageBitmap` honors resizeWidth and resizeHeight, asked once per page on a
 * generated 4 by 4 picture and remembered. A browser that ignores them decodes the whole picture before
 * anything can look at its size, so the player's photo is never handed to one: checking the size after the
 * call is too late, the full bitmap is already allocated. Where it cannot be asked (no canvas, no blob), the
 * answer is no, and the <img> path with its own cap opens the picture.
 */
function bitmapResizeHonored(): Promise<boolean> {
  resizeProbe ??= (async () => {
    try {
      if (typeof createImageBitmap !== 'function') return false;
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      canvas.getContext('2d')?.fillRect(0, 0, 4, 4);
      const tiny = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!tiny) return false;
      const bitmap = await createImageBitmap(tiny, { resizeWidth: 2, resizeHeight: 2 });
      const honored = bitmapIsAsked(bitmap, { width: 2, height: 2 });
      bitmap.close();
      return honored;
    } catch {
      return false;
    }
  })();
  return resizeProbe;
}

/**
 * A picture opened at no more than 4096 on its longest side. The browser shrinks it as it decodes
 * where `createImageBitmap` can (so a 48 megapixel photo is never held whole, and its EXIF
 * orientation is honored); otherwise an <img> is drawn down to a canvas, and one too big even for
 * that is refused as too large, which is not the same thing as not being a picture.
 */
async function open(src: string, crossOrigin: boolean, blob: Blob | null, failure: string, release: () => void): Promise<Picture> {
  const img = await load(src, crossOrigin);
  if (!img) { release(); throw new CropError(failure); }
  const natural = { width: img.naturalWidth, height: img.naturalHeight };
  const plan = planDecode(natural);
  if (plan.kind === 'too-large') { release(); throw new CropError(natural.width > 0 ? TOO_LARGE : failure); }
  const done = (source: CanvasImageSource, release2: () => void, url = src): Picture => ({ ...plan.size, url, source, release: () => { release2(); release(); } });
  if (!plan.shrunk) return done(img, () => {});
  /* What is shown (the stage, the previews) is the shrunk picture too, or the browser would decode the whole original again to draw it. */
  const showing = async (source: CanvasImageSource, release2: () => void): Promise<Picture> => {
    const canvas = document.createElement('canvas');
    canvas.width = plan.size.width;
    canvas.height = plan.size.height;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(source, 0, 0, plan.size.width, plan.size.height);
    const shown = ctx ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92)) : null;
    if (!shown) { release2(); release(); throw new CropError(TOO_LARGE); }
    const shownUrl = URL.createObjectURL(shown);
    return done(source, () => { URL.revokeObjectURL(shownUrl); release2(); }, shownUrl);
  };
  if (blob && typeof createImageBitmap === 'function' && await bitmapResizeHonored()) {
    const bitmap = await createImageBitmap(blob, { resizeWidth: plan.size.width, resizeHeight: plan.size.height, resizeQuality: 'high', imageOrientation: 'from-image' }).catch(() => null);
    /* Where the bitmap could not be made, the <img> path below has its own cap. A browser that ignores the resize was ruled out above, before it allocated anything. */
    if (bitmap && bitmapIsAsked(bitmap, plan.size)) return showing(bitmap, () => bitmap.close());
    bitmap?.close();
  }
  if (!fitsWithoutShrinking(natural)) { release(); throw new CropError(TOO_LARGE); }
  const canvas = document.createElement('canvas');
  canvas.width = plan.size.width;
  canvas.height = plan.size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) { release(); throw new CropError(TOO_LARGE); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, plan.size.width, plan.size.height);
  return showing(canvas, () => {});
}

export const browserIo: PictureIo = {
  loadFile(file) {
    const url = URL.createObjectURL(file);
    return open(url, false, file, NOT_A_PICTURE, () => URL.revokeObjectURL(url));
  },
  loadUrl(url) {
    return open(url, true, null, STORED_UNREADABLE, () => {});
  },
  async encode(picture, cut, out, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = out.width;
    canvas.height = out.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new CropError('This browser cannot cut pictures.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(picture.source, cut.x, cut.y, cut.width, cut.height, 0, 0, out.width, out.height);
    let native: Blob | null;
    try {
      native = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    } catch {
      /* A canvas that holds a picture from another origin without permission refuses to be read back. */
      throw new CropError(STORED_UNREADABLE);
    }
    /* Safari gives a PNG for a WebP request; the WebAssembly encoder then writes the WebP. */
    try {
      return await webpFrom(native, () => encodeWebpWasm(canvas, out, quality));
    } catch {
      throw new CropError('This browser could not save the crop as a picture.');
    }
  },
};
