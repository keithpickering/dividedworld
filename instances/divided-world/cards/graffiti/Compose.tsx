/**
 * Drawing on the post (docs/plans/2026-11-11-graffiti-design.md, sections 6, 8 and 11; plan Task 10): the one component that draws a tag, used two ways.
 *
 * - **`Compose`** is the card's `CardUi.Compose`. The engine mounts it as the outermost thing on the post when the card is played (or set face
 *   down) there, with the post's words, inside every card's layer, as `children`, and the element around the words as `under`. It portals the
 *   drawing and the surface it is drawn on into `under`, beneath every layer (so a splat covers what is drawn), and lands the play through
 *   `submit({}, first)`: the configuration is empty and the drawing is the play's first draw. The engine owns the ways out and the question
 *   before them; this tells it whether work is held (`hold`).
 * - **`DrawMode`** is the same drawing on a wall already there, which the Draw tile of Effect.tsx opens. It lands through the surface's `draw`, and
 *   the host paints the drawing into the wall's own layer (`onDraft`), which lies beneath any splat, so under a splat it shows only where the
 *   splat is scrubbed. It asks its own question before leaving (`asks`), as there is no engine compose to ask it.
 *
 * **The drawing.** A press draws and never scrubs: the surface is lifted (`data-kb-over-ink`), so Whoops! and the wall start nothing under it.
 * Strokes are kept in shares of the post body's box to four decimals, with the drawer's `aspect`, thinned of points under a few pixels apart, within
 * the bounds of graffiti.ts (120 strokes, 300 points to a stroke, 3,000 in all; past one nothing more is added and the toolbar says so). The touch
 * rules are the wall's and Whoops!'s (../wiping.ts): a mouse or pen is read by pointer events and a finger by touch events; a quick swipe up or down is the page's
 * and draws nothing, a sideways swipe or a press held draws, a tap is a dab, and a second finger is the page's. A fine mouse shows a drawn can
 * (whoops/cursor.ts, mode `can`). Freehand is a pointer act; the Stencils tab is the keyboard's path to everything it can make, at the cost of a
 * tag.
 *
 * **The meter** counts this drawing's cells as it grows, unioned with the wall's own cells (draft.ts), so ink over ink adds nothing. A refusal
 * from the server is shown in the toolbar in its words and the drawing is kept.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ComposeProps } from '../../../../engine/ui/cards/types.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import { LOST_ANSWER, type Answer } from '../../../../engine/ui/data/api.ts';
import { usePlayer } from '../../../../engine/ui/player.tsx';
import { BOUNDS, CANS, type Can, type Cap } from '../graffiti.ts';
import { cursor } from '../whoops/cursor.ts';
import { HOLD_MS, swipeKind } from '../wiping.ts';
import { addPoint, inputOf, lastCan, meterOf, paintAct, rememberCan, undo, wallCells, type Draft, type Pt, type Stroke } from './draft.ts';
import { paintWall, wallDensity, type Box, type WallAct } from './spray.ts';
import type { StencilKey } from './stencils.ts';
import { Toolbar, type ToolbarTab } from './Toolbar.tsx';
import './graffiti.css';

/** The question put before a drawing is left, in the card's own words. */
export const LEAVE_ASK = 'Leave without tagging? Your drawing isn\'t saved.';
/** What the limit is where the instance's settings do not say (an instance seeded before the setting existed). */
const DEFAULT_LIMIT = 40;
/** Points closer than this to the one before are dropped, px. */
const MIN_STEP_PX = 4;
const tenThousandth = (n: number) => Math.round(n * 10_000) / 10_000;
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const NO_ACTS: readonly WallAct[] = [];

const FULL: Record<'strokes' | 'points', string> = {
  strokes: `That's the most one tag can hold: ${BOUNDS.strokes} strokes. Tag it, or Undo a stroke to make room.`,
  points: `That's the most one tag can hold: ${BOUNDS.totalPoints.toLocaleString('en-US')} points of drawing. Tag it, or Undo a stroke to make room.`,
};

