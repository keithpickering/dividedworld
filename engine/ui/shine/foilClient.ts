/**
 * The page's side of the foil worker (docs/plans/2026-11-06-shine-design.md section 6; the messages are in foilProtocol.ts, the
 * worker's side in foilServe.ts): a host hands its `<canvas>` over once (`adoptFoil`, which transfers control of it to an
 * OffscreenCanvas in a worker) and then posts draws instead of painting. The loop (loop.ts) still decides when a host draws, computes
 * its light on the main thread and counts its draws; only the render and the full-canvas draw, which were most of the main thread's
 * work during a busy scroll, move to the worker. A transferred canvas can never be drawn on from the page again, nor transferred a
 * second time, so a host that needs one afterward is given a fresh element (a React `key`), and adopting an element twice throws.
 *
 * One worker serves every canvas on the page. It starts with the first adoption and ends with the last `drop`. A frame's draws are
 * batched: the first draw of a frame queues a microtask and the draws that follow join it, so one `frame` message carries them all
 * and the worker sizes and draws a frame's canvases in one task. A `free` or `drop` takes the canvas's waiting draw out of the batch,
 * so no draw can reach the worker after the canvas was let go and size it again.
 *
 * `offscreenFoils()` says whether the browser can do this at all (a worker, an OffscreenCanvas, and a canvas element that can hand
 * control over); where it cannot, the host draws on the main thread as it always did, and the look and motion are the same. A worker
 * that fails to start or throws is logged (`console.error`); the canvases it holds stay as they were and the posts' words stay
 * readable over whatever is under them.
 *
 * `setFoilWorker` is a seam for a story, which runs its own worker entry (the foil server plus its probes). `foilProbe` is for tests
 * and stories only: the application reads nothing back.
 *
 * Engine code: it names no card and no instance.
 */
import type { Band } from './band.ts';
import type { Box } from './foil.ts';
import type { FoilDraw, FoilSpec, FromWorker, ProbeAsk } from './foilProtocol.ts';
import type { Light } from './light.ts';

export interface FoilHandle {
  /** Queue this canvas's draw in the frame's batch; `now` is the frame's timestamp. */
  draw(spec: FoilSpec, key: string, box: Box, density: number, light: Light, band: Band | null, now: number, idle: boolean): void;
  /** The canvas leaves view: the worker releases its foils and sets it to 0 by 0. The next draw sizes it again. */
  free(): void;
  /** The canvas is done with. The last drop ends the worker. */
  drop(): void;
}

/** Whether this browser can draw a foil in a worker: a Worker, an OffscreenCanvas, and a canvas element that can hand over control. */
export function offscreenFoils(): boolean {
  return typeof Worker === 'function' && typeof OffscreenCanvas !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
}

const defaultWorker = (): Worker => new Worker(new URL('./foilWorker.ts', import.meta.url), { type: 'module' });
let make: () => Worker = defaultWorker;
/** A story's own worker entry (null: the default). It applies to the next worker started. */
export function setFoilWorker(maker: (() => Worker) | null): void { make = maker ?? defaultWorker; }

let worker: Worker | null = null;
let nextId = 1;
/* The canvases the worker holds, by id, and the id of each; every element ever adopted, since none can be adopted twice. */
const live = new Map<number, HTMLCanvasElement>();
const idOfCanvas = new WeakMap<HTMLCanvasElement, number>();
const adopted = new WeakSet<HTMLCanvasElement>();
let pending: FoilDraw[] = [];
let scheduled = false;

const send = (message: object, transfer: Transferable[] = []): void => { worker?.postMessage(message, transfer); };

function flush(): void {
  scheduled = false;
  const draws = pending;
  pending = [];
  if (draws.length === 0 || !worker) return;
  try { send({ kind: 'frame', t: draws[0]!.now, draws }); } catch (err) { console.error(err); }
}

