/**
 * The ICO and PNG reading an instance's icons need, with no browser and no dependency beyond Node.
 *
 * Shared by tools/check-icons.mjs (which reads the committed files), tools/test-icons.mjs (which
 * writes its fixtures with writeIco) and tools/make-icons.mjs (which writes the committed ICO).
 * The design is docs/plans/2026-11-02-favicon-design.md: an ICO of three PNG images and an opaque
 * home-screen PNG.
 *
 * The PNG reader reads what those files are, 8-bit and non-interlaced, and throws, naming the
 * kind, on anything else. A 16-bit or palette sprite from a later redraw must fail the check by
 * name: a reader that guessed at it could call a transparent pixel opaque.
 */
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Samples per pixel for each PNG color type this reader takes; 3 (palette) is refused. */
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** SHA-256, hex. */
export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Whether a buffer starts with the PNG signature. */
export function isPng(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

/** The chunks of a PNG, in order: `{ type, data }`. Throws on a truncated chunk. */
function chunks(buffer) {
  const out = [];
  let at = 8;
  while (at < buffer.length) {
    if (at + 8 > buffer.length) throw new Error(`PNG: a chunk header runs past the end, at byte ${at}`);
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    if (at + 12 + length > buffer.length) throw new Error(`PNG: the ${type} chunk runs past the end`);
    out.push({ type, data: buffer.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
    if (type === 'IEND') break;
  }
  return out;
}

/**
 * A PNG's IHDR: `{ width, height, bitDepth, colorType, interlace }`. Throws on a buffer that is
 * not a PNG or has no IHDR first.
 */
export function pngInfo(buffer) {
  if (!isPng(buffer)) throw new Error('not a PNG: the signature is missing');
  const [first] = chunks(buffer);
  if (!first || first.type !== 'IHDR' || first.data.length !== 13) throw new Error('PNG: the first chunk is not a 13-byte IHDR');
  const d = first.data;
  return { width: d.readUInt32BE(0), height: d.readUInt32BE(4), bitDepth: d[8], colorType: d[9], interlace: d[12] };
}

/** The Paeth predictor, as the PNG specification defines it. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * A PNG's samples with its row filters undone: `{ info, channels, samples }`, where `samples`
 * holds `width * channels` bytes per row, rows in order. Reads 8-bit, non-interlaced grayscale,
 * RGB, gray-alpha and RGBA, and throws, naming what it found, on any other kind, and on a tRNS
 * chunk, which would make a color transparent that no alpha sample says is.
 */
export function pngSamples(buffer) {
  const info = pngInfo(buffer);
  if (info.bitDepth !== 8) throw new Error(`PNG: bit depth ${info.bitDepth} is not read here; only 8-bit images are`);
  if (info.interlace !== 0) throw new Error('PNG: an interlaced (Adam7) image is not read here');
  const channels = CHANNELS[info.colorType];
  if (!channels) {
    const kind = info.colorType === 3 ? 'palette (color type 3)' : `color type ${info.colorType}`;
    throw new Error(`PNG: a ${kind} image is not read here; only grayscale, RGB, gray-alpha and RGBA are`);
  }
  const all = chunks(buffer);
  if (all.some((c) => c.type === 'tRNS')) throw new Error('PNG: a tRNS chunk (a transparent color) is not read here');

  const raw = zlib.inflateSync(Buffer.concat(all.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = info.width * channels;
  if (raw.length < info.height * (stride + 1)) throw new Error(`PNG: the image data holds ${raw.length} bytes, short of ${info.height} rows of ${stride + 1}`);
  const samples = Buffer.alloc(info.height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < info.height; y++) {
    const base = y * (stride + 1);
    const filter = raw[base];
    const line = samples.subarray(y * stride, (y + 1) * stride);
    raw.copy(line, 0, base + 1, base + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      switch (filter) {
        case 0: break;
        case 1: line[i] = (line[i] + a) & 0xff; break;
        case 2: line[i] = (line[i] + b) & 0xff; break;
        case 3: line[i] = (line[i] + ((a + b) >> 1)) & 0xff; break;
        case 4: line[i] = (line[i] + paeth(a, b, c)) & 0xff; break;
        default: throw new Error(`PNG: row ${y} has filter type ${filter}, which is not one of the five`);
      }
    }
    prev = line;
  }
  return { info, channels, samples };
}

/**
 * Whether every pixel of a PNG is opaque: every alpha sample 255, and true outright for a color
 * type without alpha. Reads what pngSamples reads, and throws on what it refuses.
 */
export function pngOpaque(buffer) {
  const { info, channels, samples } = pngSamples(buffer);
  if (info.colorType !== 4 && info.colorType !== 6) return true;
  for (let i = channels - 1; i < samples.length; i += channels) if (samples[i] !== 255) return false;
  return true;
}

/**
 * An ICO's images: `[{ width, height, bytes }]`, with a width or height of 0 in the directory read
 * as 256. Throws, naming what it found, on a header that is not an ICO, an entry that runs past
 * the file, or an image that is not a PNG.
 */
export function readIco(buffer) {
  if (buffer.length < 6) throw new Error(`not an ICO: ${buffer.length} bytes is shorter than its header`);
  const reserved = buffer.readUInt16LE(0);
  const type = buffer.readUInt16LE(2);
  if (reserved !== 0 || type !== 1) throw new Error(`not an ICO: the header reads reserved ${reserved}, type ${type} (an ICO is 0, 1)`);
  const count = buffer.readUInt16LE(4);
  if (6 + count * 16 > buffer.length) throw new Error(`ICO: a directory of ${count} entries runs past the file`);
  const out = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const width = buffer[e] || 256;
    const height = buffer[e + 1] || 256;
    const length = buffer.readUInt32LE(e + 8);
    const offset = buffer.readUInt32LE(e + 12);
    if (offset + length > buffer.length) throw new Error(`ICO: image ${i + 1} (${width}x${height}) runs past the file: offset ${offset}, length ${length}, file ${buffer.length}`);
    const bytes = buffer.subarray(offset, offset + length);
    if (!isPng(bytes)) throw new Error(`ICO: image ${i + 1} (${width}x${height}) is not a PNG (a BMP image, most likely)`);
    out.push({ width, height, bytes });
  }
  return out;
}

/** An ICO holding these PNGs, in order; a 256px side is written as 0, as the format says. */
export function writeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach((png, i) => {
    const { width, height } = pngInfo(png);
    const e = i * 16;
    dir[e] = width >= 256 ? 0 : width;
    dir[e + 1] = height >= 256 ? 0 : height;
    dir[e + 2] = 0; // no palette
    dir[e + 3] = 0; // reserved
    dir.writeUInt16LE(1, e + 4); // color planes
    dir.writeUInt16LE(32, e + 6); // bits per pixel
    dir.writeUInt32LE(png.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...pngs]);
}
