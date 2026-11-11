/**
 * The hands (the Autocorrect tape design, sections 6, 7, 8, 10 and 11; plan Task 7): what a pointer and a key do to tape, as a small
 * state machine with no DOM. The Effect measures, draws and saves; this decides. Time is the caller's own: `tick(ms)`.
 *
 * - **The author's peel** (section 6). Press within the larger of 16px and 0.9 of the piece's height of an end of a stuck stretch
 *   and hold for `pickMs`: a corner lifts as the hold goes on, and a hold let go early drops it back. Then the peel line follows the
 *   hand at no more than `pace`, the peeled tape rolling up at the line (`peelStep`). A hand more than `give` ahead strains the
 *   tape, and a full strain tears it: the roll drops, the new end is a tear, and it needs a new pick. A hand let go leaves the roll
 *   waiting at the peel line, which needs no pick when grabbed again. Either end of any stretch of any exposed piece works.
 * - **The roll is the stretch's edge.** A peel line is an edge of kind 1 and a tear an edge of kind 2 (autocorrect.ts), so a roll
 *   waiting and a tear are the saved state itself: nothing about them lives only here.
 * - **The keyboard** is the same peel with no hand: after the pick it asks for exactly `pace` and so never lags and never tears.
 *   It takes the end that has a roll, else the start of the first unfinished piece, and goes on to the next piece while held.
 * - **A reader's peek** (sections 7 and 8) lifts the carrier piece and then, on the same pull, the pieces `under` it, in turn
 *   (`liftsOf`). Letting go holds it for `peekStayMs`, then it lays down at `peekSettle` px a second (`settle`), or at once under
 *   reduced motion. Pressing any piece of a chain still up picks the pull up where it is. A held key lifts a piece's width every 0.45
 *   seconds. A peek changes no stuck model, so nothing a reader does is ever reported as a change.
 * - **Shares.** `sharesOf` gives a strip's stuck model back as the card's saved stretches (`fromPieces`), clamped, rounded to four
 *   places, with no empty stretch; an edge that was a line break and is no longer joined to its other half becomes a tear.
 */
import type { Stretch } from '../autocorrect.ts';
import { fromPieces, liftsOf, peelStep, rollDiameter, settle } from './tape.ts';

export interface HandSettings {
  /** The peel line's fastest speed, px a second. */
  readonly pace: number;
  /** The hold before a pick is up, ms. */
  readonly pickMs: number;
  /** How far ahead of the peel line the hand may be before the tape strains, px. */
  readonly give: number;
  /** How long a let-go peek stays up, ms. */
  readonly peekStayMs: number;
  /** How fast a let-go peek lays down, px a second. */
  readonly peekSettle: number;
  /** Reduced motion: a peek lays down at once when its stay ends. */
  readonly reduced: boolean;
  /** The post's author peels; anyone else peeks. */
  readonly author: boolean;
}

/** One piece of tape as the screen laid it, with its stuck stretches in the piece's local pixels. */
export interface PieceSpec {
  /** `${strip key}:${line}`. */
  readonly id: string;
  /** The strip's key, which a save is kept by. */
  readonly strip: string;
  /** Which line of the strip this is, from 0. */
  readonly index: number;
  readonly w: number;
  readonly h: number;
  readonly stuck: readonly Stretch[];
  /** Nothing live lies over it. */
  readonly open: boolean;
  /** Lower strips' pieces overlapping this one on its line, highest first: what a peek lifts after it. */
  readonly under: readonly string[];
}

export type Side = 'a' | 'b';

/** What the hands tell the Effect. */
export type HandEvent =
  | { readonly kind: 'change'; readonly strip: string }
  | { readonly kind: 'off'; readonly strip: string }
  | { readonly kind: 'covered'; readonly piece: string }
  | { readonly kind: 'drop'; readonly piece: string; readonly x: number; readonly side: Side; readonly rolled: number }
  | { readonly kind: 'torn'; readonly piece: string; readonly x: number };

