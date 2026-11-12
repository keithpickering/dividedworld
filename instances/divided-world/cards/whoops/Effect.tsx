/**
 * Whoops!'s effect on a post (the screens' design, section 11; cards plan Task 5): up to three layers of
 * seeded ink laid over the post's words, a reader's scrubbing on their own screen, the author's saved for
 * everyone, and the keyboard path ("Hold to scrub").
 *
 * The post stays the board's 2003 post: its words are laid out like any other post's, at their natural size and width, and the ink
 * is fitted to the post body's box (refinements design, section 1). In the thread that box is the body's padding box
 * (`.kb-act-main`, the cell this sits in, border to border and bar to bar); in the ORIGIN box it is the frame. Every position the
 * effect keeps is a share of that box, across from 0 to 1 and down from 0 to 1, and each screen maps the shares onto its own box,
 * so a body whose height changes stretches its ink and its strokes with it. The ink is a canvas laid over the words, sized to
 * the box and reaching out of the frame to the cell's corner; the tag is the glass reaching in (`tag` in cards.ts draws it), and
 * the card's state and controls are the Lens's and the kit's, from the view the effect publishes (`show`, below).
 *
 * Input. The effect takes its pointer and touch input on the frame, and in the thread on the cell too, so a press beside the reactions, on the tag's row
 * or in the body's gutters reaches it wherever there is ink; the cell's handler leaves a press inside the frame to the frame's, and takes nothing while the words are away from it. A press whose target is
 * inside `[data-kb-over-ink]` (what the engine lifts over the ink: the reactions row, the spun line) starts nothing. A mouse or pen
 * is read by pointer events, a finger by touch events (design section 6): a quick swipe up or down is the page's and washes nothing,
 * a sideways swipe or a press held 180ms wipes, a tap washes a dab, and a second finger is the page's. Pointer events of type touch
 * are ignored, so a finger is never read twice.
 *
 * What is the model and what is drawn. The model is the field (docs/plans/2026-11-12-whoops-ink-field-design.md): a layer's ink is
 * the seeded splat's field with each stroke's operation applied in the order made (`LayerInk`, scrub.ts), one implementation in
 * field.ts shared with the painter, so which layer a stroke scrubs, how much of a layer is washed and which lines of text lie
 * under ink are answered without reading a pixel, each screen's own. A wash takes some of the field each pass (`WASH_TAKES`), so a
 * thin arm clears in a pass and a core takes several; a pen adds to the field and melts into it, with a bulb at its end and
 * drops from a quick lift. The author's pen strokes (written back in a layer's ink) are that layer's ink like the splat: a reader's
 * stroke scrubs them on their screen, a line under one is hidden from a screen reader, and the layers above them cover them. A
 * stroke's points are packed when saved (points.ts). The canvas only shows the model, and only for a post near the viewport: a page
 * can hold many splatted posts and a canvas is megabytes. A layer's picture is its build (build.ts): made on the spot when the
 * layer is light and in a worker when it is heavy, with a stand-in (paint.ts `paintStandIn`) drawn meanwhile, and a stroke made
 * while a build is out is applied to it once it arrives. Live strokes then go into the layer's grid and only the rectangle they
 * changed is shaded again. A layer washed clean lets its picture go once it has faded (at once under reduced motion). The grids are let go with the post (a post that has
 * left holds only the strokes made on this screen) and are built again when it returns.
 *
 * Whose strokes. A stroke scrubs the top layer that still has ink where it starts. A reader's strokes
 * are kept in this component's memory only, so a reload brings the ink back. The post author's are
 * also saved, debounced, to that layer's play through `save`, within the card's bounds (`fitStroke`,
 * `fits`); everyone loads the saved version. A play has one save on its way at a time, what is made
 * meanwhile is sent after it, and a save that never got an answer is sent again after a backoff (a save
 * replaces the saved state, so sending it twice is the same as once); a refusal is shown and not retried. A layer washed to the instance's share (`cardSettings['whoops.clean']`) is
 * clean: the author's save says so for everyone, and a reader who gets there sees it fade on their own.
 *
 * Screen readers. A line of text under ink is hidden from them as from the eye (the body is `inert`
 * while any line is covered) and the lines clear of it are read out from a hidden copy, each once it is
 * uncovered. A post with no ink left is plain again.
 *
 * In a play's moment (`still`, docs/plans/2026-11-03-effect-history-design.md, section 5), each layer is drawn from its saved state
 * alone: no pointer or sweep is taken, nothing is saved or met, a layer saved clean is absent with no fade, the body is not inert, and
 * the view's state is the moment's words for the frame, each layer top first ("Gloomba's yellow, 40% washed; Spritey's cyan, washed
 * clean"), with no controls.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motionReduced } from '../../../../engine/ui/appearance.ts';
import { LOST_ANSWER, type Answer } from '../../../../engine/ui/data/api.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { CardPlay, CardView, EffectProps, KitControl } from '../../../../engine/ui/cards/types.ts';
import { HOLD_MS, MAX_SAVE_RETRIES, RETRY_AFTER_MS, SLOP_PX, SUPPRESS_MS, overInk, swipeKind } from '../wiping.ts';
import { cursor, type CursorMode } from './cursor.ts';
import { readLines } from './lines.ts';
import { MAX_CANVAS_PX, MAX_DPR, holdStandIns, paint, paintSplat, paintStandIn, shadeField, type Geometry, type PaintLayer, type PixelsOut } from './paint.ts';
import { DROPS_MOST, beginLine, strokesInto, unionRect, type Grid, type Line, type Rect } from './field.ts';
import { gridOf, layerKey, type Built } from './build.ts';
import { buildClient } from './buildClient.ts';
import {
  BRUSH_PX, LayerInk, type LiveLine, PEN_PX, ROW_PX, SWEEP_BRUSH_ROWS, bandsOf, brushOf, coveredLines, fits, fitStroke, minStepOf, sweepStep, topLayer,
  type Drops, type Pt, type Stroke, type Sweep, type TextLine,
} from './scrub.ts';
import { decodePoints, packStroke } from './points.ts';
import { luminance, makeSplat, type Box, type Splat } from './splat.ts';
import * as suds from './suds.ts';
import './whoops.css';
import { inkName } from './names.ts';

/** A burst of strokes is saved once it has been quiet this long. */
export const SAVE_AFTER_MS = 800;
/* The pace of a retry, the touch rules and the test of what lies over ink are shared with Graffiti's wall (../wiping.ts). */
export { MAX_SAVE_RETRIES, RETRY_AFTER_MS };
/** The share of a layer washed that counts as clean where the instance's settings do not say (an instance seeded before the setting existed). */
const DEFAULT_CLEAN = 95;
/** How long a layer takes to fade once it is washed clean, unless motion is reduced. */
const FADE_MS = 700;
/** How often the model's published numbers and covered lines are recomputed while a sweep runs. */
const REFRESH_MS = 150;
export { HOLD_MS, SLOP_PX };
/** The ink of a play whose config carries none we can draw (the server keeps one, so this is a safeguard). */
const FALLBACK_INK = '#ff2bd6';

/** The help sentence of the hold, read by a screen reader with the control. */
const HOLD_HELP = 'Hold Space or Enter on this button to scrub the ink away line by line, at the pace of a hand. Let go to stop. It never clears the ink all at once.';
/** The Lens's way out: it ends on the reader's screen as they scrub; the author, who can wash it for everyone, is told so as the author. */
const ENDS = 'Ends on your screen when you scrub every layer off. The author can wash it for everyone.';
const ENDS_AUTHOR = 'Ends on your screen when you scrub every layer off. As its author, you can wash it for everyone.';
/** The author's two tools (the stroke they save for everyone is the wash). */
const TOOLS = [{ value: 'wash', label: 'Wash' }, { value: 'ink', label: 'Write in ink' }] as const;

interface Layer { readonly play: CardPlay; readonly color: string; readonly seed: number }

function inkOf(play: CardPlay): string {
  const c = play.config.color;
  if (typeof c !== 'string') return FALLBACK_INK;
  try {
    luminance(c);
    return c;
  } catch {
    return FALLBACK_INK;
  }
}

