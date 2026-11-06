/**
 * The page's side of the foil worker (docs/plans/2026-11-06-shine-design.md section 6; the messages are in foilProtocol.ts, the
 * worker's side in foilServe.ts): a host hands its `<canvas>` over once (`adoptFoil`, which transfers control of it to an
 * OffscreenCanvas in a worker) and then posts draws instead of painting. The loop (loop.ts) still decides when a host draws, computes
 * its light on the main thread and counts its draws; only the render and the full-canvas draw, which were most of the main thread's
 * work during a busy scroll, move to the worker. A transferred canvas can never be drawn on from the page again, nor transferred a
 * second time, so a host that needs one afterward is given a fresh element (a React `key`), and adopting an element twice throws.
 *
 * One worker serves every canvas. It starts with the first adoption, and ends `IDLE_MS` after the last `drop` (a move to another thread
 * reuses it; a new adoption cancels the end). A frame's draws are batched: the first draw of a frame queues a microtask and the draws
 * that follow join it, so one `frame` message carries them all and the worker sizes and draws a frame's canvases in one task. One batch
 * is in flight at a time: the worker acknowledges each, and while one is unacknowledged a canvas's newer draw replaces its waiting one
 * (latest wins) and the batch goes on the ack, so a slow worker falls behind by frames dropped, never by a backlog that keeps painting
 * stale light. A `free` or `drop` goes at once and takes the canvas's waiting draw out, so no draw can reach the worker after the canvas
 * was let go and size it again.
 *
 * `offscreenFoils()` says whether the browser can do this at all (a worker, an OffscreenCanvas, and a canvas element that can hand
 * control over); where it cannot, the host draws on the main thread as it always did, and the look and motion are the same. A worker
 * that fails to start throws from `adoptFoil` before anything is transferred, so the host draws on the page; one that fails to load (an `error`
 * before it has answered) or sends a message that cannot be read is logged and let go: nothing is posted to it again, its canvases' handles go dead, probe asks waiting on it settle with no
 * answer, and the canvases it held stay as they were, the posts' words readable over whatever is under them.
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

/** How long the worker stays after its last canvas is dropped (a move to another thread starts the next page's posts on the same one). */
export const IDLE_MS = 30_000;

let worker: Worker | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;
/* The canvases the worker holds, by id, and the id of each; every element ever transferred, since none can be transferred twice. */
const live = new Map<number, HTMLCanvasElement>();
const idOfCanvas = new WeakMap<HTMLCanvasElement, number>();
const adopted = new WeakSet<HTMLCanvasElement>();
/* The draws waiting for the next batch, one per canvas (the latest), and whether a batch is in flight (sent, not yet acknowledged). */
let pending = new Map<number, FoilDraw>();
let scheduled = false;
let inFlight = false;

/* Probe asks in flight, by nonce; settled with no answer when the worker ends. */
const answers = new Map<number, (m: FromWorker | null) => void>();
let nonce = 0;
const settleAsks = (): void => { for (const settle of [...answers.values()]) settle(null); answers.clear(); };

/** Whether this element's control was handed to a worker: it can then never be drawn on from the page, nor handed over again. */
export function isTransferred(canvas: HTMLCanvasElement): boolean { return adopted.has(canvas); }

const send = (message: object, transfer: Transferable[] = []): void => { worker?.postMessage(message, transfer); };

/**
 * Sends the waiting draws as one batch, unless one is already in flight: the worker acknowledges each batch, and a slow worker is never
 * handed a backlog (it would fall further behind the light, and keep painting stale frames after the scroll). What arrives meanwhile
 * replaces the canvas's waiting draw, and goes on the ack.
 */
function sendBatch(): void {
  if (inFlight || pending.size === 0 || !worker) return;
  const draws = [...pending.values()];
  pending = new Map();
  try { send({ kind: 'frame', t: Math.max(...draws.map((d) => d.now)), draws }); inFlight = true; } catch (err) { console.error(err); }
}

function flush(): void {
  scheduled = false;
  sendBatch();
}

