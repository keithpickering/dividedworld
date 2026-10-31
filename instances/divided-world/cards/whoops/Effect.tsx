/**
 * Whoops!'s effect on a post (the screens' design, section 11; cards plan Task 5): up to three layers of
 * seeded ink laid over the post's words, a reader's scrubbing on their own screen, the author's saved for
 * everyone, and the keyboard path ("Hold to scrub").
 *
 * The post stays the board's 2003 post. While it is splatted its body is laid out once at a reference
 * width, the post body's at the board's widest (scrub.ts `REF_WIDTH`), and scaled as a whole to the frame
 * (`layoutOf`), centered, so lines break in the same places everywhere, and as the post's own would. In the
 * thread the frame is the post's whole body, border to border (whoops.css bleeds it over the body's gutters,
 * and the layout keeps them as padding), so the ink covers the body edge to edge and lies within 0 to 1 of
 * the layout's width, where a stroke can wash it. In the ORIGIN box the frame is the box's content, as it was.
 * Every stroke, kept in widths of that layout, lands on the same words. The ink is a canvas laid over it; the tag and the button are the glass reaching in (`tag` in cards.ts draws the
 * tag, the button is here), on the `effect` smoke.
 *
 * What is the model and what is drawn. A layer's ink is the seeded splat less the strokes washed on it
 * (scrub.ts `LayerInk`), which is geometry and costs no canvas, so which layer a stroke scrubs, how much
 * of a layer is washed and which lines of text lie under ink are answered without reading a pixel and
 * are the same on every screen. The author's pen strokes (written back in a layer's ink) are that layer's ink
 * like the splat: a reader's stroke scrubs them on their screen, a line under one is hidden from a screen reader,
 * and the layers above them cover them. The canvas (paint.ts) only draws that model, and only for a post near
 * the viewport: a page can hold many splatted posts and a canvas is megabytes. The grids the model keeps
 * are let go with it (a post that has left holds only the strokes made on this screen) and are built
 * again when it returns.
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
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { motionReduced } from '../../../../engine/ui/appearance.ts';
import { LOST_ANSWER, type Answer } from '../../../../engine/ui/data/api.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import { EffectStrip } from '../../../../engine/ui/cards/Effects.tsx';
import type { CardPlay, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { readLines } from './lines.ts';
import { MAX_DPR, paint, type Geometry, type PaintLayer } from './paint.ts';
import {
  BODY_GUTTER, BRUSH, LayerInk, PEN, REF_WIDTH, SWEEP_BRUSH, ROW, bandsOf, coveredLines, fits, fitStroke, layoutOf, sweepStep, toLayout, topLayer,
  type Pt, type Stroke, type Sweep, type TextLine,
} from './scrub.ts';
import { luminance, makeSplat, type Splat } from './splat.ts';
import './whoops.css';

/** A burst of strokes is saved once it has been quiet this long. */
export const SAVE_AFTER_MS = 800;
/** How long after a save that did not get through the next try waits, doubling on each failure. */
export const RETRY_AFTER_MS = 2000;
/** How many times in a row a save is sent again before it is left to the author's next stroke. */
export const MAX_SAVE_RETRIES = 6;
/** The share of a layer washed that counts as clean where the instance's settings do not say (an instance seeded before the setting existed). */
const DEFAULT_CLEAN = 95;
/** How long a layer takes to fade once it is washed clean, unless motion is reduced. */
const FADE_MS = 700;
/** How often the model's published numbers and covered lines are recomputed while a sweep runs. */
const REFRESH_MS = 150;
/** The ink of a play whose config carries none we can draw (the server keeps one, so this is a safeguard). */
const FALLBACK_INK = '#ff2bd6';

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

const isPoint = (p: unknown): p is Pt => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number';

/** A play's saved state, read defensively: the server checked it, but a state is data from outside. */
function savedOf(saved: unknown): { strokes: Stroke[]; clean: boolean } {
  const state = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : undefined;
  const raw = state?.strokes;
  const strokes: Stroke[] = [];
  if (Array.isArray(raw)) {
    for (const s of raw as Record<string, unknown>[]) {
      if (typeof s !== 'object' || s === null || typeof s.width !== 'number' || !Array.isArray(s.points) || !s.points.every(isPoint)) continue;
      if (s.tool === 'wash') strokes.push({ tool: 'wash', width: s.width, points: s.points as Pt[] });
      else if (s.tool === 'ink' && typeof s.color === 'string') strokes.push({ tool: 'ink', color: s.color, width: s.width, points: s.points as Pt[] });
    }
  }
  return { strokes, clean: state?.clean === true };
}

