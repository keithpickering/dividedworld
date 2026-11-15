/**
 * Steel Chair's effect (docs/plans/2026-11-15-steel-chair-plan.md, Task 5, as amended: the world is the post's content area): a folding chair
 * is thrown at the post from any direction, dents it (the words bend into a displacement filter's dent, shaded over them), shakes it once and
 * falls to the floor as a rigid box (body.ts), where it tips, slides and sleeps. Up to three at once, each its own throw 350 ms after the last.
 * Nothing is seeded, saved or sent: each run draws its throws from a generator seeded freshly from the reader's own screen
 * (`crypto.getRandomValues`), so every run and every reader sees a different one, and the effect reads neither who wrote the post nor who
 * played the card. A play's moment (`still`) is the one exception to the freshness: seeded from the plays' ids, so it is the same each time.
 *
 * Where. The chairs' layer and the dents' shading fill the post's content area border to border, placed the way Feelin' Fab's foil and Whoops!'s
 * ink are (engine/ui/cards/body.ts: `bodyOf`, `bodyBox`, `placeLayer`, the bare `data-kb-effect-ink` mark the thread's CSS lifts above the
 * words). That box is the physics world: its left and right borders are the walls and its bottom border the floor, so a chair at rest lies on
 * the border itself. Where there is no body (outside a thread) the effect's own box is the world. A `ResizeObserver` on the box (and the host)
 * resizes the world and places the layers again. The words are a wrapper inside the host; the throw aims at them, and since the filter is
 * applied to that wrapper its coordinates are the wrapper's, not the content area's: `geo` holds the measured offset between the two. While any
 * play is live the host holds 28 px of room after the words (`.dw-chair-room`), so a chair lying at the bottom covers no words.
 *
 * When. A run starts once the host's middle (`watchInView`, margin `-20% 0px -20% 0px`, as Glitter Bomb arms its burst) has been in view for 300 ms,
 * and is cleared when the post has wholly left the view, so coming back starts a new one. While a run is up a second observer, without a margin,
 * watches for that departure, and a size observer watches the box; out of view a post holds only the arming observer. A play that lands while the
 * run stands is thrown alone into the standing world, and one that ends (`useAt`) loses its chair and dent while the others stay where they lie.
 * Reduced motion has no flight, no shake and no wait (there is nothing to time): the world is built, run to rest and drawn at once, without sound.
 *
 * Frames. The loop runs on `requestAnimationFrame` only while a body is awake (or a dent is growing) and sets each chair's and each piece's style
 * straight on the DOM nodes through refs; React renders only when a chair or a dent comes or goes. The shade of a piece is taken from its normal
 * after the body's orientation turns it, since the light is fixed in the world. A dent's depth grows by moving its map's pixels from neutral
 * (128) to full, so each dent has its own growth in the one filter, and the others keep their depth when a new one lands.
 *
 * Sound. The first run after the effect mounts plays `steel-chair.hit` on each hit and one of the four settle sounds on each chair's first floor
 * contact, in the group `steel-chair`; a replay (by scroll or by Throw again) and the reduced and still draws are silent.
 */
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { addThrow, bodies, createWorld, remove, resize, rng, settle, step, STEP, throwOf, type Box, type Event as BodyEvent, type World } from './body.ts';
import { piecesOf, shadeOf, type Piece } from './chair.ts';
import { DENT_SCALE, dentMapUrl, dentPrimitives, filterTrusted } from './dent.ts';
import './steel-chair.css';

/** The most chairs one post draws (the card's stack). */
const MOST = 3;
/** The middle of the view the post must be in for a run to start (the top and bottom fifths do not count), and how long it stays there first. */
const ARM_ZONE = '-20% 0px -20% 0px';
const ARM_MS = 300;
/** The gap between one play's throw and the next, and how long a dent takes to reach its full depth. */
const GAP_MS = 350;
const GROW_MS = 90;
/** The longest a run is settled for at once (reduced motion and a moment), in simulated seconds: every throw sleeps well inside it. */
const SETTLE_S = 12;
const GROUP = 'steel-chair';

