/**
 * The page's side of the layer-build worker (ink-field design, section 5; the worker's side is buildWorker.ts, the build
 * itself build.ts). It follows the foil worker's pattern (engine/ui/shine/foilClient.ts), without importing it.
 *
 * `requestBuild(key, input, onDone)` asks for a band's picture; the key is `layerKey(...)`, which names the band and a
 * requester (`requester()` gives a fresh token, one for each Effect, so two Effects with the same layer are two builds that
 * neither replaces nor cancels). A band whose estimated work times the page's pace is under `QUICK_MS` is built on the main
 * thread at once, and `onDone` is called before `requestBuild` returns (the caller has its picture before its first frame).
 * The pace is this page's own number, sent nowhere: it starts at 1, and each finished build with an estimate of at least
 * 1ms moves it toward what the build measured over what was estimated (`ms`, from the injected clock), within `PACE_LEAST`
 * and `PACE_MOST`, so a slow device sends more to the worker and a fast one builds more at once. A heavy one goes to one worker for the page, started with the first
 * heavy build and ended `IDLE_MS` after the last one finished. There is one build out for a key at a time: a newer
 * request for the key replaces the waiting one, and the answer to the one out is dropped when a newer request waits
 * behind it (the newer one is sent then), so `onDone` hears the latest request only. `cancel(key)` (the post left the
 * viewport) drops the waiting build and ignores the answer to the one out; the key may be asked for again. A build's
 * buffers come back transferred: the worker keeps none, and the page owns them. `gridOf` (build.ts) turns the field
 * back into a Float32 `Grid`, which the main thread keeps for live strokes.
 *
 * Where there is no `Worker`, or it fails to start or to load, the build runs on the main thread in the next frame
 * (`requestAnimationFrame`, a timeout where there is none), and the worker is not tried again on this page.
 */
import { QUICK_MS, buildLayer, estimateWork, type BuildInput, type Built } from './build.ts';
import type { FromBuild, ToBuild } from './buildWorker.ts';

/** How long the worker stays after its last build finishes (a scroll to the next post starts the next build on it). */
export const IDLE_MS = 30_000;
/** The pace's bounds, and how much of a new measure it takes. */
export const PACE_LEAST = 0.25;
export const PACE_MOST = 8;
const PACE_TAKES = 0.2;
/** A build estimated under this many nanoseconds of work says nothing the clock can measure. */
const PACE_TEACHES_NS = 1e6;

export interface WorkerLike {
  postMessage(message: ToBuild): void;
  addEventListener(type: 'message' | 'error' | 'messageerror', fn: (e: { data?: FromBuild; message?: string }) => void): void;
  terminate(): void;
}
export interface BuildClientDeps {
  /** A new worker, or null where the browser has none. May throw. */
  makeWorker?: (() => WorkerLike) | null;
  /** Runs `f` in the next frame. */
  nextFrame?: (f: () => void) => void;
  /** The clock a main-thread build is timed by, in milliseconds (`performance.now`). */
  now?: () => number;
}
export interface BuildClient {
  requestBuild(key: string, input: BuildInput, onDone: (built: Built) => void): void;
  cancel(key: string): void;
  /** Whether a worker is running (for tests). */
  active(): boolean;
  /** A fresh requester token for `layerKey`: one for each Effect. Optional only until Effect.tsx asks (Task 5). */
  requester?(): number;
  /** This page's pace: measured over estimated build time (for tests). Optional only until Effect.tsx's test doubles have it (Task 5). */
  pace?(): number;
}

