/**
 * Autocorrect's effect on a post (docs/plans/2026-11-11-autocorrect-tape-design.md; plan Task 6): masking tape laid over every
 * occurrence of each play's phrase in the post's own words, bearing the caster's replacement in marker.
 *
 * Two layers, one for the eye and one for the line.
 * - **The line.** The post's words are cut at every strip's ends into `wrap` runs (engine/ui/bbcode/layers.tsx), each drawn as a
 *   `span[data-kb-ac-seg]`, so the words stay in the line in their own formatting. At a strip's end the run's `trail` holds the
 *   strip's room: break-spaces, as many as the replacement needs past the words (tape.ts `roomOf`), measured in the formatting
 *   the room sits in. A stack whose footprint fits its line is laid whole (it does not wrap) and moves to the next line as a
 *   long word does; one wider than its line wraps and is cut into pieces. A strip the author peeled before this load gets no
 *   room. While tape covers a segment its words are `aria-hidden` and `data-kb-quotable="hidden"`; at each taped strip's start a
 *   visually hidden anchor stands in the line, named for what its role can do and quoted as the replacement (design section 10).
 * - **The eye.** A `div.dw-ac-tape` over the post draws each live strip as one piece per line it crosses, measured from a Range
 *   over its first segment to its room, with its paper on a canvas drawn when it first comes near the viewport (a plain fill until
 *   then, so the words under it are never seen) and the replacement's words dealt across the pieces (`dealWords`). Under it, one
 *   canvas per post draws the residue of what is peeled, masked to the peeled stretches, with what lay on a lower strip cut out,
 *   its gloss lit by the page's one light as a quiet shine host.
 *
 * Measuring happens on mount, when the post's box resizes, when fonts are ready and when the post has a new version, never per
 * frame and never on a pointer move. Pieces belong to the screen and are never saved; what is saved is in shares of a strip
 * (autocorrect.ts), which each screen cuts at its own line breaks (tape.ts `piecesOf`).
 *
 * **The hands** (hands.ts; design sections 6 to 8). A piece takes a pointer: the author picks an end, pulls, rolls the tape up at
 * the peel line and may tear it; a reader peeks, folding the tape back from an end as a flap in perspective, and everything a
 * reader does lays back down and is never saved. The anchor takes a held key for the same (the author's cannot tear). One
 * animation-frame loop runs while anything is in hand and ticks the state machine with the frame's time; it is idle otherwise.
 * Only the pieces in hand are redrawn: a piece is memoized on its own mask and view, and the residue's films are kept by region and
 * masked to what is peeled as they are laid, so the host is registered once however often what is peeled changes.
 *
 * **Saving.** On every change to an author's stuck model, debounced, the card's state is saved as `{ peeled, clean?, stuck, drops? }` built
 * from the strips' stretches (`sharesOf`, through `fromPieces`): a strip with no stretch left is in `peeled`, and a strip restored whole is in
 * neither. `drops` is where rolls last fell (`dropsOf`), by place, only for the places in `stuck`, and left out when there are none; each screen
 * cuts those shares at its own line breaks (`dropsInPieces`), so an unroll stops where the roll fell. One save is in flight
 * per play, a save that got no answer is sent again, and a refusal puts back only the change it carried.
 *
 * **A play's moment** (`moment` is not null) is the live effect for a reader who is nobody: the tape starts as the author had saved it,
 * every hand is a reader's peek that lays back down, the author's peel and hold are off, and nothing is saved. The effect never reads
 * `still`, which is History's alone.
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { parse } from '../../../../engine/bbcode/parse.ts';
import { forgedList, forgedSet } from '../../../../engine/bbcode/quoted.ts';
import { visibleText } from '../../../../engine/bbcode/visible.ts';
import { TextLayer, type TextRun } from '../../../../engine/ui/bbcode/layers.tsx';
import { LOST_ANSWER, type Answer } from '../../../../engine/ui/data/api.ts';
import type { CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { motionReduced } from '../../../../engine/ui/appearance.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import { bandFor, type Band } from '../../../../engine/ui/shine/band.ts';
import { watchInView } from '../../../../engine/ui/shine/inView.ts';
import { type Light } from '../../../../engine/ui/shine/light.ts';
import { register, unregister, wake, SPAN_MARGIN } from '../../../../engine/ui/shine/loop.ts';
import { seeded } from '../../ui/seeded.ts';
import type { Stretch } from '../autocorrect.ts';
import { economyNow } from '../../../../engine/ui/economy.ts';
import { heldUntil } from '../autocorrect.ts';
import { dropRoll } from './drop.ts';
import { Hands, type HandEvent, type HandSettings, type PieceSpec, type PieceView } from './hands.ts';
import { drawPaper, PAPER, tearJag, type PaperContext } from './paper.ts';
import { facesKey, FOLD_PAD, makeFaces, paintFold, type FoldFaces } from './foldpaint.ts';
import { savedAfterPeel } from './peel.ts';
import { fibersAt, filmAlpha, filmSize, GLOSS_ALPHA, GLOSS_STOPS, glossAt, RESIDUE_TINT, residueInk } from './residue.ts';
import { dealWords, dropsInPieces, exposed, flapOf, piecesOf, rollDiameter, roomOf, stripsOf, stuckOf, type Measure, type SavedTape, type TapeStrip } from './tape.ts';
import './autocorrect.css';

/** A pending pick's hand moves past this many px and the press is a peek instead; the corner waits this long into a still hold (feel design, section 1). */
const SLOP = 8;
const CORNER_DELAY_MS = 150;
/** The numbers the hands read from the card's settings when the instance has not set them (autocorrect.ts `screenReads`). */
const DEFAULTS = { pace: 90, pickMs: 1000, give: 34, peekStayMs: 300, peekSettle: 300 } as const;
/** What a screen reader hears when a strip is pressed under another. */
const COVERED = 'Another strip is stuck over this one. That one comes off first.';
/** The buzz of a pick that is up, on the author's own phone: two short pulses (the owner's pick). */
const BUZZ = [10, 40, 10];
/** What a key pick says, where a hand feels the buzz. */
const PICKED = 'Picked. Keep holding to peel.';
const NOTHING_BACK = 'Nothing to press back down.';
/** What a held key asks of the hands. */
type KeyMode = 'peek' | 'peel' | 'unroll';
const SAVE_AFTER_MS = 400;
const RETRY_AFTER_MS = 1500;
const MAX_SAVE_RETRIES = 3;
/** The marker's size against the board's text size, and the bench's extra 2%. */
const MARKER = 1.3 * 1.02;
/** The padding on each side of a piece's writing, against the board's text size. */
const PAD_EM = 0.35;
/** The side of a cell in the grid that finds the boxes near a box, in pixels. */
const CELL = 64;
/** The most pixels the residue's one canvas holds. */
const MOST_RESIDUE_PIXELS = 4_000_000;

/** The Lens's ends (design section 12), the glass's plain words, kept where a test can read them. */
export const LENS = Object.freeze({
  readerEnds: 'Lift a strip by one end to read under it; it lays back down. Only the post\'s author can peel strips off for good.',
  authorEnds: 'Drag a strip by one end to read under it; it lays back down. To peel it off for good, hold one end still until the corner lifts, then pull slowly. Pull too fast and it tears. Push a roll back to stick the tape down again.',
  authorHeld: (left: string) => `Stuck on for ${left}. Until then, drag a strip by one end to read under it. After that you can peel strips off for good: hold one end still until the corner lifts, then pull slowly.`,
});

/** How long a hold has left, rounded up to the minute: "5h 12m", "12m", or "less than a minute". */
function left(ms: number): string {
  if (ms < 60_000) return 'less than a minute';
  const minutes = Math.ceil(ms / 60_000);
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}

/** What a saved state names: the places peeled whole, the stretches still stuck of those half peeled, and where rolls fell on those. Anything else is none. */
function savedOf(state: unknown): SavedTape {
  const own = state as { peeled?: unknown; stuck?: unknown; drops?: unknown } | null | undefined;
  const peeled = Array.isArray(own?.peeled) ? own.peeled.filter((n): n is number => Number.isSafeInteger(n) && n >= 0) : [];
  const stuck: Record<string, Stretch[]> = {};
  if (own?.stuck && typeof own.stuck === 'object') {
    for (const [place, list] of Object.entries(own.stuck as Record<string, unknown>)) {
      if (!Array.isArray(list) || peeled.includes(Number(place))) continue;
      const kept = list.filter((s): s is Stretch => Array.isArray(s) && s.length === 3 && s.every((n) => typeof n === 'number' && Number.isFinite(n)));
      if (kept.length) stuck[place] = kept;
    }
  }
  const drops: Record<string, number[]> = {};
  if (own?.drops && typeof own.drops === 'object') {
    for (const [place, list] of Object.entries(own.drops as Record<string, unknown>)) {
      if (!Object.hasOwn(stuck, place) || !Array.isArray(list)) continue;
      const kept = list.filter((n): n is number => typeof n === 'number' && n >= 0 && n <= 1);
      if (kept.length) drops[place] = kept;
    }
  }
  return Object.keys(stuck).length ? { peeled, stuck, ...(Object.keys(drops).length ? { drops } : {}) } : { peeled };
}

