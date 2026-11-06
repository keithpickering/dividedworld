/**
 * The spotlight (docs/plans/2026-11-02-onboarding-design.md, section 10; boards docs/research/2026-11-02-onboarding/03-spotlight.html and
 * 04-phone.html): a fixed layer over the whole page, the board and the HUD, dimmed and blurred, with an even-odd cut-out round the tip's
 * target that stays sharp, and a ring round it. Gabe's panel is a dialog named by its title: focus starts on Got it, Tab stays inside, and
 * Escape is Skip all tips (the board's modal layer, modal.tsx, holds all three and makes the page behind inert and returns focus to
 * where it was). The cut-out follows its target on scroll, resize and when the target itself resizes.
 *
 * It fades in; under reduced motion it appears, and a cut-out that moves between steps jumps (nothing here eases the cut-out at all).
 * At the glass's phone width the panel docks as a sheet above the HUD; wider, it sits beside the cut-out with a pointer. This is the
 * instance persona's voice and says only what is true, which is the instance's to keep (`InstanceUi.onboarding`).
 */
import { Fragment, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useMotionReduced } from '../appearance.ts';
import { useModalLayer } from '../modal.tsx';
import type { TipStep } from './store.ts';
import './tips.css';

export interface SpotlightProps {
  /** The tip's key: a new one replaces the words in place, so they are read afresh. */
  readonly tipKey: string;
  readonly title: string;
  readonly line: string;
  readonly step?: TipStep | undefined;
  readonly target: HTMLElement;
  readonly persona: { readonly name: string; readonly picture: string | undefined };
  readonly onGotIt: () => void;
  readonly onSkip: () => void;
}

/** The air round the target inside the ring, in px. */
const PAD = 6;
/** The gap between the ring and the panel, in px. */
const GAP = 26;
/** The panel's width on a wide screen, in px (it is narrower where the window is). */
const WIDE = 580;
const EDGE = 8;
/** The panel's border, in px: the arrow starts this far inside the panel's edge. It is `--kb-border` of the glass's cut dialog (glass/base.css, 1.5px) and is written twice, here and there; e2e/onboarding-polish.spec.ts reads the gap, so a change in one goes red. */
const BORDER = 1.5;

interface Frame { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly vw: number; readonly vh: number }

/**
 * The box a target occupies. A target with no box of its own (`display: contents`, which the phone's HUD gives the character plate so its parts
 * lay out in the bar's grid) is the union of its descendants' boxes: measured as it is it is a zero box at the window's corner, and the ring
 * and the cut-out are drawn there, a stray square, instead of round the plate.
 */
function boxOf(target: HTMLElement): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } {
  const own = target.getBoundingClientRect();
  if (own.width > 0 || own.height > 0) return own;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of target.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    /* A hidden copy (the HUD's measuring probes) takes a box but is not part of what the player sees. */
    if (getComputedStyle(el).visibility === 'hidden') continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  return right >= left ? { left, top, width: right - left, height: bottom - top } : own;
}

/** The cut-out in whole pixels, clipped to the screen: each edge is clamped, and the size is what is left between them. */
function measure(target: HTMLElement): Frame {
  const r = boxOf(target);
  const vw = Math.round(document.documentElement.clientWidth || window.innerWidth);
  const vh = Math.round(window.innerHeight);
  const x0 = Math.round(Math.max(0, r.left - PAD));
  const y0 = Math.round(Math.max(0, r.top - PAD));
  const x1 = Math.round(Math.min(vw, r.left + r.width + PAD));
  const y1 = Math.round(Math.min(vh, r.top + r.height + PAD));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0), vw, vh };
}

const sameFrame = (a: Frame, b: Frame) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.vw === b.vw && a.vh === b.vh;

