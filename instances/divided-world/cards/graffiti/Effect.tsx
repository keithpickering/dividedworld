/**
 * Graffiti's wall on a post (docs/plans/2026-11-11-graffiti-design.md, sections 4, 5, 7 and 8; plan Task 9): the post's words with the wall's
 * spray paint over them, a reader's scrub on their own screen, the author's wash saved for everyone, the keyboard path ("Hold to scrub",
 * and for the author "Wash"), and the Draw tile that opens draw mode.
 *
 * The wall is one canvas over the post body's box (`data-kb-effect-ink`), drawn by `paintWall` from the surface's live Acts, and only while
 * the post is near the viewport: a page can hold many walls and a canvas is megabytes. The surface's strokes are asked for then
 * (`surface.near()`) and the canvas is dropped when the post leaves, as Whoops!'s is (whoops/Effect.tsx, whose box, input and measuring this
 * follows: the box is the body's padding box, the nearest content area the engine marks (the post's body in the thread, the ORIGIN box's area), or the frame
 * where there is none, and every position is a share of it).
 *
 * Scrubbing. A press starts a stroke only where this wall has ink and no card laid over it does: the wall claims its ink on the post's
 * registry (`EffectProps.ink`) and starts only where `topAt` is true, so a press on a splat's ink over the wall scrubs the splat, and one
 * beside it scrubs the wall. The touch rules are Whoops!'s (../wiping.ts). A reader's stroke is a wash Act drawn on this screen alone, kept
 * in this component's memory for the visit (a reload brings the paint back) and placed in the wall's order where it was made, so a tag drawn
 * after it shows. The painter cuts it exactly as it cuts a saved wash, so what the eye sees and what `hitAt` finds agree.
 *
 * The sponge goes to the top group of the wall with paint under it (spray.ts), a press every third of its radius, each thinning only that group; a
 * reader's presses are replayed on this screen after the wall's saved washes (`chunks`), and a rebuilt wall (a new draw, a resize) replays them again.
 * Where a draw's groups are is this screen's own: a `TextLayer` of marks lies at each text attachment, the marks and `[data-kb-img]` images are measured after
 * layout (and again on a resize, an image's load and a change of text size), and `placeGroups` puts each group there (spray.ts).
 *
 * The author's presses are also collected, by draw and group in the group's own units, and sent with `surface.wash` as `{ cuts }` once 1.5 seconds pass without a stroke, or as the post is left (a wash
 * Act is one batch, within the card's bounds). A refusal is shown and not retried; an answer that never came is sent again, as Whoops!'s
 * saves are, even after the post is left (the retries outlive the effect, for at most about two minutes). "Hold to scrub" is the reader's keyboard path at Whoops!'s pace and stays on this screen for everyone; the author's "Wash" is the
 * same sweep, saved for everyone.
 *
 * The words under the paint. The body is never made `inert` and no copy of it is read out: the wall's canvas takes no pointer, so links, buttons and text
 * under it stay reachable by keyboard, pointer and screen reader (the owner's ruling). A press on an interactive element goes to it and starts no scrub.
 *
 * Draw mode (Compose.tsx's `DrawMode`, the same drawing the card's `Compose` makes on a post with no wall yet). The tile sets `drawing` (published
 * as `data-kb-drawing` on the root); while it is set no press scrubs, `DrawMode` lays its lifted surface over the body (a press there is the
 * surface's: `data-kb-over-ink` keeps this wall and Whoops! from starting a stroke under it) and draws its toolbar under the post. The drawing
 * is handed back (`onDraft`) and painted into this wall's own canvas after the wall's Acts, which lies beneath any splat, so under a splat it shows
 * only where the splat is scrubbed; it is no ink of the wall's (`hitAt`) until it is tagged and arrives as an Act.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motionReduced } from '../../../../engine/ui/appearance.ts';
import { TextLayer, type TextRun } from '../../../../engine/ui/bbcode/layers.tsx';
import { bodyBox, bodyOf, wordsBoxOf } from '../../../../engine/ui/cards/body.ts';
import type { Measured } from '../../../../engine/ui/cards/place.ts';
import { bringClear } from '../../../../engine/ui/cards/clear.ts';
import { LOST_ANSWER, type Answer, type SurfaceAct } from '../../../../engine/ui/data/api.ts';
import { usePlayer } from '../../../../engine/ui/player.tsx';
import type { CardView, EffectProps, KitControl } from '../../../../engine/ui/cards/types.ts';
import { BOUNDS, CANS, type Can } from '../graffiti.ts';
import { DrawMode, Marked } from './Compose.tsx';
import { dockHostOf } from './Toolbar.tsx';
import { lastCan } from './draft.ts';
import { cursor } from '../whoops/cursor.ts';
import { SWEEP_PX_S, bandsOf, sweepStep, type Sweep } from '../whoops/scrub.ts';
import * as suds from '../whoops/suds.ts';
import { HOLD_MS, MAX_SAVE_RETRIES, RETRY_AFTER_MS, SUPPRESS_MS, overInk, swipeKind } from '../wiping.ts';
import { DEFAULT_EM_PX, Wall, groupsOf, hitAt, markKey, paintWall, wallDensity, type Box, type Chunk, type Walker, type WallAct } from './spray.ts';
import './graffiti.css';

export { MAX_SAVE_RETRIES, RETRY_AFTER_MS };
/** A burst of washes is sent once it has been quiet this long. */
export const WASH_AFTER_MS = 1500;
/** A wash holds at most this many presses in all (`graffiti.ts` `BOUNDS`, the server's check). */
const BATCH_PRESSES = BOUNDS.presses;
/** The mark a text group's place is found by after layout. */
const MARK = 'data-kb-graffiti-mark';
const EMPTY: readonly SurfaceAct[] = [];
const NONE: ReadonlySet<string> = new Set();

