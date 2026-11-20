/**
 * The hands (the Autocorrect tape design, sections 6, 7, 8, 10 and 11, and the feel design, sections 1 to 4; plan Tasks 7 and
 * feel-2): what a pointer and a key do to tape, as a small state machine with no DOM. The Effect measures, draws and saves; this
 * decides. Time is the caller's own: `tick(ms)`.
 *
 * - **Peek or pick, by how the hand starts.** A drag peeks, for everyone (a reader's peek, below). The author out of the hold who
 *   presses within the larger of 16px and 0.9 of the piece's height of an end of a stuck stretch begins a *pending* pick: the hand
 *   holds still and a corner lifts (after `cornerDelayMs`, so a quick drag never flashes one) until `pickMs`, when `picked` is
 *   said once and from then on the hand peels. A hand that moves more than `slop` before then drops the pick, and the same press
 *   becomes a peek lifted from where it went down. A press anywhere else on an open piece peeks.
 * - **The author's peel.** After the pick the peel line follows the hand at no more than `pace`, the peeled tape rolling up at the
 *   line (`peelStep`). A hand more than `give` ahead strains the tape, and a full strain tears it: the roll drops, the new end is a
 *   tear, and it needs a new pick. A hand let go leaves the roll waiting at the peel line, which needs no pick, pending or not,
 *   when grabbed again. Either end of any stretch of any exposed piece works.
 * - **Unrolling.** A roll in hand (a pick up, or a waiting roll grabbed) follows a hand *behind* its line back the way it came, and
 *   the tape it takes up goes down again, at the peel's `pace`. It never strains and never tears: strain only drains. It stops at
 *   the roll's root, the nearest of where a roll last fell on that side (`drops`), the neighbor stretch's edge and the piece's end;
 *   at the piece's end the edge is kind 0 again, at a neighbor the two stretches join, and at a drop it is a tear again.
 * - **The roll is the stretch's edge.** A peel line is an edge of kind 1 and a tear an edge of kind 2 (autocorrect.ts), so a roll
 *   waiting and a tear are the saved state itself. Where rolls fell is not: a piece keeps `drops` in local px, a tear adding its
 *   place and a finished stretch its far end, so an unroll never brings back tape that fell.
 * - **The keyboard** has three modes. `peek` is the reader's key for everyone; `peel` is the author's peel with no hand (after the
 *   pick it asks for exactly `pace`, never lags and never tears, takes the end that has a roll, else the start of the first
 *   unfinished piece, and goes on to the next piece while held); `unroll` takes the first waiting roll in reading order back at
 *   `pace` until its root or key-up.
 * - **A reader's peek** (sections 7 and 8) lifts the carrier piece and then, on the same pull, the pieces `under` it, in turn
 *   (`liftsOf`). A key's peek goes on from there to the strip's later lines, each with the pieces under it, since a key cannot press them. Letting go holds it for `peekStayMs`, then it lays down at `peekSettle` px a second (`settle`), or at once under
 *   reduced motion. Pressing any piece of a chain still up picks the pull up where it is. A held key lifts a piece's width every 0.45
 *   seconds. A peek changes no stuck model, so nothing a reader does is ever reported as a change.
 * - **Shares.** `sharesOf` gives a strip's stuck model back as the card's saved stretches (`fromPieces`), clamped, rounded to four
 *   places, with no empty stretch; an edge that was a line break and is no longer joined to its other half becomes a peel line.
 *   `dropsOf` gives the drops the same way, joined over the pieces' widths, rounded, in order, each once, none inside a stuck stretch.
 */
import type { Stretch } from '../autocorrect.ts';
import { fromPieces, liftsOf, peelStep, settle } from './tape.ts';

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
  /** How far a pending pick's hand may move before the press is a peek instead, px. */
  readonly slop: number;
  /** How long a pick is held before its corner shows, ms. */
  readonly cornerDelayMs: number;
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
  /** The author's hold on this piece's play is running: the author peeks it as a reader does. */
  readonly held: boolean;
  /** Where rolls fell on this piece, local px (none when the save has none). */
  readonly drops?: readonly number[];
}