function start(): Worker {
  if (worker) return worker;
  const w = make();
  w.addEventListener('error', (e) => {
    const where = e.filename ? ` (${e.filename}:${e.lineno})` : '';
    console.error(`the foil worker failed: ${e.message || 'no message'}${where}`);
  });
  w.addEventListener('message', (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m?.kind === 'probe') answers.get(m.nonce)?.(m);
  });
  worker = w;
  return w;
}

export function adoptFoil(canvas: HTMLCanvasElement): FoilHandle {
  if (adopted.has(canvas)) throw new Error('foil: this canvas was already handed to the worker; a transferred canvas cannot be transferred again, so give the host a new element');
  /* Transferring first: if the browser refuses, nothing is half done. */
  const offscreen = canvas.transferControlToOffscreen();
  adopted.add(canvas);
  const id = nextId++;
  live.set(id, canvas);
  idOfCanvas.set(canvas, id);
  start();
  send({ kind: 'adopt', id, canvas: offscreen }, [offscreen]);

  const forget = (): void => { pending = pending.filter((d) => d.id !== id); };
  return {
    draw(spec, key, box, density, light, band, now, idle) {
      if (!live.has(id)) return;
      pending.push({ id, spec, key, box, density, light, band, now, idle });
      if (!scheduled) { scheduled = true; queueMicrotask(flush); }
    },
    free() {
      if (!live.has(id)) return;
      forget();
      send({ kind: 'free', id });
    },
    drop() {
      if (!live.has(id)) return;
      forget();
      live.delete(id);
      idOfCanvas.delete(canvas);
      if (live.size === 0) {
        worker?.terminate();
        worker = null;
        pending = [];
        answers.clear();
        return;
      }
      send({ kind: 'drop', id });
    },
  };
}

/* Probe asks in flight, by nonce. */
const answers = new Map<number, (m: FromWorker) => void>();
let nonce = 0;
function ask<A extends ProbeAsk['ask']>(question: Extract<ProbeAsk, { ask: A }>): Promise<Extract<FromWorker, { ask: A }> | null> {
  const w = worker;
  if (!w) return Promise.resolve(null);
  return new Promise((resolve) => {
    const n = ++nonce;
    answers.set(n, (m) => { answers.delete(n); resolve(m as Extract<FromWorker, { ask: A }>); });
    w.postMessage({ kind: 'probe', nonce: n, ...question });
  });
}

/** For tests and stories only: what the worker holds and how long it took, which the page cannot read off a transferred canvas. */
export const foilProbe = {
  idOf: (canvas: HTMLCanvasElement): number | undefined => idOfCanvas.get(canvas),
  worker: (): Worker | null => worker,
  /** Ends the worker and forgets every canvas, so a test starts from a page that adopted nothing. */
  reset(): void {
    worker?.terminate();
    worker = null;
    live.clear(); pending = []; scheduled = false; answers.clear();
  },
  /** Every canvas the worker holds, with the size its backing store has now. */
  async sizes(): Promise<Map<HTMLCanvasElement, { w: number; h: number }>> {
    const out = new Map<HTMLCanvasElement, { w: number; h: number }>();
    const a = await ask({ ask: 'sizes' });
    for (const s of a?.sizes ?? []) { const c = live.get(s.id); if (c) out.set(c, { w: s.width, h: s.height }); }
    return out;
  },
  /** The worker's own time in each of its last `n` frames (at most 600), oldest first, in ms, and how many frames it has drawn in all. */
  async work(n: number): Promise<{ batches: number; work: number[] }> {
    const a = await ask({ ask: 'work', n });
    return { batches: a?.batches ?? 0, work: [...(a?.work ?? [])] };
  },
  /** One canvas's pixels as the worker holds them; null where it holds none. */
  async pixels(canvas: HTMLCanvasElement): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
    const id = idOfCanvas.get(canvas);
    if (id === undefined) return null;
    const a = await ask({ ask: 'pixels', id });
    return a?.data ? { width: a.width, height: a.height, data: a.data } : null;
  },
};
