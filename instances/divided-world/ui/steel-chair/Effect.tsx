/**
 * Steel Chair's effect (docs/plans/2026-11-15-steel-chair-plan.md, Task 5, as amended: the world is the post's content area): a folding
 * chair is thrown at the post from any direction, dents it (the words bend into a displacement filter's dent, shaded over them), shakes it
 * once and falls to the floor as a rigid box (body.ts), where it tips, slides and sleeps. Up to three at once, each its own throw 0.35 s
 * of the world's own time after the last (see Frames). Nothing is seeded, saved or sent: each run draws its throws from a generator seeded
 * freshly from the reader's own screen (`crypto.getRandomValues`), so every run and every reader sees a different one, and the effect reads neither who wrote the post nor who
 * played the card. A play's moment (`still`) is the one exception to the freshness: seeded from the plays' ids, so it is the same each
 * time.
 *
 * Where. The chairs' layer and the dents' shading fill the post's content area border to border, placed the way Feelin' Fab's foil and
 * Whoops!'s ink are (engine/ui/cards/body.ts: `bodyOf`, `bodyBox`, `placeLayer`, the bare `data-kb-effect-ink` mark the thread's CSS lifts
 * above the words). That box is the physics world: its left and right borders are the walls and its bottom border the floor; chair.ts draws
 * the world in an oblique view (the floor recedes up the screen), so a chair at rest is drawn inside the box, never past a border. Where
 * there is no body (no content area above the effect) the effect's own box is the world. A `ResizeObserver` on the box (and the host) resizes the world and
 * places the layers again. The words are a wrapper inside the host; the throw aims at the box the text really takes (a Range's client
 * rects: a short post's wrapper is as wide as the content area), and since the filter is applied to that wrapper its coordinates are the
 * wrapper's, not the content area's: `geo` holds the measured offset between the two. The floor's room is the content area's own
 * last ROOM_HEIGHT px (chair.ts, the height of the tallest rest), so a resting chair reaches neither the reactions row nor the words: the
 * effect marks the body it found (`data-dw-chair-room`, the nearest content area, so a chair in a spun thread's ORIGIN box makes room in the
 * box and not in the opening post's body around it) and steel-chair.css draws the room at the foot of whatever is marked; only where there
 * is no content area is it a strip in the host (`.dw-chair-room`, hidden where the host is `data-kb-bleed`). Nothing
 * here assumes the content area is as tall as its words plus the room: the world, the layers and the dents' coordinates are all measured boxes
 * (`bodyBox`, the wrapper's offsets, the text's client rects), the room is the content area's last child so it stays at the floor however tall
 * the body is, and the floor is the area's bottom border.
 *
 * The dents. Each is a pressed-in plate of metal: a height map made from its play's id alone (dent.ts `dentShape`, `dentHeight`), the same
 * for every reader and on every replay, while where it lands is the run's, in an ellipse's box (within 15% of round). One light, fixed in the
 * world, falls on every dent from the upper left (dent.ts `LIGHT`), and the map is drawn as three images (`dentImages`): the bend, which the
 * displacement's `feImage` takes (stretched to the box), and a shade and a light, which the two shading layers lay over the words (a dark
 * side and a bright rim and glint). There is nothing else to a dent: no crease, no turned shading. The shading of overlapping dents is the
 * darkest (and the lightest) of them, not their sum (steel-chair.css). Where the text is shorter than a dent the throw aims at a box grown
 * around it (dent.ts `hitZone`), so three dents do not stack on one line.
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
 * so each dent has its own growth in the one filter, and the others keep their depth when a new one lands.
 *
 * The throws' clock is the world's. The run counts the steps it has run, and chair n enters the world when that count reaches n times
 * STAGGER_STEPS (0.35 s of simulated time), checked after every step, so a chair may enter between two steps of one frame. A wall-clock timer
 * would enter it at a step that depends on the frame rate (the cap above drops time on a slow frame), and the same seed would pile the
 * chairs differently on a slow machine and a fast one. With the count, a run's whole simulation is a pure function of its seed and the
 * content area's measured size; the reduced and moment pictures (`placeAll`) step the same STAGGER_STEPS between their throws, so they are
 * the pile the animated run ends in for the same seed.
 *
 * Sound. Every animated run plays `steel-chair.hit` on each hit and one of the four settle sounds on each chair's first floor contact, in
 * the group `steel-chair`, whether it started from a scroll, from Throw again or from a new play landing; a reduced or still draw does not
 * sound. Two limits keep a thread from being a wall of clangs: the one group (a new clang takes over the one still sounding) and the 300 ms
 * a post must be in view before a run starts. A sound that would start later than `LATE_MS` after its hit or settle is skipped.
 */
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useMotionReduced } from '../../../../engine/ui/appearance.ts';
import { spanWords } from '../../../../engine/ui/account/words.ts';
import { useSound } from '../../../../engine/ui/audio/sound.ts';
import { useGameSound } from '../../../../engine/ui/audio/useGameSound.ts';
import { bodyBox, bodyOf, placeLayer, sameBox, type BodyBox } from '../../../../engine/ui/cards/body.ts';
import { endsWords } from '../../../../engine/ui/cards/marks.ts';
import { useAt } from '../../../../engine/ui/cards/plays.ts';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { dayAndTime } from '../../../../engine/ui/characters/format.ts';
import { watchInView } from '../../../../engine/ui/shine/inView.ts';
import { STEEL_CHAIR_LASTS } from '../../cards/steel-chair.ts';
import {
  addThrow, bodies, createWorld, remove, resize, rng, settle, SETTLE_S, STAGGER_STEPS, step, STEP, throwOf, type Box, type Event as BodyEvent, type World,
} from './body.ts';
import { depthOf, INSET, piecesOf, project, ROOM_HEIGHT, shadeOf, transformOf, type Piece } from './chair.ts';
import { DENT_SCALE, dentImages, dentPrimitives, dentShape, filterTrusted, hitZone, seedOfIds, type DentShape } from './dent.ts';
import './steel-chair.css';

