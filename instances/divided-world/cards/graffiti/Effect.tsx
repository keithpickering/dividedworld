/**
 * Graffiti's wall on a post (docs/plans/2026-11-11-graffiti-design.md, sections 4, 5, 7 and 8; plan Task 9): the post's words with the wall's
 * spray paint over them, a reader's scrub on their own screen, the author's wash saved for everyone, the keyboard path ("Hold to scrub",
 * and for the author "Wash"), and the Draw tile that opens draw mode.
 *
 * The wall is one canvas over the post body's box (`data-kb-effect-ink`), drawn by `paintWall` from the surface's live Acts, and only while
 * the post is near the viewport: a page can hold many walls and a canvas is megabytes. The surface's strokes are asked for then
 * (`surface.near()`) and the canvas is dropped when the post leaves, as Whoops!'s is (whoops/Effect.tsx, whose box, input and measuring this
 * follows: the box is the body's padding box in the thread and the frame in the ORIGIN box, every position is a share of it).
 *
 * Scrubbing. A press starts a stroke only where this wall has ink and no card laid over it does: the wall claims its ink on the post's
 * registry (`EffectProps.ink`) and starts only where `topAt` is true, so a press on a splat's ink over the wall scrubs the splat, and one
 * beside it scrubs the wall. The touch rules are Whoops!'s (../wiping.ts). A reader's stroke is a wash Act drawn on this screen alone, kept
 * in this component's memory for the visit (a reload brings the paint back) and placed in the wall's order where it was made, so a tag drawn
 * after it shows. The painter cuts it exactly as it cuts a saved wash, so what the eye sees and what `hitAt` finds agree.
 *
 * The author's strokes are also collected and sent with `surface.wash` once 1.5 seconds pass without a stroke, or as the post is left (a wash
 * Act is one batch, within the card's bounds). A refusal is shown and not retried; an answer that never came is sent again, as Whoops!'s
 * saves are. "Hold to scrub" is the reader's keyboard path at Whoops!'s pace and stays on this screen for everyone; the author's "Wash" is the
 * same sweep, saved for everyone.
 *
 * Screen readers. A line of text under paint is hidden from them as from the eye (the body is `inert` while any line is covered) and the lines
 * clear of it are read from a hidden copy.
 *
 * Draw mode (Compose.tsx's `DrawMode`, the same drawing the card's `Compose` makes on a post with no wall yet). The tile sets `drawing` (published
 * as `data-kb-drawing` on the root); while it is set no press scrubs, `DrawMode` lays its lifted surface over the body (a press there is the
 * surface's: `data-kb-over-ink` keeps this wall and Whoops! from starting a stroke under it) and draws its toolbar under the post. The drawing
 * is handed back (`onDraft`) and painted into this wall's own canvas after the wall's Acts, which lies beneath any splat, so under a splat it shows
 * only where the splat is scrubbed; it is no ink of the wall's (`hitAt`, the covered lines) until it is tagged and arrives as an Act.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motionReduced } from '../../../../engine/ui/appearance.ts';
import { LOST_ANSWER, type Answer, type SurfaceAct } from '../../../../engine/ui/data/api.ts';
import { usePlayer } from '../../../../engine/ui/player.tsx';
import type { CardView, EffectProps, KitControl } from '../../../../engine/ui/cards/types.ts';
import { CANS, SPONGE, type Can } from '../graffiti.ts';
import { DrawMode } from './Compose.tsx';
import { lastCan } from './draft.ts';
import { cursor } from '../whoops/cursor.ts';
import { readLines } from '../whoops/lines.ts';
import { ROW_PX, SWEEP_BRUSH_ROWS, bandsOf, sweepStep, type Sweep, type TextLine } from '../whoops/scrub.ts';
import * as suds from '../whoops/suds.ts';
import { HOLD_MS, MAX_SAVE_RETRIES, RETRY_AFTER_MS, SUPPRESS_MS, overInk, swipeKind } from '../wiping.ts';
import { hitAt, paintWall, wallDensity, type Box, type WallAct } from './spray.ts';
import './graffiti.css';

export { MAX_SAVE_RETRIES, RETRY_AFTER_MS };
/** A burst of washes is sent once it has been quiet this long. */
export const WASH_AFTER_MS = 1500;
/** How often the covered lines are recomputed while a sweep runs. */
const REFRESH_MS = 150;
/** A wash holds at most this many strokes of at most this many points, 3,000 points in all (`graffiti.ts` `BOUNDS`, the server's check). */
const BATCH = { strokes: 120, points: 300, total: 3000 } as const;
/** Points closer than this to the one before are dropped, px. */
const MIN_STEP_PX = 5;
/** Where along a line, and how many places, the line is tested for paint; and the probes of a band, in rows of height from its middle. */
const LINE_SAMPLES = 24;
const SPAN_SAMPLES = 64;

