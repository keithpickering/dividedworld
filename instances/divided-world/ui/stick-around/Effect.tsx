/**
 * Stick Around's effect on a post (screens design, section 10 as amended 2026-10-30; cards plan, Task 4): the post wears the
 * game's frame in its thread; when the reader stops scrolling with it mostly on screen it pulls them in and is lifted into
 * a full-screen glass view (HoldView.tsx) that they leave by filling the bar, or by certifying that they read it.
 *
 * Who is held is hold.ts's `isHeld`: never the post's author or the card's caster, and not a reader who certified (kept on
 * the server, so it holds on every device, `release`) or broke free this visit. Breaking free is kept here, in the page's
 * memory, and so lasts exactly as long as the visit: a reload, or coming back another day, holds them again until they
 * certify. Only this reader's own screen knows any of it.
 *
 * The post's words are this effect's `children`; it draws them where they stand, or, while the view is open, in the view,
 * leaving a space of the same height in the thread so the page does not jump when they leave.
 */
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { EffectProps } from '../../../../engine/ui/cards/types.ts';
import { HoldView } from './HoldView.tsx';
import { isHeld, releaseSide } from '../../cards/stick-around/hold.ts';
import { placeBeside, useTakeover } from './takeover.ts';
import './hold.css';

/* Breaking free, for this visit: the posts the reader got out of. A module's memory lasts until the page is reloaded. */
const escaped = new Set<string>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/**
 * How the hold is staged, for a story or a test that needs one state held still (a stage the page never sets): `live` is
 * the page itself; `thread` is the post in its thread, never taking the reader over; `view` is the full-screen view from
 * the start, its bar held at `level` (0 to 1) instead of draining, and its post scrolled to `scrolled` (0 to 1) of its way.
 */
export type HoldStageValue =
  | { readonly mode: 'live' }
  | { readonly mode: 'thread' }
  | { readonly mode: 'view'; readonly level: number; readonly scrolled?: number };
export const HoldStage = createContext<HoldStageValue>({ mode: 'live' });

export function StickAroundEffect({ post, plays, released, reader, release, children }: EffectProps) {
  const stage = useContext(HoldStage);
  const away = useSyncExternalStore(subscribe, () => escaped.has(post.id), () => false);
  /* The first play the reader has not certified: its caster's sentence is the one they are asked to check. */
  const play = plays.find((p) => !released.has(p.id));
  const held = play !== undefined && isHeld({ isAuthor: reader.author, isCaster: reader.caster, certified: false, brokeFree: away });
  const [lifted, setLifted] = useState(stage.mode === 'view');
  const body = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  /* Where the reader goes when they break free: the post they leave (kept, since its words are gone from under `body` by then) and the side. */
  const leaving = useRef<{ post: HTMLElement; side: 'after' | 'before' } | null>(null);

  const take = useCallback(() => {
    /* The space the post leaves in the thread, so the thread does not move when the post is lifted out of it. */
    setHeight(body.current?.getBoundingClientRect().height ?? 0);
    setLifted(true);
  }, []);
  useTakeover(post.id, () => body.current, () => escaped.has(post.id), held && !lifted && stage.mode === 'live', take);

  const breakFree = useCallback((pushed: number) => {
    const el = body.current;
    if (el) leaving.current = { post: el.closest<HTMLElement>('article') ?? el, side: releaseSide(pushed) };
    escaped.add(post.id);
    setLifted(false);
    for (const l of [...listeners]) l();
  }, [post.id]);
  /* Back in the thread, the reader is put just past the post, once the view has gone and the page can scroll again. */
  useLayoutEffect(() => {
    if (lifted || leaving.current === null) return;
    const { post: left, side } = leaving.current;
    leaving.current = null;
    placeBeside(left, side);
  }, [lifted]);
  /* Certified: the play drops out of the held set, and the view with it. */
  useLayoutEffect(() => { if (!held) setLifted(false); }, [held]);

  if (!held || !play) return <>{children}</>;
  return (
    <div ref={body} className="kb-hold" data-kb-hold={lifted ? 'lifted' : 'held'}>
      {lifted ? <div className="kb-hold-away" style={{ height }} aria-hidden="true" /> : children}
      {lifted && (
        <HoldView
          post={post} play={play} stage={stage} release={release} onBreakFree={breakFree}
        >
          {children}
        </HoldView>
      )}
    </div>
  );
}
