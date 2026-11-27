/**
 * Drawing on the post (docs/plans/2026-11-11-graffiti-design.md, sections 6, 8 and 11; plan Task 10): the one component that draws a tag, used two ways.
 *
 * - **`Compose`** is the card's `CardUi.Compose`. The engine mounts it as the outermost thing on the post when the card is played there, with the post's words, inside every card's layer, as `children`, and the element around the words as `under`. It portals the
 *   drawing and the surface it is drawn on into `under`, beneath every layer (so a splat covers what is drawn), and lands the play through
 *   `submit({}, first)`: the configuration is empty and the drawing is the play's first draw. The engine owns the ways out and the question
 *   before them; this tells it whether work is held (`hold`).
 * - **`DrawMode`** is the same drawing on a wall already there, which the Draw tile of Effect.tsx opens. It lands through the surface's `draw`, and
 *   the host paints the drawing into the wall's own layer (`onDraft`), which lies beneath any splat, so under a splat it shows only where the
 *   splat is scrubbed. It asks its own question before leaving (`asks`), as there is no engine compose to ask it.
 *
 * **The drawing.** A press draws and never scrubs: the surface is lifted (`data-kb-over-ink`), so Whoops! and the wall start nothing under it.
 * Strokes are kept in px of the post body's box, at this screen's text size (a Stock stroke is 1.07 ems wide), thinned of points under a few pixels
 * apart, within the bounds of graffiti.ts (120 strokes, 300 points to a stroke, 3,000 in all; past one nothing more is added and the toolbar says so). The touch
 * rules are the wall's and Whoops!'s (../wiping.ts): a mouse or pen is read by pointer events and a finger by touch events; a quick swipe up or down is the page's
 * and draws nothing, a sideways swipe or a press held draws, a tap is a dab, and a second finger is the page's. A fine mouse shows a drawn can
 * (whoops/cursor.ts, mode `can`). Freehand is a pointer act; the Stencils tab is the keyboard's path to everything it can make, at the cost of a
 * tag.
 *
 * **Tagging** (docs/plans/2026-11-27-graffiti-everywhere-design.md, sections 1 to 4). While draw mode is open the post's words carry a `TextLayer` of
 * `mark` runs (`Marked`), an empty `data-kb-word-mark` element at each word's first character, words split on whitespace in the visible text, so every
 * word's left edge and line can be measured; images carry `data-kb-img`. At Tag it the drawing is measured against them (`measureTagging`) and `inputOf`
 * (draft.ts) groups it and attaches each group to what is under it. The post's version is what the page's read carries with the post (`version`: its latest edit, or its own Act), or the tails' version
 * after an edit lands in the page; where neither says (a post edited since the page read it) a group is attached to the box, which any version accepts.
 *
 * **The meter** is the wall's `covered` plus this drawing's own painted cells, counted in full (draft.ts). A refusal from the server is shown in the
 * toolbar in its words and the drawing is kept.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { forgedList, forgedSet } from '../../../../engine/bbcode/quoted.ts';
import { contentOf } from '../../../../engine/rules/anchor.ts';
import { TextLayer, type TextRun } from '../../../../engine/ui/bbcode/layers.tsx';
import type { ComposeProps } from '../../../../engine/ui/cards/types.ts';
import { bodyOf, wordsBoxOf } from '../../../../engine/ui/cards/body.ts';
import { usePostVersion } from '../../../../engine/ui/cards/tails.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import { LOST_ANSWER, type Act, type Answer } from '../../../../engine/ui/data/api.ts';
import { usePlayer } from '../../../../engine/ui/player.tsx';
import { BOUNDS, CANS, type Can, type Cap } from '../graffiti.ts';
import { cursor } from '../whoops/cursor.ts';
import { HOLD_MS, swipeKind } from '../wiping.ts';
import { addPoint, bare, inputOf, lastCan, meterOf, paintAct, rememberCan, undo, wordsOf, type Draft, type Picture, type Pt, type Stroke, type Tagging, type Word } from './draft.ts';
import { paintWall, wallDensity, type Box, type WallAct } from './spray.ts';
import type { StencilKey } from './stencils.ts';
import { dockHostOf, Toolbar, type ToolbarTab } from './Toolbar.tsx';
import './graffiti.css';

/** The question put before a drawing is left, in the card's own words. */
export const LEAVE_ASK = 'Leave without tagging? Your drawing isn\'t saved.';
/** What the limit is where the instance's settings do not say (an instance seeded before the setting existed). */
const DEFAULT_LIMIT = 40;
/** Points closer than this to the one before are dropped, px. */
const MIN_STEP_PX = 4;
const hundredth = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, most: number) => Math.min(most, Math.max(0, n));
const NO_ACTS: readonly WallAct[] = [];
/** The text size a screen is taken to have where it cannot be read: the board's 15px. */
const DEFAULT_EM = 15;

