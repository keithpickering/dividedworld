/**
 * Heads Will Roll's effect (docs/plans/2026-11-27-season-two-cards-design.md, sections 1.3 and 2; bench: docs/research/2026-11-27-heads-will-roll/01-bench.html, Space mode): the post's
 * live reaction tiles come loose and orbit inside its content area, and to react a reader catches one. The orbit (orbit.ts) is the physics; this is the screen.
 *
 * Where. The space fills the post's content area border to border (a post's body in a thread, the ORIGIN box's area in the box: engine/ui/cards/body.ts `bodyOf`, as Feelin' Fab's
 * foil), a ground and a starfield under the words, which are drawn over it in light ink with a shadow; the heads lie in a layer over the same box. The layer takes no pointer but its heads,
 * so whatever a reader presses in the words stays pressable. No head ever crosses the box's borders: the orbit fits its rings to the box.
 *
 * The heads. Each chip of the deck (`EffectProps.reactions`) is a round head, and the React tile is the last one. They are placed once in the order the orbit projects them, heaviest
 * first (the tab order), and each frame only moves them: `transform` on the head, and the roll on the ball under its count, which stays upright. A head's size is laid out when it changes
 * (the mass changed), never in a frame; its `z-index` is written only when its rank does. A kind that joins arrives at a count of one.
 *
 * The cost. Nothing steps while the post is off screen (`watchInView`), covered (`covered`), or still (reduced motion, or History's `still`): the heads stand in loose places, put there once
 * and again when the box or the heads change. A frame is one orbit step and one write of each head's transform.
 *
 * Catching. A pointer press is the deck's `press` at once. The reel-in is the way through for keys, switches and every input under reduced motion, which cost the same as a catch: Enter or Space
 * on a head, or a click the browser reports with no pointer press before it (a switch), locks onto the head and the reaction lands after `reelSeconds(speed)`, the head's own speed at the press
 * (design 2.3), drawn as a thin bar under it; pressing again cancels. One head is reeled at a time. Under reduced motion a pointer press reels in too, for the same time: the speed is the one the head would have had moving (`movingSpeedOf`, the orbit's `pace` over its size).
 * The React head opens the deck's picker with only the kinds not yet on the post, at once on any input, since a picker is no catch.
 *
 * A reel lets go when the post is covered (`covered` turns true), when its head's kind leaves the post, and when the post goes; going off screen does not cancel it.
 * Focus. The heads are drawn in tab order, so a change of counts reorders them. A browser drops focus from a node that is moved, and React puts it back on the focused node when it commits (its own selection restore), so a keyboard reader stays on their head; a test holds it.
 *
 * The author's screen (`canReact` false): the heads still orbit but are plain. Each is an image labeled with its emoji and count (and "an Overreaction" for a local kind), takes no press, and has no
 * React head, so a reader's keys have nothing to land on and nothing says to press.
 *
 * Nothing here reads who wrote the post, who played the card or whose reaction a kind is beyond the deck's own `own` (the reader's own, on their screen): the labels say "yours" only for it.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useMotionReduced } from '../../../../engine/ui/appearance.ts';
import { bodyBox, bodyOf, placeLayer, sameBox, type BodyBox } from '../../../../engine/ui/cards/body.ts';
import type { CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import { watchInView } from '../../../../engine/ui/shine/inView.ts';
import { seeded } from '../seeded.ts';
import { byMass, createOrbit, headMass, ORBIT, reelSeconds, type HeadSpec, type Orbit, type ProjectedHead } from './orbit.ts';
import './heads-will-roll.css';

/** The React head's id; a kind's head is `k:<key>`, so the two never meet. */
const REACT_ID = 'react';
const kindId = (key: string): string => `k:${key}`;
/** A click this soon after a pointer press is the same gesture (the press already caught it). */
const SAME_GESTURE_MS = 800;
/** A head's count is drawn at this share of its size. */
const FONT_SHARE = 0.4;

export const STATE_LOOSE = 'Reactions loose in this post';
export const STATE_REELING = 'Reeling in a head';
export const LENS_REPORT = 'The reactions on this post are loose heads. Press one to catch it and react. By keyboard or switch, focus a head and press Enter or Space to reel it in: the reaction lands when the bar under the head fills, and pressing again to cancel lets it go. With reduced motion the heads stand still and every press reels in. The React head opens the picker, which offers only kinds not yet on the post.';