const defaultWorker = (): WorkerLike => new Worker(new URL('./buildWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
const defaultFrame = (f: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => f()); else setTimeout(f, 0);
};

interface Ask { readonly input: BuildInput; readonly onDone: (built: Built) => void; readonly estimate: number }

export function createBuildClient(deps: BuildClientDeps = {}): BuildClient {
  const make = deps.makeWorker === undefined ? (typeof Worker === 'function' ? defaultWorker : null) : deps.makeWorker;
  const nextFrame = deps.nextFrame ?? defaultFrame;
  const now = deps.now ?? (() => performance.now());
  let pace = 1, nextRequester = 1;
  /** A finished build teaches the pace, when its estimate was big enough to measure. */
  const learn = (estimate: number, ms: number): void => {
    if (!(estimate >= PACE_TEACHES_NS) || !Number.isFinite(ms)) return;
    pace = Math.min(PACE_MOST, Math.max(PACE_LEAST, (1 - PACE_TAKES) * pace + PACE_TAKES * ((ms * 1e6) / estimate)));
  };
  /** A build on this thread, timed by the page's clock. */
  const buildHere = (ask: Ask): Built => {
    const built = buildLayer(ask.input, now);
    learn(ask.estimate, built.ms);
    return built;
  };
  let worker: WorkerLike | null = null, idle: ReturnType<typeof setTimeout> | undefined, broken = make === null, nextId = 1;
  /* The build out for each key (its message id), and the newest request waiting behind it. */
  const out = new Map<string, { id: number; ask: Ask }>();
  const waiting = new Map<string, Ask>();
  /* Builds waiting for the next frame on the main thread, by key. */
  const framed = new Map<string, Ask>();
  let framing = false;

  const runFrame = (): void => {
    framing = false;
    /* One build a frame, so a page of them is not one long frame; a throwing onDone loses none of the rest. */
    const first = framed.entries().next();
    if (!first.done) {
      const [key, a] = first.value;
      framed.delete(key);
      try { a.onDone(buildHere(a)); } catch (err) { console.error(err); }
    }
    if (framed.size > 0 && !framing) { framing = true; nextFrame(runFrame); }
  };
  const onFrame = (key: string, ask: Ask): void => {
    framed.set(key, ask);
    if (!framing) { framing = true; nextFrame(runFrame); }
  };

  const end = (w: WorkerLike): void => {
    if (worker !== w) return;
    clearTimeout(idle); idle = undefined;
    w.terminate();
    worker = null;
  };
  /** The worker failed: it is let go for good, and what it held is built on the main thread. */
  const fail = (w: WorkerLike, what: string): void => {
    if (worker !== w) return;
    console.error(`the build worker failed: ${what}`);
    broken = true;
    end(w);
    for (const [key, o] of [...out]) { out.delete(key); const next = waiting.get(key) ?? o.ask; waiting.delete(key); onFrame(key, next); }
    for (const [key, ask] of [...waiting]) { waiting.delete(key); onFrame(key, ask); }
  };
  const idleSoon = (): void => {
    const w = worker;
    if (!w || out.size > 0) return;
    clearTimeout(idle);
    idle = setTimeout(() => { if (out.size === 0) end(w); }, IDLE_MS);
  };

  const start = (): WorkerLike | null => {
    clearTimeout(idle); idle = undefined;
    if (worker) return worker;
    if (broken || !make) return null;
    let w: WorkerLike;
    try { w = make(); } catch (err) { broken = true; console.error(err); return null; }
    /* An `error` is fatal until the worker has answered once (as foilClient's is). After that it has loaded and run, so
       a late error with nothing out is only logged; but a late error while a build is out may mean the worker died
       mid-build and will never answer, so it is fatal then too, and the builds that were out are made on the main
       thread (nothing runs twice: an answered build has already left `out`). */
    let heard = false;
    w.addEventListener('error', (e) => {
      if (heard && out.size === 0) { console.error(`the build worker reported an error: ${e.message || 'no message'}`); return; }
      fail(w, e.message || 'no message');
    });
    w.addEventListener('messageerror', () => fail(w, 'a message could not be read'));
    w.addEventListener('message', (e) => {
      const m = e.data;
      if (worker !== w || !m) return;
      heard = true;
      const key = [...out].find(([, o]) => o.id === m.id)?.[0];
      /* An answer for a key let go (cancelled), or one nobody is waiting on any more: ignored. */
      if (key === undefined) return;
      const o = out.get(key)!;
      out.delete(key);
      if (m.kind === 'built' && m.built) learn(o.ask.estimate, m.built.ms);
      const next = waiting.get(key);
      waiting.delete(key);
      if (next) send(key, next);
      else if (m.kind === 'built' && m.built) o.ask.onDone(m.built);
      else onFrame(key, o.ask);
      idleSoon();
    });
    worker = w;
    return w;
  };

  const send = (key: string, ask: Ask): void => {
    const w = start();
    if (!w) { onFrame(key, ask); return; }
    const id = nextId++;
    out.set(key, { id, ask });
    try { w.postMessage({ kind: 'build', id, input: ask.input }); } catch (err) { out.delete(key); fail(w, String(err)); onFrame(key, ask); }
  };

  return {
    requestBuild(key, input, onDone) {
      const estimate = estimateWork(input.box, input.density, input.strokes, input.band);
      const ask = { input, onDone, estimate };
      framed.delete(key);
      if (estimate * pace < QUICK_MS * 1e6) {
        /* Light at this page's pace, and the newest: whatever was out or waiting for the key is stale. */
        out.delete(key); waiting.delete(key);
        onDone(buildHere(ask));
        idleSoon();
        return;
      }
      if (out.has(key)) waiting.set(key, ask); else send(key, ask);
    },
    cancel(key) {
      waiting.delete(key); out.delete(key); framed.delete(key);
      idleSoon();
    },
    active: () => worker !== null,
    requester: () => nextRequester++,
    pace: () => pace,
  };
}

let page: BuildClient | null = null;
/** The page's client: one worker for every layer. */
export function buildClient(): BuildClient { return (page ??= createBuildClient()); }
