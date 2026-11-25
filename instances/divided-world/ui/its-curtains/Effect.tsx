/**
 * It's Curtains' effect on a post (docs/plans/2026-11-23-its-curtains-design.md, sections 2.2 to 2.4 and 2.10; the plan's Task 6). The curtain hangs over the post, author
 * and all, and each reader opens it for themselves with a press: the open state is the reader's, in the page's memory, and nothing is saved, sent or counted.
 *
 * It works in one of two places, as Below the Fold does. Where a post has a row (a thread's post) the card sets `coversRow`, the engine draws the card's `Cover` over the
 * whole row (Cover.tsx) and gives this effect `cover`; the effect then draws `children` alone and only tells the Lens the cover's state, with the cover's own presses as its
 * controls. Where there is no row (the ORIGIN box, the front door, a moment, History) there is no `cover`, and the effect covers the content area it stands in, border to
 * border, itself: it keeps its own count of the curtains the reader has opened, draws the outermost one still shut over the area (the ORIGIN box's area under its band
 * included), makes the words under it `inert`, and says they are covered (`CoveredCtx`) so that an effect that starts on sight waits until the curtain opens.
 *
 * The Lens says the reader's state (`show`) and how it ends: the press on the curtain, or on the Lens's Open the curtain. Once all are open its control is Encore, which
 * shuts them again so the reader can replay the show. A moment draws it as a thread's post does without a row: the curtain is the reader's own and opens nothing for anyone.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { bodyBox, bodyOf, sameBox, type BodyBox } from '../../../../engine/ui/cards/body.ts';
import type { CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { CoveredCtx } from '../../../../engine/ui/thread/cover.tsx';
import { Curtain } from './Curtain.tsx';
import { fabricOf } from './fabric.ts';

/** The Lens's way out of a curtain that is shut. */
export const LENS_ENDS = 'Ends when you press the curtain.';

/** The Lens's state, a status of at most six words: which of a stack is shut, or that it is open. */
export const stateOf = (shut: number, total: number): string => (shut === 0 ? 'Open for you' : total === 1 ? 'Shut for you' : `${shut} of ${total} shut for you`);

export function ItsCurtainsEffect({ plays, cover, show, met, moment, children }: EffectProps) {
  /* Latest (outermost) first. */
  const ordered = useMemo(() => [...plays].sort((a, b) => b.layer - a.layer), [plays]);
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const stillShut = ordered.filter((p) => !opened.has(p.id));
  const next = stillShut[0];
  const ownOpen = useCallback(() => { if (next) setOpened((was) => new Set(was).add(next.id)); }, [next?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const ownEncore = useCallback(() => setOpened(new Set()), []);
  const total = cover ? cover.total : ordered.length;
  const shut = cover ? cover.shut : stillShut.length;
  const open = cover ? cover.open : ownOpen;
  const encore = cover ? cover.encore : ownEncore;

  /* The Lens's tab: the reader's state, its one control (the press on the curtain, or Encore), and the way out while shut. */
  useEffect(() => {
    const view: CardView = {
      progress: null,
      state: stateOf(shut, total),
      ...(shut > 0 ? { ends: LENS_ENDS } : {}),
      yours: shut > 0,
      controls: [shut > 0 ? { kind: 'press', label: 'Open the curtain', run: open } : { kind: 'press', label: 'Encore', run: encore }],
      notes: {},
    };
    show(view);
  }, [show, shut, total, open, encore]);
  useEffect(() => () => show(null), [show]);

  /* The reader has met the card when it is first drawn (a moment meets nothing). */
  const met1 = useRef(false);
  useEffect(() => {
    if (moment !== null || met1.current) return;
    met1.current = true;
    met();
  }, [met, moment]);

  /* Where the engine has a row it draws the cover over it; this draws the words alone. */
  const host = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<BodyBox | null>(null);
  useLayoutEffect(() => {
    if (cover) return;
    const h = host.current;
    if (!h) return;
    const body = bodyOf(h);
    const measure = (): void => setBox((was) => { const b = bodyBox(h, body); return was && sameBox(was, b) ? was : b; });
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(measure);
    ro.observe(h);
    if (body) ro.observe(body);
    return () => ro.disconnect();
  }, [cover]);

  if (cover) return <>{children}</>;

  const second = stillShut[1];
  return (
    <CoveredCtx.Provider value={shut > 0}>
      <div className="dw-curtain-host" ref={host}>
        <div data-dw-words="" inert={shut > 0}>{children}</div>
        {next && box && (
          <div className="dw-curtain-overlay" style={{ left: box.left, top: box.top, width: box.w, height: box.h }}>
            <Curtain
              key={next.id} fabric={fabricOf(next)} under={second ? fabricOf(second) : undefined} seed={next.id}
              n={total - shut + 1} total={total} onOpened={ownOpen}
            />
          </div>
        )}
      </div>
    </CoveredCtx.Provider>
  );
}