const HOLD_HELP = 'Hold Space or Enter on this button to scrub the wall away line by line, at the pace of a hand, on your screen only. Let go to stop. It never clears the wall all at once.';
const WASH_HELP = 'Hold Space or Enter on this button to wash the wall line by line, at the pace of a hand, for everyone. Let go to stop. It never clears the wall all at once.';
const ENDS = 'Ends on your screen when you scrub it off. The author can wash it off for everyone, and anyone can tag it again.';

type Pt = readonly [number, number];
/**
 * What this screen's sponge took from one group: in the group's units, as the wash keeps them. It stays while the wall is rebuilt, and is sent (the author's) once closed.
 * `sent` says the wash that holds it was saved (its Act's id, or true where the answer had none): it is dropped once the wall's Acts hold that wash. Where the answer had no id, `sentWashIds` is the ids of the wash Acts the wall held when it was sent, and the chunk stays until a wash Act that is not among them arrives (one newer than the press, even where an older one has since left).
 */
interface MChunk { draw: string; group: number; presses: [number, number][]; save: boolean; open: boolean; sent?: string | true; sentWashIds?: ReadonlySet<string> }
interface Gesture { readonly id: number; readonly x0: number; readonly y0: number; cx: number; cy: number; state: 'wait' | 'wipe' | 'page'; timer: ReturnType<typeof setTimeout> | null }
/** A stroke of the sponge under way, in the chunks it has filled. */
interface Live { readonly walker: Walker; readonly chunks: Map<string, MChunk>; readonly pointer: number | null; readonly touch?: true; readonly save: boolean }
const newLive = (pointer: number | null, save: boolean, touch = false): Live => ({ walker: { last: null, left: 0 }, chunks: new Map(), pointer, save, ...(touch ? { touch: true as const } : null) });