/* ---------------------------------------------------------------- the marks and the layout ---- */

const MARK = 'data-kb-word-mark';

/** The post's visible text and images as the screen draws them (the renderer's verdict on its quotes included). */
const contentFor = (post: Act) => contentOf(String(post.currentPayload.body ?? ''), forgedSet(forgedList(post.currentPayload)));

/** The version a post is at as its own Act says: the page's `version` unless the post has been edited since (an `editedAt` the version does not account for), else its own id while it has no edit; null where it is not known. */
const currentVersionOf = (post: Act): string | null => {
  if (post.editedAt === null) return post.version ?? post.id;
  return post.version !== undefined && post.version !== post.id ? post.version : null;
};

/** A mark at each word's first character: the empty element a word's left and line are measured by. */
function marksOf(text: string): readonly TextRun[] {
  return wordsOf(text).map(({ start }): TextRun => ({
    start, end: start, key: `kbgw${start}`, z: 0, mode: 'mark',
    render: ({ key }) => <span key={key} {...{ [MARK]: start }} aria-hidden="true" />,
  }));
}

/** The post's words with the marks draw mode measures them by laid over them. */
export function Marked({ post, children }: { readonly post: Act; readonly children: ReactNode }) {
  const body = String(post.currentPayload.body ?? ''), forged = (forgedList(post.currentPayload) ?? []).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the words and their verdict are what the marks are made from
  const runs = useMemo(() => marksOf(contentFor(post).text), [body, forged]);
  return <TextLayer runs={runs}>{children}</TextLayer>;
}

/** The text size of the post's words in px, as this screen draws them. */
function emOf(surface: HTMLElement | null): number {
  const body = surface ? bodyOf(surface) : null;
  const el = body ? wordsBoxOf(body) ?? body : null;
  const px = el ? parseFloat(getComputedStyle(el).fontSize) : Number.NaN;
  return Number.isFinite(px) && px > 0 ? px : DEFAULT_EM;
}

/**
 * What a drawing is tagged against on this screen now: each word's mark and each image, in px from the surface's top left (the post body's box), the post's
 * text and images, and the version a tag would name. Read at Tag it, never while drawing.
 */
function measureTagging(surface: HTMLElement | null, box: Box, post: Act | null, version: string | null): Tagging {
  const emPx = emOf(surface);
  const body = surface ? bodyOf(surface) : null;
  if (!surface || !body || !post || version === null) return { ...bare(box, emPx), version };
  const content = contentFor(post);
  const lens = new Map(wordsOf(content.text).map((w) => [w.start, w.len]));
  const origin = surface.getBoundingClientRect();
  const own = (el: Element) => bodyOf(el) === body;
  const words = [...body.querySelectorAll(`[${MARK}]`)].filter(own).flatMap((el): Word[] => {
    const start = Number(el.getAttribute(MARK)), len = lens.get(start);
    if (len === undefined) return [];
    const r = el.getBoundingClientRect();
    return [{ start, len, x: r.left - origin.left, y: r.top - origin.top, h: r.height > 0 ? r.height : 1.4 * emPx }];
  });
  const pictures = [...body.querySelectorAll('[data-kb-img]')].filter(own).flatMap((el): Picture[] => {
    const r = el.getBoundingClientRect();
    return [{ n: Number(el.getAttribute('data-kb-img')), x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }];
  });
  return { box, emPx, version, text: content.text, images: content.images, words, pictures };
}

