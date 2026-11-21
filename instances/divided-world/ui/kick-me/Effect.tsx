/**
 * Kick Me's effect (docs/plans/2026-11-20-refund-outcome-plan.md, task 8; the design's section 2.4): a cardboard sign taped across the top border
 * of the post's content area, half of it over the post's bar and half inside the box, tilted a few degrees and about a third of the way in from the
 * right. "KICK ME" is hand-lettered on it in strokes (no web font), and along its bottom edge there is one boot print for each card the sign will
 * hand back (`kickMe.refunds.count`), of which the first `handedOut` are scuffed out. Nothing moves, so reduced motion has nothing to take away.
 *
 * Where. It fills nothing, on purpose (CLAUDE.md, "An effect fills the post, border to border"): the joke is a sign someone slapped on the post's
 * back when it was not looking, and it reads as slapped on because it breaks the frame. It is drawn in a layer placed over the content area the way
 * Feelin' Fab's foil is (engine/ui/cards/body.ts: `bodyOf`, `bodyBox`, `placeLayer`, the bare `data-kb-effect-ink` mark the thread's CSS lifts above
 * the words): in a thread that is the post's body, and in a spun thread's ORIGIN box it is the box's area under its band, so the sign is taped across
 * that box's top border the same way. The sign's width is at most 40% of the area's and at most 160 px (the CSS and `signHeight` say the same), so it
 * fits a phone. While it is up the area's top padding grows by half the sign's height (the area's own padding and the inline growth, put back when the
 * sign goes), so no word sits under it; the sign's tilt reaches a few px past that, into the padding the area already has.
 *
 * The sign assumes it is the only effect writing the area's inline paddingTop while it is up: it puts back what the area had when it goes.
 *
 * Nothing in it is pressable and it covers nothing pressable: the layer takes no press (kick-me.css) and holds no control. The sign is a picture
 * with a label that says how many kicks are left; the prints are decoration inside it. The count of scuffed prints is public (what a cast's
 * flavor and caster already show), so the effect reads nothing about who is looking.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { bodyBox, bodyOf, placeLayer } from '../../../../engine/ui/cards/body.ts';
import { alignmentTag } from '../../../../engine/ui/cards/faces.ts';
import { useAt } from '../../../../engine/ui/cards/plays.ts';
import type { EffectProps } from '../../../../engine/ui/cards/types.ts';
import { kickMe } from '../../cards/kick-me.ts';
import './kick-me.css';

/** The sign's viewBox, 200 by 90: its height is 9 twentieths of its width. */
const W = 200;
const H = 90;
/** The widest the sign is drawn, in px, and the share of the area's width it may take at most (kick-me.css says the same). */
const MOST_PX = 160;
const MOST_SHARE = 0.4;

/** The sign's height for a content area `width` px wide: its width (at most 40% of the area's, at most 160 px) times the sign's 9 : 20, to the hundredth of a px. */
export function signHeight(width: number): number {
  const w = Math.min(MOST_PX, MOST_SHARE * Math.max(0, width));
  return Math.round(((w * H) / W) * 100) / 100;
}

/** Strokes for each letter of the sign, in a 30 by 38 cell, drawn with a round marker: K, I, C, M, E, as a hand would. */
const STROKES = {
  K: 'M2 0V38M24 0L4 20L25 38',
  I: 'M10 0V38M2 1H18M2 37H18',
  C: 'M26 6Q14 -3 5 8Q-2 20 5 31Q14 41 26 33',
  M: 'M2 38V0L15 23L28 0V38',
  E: 'M25 1H3V37H25M3 19H20',
} as const;
/**
 * "KICK ME" as [letter, x of its cell, tilt in degrees]: the letters are not quite level, as a marker's are not. Each cell is drawn at LETTER_SCALE
 * from (x, LETTER_Y), so the lettering stands inside the cardboard with room on every side and a clear space between KICK and ME (a unit test pins both).
 */
export const LETTERS = [['K', 24.4, -2], ['I', 47.4, 1], ['C', 66, -1], ['K', 89.4, 2], ['M', 129.4, -1], ['E', 153.6, 2]] as const;
export const LETTER_SCALE = 0.8;
export const LETTER_Y = 13;
/** The marker's width in the sign's own units (it is drawn at 7.5 before the scale, so 6 here). */
export const MARKER = 7.5 * LETTER_SCALE;
export { STROKES, W as SIGN_W, H as SIGN_H };

/** The x of print `i` of `n` along the sign's bottom edge, centered. */
const printX = (i: number, n: number) => ((i + 1) * W) / (n + 1);

