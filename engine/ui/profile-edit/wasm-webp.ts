/**
 * The WebAssembly WebP encoder (@jsquash/webp, libwebp compiled), for browsers whose canvas cannot
 * write WebP (Safari, and so every iPhone browser: `toBlob` gives a PNG there). It is loaded only
 * when needed, so it is not in the main bundle, and it encodes from the canvas's pixels alone.
 */
import type { Size } from './frames.ts';

type Encode = (data: ImageData, options: { quality: number }) => Promise<ArrayBuffer>;

/* The encoder, fetched, compiled and initialized once; a failure is forgotten so the next encode tries again. */
let ready: Promise<Encode> | null = null;

function load(): Promise<Encode> {
  ready ??= (async () => {
    const [{ init, default: encode }, wasm] = await Promise.all([
      import('@jsquash/webp/encode.js'),
      import('@jsquash/webp/codec/enc/webp_enc.wasm?url'),
    ]);
    const response = await fetch(wasm.default);
    if (!response.ok) throw new Error('the encoder could not be fetched');
    const module = await WebAssembly.compile(await response.arrayBuffer());
    /* The package's typings list only the options form of `init`; it also takes a compiled module first. */
    await (init as unknown as (m: WebAssembly.Module) => Promise<unknown>)(module);
    return encode as Encode;
  })().catch((e: unknown) => { ready = null; throw e; });
  return ready;
}

export async function encodeWebpWasm(canvas: HTMLCanvasElement, out: Size, quality: number): Promise<Blob> {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const pixels = ctx.getImageData(0, 0, out.width, out.height);
  const encode = await load();
  const buffer = await encode(pixels, { quality: Math.round(quality * 100) });
  return new Blob([buffer], { type: 'image/webp' });
}