export interface DrawModeProps {
  /** Cast now, or set face down on the player's own post. */
  readonly mode: 'cast' | 'set';
  /** The post body's box (px): what a stroke's shares are of, and its aspect. Nothing is drawn before it is known. */
  readonly box: Box | null;
  /** The wall's live Acts, oldest first, whose cells the drawing is added to; null where they are not read yet. */
  readonly wall: readonly WallAct[] | null;
  /** The cells the wall covers, from the page's read: the meter's start while `wall` is null. */
  readonly covered: number;
  /** The most cells the wall may cover: the card's limit as cells. */
  readonly most: number;
  /** Where the toolbar is drawn (a portal), or null to draw it beside the surface. */
  readonly dockHost: HTMLElement | null;
  /** Ask the question before leaving here (a host that is no engine compose); false where the engine asks (`hold`, `cancel`). */
  readonly asks: boolean;
  /** Land the drawing: `{ strokes }` or `{ stencil, can, spot }`. The answer is the server's, or its refusal in its words. */
  readonly submit: (input: unknown) => Promise<Answer<unknown>>;
  /** Leave. Never asks where `asks` is false: the engine has asked. */
  readonly cancel: () => void;
  /** The drawing landed. */
  readonly done?: () => void;
  /** Say whether work is held (the question to ask before leaving), or null. */
  readonly hold?: (ask: string | null) => void;
  /** The drawing, as the painter takes a draw, for the host to paint into its layer; null when there is none. */
  readonly onDraft?: (act: WallAct | null) => void;
  /** Where the lifted surface sits over the post body (the host's box). */
  readonly overlayStyle?: CSSProperties;
  /** An element to draw the lifted surface into (Compose's `under`), or null to draw it where this is mounted. */
  readonly overlayHost?: HTMLElement | null;
}

interface Gesture { readonly id: number; readonly x0: number; readonly y0: number; state: 'wait' | 'draw' | 'page'; timer: ReturnType<typeof setTimeout> | null }
interface Live { readonly pointer: number; readonly touch: boolean; lx: number; ly: number }

