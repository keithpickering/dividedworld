/**
 * The messages between the page and the foil worker (foilClient.ts is the page's side, foilServe.ts the worker's; docs/plans/
 * 2026-11-06-shine-design.md section 6). Types only: nothing here runs, so both sides and a story's own worker entry can import it.
 *
 * A canvas is named by a number the page picks (`id`), unique on the page. The loop still decides when a host draws and computes its
 * light on the main thread; the page sends what the draw needs (the spec the foil is made from, the box, the density, the light, the
 * band, the time) and the worker draws it with the same `foil.draw` on the transferred canvas. One `frame` message carries every draw
 * of one loop frame, so a frame's canvases are sized and drawn in one task and the worker commits them together.
 *
 * Engine code: it names no card and no instance.
 */
import type { Band } from './band.ts';
import type { Box, FoilOptions, Span } from './foil.ts';
import type { Light } from './light.ts';

/** What a foil is made from: the options without the canvas factory (a function cannot be sent; the worker's own canvases are OffscreenCanvases). */
export type FoilSpec = Omit<FoilOptions, 'createCanvas'>;

/** One canvas's draw in a frame. */
export interface FoilDraw {
  readonly id: number;
  readonly spec: FoilSpec;
  /** Stable for a spec: when it changes for a canvas, the worker lets that canvas's other foils go (a board change). */
  readonly key: string;
  readonly box: Box;
  readonly density: number;
  readonly light: Light;
  /** `null` clears the canvas (the board's tokens could not be read: nothing is drawn, the words stay bare). */
  readonly band: Band | null;
  readonly now: number;
  readonly idle: boolean;
  /** The rows to redraw (foil.ts `Span`), or null for all of them. A message from before spans were sent has none: all of them. */
  readonly span?: Span | null;
}

/** What a test or a story may ask the worker to read back. */
export type ProbeAsk =
  | { readonly ask: 'sizes' }
  | { readonly ask: 'work'; readonly n: number }
  | { readonly ask: 'pixels'; readonly id: number };

export type ToWorker =
  | { readonly kind: 'adopt'; readonly id: number; readonly canvas: OffscreenCanvas }
  | { readonly kind: 'frame'; readonly t: number; readonly draws: readonly FoilDraw[] }
  | { readonly kind: 'free'; readonly id: number }
  | { readonly kind: 'drop'; readonly id: number }
  | ({ readonly kind: 'probe'; readonly nonce: number } & ProbeAsk);

export type FromWorker =
  /** A `frame` batch is drawn (or its draws failed): the page may send the next. One batch is in flight at a time (foilClient.ts). */
  | { readonly kind: 'ack' }
  | { readonly kind: 'probe'; readonly nonce: number; readonly ask: 'sizes'; readonly sizes: readonly { id: number; width: number; height: number }[] }
  /** `batches` is how many frames the worker has drawn in all; `work` is its own time in the last `n` of them (at most 600), oldest first, in ms. */
  | { readonly kind: 'probe'; readonly nonce: number; readonly ask: 'work'; readonly batches: number; readonly work: readonly number[] }
  | { readonly kind: 'probe'; readonly nonce: number; readonly ask: 'pixels'; readonly width: number; readonly height: number; readonly data: Uint8ClampedArray | null };
