/**
 * Steel Chair's effect (docs/plans/2026-11-15-steel-chair-plan.md, Task 5, as amended: the world is the post's content area): a folding
 * chair is thrown at the post from any direction, dents it (the words bend into a displacement filter's dent, shaded over them), shakes it
 * once and falls to the floor as a rigid box (body.ts), where it tips, slides and sleeps. Up to three at once, each its own throw 0.35 s
 * of the world's own time after the last (see Frames). Nothing is seeded, saved or sent: each run draws its throws from a generator seeded
 * freshly from the reader's own screen (`crypto.getRandomValues`), so every run and every reader sees a different one, and the effect reads neither who wrote the post nor who
 * played the card. A play's moment (`moment`) is the live run: the engine hands it the plays as they stood at the moment's time, and the post
 * is thrown at as a live post's is, but its plays' ends are not judged (a moment draws every play handed).
 *
 * Where. The chairs' layer and the dents' shading fill the post's content area border to border, placed the way Feelin' Fab's foil and
 * Whoops!'s ink are (engine/ui/cards/body.ts: `bodyOf`, `bodyBox`, `placeLayer`, the bare `data-kb-effect-ink` mark the thread's CSS lifts
 * above the words). That box is the physics world: its left and right borders are the walls and its bottom border the floor; chair.ts draws
 * the world in an oblique view (the floor recedes up the screen), so a chair at rest is drawn inside the box, never past a border. Where
 * there is no body (no content area above the effect) the effect's own box is the world. A `ResizeObserver` on the box (and the host) resizes the world and
 * places the layers again. The words are the engine's words box (`wordsBoxOf`, engine/ui/cards/body.ts: `data-kb-words-box`) inside the host, and the
 * effect draws no wrapper of its own; the throw aims at the box the text really takes (a Range's client rects: a short post's words box is as wide as
 * the content area), and the words' filter is in the words box's coordinates, not the content area's: `geo` holds the measured offset between the two,
 * and the area's own size. The floor's room is the content area's own
 * last ROOM_HEIGHT px (chair.ts, the height of the tallest rest), so a resting chair reaches neither the reactions row nor the words: the
 * effect marks the body it found (`data-dw-chair-room`, the nearest content area, so a chair in a spun thread's ORIGIN box makes room in the
 * box and not in the opening post's body around it) and steel-chair.css draws the room at the foot of whatever is marked; only where there
 * is no content area is it a strip in the host (`.dw-chair-room`, hidden where the host is `data-kb-bleed`). Nothing
 * here assumes the content area is as tall as its words plus the room: the world, the layers and the dents' coordinates are all measured boxes
 * (`bodyBox`, the words box's client rect against the host's, the text's client rects), the room is the content area's last child so it stays at the floor however tall
 * the body is, and the floor is the area's bottom border.
 *
 * Where the filter stands (docs/plans/2026-11-23-dent-bend-design.md, 1 and 2). A CSS filter on an element clips everything inside it to its region
 * and makes it a stacking context, so a filter on the words' wrapper clipped and trapped every layer that fills the content area (a foil under the
 * words) when a chair was played after it. So no element of the effect's carries a filter. The effect builds two filters from the same dents and gives
 * them to the engine with `setBend`: one in the content area's coordinates, which each layer marked `data-kb-bend` wears (a layer is bent whether its
 * card was played before the chair or after it), and one in the words box's coordinates, which the words box wears. Where there is no content area
 * (Stick Around's view) only the words' filter is set, on the host. The hit's shake is an attribute on the content area (`data-dw-chair-shake`), or on
 * the host where there is none, so the whole post shakes, layers and all.
 *
 * The dents. Each is a pressed-in plate of metal: a height map made from its play's id alone (dent.ts `dentShape`, `dentHeight`), the same
 * for every reader and on every replay, while where it lands is the run's, in an ellipse's box (within 15% of round). One light, fixed in the
 * world, falls on every dent from the upper left (dent.ts `LIGHT`), and the map is drawn as three images (`dentImages`): the bend, which the
 * displacement's `feImage` takes (stretched to the box), and a shade and a light, which the two shading layers lay over the words (a dark
 * side and a bright rim and glint). There is nothing else to a dent: no crease, no turned shading. The shade is black and the light white, each
 * with its own alpha and laid on plainly, with no blend (steel-chair.css): a blend takes its backdrop from the nearest stacking context, which a
 * place that shows a post may leave empty. So that overlapping dents are still as dark as the darkest and as bright as the brightest of them, not
 * their sum, a dent is drawn from an image corrected against the dents before it in the order they landed (`dentImages`' `earlier`, dent.ts
 * `capped`), all in the content area's px. Where the text is shorter than a dent the throw aims at a box grown around it (dent.ts `hitZone`),
 * so three dents do not stack on one line. A dent is sized and aimed in the zone it may land in (dent.ts `zoneHeight`, `Geo.zone`): the content
 * area less the chairs' room where that leaves at least LEAST_ZONE, else the whole area. So its box is never larger than that and never leaves
 * the area, and the marked area is at least a full dent and the room tall (steel-chair.css), so a one-line post's box grows to hold a dent.
 *
 * When. A run starts once the host's middle (`watchInView`, margin `-20% 0px -20% 0px`, as Glitter Bomb arms its burst) has been in view
 * for 300 ms, and is cleared when the post has wholly left the view, so coming back starts a new one. While a run is up a second observer,
 * without a margin, watches for that departure, and a size observer watches the box; out of view a post holds only the arming observer. A
 * play that lands while the run stands is thrown alone into the standing world, and one that ends (`useAt`) loses its chair and dent while
 * the others stay where they lie. Reduced motion has no flight, no shake and no wait (there is nothing to time): the world is built, run to
 * rest and drawn at once, without sound.
 *
 * Frames. The loop runs on `requestAnimationFrame` only while a body is awake, a dent is growing or a throw is still due, runs at most 4
 * steps a frame (a slow frame or a tab coming back drops the rest of the time it owes), and sets each chair's and each piece's style straight on the DOM nodes
 * through refs; React renders only when a chair or a dent comes or goes. The shade of a piece is taken from its normal after the body's
 * orientation turns it, since the light is fixed in the world. A dent's depth grows by moving its map's pixels from neutral (128) to full,
 * so each dent has its own growth in each of the two filters (both move together), and the others keep their depth when a new one lands.
 *
 * The throws' clock is the world's. The run counts the steps it has run, and chair n enters the world when that count reaches n times
 * STAGGER_STEPS (0.35 s of simulated time), checked after every step, so a chair may enter between two steps of one frame. A wall-clock timer
 * would enter it at a step that depends on the frame rate (the cap above drops time on a slow frame), and the same seed would pile the
 * chairs differently on a slow machine and a fast one. With the count, a run's whole simulation is a pure function of its seed and the
 * content area's measured size; the reduced picture (`placeAll`) steps the same STAGGER_STEPS between their throws, so it is
 * the pile the animated run ends in for the same seed.
 *
 * Sound. Every animated run plays `steel-chair.hit` on each hit and one of the four settle sounds on each chair's first floor contact, in
 * the group `steel-chair`, whether it started from a scroll, from Throw again or from a new play landing; a reduced draw does not
 * sound. Three limits keep a thread from being a wall of clangs: the group's cap of `VOICES` sounds at once across the page (a newer clang
 * fades out the oldest past it), the limiter the engine puts on every sound, and the 300 ms a post must be in view before a run starts. A
 * sound that would start later than `LATE_MS` after its hit or settle is skipped.
 */
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useMotionReduced } from '../../../../engine/ui/appearance.ts';
import { spanWords } from '../../../../engine/ui/account/words.ts';
import { useSound } from '../../../../engine/ui/audio/sound.ts';
import { useGameSound } from '../../../../engine/ui/audio/useGameSound.ts';
import { bodyBox, bodyOf, placeLayer, sameBox, setBend, wordsBoxOf, type Bend, type BodyBox } from '../../../../engine/ui/cards/body.ts';
import { endsWords } from '../../../../engine/ui/cards/marks.ts';
import { useAt } from '../../../../engine/ui/cards/plays.ts';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { dayAndTime } from '../../../../engine/ui/characters/format.ts';
import { watchInView } from '../../../../engine/ui/shine/inView.ts';
import { STEEL_CHAIR_LASTS } from '../../cards/steel-chair.ts';
import {
  addThrow, bodies, createWorld, remove, resize, rng, settle, SETTLE_S, STAGGER_STEPS, step, STEP, throwOf, type Box, type Event as BodyEvent, type World,
} from './body.ts';
import { depthOf, INSET, piecesOf, project, shadeOf, transformOf, type Piece } from './chair.ts';
import { DENT_SCALE, dentImages, dentPrimitives, dentShape, filterTrusted, hitZone, seedOfIds, zoneHeight, type DentShape } from './dent.ts';
import { objectOf, type ThrownObject } from './objects.ts';
import './steel-chair.css';

