/**
 * A WebP file's chunks, read in the browser before anything is sent. The avatar function reads
 * the same bytes and refuses any file holding more than its picture (EXIF, XMP, a color profile,
 * an animation, an unknown chunk, bytes outside the RIFF); this is the same reading on this side,
 * so a file that would be refused is never sent, and a test can hold the encoder to it. A canvas
 * re-encodes pixels alone; this is the proof, not the hope.
 */

export interface WebpChunk {
  readonly kind: string;
  readonly size: number;
}

export type WebpRead =
  | { readonly ok: true; readonly chunks: readonly WebpChunk[]; /** The extended header's flags, null where the file has none. */ readonly flags: number | null; readonly data: ReadonlyMap<number, number> }
  | { readonly ok: false; readonly why: string };

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
const u32 = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)) + b[at + 3]! * 2 ** 24;
const u24 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);

/** The extended header's flags for what an avatar is sent without. */
const FLAGS = { icc: 0x20, exif: 0x08, xmp: 0x04, animation: 0x02, alpha: 0x10 } as const;

/** The chunks of a RIFF WebP in order, where the file is well formed; otherwise why not. */
export function webpChunks(bytes: Uint8Array): WebpRead {
  const notWebp = { ok: false, why: 'is not a WebP' } as const;
  if (bytes.length < 20 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') return notWebp;
  if (u32(bytes, 4) + 8 !== bytes.length) return { ok: false, why: 'has bytes outside its picture' };
  const chunks: WebpChunk[] = [];
  const data = new Map<number, number>();
  let flags: number | null = null;
  let at = 12;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) return { ok: false, why: 'has bytes outside its picture' };
    const kind = fourcc(bytes, at);
    const size = u32(bytes, at + 4);
    const next = at + 8 + size + (size % 2);
    if (next > bytes.length) return notWebp;
    if (size % 2 && bytes[at + 8 + size] !== 0) return { ok: false, why: 'has bytes outside its picture' };
    if (kind === 'VP8X' && flags === null && at === 12) flags = bytes[at + 8] ?? 0;
    data.set(chunks.length, at + 8);
    chunks.push({ kind, size });
    at = next;
  }
  return { ok: true, chunks, flags, data };
}

/** A WebP's picture size, or null where it cannot be read. */
export function webpSize(bytes: Uint8Array): { readonly width: number; readonly height: number } | null {
  const read = webpChunks(bytes);
  if (!read.ok) return null;
  const at = read.chunks.findIndex((c) => c.kind === 'VP8 ' || c.kind === 'VP8L');
  if (at < 0) return null;
  const start = read.data.get(at)!;
  if (read.chunks[at]!.kind === 'VP8 ') {
    if (read.chunks[at]!.size < 10) return null;
    return { width: (bytes[start + 6]! | (bytes[start + 7]! << 8)) & 0x3fff, height: (bytes[start + 8]! | (bytes[start + 9]! << 8)) & 0x3fff };
  }
  if (read.chunks[at]!.size < 5) return null;
  const bits = u32(bytes, start + 1);
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
}

/**
 * Why a file is more than a picture, or null where it is nothing else: only a picture's own
 * chunks pass (one VP8 or VP8L, an extended header of exactly its size, and one ALPH where the
 * header says alpha and before a lossy picture), with no metadata flag set.
 */
export function webpProblem(bytes: Uint8Array): string | null {
  const read = webpChunks(bytes);
  if (!read.ok) return read.why;
  let header: { width: number; height: number; alpha: boolean } | null = null;
  let alpha = false;
  let pictures = 0;
  for (const [i, chunk] of read.chunks.entries()) {
    const start = read.data.get(i)!;
    if (chunk.kind === 'EXIF' || chunk.kind === 'XMP ') return `carries metadata (${chunk.kind.trim()}), which an avatar is sent without`;
    if (chunk.kind === 'VP8X') {
      if (i !== 0 || chunk.size !== 10) return 'is not a WebP';
      const flags = bytes[start]!;
      if (flags & (FLAGS.exif | FLAGS.xmp)) return `carries metadata (${flags & FLAGS.exif ? 'EXIF' : 'XMP'}), which an avatar is sent without`;
      if (flags & FLAGS.animation) return 'is animated';
      if (flags & FLAGS.icc) return 'carries a part an avatar does not need (ICCP)';
      header = { width: u24(bytes, start + 4) + 1, height: u24(bytes, start + 7) + 1, alpha: (flags & FLAGS.alpha) !== 0 };
    } else if (chunk.kind === 'ALPH') {
      if (!header?.alpha || alpha || pictures > 0 || chunk.size === 0) return 'is not a WebP';
      alpha = true;
    } else if (chunk.kind === 'VP8 ' || chunk.kind === 'VP8L') {
      if (pictures > 0) return 'holds more than one picture';
      pictures += 1;
      if (chunk.kind === 'VP8 ') {
        if (chunk.size < 10 || (bytes[start]! & 1) !== 0 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) return 'is not a WebP';
      } else if (chunk.size < 5 || bytes[start] !== 0x2f || alpha || Math.floor(u32(bytes, start + 1) / 2 ** 29) !== 0) {
        return 'is not a WebP';
      }
    } else {
      return `carries a part an avatar does not need (${chunk.kind.trim()})`;
    }
  }
  const size = webpSize(bytes);
  if (pictures === 0 || !size) return 'is not a WebP';
  if (header && (header.width !== size.width || header.height !== size.height)) return 'says two sizes';
  return null;
}

/**
 * The file without its color profile. A browser's canvas writes its own sRGB profile (an ICCP
 * chunk and the header's flag for it) into the WebP it encodes, and an untagged picture is sRGB
 * already, so dropping it changes no pixel; the avatar function refuses any profile, whose text can
 * name its maker. Only the profile goes: an EXIF or XMP chunk, or any other part, stays for
 * `webpProblem` to refuse. A file without a profile comes back as it was.
 */
export function stripColorProfile(bytes: Uint8Array): Uint8Array {
  const read = webpChunks(bytes);
  if (!read.ok || read.flags === null || (read.flags & FLAGS.icc) === 0) return bytes;
  const out: number[] = [...bytes.subarray(0, 12)];
  let at = 12;
  for (const chunk of read.chunks) {
    const end = at + 8 + chunk.size + (chunk.size % 2);
    if (chunk.kind !== 'ICCP') {
      const piece = [...bytes.subarray(at, end)];
      if (chunk.kind === 'VP8X') piece[8] = piece[8]! & ~FLAGS.icc;
      out.push(...piece);
    }
    at = end;
  }
  const size = out.length - 8;
  out[4] = size & 255;
  out[5] = (size >> 8) & 255;
  out[6] = (size >> 16) & 255;
  out[7] = (size >>> 24) & 255;
  return Uint8Array.from(out);
}