export function DrawMode(p: DrawModeProps) {
  const { session } = usePlayer();
  const account = session.signedIn ? session.account : null;
  const [can, setCan] = useState<Can>(() => lastCan(account));
  const [cap, setCap] = useState<Cap>('stock');
  const [tab, setTab] = useState<ToolbarTab>('spray');
  const [stencil, setStencil] = useState<StencilKey | null>(null);
  const [spot, setSpot] = useState(4);
  const [, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [surfaceEl, setSurfaceEl] = useState<HTMLDivElement | null>(null);
  /** The strokes are kept in place and shown through `version`: a stroke grows a point at a time. */
  const strokes = useRef<Stroke[]>([]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const freehand = tab === 'spray' && strokes.current.length > 0 ? ({ kind: 'freehand', strokes: strokes.current } as const) : null;
  const draft: Draft | null = freehand ?? (tab === 'stencils' && stencil !== null ? { kind: 'stencil', stencil, can, spot } : null);
  /* A new object each render: the strokes change in place, so the memos below are keyed by what they change with. */
  const version = strokes.current.reduce((n, s) => n + s.points.length, strokes.current.length);
  const cells = useMemo(() => (p.wall ? wallCells(p.wall) : null), [p.wall]);
  const meter = useMemo(
    () => meterOf(cells, p.covered, draft, p.most),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cells, p.covered, p.most, tab, stencil, can, spot, version, strokes.current.length],
  );
  const held = strokes.current.length > 0 || stencil !== null;

  const now = useRef({ can, cap, box: p.box, locked: false, busy: false, asking: null as string | null, tab });
  now.current = { can, cap, box: p.box, locked: busy || asking !== null, busy, asking, tab };

  const changed = () => { setVersion((v) => v + 1); setRefusal(null); };

  /* ---------------------------------------------------- what the host is told ---- */

  const hold = useRef(p.hold);
  hold.current = p.hold;
  useEffect(() => { hold.current?.(held ? LEAVE_ASK : null); }, [held]);

  const onDraft = useRef(p.onDraft);
  onDraft.current = p.onDraft;
  const act = useMemo(
    () => paintAct(draft),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, stencil, can, spot, version, strokes.current.length],
  );
  useEffect(() => { onDraft.current?.(act); }, [act]);
  useEffect(() => () => { onDraft.current?.(null); }, []);

  /* A page left while an untagged drawing is held asks the browser's question too, where this asks the question itself. */
  useEffect(() => {
    if (!p.asks || !held) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [p.asks, held]);

  /* ------------------------------------------------------------ ways out ---- */

  const cancel = () => { if (p.asks && held) setAsking(LEAVE_ASK); else p.cancel(); };
  const cancelNow = useRef(cancel);
  cancelNow.current = cancel;
  useEffect(() => {
    if (!p.asks) return undefined;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      /* Sending: nothing to leave yet. Asked: Esc is Stay. Otherwise it is Cancel. */
      if (now.current.busy) return;
      if (now.current.asking !== null) setAsking(null);
      else cancelNow.current();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [p.asks]);

  const send = async () => {
    if (!draft || meter.over || busy) return;
    setBusy(true);
    setRefusal(null);
    let answer: Answer<unknown>;
    try { answer = await p.submit(inputOf(draft)); } catch { answer = { ok: false, error: LOST_ANSWER, uncertain: true }; }
    if (!alive.current) return;
    setBusy(false);
    if (!answer.ok) { setRefusal(answer.error); return; }
    rememberCan(account, can);
    p.done?.();
  };

  const takeBack = () => {
    undo(strokes.current);
    setNotice(null);
    changed();
  };

  /* ------------------------------------------------------------ a stroke ---- */

  const live = useRef<Live | null>(null);
  const gesture = useRef<Gesture | null>(null);

  /** Where a point of the screen lies in the post body's box, in shares of it, to a ten-thousandth. */
  const shareAt = (clientX: number, clientY: number): Pt => {
    const el = surfaceEl!;
    const rect = el.getBoundingClientRect();
    const box = now.current.box!;
    const w = rect.width > 0 ? rect.width : box.w, h = rect.height > 0 ? rect.height : box.h;
    return [tenThousandth(clamp((clientX - rect.left) / w)), tenThousandth(clamp((clientY - rect.top) / h))];
  };

  const begin = (clientX: number, clientY: number, pointer: number, touch: boolean): boolean => {
    const { box, locked, can: c, cap: k } = now.current;
    if (!surfaceEl || !box || box.w <= 0 || box.h <= 0 || locked || now.current.tab !== 'spray') return false;
    const total = strokes.current.reduce((n, s) => n + s.points.length, 0);
    if (strokes.current.length >= BOUNDS.strokes) { setNotice(FULL.strokes); return false; }
    if (total >= BOUNDS.totalPoints) { setNotice(FULL.points); return false; }
    strokes.current.push({ can: c, cap: k, aspect: Number((box.w / box.h).toPrecision(3)), points: [shareAt(clientX, clientY)] });
    live.current = { pointer, touch, lx: clientX, ly: clientY };
    changed();
    return true;
  };

  const extend = (s: Live, clientX: number, clientY: number) => {
    if (Math.hypot(clientX - s.lx, clientY - s.ly) < MIN_STEP_PX) return;
    const added = addPoint(strokes.current, shareAt(clientX, clientY));
    if (added !== 'ok') { setNotice(FULL[added]); return; }
    s.lx = clientX;
    s.ly = clientY;
    changed();
  };

  const showCursor = (e: PointerEvent) => { if (surfaceEl) cursor.over(surfaceEl, e, 'can', CANS[now.current.can]); };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || live.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (!begin(e.clientX, e.clientY, e.pointerId, false)) return;
    e.preventDefault();
    (e.currentTarget as Element | null)?.setPointerCapture?.(e.pointerId);
    cursor.press(true);
    showCursor(e);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const s = live.current;
    if (s && !s.touch && e.pointerId === s.pointer) extend(s, e.clientX, e.clientY);
    showCursor(e);
  };
  const onPointerEnd = (e: PointerEvent) => {
    const s = live.current;
    if (e.pointerType === 'touch' || !s || s.touch || e.pointerId !== s.pointer) return;
    live.current = null;
    cursor.press(false);
    if (e.type === 'pointerup') showCursor(e);
    else if (surfaceEl) cursor.leave(surfaceEl);
  };
  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || live.current || !surfaceEl) return;
    cursor.leave(surfaceEl);
  };

  /* A finger: a swipe up or down is the page's, a hold or a sideways swipe draws, a tap is a dab, a second finger is the page's. */
  const settle = (g: Gesture) => { if (g.timer) clearTimeout(g.timer); g.timer = null; };
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length > 1) {
      if (gesture.current) { settle(gesture.current); gesture.current.state = 'page'; }
      live.current = null;
      return;
    }
    const tc = e.changedTouches[0];
    if (!tc || now.current.locked) return;
    const g: Gesture = { id: tc.identifier, x0: tc.clientX, y0: tc.clientY, state: 'wait', timer: null };
    gesture.current = g;
    g.timer = setTimeout(() => {
      if (gesture.current !== g || g.state !== 'wait') return;
      /* Held: the surface is grabbed, with a short buzz where the device allows it. */
      g.state = 'draw';
      begin(g.x0, g.y0, g.id, true);
      try { navigator.vibrate?.(8); } catch { /* not offered here */ }
    }, HOLD_MS);
  };
  const onTouchMove = (e: TouchEvent) => {
    const g = gesture.current;
    if (!g) return;
    const tc = Array.from(e.changedTouches).find((c) => c.identifier === g.id);
    if (!tc || g.state === 'page') return;
    if (g.state === 'wait') {
      const kind = swipeKind(tc.clientX - g.x0, tc.clientY - g.y0);
      if (kind === 'wait') return;
      settle(g);
      if (kind === 'page') { g.state = 'page'; return; }
      g.state = 'draw';
      begin(g.x0, g.y0, g.id, true);
    }
    /* Drawing: the page's scroll is refused for the rest of the touch. */
    if (e.cancelable) e.preventDefault();
    const s = live.current;
    if (s?.touch) extend(s, tc.clientX, tc.clientY);
  };
  const onTouchEnd = (e: TouchEvent) => {
    const g = gesture.current;
    if (!g || !Array.from(e.changedTouches).some((c) => c.identifier === g.id)) return;
    settle(g);
    /* A tap on the post is one dab, as a click is. */
    if (e.type === 'touchend' && g.state === 'wait') begin(g.x0, g.y0, g.id, true);
    gesture.current = null;
    if (live.current?.touch) live.current = null;
  };

  /* The input is native listeners on the lifted surface, each calling the latest handler: a touchmove must be able to refuse the page's scroll. */
  const handlers = useRef({ onPointerDown, onPointerMove, onPointerEnd, onPointerLeave, onTouchStart, onTouchMove, onTouchEnd });
  handlers.current = { onPointerDown, onPointerMove, onPointerEnd, onPointerLeave, onTouchStart, onTouchMove, onTouchEnd };
  useEffect(() => {
    const el = surfaceEl;
    if (!el) return undefined;
    const on = {
      pointerdown: (e: PointerEvent) => handlers.current.onPointerDown(e),
      pointermove: (e: PointerEvent) => handlers.current.onPointerMove(e),
      pointerup: (e: PointerEvent) => handlers.current.onPointerEnd(e),
      pointercancel: (e: PointerEvent) => handlers.current.onPointerEnd(e),
      pointerleave: (e: PointerEvent) => handlers.current.onPointerLeave(e),
      touchstart: (e: TouchEvent) => handlers.current.onTouchStart(e),
      touchmove: (e: TouchEvent) => handlers.current.onTouchMove(e),
      touchend: (e: TouchEvent) => handlers.current.onTouchEnd(e),
      touchcancel: (e: TouchEvent) => handlers.current.onTouchEnd(e),
    };
    for (const [type, fn] of Object.entries(on)) el.addEventListener(type, fn as EventListener, { passive: type !== 'touchmove' });
    return () => {
      for (const [type, fn] of Object.entries(on)) el.removeEventListener(type, fn as EventListener);
      if (gesture.current) { settle(gesture.current); gesture.current = null; }
      live.current = null;
      cursor.leave(el);
    };
  }, [surfaceEl]);

  /* ---------------------------------------------------------------- the view ---- */

  const dock = (
    <Toolbar
      mode={p.mode} can={can} onCan={(c) => { setCan(c); rememberCan(account, c); }} cap={cap} onCap={setCap} tab={tab} onTab={(t) => { setTab(t); setRefusal(null); }}
      stencil={stencil} onStencil={(s) => { setStencil(s); setRefusal(null); }} spot={spot} onSpot={(s) => { setSpot(s); setRefusal(null); }}
      meter={meter} hasDraft={draft !== null} canUndo={strokes.current.length > 0 && !busy} onUndo={takeBack} onCancel={cancel} onSubmit={() => { void send(); }}
      busy={busy} refusal={refusal} notice={notice} asking={asking} onLeave={() => { setAsking(null); p.cancel(); }} onStay={() => setAsking(null)} focusOnMount
    />
  );
  const surface = (
    <div
      ref={setSurfaceEl} className="kb-graffiti-surface" data-kb-draw-surface data-kb-over-ink data-kb-strokes={strokes.current.length}
      style={{ position: 'absolute', ...p.overlayStyle }}
    />
  );
  return (
    <>
      {p.overlayHost ? createPortal(surface, p.overlayHost) : surface}
      {p.dockHost ? createPortal(dock, p.dockHost) : dock}
    </>
  );
}