/** The worker is no more (it failed, or it idled out): nothing waits on it any more. */
function end(w: Worker): void {
  if (worker !== w) return;
  clearTimeout(idle); idle = undefined;
  w.terminate();
  worker = null;
  pending = new Map(); inFlight = false; scheduled = false;
  /* Its canvases went with it: their handles are dead (live no longer names them), and cannot post into the next worker or hold off its idle end. */
  for (const c of live.values()) idOfCanvas.delete(c);
  live.clear();
  settleAsks();
}

function start(): Worker {
  clearTimeout(idle); idle = undefined;
  if (worker) return worker;
  const w = make();
  /* Heard from: it loaded and answered. An `error` before that is a load failure, and the worker is let go; frames are not posted to a dead one, and what waits on it settles. Afterwards an `error` is one uncaught throw, logged, and the worker serves on. */
  let heard = false;
  w.addEventListener('error', (e) => {
    const where = e.filename ? ` (${e.filename}:${e.lineno})` : '';
    console.error(`the foil worker failed: ${e.message || 'no message'}${where}`);
    if (!heard) end(w);
  });
  w.addEventListener('messageerror', () => { console.error('the foil worker sent a message that could not be read'); end(w); });
  w.addEventListener('message', (e: MessageEvent<FromWorker>) => {
    if (worker !== w) return;
    heard = true;
    const m = e.data;
    if (m?.kind === 'ack') { inFlight = false; sendBatch(); } else if (m?.kind === 'probe') answers.get(m.nonce)?.(m);
  });
  worker = w;
  return w;
}

/** The last canvas is gone: the worker waits a while for the next page's posts, then ends. */
function idleSoon(): void {
  const w = worker;
  if (!w || live.size > 0) return;
  clearTimeout(idle);
  idle = setTimeout(() => { if (live.size === 0) end(w); }, IDLE_MS);
}

export function adoptFoil(canvas: HTMLCanvasElement): FoilHandle {
  if (adopted.has(canvas)) throw new Error('foil: this canvas was already handed to the worker; a transferred canvas cannot be transferred again, so give the host a new element');
  /* The worker first, then the transfer, and nothing is recorded until both worked: a failure leaves the canvas as it was, so the host can draw it on the page. */
  start();
  let offscreen: OffscreenCanvas;
  try { offscreen = canvas.transferControlToOffscreen(); } catch (err) { idleSoon(); throw err; }
  adopted.add(canvas);
  const id = nextId++;
  live.set(id, canvas);
  idOfCanvas.set(canvas, id);
  send({ kind: 'adopt', id, canvas: offscreen }, [offscreen]);

  return {
    draw(spec, key, box, density, light, band, now, idle) {
      if (!live.has(id) || !worker) return;
      pending.set(id, { id, spec, key, box, density, light, band, now, idle });
      if (!scheduled) { scheduled = true; queueMicrotask(flush); }
    },
    free() {
      if (!live.has(id)) return;
      pending.delete(id);
      send({ kind: 'free', id });
    },
    drop() {
      if (!live.has(id)) return;
      pending.delete(id);
      live.delete(id);
      idOfCanvas.delete(canvas);
      send({ kind: 'drop', id });
      idleSoon();
    },
  };
}

function ask<A extends ProbeAsk['ask']>(question: Extract<ProbeAsk, { ask: A }>): Promise<Extract<FromWorker, { ask: A }> | null> {
  const w = worker;
  if (!w) return Promise.resolve(null);
  return new Promise((resolve) => {
    const n = ++nonce;
    answers.set(n, (m) => { answers.delete(n); resolve(m as Extract<FromWorker, { ask: A }> | null); });
    w.postMessage({ kind: 'probe', nonce: n, ...question });
  });
}

/** For tests and stories only: what the worker holds and how long it took, which the page cannot read off a transferred canvas. */
export const foilProbe = {
  idOf: (canvas: HTMLCanvasElement): number | undefined => idOfCanvas.get(canvas),
  worker: (): Worker | null => worker,
  /** Ends the worker and forgets every canvas, so a test starts from a page that adopted nothing. */
  reset(): void {
    if (worker) end(worker);
    clearTimeout(idle); idle = undefined;
    live.clear(); pending = new Map(); scheduled = false; inFlight = false; settleAsks();
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