/**
 * A play's dent shape (its box's proportions, which `dentPrimitives` sizes the dent's box from), computed once per play id: `dentShape` is a
 * pure function of the id (the same for every reader and replay), so the answer is kept and not recomputed on each render. The height map
 * and its three images are made from the same shape by `dentImages`, which keeps its own cache. Cleared when it grows past a few hundred
 * plays, which only costs a recomputation.
 */
const shapes = new Map<string, DentShape>();
function shapeOf(play: string, object: ThrownObject = objectOf(play)): DentShape {
  const key = `${play}|${object}`;
  let shape = shapes.get(key);
  if (!shape) {
    if (shapes.size > 300) shapes.clear();
    shape = dentShape(play, object);
    shapes.set(key, shape);
  }
  return shape;
}

/**
 * The attribute the effect puts on the body it found, where steel-chair.css draws the floor's room. There is one Steel Chair effect per content
 * area (one host per post-reach card per post; a moment replaces the live effect, never joins it), so the mark is a plain attribute and is not counted.
 */
const ROOM_MARK = 'data-dw-chair-room';
/** The attribute the hit's shake is: on the content area (or the host where there is none), where steel-chair.css runs the 4 px shake. */
const SHAKE_MARK = 'data-dw-chair-shake';
/** The most chairs one post draws (the card's stack). */
const MOST = 3;
/**
 * The middle of the view the post must be in for a run to start (the top and bottom fifths do not count), and how long it stays there
 * first.
 */
const ARM_ZONE = '-20% 0px -20% 0px';
const ARM_MS = 300;
/** How long a dent takes to reach its full depth (wall time). */
const GROW_MS = 90;
/**
 * The most steps one frame runs, whatever the clock owes (body.ts: a step costs up to 0.12 ms on a desktop, several times that on a phone).
 */
const MOST_STEPS = 4;
/**
 * The most time one frame adds to the clock the physics catches up to, in seconds: exactly MOST_STEPS of body.ts's STEP. A slower frame (a
 * background tab coming back) loses the rest.
 */
const MOST_FRAME_S = MOST_STEPS * STEP;
/** How many settle sounds there are (`steel-chair.settle-1` to `-4`): a chair's first floor contact plays one of them. */
const SETTLE_SOUNDS = 4;
/**
 * How late a hit's or a settle's sound may start and still be heard as that hit's, in milliseconds; later, it is skipped and its caption
 * shows (docs/plans/2026-11-17-sound-preload-design.md, 2.3).
 */
export const LATE_MS = 120;
/** How many of Steel Chair's sounds may sound at once on the page; a newer one fades out the oldest past this (docs/plans/2026-11-20-sound-stack-design.md, 2.6). */
export const VOICES = 6;
const GROUP = 'steel-chair';

