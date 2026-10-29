/** Hand-made WebP files for the cropper's tests: just enough of the format for a reader of chunks. jsdom has no canvas encoder. */
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const chunk = (kind: string, data: readonly number[]) => [...ascii(kind), ...le32(data.length), ...data, ...(data.length % 2 ? [0] : [])];

export interface WebpOptions {
  /** Add an EXIF chunk (and the header flag that says so). */
  readonly exif?: boolean;
  /** Add an ICCP chunk (and the header flag), as a browser's canvas does. */
  readonly icc?: boolean;
  /** Bytes of padding inside the picture chunk, to make the file as big as a test needs. */
  readonly pad?: number;
}

export function webpBytes(width: number, height: number, options: WebpOptions = {}): Uint8Array {
  const pad = Array.from({ length: options.pad ?? 0 }, () => 0);
  const picture = chunk('VP8 ', [0x10, 0, 0, 0x9d, 0x01, 0x2a, width & 255, width >> 8, height & 255, height >> 8, 0, 0, ...pad]);
  const flags = (options.exif ? 0x08 : 0) | (options.icc ? 0x20 : 0);
  const chunks = flags
    ? [
        ...chunk('VP8X', [flags, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]),
        ...(options.icc ? chunk('ICCP', Array.from({ length: 456 }, (_, i) => i & 255)) : []),
        ...picture,
        ...(options.exif ? chunk('EXIF', [0x49, 0x49, 0x2a, 0]) : []),
      ]
    : picture;
  const body = [...ascii('WEBP'), ...chunks];
  return Uint8Array.from([...ascii('RIFF'), ...le32(body.length), ...body]);
}

export const webpBlob = (width: number, height: number, options?: WebpOptions) => new Blob([webpBytes(width, height, options) as BlobPart], { type: 'image/webp' });
