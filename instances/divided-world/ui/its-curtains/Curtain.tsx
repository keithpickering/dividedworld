/**
 * The curtain, drawn and moved (docs/plans/2026-11-23-its-curtains-design.md, sections 2.8 to 2.11; the plan's Task 6; the look and motion are the owner's approved
 * bench of 2026-11-25, and every number of them is in tuning.ts). It is shared by the two places a curtain hangs: the row cover the engine mounts over a thread's post
 * (Cover.tsx) and the effect's own cover of a content area where a post has no row (Effect.tsx). It fills the box it is given, which is its parent's.
 *
 * What is drawn: two halves of pleats, each pleat the fabric's dark, mid, light, mid and dark shades at the Minus World drawing's stops, a row of swags with gold
 * trim and beads along the top edge, and the next curtain of the stack under it. Two soft spotlights sit dim either side of the middle and, while the drumroll plays,
 * trace a figure 8 over the curtain's visible part and brighten the trim and beads they pass. The swags and the nap of the velvet are drawn in drawing.ts; nothing
 * here loads the research files.
 *
 * The curtain is one button over the box. It opens on a click or tap, or Enter or Space, and a click that ends a drag, a scroll or a text selection opens nothing. On a
 * press: the drumroll stops and the cymbal crashes at once, the halves and the swags leave (the fabric's lag on top of their slide, the Web Animations API from one pure
 * function), the whoosh plays as they start and the tada just before they are out, the confetti is thrown part-way through, and `onOpened` is called once they are out.
 * Under reduced motion it opens at once, the spotlights stand still and no confetti flies, and the three sounds still play in order.
 *
 * The drumroll loops while a mouse that has really moved is over the curtain (Laugh Track's rule, ui/laugh-track/Effect.tsx: an enter, or a move with no position
 * known yet, only records where the mouse was), and on a touch screen while the curtain crosses the reader's line (`laughTrack.line`, read as the watcher reads it).
 * It is the reader's own: nothing is sent or saved, and nothing here reads who played the curtain or who wrote the post.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointer, type MouseEvent as ReactMouse } from 'react';
import { useSound } from '../../../../engine/ui/audio/sound.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import { useFeel } from '../../../../engine/ui/glass/motion.ts';
import { FABRICS, type Fabric } from '../../cards/its-curtains.ts';
import { readingLine } from '../laugh-track/line.ts';
import { confettiColors, confettiPieces, seedOf, throwConfetti } from './confetti.ts';
import { fabricFrames, lagOvershoot, NOISE_URI, spotPose, swagArt, type SwagArt } from './drawing.ts';
import { TUNING } from './tuning.ts';
import './curtains.css';

export interface CurtainProps {
  /** The outermost curtain's fabric, and the next one's under it if there is one. */
  readonly fabric: Fabric;
  readonly under?: Fabric | undefined;
  /** The play's id: the drumroll's id and the confetti's seed. */
  readonly seed: string;
  /** Which of the stack this is, counting from the outermost (1), and how many there are. */
  readonly n: number;
  readonly total: number;
  /** Called once, when the halves are out. */
  readonly onOpened: () => void;
}

const GROUP = 'its-curtains';
const SOUND_OPTS = { group: GROUP, voices: 3 } as const;

/* Where the mouse last moved on this page, and how many curtains are listening: one document `pointermove` listener serves every curtain (Laugh Track's record,
   ui/laugh-track/Effect.tsx), so a curtain mounted under a mouse at rest knows where the mouse was, and a move is a move. */
let lastPointer: { x: number; y: number } | null = null;
let listeners = 0;
const onDocumentMove = (e: PointerEvent): void => { if (e.pointerType === 'mouse') lastPointer = { x: e.clientX, y: e.clientY }; };
const listen = (): void => { if (listeners++ === 0) document.addEventListener('pointermove', onDocumentMove); };
const unlisten = (): void => { if (--listeners === 0) document.removeEventListener('pointermove', onDocumentMove); };

/** An enter or a move: whether the mouse really moved since it was last seen. A browser may send either to a curtain drawn under a still mouse, so with no position known it only records. */
const moved = (e: { clientX: number; clientY: number }): boolean => {
  const was = lastPointer;
  lastPointer = { x: e.clientX, y: e.clientY };
  if (was === null) return false;
  return was.x !== e.clientX || was.y !== e.clientY;
};

const coarse = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
const hudHeight = (): number => Number.parseFloat(document.documentElement.style.getPropertyValue('--kb-hud-measured')) || 0;

