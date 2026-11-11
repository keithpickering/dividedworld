/**
 * Autocorrect's effect on a post (docs/plans/2026-11-11-autocorrect-tape-design.md; plan Task 6): masking tape laid over every
 * occurrence of each play's phrase in the post's own words, bearing the caster's replacement in marker.
 *
 * Two layers, one for the eye and one for the line.
 * - **The line.** The post's words are cut at every strip's ends into `wrap` runs (engine/ui/bbcode/layers.tsx), each drawn as a
 *   `span[data-kb-ac-seg]`, so the words stay in the line in their own formatting. At a strip's end the run's `trail` holds the
 *   strip's room: break-spaces, as many as the replacement needs past the words (tape.ts `roomOf`), measured in the formatting
 *   the room sits in. A strip the author peeled before this load gets no room. While tape covers a segment its words are
 *   `aria-hidden` and `data-kb-quotable="hidden"`; at each taped strip's start a visually hidden anchor stands in the line, named
 *   for what its role can do and quoted as the replacement (design section 10).
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
 * The author's peel is a PLACEHOLDER here, for the plan's Task 7 to replace with the hands (pick, pull, roll, tear, peek): holding
 * Enter or Space on an exposed anchor for PLACEHOLDER_HOLD_MS peels the whole strip, saved as the card's `peeled` places through the
 * same debounced, retried and refused-and-put-back flush the card has always had. A reader's hold does nothing yet.
 *
 * `still` (a play's moment) draws the tape as saved, with no anchor a button, no input, no light moving and no measuring beyond
 * the first.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { parse } from '../../../../engine/bbcode/parse.ts';
import { visibleText } from '../../../../engine/bbcode/visible.ts';
import { TextLayer, type TextRun } from '../../../../engine/ui/bbcode/layers.tsx';
import { LOST_ANSWER, type Answer } from '../../../../engine/ui/data/api.ts';
import type { CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { bandFor, type Band } from '../../../../engine/ui/shine/band.ts';
import { watchInView } from '../../../../engine/ui/shine/inView.ts';
import { REST, type Light } from '../../../../engine/ui/shine/light.ts';
import { register, unregister, wake, SPAN_MARGIN } from '../../../../engine/ui/shine/loop.ts';
import { seeded } from '../../ui/seeded.ts';
import type { Stretch } from '../autocorrect.ts';
import { drawPaper, PAPER, type PaperContext } from './paper.ts';
import { savedAfterPeel } from './peel.ts';
import { filmAlpha, filmSize, GLOSS_ALPHA, residueInk } from './residue.ts';
import { dealWords, exposed, piecesOf, roomOf, stripsOf, stuckOf, type Measure, type SavedTape, type TapeStrip } from './tape.ts';
import './autocorrect.css';

/** The author's placeholder peel: how long a key is held on an exposed anchor before the whole strip comes off (Task 7 replaces it with the hands). */
const PLACEHOLDER_HOLD_MS = 700;
const SAVE_AFTER_MS = 400;
const RETRY_AFTER_MS = 1500;
const MAX_SAVE_RETRIES = 3;
/** The marker's size against the board's text size, and the bench's extra 2%. */
const MARKER = 1.3 * 1.02;
/** The padding on each side of a piece's writing, against the board's text size. */
const PAD_EM = 0.35;
/** The most pixels the residue's one canvas holds. */
const MOST_RESIDUE_PIXELS = 4_000_000;

/** The Lens's ends (design section 12), the glass's plain words, kept where a test can read them. */
export const LENS = Object.freeze({
  readerEnds: 'Lift a strip by one end to read under it; it lays back down. Only the post\'s author can peel strips off for good.',
  authorEnds: 'Peel a strip off for good: hold one end until it lifts, then pull slowly. Pull too fast and it tears.',
});