/**
 * A play's dent shape (its box's proportions, which `dentPrimitives` sizes the dent's box from), computed once per play id: `dentShape` is a
 * pure function of the id (the same for every reader and replay), so the answer is kept and not recomputed on each render. The height map
 * and its three images are made from the same shape by `dentImages`, which keeps its own cache. Cleared when it grows past a few hundred
 * plays, which only costs a recomputation.
 */
const shapes = new Map<string, DentShape>();
function shapeOf(play: string): DentShape {
  let shape = shapes.get(play);
  if (!shape) {
    if (shapes.size > 300) shapes.clear();
    shape = dentShape(play);
    shapes.set(play, shape);
  }
  return shape;
}

/**
 * The attribute the effect puts on the body it found, where steel-chair.css draws the floor's room. There is one Steel Chair effect per content
 * area (one host per post-reach card per post; a moment replaces the live effect, never joins it), so the mark is a plain attribute and is not counted.
 */
const ROOM_MARK = 'data-dw-chair-room';
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

/** A dent: where it landed in the content area's px, and whether it is drawn at full depth from the start (reduced motion, a moment). */
interface Dent { readonly play: string; readonly x: number; readonly y: number; readonly full: boolean }
/** Where the words wrapper stands in the content area, and how big it is: what the filter's coordinates are converted by. */
interface Geo { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
/**
 * What the effect remembers while it stays mounted: whether `met` has been said.
 */
interface Memory { met: boolean }
/** What the run offers the views: another run, and the plays' list having changed. */
interface Control { replay(): void; sync(): void }
/** What a chair's group remembers between frames, so a style is written only when it changed. */
interface Cache {
  pieces: HTMLElement[]; list: Piece[]; fold: number; transform: string; depth: string; nudges: number; matrices: string[]; applied: string[]; shades: string[];
}

/** How far a dent's circle (center in the content area's px, `radius`) reaches past the box's borders, in px: 0 where it lies inside. */
const overshoot = (d: { x: number; y: number }, radius: number, b: BodyBox): number =>
  Math.max(0, radius - d.x, d.x + radius - b.w, radius - d.y, d.y + radius - b.h);

const sameGeo = (a: Geo | null, b: Geo): boolean => {
  const near = (x: number, y: number) => Math.abs(x - y) < 0.01;
  return a !== null && near(a.left, b.left) && near(a.top, b.top) && near(a.width, b.width) && near(a.height, b.height);
};

/**
 * The box the words really occupy, in the content area's px: the union of the client rects of a `Range` over each text node under the
 * wrapper (a line of text is as wide as its words, not as the wrapper), from the content area's top left corner at (`originX`, `originY`)
 * in the window. A range over the wrapper's contents would not do: it also reports the border box of every element inside, as wide as the
 * wrapper. Null where there is nothing to measure (no layout, as in jsdom), and the caller falls back to the wrapper's box.
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
  const { plays, still, show, children } = props;
  const ends = useMemo(() => plays.flatMap((p) => (p.ends !== undefined ? [Date.parse(p.ends)] : [])), [plays]);
  const now = useAt(still ? [] : ends);
  /* A moment draws its plays as they stood; a live post drops the plays whose end has passed (the engine goes on handing them over). */
  const live = useMemo(
    () => (still ? plays : plays.filter((p) => p.ends === undefined || Date.parse(p.ends) > now)).slice(0, MOST),
    [plays, still, now],
  );
  /* What holds for the life of the effect on the page, not of one stretch of live plays (the chairs component below unmounts when the last
     play ends and mounts again when a new one lands): whether the card has been met. */
  const memory = useRef<Memory>({ met: false });
  return live.length > 0 ? <Chairs {...props} live={live} memory={memory.current} /> : <Bare show={show}>{children}</Bare>;
}