/** What the Effect draws of one piece. Replaced only when something about it changed, so an unchanged piece keeps its object. */
export interface PieceView {
  /** The stretches stuck, local px. */
  readonly stuck: readonly Stretch[];
  /** What shows of them: the stuck stretches less the part a peek has lifted. */
  readonly shown: readonly Stretch[];
  /** Rolls of peeled tape at peel lines: `live` is the one in the hand. */
  readonly rolls: readonly { readonly x: number; readonly side: Side; readonly rolled: number; readonly live: boolean }[];
  /** The hand is ahead of the peel line: how much the tape strains, 0 to 1, and where. */
  readonly strain: { readonly side: Side; readonly at: number; readonly amount: number } | null;
  /** A pick is being held: how far the corner is up, 0 to 1. */
  readonly corner: { readonly side: Side; readonly at: number; readonly t: number } | null;
  /** A peek has this piece lifted from `side`, by `lift` px, folded at `fold`. */
  readonly lift: { readonly side: Side; readonly lift: number; readonly fold: number } | null;
}

interface Piece { spec: PieceSpec; stuck: Stretch[]; rev: number; cache: { rev: number; lift: number; view: PieceView } | null }
/** The one pointer down. `carrier` is set for a peek. */
interface Hand { readonly pointer: number | string; readonly piece: string; x: number; readonly x0: number; readonly carrier: string | null }
/** A peel in hand: `pick` is the ms held so far, or null once the pick is up. */
interface Work { readonly piece: string; readonly k: number; readonly side: Side; pick: number | null; rolled: number; strain: number }
interface Peek { readonly carrier: string; readonly side: Side; pull: number; base: number; since: number | null; key: boolean }

/** Peeling this close to the end of a stretch finishes it, as the bench does. */
const FINISHED = 1.5;
const KEY_PEEK_SECONDS = 0.45;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const startKind = (s: Stretch) => Math.floor(s[2] / 3);
const endKind = (s: Stretch) => s[2] % 3;
const withKind = (s: Stretch, side: Side, kind: number): Stretch => (side === 'a' ? [s[0], s[1], kind * 3 + endKind(s)] : [s[0], s[1], startKind(s) * 3 + kind]);
const sameStuck = (a: readonly Stretch[], b: readonly Stretch[]) => a.length === b.length && a.every((s, i) => Math.abs(s[0] - b[i]![0]) < 0.05 && Math.abs(s[1] - b[i]![1]) < 0.05 && s[2] === b[i]![2]);

/** `stuck` less the interval [from, to]. */
function without(stuck: readonly Stretch[], from: number, to: number): Stretch[] {
  const out: Stretch[] = [];
  for (const s of stuck) {
    if (s[1] <= from || s[0] >= to) { out.push(s); continue; }
    if (s[0] < from) out.push([s[0], from, startKind(s) * 3 + 0]);
    if (s[1] > to) out.push([to, s[1], 0 * 3 + endKind(s)]);
  }
  return out;
}

export class Hands {
  private settings: HandSettings;
  private readonly pieces = new Map<string, Piece>();
  private hand: Hand | null = null;
  private key: string | null = null;
  private work: Work | null = null;
  private readonly peeks = new Map<string, Peek>();
  private lifts = new Map<string, { side: Side; lift: number }>();
  private readonly out: HandEvent[] = [];
  private readonly changed = new Set<string>();

  constructor(settings: HandSettings) {
    this.settings = settings;
  }

  /** The settings as they stand now (they may change between visits to the settings page). */
  setSettings(settings: HandSettings): void {
    this.settings = settings;
  }

  /** Whether anything wants a tick: a pick or peel in hand, a peek held or laying down. */
  busy(): boolean {
    return this.work !== null || this.peeks.size > 0 || this.hand !== null || this.key !== null;
  }

