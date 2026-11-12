/**
 * A WebP file read for its size and for anything it carries beside its picture, as a pure function of its bytes: shared by the functions that store a small picture
 * (avatar, and trophy-art), so there is one reading of the format and every file stored passes it. How and why it refuses is described in avatar/core.ts's header.
 */
export type Verdict<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string };
const refuse = (why: string): Verdict<never> => ({ ok: false, why });

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
const u32 = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)) + b[at + 3]! * 2 ** 24;
const u24 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);

/** The extended header's flags for what an avatar is sent without. */
const FLAGS = { icc: 0x20, exif: 0x08, xmp: 0x04, animation: 0x02 } as const;

/** A WebP's width and height, or why it is refused. */
export function readWebp(bytes: Uint8Array): Verdict<{ width: number; height: number }> {
  if (bytes.length < 20 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') return refuse('is not a WebP');
  if (u32(bytes, 4) + 8 !== bytes.length) return refuse('has bytes outside its picture');
  let at = 12;
  let header: { width: number; height: number; alpha: boolean } | null = null;
  let alpha = false;
  let picture: { width: number; height: number } | null = null;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) return refuse('has bytes outside its picture');
    const kind = fourcc(bytes, at);
    const size = u32(bytes, at + 4);
    const data = at + 8;
    const next = data + size + (size % 2);
    if (next > bytes.length) return refuse('is not a WebP');
    if (size % 2 && bytes[data + size] !== 0) return refuse('has bytes outside its picture');
    if (kind === 'EXIF' || kind === 'XMP ') return refuse(`carries metadata (${kind.trim()}), which an avatar is sent without`);
    if (kind === 'VP8X') {
      if (at !== 12 || size !== 10) return refuse('is not a WebP');
      const flags = bytes[data]!;
      if (flags & (FLAGS.exif | FLAGS.xmp)) return refuse(`carries metadata (${flags & FLAGS.exif ? 'EXIF' : 'XMP'}), which an avatar is sent without`);
      if (flags & FLAGS.animation) return refuse('is animated');
      if (flags & FLAGS.icc) return refuse('carries a part an avatar does not need (ICCP)');
      header = { width: u24(bytes, data + 4) + 1, height: u24(bytes, data + 7) + 1, alpha: (flags & 0x10) !== 0 };
    } else if (kind === 'ALPH') {
      if (!header?.alpha || alpha || picture || size === 0) return refuse('is not a WebP');
      alpha = true;
    } else if (kind === 'VP8 ' || kind === 'VP8L') {
      if (picture) return refuse('holds more than one picture');
      if (kind === 'VP8 ') {
        // A key frame (the tag's low bit clear), then its start code.
        if (size < 10 || (bytes[data]! & 1) !== 0 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return refuse('is not a WebP');
        picture = { width: (bytes[data + 6]! | (bytes[data + 7]! << 8)) & 0x3fff, height: (bytes[data + 8]! | (bytes[data + 9]! << 8)) & 0x3fff };
      } else {
        if (size < 5 || bytes[data] !== 0x2f || alpha) return refuse('is not a WebP');
        const bits = u32(bytes, data + 1);
        // Version 0, the only one there is.
        if (Math.floor(bits / 2 ** 29) !== 0) return refuse('is not a WebP');
        picture = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
    } else {
      return refuse(`carries a part an avatar does not need (${kind.trim()})`);
    }
    at = next;
  }
  if (!picture) return refuse('is not a WebP');
  if (header && (header.width !== picture.width || header.height !== picture.height)) return refuse('says two sizes');
  return { ok: true, value: picture };
}

