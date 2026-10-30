/**
 * Cutting an avatar in the browser: the portrait from the player's own picture and the square from
 * inside it, each drawn to a canvas and re-encoded as a WebP, so nothing but pixels leaves the
 * browser (the original is never sent). Every file is read back before it is handed on: it must be
 * a WebP of exactly the size asked, within the server's byte bound, and hold nothing but its
 * picture (webp.ts); a file that does not is refused here, in words, and never sent.
 *
 * The browser's own pieces (decoding a picture, drawing, encoding) are behind `PictureIo`, so the
 * cutting and the checks are tested without a canvas, and the real thing is tested in a browser.
 */
import type { Frame } from '../data/api.ts';
import { composeFrames, cutRect, outputSize, portraitProblem, SQUARE_SIDE, type Size } from './frames.ts';
import { stripColorProfile, webpProblem, webpSize } from './webp.ts';

export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** A picture loaded for cutting: its pixel size, what to draw from, and where to show it. */
export interface Picture extends Size {
  readonly url: string;
  readonly source: CanvasImageSource;
  readonly release: () => void;
}

export interface PictureIo {
  /** The player's own file, never uploaded as it is. */
  loadFile(file: Blob): Promise<Picture>;
  /** A stored portrait from its public address, read back into a canvas (so cross-origin reads must be allowed). */
  loadUrl(url: string): Promise<Picture>;
  /** `cut` of the picture drawn at `out` and encoded as a WebP at `quality` (0 to 1). */
  encode(picture: Picture, cut: Rect, out: Size, quality: number): Promise<Blob>;
}

/** A failure with words for the player. */
export class CropError extends Error {}

export const LIMITS = { square: 100_000, portrait: 400_000 } as const;
const QUALITIES = [0.92, 0.8, 0.65, 0.5, 0.35] as const;

export async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** One crop, encoded at the best quality that fits its byte bound, and checked to hold nothing but its picture. */
async function crop(io: PictureIo, picture: Picture, name: 'square' | 'portrait', cut: Rect, out: Size): Promise<Blob> {
  for (const quality of QUALITIES) {
    const encoded = await io.encode(picture, cut, out, quality);
    const made = await bytesOf(encoded);
    /* A browser's canvas writes its own sRGB profile into the file; an untagged picture is sRGB already, and the server takes none. */
    const bytes = stripColorProfile(made);
    const blob = bytes === made ? encoded : new Blob([bytes as BlobPart], { type: 'image/webp' });
    const problem = webpProblem(bytes);
    if (problem === 'is not a WebP') throw new CropError(`This browser did not make a WebP picture for the ${name}, so nothing was sent. Try another browser.`);
    if (problem) throw new CropError(`The ${name} file ${problem}, so nothing was sent.`);
    const size = webpSize(bytes);
    if (!size || size.width !== out.width || size.height !== out.height) throw new CropError(`The ${name} came out a different size than asked, so nothing was sent.`);
    if (bytes.length <= LIMITS[name]) return blob;
  }
  throw new CropError(`The ${name} is too large to send, even at low quality. Choose a simpler picture.`);
}

export interface AvatarFrames {
  /** The portrait's frame in the picture; null to send the square alone, cut from a stored portrait. */
  readonly portrait: Frame | null;
  /** The square's frame in the portrait. */
  readonly square: Frame;
}

/**
 * The files an avatar sends. With a portrait frame, `picture` is the player's own and both crops
 * are cut from it (the square from inside the portrait's frame, at the picture's own sharpness);
 * without, `picture` is the stored portrait and only the square is cut.
 */
export async function cutAvatar(io: PictureIo, picture: Picture, frames: AvatarFrames): Promise<{ readonly square: Blob; readonly portrait: Blob | null }> {
  const squareOut = { width: SQUARE_SIDE, height: SQUARE_SIDE };
  if (frames.portrait === null) {
    return { square: await crop(io, picture, 'square', cutRect(frames.square, picture), squareOut), portrait: null };
  }
  const problem = portraitProblem(frames.portrait, picture);
  if (problem) throw new CropError(problem);
  const portrait = await crop(io, picture, 'portrait', cutRect(frames.portrait, picture), outputSize(cutRect(frames.portrait, picture)));
  const square = await crop(io, picture, 'square', cutRect(composeFrames(frames.portrait, frames.square), picture), squareOut);
  return { square, portrait };
}