/** A box in CSS pixels, from the post's top left. */
interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
/** A strip as this screen laid it: a box for each line it crosses, the writing dealt across them and the marker's scale. */
interface Laid { readonly boxes: readonly Box[]; readonly words: readonly string[]; readonly scale: number }
interface Layout { readonly w: number; readonly base: number; readonly strips: Readonly<Record<string, Laid>> }
type Rooms = Readonly<Record<string, number>>;

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One text ruler: a canvas context when there is one, else half an em a letter. */
function rulerOf(): (font: string, text: string) => number {
  let ctx: CanvasRenderingContext2D | null = null;
  try { ctx = document.createElement('canvas').getContext('2d'); } catch { ctx = null; }
  return (font, text) => {
    if (!ctx) return text.length * 0.5 * Number(/(\d+(?:\.\d+)?)px/u.exec(font)?.[1] ?? 16);
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

/** The font an element's words are drawn in, as the canvas reads it. */
function fontOf(el: Element): string {
  const s = getComputedStyle(el);
  return `${s.fontStyle || 'normal'} ${s.fontWeight || '400'} ${Number.parseFloat(s.fontSize) || 16}px ${s.fontFamily || 'serif'}`;
}

interface Rect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

/** A strip's rects joined into one box per line: rects that share most of a line's height are one line. */
function linesOf(rects: readonly Rect[], host: { readonly left: number; readonly top: number }): Box[] {
  const lines: { l: number; t: number; r: number; b: number }[] = [];
  for (const q of [...rects].filter((r) => r.right - r.left > 1 && r.bottom - r.top > 1).sort((a, b) => a.top - b.top || a.left - b.left)) {
    const line = lines.find((n) => Math.min(q.bottom, n.b) - Math.max(q.top, n.t) > 0.5 * Math.min(q.bottom - q.top, n.b - n.t));
    if (line) { line.l = Math.min(line.l, q.left); line.r = Math.max(line.r, q.right); line.t = Math.min(line.t, q.top); line.b = Math.max(line.b, q.bottom); }
    else lines.push({ l: q.left, t: q.top, r: q.right, b: q.bottom });
  }
  return lines.map((n) => ({ x: n.l - host.left, y: n.t - host.top, w: n.r - n.l, h: n.b - n.t }));
}

/** The stretches of `[0, w]` that are not in `stuck`: what is peeled, in a piece's local pixels. */
function peeledOf(stuck: readonly Stretch[], w: number): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const [lo, hi] of [...stuck].sort((a, b) => a[0] - b[0])) {
    if (lo - at > 0.5) out.push([at, lo]);
    at = Math.max(at, hi);
  }
  if (w - at > 0.5) out.push([at, w]);
  return out;
}

/** A piece's mask: its stuck stretches opaque, the rest clear. None for a whole piece. */
function maskOf(stuck: readonly Stretch[], w: number): string | undefined {
  if (stuck.length === 1 && stuck[0]![0] <= 0.5 && stuck[0]![1] >= w - 0.5) return undefined;
  const stops: string[] = [];
  let at = 0;
  for (const [lo, hi] of [...stuck].sort((a, b) => a[0] - b[0])) {
    stops.push(`transparent ${at}px ${lo}px`, `#000 ${lo}px ${hi}px`);
    at = hi;
  }
  stops.push(`transparent ${at}px ${Math.max(at, w)}px`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** A piece's outline where an end of a stretch is a tear: ragged, cut as the bench cuts it. Undefined when no end is torn. */
function tornPath(stuck: readonly Stretch[], h: number, seed: string): string | undefined {
  if (!stuck.some((s) => Math.floor(s[2] / 3) === 2 || s[2] % 3 === 2)) return undefined;
  const jag = (at: number) => tearJag(seed, at, h);
  const shape = stuck.map(([lo, hi, edges]) => {
    const left: readonly (readonly [number, number])[] = Math.floor(edges / 3) === 2 ? jag(lo) : [[lo, 0], [lo, h]];
    const right: readonly (readonly [number, number])[] = edges % 3 === 2 ? jag(hi) : [[hi, 0], [hi, h]];
    return `M ${[...left, ...[...right].reverse()].map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} Z`;
  });
  return `path('${shape.join(' ')}')`;
}

/** Where a piece's stretches are torn inside it, in its local pixels: the torn fibers lie there on the residue. */
const tearsOf = (stuck: readonly Stretch[], w: number): number[] => stuck.flatMap(([lo, hi, edges]) => [
  ...(Math.floor(edges / 3) === 2 && lo > 0.5 && lo < w - 0.5 ? [lo] : []),
  ...(edges % 3 === 2 && hi > 0.5 && hi < w - 0.5 ? [hi] : []),
]);

/** What one strip lets the Lens count: its stuck length and whether the author has begun on it. */
const isWhole = (stuck: readonly Stretch[]) => stuck.length === 1 && stuck[0]![0] === 0 && stuck[0]![1] === 1;

/** A piece with nothing in hand: no rolls, no strain, no corner, no flap. */
const NONE: readonly Stretch[] = [];
const NONE_DROPS: readonly number[] = [];
const IDLE: PieceView = { stuck: [], shown: [], rolls: [], strain: null, corner: null, lift: null };

interface AnchorProps {
  readonly strip: TapeStrip;
  readonly author: boolean;
  readonly open: boolean;
  /** A key goes down on (or comes up from) the anchor. */
  readonly onKey: (strip: TapeStrip, down: boolean, mode?: KeyMode, which?: string) => void;
  readonly onFocus: (key: string | null) => void;
  /** The author's hold on the strip's play, as time left in words; absent when none runs. */
  readonly heldLeft?: string;
}

/**
 * A taped strip's anchor, in the line at the start of its words: visually hidden, focusable, named for the role, quoted as the
 * replacement. Not in the tab order while another strip lies over it. A held Enter or Space is the hands' keyboard path: the author's
 * pick then peel at pace (it cannot tear), a reader's lift at a piece's width every 0.45 seconds.
 */
function Anchor({ strip, author, open, onKey, onFocus, heldLeft }: AnchorProps) {
  const name = author && heldLeft !== undefined
    ? `Autocorrected text: “${strip.replacement}”. Stuck on for ${heldLeft}. Hold Enter or Space to lift it and read under it`
    : author
      ? `Autocorrected text: “${strip.replacement}”. Hold Enter or Space to lift it and read under it. Hold Shift with Enter or Space to peel it off for good. Hold Backspace to press a started peel back down.`
      : `Autocorrected text: “${strip.replacement}”. Hold Enter or Space to lift it and read under it`;
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const press = e.key === 'Enter' || e.key === ' ';
    /* Backspace is the author's unroll, out of the hold; for anyone else it is left alone, so the browser's own use of it stands. */
    if (!press && !(e.key === 'Backspace' && author && heldLeft === undefined)) return;
    e.preventDefault();
    if (e.repeat) return;
    onKey(strip, true, e.key === 'Backspace' ? 'unroll' : e.shiftKey && author && heldLeft === undefined ? 'peel' : 'peek', e.key);
  };
  return (
    <button
      type="button" className="kb-visually-hidden dw-ac-anchor" data-kb-ac-anchor={strip.key} data-kb-quotable={open ? 'shown' : 'hidden'}
      tabIndex={open ? 0 : -1} aria-label={name}
      onKeyDown={onKeyDown} onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Backspace') onKey(strip, false, undefined, e.key); }}
      onFocus={() => onFocus(strip.key)} onBlur={() => { onKey(strip, false); onFocus(null); }}
    >{strip.replacement}</button>
  );
}

/** What a piece's pointer handlers need: which piece, and the event. */
type PieceHandler = (e: PointerEvent<HTMLElement>, id: string) => void;

interface PieceProps {
  readonly strip: TapeStrip;
  readonly index: number;
  readonly box: Box;
  readonly words: string;
  readonly fontPx: number;
  readonly pad: number;
  /** The mask over what is stuck (less what a peek has lifted), and the ragged outline where an end is torn. */
  readonly own: readonly Stretch[];
  readonly mask: string | undefined;
  readonly clip: string | undefined;
  /** The stuck stretches in local pixels, for anyone reading the page. */
  readonly stuck: string;
  readonly focused: boolean;
  readonly view: PieceView;
  readonly shake: boolean;
  readonly onDown: PieceHandler;
  readonly onMove: PieceHandler;
  readonly onUp: PieceHandler;
}

/**
 * One piece of tape over one line: a plain paper fill until its canvas is drawn (when it first comes near the viewport), the marker's
 * words on it, and what the hands do to it: the roll at a peel line, the paper whitening where the hand strains it, a corner lifting
 * as an end is picked, and a peek's flap hinged at the fold, turned up in perspective with its sticky side showing. The tape's
 * body takes the mask; the roll, the corner and the flap sit beside it so the mask never clips them.
 */
const Piece = memo(function Piece({ strip, index, box, words, fontPx, pad, own, mask, clip, stuck, focused, view, shake, onDown, onMove, onUp }: PieceProps) {
  const div = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tilt = useMemo(() => ((seeded(strip.key)() - 0.5) * 2.4).toFixed(2), [strip.key]);
  const seed = `${strip.key}:${index}`;
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return undefined;
    let drawn = false;
    const stop = watchInView(cv, (inView) => {
      if (!inView || drawn) return;
      drawn = true;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      cv.width = Math.ceil(box.w * dpr);
      cv.height = Math.ceil(box.h * dpr);
      ctx.scale(dpr, dpr);
      drawPaper(ctx as unknown as PaperContext, box.w, box.h, seed);
      div.current?.setAttribute('data-kb-ac-drawn', '');
    }, { rootMargin: `${SPAN_MARGIN}px 0px` });
    return () => { stop(); div.current?.removeAttribute('data-kb-ac-drawn'); };
  }, [box.w, box.h, seed]);
  const style = { left: box.x, top: box.y, width: box.w, height: box.h, zIndex: strip.z + 1, '--dw-ac-tilt': `${tilt}deg` } as CSSProperties;
  /* The corner's fold: its two faces are made when a pick is first shown and kept while it is held, so a frame of the pick is two image draws. */
  const foldCanvas = useRef<HTMLCanvasElement>(null);
  const faces = useRef<FoldFaces | null>(null);
  const [folded, setFolded] = useState(false);
  const corner = view.corner;
  useLayoutEffect(() => {
    const cv = foldCanvas.current;
    if (!corner || !cv) { faces.current = null; setFolded(false); return; }
    try {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const spec = { w: box.w, h: box.h, seed, words, fontPx, pad, dpr, font: document.fonts?.check?.('1em "Gochi Hand"') ?? true };
      if (faces.current?.key !== facesKey(spec)) faces.current = makeFaces(spec);
      /* Sized only when its size changes: assigning a canvas's size reallocates its backing store, and a pick repaints on every tick. */
      const [cw, ch] = [Math.ceil((box.w + 2 * FOLD_PAD) * dpr), Math.ceil((box.h + 2 * FOLD_PAD) * dpr)];
      if (cv.width !== cw) cv.width = cw;
      if (cv.height !== ch) cv.height = ch;
      /* The body's paper goes only once a fold is on its canvas, so a piece that cannot draw one keeps its paper. */
      setFolded(faces.current !== null && paintFold(cv, faces.current, { w: box.w, h: box.h, side: corner.side, at: corner.at, t: corner.t, stuck: own, dpr }));
    } catch {
      /* A paint that threw may have left half a fold: clear it, so the body shown again is not under one. */
      try { cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height); } catch { /* nothing more to clear */ }
      setFolded(false);
    }
  }, [corner, box.w, box.h, seed, words, fontPx, pad, own]);
  const strain = view.strain;
  const at = strain ? (strain.side === 'a' ? (strain.at / box.w) * 100 : 100 - (strain.at / box.w) * 100) : 0;
  const body = {
    ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : null),
    ...(clip ? { clipPath: clip } : null),
    ...(folded && corner ? { visibility: 'hidden' } : null),
    ...(strain ? { '--dw-ac-stretch': `linear-gradient(${strain.side === 'a' ? 90 : 270}deg, transparent ${(at - 0.1).toFixed(1)}%, rgb(255 255 255 / ${(strain.amount * 0.6).toFixed(2)}) ${at.toFixed(1)}%, transparent ${(at + 22).toFixed(1)}%)` } : null),
  } as CSSProperties;
  const flap = view.lift && view.lift.lift > 0.5 ? view.lift : null;
  const hinge = flap ? flapOf(flap.lift, box.w, box.h) : null;
  const handlers = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => onDown(e, `${strip.key}:${index}`),
    onPointerMove: (e: PointerEvent<HTMLElement>) => onMove(e, `${strip.key}:${index}`),
    onPointerUp: (e: PointerEvent<HTMLElement>) => onUp(e, `${strip.key}:${index}`),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => onUp(e, `${strip.key}:${index}`),
    onLostPointerCapture: (e: PointerEvent<HTMLElement>) => onUp(e, `${strip.key}:${index}`),
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
  return (
    <div ref={div} className="dw-ac-piece" style={style} data-kb-ac-piece={strip.key} data-kb-ac-line={index} data-kb-ac-stuck={stuck} data-kb-focus={focused ? 'true' : undefined} {...handlers}>
      <div className="dw-ac-body" style={body} data-tension={strain ? '' : undefined}>
        <canvas ref={canvas} className="dw-ac-paper" style={{ width: box.w, height: box.h }} />
        {words ? <span className="dw-ac-clip"><span className="dw-ac-ink" style={{ fontSize: fontPx, left: pad }}>{words}</span></span> : null}
      </div>
      {own.map(([lo, hi], k) => {
        /* Only the tape still stuck, and the grip at its ends, takes a pointer: the peeled part leaves the post's words and links alone. */
        const grip = Math.max(16, 0.9 * box.h), left = Math.max(0, lo - grip), right = Math.min(box.w, hi + grip);
        return <div key={k} className="dw-ac-hit" data-kb-ac-hit="" style={{ left, width: right - left }} />;
      })}
      {view.rolls.map((r) => {
        const d = rollDiameter(r.rolled);
        const shaking = r.live && shake && strain !== null && strain.amount > 0.15;
        return (
          <div
            key={r.side} className="dw-ac-roll" data-kb-ac-roll={r.live ? 'live' : 'waiting'} data-shaking={shaking ? '' : undefined}
            style={{ left: r.side === 'a' ? r.x - d * 0.72 : r.x - d * 0.28, width: d, ...(shaking ? { '--dw-ac-shake': `${(strain.amount * 0.8).toFixed(2)}px` } : null) } as CSSProperties}
          />
        );
      })}
      {view.corner ? <canvas ref={foldCanvas} className="dw-ac-fold" data-kb-ac-fold="" style={{ left: -FOLD_PAD, top: -FOLD_PAD, width: box.w + 2 * FOLD_PAD, height: box.h + 2 * FOLD_PAD }} /> : null}
      {flap && hinge ? (
        <div
          className="dw-ac-flap" data-kb-ac-flap={flap.side}
          style={{
            left: flap.side === 'a' ? flap.fold - flap.lift : flap.fold, width: flap.lift, transformOrigin: flap.side === 'a' ? 'right center' : 'left center',
            transform: `perspective(${hinge.perspective.toFixed(0)}px) rotateY(${(flap.side === 'a' ? hinge.theta : -hinge.theta).toFixed(1)}deg)`,
            '--dw-ac-fold': flap.side === 'a' ? '90deg' : '270deg',
          } as CSSProperties}
        />
      ) : null}
    </div>
  );
});