const HOLD_HELP = 'Hold Space or Enter on this button to scrub the wall away line by line, at the pace of a hand, on your screen only. Let go to stop. It never clears the wall all at once.';
const WASH_HELP = 'Hold Space or Enter on this button to wash the wall line by line, at the pace of a hand, for everyone. Let go to stop. It never clears the wall all at once.';
const ENDS = 'Ends on your screen when you scrub it off. The author can wash it off for everyone, and anyone can tag it again.';

type Pt = readonly [number, number];
/** A scrub made on this screen: where in the wall's order it was made (the last Act then), and the stroke in shares of the box. */
interface Local { readonly after: string | null; readonly aspect: number; readonly points: Pt[] }
interface Gesture { readonly id: number; readonly x0: number; readonly y0: number; cx: number; cy: number; state: 'wait' | 'wipe' | 'page'; timer: ReturnType<typeof setTimeout> | null }
interface Live { readonly local: Local; readonly pointer: number | null; readonly touch?: true; readonly save: boolean }

const tenThousandth = (n: number) => Math.round(n * 10_000) / 10_000;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** The wall's Acts with this screen's scrubs placed after the Act each was made on; one whose Act has left the live list goes last. */
function merge(acts: readonly (WallAct & { readonly id?: string })[], locals: readonly Local[]): WallAct[] {
  if (locals.length === 0) return [...acts];
  const after = new Map<string | null, WallAct[]>();
  for (const l of locals) {
    const list = after.get(l.after) ?? [];
    list.push({ kind: 'wash', payload: { strokes: [{ aspect: l.aspect, points: l.points }] } });
    after.set(l.after, list);
  }
  const ids = new Set(acts.map((a) => a.id));
  const out: WallAct[] = [...(after.get(null) ?? [])];
  for (const a of acts) {
    out.push(a);
    out.push(...(after.get(a.id ?? null) ?? []));
  }
  for (const [k, v] of after) if (k !== null && !ids.has(k)) out.push(...v);
  return out;
}

/** A stroke as a wash keeps it: held to the box to a ten-thousandth, thinned of points that add nothing, cut into strokes of at most 300 points that each start on the point the last ended on. */
function fit(points: readonly Pt[], box: Box): { aspect: number; points: [number, number][] }[] {
  const kept: [number, number][] = [];
  for (const [x, y] of points) {
    const p: [number, number] = [tenThousandth(clamp(x)), tenThousandth(clamp(y))];
    const last = kept[kept.length - 1];
    if (last && Math.hypot((p[0] - last[0]) * box.w, (p[1] - last[1]) * box.h) < MIN_STEP_PX) continue;
    kept.push(p);
  }
  if (kept.length === 0) return [];
  const aspect = Number((box.w / box.h).toPrecision(3));
  const out: { aspect: number; points: [number, number][] }[] = [];
  for (let at = 0; ; at += BATCH.points - 1) {
    out.push({ aspect, points: kept.slice(at, at + BATCH.points) });
    if (at + BATCH.points >= kept.length) break;
  }
  return out;
}