/** The play's seed, the server's; a play without one (written before seeds) is seeded from its id, so it still draws the same everywhere. */
function seedOf(play: CardPlay): number {
  const s = play.config.seed;
  if (typeof s === 'number' && Number.isFinite(s)) return Math.floor(s) | 0;
  let h = 7;
  for (const ch of play.id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return h;
}

/**
 * A play's saved state, read defensively: the server checked it, but a state is data from outside. Points are packed (points.ts). A stroke saved before strokes kept
 * their proportions (no `aspect`), in the old array shape, or with a point that does not decode, is dropped, as a malformed one is.
 */
export function savedOf(saved: unknown): { strokes: Stroke[]; clean: boolean } {
  const state = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : undefined;
  const raw = state?.strokes;
  const strokes: Stroke[] = [];
  if (Array.isArray(raw)) {
    for (const s of raw as Record<string, unknown>[]) {
      if (typeof s !== 'object' || s === null || typeof s.width !== 'number' || !(s.width > 0) || typeof s.aspect !== 'number' || !(s.aspect > 0) || !Number.isFinite(s.aspect)) continue;
      const points = typeof s.points === 'string' ? decodePoints(s.points) : null;
      if (!points) continue;
      const before = strokes[strokes.length - 1];
      const start = points[0]!;
      /* A piece is joined to the one kept before it only where that one is the line it continues (a dropped stroke between them leaves it a line of its own). */
      const joins = s.continues === true && before !== undefined && before.tool === s.tool && before.width === s.width && before.aspect === s.aspect
        && (s.tool !== 'ink' || (before.tool === 'ink' && before.color === s.color))
        && before.points[before.points.length - 1]![0] === start[0] && before.points[before.points.length - 1]![1] === start[1]
        /* Only a line's last piece throws drops (the card refuses a piece that goes on after them), so a piece after drops starts a line of its own. */
        && !(before.tool === 'ink' && before.drops !== undefined);
      const more = joins ? { continues: true as const } : null;
      if (s.tool === 'wash') strokes.push({ tool: 'wash', width: s.width, aspect: s.aspect, points, ...more });
      else if (s.tool === 'ink' && typeof s.color === 'string') strokes.push({ tool: 'ink', color: s.color, width: s.width, aspect: s.aspect, points, ...more, ...(s.drops === 0 || s.drops === 1 || s.drops === 2 || s.drops === 3 ? { drops: s.drops } : null) });
    }
  }
  return { strokes, clean: state?.clean === true };
}

/** A saved state as one string, whatever order the server's copy lists its keys in, to tell a copy of what was just sent from a different state. */
const canonical = (state: unknown): string => JSON.stringify(savedOf(state));

/** A stroke being made: its brush as the card keeps it (a share of the box's width, and the box's proportions), and its points in shares of the box. */
interface Live {
  readonly layer: number; readonly tool: 'wash' | 'ink'; readonly width: number; readonly aspect: number; readonly color: string; readonly points: Pt[]; readonly pointer: number | null; readonly touch?: true;
  /** Where the pointer was and when (px of the box, the event's time in ms), the last moments of it: the pen's speed at the lift. */
  readonly trail: Sample[];
  /** The layer model's open line for this stroke, ended when the stroke is; and the picture's grid's, when the grid is there. Both are made again on a new model or grid (`bindLines`). */
  line?: LiveLine; gline?: Line; gpic?: Pic;
}

/** Where the pointer was, in px of the box, and when. */
export interface Sample { readonly x: number; readonly y: number; readonly t: number }

/** A pen lifted at this speed (px a second) throws a droplet for each time it goes into it, up to `DROPS_MOST`: a bench number the owner may tune (ink-field design, section 4). */
export const DROPS_SPEED = 900;
/** The pointer's speed is read over the last this many ms of the stroke. */
const DROPS_WINDOW_MS = 50;

/**
 * The droplets a pen throws as it lifts at time `end`: `min(3, floor(speed / DROPS_SPEED))`, the speed being the path it went over the last
 * 50ms (or its whole span when shorter) in px a second, from the events' own times. A tap, a single point, a pause before the lift,
 * or no trail, throws none.
 */
export function dropsOf(trail: readonly Sample[], end: number): Drops {
  const first = trail[0];
  if (!first) return 0;
  const from = Math.max(end - DROPS_WINDOW_MS, first.t);
  const span = end - from;
  if (!(span > 0)) return 0;
  let path = 0;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1]!, b = trail[i]!;
    if (b.t <= from || b.t <= a.t) continue;
    /* A move that began before the window counts only its part inside it. */
    path += Math.hypot(b.x - a.x, b.y - a.y) * ((b.t - Math.max(a.t, from)) / (b.t - a.t));
  }
  return Math.min(DROPS_MOST, Math.floor((path * 1000) / span / DROPS_SPEED)) as Drops;
}

/**
 * A layer's picture on this screen (ink-field design, section 5): its build, the grids a live stroke is drawn into beside it, and what
 * the build did not hold. One is made for a layer when it is first drawn, kept while the post is near, and let go with it. Until the
 * build arrives (`grid` is null) the layer is drawn by `paintStandIn`.
 */
interface Pic {
  /** What it is for: the seed, ink, box and density. A picture for another is let go. */
  readonly geo: string;
  readonly color: string;
  /** The key the build was asked for with, which a drop cancels. */
  readonly key: string;
  readonly box: Box;
  readonly q: number;
  /** The field and the washed marks, as a Float32 grid a live stroke goes into by the model's own operations; and the canvas holding the shaded picture. Null until the build arrives. */
  grid: Grid | null;
  canvas: HTMLCanvasElement | null;
  /** Strokes finished since the build was asked for, as the model got them, which the build does not hold: applied to its grid once, when it arrives. */
  readonly late: Stroke[];
  /** The rectangle of grid points a stroke has changed since it was last shaded. */
  dirty: Rect | null;
}

/**
 * One buffer shaded rectangles are written into before they are put on a layer's canvas, shared by every layer on the page (a layer keeps
 * its canvas and its grid, and no pixels of its own): sized to the grid being shaded, and let go when no picture holds a grid.
 */
let scratch: PixelsOut | null = null;
let gridsHeld = 0;
const scratchFor = (width: number, height: number): PixelsOut => {
  if (!scratch || scratch.width !== width || scratch.height !== height) scratch = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  return scratch;
};
/** Pixels as an `ImageData` a canvas takes: wrapped where the browser can (no copy), copied where it cannot. */
function imageOf(ctx: CanvasRenderingContext2D, px: PixelsOut): ImageData {
  if (typeof ImageData === 'function') return new ImageData(px.data as Uint8ClampedArray<ArrayBuffer>, px.width, px.height);
  const img = ctx.createImageData(px.width, px.height);
  img.data.set(px.data);
  return img;
}

/** What a finger is doing: waiting to be told apart, wiping, or the page's. */
interface Gesture { readonly id: number; readonly x0: number; readonly y0: number; cx: number; cy: number; state: 'wait' | 'wipe' | 'page'; timer: ReturnType<typeof setTimeout> | null }

/**
 * The pixel density of a box's ink canvas: the screen's, at most `MAX_DPR`, and low enough that the canvas, ceil(box ·
 * density) both ways, holds at most `MAX_CANVAS_PX`: a tall phone body lowers the density rather than hold a bigger canvas.
 */
function densityOf(box: Box): number {
  const screen = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const area = box.w * box.h;
  let d = Math.min(MAX_DPR, screen, area > 0 ? Math.sqrt(MAX_CANVAS_PX / area) : MAX_DPR);
  while (d > 0 && Math.ceil(box.w * d) * Math.ceil(box.h * d) > MAX_CANVAS_PX) d *= 0.9999;
  return d;
}

/**
 * A layer's share washed as the readout and its panel say it, a whole percent: one washed clean is 100, and one that still
 * holds ink is at most 99, so a layer is never called fully washed while some of its ink is left.
 */
export function percentWashed(washed: number, clean: boolean): number {
  if (clean) return 100;
  return Number.isFinite(washed) ? Math.min(99, Math.max(0, Math.round(100 * washed))) : 0;
}

/** What the component publishes of its model, to render from and for the tests to read. */
interface View {
  readonly clean: readonly boolean[];
  readonly washed: readonly number[];
  readonly lines: readonly TextLine[];
  readonly covered: readonly boolean[];
  readonly fading: boolean;
}