/** A residue film's footprint in one piece: what is peeled of it, what lay on a lower strip and is cut out, and where it is torn, all in the piece's local pixels. */
interface Region {
  readonly key: string;
  readonly seed: string;
  readonly box: Box;
  readonly peeled: readonly [number, number][];
  readonly cut: readonly Box[];
  readonly tears: readonly number[];
}

/** One piece of a strip as drawn: its stuck stretches in local pixels, their mask and torn outline, and the attribute that says them. */
interface DrawnPiece { readonly own: readonly Stretch[]; readonly mask: string | undefined; readonly clip: string | undefined; readonly attr: string }
/** What a strip's drawing and hands need, made for one set of stretches, one layout and one set of live strips. */
interface Drawn {
  readonly src: readonly Stretch[];
  readonly drops: readonly number[];
  readonly laid: Layout;
  readonly live: readonly TapeStrip[];
  readonly held: boolean;
  readonly pieces: readonly DrawnPiece[];
  readonly regions: readonly Region[];
  readonly specs: readonly PieceSpec[];
}

/** One scratch canvas the films are colored on. */
let scratch: HTMLCanvasElement | null = null;

/** A film, 1 where it is thick, as white with that alpha, with what lay on a lower strip cut out. What is peeled is applied as it is laid, so a film lives as long as its piece does. */
function buildFilm(r: Region): HTMLCanvasElement | null {
  const { cols, rows } = filmSize(r.box.w, r.box.h);
  const film = document.createElement('canvas');
  film.width = cols;
  film.height = rows;
  const c = film.getContext('2d');
  if (!c) return null;
  const alpha = filmAlpha(r.box.w, r.box.h, r.seed);
  const img = c.createImageData(cols, rows);
  for (let i = 0; i < alpha.length; i++) { img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = Math.round(alpha[i]! * 255); }
  c.putImageData(img, 0, 0);
  const sx = cols / Math.max(1, r.box.w), sy = rows / Math.max(1, r.box.h);
  c.globalCompositeOperation = 'destination-out';
  for (const q of r.cut) c.fillRect(q.x * sx, q.y * sy, q.w * sx, q.h * sy);
  return film;
}

/** A film in one color, masked to what is peeled, drawn onto `ctx` at its region's place (`top` is the canvas's top in the post). */
function lay(ctx: CanvasRenderingContext2D, film: HTMLCanvasElement, color: string | ((s: CanvasRenderingContext2D, sx: number) => CanvasGradient), alpha: number, r: Region, top: number): void {
  scratch ??= document.createElement('canvas');
  scratch.width = film.width;
  scratch.height = film.height;
  const s = scratch.getContext('2d');
  if (!s) return;
  s.drawImage(film, 0, 0);
  s.globalCompositeOperation = 'source-in';
  const sx = film.width / Math.max(1, r.box.w);
  s.fillStyle = typeof color === 'function' ? color(s, sx) : color;
  s.fillRect(0, 0, film.width, film.height);
  s.globalCompositeOperation = 'destination-in';
  s.beginPath();
  for (const [lo, hi] of r.peeled) s.rect(lo * sx, 0, (hi - lo) * sx, film.height);
  s.fill();
  ctx.globalAlpha = alpha;
  ctx.drawImage(scratch, r.box.x, r.box.y - top, r.box.w, r.box.h);
}

/** `#rrggbb` at `alpha`, as a canvas color. */
const withAlpha = (hex: string, alpha: number) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')},${alpha})`;

/**
 * The gloss as a radial gradient on the scratch: centered where the light is over the post, in the region's film pixels, bright at
 * the middle and clear from 72% of its reach out. Filled `source-in`, so it shows only where the film is.
 */
function glossGradient(s: CanvasRenderingContext2D, at: { x: number; y: number; r: number }, color: string, r: Region, top: number, sx: number): CanvasGradient {
  const g = s.createRadialGradient((at.x - r.box.x) * sx, (at.y - (r.box.y - top)) * sx, 0, (at.x - r.box.x) * sx, (at.y - (r.box.y - top)) * sx, at.r * sx);
  for (const [at01, a] of GLOSS_STOPS) g.addColorStop(at01, withAlpha(color, a));
  return g;
}

/** The torn fibers a tear leaves, as short pale strokes on the film (residue.ts `fibersAt`). */
function layFibers(ctx: CanvasRenderingContext2D, r: Region, top: number, color: string): void {
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (const x of r.tears) {
    for (const f of fibersAt(r.seed, x, r.box.h)) {
      ctx.lineWidth = f.width;
      ctx.beginPath();
      ctx.moveTo(r.box.x + f.x0, r.box.y - top + f.y0);
      ctx.quadraticCurveTo(r.box.x + f.cx, r.box.y - top + f.cy, r.box.x + f.x1, r.box.y - top + f.y1);
      ctx.stroke();
    }
  }
}

interface ResidueProps {
  readonly regions: readonly Region[];
  /** The canvas's rows in the post: every strip's footprint, so it does not change while something is peeled. */
  readonly span: { readonly top: number; readonly height: number };
  readonly width: number;
  readonly host: React.RefObject<HTMLElement | null>;
}