/** No live play: the words alone, and nothing to show. */
function Bare({ show, children }: { show: EffectProps['show']; children: EffectProps['children'] }) {
  useEffect(() => { show(null); return () => show(null); }, [show]);
  return <>{children}</>;
}

function Chairs({ live, still, show, met, children, memory }: EffectProps & { live: readonly CardPlay[]; memory: Memory }) {
  const reduced = useMotionReduced();
  const sound = useSound();
  const gameSound = useGameSound();
  const filterId = useId();
  const trusted = useMemo(() => filterTrusted(), []);
  const host = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const shading = useRef<HTMLDivElement>(null);
  const glows = useRef<HTMLDivElement>(null);
  const [chairs, setChairs] = useState<readonly string[]>([]);
  const [dents, setDents] = useState<readonly Dent[]>([]);
  const [geo, setGeo] = useState<Geo | null>(null);
  /* What the frame loop writes to: each chair's group, and each dent's two transfer functions (its depth), by play. */
  const groups = useRef(new Map<string, HTMLElement>());
  const depths = useRef(new Map<string, SVGElement[]>());
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
  const depthRef = (play: string) => keptRef(
    refs.current.depth, play, (node) => depths.current.set(play, [...node.children] as SVGElement[]), () => depths.current.delete(play),
  );
  const control = useRef<Control | null>(null);
  const paintNow = useRef<() => void>(() => {});
  const latest = useRef({ live, sound, met });
  latest.current = { live, sound, met };

  const key = live.map((p) => p.id).join('|');
  useEffect(() => {
    const el = host.current, wordsEl = words.current, chairLayer = layer.current, dentLayer = shading.current;
    const glowLayer = glows.current;
    if (!el || !wordsEl || !chairLayer || !dentLayer || !glowLayer) return;
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
      }
      const b = bodyBox(el, body);
      const w = wordsEl.getBoundingClientRect(), h = el.getBoundingClientRect();
      /* Where the wrapper stands is its layout box (`offset*`, relative to the host, which is its offset parent), which a transform does not
         move: the hit's shake moves `getBoundingClientRect` by up to 4 px, and a size callback that fires mid-shake would otherwise store that
         as the wrapper's place, change the filter's coordinates and wake the world. `shift` is what the transform adds to the client rects. */
      const shiftX = w.left - h.left - wordsEl.offsetLeft, shiftY = w.top - h.top - wordsEl.offsetTop;
      const g: Geo = {
        left: wordsEl.offsetLeft - b.left, top: wordsEl.offsetTop - b.top, width: wordsEl.offsetWidth, height: wordsEl.offsetHeight,
      };
      const moved = !sameBox(b, box) || !sameGeo(geoNow, g);
      box = b;
      /* The throw aims at the box the text takes, which on a short post is far narrower than the wrapper (as wide as the content area). */
      target = textBox(wordsEl, h.left + b.left + shiftX, h.top + b.top + shiftY)
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
        const fns = depths.current.get(play);
        if (!fns) continue;
        const start = t0 ?? t;
        growing.set(play, start);
        const a = Math.min(1, (t - start) / GROW_MS);
        for (const fn of fns) { fn.setAttribute('slope', String(a)); fn.setAttribute('intercept', String(0.5 * (1 - a))); }
        if (a >= 1) growing.delete(play);
      }
    };

    const shake = (): void => {
      if (reduced || still) return;
      wordsEl.removeAttribute('data-shake');
      void wordsEl.offsetWidth;
      wordsEl.setAttribute('data-shake', '');
    };

    const onEvent = (e: BodyEvent): void => {
      const play = playOfBody.get(e.id);
      if (play === undefined) return;
      if (e.kind === 'hit') {
        setDents((d) => (d.some((x) => x.play === play) ? d : [...d, { play, x: e.at.x + INSET, y: e.at.y - HIT_LIFT, full: false }]));
        growing.set(play, null);
        shake();
        if (loud) void latest.current.sound.play('steel-chair.hit', { group: GROUP, lateMs: LATE_MS });
      } else if (e.kind === 'floor' && loud) {
        void latest.current.sound.play(`steel-chair.settle-${1 + Math.floor(soundRand() * SETTLE_SOUNDS)}`, { group: GROUP, lateMs: LATE_MS });
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
     * stack on one line and a dent may land beside it, as far as the dent's own circle (its shape, from its play's id) fits the area. Then lowered
     * by the lift of the oblique view at the hit, so the drawn chair meets the dent drawn at the text. Where it lands inside the box is the
     * run's own generator's, as before.
     */
    const aim = (play: string): Box => {
      const dent = dentPrimitives([{ x: 0, y: 0, shape: shapeOf(play) }], { width: geoNow?.width ?? box.w, height: box.h })[0]!;
      /* The zone is cut at the room's top, so that a dent's circle stays above the last ROOM_HEIGHT px, where the chairs lie. A post's content area
         is at least 22.5em tall (thread.css), so on a post this costs nothing; only where the area less the room is shorter than the dent
         itself (a preview, a narrow box) is the whole area kept, since a dent inside the area matters more than one clear of the room. */
      const above = box.h - ROOM_HEIGHT;
      const zone = hitZone(target, { width: box.w, height: above >= Math.max(dent.width, dent.height) ? above : box.h }, dent);
      return { left: zone.left - INSET, top: zone.top + HIT_LIFT, width: zone.width, height: zone.height };
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
    /* Reduced motion and a moment: every new throw placed and settled with the rest at once, its dent at full depth. Each throw after the
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
      if (still || memory.met) return;
      memory.met = true;
      latest.current.met();
    };

    /* While a run stands: the post wholly leaving the view clears it, and the box's size is watched. */
    const startWatching = (): void => {
      stopLeave = watchInView(el, (showing) => { if (!showing) clearRun(true); });
      if (typeof ResizeObserver !== 'function') return;
      size = new ResizeObserver(() => {
        if (!world) return;
        const was = box;
        if (!measure()) return;
        resize(world, box.w - 2 * INSET, box.h - INSET, box.h - INSET);
        /* A dent keeps its px in the content area, and its shading is in an overflow-visible layer, so one the narrowed post no longer holds
           would poke out of it. Only the dent goes (it is decoration): its play, its chair and the Lens's count are unchanged. A dent that poked
           out as far before (it landed near a border) stays; only one that pokes out farther than it did is dropped. */
        const now = box;
        const radius = dentPrimitives([{ x: 0, y: 0 }], { width: geoNow?.width ?? 0, height: geoNow?.height ?? 0 })[0]!.size / 2;
        setDents((d) => {
          const kept = d.filter((x) => overshoot(x, radius, now) <= overshoot(x, radius, was) + 0.01);
          return kept.length === d.length ? d : kept;
        });
        if (reduced) { settle(world, SETTLE_S); paint(); } else wake();
      });
      size.observe(el);
      if (body) size.observe(body);
    };

    const startRun = (): void => {
      if (running) return;
      measure();
      if (box.w <= 0 || box.h <= 0) return;
      running = true;
      loud = !still && !reduced;
      const seed = still ? seedOfIds(latest.current.live.map((p) => p.id)) : freshSeed();
      rand = rng(seed);
      soundRand = rng(seedOfIds([String(seed), 'settle']));
      world = createWorld(box.w - 2 * INSET, box.h - INSET, box.h - INSET);
      const plays = latest.current.live;
      meet();
      if (!still) startWatching();
      if (still || reduced) { placeAll(plays); return; }
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
      found = false; body = null;
      wordsEl.removeAttribute('data-shake');
      if (render) { setChairs([]); setDents([]); }
    };

    control.current = {
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
        if (still || reduced) placeAll(fresh);
        else { for (const p of fresh) addPlay(p); wake(); }
      },
    };

    /* A moment is drawn once and watched by nothing; a live post waits for its middle to be in view. */
    let stopArm: () => void = () => {};
    if (still) startRun();
    else {
      stopArm = watchInView(el, (showing) => {
        clearTimeout(armTimer);
        armTimer = undefined;
        if (!showing || running) return;
        if (reduced) startRun(); else armTimer = setTimeout(startRun, ARM_MS);
      }, { rootMargin: ARM_ZONE });
    }

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
  }, [still, reduced, memory]);

  /* Plays that came or went, after the run's own effect has run. */
  useEffect(() => { control.current?.sync(); }, [key]);
  /* A chair or a dent that was just rendered is placed at once, never waiting for a frame. */
  useLayoutEffect(() => { paintNow.current(); }, [chairs, dents]);

  /* The Lens: how many chairs, when the first is gone, and the two controls (none in a moment). */
  const n = live.length;
  const soonest = live.reduce<number | null>(
    (m, p) => (p.ends === undefined ? m : m === null ? Date.parse(p.ends) : Math.min(m, Date.parse(p.ends))),
    null,
  );
  const replay = useCallback(() => { control.current?.replay(); }, []);
  const view = useMemo<CardView>(() => {
    const at = soonest === null ? null : new Date(soonest).toISOString();
    const ends = at === null ? undefined
      : n === 1 ? endsWords(at)
      : `The first chair is gone ${dayAndTime(at)}; each lasts ${spanWords(STEEL_CHAIR_LASTS)}.`;
    return {
      progress: null,
      state: n === 1 ? 'Dented by a chair' : `Dented by ${n} chairs`,
      ...(ends !== undefined ? { ends } : {}),
      yours: false,
      controls: still ? [] : [
        { kind: 'press', label: 'Throw again', run: replay },
        { kind: 'toggle', label: 'Game sounds', on: gameSound.on, set: gameSound.set },
      ],
      notes: {},
    };
  }, [n, soonest, still, replay, gameSound.on, gameSound.set]);
  useEffect(() => { show(view); }, [show, view]);
  useEffect(() => () => show(null), [show]);

  /* The filter and the shading, from the dents in the content area's px: the filter's coordinates are the words wrapper's. */
  const shown = dents.filter((d) => live.some((p) => p.id === d.play));
  const off = geo ?? { left: 0, top: 0, width: 0, height: 0 };
  /* Each dent's own shape comes from its play's id alone (dent.ts `dentShape`): the same for every reader and on every replay. */
  const shapesOf = shown.map((d) => shapeOf(d.play));
  const prims = dentPrimitives(shown.map((d, i) => ({ x: d.x - off.left, y: d.y - off.top, shape: shapesOf[i]! })), { width: off.width, height: off.height });
  /* Each dent's three images (dent.ts `dentImages`: kept per play, box size and density, so a render makes them once): the bend for the filter,
     the shade and the light for the two shading layers. Where the images need a canvas that is not there each is '' and sets nothing. */
  const density = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);
  const images = shown.map((d, i) => dentImages(d.play, prims[i]!, density));
  const filterOn = trusted && shown.length > 0 && geo !== null && images.every((m) => m.bend !== '');
  /* The filter's region: the wrapper's box plus DENT_SCALE on every side, in the wrapper's px (as `primitiveUnits` is). The default region
     (-10% to 120% of the box) is too small for a one-line post, where a displacement of up to DENT_SCALE / 2 px moves the glyphs out of it
     and clips them. */
  const region = { x: -DENT_SCALE, y: -DENT_SCALE, width: off.width + 2 * DENT_SCALE, height: off.height + 2 * DENT_SCALE };
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
  return (
    <div ref={host} className="dw-chair">
      {trusted ? (
        <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
          <filter id={filterId} colorInterpolationFilters="sRGB" primitiveUnits="userSpaceOnUse" filterUnits="userSpaceOnUse" {...region}>
            <feFlood floodColor="rgb(128,128,128)" result="neutral" />
            {shown.map((d, i) => (
              <Fragment key={d.play}>
                <feImage
                  href={images[i]!.bend} x={prims[i]!.x} y={prims[i]!.y} width={prims[i]!.width} height={prims[i]!.height}
                  preserveAspectRatio="none" result={`map-${i}`}
                />
                <feComponentTransfer in={`map-${i}`} result={`dent-${i}`} ref={depthRef(d.play)}>
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
        </svg>
      ) : null}
      <div ref={words} className="dw-chair-words" style={filterOn ? { filter: `url("#${filterId}")` } : undefined}>{children}</div>
      <div className="dw-chair-room" aria-hidden="true" />
      {/* The dents' shading, in two layers that each fill the content area: the shade (darkest of the overlapping dents, multiplied onto the
          words) and the light (brightest, screened on). Each is its own stacking context, so a blend inside
          it is among its own dents and the layer as a whole blends with the words (steel-chair.css). */}
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
