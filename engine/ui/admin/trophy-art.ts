/**
 * A trophy's picture, made in the browser from the file an admin chose (the trophies admin page; the trophy-art function holds the same bounds): drawn down to 48 pixels
 * on its longest side (never up, and its shape kept), encoded as a WebP, its color profile dropped as an avatar's is (the server refuses one), and held to the same
 * 16 KB, trying a lower quality until it fits. Only a picture's own chunks are sent: a canvas re-encodes pixels alone, and `webpProblem` reads the result before anything
 * leaves the page. The browser's own io (picture.ts) decodes and encodes; a test gives its own.
 */
import { CropError, type PictureIo } from '../profile-edit/crops.ts';
import { stripColorProfile, webpProblem, webpSize } from '../profile-edit/webp.ts';

/** The bounds supabase/functions/trophy-art/core.ts holds a trophy's picture to. */
export const TROPHY_ART = { side: 48, bytes: 16 * 1024 } as const;
const QUALITIES = [0.92, 0.8, 0.65, 0.5, 0.35] as const;

export async function trophyArt(io: PictureIo, file: Blob): Promise<Blob> {
  const picture = await io.loadFile(file);
  try {
    const k = Math.min(1, TROPHY_ART.side / Math.max(picture.width, picture.height));
    const out = { width: Math.max(1, Math.round(picture.width * k)), height: Math.max(1, Math.round(picture.height * k)) };
    for (const quality of QUALITIES) {
      const encoded = await io.encode(picture, { x: 0, y: 0, width: picture.width, height: picture.height }, out, quality);
      const made = new Uint8Array(await encoded.arrayBuffer());
      const bytes = stripColorProfile(made);
      const problem = webpProblem(bytes);
      if (problem === 'is not a WebP') throw new CropError('This browser did not make a WebP picture, so nothing was sent. Try another browser.');
      if (problem) throw new CropError(`The picture ${problem}, so nothing was sent.`);
      const size = webpSize(bytes);
      if (!size || size.width !== out.width || size.height !== out.height) throw new CropError('The picture came out a different size than asked, so nothing was sent.');
      if (bytes.length <= TROPHY_ART.bytes) return bytes === made ? encoded : new Blob([bytes as BlobPart], { type: 'image/webp' });
    }
    throw new CropError(`The picture is too large even at the lowest quality (${TROPHY_ART.bytes / 1024} KB at most), so nothing was sent. Choose a simpler picture.`);
  } finally {
    picture.release();
  }
}