/** A saved state as one string, whatever order the server's copy lists its keys in, to tell a copy of what was just sent from a different state. */
const canonical = (state: unknown): string => JSON.stringify(savedOf(state));

/** A stroke being made. */
interface Live { readonly layer: number; readonly tool: 'wash' | 'ink'; readonly width: number; readonly color: string; readonly points: Pt[]; readonly pointer: number | null }

/** What the component publishes of its model, to render from and for the tests to read. */
interface View {
  readonly clean: readonly boolean[];
  readonly washed: readonly number[];
  readonly lines: readonly TextLine[];
  readonly covered: readonly boolean[];
  readonly fading: boolean;
}

export function Effect({ post, plays, states, reader, save, slot, place, children }: EffectProps) {
  const { settings } = useKayfa();
  const help = useId();
  const layers = useMemo<readonly Layer[]>(() => plays.map((play) => ({ play, color: inkOf(play), seed: seedOf(play) })), [plays]);
  const [size, setSize] = useState({ frame: 0, height: 0, above: 0, cell: 0 });
  const [near, setNear] = useState(true);
  const [built, setBuilt] = useState(false);
  const [tool, setTool] = useState<'wash' | 'ink'>('wash');
  const [report, setReport] = useState('');
  const [view, setView] = useState<View | null>(null);
  /** How many layers' ink grids are held: none for a post that has left the viewport. */
  const [held, setHeld] = useState(0);

  /** In the thread the frame is the post's whole body and the ink runs to its borders, the reactions drawn in front of it, and the header and footer bars outside it. */
  const bleed = place === 'thread';
  const frameRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sudsRef = useRef<HTMLDivElement>(null);

  /* What the handlers read: the latest of everything, so a handler made once is never stale. */
  const now = useRef({ layers, states, reader, save, tool, threshold: (settings.cardSettings['whoops.clean'] ?? DEFAULT_CLEAN) / 100, size, near });
  now.current = { layers, states, reader, save, tool, threshold: (settings.cardSettings['whoops.clean'] ?? DEFAULT_CLEAN) / 100, size, near };
  const inks = useRef<LayerInk[]>([]);
  /** The strokes made on this screen, by play: a reader's, which are never saved, and the author's not yet saved. */
  const mine = useRef(new Map<string, Stroke[]>());
  const localClean = useRef(new Set<string>());
  const wantClean = useRef(new Set<string>());
  const dirty = useRef(new Set<string>());
  /** The plays with a save on its way, and the state last sent for each (compared as `canonical`, so the server's echo of it is told from news). */
  const sending = useRef(new Set<string>());
  const lastSent = useRef(new Map<string, string>());
  /** How many saves in a row have not got through, by play. */
  const failures = useRef(new Map<string, number>());
  /** The state each play's last save from this screen was answered for, and when the server saved it. */
  const acked = useRef(new Map<string, { readonly state: unknown; readonly savedAt: string }>());
  /** The post has left the screen: a save still on its way goes on, and nothing writes to this component's state. */
  const gone = useRef(false);
  const say = useCallback((words: string) => { if (!gone.current) setReport(words); }, []);
  /** What the ink grids were built from, so a state that changes nothing in them does not build them again. */
  const builtFrom = useRef<{ splats: readonly Splat[]; height: number; payload: unknown; states: Map<string, string> } | null>(null);
  const cleanedAt = useRef(new Map<string, number>());
  const wasClean = useRef<readonly boolean[] | null>(null);
  const live = useRef<Live | null>(null);
  const textLines = useRef<TextLine[]>([]);
  const paintQueued = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const frame = size.frame;
  const fixed = frame > 0;
  const geo = layoutOf(frame || REF_WIDTH);
  const height = size.height / REF_WIDTH;
  /* The sweep reads the layout's geometry as it is each frame, not as it was when the sweep began: a resize mid-sweep moves the suds with the words. */
  const geoNow = useRef(geo);
  geoNow.current = geo;

  /* ------------------------------------------------------------------ measuring ---- */

  useLayoutEffect(() => {
    const f = frameRef.current;
    const l = layoutRef.current;
    if (!f || !l) return;
    /* In the thread the ink reaches the post body's borders (the owner's word), so the body, the cell this sits in, is measured too: how far down it the frame starts and how tall it is. */
    const cell = bleed ? f.closest<HTMLElement>('.kb-act-main') : null;
    const measure = () => setSize((prev) => {
      const next = { frame: f.clientWidth, height: l.offsetHeight, above: cell ? f.getBoundingClientRect().top - cell.getBoundingClientRect().top : 0, cell: cell ? cell.clientHeight : 0 };
      return prev.frame === next.frame && prev.height === next.height && prev.above === next.above && prev.cell === next.cell ? prev : next;
    });
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const watch = new ResizeObserver(measure);
    watch.observe(f);
    watch.observe(l);
    if (cell) watch.observe(cell);
    return () => watch.disconnect();
  }, []);

  /* Only a post near the viewport is drawn: past a screen above or below, the canvas is dropped. */
  useEffect(() => {
    const f = frameRef.current;
    if (!f || typeof IntersectionObserver !== 'function') return;
    const watch = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { rootMargin: '100% 0px' });
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

  /** Recompute everything a render or a test reads of the model, and what is covered. */
  const refresh = useCallback(() => {
    const all = now.current.layers;
    if (inks.current.length !== all.length) return;
    const clean = all.map((_, i) => cleanOf(i));
    const before = wasClean.current;
    clean.forEach((c, i) => { if (c && !(before?.[i] ?? true)) cleanedAt.current.set(all[i]!.play.id, performance.now()); });
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

  /* Rebuild every layer's ink when the splats change (the post's height, the plays) or a saved state arrives, and let it go when the post is far from the viewport. */
  const splats = useMemo<readonly Splat[] | null>(() => (built ? layers.map((l) => makeSplat(l.seed)) : null), [built, layers]);
  useEffect(() => {
    if (!splats) return;
    if (!near) {
      /* Only the grids go: the strokes made on this screen are in `mine`, the saved ones are in the states, and both come back with the grids. */
      inks.current = [];
      builtFrom.current = null;
      setHeld(0);
      return;
    }
    const fromStates = new Map(layers.map((l) => [l.play.id, canonical(states[l.play.id]?.state)]));
    const was = builtFrom.current;
    /* The state that comes back from this screen's own save is what the grids already hold (the strokes in it were washed into them as they were made). */
    const echo = was !== null && inks.current.length === layers.length && was.splats === splats && was.height === height && was.payload === post.currentPayload
      && layers.every((l) => fromStates.get(l.play.id) === was.states.get(l.play.id) || fromStates.get(l.play.id) === lastSent.current.get(l.play.id));
    builtFrom.current = { splats, height, payload: post.currentPayload, states: fromStates };
    if (echo) {
      refresh();
      schedulePaint();
      return;
    }
    inks.current = splats.map((splat, i) => {
      const id = layers[i]!.play.id;
      const ink = new LayerInk(splat, savedOf(states[id]?.state).strokes, { minX: 0, maxX: 1, minY: 0, maxY: height });
      for (const s of mine.current.get(id) ?? []) {
        if (s.tool === 'wash') ink.wash(s.points, s.width);
        else ink.pen(s.points, s.width);
      }
      return ink;
    });
    setHeld(inks.current.length);
    const body = layoutRef.current;
    if (body) {
      const read = readLines(body, layoutOf(now.current.size.frame || REF_WIDTH).scale);
      textLines.current = read.length > 0 ? read : [{ top: 0, bottom: height, text: body.textContent ?? '' }];
    }
    refresh();
    schedulePaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splats, states, post.currentPayload, height, near]);

  /* ----------------------------------------------------------------- the canvas ---- */

  const dpr = typeof window === 'undefined' ? 1 : Math.min(MAX_DPR, window.devicePixelRatio || 1);
  /** The rows the splats reach, in px down the frame: the canvas covers these and nothing more. */
  const band = useMemo(() => {
    if (!splats || !fixed) return { top: 0, height: 0 };
    const lo = Math.min(...splats.map((s) => s.bounds.minY)) * geo.width - 8;
    const hi = Math.max(...splats.map((s) => s.bounds.maxY)) * geo.width + 8;
    /* The canvas may reach up and down the post's body past the words (the tag above, the reactions below) when it has a body to reach; otherwise it stops at the words. */
    const floor = size.cell > 0 ? -size.above : 0;
    const ceiling = size.cell > 0 ? size.cell - size.above : size.height * geo.scale;
    const top = Math.max(floor, lo);
    return { top, height: Math.max(1, Math.min(ceiling, hi) - top) };
  }, [splats, fixed, geo.width, geo.scale, size.height, size.cell, size.above]);

  const paintNow = useCallback(() => {
    paintQueued.current = 0;
    const canvas = canvasRef.current;
    const { layers: all, size: sz } = now.current;
    if (!canvas || !now.current.near || sz.frame <= 0 || inks.current.length !== all.length) return;
    const g = layoutOf(sz.frame);
    const geometry: Geometry = { dpr, width: g.width, offset: g.offset, top: band.top, scale: g.scale };
    const reduced = motionReduced();
    const stroking = live.current;
    let fading = false;
    const painted: PaintLayer[] = [];
    all.forEach((layer, i) => {
      const id = layer.play.id;
      const clean = savedFor(id).clean || localClean.current.has(id);
      let alpha = 1;
      if (clean) {
        const at = cleanedAt.current.get(id);
        alpha = reduced || at === undefined ? 0 : Math.max(0, 1 - (performance.now() - at) / FADE_MS);
        if (alpha > 0) fading = true;
      }
      const strokes = [...savedFor(id).strokes, ...(mine.current.get(id) ?? [])];
      if (stroking && stroking.layer === i) {
        strokes.push(stroking.tool === 'wash' ? { tool: 'wash', width: stroking.width, points: stroking.points } : { tool: 'ink', color: stroking.color, width: stroking.width, points: stroking.points });
      }
      if (alpha > 0) painted.push({ splat: inks.current[i]!.splat, color: layer.color, strokes, alpha });
    });
    paint(canvas, geometry, painted);
    if (fading) schedulePaint();
  }, [band.top, dpr, savedFor]);

  const schedulePaint = useCallback(() => {
    if (paintQueued.current) return;
    paintQueued.current = requestAnimationFrame(paintNow);
  }, [paintNow]);

  /* A canvas of the right size whenever the frame, the layers or the post's nearness change. */
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fixed) return;
    canvas.width = Math.ceil(frame * dpr);
    canvas.height = Math.ceil(band.height * dpr);
    schedulePaint();
  }, [near, built, fixed, frame, band.height, dpr, schedulePaint]);

  useEffect(() => () => { if (paintQueued.current) cancelAnimationFrame(paintQueued.current); }, []);

  /* ------------------------------------------------------------------ the suds ---- */

  const lastSud = useRef(0);
  const sud = useCallback((x: number, y: number) => {
    const host = sudsRef.current;
    if (!host || motionReduced()) return;
    const t = performance.now();
    if (t - lastSud.current < 45) return;
    lastSud.current = t;
    while (host.childElementCount >= 24) host.firstElementChild?.remove();
    for (let k = 0; k < 2; k++) {
      const bubble = document.createElement('span');
      bubble.className = 'kb-whoops-sud';
      const d = 4 + Math.random() * 8;
      bubble.style.cssText = `left:${x - d / 2}px;top:${y - d / 2}px;width:${d}px;height:${d}px`;
      host.append(bubble);
      const dx = (Math.random() - 0.5) * 36;
      const rise = -(8 + Math.random() * 26);
      if (typeof bubble.animate === 'function') {
        bubble.animate([{ transform: 'translate(0, 0) scale(1)', opacity: 0.9 }, { transform: `translate(${dx}px, ${rise}px) scale(0.2)`, opacity: 0 }], { duration: 600 + Math.random() * 300, easing: 'ease-out' }).onfinish = () => bubble.remove();
      } else {
        setTimeout(() => bubble.remove(), 700);
      }
    }
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
      const cleanNow = wantClean.current.has(id);
      const clean = cleanNow || savedFor(id).clean;
      const all = [...savedFor(id).strokes, ...kept];
      const room = fits(all);
      /* A layer with no room for more strokes can still be marked clean: the saved strokes go again with the mark, so a post the author washed clean is never left splatted for everyone. */
      if (!room && !cleanNow) {
        say('This layer has no room for more strokes to save. What you wash from here shows on your screen only, but washing it clean still clears it for everyone.');
        continue;
      }
      const strokes = room ? all : [...savedFor(id).strokes];
      const state = clean ? { strokes, clean: true } : { strokes };
      sending.current.add(id);
      lastSent.current.set(id, canonical(state));
      let answer: Answer<unknown>;
      try {
        answer = await now.current.save(id, state);
      } catch {
        answer = { ok: false, error: LOST_ANSWER, uncertain: true };
      }
      sending.current.delete(id);
      if (!answer.ok) {
        say(answer.error);
        /* A refusal is the card's answer and would be the same again. A save that got no answer is sent again, a little later each time, and given up on after a few: the strokes stay, and the author's next one sends them. */
        const failed = (failures.current.get(id) ?? 0) + 1;
        failures.current.set(id, failed);
        if (answer.uncertain && failed <= MAX_SAVE_RETRIES) queueSave(id, RETRY_AFTER_MS * 2 ** (failed - 1));
        continue;
      }
      failures.current.delete(id);
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

  /** A layer washed to the instance's share is clean: for this screen, and for everyone when the author did it. */
  const checkClean = useCallback(() => {
    const { layers: all, threshold, reader: who } = now.current;
    all.forEach((layer, i) => {
      const ink = inks.current[i];
      if (!ink || cleanOf(i) || ink.washed < threshold) return;
      localClean.current.add(layer.play.id);
      if (who.author) {
        wantClean.current.add(layer.play.id);
        queueSave(layer.play.id);
      }
    });
  }, [cleanOf, queueSave]);

  /** A finished stroke is kept: in memory for a reader, and also to be saved for the author. */
  const keep = useCallback((s: Live) => {
    const id = now.current.layers[s.layer]?.play.id;
    if (!id || s.points.length === 0) return;
    const stroke: Stroke = s.tool === 'wash' ? { tool: 'wash', width: s.width, points: s.points } : { tool: 'ink', color: s.color, width: s.width, points: s.points };
    const kept = fitStroke(stroke);
    mine.current.set(id, [...(mine.current.get(id) ?? []), ...kept]);
    if (now.current.reader.author) queueSave(id);
  }, [queueSave]);

  /* ------------------------------------------------------------------ a stroke ---- */

  const at = (e: ReactPointerEvent): Pt => {
    const rect = frameRef.current!.getBoundingClientRect();
    return toLayout([e.clientX - rect.left, e.clientY - rect.top], now.current.size.frame);
  };
  const screenAt = (e: ReactPointerEvent): Pt => {
    const rect = frameRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const finish = useCallback(() => {
    const s = live.current;
    live.current = null;
    if (!s) return;
    keep(s);
    checkClean();
    refresh();
    schedulePaint();
  }, [checkClean, keep, refresh, schedulePaint]);

  const suppress = useRef(false);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!built || live.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const p = at(e);
    const lives = liveInks();
    const topAny = lives.reduce((top, ink, i) => (ink ? i : top), -1);
    const pen = now.current.reader.author && now.current.tool === 'ink';
    const layer = pen ? topAny : topLayer(lives, p[0], p[1]);
    /* No ink under the finger, or no layer to write in: the page has the touch, for a link or a scroll. */
    if (layer < 0) return;
    e.preventDefault();
    frameRef.current?.setPointerCapture?.(e.pointerId);
    live.current = pen
      ? { layer, tool: 'ink', width: PEN, color: now.current.layers[layer]!.color, points: [p], pointer: e.pointerId }
      : { layer, tool: 'wash', width: BRUSH, color: '', points: [p], pointer: e.pointerId };
    if (pen) inks.current[layer]!.pen([p], PEN);
    else inks.current[layer]!.wash([p], BRUSH);
    suppress.current = false;
    schedulePaint();
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const s = live.current;
    if (!s || (s.pointer !== null && e.pointerId !== s.pointer)) return;
    const p = at(e);
    const last = s.points[s.points.length - 1]!;
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) === 0) return;
    s.points.push(p);
    suppress.current = true;
    if (s.tool === 'wash') {
      inks.current[s.layer]?.wash([last, p], BRUSH);
      const [sx, sy] = screenAt(e);
      sud(sx, sy);
    } else {
      inks.current[s.layer]?.pen([last, p], PEN);
    }
    schedulePaint();
  };

  const onPointerEnd = (e: ReactPointerEvent) => {
    if (live.current && live.current.pointer !== null && e.pointerId !== live.current.pointer) return;
    finish();
  };

  /* ------------------------------------------------------------ the keyboard path ---- */

  const sweeping = useRef<{ raf: number; last: number; sweep: Sweep; row: number } | null>(null);
  const sweepFrom = useRef(0);
  const sweepStroke = useRef<Live | null>(null);
  const sweepRefreshed = useRef(0);

  const closeSweepStroke = useCallback(() => {
    const s = sweepStroke.current;
    sweepStroke.current = null;
    if (s) keep(s);
  }, [keep]);

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
    if (sweeping.current || !built || inks.current.length !== now.current.layers.length) return;
    const rows = bandsOf(now.current.size.height / REF_WIDTH);
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
          const s = ink?.inkSpan(rows[row]!, ROW / 2);
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
      if (layer < 0) layer = sameBand ? open.layer : lives.reduce((top, ink, i) => (ink?.inkNear(rows[step.sweep.row]!, ROW / 2) ? i : top), -1);
      if (open && (!sameBand || open.layer !== layer)) closeSweepStroke();
      if (layer >= 0) {
        const cur = sweepStroke.current;
        if (cur) {
          const last = cur.points[cur.points.length - 1]!;
          cur.points.push(p);
          inks.current[layer]!.wash([last, p], SWEEP_BRUSH);
        } else {
          sweepStroke.current = { layer, tool: 'wash', width: SWEEP_BRUSH, color: '', points: [p], pointer: null };
          inks.current[layer]!.wash([p], SWEEP_BRUSH);
        }
        sud(p[0] * geoNow.current.width + geoNow.current.offset, p[1] * geoNow.current.width);
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
  }, [built, checkClean, closeSweepStroke, liveInks, refresh, schedulePaint, stopSweep, sud]);

  /* The latest stop, called once on unmount: a sweep is not stopped each time a callback is made again. */
  const stopLatest = useRef(stopSweep);
  stopLatest.current = stopSweep;
  useEffect(() => () => stopLatest.current(), []);

  /* ------------------------------------------------------------------ rendering ---- */

  const anyLive = view ? view.clean.some((c) => !c) : true;
  const covers = view ? view.covered.some(Boolean) : true;
  /* Until the ink is built the post is treated as covered: nothing is read before the model says what is. */
  const hidden = anyLive && covers;
  const read = view && hidden ? view.lines.filter((_, i) => !view.covered[i]) : null;
  /* The hint is the board's sentence for everyone; the author's own tools and what they save follow the button. */
  const note = 'This post is splatted. Drag across the ink to scrub it on your screen.';
  /* The plate's readout: how many layers hold ink, and how much of them is washed on this screen, as the model says (geometry, never a pixel read). */
  const inked = view ? view.clean.flatMap((c, i) => (c ? [] : [view.washed[i] ?? 0])) : layers.map(() => 0);
  const share = inked.length === 0 ? 0 : Math.round((100 * inked.reduce((sum, w) => sum + w, 0)) / inked.length);
  const readout = (
    <>
      <span className="kb-plate-state">
        {inked.length === 0 ? 'Washed clean' : `${inked.length} ${inked.length === 1 ? 'layer' : 'layers'} · ${share}% washed`}
      </span>
      <span className="kb-whoops-meter" aria-hidden="true">
        {layers.map((l, i) => <span key={l.play.id} style={{ '--kb-washed': view ? (view.clean[i] ? 1 : Math.min(1, view.washed[i] ?? 0)) : 0 } as CSSProperties} />)}
      </span>
    </>
  );
  const stop = (e: { preventDefault(): void }) => e.preventDefault();

  return (
    <div
      className="kb-whoops" data-kb-whoops
      data-kb-layers={view ? view.clean.map((c) => (c ? 'clean' : 'live')).join(' ') : layers.map(() => 'live').join(' ')}
      data-kb-washed={view ? view.washed.map((w) => w.toFixed(3)).join(' ') : layers.map(() => '0').join(' ')}
      data-kb-fading={view?.fading ? 'true' : undefined}
      data-kb-place={place}
      data-kb-held={held}
      data-kb-splat={splats?.map((sp) => `${sp.placement.cx},${sp.placement.cy},${sp.placement.rx},${sp.placement.ry}`).join(' ')}
    >
      <div
        ref={frameRef} className="kb-whoops-frame"
        style={fixed ? { height: size.height * geo.scale, ...(bleed ? { overflow: 'visible' } : null) } : undefined}
        onPointerDown={anyLive ? onPointerDown : undefined} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
        onClickCapture={(e) => { if (suppress.current) { suppress.current = false; e.preventDefault(); e.stopPropagation(); } }}
      >
        <div
          ref={layoutRef} className="kb-whoops-layout" inert={hidden}
          style={fixed ? { width: REF_WIDTH, transform: `translateX(${geo.offset}px) scale(${geo.scale})`, ...(place === 'thread' ? { paddingInline: REF_WIDTH * BODY_GUTTER } : null) } : undefined}
        >
          {children}
        </div>
        {near && fixed && built && (
          <canvas ref={canvasRef} className="kb-whoops-ink" data-kb-effect-ink aria-hidden="true" style={{ top: band.top, height: band.height }} />
        )}
        <div ref={sudsRef} className="kb-whoops-suds" aria-hidden="true" />
      </div>
      {read && read.length > 0 && (
        <div className="kb-visually-hidden" data-kb-readout>
          {read.map((line, i) => <span key={i}>{line.text} </span>)}
        </div>
      )}
      {/* The words and the controls are glass in the plate under the post, never in the post's 2003 body (the owner's notes on #80), drawn as one game piece (the owner on #80's shots): a readout, then tiles. */}
      {(anyLive || report) && (
        <EffectStrip slot={slot} card="whoops" readout={readout}>
          {anyLive && <p className="kb-plate-line kb-whoops-hint">{note}</p>}
          {anyLive && (
            <button
              type="button" className="kb-plate-tile kb-whoops-scrub" data-kb-lit aria-describedby={help}
              onPointerDown={(e) => { stop(e); startSweep(); }} onPointerUp={stopSweep} onPointerLeave={stopSweep} onPointerCancel={stopSweep} onBlur={stopSweep}
              onContextMenu={stop}
              onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startSweep(); } else if (e.key === ' ' || e.key === 'Enter') e.preventDefault(); }}
              onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') stopSweep(); }}
            >
              <span className="kb-plate-tile-label">Hold to scrub</span>
            </button>
          )}
          {anyLive && <span id={help} className="kb-visually-hidden">Hold Space or Enter on this button to scrub the ink away line by line, at the pace of a hand. Let go to stop. It never clears the ink all at once.</span>}
          {anyLive && reader.author && (
            <span className="kb-whoops-tools" role="group" aria-label="Your tool">
              <span className="kb-whoops-tools-label">Yours to wash for everyone, or write back in its ink:</span>
              <button type="button" className="kb-plate-tile kb-whoops-tool" aria-pressed={tool === 'wash'} onClick={() => setTool('wash')}><span className="kb-plate-tile-label">Wash</span></button>
              <button type="button" className="kb-plate-tile kb-whoops-tool" aria-pressed={tool === 'ink'} onClick={() => setTool('ink')}><span className="kb-plate-tile-label">Write in ink</span></button>
            </span>
          )}
          {/* Said whether or not a layer is left: a clean mark that did not get through is the author's to know of, with no ink under it. */}
          {report && <p role="status" className="kb-plate-line kb-whoops-status">{report}</p>}
        </EffectStrip>
      )}
    </div>
  );
}
