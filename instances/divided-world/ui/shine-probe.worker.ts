/**
 * The busy story's foil worker (instances/divided-world/ui/Shine.board.stories.tsx gives it to `setFoilWorker`): the engine's foil
 * server plus the story's instruments, which have to run on this thread because a Feelin' Fab is drawn here and the page cannot see
 * it. Story-only: the application's worker is engine/ui/shine/foilWorker.ts.
 *
 * Raster: while the page asks for it, the pixels each batch rasters are counted around the batch (shine-probes.ts, on this scope's
 * `OffscreenCanvasRenderingContext2D`) and kept by the batch's `t`, the animation frame's timestamp, so the page adds them to its own
 * count of the same frame. Not asked, nothing is patched and a batch costs what it costs.
 *
 * Poisons, each planted to see its check go red (e2e/shine.spec.ts): `slow-worker` makes every batch take 25 ms more; `keep` makes
 * one canvas ignore being freed (a width or height of 0), which the buffer check names.
 */
import { serveFoils, type FoilScope } from '../../../engine/ui/shine/foilServe.ts';
import { countRaster, type Counter, type RasterFrame, type StoryAnswer, type StoryAsk } from './shine-probes.ts';

const scope = self as unknown as FoilScope & { postMessage(m: unknown): void };
let counter: Counter | null = null;
const frames = new Map<number, { px: number; high: number }>();
/** The most batches kept: a few seconds of a scroll at the display's rate. */
const KEEP = 4000;
let slow = false;

const served = serveFoils(scope, {
  frame(t, run) {
    if (slow) for (const until = performance.now() + 25; performance.now() < until;) { /* busy */ }
    if (!counter) { run(); return; }
    counter.take();
    run();
    const r = counter.take();
    const had = frames.get(t);
    frames.set(t, { px: (had?.px ?? 0) + r.px, high: (had?.high ?? 0) + r.high });
    if (frames.size > KEEP) frames.delete(frames.keys().next().value!);
  },
});

function ignoreZero(canvas: OffscreenCanvas): void {
  for (const key of ['width', 'height'] as const) {
    const d = Object.getOwnPropertyDescriptor(OffscreenCanvas.prototype, key)!;
    Object.defineProperty(canvas, key, { configurable: true, get() { return d.get!.call(this) as number; }, set(v: number) { if (v === 0) return; d.set!.call(this, v); } });
  }
}

scope.addEventListener('message', (event) => {
  const m = event.data as Partial<StoryAsk> | null;
  if (typeof m !== 'object' || m === null || m.kind !== 'story') return;
  if (m.what === 'raster') {
    if (m.on) { frames.clear(); counter ??= countRaster(OffscreenCanvasRenderingContext2D.prototype as unknown as CanvasRenderingContext2D); }
    else { counter?.stop(); counter = null; }
  } else if (m.what === 'frames') {
    const out: RasterFrame[] = [...frames].map(([t, v]) => ({ t, px: v.px, high: v.high }));
    scope.postMessage({ kind: 'story', nonce: m.nonce as number, frames: out } satisfies StoryAnswer);
  } else if (m.what === 'poison') {
    if (m.poison === 'slow-worker') slow = true;
    else if (m.poison === 'keep') { const c = served.canvas(m.id as number); if (c) ignoreZero(c); }
  }
});
