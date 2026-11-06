/**
 * The shine stories' instruments, shared by the page and the story's worker entry (shine-probe.worker.ts), because the foil is
 * drawn on both threads: a Feelin' Fab's canvas is drawn in a worker, a Glitter Bomb's on the page. Story-only: the application
 * imports none of this. Nothing here touches the DOM or a worker, so either thread can load it.
 *
 * `countRaster(proto)` counts the canvas pixels the 2D contexts of ONE prototype raster (`CanvasRenderingContext2D.prototype` on the
 * page, `OffscreenCanvasRenderingContext2D.prototype` in the worker): the area each clearRect, fillRect, putImageData and drawImage
 * covers, in the canvas's own px (its transform's scale applied), and a drawImage no larger than the clip it is drawn in when the clip
 * is a set of rects (`rect` then `clip`). The pixels a drawImage scales with 'high' smoothing quality are counted apart too: that
 * filter costs far more a pixel than bilinear. A browser rasters what a frame's draws cover when it produces the frame, and then
 * hands each changed canvas to the compositor; a frame that clears and redraws whole post-sized canvases on every shiny post in view,
 * or scales them at 'high', costs a slow machine its frame, which the loop's own time never shows (e2e/shine.spec.ts). It patches the
 * prototype from the call until `stop`.
 *
 * The messages are the story worker's own, beside the foil protocol's (the foil server ignores what it does not know).
 */

/** What a page asks of the story worker, and what it answers. */
export type StoryAsk =
  | { readonly kind: 'story'; readonly what: 'raster'; readonly on: boolean }
  | { readonly kind: 'story'; readonly what: 'frames'; readonly nonce: number }
  | { readonly kind: 'story'; readonly what: 'poison'; readonly poison: 'slow-worker' }
  | { readonly kind: 'story'; readonly what: 'poison'; readonly poison: 'keep'; readonly id: number };

/** The pixels one worker batch rastered, keyed by the batch's `t`: the animation frame's timestamp the page's own tick sees too. */
export interface RasterFrame { readonly t: number; readonly px: number; readonly high: number }
export type StoryAnswer = { readonly kind: 'story'; readonly nonce: number; readonly frames: readonly RasterFrame[] };

export interface Counter { take(): { px: number; high: number }; stop(): void }

export function countRaster(proto: CanvasRenderingContext2D): Counter {
  let total = 0, high = 0;
  const clips = new WeakMap<object, { pending: number; clip: number; stack: number[] }>();
  const of = (c: object) => { let s = clips.get(c); if (!s) { s = { pending: 0, clip: Infinity, stack: [] }; clips.set(c, s); } return s; };
  const scale = (c: CanvasRenderingContext2D) => { const m = c.getTransform(); return Math.abs(m.a * m.d - m.b * m.c); };
  const orig = {
    clearRect: proto.clearRect, fillRect: proto.fillRect, putImageData: proto.putImageData, drawImage: proto.drawImage,
    beginPath: proto.beginPath, rect: proto.rect, clip: proto.clip, save: proto.save, restore: proto.restore,
  };
  const area = (c: CanvasRenderingContext2D, w: number, h: number) => Math.min(Math.abs(w * h) * scale(c), c.canvas.width * c.canvas.height);
  proto.clearRect = function (this: CanvasRenderingContext2D, x, y, w, h) { total += area(this, w, h); orig.clearRect.call(this, x, y, w, h); };
  proto.fillRect = function (this: CanvasRenderingContext2D, x, y, w, h) { total += area(this, w, h); orig.fillRect.call(this, x, y, w, h); };
  proto.putImageData = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
    const img = a[0] as ImageData;
    total += img.width * img.height;
    (orig.putImageData as (...b: unknown[]) => void).apply(this, a);
  };
  proto.drawImage = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
    const n = a.length, img = a[0] as { width: number; height: number };
    const [w, h] = n >= 9 ? [a[7] as number, a[8] as number] : n >= 5 ? [a[3] as number, a[4] as number] : [img.width, img.height];
    const [sw, sh] = n >= 9 ? [a[3] as number, a[4] as number] : [img.width, img.height];
    const px = Math.min(area(this, w, h), of(this).clip);
    total += px;
    if (this.imageSmoothingEnabled && this.imageSmoothingQuality === 'high' && px > Math.abs(sw * sh) * 1.5) high += px;
    (orig.drawImage as (...b: unknown[]) => void).apply(this, a);
  };
  proto.beginPath = function (this: CanvasRenderingContext2D) { of(this).pending = 0; orig.beginPath.call(this); };
  proto.rect = function (this: CanvasRenderingContext2D, x, y, w, h) { of(this).pending += area(this, w, h); orig.rect.call(this, x, y, w, h); };
  proto.clip = function (this: CanvasRenderingContext2D, ...a: unknown[]) { const s = of(this); s.clip = Math.min(s.clip, s.pending); (orig.clip as (...b: unknown[]) => void).apply(this, a); };
  proto.save = function (this: CanvasRenderingContext2D) { const s = of(this); s.stack.push(s.clip); orig.save.call(this); };
  proto.restore = function (this: CanvasRenderingContext2D) { const s = of(this); s.clip = s.stack.pop() ?? Infinity; orig.restore.call(this); };
  return {
    take: () => { const t = { px: total, high }; total = 0; high = 0; return t; },
    stop: () => { Object.assign(proto, orig); },
  };
}
