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
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useMotionReduced } from '../appearance.ts';
import { useModalLayer } from '../modal.tsx';
import type { TipStep } from './store.ts';
import './tips.css';

export interface SpotlightProps {
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

interface Frame { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly vw: number; readonly vh: number }

function measure(target: HTMLElement): Frame {
  const r = target.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  return { x: Math.max(0, r.left - PAD), y: Math.max(0, r.top - PAD), w: r.width + PAD * 2, h: r.height + PAD * 2, vw, vh };
}

export function Spotlight({ title, line, step, target, persona, onGotIt, onSkip }: SpotlightProps) {
  const heading = useId();
  const words = useId();
  const reduced = useMotionReduced();
  const { overlay, box, closeButton } = useModalLayer({ onClose: onSkip });
  const [frame, setFrame] = useState<Frame>(() => measure(target));

  /* Follow the target: on scroll anywhere (capture sees a scrolling box too), on resize, and when it changes size. */
  useLayoutEffect(() => {
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const follow = () => setFrame(measure(target));
    follow();
    window.addEventListener('scroll', follow, { capture: true, passive: true });
    window.addEventListener('resize', follow);
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(follow) : null;
    watch?.observe(target);
    return () => {
      window.removeEventListener('scroll', follow, { capture: true });
      window.removeEventListener('resize', follow);
      watch?.disconnect();
    };
  }, [target]);

  /* Faded in once, when the first step appears; a later step swaps in place. Under reduced motion it simply appears. */
  const first = useRef(true);
  useEffect(() => { first.current = false; }, []);

  const { x, y, w, h, vw, vh } = frame;
  const below = y + h / 2 < vh / 2;
  const width = Math.min(WIDE, vw - EDGE * 2);
  const centre = x + w / 2;
  const left = Math.min(Math.max(centre - width / 2, EDGE), Math.max(EDGE, vw - width - EDGE));
  const place: Record<string, string> = {
    '--kb-tip-left': `${left}px`,
    '--kb-tip-width': `${width}px`,
    '--kb-tip-arrow': `${Math.min(Math.max(centre - left, 28), width - 28)}px`,
    ...(below ? { '--kb-tip-top': `${y + h + GAP}px` } : { '--kb-tip-bottom': `${vh - y + GAP}px` }),
  };
  const label = step ? `${step.n} of ${step.of}` : null;

  return createPortal(
    <motion.div
      ref={overlay}
      className="kb-tips"
      data-kb-tips-place={below ? 'below' : 'above'}
      initial={reduced || !first.current ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="kb-tips-dim" aria-hidden="true" style={{ clipPath: `path(evenodd, 'M0 0H${vw}V${vh}H0Z M${x} ${y}H${x + w}V${y + h}H${x}Z')` }} />
      <div className="kb-tips-ring" aria-hidden="true" style={{ left: x, top: y, width: w, height: h }} />
      <div ref={box} className="kb-tips-panel kb-glass-cut-dialog" role="dialog" aria-modal="true" aria-labelledby={heading} aria-describedby={words} tabIndex={-1} style={place}>
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
          <button type="button" className="kb-tips-button kb-tips-go kb-glass-skew" onClick={onGotIt}><b className="kb-glass-upright">Got it</b></button>
        </div>
      </div>
      <div className="kb-tips-arrow" aria-hidden="true" style={{ left: centre, top: below ? y + h + 4 : y - 4 }} />
    </motion.div>,
    document.body,
  );
}
