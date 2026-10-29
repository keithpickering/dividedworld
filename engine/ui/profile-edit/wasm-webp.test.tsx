import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const init = vi.fn(async () => ({}));
const encode = vi.fn(async () => new ArrayBuffer(4));
vi.mock('@jsquash/webp/encode.js', () => ({ init, default: encode }));
vi.mock('@jsquash/webp/codec/enc/webp_enc.wasm?url', () => ({ default: '/enc.wasm' }));

const fakeCanvas = () => ({ getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }) }) }) as unknown as HTMLCanvasElement;

let compile: ReturnType<typeof vi.fn>;
let fetched: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  init.mockClear();
  encode.mockClear();
  compile = vi.fn(async () => ({}));
  fetched = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  vi.stubGlobal('fetch', fetched);
  vi.spyOn(WebAssembly, 'compile').mockImplementation(compile as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('the WebAssembly encoder', () => {
  test('is fetched and compiled once for two encodes', async () => {
    const { encodeWebpWasm } = await import('./wasm-webp.ts');
    const a = await encodeWebpWasm(fakeCanvas(), { width: 1, height: 1 }, 0.9);
    await encodeWebpWasm(fakeCanvas(), { width: 1, height: 1 }, 0.5);
    expect(a.type).toBe('image/webp');
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledTimes(2);
  });

  test('a failed load is tried again on the next encode', async () => {
    const { encodeWebpWasm } = await import('./wasm-webp.ts');
    fetched.mockResolvedValueOnce({ ok: false });
    await expect(encodeWebpWasm(fakeCanvas(), { width: 1, height: 1 }, 0.9)).rejects.toThrow();
    await encodeWebpWasm(fakeCanvas(), { width: 1, height: 1 }, 0.9);
    expect(compile).toHaveBeenCalledTimes(1);
  });
});