/** What a saved state names: the places peeled whole, and the stretches still stuck of those half peeled. Anything else is none. */
function savedOf(state: unknown): SavedTape {
  const own = state as { peeled?: unknown; stuck?: unknown } | null | undefined;
  const peeled = Array.isArray(own?.peeled) ? own.peeled.filter((n): n is number => Number.isSafeInteger(n) && n >= 0) : [];
  const stuck: Record<string, Stretch[]> = {};
  if (own?.stuck && typeof own.stuck === 'object') {
    for (const [place, list] of Object.entries(own.stuck as Record<string, unknown>)) {
      if (!Array.isArray(list) || peeled.includes(Number(place))) continue;
      const kept = list.filter((s): s is Stretch => Array.isArray(s) && s.length === 3 && s.every((n) => typeof n === 'number' && Number.isFinite(n)));
      if (kept.length) stuck[place] = kept;
    }
  }
  return Object.keys(stuck).length ? { peeled, stuck } : { peeled };
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

/** What one strip lets the Lens count: its stuck length and whether the author has begun on it. */
const isWhole = (stuck: readonly Stretch[]) => stuck.length === 1 && stuck[0]![0] === 0 && stuck[0]![1] === 1;

interface AnchorProps {
  readonly strip: TapeStrip;
  readonly author: boolean;
  readonly still: boolean;
  readonly open: boolean;
  readonly onPeel: (strip: TapeStrip, el: HTMLElement) => void;
  readonly onMeet: () => void;
  readonly onFocus: (key: string | null) => void;
}

/**
 * A taped strip's anchor, in the line at the start of its words: visually hidden, focusable, named for the role, quoted as the
 * replacement. Not in the tab order while another strip lies over it. In a play's moment it is only words, with nothing to press.
 */
function Anchor({ strip, author, still, open, onPeel, onMeet, onFocus }: AnchorProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const held = useRef<ReturnType<typeof setTimeout> | null>(null);
  const letGo = useCallback(() => { if (held.current !== null) { clearTimeout(held.current); held.current = null; } }, []);
  useEffect(() => letGo, [letGo]);
  const name = `Autocorrected text: “${strip.replacement}”. Hold Enter or Space to ${author ? 'peel it off for good' : 'lift it and read under it'}`;
  if (still) {
    return <span className="kb-visually-hidden" data-kb-ac-anchor={strip.key} data-kb-quotable={open ? 'shown' : 'hidden'}>{strip.replacement}</span>;
  }
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (e.repeat || held.current !== null) return;
    onMeet();
    if (!author || !open) return;
    held.current = setTimeout(() => { held.current = null; if (ref.current) onPeel(strip, ref.current); }, PLACEHOLDER_HOLD_MS);
  };
  return (
    <button
      ref={ref} type="button" className="kb-visually-hidden dw-ac-anchor" data-kb-ac-anchor={strip.key} data-kb-quotable={open ? 'shown' : 'hidden'}
      tabIndex={open ? 0 : -1} aria-label={name}
      onKeyDown={onKeyDown} onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') letGo(); }}
      onFocus={() => onFocus(strip.key)} onBlur={() => { letGo(); onFocus(null); }}
    >{strip.replacement}</button>
  );
}

interface PieceProps {
  readonly strip: TapeStrip;
  readonly index: number;
  readonly box: Box;
  readonly words: string;
  readonly fontPx: number;
  readonly pad: number;
  readonly mask: string | undefined;
  readonly focused: boolean;
}

/** One piece of tape over one line: a plain paper fill until its canvas is drawn, when it first comes near the viewport, and the marker's words on it. */
function Piece({ strip, index, box, words, fontPx, pad, mask, focused }: PieceProps) {
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
  const style = {
    left: box.x, top: box.y, width: box.w, height: box.h, zIndex: strip.z + 1,
    '--dw-ac-tilt': `${tilt}deg`,
    ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : null),
  } as CSSProperties;
  return (
    <div ref={div} className="dw-ac-piece" style={style} data-kb-ac-piece={strip.key} data-kb-focus={focused ? 'true' : undefined}>
      <canvas ref={canvas} className="dw-ac-paper" style={{ width: box.w, height: box.h }} />
      {words ? <span className="dw-ac-ink" style={{ fontSize: fontPx, left: pad }}>{words}</span> : null}
    </div>
  );
}

/** A residue film's footprint in one piece: what is peeled of it, and what lay on a lower strip and is cut out, all in the piece's local pixels. */
interface Region {
  readonly key: string;
  readonly seed: string;
  readonly box: Box;
  readonly peeled: readonly [number, number][];
  readonly cut: readonly Box[];
}

/** One scratch canvas the films are colored on. */
let scratch: HTMLCanvasElement | null = null;

/** A film, 1 where it is thick, as white with that alpha, masked to what is peeled and with what lay on a lower strip cut out. */
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
  c.globalCompositeOperation = 'destination-in';
  c.beginPath();
  for (const [lo, hi] of r.peeled) c.rect(lo * sx, 0, (hi - lo) * sx, rows);
  c.fill();
  c.globalCompositeOperation = 'destination-out';
  for (const q of r.cut) c.fillRect(q.x * sx, q.y * sy, q.w * sx, q.h * sy);
  return film;
}