function Sign({ left, count }: { left: number; count: number }) {
  const label = `Kick Me sign: ${left} of ${count} ${alignmentTag(kickMe.refunds!.flavors[0]!)} cards still go back to their casters`;
  return (
    <svg className="dw-kick-sign" role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} focusable="false">
      {/* The cardboard, a little out of square, with its corrugation showing faintly. */}
      <polygon points="3,5 197,2 199,85 1,88" fill="#c9a06b" stroke="#7d5a2f" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M8 14H192M7 22H193M7 30H193M7 38H193M7 46H193M7 54H193M7 62H193M7 70H193M7 78H193" stroke="#7d5a2f" strokeWidth="0.8" opacity="0.18" fill="none" />
      {/* The lettering. */}
      <g fill="none" stroke="#2a0f0a" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round">
        {LETTERS.map(([letter, x, tilt], i) => (
          <path key={i} d={STROKES[letter]} transform={`translate(${x} ${LETTER_Y}) scale(${LETTER_SCALE}) rotate(${tilt} 15 19)`} />
        ))}
      </g>
      {/* The boot prints along the bottom edge: a sole and a heel each, the first `handedOut` scuffed out. */}
      {Array.from({ length: count }, (_, i) => {
        const gone = i < count - left;
        return (
          <g key={i} data-kick-print="" {...(gone ? { 'data-scuffed': '' } : {})} transform={`translate(${printX(i, count)} 68) rotate(${i % 2 === 0 ? -12 : 10})`}>
            <g fill="#4a3217" opacity={gone ? 0.28 : 0.95}>
              <ellipse cx="0" cy="-3" rx="6" ry="8" />
              <ellipse cx="0" cy="9" rx="4" ry="3.5" />
            </g>
            {gone && <path d="M-9 -11L9 12M9 -11L-9 12" stroke="#7a2a1a" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />}
          </g>
        );
      })}
      {/* The tape across the border: a strip over each side edge, at the sign's middle, where the border runs. */}
      <rect x="-7" y="35" width="26" height="20" fill="#efe3b0" opacity="0.82" transform="rotate(-5 6 45)" />
      <rect x="181" y="35" width="26" height="20" fill="#efe3b0" opacity="0.82" transform="rotate(4 194 45)" />
    </svg>
  );
}

export function KickMeEffect(props: EffectProps) {
  const { plays, children } = props;
  const inMoment = props.moment !== null;
  const ends = useMemo(() => plays.flatMap((p) => (p.ends !== undefined ? [Date.parse(p.ends)] : [])), [plays]);
  const clock = useAt(inMoment ? [] : ends);
  const now = props.moment ? props.moment.at : clock;
  /* A moment draws every play it is handed, as they stood; a live post drops the plays whose end has passed (the engine goes on handing them over). */
  const live = useMemo(() => (inMoment ? plays : plays.filter((p) => p.ends === undefined || Date.parse(p.ends) > now)), [plays, inMoment, now]);
  /* One sign a post; if there are more, the latest is the one that pays and hands cards back. */
  const latest = live.at(-1);
  return latest ? <Taped {...props} handedOut={latest.handedOut ?? 0}>{children}</Taped> : <>{children}</>;
}

function Taped({ handedOut, met, moment, children }: EffectProps & { handedOut: number }) {
  const host = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const count = kickMe.refunds!.count;
  const left = Math.max(0, count - handedOut);
  /* The reader has met the card when the sign is first taped up (a moment meets nothing). */
  const met1 = useRef(false);
  useEffect(() => {
    if (moment !== null || met1.current) return;
    met1.current = true;
    met();
  }, [met, moment]);

  /* The area the sign is taped to, its padding made room, and the layer placed over it; again whenever the area's size changes. */
  useLayoutEffect(() => {
    const el = host.current!, lay = layer.current!;
    let area: HTMLElement = bodyOf(el) ?? el;
    /* Each area's own inline paddingTop, taken the first time the sign meets it (never again: it would then be the sign's own growth), and put back when the sign leaves it. */
    const own = new Map<HTMLElement, string>();
    const meet = (a: HTMLElement): void => { if (!own.has(a)) own.set(a, a.style.paddingTop); };
    meet(area);
    const fit = (): void => {
      const next = bodyOf(el) ?? el;
      if (next !== area) { area.style.paddingTop = own.get(area) ?? ''; area = next; meet(area); }
      /* Put the area's own padding back first (an inline one it had, else the sheet's), so what is read is that and not the sign's growth, which a narrower screen would otherwise stack. */
      area.style.paddingTop = own.get(area) ?? '';
      const base = Number.parseFloat(getComputedStyle(area).paddingTop) || 0;
      area.style.paddingTop = `${Math.round((base + signHeight(area.clientWidth) / 2) * 100) / 100}px`;
      placeLayer(lay, bodyBox(el, area === el ? null : area));
    };
    fit();
    const size = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    size?.observe(area);
    if (area !== el) size?.observe(el);
    return () => { size?.disconnect(); for (const [a, was] of own) a.style.paddingTop = was; };
  }, []);

  return (
    <div ref={host} className="dw-kick">
      {children as ReactNode}
      <div ref={layer} className="dw-kick-layer" data-kb-effect-ink="">
        <Sign left={left} count={count} />
      </div>
    </div>
  );
}