  /** Takes the pieces as the screen has them. A piece in hand keeps its own model until it is let go; every other piece takes the spec's. True when a piece appeared, went or took a different model: its drawing is stale. */
  sync(specs: readonly PieceSpec[]): boolean {
    let changed = false;
    const seen = new Set<string>();
    for (const spec of specs) {
      seen.add(spec.id);
      const own = this.pieces.get(spec.id);
      if (!own) { this.pieces.set(spec.id, { spec, stuck: spec.stuck.map((s) => [s[0], s[1], s[2]] as const), rev: 0, cache: null }); changed = true; continue; }
      const resized = Math.abs(own.spec.w - spec.w) > 0.5 || Math.abs(own.spec.h - spec.h) > 0.5;
      const engaged = this.work?.piece === spec.id || this.hand?.piece === spec.id;
      own.spec = spec;
      if (resized && engaged) this.letGoOf(spec.id);
      const retake = (!engaged || resized) && !sameStuck(own.stuck, spec.stuck);
      if (retake) own.stuck = spec.stuck.map((s) => [s[0], s[1], s[2]] as const);
      if (resized || retake) { this.touch(own); changed = true; }
    }
    for (const id of [...this.pieces.keys()]) if (!seen.has(id)) { this.letGoOf(id); this.pieces.delete(id); changed = true; }
    for (const [carrier] of [...this.peeks]) if (!this.pieces.has(carrier)) this.peeks.delete(carrier);
    this.refreshLifts();
    return changed;
  }

  private letGoOf(id: string): void {
    if (this.hand?.piece === id) this.hand = null;
    if (this.work?.piece === id) this.work = null;
  }

  private bump(p: Piece): void {
    p.rev++;
    this.changed.add(p.spec.strip);
  }

  /** Marks a piece's drawing as stale without calling its stuck model changed. */
  private touch(p: Piece): void {
    p.rev++;
  }

  /** The hand goes down on `piece` at local `x`: 'covered', 'none' (not at an end), or what the press began. */
  press(piece: string, x: number, pointer: number | string): 'covered' | 'none' | 'busy' | 'picking' | 'peeling' | 'peeking' {
    const p = this.pieces.get(piece);
    if (!p) return 'none';
    if (this.hand || this.key) return 'busy';
    return this.settings.author ? this.pressPeel(p, x, pointer) : this.pressPeek(p, x, pointer);
  }

  private pressPeel(p: Piece, x: number, pointer: number | string): 'covered' | 'none' | 'picking' | 'peeling' {
    if (!p.spec.open) { this.out.push({ kind: 'covered', piece: p.spec.id }); return 'covered'; }
    const reach = Math.max(16, 0.9 * p.spec.h);
    let best: { k: number; side: Side; d: number } | null = null;
    p.stuck.forEach((s, k) => {
      for (const [side, at] of [['a', s[0]], ['b', s[1]]] as const) {
        const d = Math.abs(x - at);
        if (d <= reach && (!best || d < best.d)) best = { k, side, d };
      }
    });
    const hit = best as { k: number; side: Side; d: number } | null;
    if (!hit) return 'none';
    this.hand = { pointer, piece: p.spec.id, x, x0: x, carrier: null };
    return this.begin(p, hit.k, hit.side);
  }

  /** Starts work at an end: a peel line waiting there carries on with no pick, anything else needs one. */
  private begin(p: Piece, k: number, side: Side): 'picking' | 'peeling' {
    const s = p.stuck[k]!;
    const waiting = (side === 'a' ? startKind(s) : endKind(s)) === 1;
    this.work = { piece: p.spec.id, k, side, pick: waiting ? null : 0, rolled: waiting ? this.waited(p, k, side) : 0, strain: 0 };
    this.touch(p);
    return waiting ? 'peeling' : 'picking';
  }

  /** The tape peeled on a side of a stretch: from the one before it (or the piece's end) to its edge. */
  private waited(p: Piece, k: number, side: Side): number {
    const s = p.stuck[k]!;
    return side === 'a' ? s[0] - (k > 0 ? p.stuck[k - 1]![1] : 0) : (k < p.stuck.length - 1 ? p.stuck[k + 1]![0] : p.spec.w) - s[1];
  }

  private chainOf(carrier: string): string[] {
    const p = this.pieces.get(carrier);
    return p ? [carrier, ...p.spec.under.filter((id) => this.pieces.has(id))] : [];
  }