/** A film in one color, drawn onto `ctx` over `box`. */
function lay(ctx: CanvasRenderingContext2D, film: HTMLCanvasElement, color: string, alpha: number, x: number, y: number, w: number, h: number): void {
  scratch ??= document.createElement('canvas');
  scratch.width = film.width;
  scratch.height = film.height;
  const s = scratch.getContext('2d');
  if (!s) return;
  s.drawImage(film, 0, 0);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = color;
  s.fillRect(0, 0, film.width, film.height);
  ctx.globalAlpha = alpha;
  ctx.drawImage(scratch, x, y, w, h);
}

interface ResidueProps {
  readonly regions: readonly Region[];
  readonly width: number;
  readonly host: React.RefObject<HTMLElement | null>;
  readonly still: boolean;
}

/**
 * The residue of every peeled stretch on the post, on one canvas: a tint in the tape's torn outline and a gloss the page's light
 * moves over it, both held inside the board's readable band. The canvas rides the shine loop as a quiet host at half the rate, so it
 * draws only while in view and never brings up the tilt tip; a play's moment draws it once, at the resting light.
 */
function Residue({ regions, width, host, still }: ResidueProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const token = useRef({});
  const top = Math.min(...regions.map((r) => r.box.y));
  const height = Math.max(...regions.map((r) => r.box.y + r.box.h)) - top;
  const key = JSON.stringify([regions, width]);
  useEffect(() => {
    const cv = canvas.current;
    const el = host.current;
    if (!cv || !el || !regions.length) return undefined;
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
    const paint = (light: Light) => {
      if (cv.width !== Math.ceil(width * density)) size();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(density, 0, 0, density, 0, 0);
      if (!band) return;
      const ink = residueInk(band, light);
      for (const r of regions) {
        if (!films.has(r.key)) films.set(r.key, buildFilm(r));
        const film = films.get(r.key);
        if (!film) continue;
        lay(ctx, film, ink.tint, 1, r.box.x, r.box.y - top, r.box.w, r.box.h);
        lay(ctx, film, ink.gloss, GLOSS_ALPHA, r.box.x, r.box.y - top, r.box.w, r.box.h);
      }
      ctx.globalAlpha = 1;
    };
    if (still) { size(); paint(REST); return () => films.clear(); }
    const me = token.current;
    density = register(me, cv, { w: width, h: height }, density, (frame) => { paint(frame.light); return false; }, { quiet: true, share: 0.5, hidden: () => { films.clear(); cv.width = 0; cv.height = 0; } });
    size();
    const board = typeof MutationObserver === 'function' ? new MutationObserver(() => { band = readBand(); wake(me); }) : null;
    board?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-kb-mode', 'data-kb-effects'] });
    return () => { board?.disconnect(); unregister(me); films.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, still, host]);
  return <canvas ref={canvas} className="dw-ac-residue" style={{ top, width, height }} />;
}

export function AutocorrectEffect({ post, plays, states, reader, still, save, show, met, children }: EffectProps) {
  const body = typeof post.currentPayload.body === 'string' ? post.currentPayload.body : '';
  const text = useMemo(() => visibleText(parse(body)), [body]);
  /* The author's peels on their way to being saved, by play; a refused save's words, by play; and what the last peel uncovered. */
  const [sending, setSending] = useState<Readonly<Record<string, readonly number[]>>>({});
  const [refusals, setRefusals] = useState<Readonly<Record<string, string>>>({});
  const [uncovered, setUncovered] = useState('');
  const [focused, setFocused] = useState<string | null>(null);
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

  /* Each strip's stretches still stuck: none if peeled (saved, or by the author's peel on its way), the whole strip if untouched. */
  const stuckBy = useMemo(() => {
    const out = new Map<string, Stretch[]>();
    for (const c of configs) {
      const saved = savedOf(states[c.id]?.state);
      const merged: SavedTape = { peeled: [...saved.peeled, ...(sending[c.id] ?? [])], ...(saved.stuck ? { stuck: saved.stuck } : null) };
      for (const s of strips) if (s.play === c.id) out.set(s.key, stuckOf(merged, s.index));
    }
    return out;
  }, [configs, states, sending, strips]);
  const live = useMemo(() => strips.filter((s) => (stuckBy.get(s.key)?.length ?? 0) > 0), [strips, stuckBy]);
  const liveKeys = useMemo(() => new Set(live.map((s) => s.key)), [live]);

  /*
   * The author's peels, saved as Whoops!'s strokes are: debounced, one save on its way per play at a time, what is peeled meanwhile
   * sent after it, a save that got no answer sent again a little later each time and given up on after a few, and a refusal said,
   * with its strips put back, since it would be the same again. Each save is the whole list of places, so sending it twice is the
   * same as once. Stretches the card's state holds for strips still half peeled are sent back as they were.
   */
  const now = useRef({ states, total, save, sending });
  now.current = { states, total, save, sending };
  const inFlight = useRef(new Set<string>());
  const dirty = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /* Once the post has gone nothing is set and nothing retried, as Whoops! does; a peel still waiting on its debounce is sent at once. */
  const gone = useRef(false);
  const flush = useCallback(async (play: string, attempt = 0): Promise<void> => {
    if (inFlight.current.has(play)) { dirty.current.add(play); return; }
    dirty.current.delete(play);
    timers.current.delete(play);
    const batch = [...(now.current.sending[play] ?? [])];
    const held = savedOf(now.current.states[play]?.state);
    const places = [...held.peeled, ...batch];
    if (!places.length) return;
    const kept = savedAfterPeel(places, places[places.length - 1]!, now.current.total[play] ?? 0);
    const stuck = Object.fromEntries(Object.entries(held.stuck ?? {}).filter(([place]) => !kept.peeled.includes(Number(place))));
    const state = Object.keys(stuck).length ? { ...kept, stuck } : kept;
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
    setRefusals((was) => ({ ...was, [play]: answer.error }));
    /* Only the places this save carried come back; any peeled since wait for their own. */
    setSending((was) => {
      const left = (was[play] ?? []).filter((i) => !batch.includes(i));
      const next = { ...was, [play]: left };
      now.current.sending = next;
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

  /* A save that landed is in `states`: what it carried is no longer on its way. */
  useEffect(() => {
    setSending((was) => {
      let changed = false;
      const next: Record<string, readonly number[]> = {};
      for (const [play, places] of Object.entries(was)) {
        const held = savedOf(states[play]?.state).peeled;
        const left = places.filter((i) => !held.includes(i));
        if (left.length !== places.length) changed = true;
        next[play] = left;
      }
      if (!changed) return was;
      now.current.sending = next;
      return next;
    });
  }, [states]);

  const meet = useRef(met);
  meet.current = met;
  const onMeet = useCallback(() => meet.current(), []);
  const model = useRef({ live, text, author: reader.author });
  model.current = { live, text, author: reader.author };
  const onPeel = useCallback((strip: TapeStrip, el: HTMLElement) => {
    /* A strip peeled while focused takes the reader's place with it: focus goes to the next exposed strip on the post, or to the post. */
    if (el === document.activeElement) {
      const left = model.current.live.filter((s) => s.key !== strip.key);
      const next = left.filter((s) => exposed(s, left)).sort((a, b) => a.from - b.from).find((s) => s.from >= strip.from) ?? left.filter((s) => exposed(s, left)).sort((a, b) => a.from - b.from)[0];
      const target = next ? box.current?.querySelector<HTMLElement>(`[data-kb-ac-anchor="${next.key}"]`) : null;
      (target ?? box.current)?.focus();
    }
    /* Said again when the same words are uncovered twice: a no-break space every other time makes it new text, as Whoops! does. */
    const said = `Peeled. Under it: “${model.current.text.slice(strip.from, strip.to)}”.`;
    setUncovered((was) => (was === said ? `${said} ` : said));
    if (!model.current.author) return;
    setSending((was) => {
      const next = { ...was, [strip.play]: [...(was[strip.play] ?? []), strip.index] };
      now.current.sending = next;
      return next;
    });
    queue(strip.play);
  }, [queue]);

  /* Rooms: break-spaces after a strip's words, by the end offset they follow, as this screen's measuring last found them. */
  const [rooms, setRooms] = useState<Rooms>({});
  const [laid, setLaid] = useState<Layout | null>(null);
  const world = useRef({ strips, stacks, loaded, rooms });
  world.current = { strips, stacks, loaded, rooms };

  /*
   * The measuring: the segments' own widths (never the rooms'), the break-space in the formatting each room sits in, the marker in
   * the board's size; then the rooms each stack needs, and, once they are in the line, each strip's boxes joined per line and its
   * writing dealt across them. Called on mount, on a resize of the post's box, when fonts are ready and for a new version, never
   * per frame.
   */
  const layout = useCallback(() => {
    const host = box.current;
    if (!host) return;
    const { strips: all, stacks: groups, loaded: before, rooms: have } = world.current;
    const hostRect = host.getBoundingClientRect();
    const base = Number.parseFloat(getComputedStyle(host).fontSize) || 16;
    const ruler = rulerOf();
    const marker = (scale: number) => `${(base * MARKER * scale).toFixed(2)}px "Gochi Hand", cursive`;
    const segs = [...host.querySelectorAll<HTMLElement>('[data-kb-ac-seg]')];
    const edge = (el: HTMLElement) => (el.dataset.kbAcSeg ?? '0-0').split('-').map(Number) as [number, number];
    const width = new Map<string, number>();
    for (const s of segs) width.set(s.dataset.kbAcSeg!, (width.get(s.dataset.kbAcSeg!) ?? 0) + [...s.getClientRects()].reduce((a, r) => a + r.width, 0));
    const spaces = new Map<number, number>();
    const spaceAt = (end: number): number => {
      let w = spaces.get(end);
      if (w === undefined) {
        const last = segs.filter((s) => edge(s)[1] === end).at(-1);
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
      for (const end of [...new Set(stack.map((s) => s.to))].sort((a, b) => a - b)) {
        const measure: Measure = {
          words: (from, to) => {
            let sum = 0;
            for (const [id, w] of width) { const [a, b] = id.split('-').map(Number) as [number, number]; if (a >= from && b <= to) sum += w; }
            for (const [at, n] of inner) if (at > from && at < to) sum += n * spaceAt(at);
            return sum;
          },
          replacement: (t) => ruler(marker(1), t),
          space: spaceAt(end),
          pad,
        };
        const made = roomOf(stack.filter((s) => s.to === end), measure, before).get(end);
        if (made) { inner.set(end, made); nextRooms[String(end)] = made; }
      }
    }
    if (!sameJson(nextRooms, have)) { setRooms(nextRooms); return; }

    const out: Record<string, Laid> = {};
    const rangeOf = (strip: TapeStrip): Range | null => {
      const first = segs.find((s) => edge(s)[0] === strip.from);
      const last = segs.filter((s) => edge(s)[1] === strip.to).at(-1);
      if (!first || !last) return null;
      const room = before.has(strip.key) ? null : host.querySelector(`[data-kb-ac-room="${strip.to}"]`);
      const r = document.createRange();
      r.setStartBefore(first);
      r.setEndAfter(room ?? last);
      return r;
    };
    for (const s of all) {
      const range = rangeOf(s);
      if (!range || typeof range.getClientRects !== 'function') continue;
      const boxes = linesOf([...range.getClientRects()], hostRect);
      if (!boxes.length) continue;
      const dealt = dealWords(s.replacement, boxes.map((b) => b.w - 2 * pad), (t, scale) => ruler(marker(scale), t));
      out[s.key] = { boxes, words: dealt.words, scale: dealt.scale };
    }
    const next: Layout = { w: hostRect.width, base, strips: out };
    setLaid((was) => (sameJson(was, next) ? was : next));
  }, []);
  const layoutNow = useRef(layout);
  layoutNow.current = layout;
  /* A new version of the post, a new set of plays, or new rooms in the line: measured before the page paints. */
  useLayoutEffect(() => { layoutNow.current(); }, [text, configsKey, rooms]);
  /* A resize of the post's box, and fonts that arrive late. A play's moment measures once and is done. */
  useEffect(() => {
    let live = true;
    const again = () => { if (live) layoutNow.current(); };
    /* A play's moment has no observer, but measures once more when the marker's face is in, so its room is measured in it. */
    const resize = !still && typeof ResizeObserver === 'function' ? new ResizeObserver(again) : null;
    if (box.current) resize?.observe(box.current);
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    void Promise.all([fonts?.load?.('1em "Gochi Hand"'), fonts?.ready]).then(again, () => {});
    return () => { live = false; resize?.disconnect(); };
  }, [still]);

  /* The line: the stacks' words cut at every strip's end, with an anchor at each taped strip's start and the room at each end. */
  const runs = useMemo<TextRun[]>(() => stacks.flatMap((stack) => {
    const cuts = [...new Set(stack.flatMap((s) => [s.from, s.to]))].sort((a, b) => a - b);
    return cuts.slice(0, -1).map((start, i): TextRun => {
      const end = cuts[i + 1]!;
      const id = `${start}-${end}`;
      const covered = stack.some((s) => liveKeys.has(s.key) && s.from <= start && s.to >= end);
      const anchors = stack.filter((s) => s.from === start && liveKeys.has(s.key)).sort((a, b) => b.z - a.z);
      const room = rooms[String(end)] ?? 0;
      return {
        start, end, key: `ac:${id}`, z: 0, mode: 'wrap',
        render: ({ text: words, key }) => (
          <Fragment key={key}>
            {key === `ac:${id}@${start}` ? anchors.map((s) => (
              <Anchor key={s.key} strip={s} author={reader.author} still={still} open={exposed(s, live)} onPeel={onPeel} onMeet={onMeet} onFocus={setFocused} />
            )) : null}
            <span data-kb-ac-seg={id} {...(covered ? { 'aria-hidden': true, 'data-kb-quotable': 'hidden' } : null)}>{words}</span>
          </Fragment>
        ),
        ...(room > 0 ? { trail: (key: string) => <span key={key} className="dw-ac-room" aria-hidden="true" data-kb-quotable="hidden" data-kb-ac-room={end}>{' '.repeat(room)}</span> } : null),
      };
    });
  }), [stacks, liveKeys, live, rooms, reader.author, still, onPeel, onMeet]);

  /* The eye: each live strip's pieces, and the residue of what is peeled, cut where a lower strip lay under it. */
  const regions = useMemo<Region[]>(() => {
    if (!laid) return [];
    const out: Region[] = [];
    for (const s of strips) {
      const at = laid.strips[s.key];
      if (!at) continue;
      const stuck = piecesOf(stuckBy.get(s.key) ?? [[0, 1, 0]], at.boxes.map((b) => b.w));
      const under = strips.filter((q) => q.z < s.z).flatMap((q) => laid.strips[q.key]?.boxes ?? []);
      at.boxes.forEach((b, i) => {
        const peeled = peeledOf(stuck[i] ?? [], b.w);
        if (!peeled.length) return;
        const cut = under.flatMap((q): Box[] => {
          const [x0, y0, x1, y1] = [Math.max(b.x, q.x), Math.max(b.y, q.y), Math.min(b.x + b.w, q.x + q.w), Math.min(b.y + b.h, q.y + q.h)];
          return x1 > x0 && y1 > y0 ? [{ x: x0 - b.x, y: y0 - b.y, w: x1 - x0, h: y1 - y0 }] : [];
        });
        out.push({ key: `${s.key}:${i}`, seed: `${s.key}:${i}`, box: b, peeled, cut });
      });
    }
    return out;
  }, [laid, strips, stuckBy]);

  /* The Lens's words (design section 12): how many strips, how many peeled and started, each play's phrase and places. */
  const all = strips.length;
  const done = strips.filter((s) => !liveKeys.has(s.key)).length;
  const started = strips.filter((s) => liveKeys.has(s.key) && !isWhole(stuckBy.get(s.key) ?? [])).length;
  const length = strips.reduce((n, s) => n + (s.to - s.from), 0);
  const share = length ? strips.reduce((n, s) => n + (s.to - s.from) * (1 - (stuckBy.get(s.key) ?? []).reduce((a, [lo, hi]) => a + (hi - lo), 0)), 0) / length : null;
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
    progress: reader.author ? share : null,
    state: all ? `${all} ${all === 1 ? 'strip' : 'strips'}, ${done} peeled${reader.author && started > 0 ? `, ${started} started` : ''}` : 'Phrase not in this version',
    ends: reader.author ? LENS.authorEnds : LENS.readerEnds,
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
        {laid && regions.length ? <Residue regions={regions} width={laid.w} host={box} still={still} /> : null}
        {laid ? live.flatMap((s) => {
          const at = laid.strips[s.key];
          if (!at) return [];
          const mask = piecesOf(stuckBy.get(s.key) ?? [], at.boxes.map((b) => b.w));
          return at.boxes.map((b, i) => (
            <Piece key={`${s.key}:${i}`} strip={s} index={i} box={b} words={at.words[i] ?? ''} fontPx={laid.base * MARKER * at.scale} pad={laid.base * PAD_EM} mask={maskOf(mask[i] ?? [], b.w)} focused={focused === s.key} />
          ));
        }) : null}
      </div>
      <p className="kb-visually-hidden" role="status" data-kb-report>{report || uncovered}</p>
    </div>
  );
}