/** What takes a press for itself: a link, a button, a field or anything made to be pressed. A press there goes to it and starts no scrub. */
const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [role="switch"], [role="tab"]';
const interactive = (target: unknown): boolean => {
  const el = target as { readonly closest?: (selector: string) => unknown } | null;
  return typeof el?.closest === 'function' && el.closest(INTERACTIVE) !== null;
};

export function Effect({ post, plays, reader, surface, ink: registry, place, show, met, still, children }: EffectProps) {
  const { session, hudCharacter } = usePlayer();
  const account = session.signedIn ? session.account : null;
  /*
   * Every use of `still` in this file is the old still moment's, and is unreachable until issue #774: a moment draws neither this card nor any with a surface
   * (`playsInMoment`, engine/ui/cards/Effects.tsx), since it holds no read of a wall's acts. Plan 2 of docs/plans/2026-11-16-playable-moments-design.md replaces it.
   */
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
  const [can, setCan] = useState<Can>(() => lastCan(account));
  useEffect(() => { if (!drawing) setCan(lastCan(account)); }, [drawing, account]);

  /* Where draw mode ends for any reason the tile is focused again, so a keyboard is not dropped. */
  const wasDrawing = useRef(false);
  useEffect(() => {
    if (wasDrawing.current && !drawing) tileRef.current?.focus({ preventScroll: true });
    wasDrawing.current = drawing;
  }, [drawing]);

  /* Draw mode mounts the toolbar's dock over the window's foot, which can cover the post being drawn on, as a compose opened on a post does (the engine's play.tsx):
     the post's body is brought clear once the dock is mounted and has set the root's scroll padding (its layout effect, then a frame for its measured height).
     Keyed on `drawing` opening alone, so no render and no close scrolls. */
  useEffect(() => {
    if (!drawing) return undefined;
    const frame = requestAnimationFrame(() => {
      const f = frameRef.current;
      const body = f ? bodyOf(f) ?? f : null;
      if (body) bringClear(body);
    });
    return () => cancelAnimationFrame(frame);
  }, [drawing]);
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  /** The content area the frame is in now, the wall's box (found afresh, as a takeover moves the frame). */
  const bodyNow = () => (frameRef.current ? bodyOf(frameRef.current) : null);
  const tileRef = useRef<HTMLButtonElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sudsRef = useRef<HTMLCanvasElement>(null);
  const sudsHost = useRef({});
  const { box } = size;
  const fixed = box.w > 0 && box.h > 0;
  /* Draw mode closes whenever it cannot be drawn (the play or the surface gone, the box measuring nothing), so the tile is back and nobody is stuck. */
  const drawable = canDraw && fixed && plays[0] !== undefined;
  useEffect(() => { if (drawing && !drawable) setDrawing(false); }, [drawing, drawable]);
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

  const chunks = useRef<MChunk[]>([]);
  const strokes = useRef(0);
  const now = useRef({ acts, surface, plays, reader, size, near, surfaceEl, drawing, still, dpr });
  now.current = { acts, surface, plays, reader, size, near, surfaceEl, drawing, still, dpr };
  /** Where each text and image group's attachment is on this screen, in px of the box, and the text size: what placement runs against. */
  const measuredRef = useRef<ReadonlyMap<string, Measured>>(new Map());
  const emRef = useRef(DEFAULT_EM_PX);
  const [layoutRev, setLayoutRev] = useState(0);
  const revRef = useRef(0);
  const chunkRev = useRef(0);
  /** The wall as this screen holds it, built again when its Acts, its box, the text size, where its groups are attached or the saved presses change, and not as presses are made. */
  const built = useRef<{ acts: readonly SurfaceAct[]; w: number; h: number; em: number; rev: number; chunkRev: number; wall: Wall } | null>(null);
  const wall = useCallback((): Wall => {
    const { acts: live, size: { box: b } } = now.current;
    const a = live ?? EMPTY;
    const had = built.current;
    if (had && had.acts === a && had.w === b.w && had.h === b.h && had.em === emRef.current && had.rev === revRef.current && had.chunkRev === chunkRev.current) return had.wall;
    /* A scrub this visit sent is dropped once the wall's Acts hold the wash that saved it, which replays the same presses. */
    const ids = new Set(a.flatMap((x) => (x.id === undefined ? [] : [x.id])));
    const newer = (c: MChunk) => a.some((x) => x.kind === 'wash' && x.id !== undefined && !(c.sentWashIds ?? NONE).has(x.id));
    const kept = chunks.current.filter((c) => !(c.sent !== undefined && (typeof c.sent === 'string' ? ids.has(c.sent) : newer(c))));
    if (kept.length !== chunks.current.length) { chunks.current = kept; chunkRev.current += 1; }
    const next = Wall.of(a, { box: b, emPx: emRef.current, measured: (g) => measuredRef.current.get(markKey(g)) ?? null }, chunks.current as readonly Chunk[], had?.wall ?? null);
    built.current = { acts: a, w: b.w, h: b.h, em: emRef.current, rev: revRef.current, chunkRev: chunkRev.current, wall: next };
    return next;
  }, []);

  const metNow = useRef(met);
  metNow.current = met;
  const met1 = useRef(false);
  const meet = () => { if (!met1.current) { met1.current = true; metNow.current(); } };
  const gone = useRef(false);
  const say = useCallback((words: string) => { if (!gone.current) setReport(words); }, []);

  /* ------------------------------------------------------------------ measuring ---- */

  const remeasure = useRef<(() => void) | null>(null);
  const remeasureSoon = useRef<(() => void) | null>(null);
  const signature = useRef('');
  useLayoutEffect(() => {
    const f = frameRef.current;
    if (!f) return;
    let watched: HTMLElement | null = null;
    let watch: ResizeObserver | null = null;
    const loaded = new WeakSet<Element>();
    let sizes: MutationObserver | null = null;
    let queued = 0;
    const measure = () => {
      if (queued) { cancelAnimationFrame(queued); queued = 0; }
      const cell = bodyOf(f);
      if (watch && cell !== watched) {
        if (watched) watch.unobserve(watched);
        if (cell) watch.observe(cell);
        watched = cell;
      }
      if (cell) setCellEl((prev) => (prev === cell ? prev : cell));
      const surf = cell ?? f;
      let next: { box: Box; left: number; top: number };
      if (cell) {
        const b = bodyBox(f, cell);
        next = { box: { w: b.w, h: b.h }, left: -b.left, top: -b.top };
      } else {
        next = { box: { w: f.clientWidth, h: f.clientHeight }, left: 0, top: 0 };
      }
      const was = now.current.size;
      const kept = was.box.w === next.box.w && was.box.h === next.box.h && was.left === next.left && was.top === next.top ? was : next;
      now.current = { ...now.current, surfaceEl: surf, size: kept };
      /* Where the groups' marks and images are, and the size of the text, on this screen now. */
      const words = cell ? wordsBoxOf(cell) ?? cell : f;
      const fontPx = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(words).fontSize) : Number.NaN;
      const em = Number.isFinite(fontPx) && fontPx > 0 ? fontPx : DEFAULT_EM_PX;
      const found = new Map<string, Measured>();
      const origin = surf.getBoundingClientRect();
      const [ox, oy] = [origin.left + surf.clientLeft, origin.top + surf.clientTop];
      for (const g of groupsOf((now.current.acts ?? []) as readonly WallAct[])) {
        if (g.anchor.kind === 'text') {
          const el = f.querySelector(`[${MARK}="${markKey(g)}"]`);
          if (el) { const r = el.getBoundingClientRect(); found.set(markKey(g), { kind: 'point', x: r.left - ox, y: r.top - oy }); }
        } else if (g.anchor.kind === 'image') {
          const el = f.querySelector(`[data-kb-img="${g.anchor.n}"]`);
          if (el) { const r = el.getBoundingClientRect(); found.set(markKey(g), { kind: 'rect', x: r.left - ox, y: r.top - oy, w: r.width, h: r.height }); }
        }
      }
      for (const img of f.querySelectorAll('[data-kb-img]')) if (!loaded.has(img)) { loaded.add(img); img.addEventListener('load', soon); }
      const sig = JSON.stringify([[...found], em]);
      if (sig !== signature.current) {
        signature.current = sig;
        measuredRef.current = found; emRef.current = em; revRef.current += 1;
        setLayoutRev(revRef.current);
      }
      setSurfaceEl((prev) => (prev === surf ? prev : surf));
      setSize((prev) => (prev.box.w === kept.box.w && prev.box.h === kept.box.h && prev.left === kept.left && prev.top === kept.top ? prev : kept));
    };
    /* What an observer reports is measured once in the frame, however often it reports. */
    const soon = () => {
      if (typeof requestAnimationFrame !== 'function') { measure(); return; }
      if (!queued) queued = requestAnimationFrame(() => { queued = 0; measure(); });
    };
    if (typeof ResizeObserver === 'function') {
      watch = new ResizeObserver(soon);
      watch.observe(f);
    }
    if (typeof MutationObserver === 'function') {
      sizes = new MutationObserver(soon);
      sizes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-kb-text-size'] });
    }
    measure();
    remeasure.current = measure;
    remeasureSoon.current = soon;
    return () => {
      remeasure.current = null; remeasureSoon.current = null;
      if (queued) cancelAnimationFrame(queued);
      watch?.disconnect(); sizes?.disconnect();
      for (const img of f.querySelectorAll('[data-kb-img]')) img.removeEventListener('load', soon);
    };
  }, []);

  /* A takeover moves the words between the cell and a view with no size change: each render checks the cell is still the surface listened on. */
  useLayoutEffect(() => {
    const f = frameRef.current;
    if (!f || !remeasure.current) return;
    const cell = bodyOf(f);
    if ((cell ?? f) !== now.current.surfaceEl) remeasure.current();
  });

  /* The marks come and go with the wall's Acts, and a text group's mark is a run of the post's words: measured again whenever they do. */
  const runs = useMemo<TextRun[]>(() => groupsOf((acts ?? []) as readonly WallAct[]).flatMap((g): TextRun[] => {
    const a = g.anchor;
    if (a.kind !== 'text') return [];
    const key = markKey(g);
    return [{ start: a.at, end: a.at, key: `kbgm${key}`, z: 0, mode: 'mark', render: ({ key: k }) => <span key={k} {...{ [MARK]: key }} aria-hidden="true" /> }];
  }), [acts]);
  useLayoutEffect(() => { remeasure.current?.(); }, [acts, drawing]);

  /* Only a post near the viewport is drawn: past a screen above or below, the canvas is dropped. */
  useEffect(() => {
    const f = frameRef.current;
    if (!f || typeof IntersectionObserver !== 'function') return;
    const watch = new IntersectionObserver((entries) => { setNear(entries.some((e) => e.isIntersecting)); remeasureSoon.current?.(); }, { rootMargin: '100% 0px' });
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
    paintWall(ctx, sz.box, density, wall(), draftAct.current);
  }, [wall]);
  const schedulePaint = useCallback(() => {
    if (paintQueued.current) return;
    paintQueued.current = requestAnimationFrame(paintNow);
  }, [paintNow]);
  useEffect(() => () => { if (paintQueued.current) cancelAnimationFrame(paintQueued.current); }, []);
  /** A tagged drawing stays painted from Tag it until the wall's Acts hold the new draw (by id) or change some other way, so the wall does not flicker through the round trip. */
  /* A landed tag's draft, painted until the wall's own read carries the new draw (or the read changes otherwise); a missed broadcast leaves it painted,
     which is still the tag as it landed, until the next read. */
  const holding = useRef<{ readonly id: string | undefined; readonly acts: readonly SurfaceAct[] | null } | null>(null);
  const onDraft = useCallback((act: WallAct | null) => {
    if (act === null && holding.current) return;
    if (act !== null) holding.current = null;
    draftAct.current = act;
    schedulePaint();
  }, [schedulePaint]);
  const settleHold = useCallback(() => {
    const h = holding.current;
    if (!h) return;
    const a = now.current.acts;
    if (a === h.acts && !(h.id !== undefined && a?.some((x) => x.id === h.id))) return;
    holding.current = null;
    draftAct.current = null;
    paintNow();
  }, [paintNow]);
  useLayoutEffect(() => { settleHold(); }, [acts, settleHold]);

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
  }, [near, fixed, box.w, box.h, q, acts, layoutRev, paintNow]);

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

  /* ------------------------------------------------------------------- the wash ---- */

  const sending = useRef(false);
  const failures = useRef(0);
  const washTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The author's presses still to send: closed, kept for everyone, and not yet saved. */
  const toSend = () => chunks.current.filter((c) => c.save && !c.open && c.sent === undefined && c.presses.length > 0);

  const flush = useCallback(async (): Promise<void> => {
    if (washTimer.current) clearTimeout(washTimer.current);
    washTimer.current = null;
    const { surface: s, plays: ps } = now.current;
    const play = ps[0];
    if (sending.current || !s || !play) return;
    /* One wash on its way at a time; what is made meanwhile goes after it answers. A chunk too long for one wash is cut where the wash ends. */
    const batch: MChunk[] = [];
    let total = 0;
    for (const c of toSend()) {
      const room = BATCH_PRESSES - total;
      if (room <= 0) break;
      if (c.presses.length <= room) { batch.push(c); total += c.presses.length; continue; }
      const head: MChunk = { ...c, presses: c.presses.slice(0, room) };
      c.presses = c.presses.slice(room);
      chunks.current.splice(chunks.current.indexOf(c), 0, head);
      batch.push(head);
      break;
    }
    if (batch.length === 0) return;
    sending.current = true;
    let answer: Answer<unknown>;
    try {
      const cuts = new Map<string, { draw: string; group: number; presses: [number, number][] }>();
      for (const c of batch) { const k = `${c.draw}/${c.group}`, cut = cuts.get(k) ?? { draw: c.draw, group: c.group, presses: [] }; cut.presses.push(...c.presses); cuts.set(k, cut); }
      answer = await s.wash(play.id, { cuts: [...cuts.values()] });
    } catch {
      answer = { ok: false, error: LOST_ANSWER, uncertain: true };
    }
    sending.current = false;
    if (!answer.ok) {
      say(answer.error);
      /* A refusal is the card's answer and would be the same again. A wash that got no answer is sent again, a little later each time, and given up on after a few: the presses stay, and the author's next stroke sends them. */
      if (answer.uncertain) {
        failures.current += 1;
        if (failures.current <= MAX_SAVE_RETRIES) queueWash(RETRY_AFTER_MS * 2 ** (failures.current - 1));
      } else for (const c of batch) c.save = false;
      return;
    }
    const id = (answer.value as { id?: unknown } | null)?.id;
    const washIds = new Set((now.current.acts ?? EMPTY).flatMap((x) => (x.kind === 'wash' && x.id !== undefined ? [x.id] : [])));
    for (const c of batch) { c.sent = typeof id === 'string' ? id : true; c.sentWashIds = washIds; }
    failures.current = 0;
    say('');
    if (toSend().length > 0) queueWash(gone.current ? 0 : WASH_AFTER_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [say]);
  const queueWash = useCallback((after = WASH_AFTER_MS) => {
    if (washTimer.current) clearTimeout(washTimer.current);
    washTimer.current = setTimeout(() => { void flush(); }, after);
  }, [flush]);

  /** A finished stroke closes its chunks; the author's are then sent. */
  const keep = useCallback((s: Live) => {
    for (const c of s.chunks.values()) c.open = false;
    if (s.chunks.size > 0 && s.save && now.current.reader.author) queueWash();
  }, [queueWash]);

  /* ------------------------------------------------------------------ a stroke ---- */

  /** Where a point of the screen lies in the body's box, in shares of it. */
  const shareAt = (clientX: number, clientY: number): Pt => {
    const el = now.current.surfaceEl ?? frameRef.current!;
    const rect = el.getBoundingClientRect();
    const { box: b } = now.current.size;
    return [(clientX - rect.left - el.clientLeft) / b.w, (clientY - rect.top - el.clientTop) / b.h];
  };
  /** Where a point of the screen lies in the body's box, in px. */
  const pxAt = (clientX: number, clientY: number): Pt => {
    const el = now.current.surfaceEl ?? frameRef.current!;
    const rect = el.getBoundingClientRect();
    return [clientX - rect.left - el.clientLeft, clientY - rect.top - el.clientTop];
  };
  /** Presses to the sponge's walk to a px point: they thin the wall's top group with paint, and are kept in the stroke's chunks. */
  const pressTo = (s: Live, p: Pt) => {
    for (const press of wall().walk(s.walker, p)) {
      if (press.draw === '') continue;
      const key = `${press.draw}/${press.group}`;
      let c = s.chunks.get(key);
      if (!c) { c = { draw: press.draw, group: press.group, presses: [], save: s.save && now.current.reader.author, open: true }; s.chunks.set(key, c); chunks.current.push(c); }
      c.presses.push([press.u, press.v]);
    }
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
    schedulePaint();
  }, [keep, schedulePaint]);

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
    const stroke = newLive(pointer, true, touch);
    strokes.current += 1;
    setScrubbed(strokes.current);
    live.current = stroke;
    suppress.current = false;
    pressTo(stroke, pxAt(clientX, clientY));
    schedulePaint();
    return true;
  };

  const extend = (s: Live, clientX: number, clientY: number) => {
    const p = pxAt(clientX, clientY);
    const last = s.walker.last;
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) === 0) return;
    pressTo(s, p);
    suppress.current = true;
    const { box: b } = now.current.size;
    if (last && b.w > 0 && b.h > 0) throwSuds([last[0] / b.w, last[1] / b.h], [p[0] / b.w, p[1] / b.h]);
    schedulePaint();
  };

  const shown = useRef<'sponge' | null>(null);
  const showCursor = (e: PointerEvent) => {
    const el = now.current.surfaceEl;
    if (!el) return;
    const over = !live.current && !overInk(e.target, bodyNow()) && !now.current.drawing && hitAtClient(e.clientX, e.clientY);
    shown.current = live.current && !live.current.touch ? 'sponge' : over ? 'sponge' : null;
    cursor.over(el, e, shown.current);
  };

  const ensure = () => {
    const f = frameRef.current;
    if (!f) return;
    const cell = bodyOf(f);
    if ((cell ?? f) !== now.current.surfaceEl) remeasure.current?.();
  };

  const onPointerDown = (e: PointerEvent) => {
    ensure();
    if (e.pointerType === 'touch' || !fixed || live.current || (e.pointerType === 'mouse' && e.button !== 0) || overInk(e.target, bodyNow()) || interactive(e.target)) return;
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
    if (!tc || !fixed || overInk(e.target, bodyNow()) || interactive(e.target)) return;
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
   * The input: the frame always, and the body too where there is one, as Whoops!'s (whoops/Effect.tsx has the reasoning): native listeners, each
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
    schedulePaint();
  }, [closeSweepStroke, schedulePaint]);

  /** Sweeps the wall line by line at the pace of a hand: on this screen alone, or (the author's Wash) saved for everyone too. */
  const startSweep = useCallback((save: boolean) => {
    const { size: sz } = now.current;
    if (now.current.still || sweeping.current || sz.box.w <= 0 || sz.box.h <= 0 || now.current.acts === null) return;
    const b = sz.box;
    const rows = bandsOf(b);
    /* Whoops!'s pace (scrub.ts `SWEEP_PX_S`, a hand's px a second on any box). */
    const speed = SWEEP_PX_S / b.w;
    const run = { raf: 0, last: performance.now(), sweep: { row: Math.min(sweepFrom.current, rows.length - 1), x: 0 } as Sweep };
    sweeping.current = run;
    const tick = (t: number) => {
      const dt = Math.min(0.05, Math.max(0, (t - run.last) / 1000));
      run.last = t;
      const w = wall();
      /* A band's ink, across, in shares: where the wall's fields still hold paint on it, so the sweep waits out no empty line. The band is no deeper than a press reaches. */
      const half = w.bandHalf();
      const span = (row: number): readonly [number, number] | null => {
        const px = w.spanOf(rows[row]! * b.h - half, rows[row]! * b.h + half);
        return px ? [px[0] / b.w, px[1] / b.w] : null;
      };
      const step = sweepStep(rows, run.sweep, dt, speed, span);
      if (step.idle) {
        stopSweep();
        return;
      }
      const p = step.point;
      const px: Pt = [p[0] * b.w, p[1] * b.h];
      const open = sweepStroke.current;
      const sameBand = open !== null && step.sweep.row === run.sweep.row;
      if (open && !sameBand) closeSweepStroke();
      meet();
      const cur = sweepStroke.current;
      if (cur) {
        const last = cur.walker.last!;
        pressTo(cur, px);
        throwSuds([last[0] / b.w, last[1] / b.h], p);
      } else {
        const stroke = newLive(null, save);
        strokes.current += 1;
        setScrubbed(strokes.current);
        sweepStroke.current = stroke;
        pressTo(stroke, px);
        throwSuds(p, p);
      }
      run.sweep = step.sweep;
      schedulePaint();
      run.raf = requestAnimationFrame(tick);
    };
    run.raf = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeSweepStroke, schedulePaint, stopSweep, wall]);
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
      /* What is still to send is sent now, and a send that gets no answer is retried after the post is gone: its timer is left to run out the retries. */
      if (toSend().length > 0) void flush();
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


  const onBox = { left: -size.left, top: -size.top, width: box.w, height: box.h };
  /* The Draw tile sits at the body's top right, lifted over the ink. */
  const tile = { left: -size.left + box.w, top: -size.top };
  return (
    <div ref={rootRef} className="kb-graffiti" data-kb-graffiti data-kb-place={place} data-kb-scrubbed={scrubbed} data-kb-drawing={drawing ? 'true' : undefined}>
      <div ref={frameRef} className="kb-graffiti-frame" style={cellEl ? { overflow: 'visible' } : undefined}>
        <div ref={layoutRef} data-kb-graffiti-layout="">
          <TextLayer runs={runs}>{drawing ? <Marked post={post}>{children}</Marked> : children}</TextLayer>
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
        {drawing && drawable && surface && plays[0] && hudCharacter && (
          <DrawMode
            box={box} post={post} wall={acts} covered={surface.covered} most={surface.most} asks
            dockHost={dockHostOf(frameRef.current) ?? rootRef.current}
            submit={async (input) => {
              const answer = await surface.draw(plays[0]!.id, hudCharacter.id, input);
              if (answer.ok && draftAct.current) { holding.current = { id: (answer.value as { id?: string } | null)?.id, acts: now.current.acts }; settleHold(); }
              return answer;
            }} cancel={() => setDrawing(false)} done={() => setDrawing(false)}
            onDraft={onDraft} overlayStyle={onBox}
          />
        )}
      </div>

      <p className="kb-visually-hidden" role="status" data-kb-report>{report}</p>
    </div>
  );
}