const FULL: Record<'strokes' | 'points', string> = {
  strokes: `That's the most one tag can hold: ${BOUNDS.strokes} strokes. Tag it, or Undo a stroke to make room.`,
  points: `That's the most one tag can hold: ${BOUNDS.totalPoints.toLocaleString('en-US')} points of drawing. Tag it, or Undo a stroke to make room.`,
};

export interface DrawModeProps {
  /** The post body's box (px): what a stroke's shares are of, and its aspect. Nothing is drawn before it is known. */
  readonly box: Box | null;
  /** No longer read: the meter counts the wall's `covered` and the drawing's own cells, and never the wall's strokes (design section 7). Kept so a host that still passes it type-checks. */
  readonly wall?: readonly WallAct[] | null;
  /** The post the drawing is on: what its tags are attached to (its words, its images, its current version). Without it every group is attached to the box. */
  readonly post?: Act;
  /** The cells the wall covers, from the page's read: the meter's start. */
  readonly covered: number;
  /** The most cells the wall may cover: the card's limit as cells. */
  readonly most: number;
  /** Where the toolbar is drawn (a portal), or null to draw it beside the surface. */
  readonly dockHost: HTMLElement | null;
  /** The host is not resolved yet: the toolbar waits, so it mounts once, where it stays. */
  readonly dockPending?: boolean;
  /** Ask the question before leaving here (a host that is no engine compose); false where the engine asks (`hold`, `cancel`). */
  readonly asks: boolean;
  /** Land the drawing: `{ box, groups }` or `{ stencil, can, spot }`. The answer is the server's, or its refusal in its words. */
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
  /* What a drawing is counted and previewed against needs no measuring of the words: the attachment changes neither (draft.ts `bare`). */
  const em = emOf(surfaceEl);
  const frame = useMemo(() => bare(p.box ?? { w: 1, h: 1 }, em), [p.box?.w, p.box?.h, em]); // eslint-disable-line react-hooks/exhaustive-deps
  const meter = useMemo(
    () => meterOf(p.covered, draft, p.most, frame),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.covered, p.most, frame, tab, stencil, can, spot, version, strokes.current.length],
  );
  /* The post's current version: what the tails the page holds say (they are read again after an edit), else the version the page's read carried with the post (`version`, thread_page 0456: its latest edit, or its own Act), else its own
     Act while it has no edit. A post edited since the page read it (an edit that lands in it, `editedAt` set while `version` is still its own id or absent) with no tails is not known: its groups are attached to the box, which any version accepts. */
  const heldVersion = usePostVersion(p.post?.id ?? '');
  const postVersion = p.post ? (heldVersion ?? currentVersionOf(p.post)) : null;
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
    () => paintAct(draft, frame),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frame, tab, stencil, can, spot, version, strokes.current.length],
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
    try { answer = await p.submit(inputOf(draft, measureTagging(surfaceEl, p.box ?? frame.box, p.post ?? null, postVersion))); } catch { answer = { ok: false, error: LOST_ANSWER, uncertain: true }; }
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

  /** Where a point of the screen lies in the post body's box, in px from its top left, to a hundredth. */
  const pointAt = (clientX: number, clientY: number): Pt => {
    const rect = surfaceEl!.getBoundingClientRect();
    const box = now.current.box!;
    return [hundredth(clamp(clientX - rect.left, box.w)), hundredth(clamp(clientY - rect.top, box.h))];
  };

  const begin = (clientX: number, clientY: number, pointer: number, touch: boolean): boolean => {
    const { box, locked, can: c, cap: k } = now.current;
    if (!surfaceEl || !box || box.w <= 0 || box.h <= 0 || locked || now.current.tab !== 'spray') return false;
    const total = strokes.current.reduce((n, s) => n + s.points.length, 0);
    if (strokes.current.length >= BOUNDS.strokes) { setNotice(FULL.strokes); return false; }
    if (total >= BOUNDS.totalPoints) { setNotice(FULL.points); return false; }
    strokes.current.push({ can: c, cap: k, points: [pointAt(clientX, clientY)] });
    live.current = { pointer, touch, lx: clientX, ly: clientY };
    changed();
    return true;
  };

  const extend = (s: Live, clientX: number, clientY: number) => {
    if (Math.hypot(clientX - s.lx, clientY - s.ly) < MIN_STEP_PX) return;
    const added = addPoint(strokes.current, pointAt(clientX, clientY));
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
    for (const [type, fn] of Object.entries(on)) el.addEventListener(type, fn as EventListener, { passive: type !== 'touchmove' && type !== 'pointerdown' });
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
      can={can} onCan={(c) => { setCan(c); rememberCan(account, c); }} cap={cap} onCap={setCap} tab={tab} onTab={(t) => { setTab(t); setRefusal(null); }}
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
      {p.dockPending ? null : p.dockHost ? createPortal(dock, p.dockHost) : dock}
    </>
  );
}