/** The engine's post, which the dock is drawn under so the post body's box never changes with it. */
const postOf = (el: Element | null): HTMLElement | null => el?.closest<HTMLElement>('.kb-act') ?? null;

/** The card's `CardUi.Compose`: the drawing beneath every layer of the post, and the toolbar under the post. */
export function Compose({ mode, box, under, submit, cancel, hold, children }: ComposeProps) {
  const { settings } = useKayfa();
  const most = (settings.cardSettings['graffiti.limit'] ?? DEFAULT_LIMIT) * 100;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dockHost, setDockHost] = useState<HTMLElement | null>(null);
  const [fallback, setFallback] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState<WallAct | null>(null);
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

  /* The words' element holds the drawing and its surface, which sit in it; it is positioned if the page has not. */
  useLayoutEffect(() => {
    if (!under) return undefined;
    const was = under.style.position;
    if (getComputedStyle(under).position === 'static') under.style.position = 'relative';
    return () => { under.style.position = was; };
  }, [under]);
  useLayoutEffect(() => { setDockHost(postOf(under) ?? fallback); }, [under, fallback]);

  const size = box && box.w > 0 && box.h > 0 ? box : null;
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    const q = wallDensity(size, dpr);
    canvas.width = Math.ceil(size.w * q);
    canvas.height = Math.ceil(size.h * q);
    const ctx = canvas.getContext('2d');
    if (ctx) paintWall(ctx, size, dpr, draft ? [draft] : NO_ACTS);
  }, [draft, size, dpr]);

  const onBox: CSSProperties = size ? { left: 0, top: 0, width: size.w, height: size.h } : {};
  return (
    <>
      {children}
      {under && size && createPortal(<canvas ref={canvasRef} className="kb-graffiti-ink" data-kb-effect-ink aria-hidden="true" style={onBox} />, under)}
      <DrawMode
        mode={mode} box={size} wall={NO_ACTS} covered={0} most={most} dockHost={dockHost} asks={false}
        submit={(first) => submit({}, first)} cancel={cancel} hold={hold} onDraft={setDraft} overlayStyle={onBox} overlayHost={under}
      />
      <div ref={setFallback} className="kb-graffiti-dockhost" />
    </>
  );
}