  private pressPeek(p: Piece, x: number, pointer: number | string): 'covered' | 'peeking' {
    /* A peek still up, on this piece or carried from the one above it, is picked up again where it is. */
    for (const pk of this.peeks.values()) {
      if (pk.pull > 0 && this.chainOf(pk.carrier).includes(p.spec.id)) {
        pk.since = null;
        this.hand = { pointer, piece: p.spec.id, x, x0: x, carrier: pk.carrier };
        pk.base = pk.pull;
        return 'peeking';
      }
    }
    if (!p.spec.open) { this.out.push({ kind: 'covered', piece: p.spec.id }); return 'covered'; }
    const side: Side = x < p.spec.w / 2 ? 'a' : 'b';
    const edge = side === 'a' ? (p.stuck[0]?.[0] ?? 0) : (p.stuck[p.stuck.length - 1]?.[1] ?? p.spec.w);
    this.peeks.set(p.spec.id, { carrier: p.spec.id, side, pull: 0, base: Math.max(0, side === 'a' ? x - edge : edge - x), since: null, key: false });
    this.hand = { pointer, piece: p.spec.id, x, x0: x, carrier: p.spec.id };
    return 'peeking';
  }

  move(pointer: number | string, x: number): void {
    if (this.hand && this.hand.pointer === pointer) this.hand.x = x;
  }

  release(pointer: number | string): void {
    if (!this.hand || this.hand.pointer !== pointer) return;
    const was = this.hand;
    this.hand = null;
    this.letGo(was.carrier);
  }

  /** What letting go does: a peek starts its stay; a pick not yet up drops back; a peel's roll waits where it is. */
  private letGo(carrier: string | null): void {
    if (carrier) {
      const pk = this.peeks.get(carrier);
      if (pk) pk.since = 0;
      return;
    }
    const w = this.work;
    this.work = null;
    const p = w && this.pieces.get(w.piece);
    if (p) this.touch(p);
  }

  /** A key goes down on a strip's anchor. False when nothing was begun (covered, nothing stuck, or a hand is busy). */
  keyDown(strip: string): boolean {
    if (this.hand || this.key) return false;
    const mine = [...this.pieces.values()].filter((p) => p.spec.strip === strip).sort((a, b) => a.spec.index - b.spec.index);
    if (!mine.length) return false;
    if (!this.settings.author) {
      const first = mine.find((p) => p.stuck.length > 0);
      if (!first) return false;
      const up = [...this.peeks.values()].find((pk) => pk.pull > 0 && this.chainOf(pk.carrier).includes(first.spec.id));
      if (!up && !first.spec.open) { this.out.push({ kind: 'covered', piece: first.spec.id }); return false; }
      const pk = up ?? { carrier: first.spec.id, side: 'a' as Side, pull: 0, base: 0, since: null, key: true };
      pk.since = null;
      pk.base = pk.pull;
      pk.key = true;
      this.peeks.set(pk.carrier, pk);
      this.key = strip;
      return true;
    }
    if (!mine.every((p) => p.spec.open)) { this.out.push({ kind: 'covered', piece: mine[0]!.spec.id }); return false; }
    if (!this.keyWork(mine)) return false;
    this.key = strip;
    return true;
  }

  /** Begins the key's peel on the first unfinished piece of a strip, from the end that has a roll, else the start. */
  private keyWork(mine: readonly Piece[]): boolean {
    const p = mine.find((q) => q.stuck.length > 0);
    if (!p) return false;
    let k = 0;
    let side: Side = 'a';
    const rolled = p.stuck.findIndex((s) => startKind(s) === 1 || endKind(s) === 1);
    if (rolled >= 0) { k = rolled; side = startKind(p.stuck[rolled]!) === 1 ? 'a' : 'b'; }
    this.begin(p, k, side);
    return true;
  }

  keyUp(): void {
    if (this.key === null) return;
    this.key = null;
    for (const pk of this.peeks.values()) if (pk.key) { pk.key = false; pk.since = 0; }
    if (this.work) this.letGo(null);
  }

  /** `ms` of time goes by. */
  tick(ms: number): void {
    const dt = ms / 1000;
    if (this.work) this.stepWork(ms, dt);
    for (const pk of [...this.peeks.values()]) this.stepPeek(pk, ms, dt);
    this.refreshLifts();
  }