/**
 * The residue of every peeled stretch on the post, on one canvas: a tint in the tape's torn outline and a gloss the page's light
 * moves over it, both held inside the board's readable band, and the fibers of every tear. The canvas rides the shine loop as a
 * quiet host at half the rate, so it draws only while in view and never brings up the tilt tip.
 *
 * The host is registered once for the canvas's size: the regions are read from a ref as they are painted, so a change in what is
 * peeled only asks for a draw. A film is kept by its region (strip and piece, size and cut), built when first painted, and masked to
 * what is peeled as it is laid, so a peel in hand redraws its own piece and rebuilds no film.
 */
function Residue({ regions, span, width, host }: ResidueProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const token = useRef({});
  const current = useRef(regions);
  current.current = regions;
  const redraw = useRef<(() => void) | null>(null);
  const { top, height } = span;
  useEffect(() => {
    const cv = canvas.current;
    const el = host.current;
    if (!cv || !el) return undefined;
    const ctx = cv.getContext('2d');
    if (!ctx) return undefined;
    const films = new Map<string, HTMLCanvasElement | null>();
    /* The band where the post sits, or null when the board's tokens cannot be read (nothing is drawn then). */
    const readBand = (): Band | null => { try { return bandFor(el); } catch (err) { console.error(err); return null; } };
    let band = readBand();
    const area = Math.max(1, width * height);
    let density = Math.min(2, window.devicePixelRatio || 1);
    if (area * density * density > MOST_RESIDUE_PIXELS) density = Math.max(0.5, Math.sqrt(MOST_RESIDUE_PIXELS / area));
    const size = () => { cv.width = Math.ceil(width * density); cv.height = Math.ceil(height * density); };
    /* What was painted last, by region: a draw asked for by a change in what is peeled repaints only the regions that changed. */
    let painted = new Map<string, Region>();
    let pending = false;
    const meets = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const paint = (light: Light, onlyChanged: boolean) => {
      if (cv.width !== Math.ceil(width * density)) { size(); painted = new Map(); }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      const now = current.current;
      let todo: readonly Region[] = now;
      let clip: Box[] | null = null;
      if (onlyChanged && painted.size) {
        const keys = new Set(now.map((r) => r.key));
        clip = [...now.filter((r) => painted.get(r.key) !== r), ...[...painted.values()].filter((r) => !keys.has(r.key))].map((r) => r.box);
        todo = now.filter((r) => clip!.some((b) => meets(b, r.box)));
      } else ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(density, 0, 0, density, 0, 0);
      painted = new Map(now.map((r) => [r.key, r]));
      if (clip) {
        ctx.save();
        ctx.beginPath();
        for (const b of clip) { ctx.clearRect(b.x, b.y - top, b.w, b.h); ctx.rect(b.x, b.y - top, b.w, b.h); }
        ctx.clip();
      }
      if (band) {
        const ink = residueInk(band, light);
        for (const r of todo) {
          const id = `${r.key}|${r.box.w}|${r.box.h}|${JSON.stringify(r.cut)}`;
          if (!films.has(id)) films.set(id, buildFilm(r));
          const film = films.get(id);
          if (!film) continue;
          lay(ctx, film, ink.tint, RESIDUE_TINT[band.board], r, top);
          lay(ctx, film, (s, sx) => glossGradient(s, glossAt(light, { w: width, h: height }), ink.gloss, r, top, sx), GLOSS_ALPHA[band.board], r, top);
          layFibers(ctx, r, top, ink.gloss);
        }
      }
      if (clip) ctx.restore();
      ctx.globalAlpha = 1;
    };
    const me = token.current;
    density = register(me, cv, { w: width, h: height }, density, (frame) => { paint(frame.light, pending && !frame.moved && !frame.idle); pending = false; return false; }, { quiet: true, share: 0.5, hidden: () => { films.clear(); painted = new Map(); cv.width = 0; cv.height = 0; } });
    size();
    redraw.current = () => { pending = true; wake(me); };
    const board = typeof MutationObserver === 'function' ? new MutationObserver(() => { band = readBand(); wake(me); }) : null;
    board?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-kb-mode', 'data-kb-effects'] });
    return () => { redraw.current = null; board?.disconnect(); unregister(me); films.clear(); };
  }, [width, top, height, host]);
  /* What is peeled changed: ask for a draw, which reads the regions as they are now. */
  useLayoutEffect(() => { redraw.current?.(); }, [regions]);
  return <canvas ref={canvas} className="dw-ac-residue" style={{ top, width, height }} />;
}

/** The author's changes on their way to being saved, by play and place: the stretches still stuck and where rolls fell, none once the strip is peeled. */
interface Entry { readonly shares: readonly Stretch[]; readonly drops: readonly number[] }
type Local = Readonly<Record<string, Readonly<Record<string, Entry>>>>;