export type Side = 'a' | 'b';

/** What the hands tell the Effect. */
export type HandEvent =
  | { readonly kind: 'change'; readonly strip: string }
  | { readonly kind: 'off'; readonly strip: string }
  | { readonly kind: 'covered'; readonly piece: string }
  | { readonly kind: 'drop'; readonly piece: string; readonly x: number; readonly side: Side; readonly rolled: number }
  | { readonly kind: 'torn'; readonly piece: string; readonly x: number }
  /** A pick is up: the corner stands and the hand peels from here (the Effect buzzes). */
  | { readonly kind: 'picked'; readonly piece: string };

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

interface Piece { spec: PieceSpec; stuck: Stretch[]; drops: number[]; rev: number; cache: { rev: number; view: PieceView } | null }
/** The one pointer down. `carrier` is set for a peek. */
interface Hand { readonly pointer: number | string; readonly piece: string; x: number; readonly x0: number; carrier: string | null }
/**
 * A peel in hand: `pick` is the ms held so far, or null once the pick is up. `pending` is the peek a pointer's pick becomes if the
 * hand moves past slop first. `unroll` is a key's unroll, which moves its line back at pace.
 */
interface Work { readonly piece: string; readonly k: number; readonly side: Side; pick: number | null; rolled: number; strain: number; pending?: Peek; unroll?: boolean }
/** `along` is a key's peek: its chain goes on past the carrier's line to the strip's later lines, so the keyboard can reach them. */
interface Peek { readonly carrier: string; readonly side: Side; pull: number; base: number; since: number | null; key: boolean; dirty: boolean; along?: boolean }