  private stepWork(ms: number, dt: number): void {
    const w = this.work!;
    const p = this.pieces.get(w.piece);
    const s = p?.stuck[w.k];
    if (!p || !s) { this.work = null; return; }
    if (w.pick !== null) {
      w.pick += ms;
      if (w.pick >= this.settings.pickMs) w.pick = null;
      this.touch(p);
      return;
    }
    const lead = this.key !== null ? this.settings.pace * dt : this.hand ? (w.side === 'a' ? this.hand.x - s[0] : s[1] - this.hand.x) : 0;
    if (this.key === null && !this.hand) { this.work = null; return; }
    const r = peelStep({ rolled: w.rolled, strain: w.strain }, lead, dt, this.settings);
    w.rolled = r.rolled;
    w.strain = r.strain;
    let next = s;
    if (r.moved > 0) next = withKind(w.side === 'a' ? [s[0] + r.moved, s[1], s[2]] : [s[0], s[1] - r.moved, s[2]], w.side, 1);
    p.stuck[w.k] = next;
    const at = w.side === 'a' ? next[0] : next[1];
    if (next[1] - next[0] <= FINISHED) {
      p.stuck.splice(w.k, 1);
      this.out.push({ kind: 'drop', piece: p.spec.id, x: at, side: w.side, rolled: w.rolled });
      this.work = null;
      this.bump(p);
      if (![...this.pieces.values()].some((q) => q.spec.strip === p.spec.strip && q.stuck.length > 0)) {
        /* The strip is off: a key still held does not go on to the next strip, which is another layer and its own peel. */
        this.key = null;
        this.out.push({ kind: 'off', strip: p.spec.strip });
      }
      else if (this.key !== null) this.keyWork([...this.pieces.values()].filter((q) => q.spec.strip === p.spec.strip).sort((a, b) => a.spec.index - b.spec.index));
      return;
    }
    if (r.tore) {
      p.stuck[w.k] = withKind(next, w.side, 2);
      this.out.push({ kind: 'drop', piece: p.spec.id, x: at, side: w.side, rolled: w.rolled }, { kind: 'torn', piece: p.spec.id, x: at });
      this.work = null;
      this.bump(p);
      return;
    }
    if (r.moved > 0) this.bump(p); else this.touch(p);
  }

  private stepPeek(pk: Peek, ms: number, dt: number): void {
    const p = this.pieces.get(pk.carrier);
    if (!p) { this.peeks.delete(pk.carrier); return; }
    const total = this.chainOf(pk.carrier).reduce((t, id) => t + (this.pieces.get(id)?.spec.w ?? 0), 0);
    if (this.hand?.carrier === pk.carrier) pk.pull = Math.max(0, pk.base + (this.hand.x - this.hand.x0) * (pk.side === 'a' ? 1 : -1));
    else if (pk.key) pk.pull += (p.spec.w / KEY_PEEK_SECONDS) * dt;
    else if (pk.since !== null) {
      if (this.settings.reduced) {
        if (pk.since + ms >= this.settings.peekStayMs) pk.pull = 0;
        pk.since += ms;
      } else {
        const r = settle(pk.pull, this.settings.peekStayMs, pk.since, ms, this.settings.peekSettle);
        pk.pull = r.pull;
        pk.since = r.since;
      }
    }
    pk.pull = Math.min(pk.pull, total);
    if (pk.pull <= 0 && pk.since !== null) this.peeks.delete(pk.carrier);
  }

  /** The lifts every peek gives its chain, and a stale mark on every piece whose lift changed. */
  private refreshLifts(): void {
    const next = new Map<string, { side: Side; lift: number }>();
    for (const pk of this.peeks.values()) {
      const ids = this.chainOf(pk.carrier);
      const lifts = liftsOf(pk.pull, ids.map((id) => this.pieces.get(id)!.spec.w));
      ids.forEach((id, i) => {
        const lift = lifts[i] ?? 0;
        if (lift > 0 && lift > (next.get(id)?.lift ?? 0)) next.set(id, { side: pk.side, lift });
      });
    }
    for (const id of new Set([...this.lifts.keys(), ...next.keys()])) {
      const a = this.lifts.get(id), b = next.get(id);
      if (a?.lift !== b?.lift || a?.side !== b?.side) { const p = this.pieces.get(id); if (p) this.touch(p); }
    }
    this.lifts = next;
  }

