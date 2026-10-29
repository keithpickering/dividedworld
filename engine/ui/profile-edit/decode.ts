/**
 * The decisions behind decoding and encoding a picture, pure so they are tested without a browser:
 * how big a picture is opened at, what is said when it cannot be, and whether the browser's own
 * WebP encoder is used or the WebAssembly one. The browser's calls themselves are in picture.ts.
 */
import type { Size } from './frames.ts';

/** A picture is opened with its longest side at most this many pixels; an avatar never needs more (the portrait is 512 wide). */
export const MAX_SIDE = 4096;
/** Past this many pixels an <img> that cannot be downscaled on decode is not opened: it would run a phone out of memory. */
export const MAX_PIXELS = 64_000_000;

export const NOT_A_PICTURE = 'That file is not a picture this browser can read. Choose a JPEG, PNG, WebP or GIF.';
export const TOO_LARGE = 'That picture is too large to open here. Choose a smaller one, or shrink it first (about 4000 pixels on its longest side is plenty).';

export type DecodePlan =
  | { readonly kind: 'too-large' }
  | { readonly kind: 'open'; readonly size: Size; readonly shrunk: boolean };

/** The size to open a picture of this size at, or that it cannot be opened. */
export function planDecode(natural: Size): DecodePlan {
  const { width, height } = natural;
  if (!(width > 0) || !(height > 0)) return { kind: 'too-large' };
  const longest = Math.max(width, height);
  if (longest <= MAX_SIDE) return { kind: 'open', size: { width, height }, shrunk: false };
  const k = MAX_SIDE / longest;
  return { kind: 'open', size: { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }, shrunk: true };
}

/** Whether a picture of this size may be opened by a path that cannot shrink it as it decodes. */
export const fitsWithoutShrinking = (natural: Size, maxPixels = MAX_PIXELS) => natural.width * natural.height <= maxPixels;

/** The browser's own WebP where it made one; otherwise (Safari, every iOS browser: they give a PNG) the WebAssembly encoder's. */
export async function webpFrom(native: Blob | null, fallback: () => Promise<Blob>): Promise<Blob> {
  if (native && native.type === 'image/webp') return native;
  return fallback();
}

/** Whether a bitmap `createImageBitmap` made is the size it was asked for. Some browsers ignore the resize options and hand back the whole picture. */
export const bitmapIsAsked = (bitmap: Size, asked: Size): boolean => bitmap.width === asked.width && bitmap.height === asked.height;