export function Spotlight({ tipKey, title, line, step, target, persona, onGotIt, onSkip }: SpotlightProps) {
  const heading = useId();
  const words = useId();
  const reduced = useMotionReduced();
  const { overlay, box, closeButton } = useModalLayer({ onClose: onSkip });
  const gotIt = useRef<HTMLButtonElement>(null);
  const [frame, setFrame] = useState<Frame>(() => measure(target));
  const [panelHeight, setPanelHeight] = useState(0);

  /* Follow the target: on scroll anywhere (capture sees a scrolling box too), on resize, and when it changes size. One read a frame,
     and no render when the whole-pixel rectangle is the same. */
  useLayoutEffect(() => {
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const apply = () => { const next = measure(target); setFrame((was) => (sameFrame(was, next) ? was : next)); };
    apply();
    let queued = 0;
    const follow = () => {
      if (queued) return;
      queued = requestAnimationFrame(() => { queued = 0; apply(); });
    };
    window.addEventListener('scroll', follow, { capture: true, passive: true });
    window.addEventListener('resize', follow);
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(follow) : null;
    watch?.observe(target);
    return () => {
      if (queued) cancelAnimationFrame(queued);
      window.removeEventListener('scroll', follow, { capture: true });
      window.removeEventListener('resize', follow);
      watch?.disconnect();
    };
  }, [target]);

  /* The panel's own height, which the words change from step to step: where it fits depends on it. */
  useLayoutEffect(() => {
    const h = Math.round(box.current?.getBoundingClientRect().height ?? 0);
    setPanelHeight((was) => (was === h ? was : h));
  });

  /* A step swap replaces the words and the buttons (keyed below) so a screen reader reads them afresh; focus goes to the new Got it. */
  useLayoutEffect(() => { gotIt.current?.focus(); }, [tipKey]);

  const { x, y, w, h, vw, vh } = frame;
  const width = Math.min(WIDE, vw - EDGE * 2);
  const centre = x + w / 2;
  const left = Math.min(Math.max(centre - width / 2, EDGE), Math.max(EDGE, vw - width - EDGE));
  /* The side with room: the one the panel fits on (the lower half's target prefers above, the upper half's below), else the roomier. */
  const roomBelow = vh - (y + h + GAP) - EDGE;
  const roomAbove = y - GAP - EDGE;
  const preferBelow = y + h / 2 < vh / 2;
  const below = roomBelow >= panelHeight && roomAbove >= panelHeight ? preferBelow : roomBelow >= panelHeight ? true : roomAbove >= panelHeight ? false : roomBelow >= roomAbove;
  const wanted = below ? y + h + GAP : y - GAP - panelHeight;
  const top = Math.min(Math.max(wanted, EDGE), Math.max(EDGE, vh - panelHeight - EDGE));
  const place: Record<string, string> = {
    '--kb-tip-left': `${left}px`,
    '--kb-tip-width': `${width}px`,
    '--kb-tip-arrow': `${Math.min(Math.max(centre - left, 28), width - 28)}px`,
    '--kb-tip-top': `${top}px`,
  };
  const label = step ? `${step.n} of ${step.of}` : null;

  return createPortal(
    <motion.div
      ref={overlay}
      className="kb-tips"
      data-kb-tips-place={below ? 'below' : 'above'}
      /* The fade as chosen, kept for e2e, where the inline opacity is gone once Motion finishes. The unit tests read the motion itself, from the props below (tour.test.tsx mocks motion.div), not this marker. */
      data-kb-fade={reduced ? 'none' : 'in'}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="kb-tips-dim" aria-hidden="true" style={{ clipPath: `path(evenodd, 'M0 0H${vw}V${vh}H0Z M${x} ${y}H${x + w}V${y + h}H${x}Z')` }} />
      <div className="kb-tips-ring" aria-hidden="true" style={{ left: x, top: y, width: w, height: h }} />
      <div ref={box} className="kb-tips-panel kb-glass-cut-dialog" role="dialog" aria-modal="true" aria-labelledby={heading} aria-describedby={words} tabIndex={-1} style={place}>
        <Fragment key={tipKey}>
          <div className="kb-tips-who">
            <span className="kb-tips-ava" aria-hidden="true">
              {persona.picture !== undefined ? <img src={persona.picture} alt="" /> : <span className="kb-tips-ava-none">{persona.name.slice(0, 1)}</span>}
            </span>
            <div>
              <h2 id={heading} className="kb-tips-title kb-glass-display">{title}</h2>
              <span className="kb-tips-kicker">{persona.name}</span>
            </div>
          </div>
          <p id={words} className="kb-tips-line">{line}</p>
          <div className="kb-tips-acts">
            {step && (
              <span className="kb-tips-step">
                <span>{label}</span>
                <span className="kb-tips-pips" aria-hidden="true">{Array.from({ length: step.of }, (_, i) => <i key={i} data-on={i < step.n || undefined} />)}</span>
              </span>
            )}
            {/* The close button's place is Skip all tips: the layer starts focus on the first control that is not it, which is Got it. */}
            <button ref={closeButton} type="button" className="kb-tips-button kb-glass-skew" onClick={onSkip}><b className="kb-glass-upright">Skip all tips</b></button>
            <button ref={gotIt} type="button" className="kb-tips-button kb-tips-go kb-glass-skew" onClick={onGotIt}><b className="kb-glass-upright">Got it</b></button>
          </div>
        </Fragment>
      </div>
      {/* The tip's foot is at `top + panelHeight` (above its target) or its head at `top` (below it); the arrow starts one border inside that edge. */}
      <div className="kb-tips-arrow" aria-hidden="true" style={{ left: centre, top: below ? top + BORDER : top + panelHeight - BORDER }} />
    </motion.div>,
    document.body,
  );
}