  /** What the Effect draws of a piece. The same object while nothing about the piece has changed. */
  view(id: string): PieceView {
    const p = this.pieces.get(id);
    if (!p) return { stuck: [], shown: [], rolls: [], strain: null, corner: null, lift: null };
    if (p.cache && p.cache.rev === p.rev) return p.cache.view;
    const lifted = this.lifts.get(id);
    const first = p.stuck[0]?.[0] ?? 0, last = p.stuck[p.stuck.length - 1]?.[1] ?? p.spec.w;
    const shown = lifted ? (lifted.side === 'a' ? without(p.stuck, first, first + lifted.lift) : without(p.stuck, last - lifted.lift, last)) : p.stuck;
    const w = this.work?.piece === id ? this.work : null;
    const rolls: { x: number; side: Side; rolled: number; live: boolean }[] = [];
    p.stuck.forEach((s, k) => {
      for (const side of ['a', 'b'] as const) {
        if ((side === 'a' ? startKind(s) : endKind(s)) !== 1) continue;
        const live = w !== null && w.pick === null && w.k === k && w.side === side;
        rolls.push({ x: side === 'a' ? s[0] : s[1], side, rolled: live ? w.rolled : this.waited(p, k, side), live });
      }
    });
    if (w && w.pick === null && !rolls.some((r) => r.live)) {
      const s = p.stuck[w.k]!;
      rolls.push({ x: w.side === 'a' ? s[0] : s[1], side: w.side, rolled: w.rolled, live: true });
    }
    const edge = w ? (w.side === 'a' ? p.stuck[w.k]![0] : p.stuck[w.k]![1]) : 0;
    const view: PieceView = {
      stuck: p.stuck,
      shown,
      rolls,
      strain: w && w.pick === null && w.strain > 0.02 ? { side: w.side, at: edge, amount: w.strain } : null,
      corner: w && w.pick !== null ? { side: w.side, at: edge, t: Math.min(1, w.pick / Math.max(1, this.settings.pickMs)) } : null,
      lift: lifted ? { side: lifted.side, lift: lifted.lift, fold: lifted.side === 'a' ? first + lifted.lift : last - lifted.lift } : null,
    };
    p.cache = { rev: p.rev, lift: lifted?.lift ?? 0, view };
    return view;
  }

  /** The diameter a roll of `rolled` px has. */
  static diameter(rolled: number): number {
    return rollDiameter(rolled);
  }

  /** A strip's stuck model as the card saves it: shares from 0 to 1, rounded to four places, none empty, each edge a kind the card accepts. */
  sharesOf(strip: string): Stretch[] {
    const mine = [...this.pieces.values()].filter((p) => p.spec.strip === strip).sort((a, b) => a.spec.index - b.spec.index);
    const widths = mine.map((p) => p.spec.w);
    const joined = fromPieces(mine.map((p) => p.stuck), widths);
    const out: Stretch[] = [];
    for (const [from, to, edges] of joined) {
      const a = round4(clamp01(from)), b = round4(clamp01(to));
      if (!(a < b)) continue;
      const prev = out[out.length - 1];
      if (prev && a < prev[1]) continue;
      /* A line break that no longer joins to its other half is a place a hand has to pick: a tear is the only edge that says so. */
      const start = Math.floor(edges / 3) === 0 && a !== 0 ? 2 : Math.floor(edges / 3);
      const end = edges % 3 === 0 && b !== 1 ? 2 : edges % 3;
      out.push([a, b, start * 3 + end]);
    }
    return out;
  }

  /** The events since the last call, and one `change` for each strip whose stuck model changed. */
  drain(): HandEvent[] {
    const out = [...this.out, ...[...this.changed].map((strip): HandEvent => ({ kind: 'change', strip }))];
    this.out.length = 0;
    this.changed.clear();
    return out;
  }
}