/** A fresh seed from the reader's own screen: nothing about who they are, only what makes one run differ from the next. */
const freshSeed = (): number => {
  const c = globalThis.crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0]!;
  return Math.floor(Math.random() * 2 ** 32);
};
/** A moment's seed: the plays' ids (public), hashed (FNV-1a), so it is the same each time it is opened. */
const seedOfIds = (ids: readonly string[]): number => {
  let h = 2166136261;
  for (const ch of ids.join('|')) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/** A dent: where it landed in the content area's px, and whether it is drawn at full depth from the start (reduced motion, a moment). */
interface Dent { readonly play: string; readonly x: number; readonly y: number; readonly full: boolean }
/** Where the words wrapper stands in the content area, and how big it is: what the filter's coordinates are converted by. */
interface Geo { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
/** What the run offers the views: another run, and the plays' list having changed. */
interface Control { replay(): void; sync(): void }
/** What a chair's group remembers between frames, so a style is written only when it changed. */
interface Cache { pieces: HTMLElement[]; list: Piece[]; fold: number; transform: string; matrices: string[]; applied: string[]; shades: string[] }

const sameGeo = (a: Geo | null, b: Geo): boolean => a !== null && Math.abs(a.left - b.left) < 0.01 && Math.abs(a.top - b.top) < 0.01 && Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01;

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

/** The pieces a chair is drawn from: their size and place are fixed (the order is `piecesOf`'s at every fold), their transform and shade are the frame loop's. */
const PIECES = piecesOf(1);

export function SteelChairEffect(props: EffectProps) {
  const { plays, still, show, children } = props;
  const ends = useMemo(() => plays.flatMap((p) => (p.ends !== undefined ? [Date.parse(p.ends)] : [])), [plays]);
  const now = useAt(still ? [] : ends);
  /* A moment draws its plays as they stood; a live post drops the plays whose end has passed (the engine goes on handing them over). */
  const live = useMemo(() => (still ? plays : plays.filter((p) => p.ends === undefined || Date.parse(p.ends) > now)).slice(0, MOST), [plays, still, now]);
  return live.length > 0 ? <Chairs {...props} live={live} /> : <Bare show={show}>{children}</Bare>;
}

/** No live play: the words alone, and nothing to show. */
function Bare({ show, children }: { show: EffectProps['show']; children: EffectProps['children'] }) {
  useEffect(() => { show(null); return () => show(null); }, [show]);
  return <>{children}</>;
}

function Chairs({ live, still, place, show, met, children }: EffectProps & { live: readonly CardPlay[] }) {
  const reduced = useMotionReduced();
  const sound = useSound();
  const gameSound = useGameSound();
  const filterId = useId();
  const trusted = useMemo(() => filterTrusted(), []);
  const mapUrl = useMemo(() => (trusted ? dentMapUrl() : ''), [trusted]);
  const host = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const shading = useRef<HTMLDivElement>(null);
  const [chairs, setChairs] = useState<readonly string[]>([]);
  const [dents, setDents] = useState<readonly Dent[]>([]);
  const [geo, setGeo] = useState<Geo | null>(null);
  /* What the frame loop writes to: each chair's group, and each dent's two transfer functions (its depth), by play. */
  const groups = useRef(new Map<string, HTMLElement>());
  const depths = useRef(new Map<string, SVGElement[]>());
  const control = useRef<Control | null>(null);
  const paintNow = useRef<() => void>(() => {});
  /* Whether the next run is the first since the effect mounted: only that one has sound. And whether the card has been met. */
  const first = useRef(true);
  const met1 = useRef(false);
  const latest = useRef({ live, sound, met });
  latest.current = { live, sound, met };

  const key = live.map((p) => p.id).join('|');
  useEffect(() => {
    const el = host.current, wordsEl = words.current, chairLayer = layer.current, dentLayer = shading.current;
    if (!el || !wordsEl || !chairLayer || !dentLayer) return;
    let world: World | null = null;
    let running = false;
    let loud = false;
    let rand: () => number = rng(0);
    let box: BodyBox = { left: 0, top: 0, w: 0, h: 0 };
    let geoNow: Geo | null = null;
    let body: HTMLElement | null = null;
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
    const throws = new Map<string, ReturnType<typeof setTimeout>>();
    const growing = new Map<string, number | null>();
    const caches = new Map<string, Cache>();

    /* The box to paint and its words: the content area's padding box (or the host's own), the layers placed over it, and where the words stand in it. */
    const measure = (): boolean => {
      const next = bodyOf(el, place);
      if (next !== body || !found) {
        found = true;
        if (body) size?.unobserve(body);
        if (next) size?.observe(next);
        body = next;
      }
      const b = bodyBox(el, body);
      const w = wordsEl.getBoundingClientRect(), h = el.getBoundingClientRect();
      const g: Geo = { left: w.left - h.left - b.left, top: w.top - h.top - b.top, width: w.width, height: w.height };
      const moved = !sameBox(b, box) || !sameGeo(geoNow, g);
      box = b;
      target = { left: g.left, top: g.top, width: g.width, height: g.height };
      placeLayer(chairLayer, b);
      placeLayer(dentLayer, b);
      if (moved) { geoNow = g; setGeo(g); }
      return moved;
    };

    const cacheOf = (play: string): Cache | null => {
      let c = caches.get(play);
      if (c) return c;
      const group = groups.current.get(play);
      if (!group) return null;
      c = { pieces: [...group.children] as HTMLElement[], list: PIECES, fold: -1, transform: '', matrices: [], applied: [], shades: [] };
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
        const transform = `translate3d(${v.position.x.toFixed(2)}px, ${v.position.y.toFixed(2)}px, ${v.position.z.toFixed(2)}px) scale(${v.scale.toFixed(3)}) matrix3d(${m.map((n) => n.toFixed(5)).join(', ')})`;
        if (transform !== c.transform) { group.style.transform = transform; c.transform = transform; }
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
        setDents((d) => (d.some((x) => x.play === play) ? d : [...d, { play, x: e.at.x, y: e.at.y, full: false }]));
        growing.set(play, null);
        shake();
        if (loud) void latest.current.sound.play('steel-chair.hit', { group: GROUP });
      } else if (e.kind === 'floor' && loud) {
        void latest.current.sound.play(`steel-chair.settle-${1 + Math.floor(rand() * 4)}`, { group: GROUP });
      }
    };

    const tick = (t: number): void => {
      raf = 0;
      if (!world) return;
      const dt = lastT ? Math.min(0.05, Math.max(0, (t - lastT) / 1000)) : STEP;
      lastT = t;
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 12) { for (const e of step(world, STEP)) onEvent(e); acc -= STEP; n++; }
      if (n === 12) acc = 0;
      grow(t);
      const awake = paint();
      if (awake || growing.size > 0) raf = requestAnimationFrame(tick); else lastT = 0;
    };
    const wake = (): void => { if (!raf && world) raf = requestAnimationFrame(tick); };

    /* A chair into the standing world, in flight. */
    const addPlay = (play: CardPlay): void => {
      if (!world || bodyOfPlay.has(play.id)) return;
      const id = addThrow(world, throwOf(rand, target));
      bodyOfPlay.set(play.id, id);
      playOfBody.set(id, play.id);
      setChairs((c) => (c.includes(play.id) ? c : [...c, play.id]));
    };
    const throwLater = (play: CardPlay): void => {
      throws.delete(play.id);
      if (!running || !world) return;
      addPlay(play);
      wake();
    };
    /* Reduced motion and a moment: every new throw at once, settled with the rest, its dent at full depth. */
    const placeAll = (plays: readonly CardPlay[]): void => {
      if (!world) return;
      const added: { play: string; x: number; y: number }[] = [];
      for (const p of plays) {
        if (bodyOfPlay.has(p.id)) continue;
        const th = throwOf(rand, target);
        const id = addThrow(world, th);
        bodyOfPlay.set(p.id, id);
        playOfBody.set(id, p.id);
        added.push({ play: p.id, x: th.target.x, y: th.target.y });
      }
      settle(world, SETTLE_S);
      if (added.length > 0) {
        setChairs((c) => [...c, ...added.map((a) => a.play).filter((id) => !c.includes(id))]);
        setDents((d) => [...d, ...added.filter((a) => !d.some((x) => x.play === a.play)).map((a) => ({ ...a, full: true }))]);
      }
      paint();
    };

    const meet = (): void => {
      if (still || met1.current) return;
      met1.current = true;
      latest.current.met();
    };

    /* While a run stands: the post wholly leaving the view clears it, and the box's size is watched. */
    const startWatching = (): void => {
      stopLeave = watchInView(el, (showing) => { if (!showing) clearRun(true); });
      if (typeof ResizeObserver !== 'function') return;
      size = new ResizeObserver(() => {
        if (!world || !measure()) return;
        resize(world, box.w, box.h, box.h);
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
      loud = first.current && !still && !reduced;
      first.current = false;
      rand = rng(still ? seedOfIds(latest.current.live.map((p) => p.id)) : freshSeed());
      world = createWorld(box.w, box.h, box.h);
      const plays = latest.current.live;
      meet();
      if (!still) startWatching();
      if (still || reduced) { placeAll(plays); return; }
      plays.forEach((p, i) => {
        if (i === 0) addPlay(p);
        else throws.set(p.id, setTimeout(() => throwLater(p), i * GAP_MS));
      });
      wake();
    };

    const clearRun = (render: boolean): void => {
      stopLeave(); stopLeave = () => {};
      size?.disconnect(); size = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0; lastT = 0; acc = 0;
      for (const t of throws.values()) clearTimeout(t);
      throws.clear();
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
      replay: () => { clearRun(true); first.current = false; startRun(); },
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
        for (const [play, t] of [...throws]) if (!ids.has(play)) { clearTimeout(t); throws.delete(play); }
        setChairs((c) => c.filter((id) => ids.has(id)));
        setDents((d) => d.filter((x) => ids.has(x.play)));
        const fresh = plays.filter((p) => !bodyOfPlay.has(p.id) && !throws.has(p.id));
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
      clearRun(false);
      control.current = null;
      paintNow.current = () => {};
    };
  }, [still, reduced, place]);

  /* Plays that came or went, after the run's own effect has run. */
  useEffect(() => { control.current?.sync(); }, [key]);
  /* A chair or a dent that was just rendered is placed at once, never waiting for a frame. */
  useLayoutEffect(() => { paintNow.current(); }, [chairs, dents]);

  /* The Lens: how many chairs, when the first is gone, and the two controls (none in a moment). */
  const n = live.length;
  const soonest = live.reduce<number | null>((m, p) => (p.ends === undefined ? m : m === null ? Date.parse(p.ends) : Math.min(m, Date.parse(p.ends))), null);
  const replay = useCallback(() => { control.current?.replay(); }, []);
  const view = useMemo<CardView>(() => {
    const at = soonest === null ? null : new Date(soonest).toISOString();
    const ends = at === null ? undefined : n === 1 ? endsWords(at) : `The first chair is gone ${dayAndTime(at)}; each lasts ${spanWords(STEEL_CHAIR_LASTS)}.`;
    return {
      progress: null,
      state: n === 1 ? 'Dented by a chair' : `Dented by ${n} chairs`,
      ...(ends !== undefined ? { ends } : {}),
      yours: false,
      controls: still ? [] : [{ kind: 'press', label: 'Throw again', run: replay }, { kind: 'toggle', label: 'Game sounds', on: gameSound.on, set: gameSound.set }],
      notes: {},
    };
  }, [n, soonest, still, replay, gameSound.on, gameSound.set]);
  useEffect(() => { show(view); }, [show, view]);
  useEffect(() => () => show(null), [show]);

  /* The filter and the shading, from the dents in the content area's px: the filter's coordinates are the words wrapper's. */
  const shown = dents.filter((d) => live.some((p) => p.id === d.play));
  const off = geo ?? { left: 0, top: 0, width: 0, height: 0 };
  const prims = dentPrimitives(shown.map((d) => ({ x: d.x - off.left, y: d.y - off.top })), { width: off.width, height: off.height });
  const filterOn = trusted && shown.length > 0 && geo !== null;
  return (
    <div ref={host} className="dw-chair" data-kb-chair="">
      {trusted ? (
        <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
          <filter id={filterId} colorInterpolationFilters="sRGB" primitiveUnits="userSpaceOnUse">
            <feFlood floodColor="rgb(128,128,128)" result="neutral" />
            {shown.map((d, i) => (
              <Fragment key={d.play}>
                <feImage href={mapUrl} x={prims[i]!.x} y={prims[i]!.y} width={prims[i]!.size} height={prims[i]!.size} preserveAspectRatio="none" result={`map-${i}`} />
                <feComponentTransfer in={`map-${i}`} result={`dent-${i}`} ref={(node) => { if (node) depths.current.set(d.play, [...node.children] as SVGElement[]); else depths.current.delete(d.play); }}>
                  <feFuncR type="linear" slope={d.full ? 1 : 0} intercept={d.full ? 0 : 0.5} />
                  <feFuncG type="linear" slope={d.full ? 1 : 0} intercept={d.full ? 0 : 0.5} />
                </feComponentTransfer>
              </Fragment>
            ))}
            <feMerge result="map">
              <feMergeNode in="neutral" />
              {shown.map((d, i) => <feMergeNode key={d.play} in={`dent-${i}`} />)}
            </feMerge>
            <feDisplacementMap in="SourceGraphic" in2="map" scale={DENT_SCALE} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      ) : null}
      <div ref={words} className="dw-chair-words" style={filterOn ? { filter: `url("#${filterId}")` } : undefined}>{children}</div>
      <div className="dw-chair-room" aria-hidden="true" />
      <div ref={shading} className="dw-chair-dents" data-kb-effect-ink="" aria-hidden="true">
        {shown.map((d, i) => (
          <div key={d.play} className="dw-chair-dent" style={{ left: `${prims[i]!.x + off.left}px`, top: `${prims[i]!.y + off.top}px`, width: `${prims[i]!.size}px`, height: `${prims[i]!.size}px` }} />
        ))}
      </div>
      <div ref={layer} className="dw-chair-layer" data-kb-effect-ink="" aria-hidden="true">
        {chairs.filter((id) => live.some((p) => p.id === id)).map((id) => (
          <div key={id} className="dw-chair-group" data-play={id} ref={(node) => { if (node) groups.current.set(id, node); else groups.current.delete(id); }}>
            {PIECES.map((p) => (
              <div key={p.name} className="dw-chair-piece" data-kind={p.kind} style={{ width: p.width, height: p.height, left: p.left, top: p.top }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