/** A curtain that was open and had the keyboard's focus hands it to the next one that mounts within a moment, so a keyboard reader presses through a stack. */
let handedFocusAt = 0;
const HANDOFF_MS = 1000;

/** For tests: forget where the mouse was, and any focus waiting to be handed on. */
export const __resetPointer = (): void => { lastPointer = null; handedFocusAt = 0; };

/* ---------- the spotlights ---------- */

interface Glints { readonly grads: (SVGRadialGradientElement | null)[]; readonly grps: (SVGGElement | null)[] }

interface Spots { setHot(on: boolean): void; draw(): void; dispose(): void }

/**
 * The two spotlights over `root`'s visible part, one frame loop while the drumroll plays or they are still settling (a still curtain asks for no frame). They brighten with
 * the drumroll, trace the figure 8 unless `reduced()`, and move the glint gradients that light the trim and the beads they pass.
 */
function makeSpots(root: HTMLElement, spots: readonly HTMLElement[], glints: Glints, reduced: () => boolean): Spots {
  let k = 0, phase = 0, hot = false, raf = 0, lastT = 0;
  const draw = (): void => {
    const W = root.clientWidth, H = root.clientHeight;
    const r = root.getBoundingClientRect();
    const top = Math.max(0, -r.top), bottom = Math.min(H, window.innerHeight - r.top);
    const span = bottom - top > 40 ? bottom - top : H;
    const box = { w: W, top: bottom - top > 40 ? top : 0, span };
    spots.forEach((s, i) => {
      const p = spotPose(phase, i, box, k, reduced() ? 0 : k);
      s.style.width = `${p.w}px`; s.style.height = `${p.h}px`;
      s.style.transform = `translate(${p.x - p.w / 2}px,${p.y - p.h / 2}px)`;
      s.style.opacity = String(p.opacity);
      glints.grads[i]?.setAttribute('gradientTransform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) scale(${(p.w * 0.5).toFixed(1)} ${(p.h * 0.5).toFixed(1)})`);
      glints.grps[i]?.setAttribute('opacity', Math.min(1, p.opacity * 1.15).toFixed(3));
    });
  };
  const tick = (now: number): void => {
    raf = 0;
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    k += ((hot ? 1 : 0) - k) * Math.min(1, dt * 8);
    if (hot || k > 0.003) phase += dt * ((2 * Math.PI) / Math.max(0.5, TUNING.spot.lapSeconds));
    draw();
    if (hot || k > 0.003) raf = requestAnimationFrame(tick);
  };
  const kick = (): void => { if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(tick); } };
  return {
    setHot(on) { hot = on; kick(); },
    draw,
    dispose() { if (raf) cancelAnimationFrame(raf); raf = 0; },
  };
}

/* ---------- the drawing ---------- */

const GOLD = { light: '#fff2a8', body: '#e2ba00', dark: '#aa8c00', deep: '#5c4300', edge: '#4f3a00', stripe: '#e8c42a', body2: '#b08e00' } as const;