/** Peeling this close to the end of a stretch finishes it, as the bench does. */
const FINISHED = 1.5;
const KEY_PEEK_SECONDS = 0.45;
const EPS = 1e-6;
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

  /** Whether anything wants a tick: a pick or peel in hand, a peek being pulled, held by a key or laying down. A pointer held still with nothing to do does not. */
  busy(): boolean {
    if (this.work) return true;
    for (const pk of this.peeks.values()) if (pk.key || pk.since !== null || pk.dirty) return true;
    return false;
  }

  /** Takes the pieces as the screen has them. A piece in hand keeps its own model until it is let go; every other piece takes the spec's. True when a piece appeared, went or took a different model: its drawing is stale. */
  sync(specs: readonly PieceSpec[]): boolean {
    let changed = false;
    const seen = new Set<string>();
    for (const spec of specs) {
      seen.add(spec.id);
      const own = this.pieces.get(spec.id);
      if (own?.spec === spec) continue;
      if (!own) { this.pieces.set(spec.id, { spec, stuck: spec.stuck.map((s) => [s[0], s[1], s[2]] as const), drops: [...(spec.drops ?? [])], rev: 0, cache: null }); changed = true; continue; }
      const resized = Math.abs(own.spec.w - spec.w) > 0.5 || Math.abs(own.spec.h - spec.h) > 0.5;
      const engaged = this.work?.piece === spec.id || this.hand?.piece === spec.id;
      own.spec = spec;
      if (resized && engaged) this.letGoOf(spec.id);
      const retake = (!engaged || resized) && !sameStuck(own.stuck, spec.stuck);
      if (retake) { own.stuck = spec.stuck.map((s) => [s[0], s[1], s[2]] as const); own.drops = [...(spec.drops ?? [])]; }
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
  press(piece: string, x: number, pointer: number | string): 'covered' | 'none' | 'busy' | 'pending' | 'peeling' | 'peeking' {
    const p = this.pieces.get(piece);
    if (!p) return 'none';
    if (this.hand || this.key) return 'busy';
    return this.settings.author && !p.spec.held ? this.pressAuthor(p, x, pointer) : this.pressPeek(p, x, pointer);
  }

  /** Whether a peek is still up over this piece, on it or carried from the piece above. */
  private upOn(id: string): Peek | undefined {
    for (const pk of this.peeks.values()) if (pk.pull > 0 && this.chainOf(pk.carrier).includes(id)) return pk;
    return undefined;
  }

  /** The author out of the hold: a waiting roll's grip peels at once, any other end begins a pending pick, anywhere else peeks. */
  private pressAuthor(p: Piece, x: number, pointer: number | string): 'covered' | 'pending' | 'peeling' | 'peeking' {
    if (this.upOn(p.spec.id)) return this.pressPeek(p, x, pointer);
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
    if (!hit) return this.pressPeek(p, x, pointer);
    this.hand = { pointer, piece: p.spec.id, x, x0: x, carrier: null };
    const s = p.stuck[hit.k]!;
    if ((hit.side === 'a' ? startKind(s) : endKind(s)) === 1) {
      this.begin(p, hit.k, hit.side);
      return 'peeling';
    }
    this.work = { piece: p.spec.id, k: hit.k, side: hit.side, pick: 0, rolled: 0, strain: 0, pending: this.peekFor(p, x) };
    this.touch(p);
    return 'pending';
  }

  /** Starts a roll in hand at a waiting peel line: it peels on, or unrolls, with no pick. */
  private begin(p: Piece, k: number, side: Side, unroll = false): void {
    this.work = { piece: p.spec.id, k, side, pick: null, rolled: this.rollOf(p, k, side), strain: 0, ...(unroll ? { unroll } : {}) };
    this.touch(p);
  }

  /** Starts a pick (a key's): the peel waits for `pickMs`. */
  private pick(p: Piece, k: number, side: Side): void {
    const s = p.stuck[k]!;
    if ((side === 'a' ? startKind(s) : endKind(s)) === 1) { this.begin(p, k, side); return; }
    this.work = { piece: p.spec.id, k, side, pick: 0, rolled: 0, strain: 0 };
    this.touch(p);
  }

  /** Where the tape rolled on a side of a stretch is rooted: the nearest of the last drop on that side, the neighbor stretch's edge and the piece's end. */
  private rootOf(p: Piece, k: number, side: Side): { at: number; kind: 'drop' | 'neighbor' | 'end' } {
    const s = p.stuck[k]!;
    if (side === 'a') {
      let best: { at: number; kind: 'drop' | 'neighbor' | 'end' } = { at: 0, kind: 'end' };
      const prev = p.stuck[k - 1];
      if (prev && prev[1] > best.at) best = { at: prev[1], kind: 'neighbor' };
      for (const d of p.drops) if (d <= s[0] + EPS && d >= best.at - EPS) best = { at: d, kind: 'drop' };
      return best;
    }
    let best: { at: number; kind: 'drop' | 'neighbor' | 'end' } = { at: p.spec.w, kind: 'end' };
    const next = p.stuck[k + 1];
    if (next && next[0] < best.at) best = { at: next[0], kind: 'neighbor' };
    for (const d of p.drops) if (d >= s[1] - EPS && d <= best.at + EPS) best = { at: d, kind: 'drop' };
    return best;
  }

  /** The tape rolled on a side of a stretch: from its edge to its root. */
  private rollOf(p: Piece, k: number, side: Side): number {
    const s = p.stuck[k]!;
    const root = this.rootOf(p, k, side).at;
    return Math.max(0, side === 'a' ? s[0] - root : root - s[1]);
  }

  private chainOf(carrier: string): string[] {
    const p = this.pieces.get(carrier);
    if (!p) return [];
    /* A lower piece already peeled off is not in the chain: a pull is never spent lifting tape that is not there. */
    const stuck = (id: string) => (this.pieces.get(id)?.stuck.length ?? 0) > 0;
    const own = [carrier, ...p.spec.under.filter(stuck)];
    if (!this.peeks.get(carrier)?.along) return own;
    /* A key has no pointer to press the next line of a wrapped strip, so its pull goes on to each later line in turn, each after what lies under the one before. */
    const later = [...this.pieces.values()].filter((q) => q.spec.strip === p.spec.strip && q.spec.index > p.spec.index && q.stuck.length > 0).sort((a, b) => a.spec.index - b.spec.index);
    return [...own, ...later.flatMap((q) => [q.spec.id, ...q.spec.under.filter(stuck)])];
  }

  /** The peek a press at `x` on a piece lifts: from the nearer end, a pull of 0 from where the hand went down. */
  private peekFor(p: Piece, x: number): Peek {
    const side: Side = x < p.spec.w / 2 ? 'a' : 'b';
    const edge = side === 'a' ? (p.stuck[0]?.[0] ?? 0) : (p.stuck[p.stuck.length - 1]?.[1] ?? p.spec.w);
    return { carrier: p.spec.id, side, pull: 0, base: Math.max(0, side === 'a' ? x - edge : edge - x), since: null, key: false, dirty: true };
  }

  private pressPeek(p: Piece, x: number, pointer: number | string): 'covered' | 'peeking' {
    /* A peek still up, on this piece or carried from the one above it, is picked up again where it is. */
    const up = this.upOn(p.spec.id);
    if (up) {
      up.since = null;
      up.dirty = true;
      this.hand = { pointer, piece: p.spec.id, x, x0: x, carrier: up.carrier };
      up.base = up.pull;
      return 'peeking';
    }
    if (!p.spec.open) { this.out.push({ kind: 'covered', piece: p.spec.id }); return 'covered'; }
    this.peeks.set(p.spec.id, this.peekFor(p, x));
    this.hand = { pointer, piece: p.spec.id, x, x0: x, carrier: p.spec.id };
    return 'peeking';
  }

  move(pointer: number | string, x: number): void {
    if (!this.hand || this.hand.pointer !== pointer) return;
    this.hand.x = x;
    const pending = this.work?.pending;
    if (pending && this.work && Math.abs(x - this.hand.x0) > this.settings.slop) {
      /* Moved before the pick was up: the pick is dropped, and the same press is a peek, lifted from where the hand went down. */
      const p = this.pieces.get(this.work.piece);
      this.work = null;
      this.peeks.set(pending.carrier, pending);
      this.hand.carrier = pending.carrier;
      if (p) this.touch(p);
    }
    const pk = this.hand.carrier ? this.peeks.get(this.hand.carrier) : undefined;
    if (pk) pk.dirty = true;
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

  /**
   * A key goes down on a strip's anchor. 'peek' lifts it as a reader's key does, for everyone; 'peel' is the author's pick and peel
   * (refused while held); 'unroll' takes the first waiting roll back down. False when nothing was begun (covered, nothing stuck,
   * no roll to press back, or a hand is busy).
   */
  keyDown(strip: string, mode: 'peek' | 'peel' | 'unroll'): boolean {
    if (this.hand || this.key) return false;
    const mine = [...this.pieces.values()].filter((p) => p.spec.strip === strip).sort((a, b) => a.spec.index - b.spec.index);
    if (!mine.length) return false;
    if (mode === 'peek') {
      const first = mine.find((p) => p.stuck.length > 0);
      if (!first) return false;
      const up = [...this.peeks.values()].find((pk) => pk.pull > 0 && this.chainOf(pk.carrier).includes(first.spec.id));
      if (!up && !first.spec.open) { this.out.push({ kind: 'covered', piece: first.spec.id }); return false; }
      const pk = up ?? { carrier: first.spec.id, side: 'a' as Side, pull: 0, base: 0, since: null, key: true, dirty: true };
      pk.since = null;
      pk.base = pk.pull;
      pk.key = true;
      pk.along = true;
      this.peeks.set(pk.carrier, pk);
      this.key = strip;
      return true;
    }
    if (!this.settings.author || mine[0]!.spec.held) return false;
    if (!mine.every((p) => p.spec.open)) { this.out.push({ kind: 'covered', piece: mine[0]!.spec.id }); return false; }
    if (!(mode === 'peel' ? this.keyWork(mine) : this.keyUnroll(mine))) return false;
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
    this.pick(p, k, side);
    return true;
  }

  /** Takes the first waiting roll in reading order, if it has any tape to give back. */
  private keyUnroll(mine: readonly Piece[]): boolean {
    for (const p of mine) {
      for (let k = 0; k < p.stuck.length; k++) {
        for (const side of ['a', 'b'] as const) {
          const kind = side === 'a' ? startKind(p.stuck[k]!) : endKind(p.stuck[k]!);
          if (kind !== 1 || this.rollOf(p, k, side) < EPS) continue;
          this.begin(p, k, side, true);
          return true;
        }
      }
    }
    return false;
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
    /* A hand whose piece has nothing left to hold lets go: its piece may be gone from the page, and no pointerup would come. */
    if (this.hand && !this.hand.carrier && !this.work && (this.pieces.get(this.hand.piece)?.stuck.length ?? 0) === 0) this.hand = null;
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
      if (w.pick >= this.settings.pickMs) {
        w.pick = null;
        delete w.pending;
        this.out.push({ kind: 'picked', piece: p.spec.id });
      }
      this.touch(p);
      return;
    }
    if (this.key === null && !this.hand) { this.work = null; return; }
    const lead = this.key !== null ? (w.unroll ? -this.settings.pace * dt : this.settings.pace * dt) : (w.side === 'a' ? this.hand!.x - s[0] : s[1] - this.hand!.x);
    if (lead < 0) { this.unroll(p, w, -lead, dt); return; }
    const r = peelStep({ rolled: w.rolled, strain: w.strain }, lead, dt, this.settings);
    w.rolled = r.rolled;
    w.strain = r.strain;
    let next = s;
    if (r.moved > 0) next = withKind(w.side === 'a' ? [s[0] + r.moved, s[1], s[2]] : [s[0], s[1] - r.moved, s[2]], w.side, 1);
    p.stuck[w.k] = next;
    const at = w.side === 'a' ? next[0] : next[1];
    if (next[1] - next[0] <= FINISHED) {
      p.stuck.splice(w.k, 1);
      /* The roll falls at the far end of the stretch it travelled to. */
      p.drops.push(w.side === 'a' ? next[1] : next[0]);
      this.out.push({ kind: 'drop', piece: p.spec.id, x: at, side: w.side, rolled: w.rolled });
      this.work = null;
      if (p.stuck.length === 0 && this.hand?.piece === p.spec.id) this.hand = null;
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
      p.drops.push(at);
      this.out.push({ kind: 'drop', piece: p.spec.id, x: at, side: w.side, rolled: w.rolled }, { kind: 'torn', piece: p.spec.id, x: at });
      this.work = null;
      this.bump(p);
      return;
    }
    if (r.moved > 0) this.bump(p); else this.touch(p);
  }

  /** The roll's line goes back toward a hand behind it, at no more than pace, and stops at the roll's root. It never strains. */
  private unroll(p: Piece, w: Work, back: number, dt: number): void {
    const s = p.stuck[w.k]!;
    w.strain = Math.max(0, w.strain - 2.5 * dt);
    const root = this.rootOf(p, w.k, w.side);
    /* How far the root is, from the edge alone: what `rolled` says was taken up since a pick never stops an unroll short of it. */
    const room = Math.max(0, w.side === 'a' ? s[0] - root.at : root.at - s[1]);
    const moved = Math.min(peelStep({ rolled: w.rolled, strain: 0 }, back, dt, this.settings).moved, room);
    if (!(moved > 0)) { this.touch(p); return; }
    const reached = moved >= room - EPS;
    w.rolled = reached ? 0 : Math.max(0, w.rolled - moved);
    const edge = reached ? root.at : (w.side === 'a' ? s[0] - moved : s[1] + moved);
    if (!reached) {
      p.stuck[w.k] = withKind(w.side === 'a' ? [edge, s[1], s[2]] : [s[0], edge, s[2]], w.side, 1);
    } else if (root.kind === 'neighbor') {
      /* Back at the neighbor stretch: the two are one stretch again, with their outer kinds. */
      const other = w.side === 'a' ? p.stuck[w.k - 1]! : p.stuck[w.k + 1]!;
      const joined: Stretch = w.side === 'a' ? [other[0], s[1], startKind(other) * 3 + endKind(s)] : [s[0], other[1], startKind(s) * 3 + endKind(other)];
      p.stuck.splice(w.side === 'a' ? w.k - 1 : w.k, 2, joined);
      this.work = null;
    } else {
      /* The piece's end is the strip's own end again; where a roll fell, the tape ends as a tear. */
      p.stuck[w.k] = withKind(w.side === 'a' ? [edge, s[1], s[2]] : [s[0], edge, s[2]], w.side, root.kind === 'end' ? 0 : 2);
      this.work = null;
    }
    this.bump(p);
  }

  private stepPeek(pk: Peek, ms: number, dt: number): void {
    const p = this.pieces.get(pk.carrier);
    if (!p) { this.peeks.delete(pk.carrier); return; }
    const total = this.chainOf(pk.carrier).reduce((t, id) => t + (this.pieces.get(id)?.spec.w ?? 0), 0);
    if (this.hand?.carrier === pk.carrier) { pk.pull = Math.max(0, pk.base + (this.hand.x - this.hand.x0) * (pk.side === 'a' ? 1 : -1)); pk.dirty = false; }
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
        if (!live && this.rollOf(p, k, side) < 0.5) continue;
        rolls.push({ x: side === 'a' ? s[0] : s[1], side, rolled: live ? w.rolled : this.rollOf(p, k, side), live });
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
      corner: w && w.pick !== null && w.pick >= this.settings.cornerDelayMs ? { side: w.side, at: edge, t: clamp01((w.pick - this.settings.cornerDelayMs) / Math.max(1, this.settings.pickMs - this.settings.cornerDelayMs)) } : null,
      lift: lifted ? { side: lifted.side, lift: lifted.lift, fold: lifted.side === 'a' ? first + lifted.lift : last - lifted.lift } : null,
    };
    p.cache = { rev: p.rev, view };
    return view;
  }

  /** A strip's stuck model as the card saves it: shares from 0 to 1, rounded to four places, none empty, each edge a kind the card accepts. */
  sharesOf(strip: string): Stretch[] {
    const mine = [...this.pieces.values()].filter((p) => p.spec.strip === strip).sort((a, b) => a.spec.index - b.spec.index);
    const widths = mine.map((p) => p.spec.w);
    const joined = fromPieces(mine.map((p) => p.stuck), widths);
    const out: Stretch[] = [];
    for (const [from, to, edges] of joined) {
      const prev = out[out.length - 1];
      /* Rounding may leave a start a hair under the last end: it moves up to it, and only a stretch that leaves nothing is dropped. */
      const a = Math.max(round4(clamp01(from)), prev ? prev[1] : 0), b = round4(clamp01(to));
      if (!(a < b)) continue;
      /* A line break that no longer joins to its other half is a peel line, where a roll waits and no pick is needed: never a tear. */
      const start = Math.floor(edges / 3) === 0 && a !== 0 ? 1 : Math.floor(edges / 3);
      const end = edges % 3 === 0 && b !== 1 ? 1 : edges % 3;
      out.push([a, b, start * 3 + end]);
    }
    return out;
  }

  /** A strip's drops as the card saves them: shares from 0 to 1 over the pieces' widths, rounded to four places, in order, each once, none strictly inside a stretch still stuck. */
  dropsOf(strip: string): number[] {
    const mine = [...this.pieces.values()].filter((p) => p.spec.strip === strip).sort((a, b) => a.spec.index - b.spec.index);
    const length = mine.reduce((n, p) => n + p.spec.w, 0);
    if (!(length > 0)) return [];
    const stuck = this.sharesOf(strip);
    const shares = new Set<number>();
    let off = 0;
    for (const p of mine) {
      for (const d of p.drops) shares.add(round4(clamp01((off + d) / length)));
      off += p.spec.w;
    }
    return [...shares].sort((a, b) => a - b).filter((x) => !stuck.some(([from, to]) => from < x && x < to));
  }

  /** The events since the last call, and one `change` for each strip whose stuck model changed. */
  drain(): HandEvent[] {
    const out = [...this.out, ...[...this.changed].map((strip): HandEvent => ({ kind: 'change', strip }))];
    this.out.length = 0;
    this.changed.clear();
    return out;
  }
}