/** The card's `CardUi.Compose`: the drawing beneath every layer of the post, and the toolbar under the post. */
export function Compose({ post, box, under, submit, cancel, hold, ready, children }: ComposeProps) {
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
  useLayoutEffect(() => { setDockHost(dockHostOf(under) ?? fallback); }, [under, fallback]);
  /* This component is a lazy chunk, so it mounts after the commit that opened the compose, which the engine measured the post in before any dock covered it. The dock
     mounts once its host resolves (the layout effect above sets it, in the same commit pass), and its own layout effect (Toolbar.tsx) sets the root's scroll padding as it
     mounts; that is in place by the time the engine's frame, which this tells to measure again, runs. */
  useEffect(() => { ready(); }, [ready]);

  /* The box is the post body's (the content area the engine marks), the one the wall paints in and Whoops! measures, and not the words' element, which on a one-line post is a strip:
     strokes are shares of the same box before and after Tag it. The words' element sits inside it, so the drawing is offset by where the body begins. */
  const [cell, setCell] = useState<{ w: number; h: number; left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const body = under ? bodyOf(under) : null;
    if (!under || !body) { setCell(null); return undefined; }
    const measure = () => {
      const u = under.getBoundingClientRect(), b = body.getBoundingClientRect();
      const next = { w: body.clientWidth, h: body.clientHeight, left: b.left + body.clientLeft - u.left, top: b.top + body.clientTop - u.top };
      setCell((was) => (was && was.w === next.w && was.h === next.h && was.left === next.left && was.top === next.top ? was : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(measure);
    watch.observe(body);
    watch.observe(under);
    return () => watch.disconnect();
  }, [under, box]);
  const size = cell && cell.w > 0 && cell.h > 0 ? { w: cell.w, h: cell.h } : box && box.w > 0 && box.h > 0 ? box : null;
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    const q = wallDensity(size, dpr);
    canvas.width = Math.ceil(size.w * q);
    canvas.height = Math.ceil(size.h * q);
    const ctx = canvas.getContext('2d');
    if (ctx) paintWall(ctx, size, dpr, draft ? [draft] : NO_ACTS);
  }, [draft, size, dpr]);

  const onBox: CSSProperties = size ? { left: cell ? cell.left : 0, top: cell ? cell.top : 0, width: size.w, height: size.h } : {};
  return (
    <>
      <Marked post={post}>{children}</Marked>
      {under && size && createPortal(<canvas ref={canvasRef} className="kb-graffiti-ink" data-kb-effect-ink aria-hidden="true" style={onBox} />, under)}
      <DrawMode
        box={size} post={post} covered={0 /* a play makes its own wall: a post holds one live wall at a time (stack 1), so a new wall covers nothing; a Draw on a wall that is there is DrawMode with its `covered` */} most={most} dockHost={dockHost} dockPending={dockHost === null} asks={false}
        submit={(first) => submit({}, first)} cancel={cancel} hold={hold} onDraft={setDraft} overlayStyle={onBox} overlayHost={under}
      />
      <div ref={setFallback} className="kb-graffiti-dockhost" />
    </>
  );
}
