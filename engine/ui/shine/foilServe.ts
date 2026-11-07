/**
 * The worker's side of the foil (docs/plans/2026-11-06-shine-design.md section 6; the messages are in foilProtocol.ts, the page's side
 * in foilClient.ts): it keeps the OffscreenCanvases the page transferred, by id, and draws each frame's foils on them with the same
 * `foil.draw` as the page would, so the bytes and the look are the foil's (foil.ts, held by digest in foil.test.ts). Written against a
 * scope with `addEventListener` and `postMessage` and nothing else of a worker, so Node runs it in foilServe.test.ts with a fake scope.
 *
 * A `frame` message is one loop frame's draws. For each canvas the worker first sizes it to round(box x density) when it is not that
 * size already (sizing clears a canvas, so it is never done when it need not be) and then draws it, in the same task, so a canvas is
 * never committed to the screen bare between the two. A null band clears it. The foil for a canvas is made lazily from the draw's spec
 * and kept by the draw's key; when the key changes the canvas's other foils release their buffers (a board change, as Effect.tsx
 * let the other board's foil go when it drew on the page). `free` releases a canvas's foils and sets it to 0 by 0, as a post out of
 * view does on the page; the next draw sizes it again. `drop` frees and forgets it.
 *
 * Each batch is acknowledged (`ack`) when it is done: the page keeps one batch in flight and coalesces what waits (foilClient.ts).
 *
 * Each canvas's draw is wrapped on its own, as loop.ts wraps each host's: one canvas that throws costs only that canvas its frame. The
 * worker's own time for a whole batch (the draws and a hook around them) goes in a ring of the last 600, two clock reads a batch,
 * read by the `work` probe: the page's loop cannot see this time, and the busy page's check needs it (e2e/shine.spec.ts). The probe
 * answers `sizes` (every canvas the worker holds) and `pixels` (one canvas's bytes) for the tests that cannot read a transferred
 * canvas from the page.
 *
 * It listens with `addEventListener`, so a story's worker entry may listen too: a message it does not know is ignored here. The
 * `frame` hook wraps each batch, which is how a story counts what a batch rasters or plants a defect. Engine code: it names no card
 * and no instance.
 */
import { makeFoil, type Foil } from './foil.ts';
import type { FoilDraw, FromWorker, ToWorker } from './foilProtocol.ts';

/** The part of a worker's global scope this needs. */
export interface FoilScope {
  addEventListener(type: 'message' | 'messageerror', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

export interface ServeHooks {
  /** Wraps each frame's batch: `run` does the draws. A story counts around it, or slows it to plant a defect. */
  frame?(t: number, run: () => void): void;
}

interface Held {
  readonly canvas: OffscreenCanvas;
  readonly foils: Map<string, Foil>;
}

const KEEP = 600;

export function serveFoils(scope: FoilScope, hooks: ServeHooks = {}): { canvas(id: number): OffscreenCanvas | undefined } {
  const held = new Map<number, Held>();
  const worked = new Float64Array(KEEP);
  let batches = 0;

  const release = (h: Held, except?: string): void => {
    for (const [key, foil] of [...h.foils]) {
      if (key === except) continue;
      foil.release();
      h.foils.delete(key);
    }
  };

  /** Sizes the canvas if it is not the size already, then draws or clears it: one canvas, one try. */
  const drawOne = (d: FoilDraw): void => {
    const h = held.get(d.id);
    if (!h) return;
    const { canvas } = h;
    const w = Math.round(d.box.w * d.density), ht = Math.round(d.box.h * d.density);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== ht) canvas.height = ht;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!d.band) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    release(h, d.key);
    const foil = h.foils.get(d.key) ?? makeFoil(d.spec);
    h.foils.set(d.key, foil);
    /* A canvas sized just now holds nothing: the foil sees the new size and draws it whole whatever the span (foil.ts). */
    foil.draw(ctx as unknown as CanvasRenderingContext2D, d.box, d.density, d.light, d.band, d.now, d.idle, d.span ?? null);
  };

  const batch = (t: number, draws: readonly FoilDraw[]): void => {
    const began = performance.now();
    const run = (): void => {
      for (const d of draws) {
        try { drawOne(d); } catch (err) { console.error(err); }
      }
    };
    try {
      if (hooks.frame) hooks.frame(t, run); else run();
    } catch (err) { console.error(err); }
    worked[batches % KEEP] = performance.now() - began;
    batches++;
    /* After the draws, whatever they did: the page sends its next batch only on this, so a slow worker is never handed a backlog. */
    scope.postMessage({ kind: 'ack' } satisfies FromWorker);
  };

  const answer = (m: FromWorker): void => scope.postMessage(m);

  scope.addEventListener('message', (event) => {
    const m = event.data as Partial<ToWorker> | null | undefined;
    if (typeof m !== 'object' || m === null) return;
    switch (m.kind) {
      case 'adopt':
        if (typeof m.id === 'number' && m.canvas) held.set(m.id, { canvas: m.canvas, foils: new Map() });
        return;
      case 'frame':
        if (typeof m.t === 'number' && Array.isArray(m.draws)) batch(m.t, m.draws);
        return;
      case 'free':
      case 'drop': {
        const h = typeof m.id === 'number' ? held.get(m.id) : undefined;
        if (!h) return;
        /* Forgotten first, so a canvas that throws on its way out is not kept: one canvas's failure ends no one else's. */
        if (m.kind === 'drop') held.delete(m.id!);
        try {
          release(h);
          h.canvas.width = 0; h.canvas.height = 0;
        } catch (err) { console.error(err); }
        return;
      }
      case 'probe': {
        const nonce = m.nonce as number;
        if (m.ask === 'sizes') {
          answer({ kind: 'probe', nonce, ask: 'sizes', sizes: [...held].map(([id, h]) => ({ id, width: h.canvas.width, height: h.canvas.height })) });
        } else if (m.ask === 'work') {
          const count = Math.min(Math.max(0, m.n ?? KEEP), KEEP, batches);
          answer({ kind: 'probe', nonce, ask: 'work', batches, work: Array.from({ length: count }, (_, i) => worked[(batches - count + i) % KEEP]!) });
        } else if (m.ask === 'pixels') {
          const none: FromWorker = { kind: 'probe', nonce, ask: 'pixels', width: 0, height: 0, data: null };
          try {
            const h = held.get(m.id as number);
            const ctx = h?.canvas.getContext('2d');
            if (!h || !ctx || h.canvas.width === 0 || h.canvas.height === 0) { answer(none); return; }
            const img = ctx.getImageData(0, 0, h.canvas.width, h.canvas.height);
            answer({ kind: 'probe', nonce, ask: 'pixels', width: img.width, height: img.height, data: img.data });
          } catch (err) { console.error(err); answer(none); }
        }
        return;
      }
      default:
        return;
    }
  });

  /* A frame the worker cannot read is never drawn: it is acknowledged all the same, or the page would wait on it for good. */
  scope.addEventListener('messageerror', () => {
    console.error('the foil worker received a message that could not be read');
    scope.postMessage({ kind: 'ack' } satisfies FromWorker);
  });

  return { canvas: (id) => held.get(id)?.canvas };
}