/** One head's words: its emoji and count, then what is true of it. */
function headLabel(emoji: string, count: number, o: { readonly local: boolean; readonly mine: boolean; readonly pending: boolean; readonly plain: boolean }): string {
  const base = o.plain ? `${emoji} ${count}` : `${emoji} ${count}, press to catch`;
  return `${base}${o.local ? ', an Overreaction' : ''}${o.mine ? ', yours' : ''}${o.pending && !o.plain ? ', counting soon, press to undo' : ''}`;
}

interface Reeling { readonly id: string; readonly seconds: number }

export function HeadsWillRollEffect({ post, reactions: deck, still, covered, show, met, children }: EffectProps) {
  const { settings } = useKayfa();
  const reduced = useMotionReduced();
  const calm = still || reduced;
  const host = useRef<HTMLDivElement>(null);
  const ground = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const ranks = useRef(new Map<string, number>());
  const sizes = useRef(new Map<string, number>());
  const [inView, setInView] = useState(false);
  const [reeling, setReeling] = useState<Reeling | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointer = useRef(0);

  const cards = settings.cardSettings;
  const orbitSettings = useMemo(() => ({
    overMass: cards['headsWillRoll.overMass'] ?? ORBIT.defaults.overMass, suns: cards['headsWillRoll.suns'] ?? ORBIT.defaults.suns, mostTurns: cards['headsWillRoll.mostTurns'] ?? ORBIT.defaults.mostTurns,
  }), [cards]);
  const reel = useMemo(() => ({
    reelBase: cards['headsWillRoll.reelBase'] ?? ORBIT.defaults.reelBase, reelPerSpeed: cards['headsWillRoll.reelPerSpeed'] ?? ORBIT.defaults.reelPerSpeed,
  }), [cards]);

  const canReact = deck?.canReact === true;
  const chips = deck?.chips ?? [];
  const specs = useMemo<HeadSpec[]>(() => [
    ...chips.map((c): HeadSpec => ({ id: kindId(c.key), count: Math.max(1, c.count ?? 1), local: c.local })),
    ...(deck && canReact ? [{ id: REACT_ID, count: 0, react: true } as HeadSpec] : []),
  ], [chips, deck, canReact]);

  /* The orbit is made once, seeded from the post's public id so every screen starts alike. */
  const orbitRef = useRef<Orbit | null>(null);
  orbitRef.current ??= createOrbit({ width: 0, height: 0 }, { seed: Math.floor(seeded(post.id)() * 2147483647), settings: orbitSettings });
  const orbit = orbitRef.current;
  /* The projection, kept for the step it was made in so a paint and a speed read share one sort. */
  const projected = useRef<readonly ProjectedHead[] | null>(null);
  const projection = useCallback((): readonly ProjectedHead[] => (projected.current ??= orbit.project()), [orbit]);
  /* The heads in tab order, heaviest first and the React head last: the orbit's own order, worked out from the specs alone so the render needs no orbit step. */
  const order = useMemo(() => specs.map((h) => ({ ...h, react: h.react === true, mass: headMass(h, orbitSettings) })).sort(byMass), [specs, orbitSettings]);

  /* The orbit takes the heads and the card's settings in a layout effect (so it is safe to run twice), before the box is measured and the heads are painted. */
  useLayoutEffect(() => {
    orbit.setSettings(orbitSettings);
    orbit.setHeads(specs);
    projected.current = null;
  }, [orbit, orbitSettings, specs]);

  /* Write the heads where the orbit has them: transform on the head, the roll on its ball, a size only when it changed, a rank only when it changed. */
  const paint = useCallback((): void => {
    for (const p of projection()) {
      const el = nodes.current.get(p.id);
      if (!el) continue;
      if (sizes.current.get(p.id) !== p.size) {
        sizes.current.set(p.id, p.size);
        el.style.width = `${p.size}px`;
        el.style.height = `${p.size}px`;
        el.style.fontSize = `${Math.max(9, p.size * FONT_SHARE)}px`;
      }
      el.style.transform = `translate(${p.x - p.size / 2}px, ${p.y - p.size / 2}px) scale(${p.scale})`;
      if (ranks.current.get(p.id) !== p.rank) { ranks.current.set(p.id, p.rank); el.style.zIndex = String(p.rank); }
      const ball = el.firstElementChild as HTMLElement | null;
      if (ball) ball.style.transform = `rotate(${p.angle}rad)`;
    }
  }, [projection]);

  /* The box: the content area's, found again at each measure, placed over from the host. */
  useLayoutEffect(() => {
    const el = host.current, back = ground.current, front = layer.current;
    if (!el || !back || !front) return;
    let body: HTMLElement | null = null;
    let placed: BodyBox = { left: 0, top: 0, w: -1, h: -1 };
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure()) : null;
    function measure(): void {
      const now = bodyOf(el!);
      if (now !== body) {
        if (body) resize?.unobserve(body);
        if (now) resize?.observe(now);
        body = now;
        el!.toggleAttribute('data-kb-bleed', body !== null);
      }
      const box = bodyBox(el!, body);
      if (sameBox(box, placed)) return;
      placed = box;
      placeLayer(back!, box);
      placeLayer(front!, box);
      orbit.setBox({ width: box.w, height: box.h });
      projected.current = null;
      paint();
    }
    resize?.observe(el);
    measure();
    return () => { resize?.disconnect(); el.removeAttribute('data-kb-bleed'); };
  }, [orbit, paint]);

  /* The heads change (a kind joined, a count moved): they are put where the orbit has them before the browser paints. */
  useLayoutEffect(() => { projected.current = null; paint(); }, [paint, specs, orbitSettings]);


  useEffect(() => {
    const el = host.current;
    return el ? watchInView(el, setInView) : undefined;
  }, []);
  const metOnce = useRef(false);
  useEffect(() => { if (inView && !metOnce.current) { metOnce.current = true; met(); } }, [inView, met]);

  /* The frames: only while the post is on screen, uncovered and moving. */
  useEffect(() => {
    if (calm || !inView || covered) return;
    let raf = 0;
    let last: number | null = null;
    const tick = (t: number): void => {
      orbit.step(last === null ? 0 : Math.min(ORBIT.mostStep, Math.max(0, (t - last) / 1000)));
      projected.current = null;
      last = t;
      paint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [calm, inView, covered, orbit, paint]);

  const cancelReel = useCallback((): void => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    setReeling(null);
  }, []);
  useEffect(() => cancelReel, [cancelReel]);
  /* A cover over the post lets a reel go: nothing is caught under it (going off screen does not). */
  useEffect(() => { if (covered) cancelReel(); }, [covered, cancelReel]);
  /* A head that is gone (its kind left the post) is let go. */
  useEffect(() => { if (reeling && !specs.some((s) => s.id === reeling.id)) cancelReel(); }, [reeling, specs, cancelReel]);

  const deckNow = useRef(deck);
  deckNow.current = deck;
  const speedOf = (id: string): number => projection().find((p: ProjectedHead) => p.id === id)?.speed ?? 0;
  /* The speed a still head would have had moving, in its own widths a second: the orbit's own pace for it (px a second in the space) over its size, so a reel-in costs what a catch does. */
  const movingSpeedOf = (id: string): number => {
    const b = orbit.bodies().find((x) => x.id === id);
    return b && b.size > 0 ? b.pace / b.size : 0;
  };

  /* A reel-in on a kind's head: the reaction lands after the time a pointer catch of this head would take; again, it lets go. */
  function reelIn(id: string, key: string): void {
    if (reeling?.id === id) { cancelReel(); return; }
    cancelReel();
    const seconds = reelSeconds(calm ? movingSpeedOf(id) : speedOf(id), reel);
    setReeling({ id, seconds });
    timer.current = setTimeout(() => {
      timer.current = null;
      setReeling(null);
      deckNow.current?.press(key);
    }, seconds * 1000);
  }

  function activate(id: string, key: string | null, pointer: boolean, anchor: HTMLElement): void {
    if (!deck) return;
    if (key === null) { cancelReel(); deck.picker.open(anchor, true); return; }
    if (pointer && !calm) { cancelReel(); deck.press(key); return; }
    reelIn(id, key);
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, id: string, key: string | null): void => {
    if (e.button > 0) return;
    lastPointer.current = Date.now();
    activate(id, key, true, e.currentTarget);
  };
  /* A press that ended without a click (a touch dragged off, a cancel) is over: it must not swallow a switch's click that follows. */
  const onPointerEnd = (): void => { lastPointer.current = 0; };
  const onClick = (e: { currentTarget: HTMLElement }, id: string, key: string | null): void => {
    /* The press that made this click was already handled; a click with none before it is a switch or a screen reader's. */
    if (lastPointer.current !== 0 && Date.now() - lastPointer.current < SAME_GESTURE_MS) { lastPointer.current = 0; return; }
    activate(id, key, false, e.currentTarget);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>, id: string, key: string | null): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (e.repeat) return;
    activate(id, key, false, e.currentTarget);
  };
  /* A Space released on a button clicks it in some browsers, though its keydown was handled. */
  const onKeyUp = (e: ReactKeyboardEvent<HTMLElement>): void => { if (e.key === ' ') e.preventDefault(); };

  /* What the Lens and the mark say. */
  const reelingNow = reeling !== null;
  useEffect(() => {
    const view: CardView = { progress: null, state: reelingNow ? STATE_REELING : STATE_LOOSE, yours: deck !== undefined && canReact, controls: [], notes: {}, report: LENS_REPORT };
    show(view);
    return () => show(null);
  }, [show, reelingNow, deck !== undefined, canReact]); // eslint-disable-line react-hooks/exhaustive-deps

  const ownKinds = new Set((deck?.own ?? []).map((r) => r.kind));
  const reelNote = reeling ? `Reeling in, ${reeling.seconds.toFixed(1)} seconds. Press again to cancel.` : '';

  return (
    <div ref={host} className="dw-hwr" data-kb-hwr="">
      <div ref={ground} className="dw-hwr-ground" aria-hidden="true" />
      <div className="dw-hwr-words">{children}</div>
      <div ref={layer} className="dw-hwr-heads">
        {deck && order.map((p) => {
          const chip = p.react ? null : chips.find((c) => kindId(c.key) === p.id);
          if (!p.react && !chip) return null;
          const ref = (el: HTMLElement | null): void => { if (el) nodes.current.set(p.id, el); else { nodes.current.delete(p.id); sizes.current.delete(p.id); ranks.current.delete(p.id); } };
          const face = p.react
            ? <span className="dw-hwr-face" aria-hidden="true"><b>+</b></span>
            : <span className="dw-hwr-face" aria-hidden="true"><span>{chip!.emoji}</span><b>{Math.max(1, chip!.count ?? 1)}</b></span>;
          const common = { ref, className: `dw-hwr-head${canReact ? '' : ' dw-hwr-plain'}`, 'data-head': p.id, ...(p.react ? { 'data-react': '' } : {}), ...(p.local ? { 'data-local': '' } : {}) };
          if (!canReact) {
            return (
              <span key={p.id} {...common} role="img" aria-label={headLabel(chip!.emoji, Math.max(1, chip!.count ?? 1), { local: chip!.local, mine: false, pending: false, plain: true })}>
                <span className="dw-hwr-ball" aria-hidden="true" />
                {face}
              </span>
            );
          }
          const mine = chip ? ownKinds.has(chip.key) : false;
          const key = chip ? chip.key : null;
          return (
            <button
              key={p.id}
              type="button"
              {...common}
              {...(mine ? { 'data-yours': '' } : {})}
              {...(chip?.pending ? { 'data-pending': '' } : {})}
              aria-label={chip ? headLabel(chip.emoji, Math.max(1, chip.count ?? 1), { local: chip.local, mine, pending: chip.pending !== null, plain: false }) : 'React, press to pick a new reaction'}
              onPointerDown={(e) => onPointerDown(e, p.id, key)}
              onPointerCancel={onPointerEnd}
              onPointerLeave={onPointerEnd}
              onClick={(e) => onClick(e, p.id, key)}
              onKeyDown={(e) => onKeyDown(e, p.id, key)}
              onKeyUp={onKeyUp}
            >
              <span className="dw-hwr-ball" aria-hidden="true" />
              {face}
              {reeling?.id === p.id && <span className="dw-hwr-reel" aria-hidden="true" style={{ animationDuration: `${reeling.seconds}s` }} />}
            </button>
          );
        })}
        <p className="dw-hwr-note" role="status">{deck?.refusal ?? reelNote}</p>
      </div>
    </div>
  );
}