export function Effect({ plays, reader, surface, ink: registry, place, show, met, still, children }: EffectProps) {
  const { session, hudCharacter } = usePlayer();
  const account = session.signedIn ? session.account : null;
  const canDraw = !still && surface !== undefined && account !== null && hudCharacter !== null;
  const acts = (surface?.acts ?? null) as readonly SurfaceAct[] | null;

  const [size, setSize] = useState<{ box: Box; left: number; top: number }>({ box: { w: 0, h: 0 }, left: 0, top: 0 });
  const [surfaceEl, setSurfaceEl] = useState<HTMLElement | null>(null);
  const [cellEl, setCellEl] = useState<HTMLElement | null>(null);
  /* Where the viewport cannot be watched the post counts as near; where it can, it is far until the observer says otherwise. */
  const [near, setNear] = useState(() => typeof IntersectionObserver !== 'function');
  const [scrubbed, setScrubbed] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [report, setReport] = useState('');
  const [covered, setCovered] = useState<readonly boolean[]>([]);
  const [lines, setLines] = useState<readonly TextLine[]>([]);
  const [can, setCan] = useState<Can>(() => lastCan(account));
  useEffect(() => { if (!drawing) setCan(lastCan(account)); }, [drawing, account]);

  /* Draw mode ends with the reader's right to draw (signed out, a moment): and where it ends for any reason the tile is focused again, so a keyboard is not dropped. */
  useEffect(() => { if (drawing && !canDraw) setDrawing(false); }, [drawing, canDraw]);
  const wasDrawing = useRef(false);
  useEffect(() => {
    if (wasDrawing.current && !drawing) tileRef.current?.focus({ preventScroll: true });
    wasDrawing.current = drawing;
  }, [drawing]);

  const bleed = place === 'thread';
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const tileRef = useRef<HTMLButtonElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sudsRef = useRef<HTMLCanvasElement>(null);
  const sudsHost = useRef({});
  const { box } = size;
  const fixed = box.w > 0 && box.h > 0;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

  const locals = useRef<Local[]>([]);
  const now = useRef({ acts, surface, plays, reader, size, near, surfaceEl, drawing, still, dpr });
  now.current = { acts, surface, plays, reader, size, near, surfaceEl, drawing, still, dpr };
  /** The wall as this screen draws and tests it: the live Acts and the scrubs made here. */
  const wall = useCallback((): WallAct[] => merge(now.current.acts ?? [], locals.current), []);

  const metNow = useRef(met);
  metNow.current = met;
  const met1 = useRef(false);
  const meet = () => { if (!met1.current) { met1.current = true; metNow.current(); } };
  const gone = useRef(false);
  const say = useCallback((words: string) => { if (!gone.current) setReport(words); }, []);

  /* ------------------------------------------------------------------ measuring ---- */

  const remeasure = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const f = frameRef.current;
    if (!f) return;
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
      now.current = { ...now.current, surfaceEl: surf, size: kept };
      setSurfaceEl((prev) => (prev === surf ? prev : surf));
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

  /* A takeover moves the words between the cell and a view with no size change: each render checks the cell is still the surface listened on. */
  useLayoutEffect(() => {
    const f = frameRef.current;
    if (!f || !remeasure.current) return;
    const cell = bleed ? f.closest<HTMLElement>('.kb-act-main') : null;
    if ((cell ?? f) !== now.current.surfaceEl) remeasure.current();
  });

  /* Only a post near the viewport is drawn: past a screen above or below, the canvas is dropped. */
  useEffect(() => {
    const f = frameRef.current;
    if (!f || typeof IntersectionObserver !== 'function') return;
    const watch = new IntersectionObserver((entries) => { setNear(entries.some((e) => e.isIntersecting)); remeasure.current?.(); }, { rootMargin: '100% 0px' });
    watch.observe(f);
    return () => watch.disconnect();
  }, []);

  /* The wall's strokes are read when the post comes near (and again by the engine whenever the wall changes after). */
  const hasSurface = surface !== undefined;
  useEffect(() => { if (near && hasSurface) now.current.surface?.near(); }, [near, hasSurface]);

  /* ----------------------------------------------------------------- the canvas ---- */

  /** The drawing being made in draw mode, not yet tagged: painted after the wall's Acts, in this same layer. */
  const draftAct = useRef<WallAct | null>(null);
  const paintQueued = useRef(0);
  const paintNow = useCallback(() => {
    paintQueued.current = 0;
    const canvas = canvasRef.current;
    const { size: sz, near: isNear, dpr: density } = now.current;
    if (!canvas || !isNear || sz.box.w <= 0 || sz.box.h <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paintWall(ctx, sz.box, density, draftAct.current ? [...wall(), draftAct.current] : wall());
  }, [wall]);
  const schedulePaint = useCallback(() => {
    if (paintQueued.current) return;
    paintQueued.current = requestAnimationFrame(paintNow);
  }, [paintNow]);
  useEffect(() => () => { if (paintQueued.current) cancelAnimationFrame(paintQueued.current); }, []);
  const onDraft = useCallback((act: WallAct | null) => { draftAct.current = act; schedulePaint(); }, [schedulePaint]);

  /* The canvases are the box's size at the density the wall is drawn at, and the wall is drawn again when its Acts, its box or its nearness change. */
  const q = fixed ? wallDensity(box, dpr) : 1;
  useLayoutEffect(() => {
    if (!fixed || !near) return;
    for (const canvas of [canvasRef.current, sudsRef.current]) {
      if (!canvas) continue;
      canvas.width = Math.ceil(box.w * q);
      canvas.height = Math.ceil(box.h * q);
    }
    paintNow();
  }, [near, fixed, box.w, box.h, q, acts, paintNow]);

  /* ------------------------------------------------------------------ the suds ---- */

  useEffect(() => {
    const canvas = sudsRef.current;
    if (!near || !fixed || !canvas) return;
    suds.register(sudsHost.current, canvas, box, q);
  }, [near, fixed, box, q]);
  useEffect(() => {
    if (!near || !fixed) return;
    const host = sudsHost.current;
    return () => suds.unregister(host);
  }, [near, fixed]);
  const throwSuds = (a: Pt, b: Pt) => {
    if (motionReduced()) return;
    const { box: bx } = now.current.size;
    suds.wash(sudsHost.current, { x: a[0] * bx.w, y: a[1] * bx.h }, { x: b[0] * bx.w, y: b[1] * bx.h }, true);
  };

  /* ------------------------------------------------------------ what is covered ---- */

  /** Whether any paint lies on the line `y` (a share) at some of its length: the line is then under paint, to the eye and to a screen reader. */
  const lineCovered = (l: TextLine, box: Box, w: readonly WallAct[]): boolean => {
    const y = ((l.top + l.bottom) / 2) * box.h;
    for (let i = 0; i < LINE_SAMPLES; i++) if (hitAt(w, box, ((i + 0.5) / LINE_SAMPLES) * box.w, y)) return true;
    return false;
  };
  const textLines = useRef<TextLine[]>([]);
  const refresh = useCallback(() => {
    const { size: sz, near: isNear } = now.current;
    if (!isNear || sz.box.w <= 0 || sz.box.h <= 0) return;
    const body = layoutRef.current;
    if (body && textLines.current.length === 0) {
      const read = readLines(body, sz.box);
      const off = sz.top / sz.box.h;
      textLines.current = read.length > 0 ? read.map((l) => ({ ...l, top: l.top + off, bottom: l.bottom + off })) : [{ top: 0, bottom: 1, text: body.textContent ?? '' }];
    }
    const w = wall();
    const next = textLines.current.map((l) => lineCovered(l, sz.box, w));
    setLines(textLines.current);
    setCovered((was) => (was.length === next.length && was.every((c, i) => c === next[i]) ? was : next));
  }, [wall]);
  /* A box or words that changed lay the lines out again. */
  useEffect(() => { textLines.current = []; }, [box.w, box.h, size.top, children]);
  useEffect(() => { refresh(); }, [refresh, acts, box.w, box.h, size.top, near, scrubbed, children]);

  /* ------------------------------------------------------------------- the wash ---- */

  const pending = useRef<{ aspect: number; points: [number, number][] }[]>([]);
  const sending = useRef(false);
  const failures = useRef(0);
  const washTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async (): Promise<void> => {
    if (washTimer.current) clearTimeout(washTimer.current);
    washTimer.current = null;
    const { surface: s, plays: ps } = now.current;
    const play = ps[0];
    if (sending.current || pending.current.length === 0 || !s || !play) return;
    /* One wash on its way at a time; what is made meanwhile goes after it answers. */
    const batch: typeof pending.current = [];
    let points = 0;
    while (pending.current.length > 0 && batch.length < BATCH.strokes && points + pending.current[0]!.points.length <= BATCH.total) {
      const next = pending.current.shift()!;
      points += next.points.length;
      batch.push(next);
    }
    sending.current = true;
    let answer: Answer<unknown>;
    try {
      answer = await s.wash(play.id, { strokes: batch });
    } catch {
      answer = { ok: false, error: LOST_ANSWER, uncertain: true };
    }
    sending.current = false;
    if (!answer.ok) {
      say(answer.error);
      /* A refusal is the card's answer and would be the same again. A wash that got no answer is sent again, a little later each time, and given up on after a few: the strokes stay, and the author's next one sends them. */
      if (answer.uncertain) {
        pending.current.unshift(...batch);
        failures.current += 1;
        if (failures.current <= MAX_SAVE_RETRIES && !gone.current) queueWash(RETRY_AFTER_MS * 2 ** (failures.current - 1));
      }
      return;
    }
    failures.current = 0;
    say('');
    if (pending.current.length > 0) queueWash(gone.current ? 0 : WASH_AFTER_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [say]);
  const queueWash = useCallback((after = WASH_AFTER_MS) => {
    if (washTimer.current) clearTimeout(washTimer.current);
    washTimer.current = setTimeout(() => { void flush(); }, after);
  }, [flush]);

  /** A finished stroke is kept as the scrub it is; the author's is also sent. */
  const keep = useCallback((s: Live) => {
    if (s.local.points.length === 0) return;
    if (s.save && now.current.reader.author) {
      pending.current.push(...fit(s.local.points, now.current.size.box));
      queueWash();
    }
  }, [queueWash]);

  /* ------------------------------------------------------------------ a stroke ---- */

  /** Where a point of the screen lies in the body's box, in shares of it. */
  const shareAt = (clientX: number, clientY: number): Pt => {
    const el = now.current.surfaceEl ?? frameRef.current!;
    const rect = el.getBoundingClientRect();
    const { box: b } = now.current.size;
    return [(clientX - rect.left - el.clientLeft) / b.w, (clientY - rect.top - el.clientTop) / b.h];
  };
  /** Whether the wall has ink at a point of the screen. */
  const hitAtClient = (clientX: number, clientY: number): boolean => {
    const el = now.current.surfaceEl ?? frameRef.current;
    const { box: b, } = now.current.size;
    if (!el || b.w <= 0 || b.h <= 0) return false;
    const rect = el.getBoundingClientRect();
    return hitAt(wall(), b, clientX - rect.left - el.clientLeft, clientY - rect.top - el.clientTop);
  };
  /* This wall's ink is claimed on the post's registry: a card laid over it that holds ink at a point takes a press there first. A moment claims nothing. */
  const hitNow = useRef(hitAtClient);
  hitNow.current = hitAtClient;
  useEffect(() => {
    if (still) return;
    return registry.claim((x, y) => hitNow.current(x, y));
  }, [registry, still]);

  const live = useRef<Live | null>(null);
  const finish = useCallback(() => {
    const s = live.current;
    live.current = null;
    if (!s) return;
    keep(s);
    refresh();
    schedulePaint();
  }, [keep, refresh, schedulePaint]);

  const suppress = useRef(false);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSuppress = () => {
    if (suppressTimer.current) clearTimeout(suppressTimer.current);
    suppressTimer.current = null;
    suppress.current = false;
  };
  const armSuppress = () => {
    clearSuppress();
    suppress.current = true;
    suppressTimer.current = setTimeout(clearSuppress, SUPPRESS_MS);
  };

  /** Whether a stroke may start at a point of the screen: this wall's ink is under it, the outermost there, and draw mode is not open. */
  const startsAt = (clientX: number, clientY: number): boolean => !now.current.drawing && !now.current.still && now.current.acts !== null && registry.topAt(clientX, clientY);

  /** Begins a scrub at a point of the screen. */
  const begin = (clientX: number, clientY: number, pointer: number, touch: boolean): boolean => {
    if (!startsAt(clientX, clientY)) return false;
    meet();
    const { size: { box: b }, acts: now_ } = now.current;
    const local: Local = { after: now_?.at(-1)?.id ?? null, aspect: b.w / b.h, points: [shareAt(clientX, clientY)] };
    locals.current.push(local);
    setScrubbed(locals.current.length);
    live.current = { local, pointer, save: true, ...(touch ? { touch: true as const } : null) };
    suppress.current = false;
    schedulePaint();
    return true;
  };

  const extend = (s: Live, clientX: number, clientY: number) => {
    const p = shareAt(clientX, clientY);
    const last = s.local.points[s.local.points.length - 1]!;
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) === 0) return;
    s.local.points.push(p);
    suppress.current = true;
    throwSuds(last, p);
    schedulePaint();
  };

  const shown = useRef<'sponge' | null>(null);
  const showCursor = (e: PointerEvent) => {
    const el = now.current.surfaceEl;
    if (!el) return;
    const over = !live.current && !overInk(e.target) && !now.current.drawing && hitAtClient(e.clientX, e.clientY);
    shown.current = live.current && !live.current.touch ? 'sponge' : over ? 'sponge' : null;
    cursor.over(el, e, shown.current);
  };

  const ensure = () => {
    const f = frameRef.current;
    if (!f) return;
    const cell = bleed ? f.closest<HTMLElement>('.kb-act-main') : null;
    if ((cell ?? f) !== now.current.surfaceEl) remeasure.current?.();
  };

  const onPointerDown = (e: PointerEvent) => {
    ensure();
    if (e.pointerType === 'touch' || !fixed || live.current || (e.pointerType === 'mouse' && e.button !== 0) || overInk(e.target)) return;
    /* No ink under the pointer: the page has it, for a link or a scroll. */
    if (!begin(e.clientX, e.clientY, e.pointerId, false)) return;
    e.preventDefault();
    (e.currentTarget as Element | null)?.setPointerCapture?.(e.pointerId);
    shown.current = 'sponge';
    cursor.press(true);
    if (now.current.surfaceEl) cursor.over(now.current.surfaceEl, e, 'sponge');
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    ensure();
    const s = live.current;
    if (s && !s.touch && (s.pointer === null || e.pointerId === s.pointer)) extend(s, e.clientX, e.clientY);
    showCursor(e);
  };
  const onPointerEnd = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    if (live.current && !live.current.touch && live.current.pointer !== null && e.pointerId !== live.current.pointer) return;
    const was = live.current;
    finish();
    if (was) {
      cursor.press(false);
      if (e.type === 'pointerup') showCursor(e);
      else if (now.current.surfaceEl) cursor.leave(now.current.surfaceEl);
    }
  };
  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || live.current) return;
    if (now.current.surfaceEl) cursor.leave(now.current.surfaceEl);
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
    if (!tc || !fixed || overInk(e.target)) return;
    suppress.current = false;
    if (!startsAt(tc.clientX, tc.clientY)) return;
    const g: Gesture = { id: tc.identifier, x0: tc.clientX, y0: tc.clientY, cx: tc.clientX, cy: tc.clientY, state: 'wait', timer: null };
    gesture.current = g;
    g.timer = setTimeout(() => {
      if (gesture.current !== g || g.state !== 'wait') return;
      /* Held: the wall is grabbed, with a puff of suds and a short buzz where the device allows it. */
      g.state = 'wipe';
      begin(g.x0, g.y0, g.id, true);
      const [hx, hy] = shareAt(g.cx, g.cy);
      const { box: b } = now.current.size;
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
      /* A swipe mostly up or down is the page's scroll, and scrubs nothing; a sideways one wipes. */
      if (kind === 'page') { g.state = 'page'; return; }
      g.state = 'wipe';
      begin(g.x0, g.y0, g.id, true);
    }
    /* Wiping: the page's scroll is refused for the rest of the touch. */
    if (e.cancelable) e.preventDefault();
    const s = live.current;
    if (s?.touch) extend(s, tc.clientX, tc.clientY);
  };
  const onTouchEnd = (e: TouchEvent) => {
    const g = gesture.current;
    if (!g || !Array.from(e.changedTouches).some((c) => c.identifier === g.id)) return;
    settle(g);
    /* A tap on the paint scrubs one dab, as a click does. */
    if (e.type === 'touchend' && g.state === 'wait') begin(g.x0, g.y0, g.id, true);
    if (e.type === 'touchcancel') clearSuppress();
    else if (g.state === 'wipe' || g.state === 'wait') armSuppress();
    gesture.current = null;
    if (live.current?.touch) finish();
  };

  /*
   * The input: the frame always, and in the thread the cell too, as Whoops!'s (whoops/Effect.tsx has the reasoning): native listeners, each
   * calling the latest handler, the cell's taking nothing whose target is inside the frame (the frame's own handler takes that).
   */
  const finishNow = useRef(finish);
  finishNow.current = finish;
  const handlers = useRef({ onPointerDown, onPointerMove, onPointerEnd, onPointerLeave, onTouchStart, onTouchMove, onTouchEnd });
  handlers.current = { onPointerDown, onPointerMove, onPointerEnd, onPointerLeave, onTouchStart, onTouchMove, onTouchEnd };
  useEffect(() => {
    const f = frameRef.current;
    if (!f || still) return;
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
      const leave = (e: PointerEvent) => { if (mine(el, e)) handlers.current.onPointerLeave(e); };
      const tstart = (e: TouchEvent) => { if (mine(el, e)) handlers.current.onTouchStart(e); };
      const tmove = (e: TouchEvent) => { if (mine(el, e)) handlers.current.onTouchMove(e); };
      const tend = (e: TouchEvent) => { if (mine(el, e)) handlers.current.onTouchEnd(e); };
      const click = (e: MouseEvent) => { if (mine(el, e) && suppress.current) { clearSuppress(); e.preventDefault(); e.stopPropagation(); } };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
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
    return () => {
      for (const off of offs) off();
      if (gesture.current) { settle(gesture.current); gesture.current = null; }
      /* A stroke under way when the listeners go is the author's work: it is kept and sent as at any end. */
      finishNow.current();
      clearSuppress();
    };
  }, [cellEl, still]);

  /* ------------------------------------------------------------ the keyboard path ---- */

  const sweeping = useRef<{ raf: number; last: number; sweep: Sweep } | null>(null);
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
    refresh();
    schedulePaint();
  }, [closeSweepStroke, refresh, schedulePaint]);

  /** Sweeps the wall line by line at the pace of a hand: on this screen alone, or (the author's Wash) saved for everyone too. */
  const startSweep = useCallback((save: boolean) => {
    const { size: sz } = now.current;
    if (now.current.still || sweeping.current || sz.box.w <= 0 || sz.box.h <= 0 || now.current.acts === null) return;
    const b = sz.box;
    const rows = bandsOf(b);
    const half = ROW_PX / 2 / b.h;
    const run = { raf: 0, last: performance.now(), sweep: { row: Math.min(sweepFrom.current, rows.length - 1), x: 0 } as Sweep };
    sweeping.current = run;
    const tick = (t: number) => {
      const dt = Math.min(0.05, Math.max(0, (t - run.last) / 1000));
      run.last = t;
      const w = wall();
      /* A band's ink: where the wall still has paint on it, so the sweep waits out no empty line. */
      const span = (row: number): readonly [number, number] | null => {
        let lo = Infinity, hi = -Infinity;
        for (const dy of [-half * SWEEP_BRUSH_ROWS / 1.15, 0, half * SWEEP_BRUSH_ROWS / 1.15]) {
          const y = (rows[row]! + dy) * b.h;
          for (let i = 0; i <= SPAN_SAMPLES; i++) if (hitAt(w, b, (i / SPAN_SAMPLES) * b.w, y)) { lo = Math.min(lo, i / SPAN_SAMPLES); hi = Math.max(hi, i / SPAN_SAMPLES); }
        }
        return lo <= hi ? [lo, hi] : null;
      };
      const step = sweepStep(rows, run.sweep, dt, span);
      if (step.idle) {
        stopSweep();
        return;
      }
      const p = step.point;
      const open = sweepStroke.current;
      const sameBand = open !== null && step.sweep.row === run.sweep.row;
      if (open && !sameBand) closeSweepStroke();
      meet();
      const cur = sweepStroke.current;
      if (cur) {
        const last = cur.local.points[cur.local.points.length - 1]!;
        cur.local.points.push(p);
        throwSuds(last, p);
      } else {
        const local: Local = { after: now.current.acts?.at(-1)?.id ?? null, aspect: b.w / b.h, points: [p] };
        locals.current.push(local);
        setScrubbed(locals.current.length);
        sweepStroke.current = { local, pointer: null, save };
        throwSuds(p, p);
      }
      run.sweep = step.sweep;
      if (t - sweepRefreshed.current > REFRESH_MS) {
        sweepRefreshed.current = t;
        refresh();
      }
      schedulePaint();
      run.raf = requestAnimationFrame(tick);
    };
    run.raf = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeSweepStroke, refresh, schedulePaint, stopSweep, wall]);
  const startScrub = useCallback(() => startSweep(false), [startSweep]);
  const startWash = useCallback(() => startSweep(true), [startSweep]);

  const stopLatest = useRef(stopSweep);
  stopLatest.current = stopSweep;
  /* Declared after the input's effect: as the post leaves, its listeners finish a stroke under way first, then a sweep stops, then what was made is sent. */
  useEffect(() => {
    gone.current = false;
    return () => {
      stopLatest.current();
      gone.current = true;
      if (pending.current.length > 0) void flush();
      if (washTimer.current) clearTimeout(washTimer.current);
    };
  }, [flush]);

  /* ------------------------------------------------------------------ the view ---- */

  const author = reader.author;
  const share = surface ? Math.floor(surface.covered / 100) : 0;
  const state = surface ? `${share}% of the wall` : 'A wall';
  const progress = surface && surface.most > 0 ? Math.min(1, surface.covered / surface.most) : null;
  const controls = useMemo<readonly KitControl[]>(() => {
    if (still || !surface) return [];
    const hold: KitControl = { kind: 'hold', label: 'Hold to scrub', describe: HOLD_HELP, start: startScrub, stop: stopSweep };
    return author ? [hold, { kind: 'hold', label: 'Wash', describe: WASH_HELP, start: startWash, stop: stopSweep }] : [hold];
  }, [still, hasSurface, author, startScrub, startWash, stopSweep]);
  const cardView: CardView = { progress, state, ...(!still ? { ends: ENDS } : null), yours: author && !still, controls, notes: {}, ...(report ? { report } : null) };
  const viewKey = JSON.stringify([progress, state, author, report, still]);
  const viewNow = useRef(cardView);
  viewNow.current = cardView;
  useEffect(() => { show(viewNow.current); }, [viewKey, controls, show]);

  const hidden = !still && covered.some(Boolean);
  const read = hidden ? lines.filter((_, i) => !covered[i]) : null;

  const onBox = { left: -size.left, top: -size.top, width: box.w, height: box.h };
  /* The Draw tile sits at the body's top right, lifted over the ink. */
  const tile = { left: -size.left + box.w, top: -size.top };
  return (
    <div ref={rootRef} className="kb-graffiti" data-kb-graffiti data-kb-place={place} data-kb-scrubbed={scrubbed} data-kb-drawing={drawing ? 'true' : undefined}>
      <div ref={frameRef} className="kb-graffiti-frame" style={bleed ? { overflow: 'visible' } : undefined}>
        <div ref={layoutRef} data-kb-graffiti-layout="" inert={hidden}>
          {children}
        </div>
        {near && fixed && (
          <>
            <canvas ref={canvasRef} className="kb-graffiti-ink" data-kb-effect-ink aria-hidden="true" style={onBox} />
            <canvas ref={sudsRef} className="kb-graffiti-suds" data-kb-effect-ink aria-hidden="true" style={onBox} />
          </>
        )}
        {canDraw && fixed && !drawing && (
          <button ref={tileRef} type="button" className="kb-graffiti-draw" data-kb-over-ink data-kb-can={can} style={tile} onClick={() => setDrawing(true)}>
            <svg className="kb-graffiti-can" viewBox="0 0 20 28" aria-hidden="true" focusable="false">
              <rect x="5" y="9" width="10" height="17" rx="2" fill={CANS[can]} stroke="currentColor" strokeWidth="1.4" />
              <rect x="7" y="4" width="6" height="5" rx="1" fill="currentColor" />
              <rect x="13" y="2" width="4" height="3" rx="1" fill="currentColor" />
              <circle cx="3" cy="3" r="0.9" fill={CANS[can]} />
              <circle cx="1.5" cy="6" r="0.7" fill={CANS[can]} />
            </svg>
            <span>Draw</span>
          </button>
        )}
        {drawing && canDraw && fixed && surface && plays[0] && hudCharacter && (
          <DrawMode
            mode="cast" box={box} wall={acts} covered={surface.covered} most={surface.most} asks
            dockHost={frameRef.current?.closest<HTMLElement>('.kb-act') ?? rootRef.current}
            submit={(input) => surface.draw(plays[0]!.id, hudCharacter.id, input)} cancel={() => setDrawing(false)} done={() => setDrawing(false)}
            onDraft={onDraft} overlayStyle={onBox}
          />
        )}
      </div>
      {read && read.length > 0 && (
        <div className="kb-visually-hidden" data-kb-readout>
          {read.map((line, i) => <span key={i}>{line.text} </span>)}
        </div>
      )}
      <p className="kb-visually-hidden" role="status" data-kb-report>{report}</p>
    </div>
  );
}