/** A fresh seed from the reader's own screen: nothing about who they are, only what makes one run differ from the next. */
const freshSeed = (): number => {
  const c = globalThis.crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0]!;
  return Math.floor(Math.random() * 2 ** 32);
};

/**
 * The one ref callback kept in `cache` for `key`: it stores the node when attached, and drops its entry (and itself) when the node is gone.
 */
function keptRef<N>(
  cache: Map<string, (node: N | null) => void>, key: string, put: (node: N) => void, drop: () => void,
): (node: N | null) => void {
  let ref = cache.get(key);
  if (!ref) {
    ref = (node) => { if (node) put(node); else { drop(); cache.delete(key); } };
    cache.set(key, ref);
  }
  return ref;
}

/** A dent: where it landed in the content area's px, and whether it is drawn at full depth from the start (reduced motion). */
interface Dent { readonly play: string; readonly x: number; readonly y: number; readonly full: boolean }
/**
 * Where the words box stands in the content area, and how big it is: what the words' filter's coordinates are converted by; `w` and `h`, the content area's
 * own size (the area's filter's region); and `zone`, the height a dent may land in (dent.ts `zoneHeight` of the content area's height).
 */
interface Geo { readonly left: number; readonly top: number; readonly width: number; readonly height: number; readonly w: number; readonly h: number; readonly zone: number }
/**
 * What the effect remembers while it stays mounted: whether `met` has been said.
 */
interface Memory { met: boolean }
/** What the run offers the views: another run, and the plays' list having changed. */
interface Control { replay(): void; sync(): void; rebend(): void }
/** What a chair's group remembers between frames, so a style is written only when it changed. */
interface Cache {
  pieces: HTMLElement[]; list: Piece[]; fold: number; transform: string; depth: string; nudges: number; matrices: string[]; applied: string[]; shades: string[];
}

/** How far a dent's circle (center in the content area's px, `radius`) reaches past the box's borders, in px: 0 where it lies inside. */
const overshoot = (d: { x: number; y: number }, radius: number, b: BodyBox): number =>
  Math.max(0, radius - d.x, d.x + radius - b.w, radius - d.y, d.y + radius - b.h);

const sameGeo = (a: Geo | null, b: Geo): boolean => {
  const near = (x: number, y: number) => Math.abs(x - y) < 0.01;
  return a !== null && near(a.left, b.left) && near(a.top, b.top) && near(a.width, b.width) && near(a.height, b.height) && near(a.w, b.w) && near(a.h, b.h) && near(a.zone, b.zone);
};

/**
 * The box the words really occupy, in the content area's px: the union of the client rects of a `Range` over each text node under the
 * words box (a line of text is as wide as its words, not as the box), from the content area's top left corner at (`originX`, `originY`)
 * in the window. A range over the box's contents would not do: it also reports the border box of every element inside, as wide as the
 * box. Null where there is nothing to measure (no layout, as in jsdom), and the caller falls back to the words box's own.
 */
function textBox(words: HTMLElement, originX: number, originY: number): Box | null {
  if (typeof document.createRange !== 'function') return null;
  const range = document.createRange();
  if (typeof range.getClientRects !== 'function') return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const walker = document.createTreeWalker(words, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue?.trim()) continue;
    range.selectNodeContents(node);
    for (const r of Array.from(range.getClientRects())) {
      if (!(r.width > 0 && r.height > 0)) continue;
      left = Math.min(left, r.left); top = Math.min(top, r.top); right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
    }
  }
  if (!(right > left && bottom > top)) return null;
  return { left: left - originX, top: top - originY, width: right - left, height: bottom - top };
}

/** A unit quaternion as `matrix3d()`'s 16 numbers (column-major). */
function rotation(q: { w: number; x: number; y: number; z: number }): number[] {
  const { w, x, y, z } = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
}
/** A chair-frame normal turned into the world by that rotation. */
const turned = (m: readonly number[], n: readonly [number, number, number]): [number, number, number] => [
  m[0]! * n[0] + m[4]! * n[1] + m[8]! * n[2],
  m[1]! * n[0] + m[5]! * n[1] + m[9]! * n[2],
  m[2]! * n[0] + m[6]! * n[1] + m[10]! * n[2],
];

/**
 * The pieces a chair is drawn from: their size and place are fixed (the order is `piecesOf`'s at every fold), their transform and shade are
 * the frame loop's.
 */
const PIECES = piecesOf(1);
/**
 * The px the oblique view draws a chair at the hit (z = 0) above its world y: the throw aims this much lower so the drawn chair meets the
 * dent.
 */
const HIT_LIFT = -project({ x: 0, y: 0, z: 0 }).y;

export function SteelChairEffect(props: EffectProps) {
  const { plays, show, children } = props;
  const inMoment = props.moment !== null;
  const ends = useMemo(() => plays.flatMap((p) => (p.ends !== undefined ? [Date.parse(p.ends)] : [])), [plays]);
  const clock = useAt(inMoment ? [] : ends);
  /* In a moment the way out is worded at the moment's time, not the page's. */
  const now = props.moment ? props.moment.at : clock;
  /* A moment draws every play it is handed, as they stood; a live post drops the plays whose end has passed (the engine goes on handing them over). */
  const live = useMemo(
    () => (inMoment ? plays : plays.filter((p) => p.ends === undefined || Date.parse(p.ends) > now)).slice(0, MOST),
    [plays, inMoment, now],
  );
  /* What holds for the life of the effect on the page, not of one stretch of live plays (the chairs component below unmounts when the last
     play ends and mounts again when a new one lands): whether the card has been met. */
  const memory = useRef<Memory>({ met: false });
  return live.length > 0 ? <Chairs {...props} live={live} memory={memory.current} now={now} /> : <Bare show={show}>{children}</Bare>;
}

/** No live play: the words alone, and nothing to show. */
function Bare({ show, children }: { show: EffectProps['show']; children: EffectProps['children'] }) {
  useEffect(() => { show(null); return () => show(null); }, [show]);
  return <>{children}</>;
}