function Swags({ art, glints }: { readonly art: SwagArt; readonly glints?: Glints }) {
  const raw = useId();
  const id = (s: string): string => `${raw}${s}`;
  const dims = { width: art.width, height: art.height, viewBox: `0 0 ${art.width} ${art.height}`, 'aria-hidden': true, focusable: false } as const;
  const tw = art.trimWidth, k = art.k;
  const T = `#${id('t')}`;
  return (
    <>
      <svg className="dw-curtain-swags-main" {...dims}>
        <defs>
          <linearGradient id={id('f')} x1="0" x2="1">
            <stop offset="0" style={{ stopColor: 'var(--dw-dark)' }} /><stop offset=".24" style={{ stopColor: 'var(--dw-mid)' }} /><stop offset=".5" style={{ stopColor: 'var(--dw-light)' }} />
            <stop offset=".75" style={{ stopColor: 'var(--dw-mid)' }} /><stop offset="1" style={{ stopColor: 'var(--dw-dark)' }} />
          </linearGradient>
          <linearGradient id={id('h')} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#000" stopOpacity=".35" /><stop offset=".5" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".28" /></linearGradient>
          <linearGradient id={id('rail')} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={GOLD.light} /><stop offset=".35" stopColor={GOLD.body} /><stop offset=".7" stopColor={GOLD.dark} /><stop offset="1" stopColor={GOLD.deep} /></linearGradient>
          <radialGradient id={id('b')} cx=".36" cy=".3" r=".78"><stop offset="0" stopColor="#fffbe2" /><stop offset=".22" stopColor="#f8de6a" /><stop offset=".6" stopColor="#c99a06" /><stop offset="1" stopColor="#5e4400" /></radialGradient>
          <pattern id={id('n')} patternUnits="userSpaceOnUse" width="96" height="192"><image href={NOISE_URI} width="96" height="192" /></pattern>
          <path id={id('t')} d={art.trim} />
          <g id={id('bd')}>{art.beads.map((b, i) => <circle key={i} cx={b.x} cy={b.y} r={b.r} />)}</g>
          <g id={id('sp')}>{art.specks.map((b, i) => <circle key={i} cx={b.x} cy={b.y} r={b.r} />)}</g>
        </defs>
        <path d={art.shape} fill={`url(#${id('f')})`} />
        <path d={art.shape} fill={`url(#${id('h')})`} />
        <path d={art.shape} fill={`url(#${id('n')})`} style={{ opacity: 'var(--dw-tex)' }} />
        <rect x="0" y="0" width={art.width} height={art.railHeight} fill={`url(#${id('rail')})`} />
        <use href={T} fill="none" stroke={GOLD.edge} strokeWidth={Math.round((tw + 1.6) * 100) / 100} />
        <use href={T} fill="none" stroke={GOLD.body2} strokeWidth={tw} />
        <use href={T} fill="none" stroke={GOLD.stripe} strokeWidth={tw} strokeDasharray={`${Math.round(2.6 * k * 100) / 100} ${Math.round(2.6 * k * 100) / 100}`} />
        <use href={T} fill="none" stroke="#fff4c4" strokeOpacity=".8" strokeWidth={Math.round(tw * 0.28 * 100) / 100} transform={`translate(0 ${Math.round(-tw * 0.26 * 100) / 100})`} />
        <use href={`#${id('bd')}`} fill={`url(#${id('b')})`} stroke={GOLD.edge} strokeWidth=".5" />
      </svg>
      {/* The glint: the trim's top line and each bead's speck, lit only where a spotlight is (two gradients that move with the spots), in plain alpha. */}
      <svg className="dw-curtain-swags-glint" {...dims}>
        <defs>
          {[0, 1].map((g) => (
            <radialGradient key={g} id={id(`g${g}`)} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" ref={(el) => { if (glints) glints.grads[g] = el; }}>
              <stop offset="0" stopColor="#fffdf0" /><stop offset=".35" stopColor="#fff3b8" stopOpacity=".75" /><stop offset="1" stopColor="#fff0a0" stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>
        {[0, 1].map((g) => (
          <g key={g} opacity="0" ref={(el) => { if (glints) glints.grps[g] = el; }}>
            <use href={T} fill="none" stroke={`url(#${id(`g${g}`)})`} strokeWidth={Math.round(tw * 0.7 * 100) / 100} transform={`translate(0 ${Math.round(-tw * 0.15 * 100) / 100})`} />
            <use href={`#${id('bd')}`} fill={`url(#${id(`g${g}`)})`} opacity=".55" />
            <use href={`#${id('sp')}`} fill={`url(#${id(`g${g}`)})`} />
          </g>
        ))}
      </svg>
    </>
  );
}

/** The halves and the swags: the fabric, drawn in the shades the box carries as custom properties. */
function Drawing({ width, glints }: { readonly width: number; readonly glints?: Glints }) {
  const n = TUNING.shape.pleatsPerHalf;
  const art = useMemo(() => (width > 0 ? swagArt(width, TUNING.shape.swags, TUNING.shape.swagHeightPx) : null), [width]);
  const pleats = (right: boolean) => Array.from({ length: n }, (_, i) => <i key={i} className="dw-curtain-pleat" style={right ? { zIndex: n - i } : undefined} />);
  return (
    <>
      <span className="dw-curtain-half dw-curtain-left" data-dw-half="">{pleats(false)}</span>
      <span className="dw-curtain-half dw-curtain-right" data-dw-half="">{pleats(true)}</span>
      <span className="dw-curtain-swags" data-dw-swags="">{art && <Swags art={art} {...(glints ? { glints } : {})} />}</span>
    </>
  );
}

const styleOf = (fabric: Fabric): CSSProperties => {
  const f = FABRICS[fabric];
  return {
    '--dw-dark': f.dark, '--dw-mid': f.mid, '--dw-light': f.light,
    '--dw-dur': `${TUNING.openMs}ms`, '--dw-ease': TUNING.openEase, '--dw-swag-h': `${TUNING.shape.swagHeightPx}px`, '--dw-tex': String(TUNING.shape.textureStrength),
    '--dw-half': `${TUNING.shape.halfWidthPercent}%`, '--dw-noise': `url("${NOISE_URI}")`,
  } as CSSProperties;
};

/* ---------- the curtain ---------- */

export function Curtain({ fabric, under, seed, n, total, onOpened }: CurtainProps) {
  const { settings } = useKayfa();
  const sound = useSound();
  const reduced = useFeel() === null;
  const line = settings.cardSettings['laughTrack.line'] ?? TUNING.touchLine;

  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  /* The latest of what a handler reads, so a handler made once is never stale. */
  const now = useRef({ sound, reduced, line, onOpened, seed, fabric });
  now.current = { sound, reduced, line, onOpened, seed, fabric };

  const [width, setWidth] = useState(0);
  const [opening, setOpening] = useState(false);
  const busy = useRef(false);
  const timers = useRef<number[]>([]);
  const glints = useRef<Glints>({ grads: [null, null], grps: [null, null] });
  const spotEls = useRef<(HTMLSpanElement | null)[]>([null, null]);
  const spots = useRef<Spots | null>(null);
  const loop = useRef<{ setGain(g: number): void; stop(fadeMs: number): void } | null>(null);
  const mouseHot = useRef(false);
  const lineHot = useRef(false);
  const hot = useRef(false);

  /* The width the swags are drawn for, and the spotlights' place, kept as the box changes. */
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = (): void => { setWidth(el.clientWidth); spots.current?.draw(); };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const made = makeSpots(el, [spotEls.current[0]!, spotEls.current[1]!], glints.current, () => now.current.reduced);
    spots.current = made;
    made.draw();
    return () => { made.dispose(); spots.current = null; };
  }, []);

  /** The drumroll plays while the curtain is hot, and stops (fading over `fadeMs`) when it is not. */
  const apply = useCallback((fadeMs: number = TUNING.drumFadeMs) => {
    const on = mouseHot.current || lineHot.current;
    if (on === hot.current) return;
    hot.current = on;
    spots.current?.setHot(on);
    if (on) {
      const h = now.current.sound.loop('its-curtains.drumroll', { group: GROUP, id: now.current.seed });
      h.setGain(1);
      loop.current = h;
    } else {
      loop.current?.stop(fadeMs);
      loop.current = null;
    }
  }, []);

  /* A mouse's record is the page's. */
  useEffect(() => { listen(); return unlisten; }, []);

  /* A touch screen: the drumroll plays while the curtain is on the reader's line. */
  useEffect(() => {
    const check = (): void => {
      const el = root.current;
      if (!el || busy.current) return;
      let on = false;
      if (lastPointer === null && coarse()) {
        const r = el.getBoundingClientRect();
        const y = readingLine(window.innerHeight, hudHeight(), now.current.line);
        on = r.top < y && r.bottom > y;
      }
      lineHot.current = on;
      apply();
    };
    check();
    window.addEventListener('scroll', check, { capture: true, passive: true });
    window.addEventListener('resize', check, { passive: true });
    return () => { window.removeEventListener('scroll', check, { capture: true }); window.removeEventListener('resize', check); };
  }, [apply]);

  /* Whatever is still going stops with the curtain: the drumroll, and the timers of an opening. */
  useEffect(() => () => {
    loop.current?.stop(TUNING.drumFadeMs);
    loop.current = null;
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }, []);

  /* A keyboard reader who opened the curtain above this one is given this one. */
  useEffect(() => {
    if (handedFocusAt !== 0 && Date.now() - handedFocusAt < HANDOFF_MS) button.current?.focus();
    handedFocusAt = 0;
  }, []);

  /* The halves leave: the lag keyframes on each pleat, on top of the half's own slide (the CSS under `data-dw-opening`). */
  useLayoutEffect(() => {
    if (!opening) return;
    const el = button.current;
    if (!el) return;
    const halves = Array.from(el.querySelectorAll<HTMLElement>('[data-dw-half]'));
    const H = el.clientHeight, halfW = halves[0]?.clientWidth ?? 0;
    el.style.setProperty('--dw-lagx', `${lagOvershoot(halfW, H, TUNING.shape.fabricLag)}px`);
    if (typeof el.animate !== 'function') return;
    halves.forEach((half, hi) => {
      const dir = hi === 0 ? -1 : 1;
      const strips = Array.from(half.children) as HTMLElement[];
      strips.forEach((p, di) => {
        const frames = fabricFrames(hi === 0 ? di : strips.length - 1 - di, strips.length, halfW, H, TUNING.openMs, TUNING.shape.fabricLag, dir, TUNING.openEase);
        if (frames.length > 0) p.animate(frames.map((f) => ({ offset: f.offset, transform: f.transform })), { duration: TUNING.openMs, easing: 'linear', fill: 'forwards' });
      });
    });
  }, [opening]);

  /* A press that ends a drag, a scroll or a selection is not an opening. */
  const down = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null);
  const onPointerDown = (e: ReactPointer<HTMLButtonElement>): void => { down.current = { x: e.clientX, y: e.clientY, sx: window.scrollX, sy: window.scrollY }; };
  const open = (): void => {
    if (busy.current) return;
    busy.current = true;
    const { sound: s, reduced: still, fabric: f, seed: id } = now.current;
    mouseHot.current = false; lineHot.current = false;
    apply(TUNING.drumFadeOnOpenMs);
    void s.play('its-curtains.crash', SOUND_OPTS);
    const finish = (): void => {
      if (button.current && document.activeElement === button.current) handedFocusAt = Date.now();
      now.current.onOpened();
    };
    if (still) {
      void s.play('its-curtains.whoosh', SOUND_OPTS);
      void s.play('its-curtains.tada', SOUND_OPTS);
      finish();
      return;
    }
    setOpening(true);
    const after = (ms: number, run: () => void): void => { timers.current.push(window.setTimeout(run, ms)); };
    after(TUNING.whooshAfterMs, () => { void now.current.sound.play('its-curtains.whoosh', SOUND_OPTS); });
    after(Math.max(0, TUNING.openMs - TUNING.tadaBeforeEndMs), () => { void now.current.sound.play('its-curtains.tada', SOUND_OPTS); });
    after(Math.round((TUNING.openMs * TUNING.confetti.startPercent) / 100), () => {
      const box = root.current;
      const r = box?.getBoundingClientRect();
      throwConfetti(box, confettiPieces(seedOf(id), { w: r?.width ?? 0, h: r?.height ?? 0 }, confettiColors(FABRICS[f].light)));
    });
    after(TUNING.openMs + TUNING.settleMs, finish);
  };
  const onClick = (e: ReactMouse<HTMLButtonElement>): void => {
    /* A keyboard's press (Enter, Space) has no pointer and no detail; it is the reader's, and a selection elsewhere does not stop it. */
    if (e.detail !== 0) {
      const sel = window.getSelection?.();
      if (sel && !sel.isCollapsed) { down.current = null; return; }
      const d = down.current;
      if (d) {
        const far = Math.hypot(e.clientX - d.x, e.clientY - d.y) > TUNING.dragSlopPx;
        if (far || window.scrollY !== d.sy || window.scrollX !== d.sx) { down.current = null; return; }
      }
    }
    down.current = null;
    open();
  };

  /* A mouse: a real move starts the drumroll, and leaving stops it. */
  const onPointerEnter = (e: ReactPointer<HTMLButtonElement>): void => { if (e.pointerType === 'mouse') moved(e); };
  const onPointerMove = (e: ReactPointer<HTMLButtonElement>): void => {
    if (e.pointerType !== 'mouse' || busy.current) return;
    if (moved(e)) { mouseHot.current = true; apply(); }
  };
  const onPointerLeave = (e: ReactPointer<HTMLButtonElement>): void => {
    if (e.pointerType !== 'mouse') return;
    mouseHot.current = false;
    apply();
  };

  const words = `Open the curtain${total > 1 ? `, ${n} of ${total}` : ''}`;
  return (
    <div className="dw-curtain" ref={root} data-dw-curtain="">
      {under && (
        <span className="dw-curtain-face dw-curtain-under" data-dw-under="" data-dw-fabric={under} aria-hidden="true" style={styleOf(under)}>
          <Drawing width={width} />
        </span>
      )}
      <button
        type="button" ref={button} className="dw-curtain-face dw-curtain-button" data-kb-over-ink="" data-dw-fabric={fabric} data-dw-opening={opening ? '' : undefined} style={styleOf(fabric)}
        onPointerDown={onPointerDown} onPointerEnter={onPointerEnter} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} onPointerCancel={onPointerLeave} onClick={onClick}
      >
        <span className="dw-curtain-art" aria-hidden="true"><Drawing width={width} glints={glints.current} /></span>
        <span className="dw-curtain-spot" aria-hidden="true" ref={(el) => { spotEls.current[0] = el; }} />
        <span className="dw-curtain-spot" aria-hidden="true" ref={(el) => { spotEls.current[1] = el; }} />
        <span className="dw-curtain-label">{words}</span>
      </button>
    </div>
  );
}