export function Effect({ post, plays, states, reader, save, place, show, met, nameOf, still, ink: registry, children }: EffectProps) {
  const { settings } = useKayfa();
  const layers = useMemo<readonly Layer[]>(() => plays.map((play) => ({ play, color: inkOf(play), seed: seedOf(play) })), [plays]);
  /** The body's box on this screen, and the frame's offset in it (px): the ink canvas reaches out of the frame to the box's corner. */
  const [size, setSize] = useState<{ box: Box; left: number; top: number }>({ box: { w: 0, h: 0 }, left: 0, top: 0 });
  /** What input is taken on: the cell in the thread, the frame in the ORIGIN box. */
  const [surface, setSurface] = useState<HTMLElement | null>(null);
  /** The cell the frame was last found in (thread only): its listeners stay while the words are away, and ignore everything until they are back. */
  const [cellEl, setCellEl] = useState<HTMLElement | null>(null);
  const [near, setNear] = useState(true);
  const [built, setBuilt] = useState(false);
  const [tool, setTool] = useState<'wash' | 'ink'>('wash');
  const [report, setReport] = useState('');
  /** The reader's first stroke on any layer has been made (`met` is said once). */
  const met1 = useRef(false);
  const metNow = useRef(met);
  metNow.current = met;
  /* Any stroke counts, the author's too: the author is a reader of their own post and has met the effect by working it. */
  const meet = useCallback(() => {
    if (met1.current) return;
    met1.current = true;
    metNow.current();
  }, []);
  /**
   * The lines a scrub has just uncovered, said as news; the lines readable before it are not said again. `n` counts what was said, so
   * the same words said again are a change a screen reader hears (a trailing no-break space on every other one).
   */
  const [uncovered, setUncovered] = useState({ words: '', n: 0 });
  const readBefore = useRef<ReadonlySet<string> | null>(null);
  const [view, setView] = useState<View | null>(null);
  /** How many layers' ink grids are held: none for a post that has left the viewport. */
  const [held, setHeld] = useState(0);
  /** How many layers' pictures (a build and its grid) are held: none for a post that has left the viewport, and none while a build is out. */
  const [pictures, setPictures] = useState(0);

  /** In the thread the box is the post's whole body (the cell), the frame sits inside it, and the ink runs from the frame out to the body's borders, what the engine lifts drawn in front of it. */
  const bleed = place === 'thread';
  const frameRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sudsRef = useRef<HTMLCanvasElement>(null);
  /** This post's key with the suds module, and each layer's painted splat (by seed, color and box), kept while the post is near. */
  const sudsHost = useRef({});
  const painted = useRef(new Map<string, HTMLCanvasElement>());
  /** Each layer's picture, by layer: its build and the grids beside it, asked for when first drawn and let go with the post. */
  const pics = useRef<(Pic | null)[]>([]);

  /* What the handlers read: the latest of everything, so a handler made once is never stale. */
  const dpr = densityOf(size.box);
  const now = useRef({ layers, states, reader, save, tool, threshold: (settings.cardSettings['whoops.clean'] ?? DEFAULT_CLEAN) / 100, size, near, dpr, built, surface });
  now.current = { layers, states, reader, save, tool, threshold: (settings.cardSettings['whoops.clean'] ?? DEFAULT_CLEAN) / 100, size, near, dpr, built, surface };
  /** Drawn in a play's moment: as the saved states say, taking no input, saving, meeting and fading nothing. */
  const stillNow = useRef(still);
  stillNow.current = still;
  const inks = useRef<LayerInk[]>([]);
  /** The strokes made on this screen, by play: a reader's, which are never saved, and the author's not yet saved. */
  const mine = useRef(new Map<string, Stroke[]>());
  const localClean = useRef(new Set<string>());
  const wantClean = useRef(new Set<string>());
  const dirty = useRef(new Set<string>());
  /** The plays with a save on its way, and the state last sent for each (compared as `canonical`, so the server's echo of it is told from news). */
  const sending = useRef(new Set<string>());
  const lastSent = useRef(new Map<string, string>());
  /** How many of `mine` the save on its way carries: they are in the state the server holds as soon as it is heard, which can be before the save's own answer. */
  const sentCount = useRef(new Map<string, number>());
  /**
   * Every save that got no answer may have been stored: each one's state and how many of `mine` it carried, kept until a save is answered with success.
   * A saved state heard equal to any of them holds that one's strokes already, so they are neither counted nor sent again (a wash takes some of the field a pass, so a stroke twice is not harmless).
   * A refusal answers only the save it was given for, so it forgets nothing. Accepted: a stored uncertain save followed by another writer's change (the state heard matches no marker)
   * counts those strokes twice until the next success.
   */
  const unanswered = useRef(new Map<string, { readonly state: string; readonly count: number }[]>());
  /** The strokes of `mine` that a saved state already holds because an unanswered save carried them, or 0. */
  const heldBy = (id: string, saved: string): number => (unanswered.current.get(id) ?? []).find((m) => m.state === saved)?.count ?? 0;
  /**
   * The strokes made on this screen that the saved state does not hold yet. While a save is on its way its state may be heard before its
   * answer (another channel); the strokes it carried are then in the saved state and still in `mine`, and must not be counted from both.
   */
  const unsavedOf = (id: string, saved: string = canonical(now.current.states[id]?.state)): Stroke[] => {
    const all = mine.current.get(id) ?? [];
    if (sending.current.has(id) && saved === lastSent.current.get(id)) return all.slice(sentCount.current.get(id) ?? 0);
    return all.slice(heldBy(id, saved));
  };
  /** How many saves in a row have not got through, by play. */
  const failures = useRef(new Map<string, number>());
  /** The state each play's last save from this screen was answered for, and when the server saved it. */
  const acked = useRef(new Map<string, { readonly state: unknown; readonly savedAt: string }>());
  /** The post has left the screen: a save still on its way goes on, and nothing writes to this component's state. */
  const gone = useRef(false);
  const say = useCallback((words: string) => { if (!gone.current) setReport(words); }, []);
  /** What the ink grids were built from, so a state that changes nothing in them does not build them again. */
  const builtFrom = useRef<{ splats: readonly Splat[]; w: number; h: number; top: number; payload: unknown; states: Map<string, string> } | null>(null);
  const cleanedAt = useRef(new Map<string, number>());
  const wasClean = useRef<readonly boolean[] | null>(null);
  const live = useRef<Live | null>(null);
  /** The sweep's open stroke ("Hold to scrub"), and the line it washes with. */
  const sweepStroke = useRef<Live | null>(null);
  const textLines = useRef<TextLine[]>([]);
  const paintQueued = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* A fade still running when the post leaves the page is let go with it: nothing redraws a post that is gone. */
  useEffect(() => () => { if (fadeTimer.current) clearTimeout(fadeTimer.current); }, []);

  const { box } = size;
  const fixed = box.w > 0 && box.h > 0;

  /* ------------------------------------------------------------------ measuring ---- */

  /** Measures again now: set by the effect below, called by whatever may have moved the words (a render, the viewport observer). */
  const remeasure = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const f = frameRef.current;
    if (!f) return;
    /*
     * In the thread the box is the post body's padding box (the owner's word: the ink reaches the body's borders), so the body, the cell
     * this sits in, is measured: its client size, and where the frame starts in it, from the two rects. The cell is found at each measure
     * and not once: under a takeover (Stick Around) the words are mounted in an element that is moved into the post afterwards, and
     * moved again into its view, so the cell is not there when this first runs and changes when the words move. The observer follows
     * whichever cell there is. With no cell (or in the ORIGIN box) the frame is the box.
     */
    let watched: HTMLElement | null = null;
    let watch: ResizeObserver | null = null;
    const measure = () => {
      const cell = bleed ? f.closest<HTMLElement>('.kb-act-main') : null;
      if (watch && cell !== watched) {
        if (watched) watch.unobserve(watched);
        if (cell) watch.observe(cell);
        watched = cell;
      }
      if (cell) setCellEl((prev) => (prev === cell ? prev : cell));
      /* The handlers read `now`, so what is measured is put there at once: a press that finds the words moved measures first and reads the right box in the same event. */
      const surf = cell ?? f;
      let next: { box: Box; left: number; top: number };
      if (cell) {
        const fr = f.getBoundingClientRect(), cr = cell.getBoundingClientRect();
        next = { box: { w: cell.clientWidth, h: cell.clientHeight }, left: fr.left - cr.left - cell.clientLeft, top: fr.top - cr.top - cell.clientTop };
      } else {
        next = { box: { w: f.clientWidth, h: f.clientHeight }, left: 0, top: 0 };
      }
      const was = now.current.size;
      const kept = was.box.w === next.box.w && was.box.h === next.box.h && was.left === next.left && was.top === next.top ? was : next;
      now.current = { ...now.current, surface: surf, size: kept };
      setSurface((prev) => (prev === surf ? prev : surf));
      setSize((prev) => (prev.box.w === kept.box.w && prev.box.h === kept.box.h && prev.left === kept.left && prev.top === kept.top ? prev : kept));
    };
    if (typeof ResizeObserver === 'function') {
      watch = new ResizeObserver(measure);
      watch.observe(f);
    }
    measure();
    remeasure.current = measure;
    return () => { remeasure.current = null; watch?.disconnect(); };
  }, [bleed]);

  /*
   * A takeover (Stick Around) moves the words' element, the frame with it, between the post's cell and its view, which may change
   * no size and wakes no observer, and a lift does not render this effect for certain. So each render checks, cheaply, that the cell
   * found from the frame is still the surface it listens on, and the viewport observer below checks as well.
   */
  useLayoutEffect(() => {
    const f = frameRef.current;
    if (!f || !remeasure.current) return;
    const cell = bleed ? f.closest<HTMLElement>('.kb-act-main') : null;
    if ((cell ?? f) !== now.current.surface) remeasure.current();
  });

  /* Only a post near the viewport is drawn: past a screen above or below, the canvas is dropped. */
  useEffect(() => {
    const f = frameRef.current;
    if (!f || typeof IntersectionObserver !== 'function') return;
    const watch = new IntersectionObserver((entries) => { setNear(entries.some((e) => e.isIntersecting)); remeasure.current?.(); }, { rootMargin: '100% 0px' });
    setNear(false);
    watch.observe(f);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    if (near && fixed && !built) setBuilt(true);
  }, [near, fixed, built]);

  /* ----------------------------------------------------------------- the model ---- */

  /**
   * The saved version of a play's state: the newer of what the thread holds and what this screen's own last save was answered with. A
   * save answered after the post has gone is heard by nobody here, and the strokes made since are saved on top of it, not of the
   * version before it (#86).
   */
  const savedFor = useCallback((id: string) => {
    const held = now.current.states[id];
    const own = acked.current.get(id);
    return savedOf(own && (!held || Date.parse(own.savedAt) > Date.parse(held.savedAt)) ? own.state : held?.state);
  }, []);
  const cleanOf = useCallback((i: number) => {
    const id = now.current.layers[i]!.play.id;
    return savedFor(id).clean || localClean.current.has(id);
  }, [savedFor]);
  const liveInks = useCallback((): (LayerInk | null)[] => inks.current.map((ink, i) => (cleanOf(i) ? null : ink)), [cleanOf]);

  /* ------------------------------------------------------------- the pictures ---- */

  /*
   * These are plain functions over refs (a stale one does what a fresh one does), so the callbacks that use them need not list them. A layer's
   * picture is asked for when the layer is first drawn (`paintNow`), let go when the post leaves or the model is built again (`dropPics`),
   * and answered by `arrive`. A live stroke goes to the layer's model and, once the grid is there, to the grid by the same operation.
   */
  const openStrokes = (): Live[] => [live.current, sweepStroke.current].filter((s): s is Live => s !== null);
  const protoOf = (s: Live): Stroke => (s.tool === 'wash'
    ? { tool: 'wash', width: s.width, aspect: s.aspect, points: [] }
    : { tool: 'ink', color: s.color, width: s.width, aspect: s.aspect, points: [] });
  const mark = (pic: Pic, rect: Rect) => {
    if (rect.x1 > rect.x0 && rect.y1 > rect.y0) pic.dirty = pic.dirty ? unionRect(pic.dirty, rect) : rect;
  };
  /** The stroke's line on the layer's current model: begun again there, with every point so far (the model was built again since, or this is its first). */
  const bindInk = (s: Live) => {
    const ink = inks.current[s.layer];
    if (!ink) { s.line = undefined; return; }
    const line = ink.begin(protoOf(s));
    for (const p of s.points) line.to(p);
    s.line = line;
  };
  /** The stroke's line on the picture's grid, with every point so far. */
  const bindGrid = (s: Live, pic: Pic) => {
    if (!pic.grid) return;
    const line = beginLine(pic.grid, pic.box, protoOf(s));
    for (const p of s.points) mark(pic, line.to(p));
    s.gline = line;
    s.gpic = pic;
  };
  const bindLines = (s: Live) => {
    bindInk(s);
    s.gline = undefined;
    s.gpic = undefined;
    const pic = pics.current[s.layer];
    if (pic?.grid) bindGrid(s, pic);
  };
  const lineTo = (s: Live, p: Pt) => {
    s.line?.to(p);
    if (s.gline && s.gpic) mark(s.gpic, s.gline.to(p));
  };
  const lineEnd = (s: Live, drops?: number) => {
    s.line?.end(drops);
    if (s.gline && s.gpic) mark(s.gpic, s.gline.end(drops));
  };

  const dropPic = (i: number) => {
    const pic = pics.current[i];
    if (!pic) return;
    pics.current[i] = null;
    buildClient().cancel(pic.key);
    if (pic.grid && --gridsHeld === 0) scratch = null;
    for (const s of openStrokes()) if (s.layer === i) { s.gline = undefined; s.gpic = undefined; }
  };
  const dropPics = () => {
    for (let i = 0; i < pics.current.length; i++) dropPic(i);
    pics.current = [];
    setPictures(0);
  };

  /** The build has arrived for layer `i`: its grid and canvas are kept (the build itself is let go), and what it does not hold is applied to the grid. */
  const arrive = (i: number, pic: Pic, result: Built) => {
    if (pics.current[i] !== pic || pic.grid) return;
    let grid: Grid;
    try {
      grid = gridOf(result, pic.box, pic.q);
    } catch (err) {
      console.error(err);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = result.image.width;
    canvas.height = result.image.height;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.putImageData(imageOf(ctx, result.image), 0, 0);
    pic.grid = grid;
    pic.canvas = canvas;
    gridsHeld++;
    /* A stroke finished while the build was out is not in it: it goes in now, once. One still open goes on from where it is. */
    for (const s of pic.late) mark(pic, strokesInto(grid, pic.box, [s]));
    pic.late.length = 0;
    for (const s of openStrokes()) if (s.layer === i) bindGrid(s, pic);
    setPictures(pics.current.filter((p) => p?.grid).length);
    schedulePaint();
  };

  /** Asks for layer `i`'s picture: built on the spot when it is light, in the worker when not (the stand-in shows meanwhile). */
  const requestPic = (i: number, layer: Layer, b: Box, q: number): void => {
    const id = layer.play.id;
    const strokes = [...savedFor(id).strokes, ...unsavedOf(id)];
    /* The build input holds the strokes as saved (simplified), while the model keeps this screen's own strokes at full resolution until its next rebuild: the two differ by under a quarter of a brush, the difference the design accepts (docs/plans/2026-11-12-whoops-ink-field-design.md). */
    const key = layerKey(id, b, q, strokes);
    const pic: Pic = { geo: `${layer.seed}|${layer.color}|${b.w}x${b.h}|${q}`, color: layer.color, key, box: b, q, grid: null, canvas: null, late: [], dirty: null };
    pics.current[i] = pic;
    try {
      buildClient().requestBuild(key, { seed: layer.seed, color: layer.color, box: b, density: q, strokes }, (result) => arrive(i, pic, result));
    } catch (err) {
      /* The stand-in goes on drawing the layer. */
      console.error(err);
    }
  };

  /** Shades the rectangle a stroke has changed since it was last shaded, and puts that rectangle (and nothing else) on the layer's canvas. */
  const flushPic = (pic: Pic) => {
    const r = pic.dirty;
    pic.dirty = null;
    if (!r || !pic.grid || !pic.canvas) return;
    const ctx = pic.canvas.getContext('2d');
    if (!ctx) return;
    const { cols, rows } = pic.grid;
    const out = scratchFor(cols, rows);
    shadeField(pic.grid, pic.grid.washed, pic.color, pic.q, r, out);
    /* The shading reads one point past the rectangle for the gradient, so it writes one point past it too. */
    const x0 = Math.max(0, r.x0 - 1), y0 = Math.max(0, r.y0 - 1), x1 = Math.min(cols, r.x1 + 1), y1 = Math.min(rows, r.y1 + 1);
    if (x1 > x0 && y1 > y0) ctx.putImageData(imageOf(ctx, out), 0, 0, x0, y0, x1 - x0, y1 - y0);
  };

  /* Stand-in canvases are held while the post is near, and let go with it (paint.ts `holdStandIns`). */
  useEffect(() => {
    if (!near || !built) return;
    return holdStandIns();
  }, [near, built]);
  /* A post that goes lets its builds go: none is waited for, and the grids are let go. */
  useEffect(() => () => dropPics(), []);

  /** Recompute everything a render or a test reads of the model, and what is covered. */
  const refresh = useCallback(() => {
    const all = now.current.layers;
    if (inks.current.length !== all.length) return;
    const clean = all.map((_, i) => cleanOf(i));
    const before = wasClean.current;
    /* Drawn still (a moment), a layer saved clean is simply absent: nothing fades. */
    if (!stillNow.current) clean.forEach((c, i) => { if (c && !(before?.[i] ?? true)) cleanedAt.current.set(all[i]!.play.id, performance.now()); });
    wasClean.current = clean;
    const lines = textLines.current;
    const fading = !motionReduced() && [...cleanedAt.current.values()].some((t) => performance.now() - t < FADE_MS);
    if (fading) {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(refresh, FADE_MS + 20);
    }
    setView({
      clean, washed: inks.current.map((ink) => ink.washed), lines,
      covered: coveredLines(lines, inks.current.map((ink, i) => (clean[i] ? null : ink))), fading,
    });
  }, [cleanOf]);

  /* Rebuild every layer's ink when the splats change (the plays), the box changes (the body's size, or where the frame lies in it) or a saved state arrives, and let it go when the post is far from the viewport. */
  const splats = useMemo<readonly Splat[] | null>(() => (built ? layers.map((l) => makeSplat(l.seed)) : null), [built, layers]);
  useEffect(() => {
    if (!splats) return;
    if (!near) {
      /* Only the grids and the painted splats go: the strokes made on this screen are in `mine`, the saved ones are in the states, and both come back with the grids. */
      inks.current = [];
      painted.current.clear();
      dropPics();
      builtFrom.current = null;
      setHeld(0);
      return;
    }
    const fromStates = new Map(layers.map((l) => [l.play.id, canonical(states[l.play.id]?.state)]));
    const was = builtFrom.current;
    /* The state that comes back from this screen's own save is what the grids already hold (the strokes in it were washed into them as they were made). */
    const echo = was !== null && inks.current.length === layers.length && was.splats === splats && was.w === box.w && was.h === box.h && was.top === size.top && was.payload === post.currentPayload
      && layers.every((l) => fromStates.get(l.play.id) === was.states.get(l.play.id) || fromStates.get(l.play.id) === lastSent.current.get(l.play.id));
    builtFrom.current = { splats, w: box.w, h: box.h, top: size.top, payload: post.currentPayload, states: fromStates };
    if (echo) {
      refresh();
      schedulePaint();
      return;
    }
    inks.current = splats.map((splat, i) => {
      const id = layers[i]!.play.id;
      const ink = new LayerInk(splat, savedOf(states[id]?.state).strokes, box);
      ink.add(unsavedOf(id, fromStates.get(id)));
      return ink;
    });
    /* The pictures were built from the model's last strokes: they are asked for again as the next frame draws them. A stroke open on the old model goes on on the new one. */
    dropPics();
    for (const s of openStrokes()) bindInk(s);
    setHeld(inks.current.length);
    const body = layoutRef.current;
    if (body) {
      /* The lines are read from the layout, whose top is the frame's, and are shares of the box: the frame's offset in it is added. */
      const read = readLines(body, box);
      const off = size.top / box.h;
      textLines.current = read.length > 0 ? read.map((l) => ({ ...l, top: l.top + off, bottom: l.bottom + off })) : [{ top: 0, bottom: 1, text: body.textContent ?? '' }];
    }
    refresh();
    schedulePaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splats, states, post.currentPayload, box.w, box.h, size.top, near]);

  /* ----------------------------------------------------------------- the canvas ---- */

  /** A layer's splat as `paintSplat` paints it for this box, kept by (seed, color, box) while the post is near, one pixel to the CSS px at most. */
  const paintedFor = useCallback((i: number, ink: LayerInk, color: string, seed: number, b: Box, density: number): HTMLCanvasElement => {
    const q = Math.min(1, density);
    const key = `${seed}|${color}|${b.w}|${b.h}|${q}`;
    let held = painted.current.get(`${i}|${key}`);
    if (!held) {
      /* A box that changed leaves its older splat behind: this layer's other keys go. */
      for (const k of painted.current.keys()) if (k.startsWith(`${i}|`)) painted.current.delete(k);
      held = paintSplat(ink.splat, color, b, q);
      painted.current.set(`${i}|${key}`, held);
    }
    return held;
  }, []);

  const paintNow = useCallback(() => {
    paintQueued.current = 0;
    const canvas = canvasRef.current;
    const { layers: all, size: sz, dpr: density } = now.current;
    if (!canvas || !now.current.near || sz.box.w <= 0 || sz.box.h <= 0 || inks.current.length !== all.length) return;
    /* The ink canvas is placed at the box's origin (`onBox`: left -size.left, top -size.top from the frame), so the box's origin is (0, 0) in the canvas's own frame; the frame's offset in the cell is where the canvas sits, never where the box lies in it. */
    const geometry: Geometry = { dpr: density, box: sz.box, left: 0, top: 0 };
    const reduced = motionReduced();
    const stroking = live.current;
    let fading = false;
    const layersOut: PaintLayer[] = [];
    all.forEach((layer, i) => {
      const id = layer.play.id;
      const clean = savedFor(id).clean || localClean.current.has(id);
      let alpha = 1;
      if (clean) {
        const at = cleanedAt.current.get(id);
        alpha = reduced || at === undefined ? 0 : Math.max(0, 1 - (performance.now() - at) / FADE_MS);
        if (alpha > 0) fading = true;
      }
      if (alpha <= 0) {
        /* A layer that is clean and faded is gone for good: its picture, grid and canvas are let go now, not held until the post leaves. */
        if (pics.current[i]) {
          dropPic(i);
          setPictures(pics.current.filter((p) => p?.grid).length);
        }
        return;
      }
      /* The layer's picture is its build, asked for here the first time the layer is drawn (a light one is back before the frame is), and kept while the post is near. */
      const q = Math.min(1, density);
      if (pics.current[i]?.geo !== `${layer.seed}|${layer.color}|${sz.box.w}x${sz.box.h}|${q}`) {
        dropPic(i);
        requestPic(i, layer, sz.box, q);
      }
      const pic = pics.current[i];
      if (pic?.grid && pic.canvas) {
        flushPic(pic);
        layersOut.push({ picture: pic.canvas, alpha });
        return;
      }
      /* No build yet: the stand-in, the cached splat with every stroke drawn flat on it, the one under way included. */
      const strokes = [...savedFor(id).strokes, ...unsavedOf(id)];
      if (stroking && stroking.layer === i) {
        strokes.push(stroking.tool === 'wash'
          ? { tool: 'wash', width: stroking.width, aspect: stroking.aspect, points: stroking.points }
          : { tool: 'ink', color: stroking.color, width: stroking.width, aspect: stroking.aspect, points: stroking.points });
      }
      layersOut.push({ picture: paintStandIn({ painted: paintedFor(i, inks.current[i]!, layer.color, layer.seed, sz.box, density), color: layer.color, strokes }, geometry, canvas.width, canvas.height, i), alpha });
    });
    paint(canvas, geometry, layersOut);
    if (fading) schedulePaint();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the picture helpers are plain functions over refs
  }, [savedFor, paintedFor]);

  const schedulePaint = useCallback(() => {
    if (paintQueued.current) return;
    paintQueued.current = requestAnimationFrame(paintNow);
  }, [paintNow]);

  /* Canvases of the right size whenever the box, the layers or the post's nearness change: the ink's, and the suds' over it. */
  useLayoutEffect(() => {
    if (!fixed) return;
    for (const canvas of [canvasRef.current, sudsRef.current]) {
      if (!canvas) continue;
      canvas.width = Math.ceil(box.w * dpr);
      canvas.height = Math.ceil(box.h * dpr);
    }
    schedulePaint();
  }, [near, built, fixed, box.w, box.h, dpr, schedulePaint]);

  useEffect(() => () => { if (paintQueued.current) cancelAnimationFrame(paintQueued.current); }, []);

  /* ------------------------------------------------------------------ the suds ---- */

  /* The suds module draws on this post's own canvas while the post is near (the ink's box, in px), and lets it go when the post leaves or goes. */
  const topInk = layers.reduce((color, l, i) => (view?.clean[i] ? color : l.color), layers[0]?.color ?? FALLBACK_INK);
  useEffect(() => {
    const canvas = sudsRef.current;
    const host = sudsHost.current;
    if (!near || !built || !fixed || !canvas) return;
    suds.register(host, canvas, box, dpr, topInk);
  }, [near, built, fixed, box, dpr, topInk]);
  /* Let go only when the post leaves or goes: a change of ink or box re-registers above, and the module keeps what is live. */
  useEffect(() => {
    if (!near || !built || !fixed) return;
    const host = sudsHost.current;
    return () => suds.unregister(host);
  }, [near, built, fixed]);

  /** What a move of the brush from `a` to `b` (shares of the box) throws up, in px of the box. */
  const throwSuds = useCallback((a: Pt, b: Pt, overInk: boolean) => {
    if (motionReduced()) return;
    const { box: bx } = now.current.size;
    suds.wash(sudsHost.current, { x: a[0] * bx.w, y: a[1] * bx.h }, { x: b[0] * bx.w, y: b[1] * bx.h }, overInk);
  }, []);

  /* ------------------------------------------------------------------- saving ---- */

  const flush = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const ids = [...dirty.current];
    dirty.current.clear();
    for (const id of ids) {
      /* One save per play on its way: a second would send the strokes of the first again, and an answer out of order could leave the older state saved. What is made meanwhile goes after this one answers. */
      if (sending.current.has(id)) {
        dirty.current.add(id);
        continue;
      }
      const kept = [...(mine.current.get(id) ?? [])];
      /* A saved state that already holds what an unanswered save carried: those strokes are in it, and are not sent on top of it. */
      const fresh = kept.slice(heldBy(id, canonical(now.current.states[id]?.state)));
      const cleanNow = wantClean.current.has(id);
      const clean = cleanNow || savedFor(id).clean;
      const all = [...savedFor(id).strokes, ...fresh];
      const room = fits(all);
      /* A layer with no room for more strokes can still be marked clean: the saved strokes go again with the mark, so a post the author washed clean is never left splatted for everyone. */
      if (!room && !cleanNow) {
        say('This layer has no room for more strokes to save. What you wash from here shows on your screen only, but washing it clean still clears it for everyone.');
        continue;
      }
      const strokes = (room ? all : [...savedFor(id).strokes]).map(packStroke);
      const state = clean ? { strokes, clean: true } : { strokes };
      sending.current.add(id);
      lastSent.current.set(id, canonical(state));
      sentCount.current.set(id, room ? kept.length : 0);
      let answer: Answer<unknown>;
      try {
        answer = await now.current.save(id, state);
      } catch {
        answer = { ok: false, error: LOST_ANSWER, uncertain: true };
      }
      sending.current.delete(id);
      if (!answer.ok) {
        say(answer.error);
        if (answer.uncertain) unanswered.current.set(id, [...(unanswered.current.get(id) ?? []), { state: lastSent.current.get(id)!, count: sentCount.current.get(id) ?? 0 }]);
        /* A refusal is the card's answer and would be the same again. A save that got no answer is sent again, a little later each time, and given up on after a few: the strokes stay, and the author's next one sends them. */
        const failed = (failures.current.get(id) ?? 0) + 1;
        failures.current.set(id, failed);
        if (answer.uncertain && failed <= MAX_SAVE_RETRIES) queueSave(id, RETRY_AFTER_MS * 2 ** (failed - 1));
        continue;
      }
      failures.current.delete(id);
      unanswered.current.delete(id);
      const savedAt = (answer.value as { readonly savedAt?: unknown } | null)?.savedAt;
      if (typeof savedAt === 'string') acked.current.set(id, { state, savedAt });
      say('');
      /* What was sent is now the saved version; strokes made while it was on its way are still to send. */
      mine.current.set(id, (mine.current.get(id) ?? []).slice(kept.length));
      if (cleanNow) wantClean.current.delete(id);
      /* Once the post has gone there is nothing left to wait on: what was made meanwhile goes at once. */
      if (dirty.current.has(id) || (mine.current.get(id) ?? []).length > 0 || wantClean.current.has(id)) queueSave(id, gone.current ? 0 : SAVE_AFTER_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedFor, say]);

  const queueSave = useCallback((id: string, after = SAVE_AFTER_MS) => {
    dirty.current.add(id);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flush(); }, after);
  }, [flush]);

  /*
   * A post left with strokes unsaved saves them as it goes. A play whose save is still on its way is not dropped: its strokes stay
   * marked, and the save on its way sends them once it is answered (`flush` above), from its own promise, which leaving does not cancel.
   * Once the post has gone, a save the card refuses, or one that got no answer through every retry, is not sent again, since no next
   * stroke will come to carry it; and a save another tab of the author's made meanwhile is not heard here, so the last of the two
   * to land is the layer's state, as with any two screens saving one play.
   */
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      if (dirty.current.size > 0) void flush();
    };
  }, [flush]);

  /**
   * A layer washed to the instance's share is clean: for this screen, and for everyone when the author did it. It is checked as the
   * ink is washed, on every move of a stroke and every frame of the sweep, so a layer clears the moment it reaches the share and not
   * when the hand lifts. True when a layer was cleared just now.
   */
  const checkClean = useCallback((): boolean => {
    const { layers: all, threshold, reader: who } = now.current;
    let cleared = false;
    all.forEach((layer, i) => {
      const ink = inks.current[i];
      if (!ink || cleanOf(i) || ink.washed < threshold) return;
      cleared = true;
      localClean.current.add(layer.play.id);
      if (who.author) {
        wantClean.current.add(layer.play.id);
        queueSave(layer.play.id);
      }
    });
    return cleared;
  }, [cleanOf, queueSave]);

  /**
   * A stroke ends: its lines on the model and the grid are lifted (a pen's `drops` with them), it is kept (in memory for a reader, and
   * also to be saved for the author, simplified and cut by `fitStroke`, with its drops on the last piece), and, where the layer's
   * picture is still being built, the stroke is queued on it as the model has it, to be applied once to the grid that arrives.
   */
  const conclude = useCallback((s: Live, lifted?: number) => {
    const drops: Drops | undefined = s.tool === 'ink' ? (lifted === undefined ? 0 : dropsOf(s.trail, lifted)) : undefined;
    lineEnd(s, drops);
    const id = now.current.layers[s.layer]?.play.id;
    if (!id || s.points.length === 0) return;
    const stroke: Stroke = s.tool === 'wash'
      ? { tool: 'wash', width: s.width, aspect: s.aspect, points: s.points }
      : { tool: 'ink', color: s.color, width: s.width, aspect: s.aspect, points: s.points, ...(drops !== undefined ? { drops } : null) };
    const pic = pics.current[s.layer];
    if (pic && !pic.grid && !s.gline) pic.late.push(stroke);
    const kept = fitStroke(stroke, minStepOf(now.current.size.box));
    mine.current.set(id, [...(mine.current.get(id) ?? []), ...kept]);
    if (now.current.reader.author) queueSave(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the line helpers are plain functions over refs
  }, [queueSave]);

  /* ------------------------------------------------------------------ a stroke ---- */

  /* The ink's places are claimed on the post's registry, so a card beneath this one (a wall) takes a press only where this card has none. A moment claims nothing. */
  useEffect(() => {
    if (still) return;
    return registry.claim((x, y) => {
      const el = now.current.surface ?? frameRef.current;
      if (!el) return false;
      const rect = el.getBoundingClientRect(), b = now.current.size.box;
      if (b.w <= 0 || b.h <= 0) return false;
      const px = (x - rect.left - el.clientLeft) / b.w, py = (y - rect.top - el.clientTop) / b.h;
      return topLayer(liveInks(), px, py) >= 0;
    });
  }, [registry, still, liveInks]);

  /** Where a point of the screen lies in the body's box, in shares of it. */
  const shareAt = (clientX: number, clientY: number): Pt => {
    const el = now.current.surface ?? frameRef.current!;
    const rect = el.getBoundingClientRect();
    const { box: b } = now.current.size;
    return [(clientX - rect.left - el.clientLeft) / b.w, (clientY - rect.top - el.clientTop) / b.h];
  };
  const writing = () => now.current.reader.author && now.current.tool === 'ink';
  /** The layer a stroke starting at `p` takes: the top one with ink there, or, for the author's pen, the top live one. */
  const layerAt = (p: Pt): number => {
    const lives = liveInks();
    if (writing()) return lives.reduce((top, ink, i) => (ink ? i : top), -1);
    /* A wash starts only where this card's ink is the outermost on the post: a card laid over it (nothing is, today) would take the press first. */
    const el = now.current.surface ?? frameRef.current;
    if (el) {
      const rect = el.getBoundingClientRect(), b = now.current.size.box;
      if (!registry.topAt(rect.left + el.clientLeft + p[0] * b.w, rect.top + el.clientTop + p[1] * b.h)) return -1;
    }
    return topLayer(lives, p[0], p[1]);
  };

  /** The stroke under way ends; `lifted` is the time of the event that lifted the pen (its speed decides the drops), none for a stroke cut short. */
  const finish = useCallback((lifted?: number) => {
    const s = live.current;
    live.current = null;
    if (!s) return;
    conclude(s, lifted);
    checkClean();
    refresh();
    schedulePaint();
  }, [checkClean, conclude, refresh, schedulePaint]);

  const suppress = useRef(false);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSuppress = () => {
    if (suppressTimer.current) clearTimeout(suppressTimer.current);
    suppressTimer.current = null;
    suppress.current = false;
  };
  /** After a touch ends the click that follows it is swallowed; if none comes it is forgotten shortly, so it never takes a later, unrelated click. */
  const armSuppress = () => {
    clearSuppress();
    suppress.current = true;
    suppressTimer.current = setTimeout(clearSuppress, SUPPRESS_MS);
  };
  /** What the drawn cursor shows, kept while a stroke is under way. */
  const shown = useRef<{ mode: CursorMode; ink?: string }>({ mode: null });

  /**
   * Begins a stroke at `p`, on the layer it takes: false when there is none, or when a stroke is already live. One hand makes one stroke:
   * a mouse press while a stroke is live is refused (`onPointerDown`), and a finger is refused the same way, so the stroke under way ends
   * with its own pointer (its pointerup, or the signs a pointerup was lost: capture lost, the window blurred or hidden, a mouse moving with no button down) and is saved whole. Finishing it for the finger would cut a pen line short on a palm resting on the screen.
   */
  const begin = (p: Pt, pointer: number, touch: boolean, t: number = performance.now()): boolean => {
    if (live.current) return false;
    const layer = layerAt(p);
    if (layer < 0) return false;
    meet();
    const pen = writing();
    const brush = brushOf(pen ? PEN_PX : BRUSH_PX, now.current.size.box);
    const { box: b } = now.current.size;
    const trail = [{ x: p[0] * b.w, y: p[1] * b.h, t }];
    live.current = pen
      ? { layer, tool: 'ink', ...brush, color: now.current.layers[layer]!.color, points: [p], pointer, trail, ...(touch ? { touch: true as const } : null) }
      : { layer, tool: 'wash', ...brush, color: '', points: [p], pointer, trail, ...(touch ? { touch: true as const } : null) };
    bindLines(live.current);
    suppress.current = false;
    schedulePaint();
    return true;
  };

  /** Carries the stroke to `p`: the ink under the brush is washed (or written), and the suds go up. */
  const extend = (s: Live, p: Pt, t?: number) => {
    const last = s.points[s.points.length - 1]!;
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) === 0) return;
    s.points.push(p);
    if (s.tool === 'ink' && t !== undefined) {
      const { box: b } = now.current.size;
      s.trail.push({ x: p[0] * b.w, y: p[1] * b.h, t });
      /* Only the last moments are read: what is older than the window, but for the point before it, goes. */
      while (s.trail.length > 2 && s.trail[1]!.t < t - 2 * DROPS_WINDOW_MS) s.trail.shift();
    }
    suppress.current = true;
    if (s.tool === 'wash') {
      const over = liveInks().some((ink) => ink?.has(p[0], p[1]));
      lineTo(s, p);
      throwSuds(last, p, over);
      /* A layer that reaches the share clears under the hand; the stroke goes on, and is kept with the mark when it ends. */
      if (checkClean()) refresh();
    } else {
      lineTo(s, p);
    }
    schedulePaint();
  };

  /** What the cursor shows at a pointer event: nothing over what the engine lifts, the author's pen while they write, the sponge over ink a stroke would take. */
  const cursorAt = (e: PointerEvent): { mode: CursorMode; ink?: string } => {
    if (live.current && !live.current.touch) return shown.current;
    if (overInk(e.target)) return { mode: null };
    const lives = liveInks();
    if (writing()) {
      const top = lives.reduce((at, ink, i) => (ink ? i : at), -1);
      if (top >= 0) return { mode: 'pen', ink: now.current.layers[top]!.color };
    }
    const p = shareAt(e.clientX, e.clientY);
    return topLayer(lives, p[0], p[1]) >= 0 ? { mode: 'sponge' } : { mode: null };
  };
  const showCursor = (e: PointerEvent) => {
    const el = now.current.surface;
    if (!el) return;
    shown.current = cursorAt(e);
    cursor.over(el, e, shown.current.mode, shown.current.ink);
  };

  /**
   * Called first by every press and pointer move: the words may have been moved between the cell and a view (Stick Around) with no render
   * and no observer callback, so the surface measured is checked against where the frame is now, and measured again at once if it differs.
   */
  const ensure = () => {
    const f = frameRef.current;
    if (!f) return;
    const cell = bleed ? f.closest<HTMLElement>('.kb-act-main') : null;
    if ((cell ?? f) !== now.current.surface) remeasure.current?.();
  };

  const onPointerDown = (e: PointerEvent) => {
    ensure();
    if (e.pointerType === 'touch' || !now.current.built || live.current || (e.pointerType === 'mouse' && e.button !== 0) || overInk(e.target)) return;
    const [x, y] = shareAt(e.clientX, e.clientY);
    /* No ink under the pointer, or no layer to write in: the page has it, for a link or a scroll. */
    if (!begin([x, y], e.pointerId, false, e.timeStamp)) return;
    e.preventDefault();
    (e.currentTarget as Element | null)?.setPointerCapture?.(e.pointerId);
    shown.current = { mode: writing() ? 'pen' : 'sponge', ink: writing() ? live.current!.color : undefined };
    cursor.press(true);
    if (now.current.surface) cursor.over(now.current.surface, e, shown.current.mode, shown.current.ink);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    ensure();
    const s = live.current;
    /* A mouse moving with no button down has lost its pointerup (released outside the window, say): the stroke ends here and the move is a hover. */
    if (s && !s.touch && e.pointerType === 'mouse' && e.buttons === 0 && (s.pointer === null || e.pointerId === s.pointer)) {
      finish();
      cursor.press(false);
    } else if (s && !s.touch && (s.pointer === null || e.pointerId === s.pointer)) extend(s, shareAt(e.clientX, e.clientY), e.timeStamp);
    showCursor(e);
  };

  const onPointerEnd = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    if (live.current && !live.current.touch && live.current.pointer !== null && e.pointerId !== live.current.pointer) return;
    const was = live.current;
    /* The pen's speed at the lift is the lift's own time; a cancelled pointer throws nothing. */
    finish(e.type === 'pointerup' ? e.timeStamp : undefined);
    if (was) {
      cursor.press(false);
      if (e.type === 'pointerup') showCursor(e);
      else if (now.current.surface) cursor.leave(now.current.surface);
    }
  };

  /** The stroke's pointer was taken from it (capture lost), or the window lost focus or went hidden: no pointerup may come, so a mouse or pen stroke ends here, kept as at any end. */
  const onStrokeLost = (e?: PointerEvent) => {
    const s = live.current;
    if (!s || s.touch) return;
    if (e && s.pointer !== null && e.pointerId !== s.pointer) return;
    finish();
    cursor.press(false);
    if (now.current.surface) cursor.leave(now.current.surface);
  };

  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || live.current) return;
    if (now.current.surface) cursor.leave(now.current.surface);
  };

  /* ---------------------------------------------------------------------- a finger ---- */

  const gesture = useRef<Gesture | null>(null);
  const settle = (g: Gesture) => { if (g.timer) clearTimeout(g.timer); g.timer = null; };

  const onTouchStart = (e: TouchEvent) => {
    ensure();
    if (e.touches.length > 1) {
      /* A second finger is the page's: a pinch or a scroll. A wipe already under way stops where it got to. */
      if (gesture.current) { settle(gesture.current); gesture.current.state = 'page'; }
      if (live.current?.touch) finish();
      return;
    }
    const tc = e.changedTouches[0];
    if (!tc || !now.current.built || overInk(e.target)) return;
    suppress.current = false;
    if (layerAt(shareAt(tc.clientX, tc.clientY)) < 0) return;
    const g: Gesture = { id: tc.identifier, x0: tc.clientX, y0: tc.clientY, cx: tc.clientX, cy: tc.clientY, state: 'wait', timer: null };
    gesture.current = g;
    g.timer = setTimeout(() => {
      if (gesture.current !== g || g.state !== 'wait') return;
      /* Held: the ink is grabbed, with a puff of suds and a short buzz where the device allows it. */
      g.state = 'wipe';
      begin(shareAt(g.x0, g.y0), g.id, true);
      const { box: b } = now.current.size;
      const [hx, hy] = shareAt(g.cx, g.cy);
      if (!motionReduced()) suds.puff(sudsHost.current, { x: hx * b.w, y: hy * b.h });
      try { navigator.vibrate?.(8); } catch { /* not offered here */ }
    }, HOLD_MS);
  };

  const onTouchMove = (e: TouchEvent) => {
    const g = gesture.current;
    if (!g) return;
    const tc = Array.from(e.changedTouches).find((c) => c.identifier === g.id);
    if (!tc) return;
    g.cx = tc.clientX;
    g.cy = tc.clientY;
    if (g.state === 'page') return;
    if (g.state === 'wait') {
      const kind = swipeKind(tc.clientX - g.x0, tc.clientY - g.y0);
      if (kind === 'wait') return;
      settle(g);
      /* A swipe mostly up or down is the page's scroll, and washes nothing; a sideways one wipes. */
      if (kind === 'page') { g.state = 'page'; return; }
      g.state = 'wipe';
      begin(shareAt(g.x0, g.y0), g.id, true);
    }
    /* Wiping: the page's scroll is refused for the rest of the touch. */
    if (e.cancelable) e.preventDefault();
    const s = live.current;
    if (s?.touch) extend(s, shareAt(tc.clientX, tc.clientY), e.timeStamp);
  };

  const onTouchEnd = (e: TouchEvent) => {
    const g = gesture.current;
    if (!g || !Array.from(e.changedTouches).some((c) => c.identifier === g.id)) return;
    settle(g);
    /* A tap on the ink washes one dab, as a click does. */
    if (e.type === 'touchend' && g.state === 'wait') begin(shareAt(g.x0, g.y0), g.id, true, e.timeStamp);
    /* A lifted finger is followed by a click; a cancelled touch is followed by none, so it clears whatever a wipe left. */
    if (e.type === 'touchcancel') clearSuppress();
    else if (g.state === 'wipe' || g.state === 'wait') armSuppress();
    gesture.current = null;
    if (live.current?.touch) finish(e.type === 'touchend' ? e.timeStamp : undefined);
  };

  /*
   * The input: the frame always, and in the thread the cell too (see the effect). The listeners are native, added here and taken off on
   * cleanup or when the cell changes, because the cell is the engine's and a touch move must not be passive (React's are). Each
   * calls the latest handler, so none is stale. The surface keeps `touch-action: pan-y pinch-zoom` so a sideways swipe never waits
   * on the browser.
   */
  const finishNow = useRef(finish);
  finishNow.current = finish;
  const handlers = useRef({ onPointerDown, onPointerMove, onPointerEnd, onStrokeLost, onPointerLeave, onTouchStart, onTouchMove, onTouchEnd });
  handlers.current = { onPointerDown, onPointerMove, onPointerEnd, onStrokeLost, onPointerLeave, onTouchStart, onTouchMove, onTouchEnd };
  useEffect(() => {
    const f = frameRef.current;
    if (!f || still) return;
    /*
     * Listeners are always on the frame, and in the thread on the cell as well. The words can be moved between the cell and a view with
     * no render, so neither element's place is trusted: the cell's handler takes nothing while the frame is not inside it, and nothing
     * whose target is inside the frame (the frame's own handler takes that), so a press is taken once and a stale cell never acts.
     */
    const els = [f, ...(cellEl && cellEl !== f ? [cellEl] : [])];
    const wasTouch = new Map(els.map((el) => [el, el.style.touchAction]));
    const grip = () => {
      f.style.touchAction = 'pan-y pinch-zoom';
      if (cellEl) {
        const want = cellEl.contains(f) ? 'pan-y pinch-zoom' : wasTouch.get(cellEl)!;
        if (cellEl.style.touchAction !== want) cellEl.style.touchAction = want;
      }
    };
    grip();
    const mine = (el: HTMLElement, e: Event) => {
      grip();
      if (el === f) return true;
      const t = e.target;
      return el.contains(f) && !(t instanceof Node && f.contains(t));
    };
    const offs = els.map((el) => {
      const down = (e: PointerEvent) => { if (mine(el, e)) handlers.current.onPointerDown(e); };
      const move = (e: PointerEvent) => { if (mine(el, e)) handlers.current.onPointerMove(e); };
      const end = (e: PointerEvent) => { if (mine(el, e)) handlers.current.onPointerEnd(e); };
      const lostCapture = (e: PointerEvent) => { if (mine(el, e)) handlers.current.onStrokeLost(e); };
      const leave = (e: PointerEvent) => { if (mine(el, e)) handlers.current.onPointerLeave(e); };
      const tstart = (e: TouchEvent) => { if (mine(el, e)) handlers.current.onTouchStart(e); };
      const tmove = (e: TouchEvent) => { if (mine(el, e)) handlers.current.onTouchMove(e); };
      const tend = (e: TouchEvent) => { if (mine(el, e)) handlers.current.onTouchEnd(e); };
      const click = (e: MouseEvent) => { if (mine(el, e) && suppress.current) { clearSuppress(); e.preventDefault(); e.stopPropagation(); } };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('lostpointercapture', lostCapture);
      el.addEventListener('pointerleave', leave);
      el.addEventListener('touchstart', tstart, { passive: true });
      el.addEventListener('touchmove', tmove, { passive: false });
      el.addEventListener('touchend', tend);
      el.addEventListener('touchcancel', tend);
      el.addEventListener('click', click, true);
      return () => {
        el.removeEventListener('pointerdown', down);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', end);
        el.removeEventListener('pointercancel', end);
        el.removeEventListener('lostpointercapture', lostCapture);
        el.removeEventListener('pointerleave', leave);
        el.removeEventListener('touchstart', tstart);
        el.removeEventListener('touchmove', tmove);
        el.removeEventListener('touchend', tend);
        el.removeEventListener('touchcancel', tend);
        el.removeEventListener('click', click, true);
        el.style.touchAction = wasTouch.get(el)!;
        cursor.leave(el);
      };
    });
    /* A window that loses focus or is hidden may never send the pointerup (an alt-tab or a dialog mid-stroke). */
    const away = () => handlers.current.onStrokeLost();
    const hidden = () => { if (document.hidden) away(); };
    window.addEventListener('blur', away);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', away);
      document.removeEventListener('visibilitychange', hidden);
      for (const off of offs) off();
      if (gesture.current) { settle(gesture.current); gesture.current = null; }
      /* A stroke under way when the listeners go is the author's work: it is kept and saved as at any end. */
      finishNow.current();
      clearSuppress();
    };
  }, [cellEl, still]);

  /* ------------------------------------------------------------ the keyboard path ---- */

  const sweeping = useRef<{ raf: number; last: number; sweep: Sweep; row: number } | null>(null);
  const sweepFrom = useRef(0);
  const sweepRefreshed = useRef(0);

  const closeSweepStroke = useCallback(() => {
    const s = sweepStroke.current;
    sweepStroke.current = null;
    if (s) conclude(s);
  }, [conclude]);

  const stopSweep = useCallback(() => {
    const run = sweeping.current;
    if (!run) return;
    cancelAnimationFrame(run.raf);
    sweepFrom.current = run.sweep.row;
    sweeping.current = null;
    closeSweepStroke();
    checkClean();
    refresh();
    schedulePaint();
  }, [checkClean, closeSweepStroke, refresh, schedulePaint]);

  const startSweep = useCallback(() => {
    if (stillNow.current || sweeping.current || !built || inks.current.length !== now.current.layers.length) return;
    const b = now.current.size.box;
    const rows = bandsOf(b);
    const brush = brushOf(SWEEP_BRUSH_ROWS * ROW_PX, b);
    const half = ROW_PX / 2 / b.h;
    const run = { raf: 0, last: performance.now(), sweep: { row: Math.min(sweepFrom.current, rows.length - 1), x: 0 } as Sweep, row: -1 };
    sweeping.current = run;
    const tick = (t: number) => {
      const dt = Math.min(0.05, Math.max(0, (t - run.last) / 1000));
      run.last = t;
      const lives = liveInks();
      /* A band's ink: where the top of any live layer still has some, so the sweep waits out no empty line. */
      const span = (row: number): readonly [number, number] | null => {
        let lo = Infinity, hi = -Infinity;
        for (const ink of lives) {
          const s = ink?.inkSpan(rows[row]!, half);
          if (s) { lo = Math.min(lo, s[0]); hi = Math.max(hi, s[1]); }
        }
        return lo <= hi ? [lo, hi] : null;
      };
      const step = sweepStep(rows, run.sweep, dt, span);
      if (step.idle) {
        stopSweep();
        return;
      }
      const p = step.point;
      /* The layer under the brush; between flecks of ink it keeps to the layer it was washing, and starts the band on the top one that has ink in it. */
      let layer = topLayer(lives, p[0], p[1]);
      const open = sweepStroke.current;
      const sameBand = open !== null && step.sweep.row === run.sweep.row;
      if (layer < 0) layer = sameBand ? open.layer : lives.reduce((top, ink, i) => (ink?.inkNear(rows[step.sweep.row]!, half) ? i : top), -1);
      if (open && (!sameBand || open.layer !== layer)) closeSweepStroke();
      if (layer >= 0) {
        meet();
        const cur = sweepStroke.current;
        if (cur) {
          const last = cur.points[cur.points.length - 1]!;
          cur.points.push(p);
          lineTo(cur, p);
          throwSuds(last, p, true);
        } else {
          const open: Live = { layer, tool: 'wash', ...brush, color: '', points: [p], pointer: null, trail: [] };
          bindLines(open);
          sweepStroke.current = open;
          throwSuds(p, p, true);
        }
      }
      run.sweep = step.sweep;
      checkClean();
      if (t - sweepRefreshed.current > REFRESH_MS) {
        sweepRefreshed.current = t;
        refresh();
      }
      schedulePaint();
      run.raf = requestAnimationFrame(tick);
    };
    run.raf = requestAnimationFrame(tick);
  }, [built, checkClean, closeSweepStroke, liveInks, meet, refresh, schedulePaint, stopSweep, throwSuds]);

  /* The latest stop, called once on unmount: a sweep is not stopped each time a callback is made again. */
  const stopLatest = useRef(stopSweep);
  stopLatest.current = stopSweep;
  useEffect(() => () => stopLatest.current(), []);

  /* ------------------------------------------------------------------ rendering ---- */

  const anyLive = view ? view.clean.some((c) => !c) : true;
  const covers = view ? view.covered.some(Boolean) : true;
  /* Until the ink is built the post is treated as covered: nothing is read before the model says what is. */
  const hidden = anyLive && covers;
  /* Drawn still the body is not inert (a moment makes nothing inert), so nothing needs reading out beside it. */
  const read = view && hidden && !still ? view.lines.filter((_, i) => !view.covered[i]) : null;
  /*
   * What each change of the view uncovered: a line covered before and readable now, known by its words (and which of the same words
   * it is), so a relayout that renumbers the lines says nothing. The first view only sets what was readable, and a post washed clean
   * says nothing: its own words are read then, once.
   */
  const lineKeys = view ? (() => {
    const seen = new Map<string, number>();
    return view.lines.map((l) => { const k = seen.get(l.text) ?? 0; seen.set(l.text, k + 1); return `${k}\u0000${l.text}`; });
  })() : null;
  const readNow = view && lineKeys ? lineKeys.filter((_, i) => !view.covered[i]) : null;
  const readKey = readNow === null ? null : `${anyLive ? 'live' : 'plain'}\u0001${readNow.join('\u0001')}`;
  useEffect(() => {
    /* A moment says nothing as news: nothing in it is uncovered by a reader. */
    if (!view || !readNow || still) return;
    const before = readBefore.current;
    readBefore.current = new Set(readNow);
    if (!before || !anyLive) return;
    const fresh = readNow.filter((k) => !before.has(k)).map((k) => k.slice(k.indexOf('\u0000') + 1));
    if (fresh.length > 0) setUncovered((was) => ({ words: fresh.join(' '), n: was.n + 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- readKey is what the view's lines and cover say, and nothing else is read
  }, [readKey]);
  /*
   * What the card says of itself on this post (`EffectProps.show`, marks-and-the-lens design, sections 3 and 6): no plate is drawn, the
   * Lens and the mark are. `state` is the old readout's sentence: how many layers there are (washed clean or not, as each play's
   * line counts them, "Layer 2 of 3"), and the top one that holds ink, which is the layer the next stroke washes, named by its
   * caster and its ink in words (names.ts, never a hex code), with its own share washed on this screen, as the model says (geometry,
   * never a pixel read). `progress` is the mean share washed of the layers that still hold ink, the mark's edge.
   */
  const cleanAt = (i: number) => (view ? view.clean[i] === true : false);
  const percent = (i: number) => percentWashed(view?.washed[i] ?? 0, cleanAt(i));
  const top = layers.reduce((at, _, i) => (cleanAt(i) ? at : i), -1);
  /* In a moment, each layer top first, as it stood: "Gloomba's yellow, 40% washed; Spritey's cyan, washed clean". */
  const stillLine = (i: number) => `${nameOf(layers[i]!.play.caster)}'s ${inkName(layers[i]!.color)}, ${cleanAt(i) ? 'washed clean' : `${percent(i)}% washed`}`;
  /* A share that is not a number counts as nothing washed, so the view and the key it is published on agree (JSON turns NaN into null). */
  const inked = layers.flatMap((_, i) => { const w = view?.washed[i] ?? 0; return cleanAt(i) ? [] : [Number.isFinite(w) ? Math.min(1, w) : 0]; });
  const progress = inked.length === 0 ? null : inked.reduce((sum, w) => sum + w, 0) / inked.length;
  /* The heading is the mark's own progress, for this reader ("41% washed for you"); which layer is on top is each layer's note. */
  const state = still ? 'As it landed' : progress === null ? 'Washed clean' : `${percentWashed(progress, false)}% washed for you`;
  /* Each layer's line for its Who row: "Layer 3 of 3, on top · 40% washed", or "Washed clean". */
  const lineOf = (i: number) => (cleanAt(i) ? 'Washed clean' : `Layer ${i + 1} of ${layers.length}${i === top ? ', on top' : ''} · ${percent(i)}% washed`);
  const notes = Object.fromEntries(layers.map((l, i) => [l.play.id, still ? stillLine(i) : lineOf(i)]));
  const author = reader.author;
  /*
   * The controls are made again only when the tool or the author changes: the engine compares a view's controls by function
   * reference (plays.ts `sameView`), so a sweep's numbers changing every few frames must not make new ones. `startSweep` and
   * `stopSweep` are the hold, and the author's choice is the effect's own `tool` state ("Your tools, as the author"): the author's stroke is the
   * wash saved for everyone, so there is no third option.
   */
  const chooseTool = useCallback((value: string) => setTool(value === 'ink' ? 'ink' : 'wash'), []);
  const controls = useMemo<readonly KitControl[]>(() => {
    if (!anyLive || still) return [];
    const hold: KitControl = { kind: 'hold', label: 'Hold to scrub', describe: HOLD_HELP, start: startSweep, stop: stopSweep };
    if (!author) return [hold];
    return [hold, { kind: 'choose', label: 'Your tools, as the author', options: TOOLS, value: tool, choose: chooseTool }];
  }, [anyLive, still, author, tool, startSweep, stopSweep, chooseTool]);
  const cardView: CardView = {
    progress, state, ...(anyLive && !still ? { ends: author ? ENDS_AUTHOR : ENDS } : null), yours: author && anyLive && !still, controls, notes, ...(report ? { report } : null),
  };
  /* Said when it changes: the model's numbers are published at REFRESH_MS while a sweep runs, so this is never more than a frame's work. */
  const viewKey = JSON.stringify([progress, state, anyLive, author, report, notes, still]);
  const viewNow = useRef(cardView);
  viewNow.current = cardView;
  useEffect(() => { show(viewNow.current); }, [viewKey, controls, show]);

  /* The canvases are the box's size, reaching out of the frame to the box's corner. */
  const onBox = { left: -size.left, top: -size.top, width: box.w, height: box.h };
  return (
    <div
      className="kb-whoops" data-kb-whoops
      data-kb-layers={view ? view.clean.map((c) => (c ? 'clean' : 'live')).join(' ') : layers.map(() => 'live').join(' ')}
      data-kb-washed={view ? view.washed.map((w) => w.toFixed(3)).join(' ') : layers.map(() => '0').join(' ')}
      data-kb-fading={view?.fading ? 'true' : undefined}
      data-kb-place={place}
      data-kb-held={held}
      data-kb-pictures={pictures}
      data-kb-splat={splats?.map((sp) => `${sp.placement.cx},${sp.placement.cy}`).join(' ')}
    >
      <div ref={frameRef} className="kb-whoops-frame" style={bleed ? { overflow: 'visible' } : undefined}>
        <div ref={layoutRef} data-kb-whoops-layout="" inert={hidden && !still}>
          {children}
        </div>
        {near && fixed && built && (
          <>
            <canvas ref={canvasRef} className="kb-whoops-ink" data-kb-effect-ink aria-hidden="true" style={onBox} />
            <canvas ref={sudsRef} className="kb-whoops-suds" data-kb-effect-ink aria-hidden="true" style={onBox} />
          </>
        )}
      </div>
      {read && read.length > 0 && (
        <div className="kb-visually-hidden" data-kb-readout>
          {read.map((line, i) => <span key={i}>{line.text} </span>)}
        </div>
      )}
      {/*
        * What a screen reader is told, in regions on the page from the start and empty until they speak (WCAG 4.1.3; #89 P2-1): the
        * lines a scrub has just uncovered, and the save's report. The readout above is for reading, never said as news. The
        * report's visible copy is the Lens's (`CardView.report`).
        */}
      <p className="kb-visually-hidden" aria-live="polite" data-kb-uncovered>{uncovered.words}{uncovered.words && uncovered.n % 2 === 0 ? '\u00a0' : ''}</p>
      <p className="kb-visually-hidden" role="status" data-kb-report>{report}</p>
    </div>
  );
}