function Chairs(props: EffectProps & { live: readonly CardPlay[]; memory: Memory; now: number }) {
  const { live, show, met, children, memory, now } = props;
  const inMoment = props.moment !== null;
  const reduced = useMotionReduced();
  const sound = useSound();
  const gameSound = useGameSound();
  const filterId = useId();
  const trusted = useMemo(() => filterTrusted(), []);
  const host = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const shading = useRef<HTMLDivElement>(null);
  const glows = useRef<HTMLDivElement>(null);
  const [chairs, setChairs] = useState<readonly string[]>([]);
  const [dents, setDents] = useState<readonly Dent[]>([]);
  const [geo, setGeo] = useState<Geo | null>(null);
  /* What the frame loop writes to: each chair's group, and each dent's two transfer functions (its depth), by play. */
  const groups = useRef(new Map<string, HTMLElement>());
  const depths = useRef(new Map<string, SVGElement[]>());
  const fnsOf = (play: string): SVGElement[] => [...(depths.current.get(`${play}|area`) ?? []), ...(depths.current.get(`${play}|words`) ?? [])];
  /*
   * The ref callbacks, one per play and kept: a function made afresh in each render makes React detach and attach the node on every render.
   */
  const refs = useRef({
    group: new Map<string, (node: HTMLElement | null) => void>(),
    depth: new Map<string, (node: SVGElement | null) => void>(),
  });
  const groupRef = (play: string) => keptRef(
    refs.current.group, play, (node) => groups.current.set(play, node), () => groups.current.delete(play),
  );
  /* Each play has a transfer node in each of the two filters (`which`: the area's and the words'); the frame loop moves both. */
  const depthRef = (play: string, which: 'area' | 'words') => keptRef(
    refs.current.depth, `${play}|${which}`, (node) => depths.current.set(`${play}|${which}`, [...node.children] as SVGElement[]), () => depths.current.delete(`${play}|${which}`),
  );
  const control = useRef<Control | null>(null);
  const paintNow = useRef<() => void>(() => {});
  const latest = useRef<{ live: readonly CardPlay[]; sound: typeof sound; met: typeof met; bend: Bend | null }>({ live, sound, met, bend: null });
  latest.current = { live, sound, met, bend: latest.current.bend };

  const key = live.map((p) => p.id).join('|');
  useEffect(() => {
    const el = host.current, chairLayer = layer.current, dentLayer = shading.current;
    const glowLayer = glows.current;
    if (!el || !chairLayer || !dentLayer || !glowLayer) return;
    let world: World | null = null;
    let running = false;
    let loud = false;
    let rand: () => number = rng(0);
    /* The settle sound's pick has a generator of its own: a floor event comes at a real time, and drawing it from the throws' generator would
       move where a later throw lands with the timing of an earlier one's settle (and so with the machine), which a pinned seed cannot allow. */
    let soundRand: () => number = rng(0);
    let box: BodyBox = { left: 0, top: 0, w: 0, h: 0 };
    let geoNow: Geo | null = null;
    let body: HTMLElement | null = null;
    /* The body that carries the room's mark: set only by `giveRoom`, so that a run cleared (which forgets `body`) or an effect moved before
       its first measure cannot leave a mark that nothing will take off. */
    let marked: HTMLElement | null = null;
    /* Where the bend is set (the content area, or null for the host's own where there is none), while one is; and the element the shake's attribute is on. */
    let bentOn: { area: HTMLElement | null } | null = null;
    let shaken: HTMLElement | null = null;
    let found = false;
    let target: Box = { left: 0, top: 0, width: 0, height: 0 };
    let size: ResizeObserver | null = null;
    let stopLeave: () => void = () => {};
    let armTimer: ReturnType<typeof setTimeout> | undefined;
    let raf = 0;
    let lastT = 0;
    let acc = 0;
    const bodyOfPlay = new Map<string, number>();
    const playOfBody = new Map<number, string>();
    /* The throws still due, in the order they enter, each at the count of steps run (`steps`) it waits for. */
    let due: { play: CardPlay; at: number }[] = [];
    let steps = 0;
    const growing = new Map<string, number | null>();
    const caches = new Map<string, Cache>();

    /* The room is the body's, marked on it and on the host (steel-chair.css): the nearest content area the host is in, so a chair in the ORIGIN
       box makes room in the box and not in the opening post's body around it. One effect draws all of a post's chairs, so the mark has one
       owner, and the cleanup below takes both marks off. */
    const giveRoom = (next: HTMLElement | null): void => {
      if (marked && marked !== next) marked.removeAttribute(ROOM_MARK);
      marked = next;
      next?.setAttribute(ROOM_MARK, '');
      el.toggleAttribute('data-kb-bleed', next !== null);
    };
    /* The room is there from the moment a play is live, as the old `:has(.dw-chair)` rule gave it, so the post does not grow when a run starts. */
    giveRoom(bodyOf(el));

    /* The bend (engine `setBend`) is given up first where the body it stands on is not the one found now, or is no longer wanted. */
    const unbend = (): void => {
      if (!bentOn) return;
      setBend(bentOn.area, el, null);
      bentOn = null;
    };
    const rebend = (): void => {
      const want = latest.current.bend;
      if (bentOn && (!want || bentOn.area !== body)) unbend();
      if (want && !bentOn) { setBend(body, el, want); bentOn = { area: body }; }
    };

    /*
     * The box to paint and its words: the content area's padding box (or the host's own), the layers placed over it, and where the words
     * stand in it.
     */
    const measure = (): boolean => {
      const next = bodyOf(el);
      if (next !== body || !found) {
        found = true;
        if (body) size?.unobserve(body);
        if (next) size?.observe(next);
        body = next;
        giveRoom(next);
        rebend();
        /* A shake still running on the old area ends with it (a quarter second at most); the next hit shakes the new one. */
        if (shaken && shaken !== (next ?? el)) { shaken.removeAttribute(SHAKE_MARK); shaken = null; }
      }
      /* The words box (the engine's, where the effect's children draw the words); where there is none the host is measured, and nothing bends the words. */
      const wordsEl = wordsBoxOf(el) ?? el;
      const b = bodyBox(el, body);
      const w = wordsEl.getBoundingClientRect(), h = el.getBoundingClientRect();
      /* Where the words box stands is read from the client rects of the box and the host, whose difference a transform on both leaves alone: the
         hit's shake is on the content area (or the host), which moves every rect in the post by the same few px, so a size callback that fires
         mid-shake stores the place a callback at rest would, changes no coordinate and wakes nothing. Its size is its layout size (`offset*`), as
         the filter's coordinates are the box's own untransformed px; a rect's size would be scaled by a scaled ancestor. Left and top are rect
         differences and so are in the window's px: a scaled ancestor is not supported for them (as `bodyBox` does not support one). */
      const g: Geo = {
        left: w.left - h.left - b.left, top: w.top - h.top - b.top, width: wordsEl.offsetWidth, height: wordsEl.offsetHeight, w: b.w, h: b.h, zone: zoneHeight(b.h),
      };
      const moved = !sameBox(b, box) || !sameGeo(geoNow, g);
      box = b;
      /* The throw aims at the box the text takes, which on a short post is far narrower than the words box (as wide as the content area). */
      target = textBox(wordsEl, h.left + b.left, h.top + b.top)
        ?? { left: g.left, top: g.top, width: g.width, height: g.height };
      placeLayer(chairLayer, b);
      placeLayer(dentLayer, b);
      placeLayer(glowLayer, b);
      if (moved) { geoNow = g; setGeo(g); }
      return moved;
    };

    const cacheOf = (play: string): Cache | null => {
      let c = caches.get(play);
      if (c) return c;
      const group = groups.current.get(play);
      if (!group) return null;
      c = {
        pieces: [...group.children] as HTMLElement[], list: PIECES, fold: -1, transform: '', depth: '', nudges: -1, matrices: [], applied: [], shades: [],
      };
      caches.set(play, c);
      return c;
    };

    /* Writes every chair's transform and shades straight onto its nodes; true while any body is awake. */
    const paint = (): boolean => {
      if (!world) return false;
      let awake = false;
      for (const v of bodies(world)) {
        if (!v.asleep) awake = true;
        const play = playOfBody.get(v.id);
        const group = play === undefined ? undefined : groups.current.get(play);
        const c = play === undefined ? null : cacheOf(play);
        if (!group || !c) continue;
        const m = rotation(v.quaternion);
        /*
         * The world the body simulates is the content area less INSET at each side and at the floor (chair.ts `INSET`), so a drawn x is a
         * world x plus INSET.
         */
        const transform = transformOf({ x: v.position.x + INSET, y: v.position.y, z: v.position.z }, v.scale, m);
        if (transform !== c.transform) { group.style.transform = transform; c.transform = transform; }
        /* Chairs are siblings, each a stacking context: the nearer one is painted over the farther by its z-index. */
        const depth = String(depthOf(v.position.z));
        if (depth !== c.depth) { group.style.zIndex = depth; c.depth = depth; }
        if (Math.abs(v.fold - c.fold) > 0.002) {
          c.list = piecesOf(v.fold);
          c.fold = v.fold;
          c.matrices = c.list.map((p) => `matrix3d(${p.matrix.map((n) => +n.toFixed(5)).join(', ')})`);
        }
        c.list.forEach((p, i) => {
          const node = c.pieces[i];
          if (!node) return;
          if (c.applied[i] !== c.matrices[i]) { c.applied[i] = c.matrices[i]!; node.style.transform = c.matrices[i]!; }
          const shade = shadeOf(turned(m, p.normal));
          if (c.shades[i] !== shade) {
            c.shades[i] = shade;
            if (p.kind === 'frame') node.style.borderColor = shade; else node.style.background = shade;
          }
        });
        group.toggleAttribute('data-rest', v.asleep);
        /* How many nudges the body took (body.ts): a rest alone does not show that a chair stood up and was tipped over, and the browser tests find that pose by it. */
        if (c.nudges !== v.nudges) { group.setAttribute('data-nudges', String(v.nudges)); c.nudges = v.nudges; }
      }
      return awake;
    };
    paintNow.current = () => { paint(); };

    /* A dent's depth, 0 to 1: the transfer functions of its map move each pixel's push toward neutral (128), so 0 draws nothing. */
    const grow = (t: number): void => {
      for (const [play, t0] of growing) {
        const fns = fnsOf(play);
        if (fns.length === 0) continue;
        const start = t0 ?? t;
        growing.set(play, start);
        const a = Math.min(1, (t - start) / GROW_MS);
        for (const fn of fns) { fn.setAttribute('slope', String(a)); fn.setAttribute('intercept', String(0.5 * (1 - a))); }
        if (a >= 1) growing.delete(play);
      }
    };

    const shake = (): void => {
      if (reduced) return;
      const at = body ?? el;
      if (shaken && shaken !== at) shaken.removeAttribute(SHAKE_MARK);
      at.removeAttribute(SHAKE_MARK);
      void at.offsetWidth;
      at.setAttribute(SHAKE_MARK, '');
      shaken = at;
    };

    const onEvent = (e: BodyEvent): void => {
      const play = playOfBody.get(e.id);
      if (play === undefined) return;
      if (e.kind === 'hit') {
        setDents((d) => (d.some((x) => x.play === play) ? d : [...d, { play, x: e.at.x + INSET, y: e.at.y - HIT_LIFT, full: false }]));
        growing.set(play, null);
        shake();
        if (loud) void latest.current.sound.play('steel-chair.hit', { group: GROUP, voices: VOICES, lateMs: LATE_MS });
      } else if (e.kind === 'floor' && loud) {
        void latest.current.sound.play(`steel-chair.settle-${1 + Math.floor(soundRand() * SETTLE_SOUNDS)}`, { group: GROUP, voices: VOICES, lateMs: LATE_MS });
      }
    };

    const tick = (t: number): void => {
      raf = 0;
      if (!world) return;
      const dt = lastT ? Math.min(MOST_FRAME_S, Math.max(0, (t - lastT) / 1000)) : STEP;
      lastT = t;
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < MOST_STEPS) {
        for (const e of step(world, STEP)) onEvent(e);
        acc -= STEP; n++; steps++;
        release();
      }
      if (n === MOST_STEPS) acc = 0;
      grow(t);
      const awake = paint();
      if (awake || growing.size > 0 || due.length > 0) raf = requestAnimationFrame(tick); else lastT = 0;
    };
    const wake = (): void => { if (!raf && world) raf = requestAnimationFrame(tick); };

    /*
     * The box a throw aims at (throwOf aims inside it, 15% in from its sides): the text's, where the text is a dent's diameter tall or more;
     * where it is shorter, one line or a few, grown around the text within the content area (dent.ts `hitZone`), so that three throws do not
     * stack on one line and a dent may land beside it, as far as the dent's own circle (its shape, from its play's id) fits the zone. Then lowered
     * by the lift of the oblique view at the hit, so the drawn chair meets the dent drawn at the text. Where it lands inside the box is the
     * run's own generator's, as before.
     */
    const aim = (play: string): Box => {
      /* A dent is sized and aimed in the height it may land in (dent.ts `zoneHeight`: the area less the room where that is at least LEAST_ZONE, else
         the whole area), so its box stays inside the area and, where there is room, above the chairs' floor. */
      const zone = zoneHeight(box.h);
      const dent = dentPrimitives([{ x: 0, y: 0, shape: shapeOf(play) }], { width: geoNow?.width ?? box.w, height: zone })[0]!;
      const aimed = hitZone(target, { width: box.w, height: zone }, dent);
      return { left: aimed.left - INSET, top: aimed.top + HIT_LIFT, width: aimed.width, height: aimed.height };
    };

    /* A chair into the standing world, in flight. */
    const addPlay = (play: CardPlay): void => {
      if (!world || bodyOfPlay.has(play.id)) return;
      const id = addThrow(world, throwOf(rand, aim(play.id)));
      bodyOfPlay.set(play.id, id);
      playOfBody.set(id, play.id);
      setChairs((c) => (c.includes(play.id) ? c : [...c, play.id]));
    };
    /* The throws whose step has come. Called after every step, so a chair may enter between two steps of one frame. */
    const release = (): void => {
      while (due.length > 0 && due[0]!.at <= steps) addPlay(due.shift()!.play);
    };
    /* Reduced motion: every new throw placed and settled with the rest at once, its dent at full depth. Each throw after the
       first waits STAGGER_STEPS of the world's steps, as the animated run's do, so the pile is the one that run ends in for the same seed. */
    const placeAll = (plays: readonly CardPlay[]): void => {
      if (!world) return;
      const added: { play: string; x: number; y: number }[] = [];
      for (const p of plays) {
        if (bodyOfPlay.has(p.id)) continue;
        if (added.length > 0) for (let k = 0; k < STAGGER_STEPS; k++) step(world, STEP);
        const th = throwOf(rand, aim(p.id));
        const id = addThrow(world, th);
        bodyOfPlay.set(p.id, id);
        playOfBody.set(id, p.id);
        added.push({ play: p.id, x: th.target.x + INSET, y: th.target.y - HIT_LIFT });
      }
      settle(world, SETTLE_S);
      if (added.length > 0) {
        setChairs((c) => [...c, ...added.map((a) => a.play).filter((id) => !c.includes(id))]);
        setDents((d) => [...d, ...added.filter((a) => !d.some((x) => x.play === a.play)).map((a) => ({ ...a, full: true }))]);
      }
      paint();
    };

    const meet = (): void => {
      if (inMoment || memory.met) return;
      memory.met = true;
      latest.current.met();
    };

    /* The box's size is watched while a run stands, and also while the box measures nothing when the run arms (hidden, collapsed, a box not
       laid out yet): the run starts when the box gets a size. Kept from the one run to the next only by `clearRun`'s disconnect; a second
       call while an observer is bound binds nothing. */
    const watchSize = (): void => {
      if (size || typeof ResizeObserver !== 'function') return;
      size = new ResizeObserver(() => {
        if (!world) { if (measure()) startRun(); return; }
        const was = box;
        if (!measure()) return;
        resize(world, box.w - 2 * INSET, box.h - INSET, box.h - INSET);
        /* A dent keeps its px in the content area, and its shading is in an overflow-visible layer, so one the narrowed post no longer holds
           would poke out of it. Only the dent goes (it is decoration): its play, its chair and the Lens's count are unchanged. A dent that poked
           out as far before (it landed near a border) stays; only one that pokes out farther than it did is dropped. */
        const now = box;
        const radius = dentPrimitives([{ x: 0, y: 0 }], { width: geoNow?.width ?? 0, height: geoNow?.zone ?? 0 })[0]!.size / 2;
        setDents((d) => {
          const kept = d.filter((x) => overshoot(x, radius, now) <= overshoot(x, radius, was) + 0.01);
          return kept.length === d.length ? d : kept;
        });
        if (reduced) { settle(world, SETTLE_S); paint(); } else wake();
      });
      size.observe(el);
      if (body) size.observe(body);
    };
    /* While a run stands: the post wholly leaving the view clears the run, and the box's size is watched. */
    const startWatching = (): void => {
      stopLeave = watchInView(el, (showing) => { if (!showing) clearRun(true); });
      watchSize();
    };

    const startRun = (): void => {
      if (running) return;
      measure();
      if (box.w <= 0 || box.h <= 0) { watchSize(); return; }
      running = true;
      loud = !reduced;
      const seed = freshSeed();
      rand = rng(seed);
      soundRand = rng(seedOfIds([String(seed), 'settle']));
      world = createWorld(box.w - 2 * INSET, box.h - INSET, box.h - INSET);
      const plays = latest.current.live;
      meet();
      startWatching();
      if (reduced) { placeAll(plays); return; }
      steps = 0;
      due = plays.slice(1).map((p, i) => ({ play: p, at: (i + 1) * STAGGER_STEPS }));
      if (plays[0]) addPlay(plays[0]);
      wake();
    };

    const clearRun = (render: boolean): void => {
      stopLeave(); stopLeave = () => {};
      size?.disconnect(); size = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0; lastT = 0; acc = 0;
      due = []; steps = 0;
      growing.clear();
      caches.clear();
      bodyOfPlay.clear(); playOfBody.clear();
      world = null;
      running = false;
      unbend();
      found = false; body = null;
      shaken?.removeAttribute(SHAKE_MARK); shaken = null;
      if (render) { setChairs([]); setDents([]); }
    };

    control.current = {
      rebend,
      replay: () => { clearRun(true); startRun(); },
      /* Plays that came or went while the run stands: the gone lose their chair and dent, the new are thrown alone into the world. */
      sync: () => {
        if (!running || !world) return;
        const plays = latest.current.live;
        const ids = new Set(plays.map((p) => p.id));
        for (const [play, id] of [...bodyOfPlay]) {
          if (ids.has(play)) continue;
          remove(world, id);
          bodyOfPlay.delete(play); playOfBody.delete(id); growing.delete(play); caches.delete(play);
        }
        due = due.filter((d) => ids.has(d.play.id));
        setChairs((c) => c.filter((id) => ids.has(id)));
        setDents((d) => d.filter((x) => ids.has(x.play)));
        const fresh = plays.filter((p) => !bodyOfPlay.has(p.id) && !due.some((d) => d.play.id === p.id));
        if (reduced) placeAll(fresh);
        else { for (const p of fresh) addPlay(p); wake(); }
      },
    };

    /* A post, live or in a moment, waits for its middle to be in view. */
    const stopArm = watchInView(el, (showing) => {
      clearTimeout(armTimer);
      armTimer = undefined;
      /* A post that left the view before its box got a size waits for nothing: the arming observer starts it again. */
      if (!showing && !running) { size?.disconnect(); size = null; }
      if (!showing || running) return;
      if (reduced) startRun(); else armTimer = setTimeout(startRun, ARM_MS);
    }, { rootMargin: ARM_ZONE });

    return () => {
      stopArm();
      clearTimeout(armTimer);
      giveRoom(null);
      el.removeAttribute('data-kb-bleed');
      /* The drawn chairs and dents go with the run that drew them: kept through a re-arm (reduced motion or the moment changing), an old
         dent would stand at its old place while the new run's chair is aimed elsewhere, and the reduced path skips a play that has a dent. */
      clearRun(true);
      control.current = null;
      paintNow.current = () => {};
    };
  }, [inMoment, reduced, memory]);

  /* Plays that came or went, after the run's own effect has run. */
  useEffect(() => { control.current?.sync(); }, [key]);
  /* A chair or a dent that was just rendered is placed at once, never waiting for a frame. */
  useLayoutEffect(() => { paintNow.current(); }, [chairs, dents]);

  /* The Lens: how many chairs, when the first is gone, and the two controls. */
  const n = live.length;
  const soonest = live.reduce<number | null>(
    (m, p) => (p.ends === undefined ? m : m === null ? Date.parse(p.ends) : Math.min(m, Date.parse(p.ends))),
    null,
  );
  const replay = useCallback(() => { control.current?.replay(); }, []);
  const view = useMemo<CardView>(() => {
    const at = soonest === null ? null : new Date(soonest).toISOString();
    const ends = at === null ? undefined
      : n === 1 ? endsWords(at, now)
      : `The first chair is gone ${dayAndTime(at)}; each lasts ${spanWords(STEEL_CHAIR_LASTS)}.`;
    return {
      progress: null,
      state: n === 1 ? 'Dented by a chair' : `Dented by ${n} chairs`,
      ...(ends !== undefined ? { ends } : {}),
      yours: false,
      controls: [
        { kind: 'press', label: 'Throw again', run: replay },
        { kind: 'toggle', label: 'Game sounds', on: gameSound.on, set: gameSound.set },
      ],
      notes: {},
    };
  }, [n, soonest, now, replay, gameSound.on, gameSound.set]);
  useEffect(() => { show(view); }, [show, view]);
  useEffect(() => () => show(null), [show]);

  /* The filters and the shading, from the dents in the content area's px: the words' filter's coordinates are the words box's, the area's are the content area's. */
  const shown = dents.filter((d) => live.some((p) => p.id === d.play));
  const off = geo ?? { left: 0, top: 0, width: 0, height: 0, w: 0, h: 0, zone: 0 };
  /* Each dent's own shape comes from its play's id alone (dent.ts `dentShape`): the same for every reader and on every replay. */
  const shapesOf = shown.map((d) => shapeOf(d.play));
  const prims = dentPrimitives(shown.map((d, i) => ({ x: d.x - off.left, y: d.y - off.top, shape: shapesOf[i]! })), { width: off.width, height: off.zone });
  /* Each dent's three images (dent.ts `dentImages`: kept per play, box size and density, so a render makes them once): the bend for the filters,
     the shade and the light for the two shading layers. Where the images need a canvas that is not there each is '' and sets nothing. */
  const density = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);
  const inArea = (p: { x: number; y: number; width: number; height: number; size: number }) => ({ ...p, x: p.x + off.left, y: p.y + off.top });
  const earlierOf = (i: number) => shown.slice(0, i).map((d, j) => ({ play: d.play, box: inArea(prims[j]!) }));
  /* The dents are capped against the ones before them in `shown` (the order they landed in), in one space: the content area's px. */
  const images = shown.map((d, i) => dentImages(d.play, inArea(prims[i]!), density, earlierOf(i), undefined, objectOf(d.play)));
  const filterOn = trusted && shown.length > 0 && geo !== null && images.every((m) => m.bend !== '');
  /* What the engine is asked to bend with, from the two filters' ids. */
  const bend = useMemo<Bend | null>(
    () => (filterOn ? { area: `url("#${filterId}-area")`, words: `url("#${filterId}-words")` } : null),
    [filterOn, filterId],
  );
  latest.current.bend = bend;
  useLayoutEffect(() => { control.current?.rebend(); }, [bend]);
  /* A dent's box (the ellipse the displacement's `feImage` is stretched to), which each shading layer's image fills; the image carries the
     dent's whole shape, so the box is all the style needs besides the image's address. */
  const boxStyle = (i: number): CSSProperties => {
    const p = prims[i]!;
    return { left: `${p.x + off.left}px`, top: `${p.y + off.top}px`, width: `${p.width}px`, height: `${p.height}px` };
  };
  const shadeStyle = (i: number): CSSProperties => (
    images[i]!.shade ? { ...boxStyle(i), '--dw-dent-img': `url("${images[i]!.shade}")` } as CSSProperties : boxStyle(i)
  );
  const lightStyle = (i: number): CSSProperties => (
    images[i]!.light ? { ...boxStyle(i), '--dw-glow-img': `url("${images[i]!.light}")` } as CSSProperties : boxStyle(i)
  );
  const last = shown.length - 1;
  /*
   * One filter, built from the dents above: `which` names it (`${filterId}-words` or `-area`), `at` is where its coordinates' origin stands from the words
   * box's (0, 0 for the words' filter; the words box's place in the content area for the area's), and `region` is its box in its own px: the box plus
   * DENT_SCALE on every side, as the default region (-10% to 120% of the box) is too small for a one-line post, where a displacement of up to
   * DENT_SCALE / 2 px moves the glyphs out of it and clips them. The two differ in nothing else: the flood, each dent's `feImage`, growth transfer
   * and sum, and the displacement are the same.
   */
  const bendFilter = (which: 'words' | 'area', atX: number, atY: number, region: { x: number; y: number; width: number; height: number }) => (
    <filter id={`${filterId}-${which}`} colorInterpolationFilters="sRGB" primitiveUnits="userSpaceOnUse" filterUnits="userSpaceOnUse" {...region}>
      <feFlood floodColor="rgb(128,128,128)" result="neutral" />
      {shown.map((d, i) => (
        <Fragment key={d.play}>
          <feImage
            href={images[i]!.bend} x={prims[i]!.x + atX} y={prims[i]!.y + atY} width={prims[i]!.width} height={prims[i]!.height}
            preserveAspectRatio="none" result={`map-${i}`}
          />
          <feComponentTransfer in={`map-${i}`} result={`dent-${i}`} ref={depthRef(d.play, which)}>
            <feFuncR type="linear" slope={d.full ? 1 : 0} intercept={d.full ? 0 : 0.5} />
            <feFuncG type="linear" slope={d.full ? 1 : 0} intercept={d.full ? 0 : 0.5} />
          </feComponentTransfer>
          {/* The dent's square laid over neutral, so it is neutral (adds nothing) outside its circle; then its offset is added to the
              running map. */}
          <feComposite in={`dent-${i}`} in2="neutral" operator="over" result={`full-${i}`} />
          <feComposite
            in={i === 0 ? 'neutral' : `sum-${i - 1}`} in2={`full-${i}`} operator="arithmetic" k1="0" k2="1" k3="1" k4="-0.5"
            result={`sum-${i}`}
          />
        </Fragment>
      ))}
      <feDisplacementMap
        in="SourceGraphic" in2={last >= 0 ? `sum-${last}` : 'neutral'} scale={DENT_SCALE} xChannelSelector="R" yChannelSelector="G"
      />
    </filter>
  );
  return (
    <div ref={host} className="dw-chair">
      {trusted ? (
        <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
          {bendFilter('words', 0, 0, { x: -DENT_SCALE, y: -DENT_SCALE, width: off.width + 2 * DENT_SCALE, height: off.height + 2 * DENT_SCALE })}
          {bendFilter('area', off.left, off.top, { x: -DENT_SCALE, y: -DENT_SCALE, width: off.w + 2 * DENT_SCALE, height: off.h + 2 * DENT_SCALE })}
        </svg>
      ) : null}
      {children}
      <div className="dw-chair-room" aria-hidden="true" />
      {/* The dents' shading, in two layers that each fill the content area: the shade (black with an alpha) and the light (white with an alpha),
          laid on the words plainly with no blend, each dent's image already corrected against the dents before it (steel-chair.css). */}
      <div ref={shading} className="dw-chair-dents dw-chair-shading" data-kb-effect-ink="" aria-hidden="true">
        {shown.map((d, i) => <div key={d.play} className="dw-chair-dent" data-play={d.play} style={shadeStyle(i)} />)}
      </div>
      <div ref={glows} className="dw-chair-glows dw-chair-shading" data-kb-effect-ink="" aria-hidden="true">
        {shown.map((d, i) => <div key={d.play} className="dw-chair-glow" data-play={d.play} style={lightStyle(i)} />)}
      </div>
      <div ref={layer} className="dw-chair-layer" data-kb-effect-ink="" aria-hidden="true">
        {chairs.filter((id) => live.some((p) => p.id === id)).map((id) => (
          <div key={id} className="dw-chair-group" data-play={id} ref={groupRef(id)}>
            {PIECES.map((p) => (
              <div
                key={p.name} className="dw-chair-piece" data-kind={p.kind}
                style={{ width: p.width, height: p.height, left: p.left, top: p.top }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
