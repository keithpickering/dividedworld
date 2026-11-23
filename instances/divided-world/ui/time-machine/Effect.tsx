/**
 * Time Machine's effect (docs/plans/2026-11-21-time-machine-design.md, section 4.6): the post is drawn as a tape of itself. The engine has already swapped
 * in the rewound words and hidden the plays the rewind hides (engine/ui/cards/Effects.tsx), so this wraps `children` and draws only the tape: scanlines
 * and a soft tracking line over the whole content area, a read-out ("◀◀ PLAY" and the point's date) at its top right, and, the first time a play is drawn on
 * a page, a 600 ms rewind of streaks running right to left.
 *
 * Where. One layer fills the post's content area border to border, placed the way Feelin' Fab's foil is (engine/ui/cards/body.ts: `bodyOf`, `bodyBox`,
 * `placeLayer`, marked `data-kb-effect-ink` so the thread's CSS lifts it over the words), in a thread and in a spun thread's ORIGIN box alike, and
 * clipped to it: nothing is drawn outside the area. Every part takes no pointer, so a link or a spoiler in the words stays pressable. A ResizeObserver
 * places the layer again when the area's size changes.
 *
 * The date is the play's `rewindAt` (its payload's `rewind_at`, a time), written in the reader's own time zone. The read-out is a picture of the
 * status and is hidden from assistive technology, which is given the label instead. Reduced motion draws no streak and holds the tracking line still
 * (the line is an ornament, so there is nothing to give back: the rewind hides nothing a reader needs to get through).
 *
 * A play's moment and a History version row draw the tape but never the streak: nothing in them arrives.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMotionReduced } from '../../../../engine/ui/appearance.ts';
import { bodyBox, bodyOf, placeLayer } from '../../../../engine/ui/cards/body.ts';
import { inPlayOrder, playOver, useAt } from '../../../../engine/ui/cards/plays.ts';
import type { EffectProps } from '../../../../engine/ui/cards/types.ts';
import { readOut } from './readout.ts';
import './time-machine.css';

/** How long the rewind's streaks run on a play's first draw, in ms. */
export const STREAK_MS = 600;
/** How many streaks it draws, each at its own height and length. */
const STREAKS = 7;
/** The plays whose first draw has had its rewind on this page load: once per play, whatever draws it again (a re-render, a post scrolled back). */
const rewound = new Set<string>();

/**
 * The engine hands every Time Machine play it holds, over or not, and each effect judges its own end: the engine's clock and its own rule (`playOver`: time up, an admin's end,
 * a play that did not take), re-judged when the next end comes. A moment judges by its own time. Of the plays still up the latest played is the one the post is rewound with
 * (`rewoundOf`), so it is the one drawn; none up draws only the words.
 */
export function TimeMachineEffect(props: EffectProps) {
  const ends = useMemo(() => props.plays.flatMap((p) => (p.ends !== undefined ? [Date.parse(p.ends)] : [])), [props.plays]);
  const clock = useAt(props.moment ? [] : ends);
  const now = props.moment ? props.moment.at : clock;
  const none = useMemo(() => new Set<string>(), []);
  const latest = props.plays.filter((p) => !playOver(p, now, none)).reduce<(typeof props.plays)[number] | undefined>((best, p) => (best === undefined || inPlayOrder(best, p) < 0 ? p : best), undefined);
  return latest ? <Taped key={latest.id} {...props} id={latest.id} at={latest.rewindAt}>{props.children}</Taped> : <>{props.children}</>;
}

function Taped({ id, at, met, moment, still, children }: EffectProps & { id: string; at: string | undefined }) {
  const host = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const reduced = useMotionReduced();
  const date = at === undefined ? '' : readOut(at);

  /* The streak: a play's first draw on this page, never in a moment or a History row. */
  const [fresh, setFresh] = useState(() => moment === null && !still && !rewound.has(id));
  useEffect(() => {
    if (!fresh) return;
    rewound.add(id);
    const t = setTimeout(() => setFresh(false), STREAK_MS);
    return () => clearTimeout(t);
  }, [fresh, id]);

  /* The reader has met the card when it is first drawn (a moment meets nothing). */
  const met1 = useRef(false);
  useEffect(() => {
    if (moment !== null || met1.current) return;
    met1.current = true;
    met();
  }, [met, moment]);

  /* The layer is the content area's box, placed again whenever the area's size changes. */
  useLayoutEffect(() => {
    const el = host.current!, lay = layer.current!;
    /* The area is found afresh each time (a takeover may move it), and watched while it is the one found. */
    let watched: HTMLElement | null = null;
    const size = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
    function fit(): void {
      const area = bodyOf(el);
      if (area !== watched) {
        if (watched) size?.unobserve(watched);
        if (area) size?.observe(area);
        watched = area;
      }
      const box = bodyBox(el, area);
      placeLayer(lay, box);
      /* The streaks travel the area's whole width (time-machine.css). */
      lay.style.setProperty('--dw-tm-w', `${box.w}px`);
    }
    size?.observe(el);
    fit();
    return () => size?.disconnect();
  }, []);

  return (
    <div ref={host} className="dw-tm">
      {children as ReactNode}
      {date !== '' && <span className="kb-visually-hidden">Showing this post as it was on {date}</span>}
      <div ref={layer} className="dw-tm-layer" data-kb-effect-ink="" aria-hidden="true">
        <div className="dw-tm-scan" />
        <div className="dw-tm-track" data-still={reduced ? '' : undefined} />
        {fresh && !reduced && (
          <div className="dw-tm-streaks">
            {Array.from({ length: STREAKS }, (_, i) => (
              <div key={i} className="dw-tm-streak" data-tm-streak="" style={{ top: `${6 + i * 13}%`, width: `${35 + ((i * 37) % 50)}%`, animationDelay: `${(i * 23) % 120}ms`, animationDuration: `${STREAK_MS - ((i * 23) % 120)}ms` }} />
            ))}
          </div>
        )}
        {date !== '' && <div className="dw-tm-readout" aria-hidden="true">◀◀ PLAY {date}</div>}
      </div>
    </div>
  );
}
