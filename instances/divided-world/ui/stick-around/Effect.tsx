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
 * The post's words are this effect's `children`, and nothing in them is ever drawn twice or drawn again: they are drawn once,
 * by a portal into an element this effect makes and keeps (`words`), and a layout effect moves that element between its place
 * in the thread and its place in the current view (`appendChild`): each stacked play has a view of its own, one after another. React never unmounts what is inside, so a lift and a release keep every
 * inner effect's state, a reader's unsaved scrubbing in Whoops! included (marks-and-the-lens design, section 4). The thread keeps a
 * space of the same height while the words are in the view, so the page does not jump when they leave.
 *
 * This is a takeover (`CardUi.takeover`): it wraps outermost, so every other card's effect is inside `children`, and it is given the
 * post's `marks`, which the view draws over the lifted post. Its own tab in the Lens says how it holds and how it ends (`show`); it
 * has no controls, since its ways out are the view's bar, Break free and the caster's checkbox, where they are.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { EffectProps } from '../../../../engine/ui/cards/types.ts';
import { useLensStore } from '../../../../engine/ui/cards/Lens.tsx';
import { HoldView } from './HoldView.tsx';
import { isHeld, releaseSide } from '../../cards/stick-around/hold.ts';
import { placeBeside, swallowEscAfterRelease, useTakeover } from './takeover.ts';
import './hold.css';
import { Layers } from '../../../../engine/ui/glass/layer.tsx';

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

/** What the card is doing to this reader on this post, as the Lens's short status (never a sentence, never how it ends). */
function stateOf({ author, caster, over, away }: { author: boolean; caster: boolean; over: boolean; away: boolean }): string {
  if (author) return 'Not holding you · you wrote it';
  if (caster) return 'Not holding you · you played it';
  if (over) return 'Done holding you';
  if (away) return 'Broke free this visit';
  return 'Holding you on this post';
}

/** The Lens's way out of the hold (HoldView's `WAYS_OUT` is the view's own, in the same ways: change one, change both), said only while it holds the reader (a reader it does not hold has nothing to get out of). */
export const LENS_ENDS = 'Ends when you check the caster\'s sentence, scroll past either end of the post, or press Break free.';

export function StickAroundEffect({ post, plays, released, reader, release, show, holdScreen, marks, children }: EffectProps) {
  const stage = useContext(HoldStage);
  const away = useSyncExternalStore(subscribe, () => escaped.has(post.id), () => false);
  /* The first play the reader has not certified: its caster's sentence is the one they are asked to check. */
  const play = plays.find((p) => !released.has(p.id));
  const held = play !== undefined && isHeld({ isAuthor: reader.author, isCaster: reader.caster, certified: false, brokeFree: away });
  const [lifted, setLifted] = useState(stage.mode === 'view');
  const body = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const lens = useLensStore();
  /* Where the reader goes when they break free: the post they leave (kept, since its words are gone from under `body` by then) and the side. */
  const leaving = useRef<{ post: HTMLElement; side: 'after' | 'before' } | null>(null);

  /* What the Lens says of the hold: no edge, no controls, its way out in a sentence. */
  const state = stateOf({ author: reader.author, caster: reader.caster, over: play === undefined, away });
  useEffect(() => {
    show({ progress: null, state, ...(held ? { ends: LENS_ENDS } : null), yours: false, controls: [], notes: {} });
  }, [show, state, held]);

  /*
   * The words' own element, made once and kept; the thread's place for it and the view's. Drawn once through the portal whatever
   * the state, so the children are one mount for the life of this effect.
   */
  const [words] = useState(() => { const el = document.createElement('div'); el.className = 'kb-hold-words'; return el; });
  const home = useRef<HTMLDivElement>(null);
  /*
   * The view's place for the words, as the element itself and not a ref to read: each play's view is its own (HoldView is keyed by
   * the play), so when one play is released and the next takes its place the view's element is a new one while there is a view
   * before and after. The words follow the element, whatever made the view anew (#325), and go home when there is none.
   */
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const inView = lifted && held && !!play;
  /* While the view holds the reader, no tip is shown over it (the page's pacing, engine/ui/tips/store.ts). */
  useEffect(() => { holdScreen(inView); }, [holdScreen, inView]);
  useLayoutEffect(() => {
    const into = inView ? slot : home.current;
    if (into && words.parentElement !== into) into.appendChild(words);
  }, [inView, slot, words]);

  const take = useCallback(() => {
    /* The space the post leaves in the thread, so the thread does not move when the post is lifted out of it. */
    setHeight(body.current?.getBoundingClientRect().height ?? 0);
    /* A Lens opened from the thread's marks is left behind under the view: the view has its own marks to open it from. */
    lens.close();
    setLifted(true);
  }, [lens]);
  useTakeover(post.id, () => body.current, () => escaped.has(post.id), held && !lifted && stage.mode === 'live', take);

  const breakFree = useCallback((pushed: number) => {
    const el = body.current;
    if (el) leaving.current = { post: el.closest<HTMLElement>('article') ?? el, side: releaseSide(pushed) };
    escaped.add(post.id);
    swallowEscAfterRelease();
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

  return (
    <div ref={body} className={held ? 'kb-hold' : 'kb-hold-off'} data-kb-hold={held ? (lifted ? 'lifted' : 'held') : undefined}>
      {createPortal(children, words)}
      <div ref={home} className="kb-hold-home" />
      {held && lifted && <div className="kb-hold-away" style={{ height }} aria-hidden="true" />}
      <Layers>
      {held && lifted && play && (
        <HoldView
          key={play.id} post={post} play={play} stage={stage} release={release} onBreakFree={breakFree} marks={marks} words={setSlot}
        />
      )}
      </Layers>
    </div>
  );
}