export function AutocorrectEffect({ post, plays, states, reader, moment, save, show, met, children }: EffectProps) {
  const { settings, instance } = useKayfa();
  /* Only a live post's author peels for good and holds the tape on: in a moment, whoever the reader is, a hand is a peek that lays back. */
  const author = reader.author && moment === null;
  const body = typeof post.currentPayload.body === 'string' ? post.currentPayload.body : '';
  /* A forged quote (the Act's verdict) is a counterfeit, so its words are the poster's own and count (forged-quotes design, section 1). */
  const forged = forgedList(post.currentPayload);
  const text = useMemo(() => visibleText(parse(body, undefined, forgedSet(forged))), [body, forged]);
  /* The author's changes on their way to being saved; a refused save's words, by play; what the last peel uncovered or the last press said. */
  const [local, setLocal] = useState<Local>({});
  const [refusals, setRefusals] = useState<Readonly<Record<string, string>>>({});
  const [uncovered, setUncovered] = useState('');
  const [focused, setFocused] = useState<string | null>(null);
  /* A frame of the hands: the pieces in hand are drawn again. */
  const [, setFrame] = useState(0);
  const report = Object.values(refusals).filter(Boolean).join(' ');
  const box = useRef<HTMLDivElement>(null);

  const configs = useMemo(() => plays.flatMap((p) => {
    const { phrase, replacement } = p.config as { phrase?: unknown; replacement?: unknown };
    return !p.caught && typeof phrase === 'string' && typeof replacement === 'string' ? [{ id: p.id, phrase, replacement }] : [];
  }), [plays]);
  /* The plays by content, so a new array of equal plays is not a new set of plays. */
  const configsKey = JSON.stringify(configs);
  const { strips, stacks, total } = useMemo(() => stripsOf(text, configs), [text, configsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* What was peeled before this load keeps no room (design section 1); what is peeled during the visit keeps its footprint until the next. */
  const [loaded] = useState<ReadonlySet<string>>(() => new Set(configs.flatMap((c) => savedOf(states[c.id]?.state).peeled.map((i) => `${c.id}:${i}`))));

  /* Each strip's saved stretches still stuck, the whole strip if untouched: made when the saved state changes, never per frame. */
  const savedStuck = useMemo(() => {
    const out = new Map<string, readonly Stretch[]>();
    for (const c of configs) {
      const saved = savedOf(states[c.id]?.state);
      for (const s of strips) if (s.play === c.id) out.set(s.key, stuckOf(saved, s.index));
    }
    return out;
  }, [configs, states, strips]);
  /* A strip's stretches still stuck: the author's change on its way if there is one, else the saved ones. The array is the same while the strip is. */
  const stuckFor = (s: TapeStrip): readonly Stretch[] => local[s.play]?.[s.index]?.shares ?? savedStuck.get(s.key) ?? NONE;
  /* Where a strip's rolls last fell, in shares: the author's change on its way if there is one, else the saved ones. */
  const savedDrops = useMemo(() => {
    const out = new Map<string, readonly number[]>();
    for (const c of configs) {
      const saved = savedOf(states[c.id]?.state);
      for (const s of strips) if (s.play === c.id && !saved.peeled.includes(s.index)) { const d = saved.drops?.[String(s.index)]; if (d) out.set(s.key, d); }
    }
    return out;
  }, [configs, states, strips]);
  const dropsFor = (s: TapeStrip): readonly number[] => local[s.play]?.[s.index]?.drops ?? savedDrops.get(s.key) ?? NONE_DROPS;
  /* The strips with tape left, by key, so a peel in hand (which changes a strip's stretches every frame) does not change what is live. */
  const liveKey = strips.filter((s) => stuckFor(s).length > 0).map((s) => s.key).join('|');
  const live = useMemo(() => { const keys = new Set(liveKey ? liveKey.split('|') : []); return strips.filter((s) => keys.has(s.key)); }, [strips, liveKey]);
  const liveKeys = useMemo(() => new Set(live.map((s) => s.key)), [live]);

  /*
   * The author's hold (the design's section 4): each play's tape is stuck on, for the author, until its hold ends. The clock is a
   * state only the author's screen keeps, and only while a live strip is held: it moves on each minute, and once at the moment the
   * latest hold ends. A reader's screen, and an author's with no hold running, sets no timer.
   */
  /* The economy as the server holds it now over the compiled one: a screen that has not read the server's holds the compiled hours. */
  const economy = useMemo(() => ({ economy: economyNow(instance.settings, settings.economy) }), [instance, settings.economy]);
  const holds = useMemo(() => new Map(plays.map((p) => [p.id, heldUntil(economy, p.playedAt)?.getTime()] as const)), [plays, economy]);
  const [clock, setClock] = useState(() => Date.now());
  const heldAt = (s: TapeStrip): number | undefined => {
    const until = author ? holds.get(s.play) : undefined;
    return until !== undefined && until > clock ? until : undefined;
  };
  const heldLeft = (s: TapeStrip): string | undefined => { const until = heldAt(s); return until === undefined ? undefined : left(until - clock); };
  const latestHold = live.reduce((m, s) => Math.max(m, heldAt(s) ?? 0), 0);
  useEffect(() => {
    if (!latestHold) return;
    const wait = Math.max(0, Math.min(60_000, latestHold - Date.now()));
    const t = setTimeout(() => setClock(Date.now()), wait);
    return () => clearTimeout(t);
  }, [latestHold, clock]);

  /*
   * The author's changes, saved as Whoops!'s strokes are: debounced, one save on its way per play at a time, what changes meanwhile
   * sent after it, a save that got no answer sent again a little later each time and given up on after a few, and a refusal said,
   * with what it carried put back, since it would be the same again. Each save is the whole state (the places peeled, and the
   * stretches still stuck of those half peeled), so sending it twice is the same as once. A strip with no stretch left is in `peeled`.
   */
  const now = useRef({ states, total, save, local, cards: settings.cardSettings });
  now.current = { states, total, save, local, cards: settings.cardSettings };
  const inFlight = useRef(new Set<string>());
  const dirty = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /* Once the post has gone nothing is set and nothing retried, as Whoops! does; a change still waiting on its debounce is sent at once. */
  const gone = useRef(false);
  const sentStuck = useRef(new Set<string>());
  const flush = useCallback(async (play: string, attempt = 0): Promise<void> => {
    if (inFlight.current.has(play)) { dirty.current.add(play); return; }
    dirty.current.delete(play);
    timers.current.delete(play);
    const batch = { ...(now.current.local[play] ?? {}) };
    const held = savedOf(now.current.states[play]?.state);
    const places = new Set(held.peeled);
    const stuck: Record<string, readonly Stretch[]> = { ...(held.stuck ?? {}) };
    const drops: Record<string, readonly number[]> = { ...(held.drops ?? {}) };
    for (const [key, { shares, drops: fell }] of Object.entries(batch)) {
      if (held.peeled.includes(Number(key))) continue;
      delete drops[key];
      if (!shares.length) { places.add(Number(key)); delete stuck[key]; }
      else if (isWhole(shares)) delete stuck[key];
      else { stuck[key] = shares; if (fell.length) drops[key] = fell; }
    }
    /* Drops are kept only for the places still in `stuck` (the card refuses any other). */
    for (const key of Object.keys(drops)) if (!Object.hasOwn(stuck, key)) delete drops[key];
    const peeled = [...places].sort((a, b) => a - b);
    /* Nothing peeled and nothing stuck: a play never touched saves nothing, but one saved half-peeled and unrolled whole is the play as it landed, and says so. */
    if (!peeled.length && !Object.keys(stuck).length && !Object.keys(held.stuck ?? {}).length && !sentStuck.current.has(play)) return;
    const kept = peeled.length ? savedAfterPeel(peeled, peeled[peeled.length - 1]!, now.current.total[play] ?? 0) : { peeled };
    const state = Object.keys(stuck).length ? { ...kept, stuck, ...(Object.keys(drops).length ? { drops } : {}) } : kept;
    /* What this session has sent for the play, so a whole result after a half peel still goes out while that save's state has not come back. */
    const hadSent = sentStuck.current.has(play);
    if (Object.keys(stuck).length) sentStuck.current.add(play); else sentStuck.current.delete(play);
    inFlight.current.add(play);
    let answer: Answer<unknown>;
    try {
      answer = await now.current.save(play, state);
    } catch {
      answer = { ok: false, error: LOST_ANSWER, uncertain: true };
    }
    inFlight.current.delete(play);
    if (answer.ok) {
      if (!gone.current) setRefusals((was) => (was[play] ? { ...was, [play]: '' } : was));
      if (dirty.current.has(play)) await flush(play);
      return;
    }
    if (gone.current) return;
    if (answer.uncertain && attempt < MAX_SAVE_RETRIES) {
      timers.current.set(play, setTimeout(() => { void flush(play, attempt + 1); }, RETRY_AFTER_MS * 2 ** attempt));
      return;
    }
    dirty.current.delete(play);
    /* The server never held what this save carried, so it is not owed an undo of it. */
    if (hadSent) sentStuck.current.add(play); else sentStuck.current.delete(play);
    setRefusals((was) => ({ ...was, [play]: answer.error }));
    /* Only what this save carried comes back; a strip changed since waits for its own save. */
    setLocal((was) => {
      const mine = { ...(was[play] ?? {}) };
      for (const [key, entry] of Object.entries(batch)) if (sameJson(mine[key], entry)) delete mine[key];
      const next = { ...was, [play]: mine };
      now.current.local = next;
      return next;
    });
  }, []);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      const waiting = [...timers.current.entries()];
      timers.current.clear();
      for (const [play, t] of waiting) { clearTimeout(t); void flush(play); }
    };
  }, [flush]);
  const queue = useCallback((play: string) => {
    const was = timers.current.get(play);
    if (was) clearTimeout(was);
    timers.current.set(play, setTimeout(() => { void flush(play); }, SAVE_AFTER_MS));
  }, [flush]);
  /* Sets (or, with null, clears) the author's change to one strip, at once in the ref the flush reads and in the state the screen draws. */
  const putLocal = useCallback((play: string, place: number, entry: Entry | null) => {
    const was = now.current.local;
    const mine = { ...(was[play] ?? {}) };
    if (entry === null ? !(String(place) in mine) : sameJson(mine[place], entry)) return;
    if (entry === null) delete mine[place]; else mine[place] = entry;
    const next = { ...was, [play]: mine };
    now.current.local = next;
    setLocal(next);
  }, []);

  /* A save that landed is in `states`: what it carried is no longer on its way (and a place the card holds as peeled is peeled). */
  useEffect(() => {
    setLocal((was) => {
      let changed = false;
      const next: Record<string, Record<string, Entry>> = {};
      for (const [play, mine] of Object.entries(was)) {
        const held = savedOf(states[play]?.state);
        const kept: Record<string, Entry> = {};
        for (const [key, entry] of Object.entries(mine)) {
          if (held.peeled.includes(Number(key)) || (sameJson(stuckOf(held, Number(key)), entry.shares) && sameJson(held.drops?.[key] ?? [], entry.drops))) changed = true;
          else kept[key] = entry;
        }
        next[play] = kept;
      }
      if (!changed) return was;
      now.current.local = next;
      return next;
    });
  }, [states]);

  /* A moment meets nothing: it sends nothing at all, the reader's own first-time callout included. */
  const meet = useRef<(() => void) | null>(null);
  meet.current = moment === null ? met : null;
  const onMeet = useCallback(() => meet.current?.(), []);
  const model = useRef({ live, strips, text, author });
  model.current = { live, strips, text, author };
  /* Said again when the same words come up twice: a trailing space every other time makes it new text, as Whoops! does. */
  const say = useCallback((words: string) => setUncovered((was) => (was === words ? `${words} ` : words)), []);

  /*
   * The hands. The state machine is made on first use and takes the card's numbers as they stand, so a setting changed between visits
   * reaches it. One animation-frame loop ticks it while anything is in hand and runs no more once nothing is.
   */
  const hands = useRef<Hands | null>(null);
  const handsNow = useCallback((): Hands => {
    const cards = now.current.cards;
    const read = (key: keyof typeof DEFAULTS) => cards[`autocorrect.${key}`] ?? DEFAULTS[key];
    const cfg: HandSettings = { pace: read('pace'), pickMs: read('pickMs'), give: read('give'), peekStayMs: read('peekStayMs'), peekSettle: read('peekSettle'), reduced: motionReduced(), author: model.current.author, slop: SLOP, cornerDelayMs: CORNER_DELAY_MS };
    if (hands.current) hands.current.setSettings(cfg); else hands.current = new Hands(cfg);
    return hands.current;
  }, []);
  /* A strip peeled while focused takes the reader's place with it: focus goes to the next exposed strip on the post, or to the post. */
  const focusAfter = useCallback((strip: TapeStrip) => {
    const el = box.current?.querySelector<HTMLElement>(`[data-kb-ac-anchor="${strip.key}"]`);
    if (!el || el !== document.activeElement) return;
    const left = model.current.live.filter((s) => s.key !== strip.key);
    const open = left.filter((s) => exposed(s, left)).sort((a, b) => a.from - b.from);
    const next = open.find((s) => s.from >= strip.from) ?? open[0];
    const target = next ? box.current?.querySelector<HTMLElement>(`[data-kb-ac-anchor="${next.key}"]`) : null;
    (target ?? box.current)?.focus();
  }, []);
  /* Whether the hold now in hand is a key's, so a pick says its words and does not buzz. */
  const byKey = useRef(false);
  const apply = useCallback((events: readonly HandEvent[]) => {
    for (const ev of events) {
      const strip = ev.kind === 'change' || ev.kind === 'off' ? model.current.strips.find((s) => s.key === ev.strip) : undefined;
      if (ev.kind === 'covered') say(COVERED);
      else if (ev.kind === 'picked') {
        /* The author's own screen only: nothing is sent. A key pick has no hand to feel it, so it is said instead. */
        if (byKey.current) say(PICKED);
        else try { navigator.vibrate?.(BUZZ); } catch { /* not offered here */ }
      }
      else if (ev.kind === 'change' && strip && model.current.author) {
        putLocal(strip.play, strip.index, { shares: handsNow().sharesOf(strip.key), drops: handsNow().dropsOf(strip.key) });
        queue(strip.play);
      } else if (ev.kind === 'off' && strip) {
        say(`Peeled. Under it: “${model.current.text.slice(strip.from, strip.to)}”.`);
        focusAfter(strip);
      } else if (ev.kind === 'drop') {
        /* The roll in the hand falls from where it is, and the one on the page is gone: a copy falls, or under reduced motion nothing. */
        const line = ev.piece.slice(ev.piece.lastIndexOf(':') + 1), key = ev.piece.slice(0, ev.piece.lastIndexOf(':'));
        const roll = box.current?.querySelector<HTMLElement>(`[data-kb-ac-piece="${key}"][data-kb-ac-line="${line}"] [data-kb-ac-roll="live"]`);
        if (roll) { dropRoll(roll, { reduced: motionReduced(), seed: `${ev.piece}:drop:${ev.x.toFixed(0)}` }); roll.style.visibility = 'hidden'; }
      }
    }
  }, [say, putLocal, queue, handsNow, focusAfter]);
  const loop = useRef({ raf: 0, last: 0 });
  const run = useCallback(() => {
    if (loop.current.raf || typeof requestAnimationFrame !== 'function') return;
    loop.current.last = 0;
    const step = (t: number) => {
      loop.current.raf = 0;
      const hs = hands.current;
      if (!hs) return;
      const dt = loop.current.last ? Math.min(50, Math.max(0, t - loop.current.last)) : 16;
      loop.current.last = t;
      handsNow().tick(dt);
      apply(hs.drain());
      setFrame((n) => n + 1);
      if (hs.busy()) loop.current.raf = requestAnimationFrame(step);
    };
    loop.current.raf = requestAnimationFrame(step);
  }, [apply, handsNow]);
  useEffect(() => () => { if (loop.current.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(loop.current.raf); loop.current.raf = 0; }, []);
  /* What the hands did just now is drawn, and the loop runs while they still have something to do. */
  const after = useCallback((hs: Hands) => { apply(hs.drain()); setFrame((n) => n + 1); if (hs.busy()) run(); }, [apply, run]);

  /* The key that began the hold now in hand: a refused key's key-up ends nothing. */
  const heldKey = useRef<string | null>(null);
  const onKey = useCallback((strip: TapeStrip, down: boolean, mode: KeyMode = 'peek', which?: string) => {
    const hs = handsNow();
    if (down) {
      onMeet();
      const busy = hs.occupied();
      if (hs.keyDown(strip.key, mode)) { byKey.current = true; heldKey.current = which ?? null; }
      /* A refusal says why, unless the hands are busy with something else; a covered strip's own words, if the hands have them, come after and stand. */
      else if (mode === 'unroll' && !busy && !hs.rollWaiting(strip.key)) say(NOTHING_BACK);
    } else if (which === undefined || which === heldKey.current) {
      byKey.current = false;
      heldKey.current = null;
      hs.keyUp();
    }
    after(hs);
  }, [handsNow, onMeet, after, say]);
  /* The pointer's place on a piece, in the piece's own pixels: from its untilted box (offsetLeft ignores the tilt), not the rotated rect. */
  const placeOf = (e: PointerEvent<HTMLElement>) => e.clientX - ((e.currentTarget.offsetParent?.getBoundingClientRect().left ?? 0) + e.currentTarget.offsetLeft);
  /* While a hand is held, a pointerup or pointercancel anywhere lets it go: its piece may be gone from the page, and no event would come to it. */
  const onWindow = useRef<(() => void) | null>(null);
  useEffect(() => () => onWindow.current?.(), []);
  const onDown = useCallback<PieceHandler>((e, id) => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || e.isPrimary === false) return;
    const hs = handsNow();
    /* A pointer pick is not a key's: a key hold whose strip went without a key-up or a blur must not leave its words and its silence on this one. */
    byKey.current = false;
    onMeet();
    const did = hs.press(id, placeOf(e), e.pointerId ?? 0);
    if (did === 'pending' || did === 'peeling' || did === 'peeking') {
      /* Only a press that is taken stops the page's own selection and drag: a press that is not leaves the words and links alone. */
      e.preventDefault();
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* A pointer already gone has nothing to capture. */ }
      onWindow.current?.();
      const out = (ev: Event) => { stop(); hs.release((ev as { pointerId?: number }).pointerId ?? 0); after(hs); };
      const stop = () => { window.removeEventListener('pointerup', out); window.removeEventListener('pointercancel', out); onWindow.current = null; };
      window.addEventListener('pointerup', out);
      window.addEventListener('pointercancel', out);
      onWindow.current = stop;
    }
    after(hs);
  }, [handsNow, onMeet, after]);
  const onMove = useCallback<PieceHandler>((e) => {
    const hs = hands.current;
    if (!hs) return;
    hs.move(e.pointerId ?? 0, placeOf(e));
    /* A hand held still lets the loop rest; a move wakes it. */
    if (hs.busy()) run();
  }, [run]);
  const onUp = useCallback<PieceHandler>((e) => {
    const hs = hands.current;
    if (!hs) return;
    hs.release(e.pointerId ?? 0);
    after(hs);
  }, [after]);

  /* Rooms: break-spaces after a strip's words, by the end offset they follow, as this screen's measuring last found them. */
  const [rooms, setRooms] = useState<Rooms>({});
  /* Whole stacks (design docs/plans/2026-11-27-autocorrect-whole-strip-design.md), by their first strip's start: found from widths only. */
  const [whole, setWhole] = useState<Record<string, true>>({});
  const [laid, setLaid] = useState<Layout | null>(null);
  const world = useRef({ strips, stacks, loaded, rooms, whole, key: '' });
  world.current = { strips, stacks, loaded, rooms, whole, key: `${text}\u0000${configsKey}` };
  const extra = useRef<{ key: string; at: Record<string, number> }>({ key: '', at: {} });

  /*
   * The measuring: the segments' own widths (never the rooms'), the break-space in the formatting each room sits in, the marker in
   * the board's size; then the rooms each stack needs, and, once they are in the line, each strip's boxes joined per line and its
   * writing dealt across them. Called on mount, on a resize of the post's box, when fonts are ready and for a new version, never
   * per frame.
   */
  const layout = useCallback(() => {
    const host = box.current;
    if (!host) return;
    const { strips: all, stacks: groups, loaded: before, rooms: have, whole: haveWhole, key } = world.current;
    const hostRect = host.getBoundingClientRect();
    const base = Number.parseFloat(getComputedStyle(host).fontSize) || 16;
    const ruler = rulerOf();
    const marker = (scale: number) => `${(base * MARKER * scale).toFixed(2)}px "Gochi Hand", cursive`;
    const segs = [...host.querySelectorAll<HTMLElement>('[data-kb-ac-seg]')];
    const edge = (el: HTMLElement) => (el.dataset.kbAcSeg ?? '0-0').split('-').map(Number) as [number, number];
    /* The segments indexed once, by the offsets they start and end at, so no strip walks them all. */
    const width = new Map<string, number>();
    const firstAt = new Map<number, number>();
    const lastAt = new Map<number, number>();
    segs.forEach((s, i) => {
      const [a, b] = edge(s);
      if (!firstAt.has(a)) firstAt.set(a, i);
      lastAt.set(b, i);
    });
    /*
     * The words' widths as they lie unbroken, whatever state each stack is in: a run that wraps loses the space collapsed at its
     * break, so its rects read narrower than the same words on one line, and a footprint tested on that read would flip the stack
     * whole, then wider than its line, then not. So every segment is set to `pre` (spaces and newlines kept, never wrapped, as the whole rule below lays it) for one batched read (set all, read all,
     * restore all, inside the layout effect, so nothing paints), and the width tested never depends on the layout it decides.
     */
    const priorWrap = segs.map((s) => s.style.whiteSpace);
    try {
      for (const s of segs) s.style.whiteSpace = 'pre';
      segs.forEach((s) => width.set(s.dataset.kbAcSeg!, (width.get(s.dataset.kbAcSeg!) ?? 0) + [...s.getClientRects()].reduce((t, r) => t + r.width, 0)));
    } finally {
      segs.forEach((s, i) => { s.style.whiteSpace = priorWrap[i]!; });
    }
    /* The segments' widths ascending by start with running totals: the words from one offset to another are a run of them (the segments partition the text, so their ends ascend with their starts). */
    const byStart = [...width].map(([id, w]) => { const [a, b] = id.split('-').map(Number) as [number, number]; return { a, b, w }; }).sort((x, y) => x.a - y.a || x.b - y.b);
    const upTo = [0];
    for (const q of byStart) upTo.push(upTo[upTo.length - 1]! + q.w);
    const startsAtOrAfter = (x: number) => { let lo = 0, hi = byStart.length; while (lo < hi) { const m = (lo + hi) >> 1; if (byStart[m]!.a < x) lo = m + 1; else hi = m; } return lo; };
    const endsAtOrBefore = (x: number) => { let lo = 0, hi = byStart.length; while (lo < hi) { const m = (lo + hi) >> 1; if (byStart[m]!.b <= x) lo = m + 1; else hi = m; } return lo; };
    /* The rooms in the line, by end, queried once. */
    const roomEls = new Map<number, HTMLElement>();
    for (const e of host.querySelectorAll<HTMLElement>('[data-kb-ac-room]')) { const n = Number(e.dataset.kbAcRoom); if (!roomEls.has(n)) roomEls.set(n, e); }
    const roomEnds = [...roomEls.keys()].sort((x, y) => x - y);
    const spaces = new Map<number, number>();
    const spaceAt = (end: number): number => {
      let w = spaces.get(end);
      if (w === undefined) {
        const lastIdx = lastAt.get(end);
        const last = lastIdx === undefined ? undefined : segs[lastIdx];
        w = last ? ruler(fontOf(last), ' ') : base * 0.25;
        spaces.set(end, w || base * 0.25);
      }
      return spaces.get(end)!;
    };
    const pad = PAD_EM * base;
    const nextRooms: Record<string, number> = {};
    for (const stack of groups) {
      /* The ends ascending, each strip's room measured with the space where it sits; a room set strictly inside a strip counts at its true width. */
      const inner = new Map<number, number>();
      const innerAts: number[] = [];
      const innerUpTo: number[] = [0];
      const ofEnd = new Map<number, TapeStrip[]>();
      for (const s of stack) (ofEnd.get(s.to) ?? ofEnd.set(s.to, []).get(s.to)!).push(s);
      for (const end of [...ofEnd.keys()].sort((a, b) => a - b)) {
        const measure: Measure = {
          words: (from, to) => {
            const lo = startsAtOrAfter(from);
            let sum = Math.max(0, upTo[endsAtOrBefore(to)]! - upTo[lo]!);
            /* The rooms set so far are ascending: those strictly inside are a run of them. */
            let i = 0, j = innerAts.length;
            { let l = 0, h = j; while (l < h) { const m = (l + h) >> 1; if (innerAts[m]! <= from) l = m + 1; else h = m; } i = l; }
            { let l = i, h = j; while (l < h) { const m = (l + h) >> 1; if (innerAts[m]! < to) l = m + 1; else h = m; } j = l; }
            sum += innerUpTo[j]! - innerUpTo[i]!;
            return sum;
          },
          replacement: (t) => ruler(marker(1), t),
          space: spaceAt(end),
          pad,
        };
        const made = roomOf(ofEnd.get(end)!, measure, before).get(end);
        if (made) {
          inner.set(end, made);
          nextRooms[String(end)] = made;
          innerAts.push(end);
          innerUpTo.push(innerUpTo[innerUpTo.length - 1]! + made * spaceAt(end));
        }
      }
    }
    /*
     * What a strip that crosses a line needs beyond one line's worth: the room above is measured as if the footprint stood on one
     * line, but a word of the replacement that fits no piece but the last leaves the other pieces' tape unused. Found below, once
     * the strip's pieces are known, and kept (it only grows, up to the replacement's own width) until the post's text or plays change.
     */
    if (extra.current.key !== key) extra.current = { key, at: {} };
    /*
     * A stack whose footprint (its words and its rooms, as set above) is no wider than its line is whole: it does not wrap and takes no
     * extra. The line is the content box of the nearest block around its first segment, so a quote or a spun thread's ORIGIN box is
     * measured as it is. Found from widths alone, never from where the lines broke, so it cannot flip between two layouts.
     */
    const lineWidth = (el: HTMLElement | undefined): number => {
      let e: HTMLElement | null = el?.parentElement ?? null;
      while (e && e !== host.parentElement && ['inline', 'contents'].includes(String(getComputedStyle(e).display ?? ''))) e = e.parentElement;
      if (!e) return hostRect.width;
      const cs = getComputedStyle(e);
      const px = (k: string) => Number.parseFloat(cs.getPropertyValue(k)) || 0;
      return e.getBoundingClientRect().width - px('padding-left') - px('padding-right') - px('border-left-width') - px('border-right-width');
    };
    const nextWhole: Record<string, true> = {};
    const wholeEnds = new Set<number>();
    for (const stack of groups) {
      if (stack.every((s) => before.has(s.key))) continue;
      const from = stack[0]!.from;
      const to = Math.max(...stack.map((s) => s.to));
      const firstIdx = firstAt.get(from);
      if (firstIdx === undefined) continue;
      let foot = Math.max(0, upTo[endsAtOrBefore(to)]! - upTo[startsAtOrAfter(from)]!);
      for (const end of new Set(stack.map((s) => s.to))) foot += (nextRooms[String(end)] ?? 0) * spaceAt(end);
      /* The words keep the player's newlines (the post is pre-wrap), and a newline breaks the line: such a stack cannot lie on one. */
      const firstFrom = Math.min(...stack.map((s) => s.from)), lastTo = Math.max(...stack.map((s) => s.to));
      if (text.slice(firstFrom, lastTo).includes('\n')) continue;
      if (foot <= lineWidth(segs[firstIdx]) + 0.5) {
        nextWhole[String(from)] = true;
        for (const s of stack) wholeEnds.add(s.to);
      }
    }
    for (const [end, n] of Object.entries(extra.current.at)) if (!wholeEnds.has(Number(end))) nextRooms[end] = (nextRooms[end] ?? 0) + n;
    if (!sameJson(nextWhole, haveWhole)) { setWhole(nextWhole); return; }
    if (!sameJson(nextRooms, have)) { setRooms(nextRooms); return; }

    const out: Record<string, Laid> = {};
    const bump: Record<string, number> = {};
    /* One Range for the whole pass: every Range made is live on the document until it is collected, and each node the page removes meanwhile updates them all. */
    const r = document.createRange();
    /*
     * The boxes of a strip's words and its room, and only those: a Range from the first word to the room also takes the text of the
     * visually hidden anchor buttons between them (a clipped one-pixel button whose label still has a box as wide as the replacement),
     * and that box would join the line and carry the piece past the post's edge.
     */
    const rectsOf = (strip: TapeStrip): Rect[] | null => {
      const firstIdx = firstAt.get(strip.from);
      const lastIdx = lastAt.get(strip.to);
      if (firstIdx === undefined || lastIdx === undefined) return null;
      const room = before.has(strip.key) ? null : roomEls.get(strip.to);
      /* The rooms of strips ending inside this one are part of its footprint, as its own is. */
      let lo = 0, hi = roomEnds.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (roomEnds[m]! <= strip.from) lo = m + 1; else hi = m; }
      const inner: HTMLElement[] = [];
      for (let i = lo; i < roomEnds.length && roomEnds[i]! < strip.to; i++) inner.push(roomEls.get(roomEnds[i]!)!);
      const parts = [...segs.slice(firstIdx, lastIdx + 1), ...inner, ...(room ? [room] : [])];
      const rects: Rect[] = [];
      for (const part of parts) {
        r.selectNodeContents(part);
        if (typeof r.getClientRects !== 'function') return null;
        rects.push(...r.getClientRects());
      }
      return rects;
    };
    for (const s of all) {
      const rects = rectsOf(s);
      if (!rects) continue;
      const boxes = linesOf(rects, hostRect);
      if (!boxes.length) continue;
      const dealt = dealWords(s.replacement, boxes.map((b) => b.w - 2 * pad), (t, scale) => ruler(marker(scale), t));
      const lack = ruler(marker(dealt.scale), dealt.words.at(-1) ?? '') - (boxes.at(-1)!.w - 2 * pad);
      const grown = extra.current.at[String(s.to)] ?? 0;
      if (lack > 0.5 && !before.has(s.key) && !wholeEnds.has(s.to) && grown * spaceAt(s.to) < 2 * ruler(marker(1), s.replacement)) {
        const more = Math.ceil(lack / spaceAt(s.to));
        extra.current.at[String(s.to)] = grown + more;
        bump[String(s.to)] = Math.max(bump[String(s.to)] ?? 0, more);
      }
      out[s.key] = { boxes, words: dealt.words, scale: dealt.scale };
    }
    if (Object.keys(bump).length) {
      setRooms(Object.fromEntries(Object.entries({ ...nextRooms, ...bump }).map(([end, n]) => [end, (nextRooms[end] ?? 0) + (bump[end] ?? 0)])));
      return;
    }
    const next: Layout = { w: hostRect.width, base, strips: out };
    setLaid((was) => (sameJson(was, next) ? was : next));
  }, []);
  const layoutNow = useRef(layout);
  layoutNow.current = layout;
  /* A new version of the post, a new set of plays, or new rooms in the line: measured before the page paints. */
  useLayoutEffect(() => { layoutNow.current(); }, [text, configsKey, rooms, whole]);
  /* A resize of the post's box, and fonts that arrive late. */
  useEffect(() => {
    let live = true;
    const again = () => { if (live) layoutNow.current(); };
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(again) : null;
    if (box.current) resize?.observe(box.current);
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    void Promise.all([fonts?.load?.('1em "Gochi Hand"'), fonts?.ready]).then(again, () => {});
    return () => { live = false; resize?.disconnect(); };
  }, []);

  /* The line: the stacks' words cut at every strip's end, with an anchor at each taped strip's start and the room at each end. */
  const runs = useMemo<TextRun[]>(() => stacks.flatMap((stack) => {
    const cuts = [...new Set(stack.flatMap((s) => [s.from, s.to]))].sort((a, b) => a - b);
    return cuts.slice(0, -1).map((start, i): TextRun => {
      const end = cuts[i + 1]!;
      const id = `${start}-${end}`;
      const covered = stack.some((s) => liveKeys.has(s.key) && s.from <= start && s.to >= end);
      const anchors = stack.filter((s) => s.from === start && liveKeys.has(s.key)).sort((a, b) => b.z - a.z);
      const room = rooms[String(end)] ?? 0;
      const wholeAttr = whole[String(stack[0]!.from)] ? { 'data-kb-ac-whole': '' } : null;
      return {
        start, end, key: `ac:${id}`, z: 0, mode: 'wrap',
        render: ({ text: words, key }) => (
          <Fragment key={key}>
            {key === `ac:${id}@${start}` ? anchors.map((s) => (
              <Anchor key={s.key} strip={s} author={author} heldLeft={heldLeft(s)} open={openKeys.has(s.key)} onKey={onKey} onFocus={setFocused} />
            )) : null}
            <span data-kb-ac-seg={id} {...wholeAttr} {...(covered ? { 'aria-hidden': true, 'data-kb-quotable': 'hidden' } : null)}>{words}</span>
          </Fragment>
        ),
        ...(room > 0 ? { trail: (key: string) => <span key={key} className="dw-ac-room" aria-hidden="true" data-kb-quotable="hidden" data-kb-ac-room={end} {...wholeAttr}>{' '.repeat(room)}</span> } : null),
      };
    });
  }), [stacks, liveKeys, live, rooms, whole, author, onKey, clock, holds]);

  /*
   * What a strip's drawing and hands need of its stretches, made once for the stretches it has (by identity) and this layout, so a
   * peel or a peek in hand redoes only the strip in hand and not every strip on the post: its stretches in each piece's pixels, its
   * masks and torn outline, the residue regions with what lay on a lower strip cut out, and the pieces as the hands take them, with
   * what lies over them and what lies under them on their lines (only within the strip's own stack, where strips overlap).
   */
  const stackOf = useMemo(() => new Map(stacks.flatMap((st) => st.map((q): [string, readonly TapeStrip[]] => [q.key, st]))), [stacks]);
  /* Which live strips have nothing live over them, found once per stack (strips overlap only within their own), not once per strip over all of them. */
  const openKeys = useMemo(() => {
    const out = new Set<string>();
    for (const st of stacks) {
      const mine = st.filter((q) => liveKeys.has(q.key));
      for (const q of mine) if (exposed(q, mine)) out.add(q.key);
    }
    return out;
  }, [stacks, liveKeys]);
  /* Every strip's boxes in a grid of cells, so a box finds the lower strips' boxes near it without a pass over all of them. */
  const grid = useMemo(() => {
    const cells = new Map<string, { z: number; key: string; j: number; at: number; box: Box }[]>();
    if (!laid) return cells;
    let at = 0;
    for (const q of strips) {
      (laid.strips[q.key]?.boxes ?? []).forEach((box, j) => {
        for (let r = Math.floor(box.y / CELL); r <= Math.floor((box.y + box.h) / CELL); r++) {
          for (let c = Math.floor(box.x / CELL); c <= Math.floor((box.x + box.w) / CELL); c++) {
            const k = `${r}:${c}`;
            (cells.get(k) ?? cells.set(k, []).get(k)!).push({ z: q.z, key: q.key, j, at, box });
          }
        }
        at++;
      });
    }
    return cells;
  }, [laid, strips]);
  /* The boxes of strips lower than `z` that touch `b`, in the order the strips and their boxes come. */
  const nearLower = (b: Box, z: number) => {
    const found = new Map<number, { z: number; key: string; j: number; at: number; box: Box }>();
    for (let r = Math.floor(b.y / CELL); r <= Math.floor((b.y + b.h) / CELL); r++) {
      for (let c = Math.floor(b.x / CELL); c <= Math.floor((b.x + b.w) / CELL); c++) for (const e of grid.get(`${r}:${c}`) ?? []) if (e.z < z) found.set(e.at, e);
    }
    return [...found.values()].sort((x, y) => x.at - y.at);
  };
  const drawn = useRef(new Map<string, Drawn>());
  const drawOf = (s: TapeStrip): Drawn | null => {
    const at = laid?.strips[s.key];
    if (!laid || !at) return null;
    const src = stuckFor(s);
    const dropSrc = dropsFor(s);
    const isHeld = heldAt(s) !== undefined;
    const was = drawn.current.get(s.key);
    if (was && was.src === src && was.laid === laid && was.live === live && was.held === isHeld && was.drops === dropSrc) return was;
    const px = piecesOf(src, at.boxes.map((b) => b.w));
    const dropped = dropsInPieces(dropSrc, at.boxes.map((b) => b.w));
    const open = openKeys.has(s.key);
    const lower = (stackOf.get(s.key) ?? []).filter((q) => q.z < s.z && liveKeys.has(q.key)).sort((x, y) => y.z - x.z);
    const pieces: DrawnPiece[] = [];
    const regions: Region[] = [];
    const specs: PieceSpec[] = [];
    at.boxes.forEach((b, i) => {
      const own = px[i] ?? [];
      const id = `${s.key}:${i}`;
      pieces.push({ own, mask: maskOf(own, b.w), clip: tornPath(own, b.h, id), attr: own.map(([lo, hi]) => `${lo.toFixed(1)}-${hi.toFixed(1)}`).join(',') });
      const peeled = peeledOf(own, b.w);
      if (peeled.length) {
        const cut = nearLower(b, s.z).flatMap(({ box: q }): Box[] => {
          const [x0, y0, x1, y1] = [Math.max(b.x, q.x), Math.max(b.y, q.y), Math.min(b.x + b.w, q.x + q.w), Math.min(b.y + b.h, q.y + q.h)];
          return x1 > x0 && y1 > y0 ? [{ x: x0 - b.x, y: y0 - b.y, w: x1 - x0, h: y1 - y0 }] : [];
        });
        regions.push({ key: id, seed: id, box: b, peeled, cut, tears: tearsOf(own, b.w) });
      }
      const under = lower.flatMap((q) => (laid.strips[q.key]?.boxes ?? []).flatMap((qb, j) => {
        const line = Math.min(b.y + b.h, qb.y + qb.h) - Math.max(b.y, qb.y) > 0.5 * Math.min(b.h, qb.h);
        return line && qb.x < b.x + b.w && qb.x + qb.w > b.x ? [`${q.key}:${j}`] : [];
      }));
      specs.push({ id, strip: s.key, index: i, w: b.w, h: b.h, stuck: own, open, under, held: isHeld, ...(dropped[i]?.length ? { drops: dropped[i] } : {}) });
    });
    const made: Drawn = { src, drops: dropSrc, laid, live, held: isHeld, pieces, regions, specs };
    drawn.current.set(s.key, made);
    return made;
  };
  const drawnAll = strips.map((s) => [s, drawOf(s)] as const);
  const drawnBy = new Map(drawnAll.map(([s, d]) => [s.key, d]));
  /* The residue's regions, the same array while none of them is a new one: a peel in hand changes only its own. */
  const regionsNow = drawnAll.flatMap(([, d]) => d?.regions ?? []);
  const regionsKept = useRef<Region[]>([]);
  if (regionsKept.current.length !== regionsNow.length || regionsKept.current.some((r, i) => r !== regionsNow[i])) regionsKept.current = regionsNow;
  const regions = regionsKept.current;
  const specs = !laid ? [] : drawnAll.flatMap(([s, d]) => (d && liveKeys.has(s.key) ? d.specs : []));

  /* Every strip's footprint on the post: the residue's one canvas covers it, whatever is peeled. */
  const span = useMemo(() => {
    const boxes = laid ? Object.values(laid.strips).flatMap((l) => l.boxes) : [];
    if (!boxes.length) return { top: 0, height: 0 };
    const top = Math.min(...boxes.map((b) => b.y));
    return { top, height: Math.max(...boxes.map((b) => b.y + b.h)) - top };
  }, [laid]);

  /* The hands take the pieces before the page paints; a piece whose state they changed (a roll waiting from a saved peel line) is drawn again. */
  useLayoutEffect(() => {
    if (handsNow().sync(specs)) setFrame((n) => n + 1);
  });

  /* The Lens's words (design section 12): how many strips, how many peeled and started, each play's phrase and places. */
  const all = strips.length;
  const done = strips.filter((s) => !liveKeys.has(s.key)).length;
  const started = strips.filter((s) => liveKeys.has(s.key) && !isWhole(stuckFor(s))).length;
  const length = strips.reduce((n, s) => n + (s.to - s.from), 0);
  const share = length ? strips.reduce((n, s) => n + (s.to - s.from) * (1 - stuckFor(s).reduce((a, [lo, hi]) => a + (hi - lo), 0)), 0) / length : null;
  /* The Lens is told the progress when the hands rest (a peel ends, a save is queued), not every frame of a peel. */
  const progress = useRef<number | null>(null);
  if (!hands.current?.busy()) progress.current = share;
  /* A play stacked with another's strips says its layer among the plays of its stacks, by order. */
  const layers = new Map<string, [number, number]>();
  for (const c of configs) {
    const mates = new Set<string>();
    for (const st of stacks) if (st.some((q) => q.play === c.id)) for (const q of st) mates.add(q.play);
    if (mates.size > 1) {
      const order = configs.filter((q) => mates.has(q.id)).map((q) => q.id);
      layers.set(c.id, [order.indexOf(c.id) + 1, order.length]);
    }
  }
  const view: CardView = {
    progress: author && progress.current !== null ? Math.round(progress.current * 1000) / 1000 : null,
    state: all ? `${all} ${all === 1 ? 'strip' : 'strips'}, ${done} peeled${author && started > 0 ? `, ${started} started` : ''}` : 'Phrase not in this version',
    ends: author ? (latestHold ? LENS.authorHeld(left(latestHold - clock)) : LENS.authorEnds) : LENS.readerEnds,
    yours: live.length > 0,
    controls: [],
    notes: Object.fromEntries(configs.map((c) => {
      const layer = layers.get(c.id);
      return [c.id, `“${c.phrase}” → “${c.replacement}”, ${total[c.id] ?? 0} ${(total[c.id] ?? 0) === 1 ? 'place' : 'places'}${layer ? `, layer ${layer[0]} of ${layer[1]}` : ''}`];
    })),
    ...(report ? { report } : null),
  };
  const viewKey = JSON.stringify(view);
  const viewNow = useRef(view);
  viewNow.current = view;
  useEffect(() => { show(viewNow.current); }, [viewKey, show]);

  const tape = { '--dw-ac-paper': PAPER.base, '--dw-ac-ink': PAPER.ink } as CSSProperties;
  return (
    <div ref={box} className="dw-ac" data-kb-autocorrect="" tabIndex={-1}>
      <TextLayer runs={runs}>{children}</TextLayer>
      <div className="dw-ac-tape" aria-hidden="true" style={tape}>
        {laid && regions.length ? <Residue regions={regions} span={span} width={laid.w} host={box} /> : null}
        {laid ? live.flatMap((s) => {
          const at = laid.strips[s.key];
          const d = drawnBy.get(s.key);
          if (!at || !d) return [];
          return at.boxes.flatMap((b, i) => {
            const piece = d.pieces[i]!;
            const view = hands.current?.view(`${s.key}:${i}`) ?? IDLE;
            if (!piece.own.length && !view.rolls.length) return [];
            return [(
              <Piece
                key={`${s.key}:${i}`} strip={s} index={i} box={b} words={at.words[i] ?? ''} fontPx={laid.base * MARKER * at.scale} pad={laid.base * PAD_EM}
                own={piece.own} mask={view.lift ? maskOf(view.shown, b.w) : piece.mask} clip={piece.clip} stuck={piece.attr}
                focused={focused === s.key} view={view} shake={!motionReduced()} onDown={onDown} onMove={onMove} onUp={onUp}
              />
            )];
          });
        }) : null}
      </div>
      <p className="kb-visually-hidden" role="status" data-kb-report>{report || uncovered}</p>
    </div>
  );
}
