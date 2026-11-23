/**
 * A play's moment on the post (docs/plans/2026-11-03-effect-history-design.md, section 4, as docs/plans/2026-11-16-playable-moments-design.md replaces its still mode): the post as it
 * read when the play landed, with every play on it then as each stood, drawn in place of the post's live body when a reader presses As it landed in the play's Lens row, and in the
 * ORIGIN box of a thread spun from the play. **A moment is playable** (design, sections 1 to 4): each effect drawn in it starts from the state it had then (`PlayMoment`'s saved
 * states, the post's version then, the plays then) and runs as it runs on a live post, taking input, moving and sounding, at the moment's own time, which does not advance
 * (`EffectProps.moment`). Nothing a reader does in it is saved or sent, and it is as it landed again on Reset (the frame remounts each effect from the moment's states, so chairs fly
 * again, a tail types in again and ink is back), on Back to now, and on a reload. The moment itself is read once for the page (`useMomentRead`, kept by the Lens store) and never changes;
 * what a reader does inside it is their own screen's, nothing is broadcast, and the log is unchanged.
 *
 * Shown over a live post (As it landed, with Reset and Back to now) it is glass laid on a board post, in plain words and never in character: a chamfered ring in the play's ink
 * (`inkOf`), or its card's alignment's color, with its glow, which is also a mask: what the moment draws is cut to it, chamfers and all (the owner, 2026-11-21); a tag at the
 * ring's top ("As it landed · Reset · Back to now", in sentence case, the time being the Lens's); and, as a strip first in the post's foot, under the content area and out of
 * it, what no mark says (design, section 7): what became of the play, the plays on the post then, and that nothing done here is saved (the owner, 2026-11-21: it "interferes
 * with the post content area" drawn inside it). A drawn card has no line: its mark names it, its
 * Lens says its state then and its way out (each effect's `show` reaches the strip of the post the moment is drawn on, `onView`), and its effect speaks as it does on a live post.
 * Where the moment is the content (a play-spun ORIGIN box, with no Back to now) the box's own border and head already frame it and say "as it landed" with its own Reset, so it
 * draws no ring and no tag, and what it says is the board's own small print in the box's foot, under the content area and outside it, so no effect that fills the area passes
 * under it (the owner, 2026-11-07: the ring, the tag and the box were "lots of different borders" saying one thing). In the thread the ring is the post body's own edge
 * (`.kb-act-main`, bar to bar), since a card's effect paints the whole body and the moment shows it as it landed (the owner, 2026-11-06: the frame "should extend all the way to
 * the edges accordingly, so it can show the effect accurately"); it is laid over the body and clips nothing. Elsewhere (the ORIGIN box) the ring is the moment's own box. The post's
 * own words are not restyled.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useKayfa } from '../context.tsx';
import type { Act, Id, PlayMoment } from '../data/api.ts';
import { when } from '../thread/lines.tsx';
import { bodyBox, bodyOf, placeLayer, sameBox, type BodyBox } from './body.ts';
import { MomentEffects, inkOf, momentParts, useOnInk } from './Effects.tsx';
import { useLensStore, type LensStore } from './Lens.tsx';
import type { CardPlay, CardView, EffectPlace } from './types.ts';
import './moment.css';

/** A moment as it is being read: loading, failed (with a way to ask again), or read. */
export type MomentRead =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly retry: () => void }
  | { readonly status: 'read'; readonly moment: PlayMoment | null };

/**
 * A moment, read once for the page (the Lens store keeps it under `key`: a play's id for a play's moment, a spin's for a spin's) by `load`,
 * and not again however often it is shown.
 */
export function useMomentRead(key: Id, load: () => Promise<PlayMoment | null>): MomentRead {
  const store = useLensStore();
  const kept = useSyncExternalStore(store.subscribe, () => store.kept(key));
  const [failed, setFailed] = useState(0);
  const [asked, setAsked] = useState(0);
  /* The reader is the caller's closure, new each render; the read is of `key`, so it is asked for the key and not for each new closure. */
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    if (kept !== undefined) return;
    let gone = false;
    store.readMoment(key, () => loader.current()).catch(() => { if (!gone) setFailed((n) => n + 1); });
    return () => { gone = true; };
  }, [store, key, kept, asked]);
  const retry = useCallback(() => setAsked((n) => n + 1), []);
  if (kept !== undefined) return { status: 'read', moment: kept };
  return failed > asked ? { status: 'failed', retry } : { status: 'loading' };
}

/**
 * The frame a moment is drawn in. `back` is Back to now's press (none in an ORIGIN box, whose moment is its content, and then the frame
 * is the box's: no ring, no tag); `own` (what became of the play itself) and `named` are what the frame says under the post;
 * `unrecorded` says what else was on the post then wasn't recorded.
 */
export function MomentFrame({ play, at, read, back, backLabel = 'Back to now', bare = false, reset, run = 0, label = 'As it landed', own = null, named, unrecorded, listInto, frame, children }: {
  /** `none`: the read answered that the play is no play on a post, which a play on a post never is. */
  readonly play: CardPlay; readonly read: MomentRead['status'] | 'none';
  readonly back?: (() => void) | undefined;
  /** What the press that goes back says ("Back to now" for a moment; the present's frame goes back to the rewind). */
  readonly backLabel?: string;
  /** The frame is no moment: it draws no list ("Nothing you do to this post is saved" is a moment's, and the present is the post itself). */
  readonly bare?: boolean;
  /** Reset's press (design section 4): over a post (`back` given) the tag reads "As it landed · Reset · Back to now". In an ORIGIN box the head draws its own Reset, and the frame only says the status. */
  readonly reset?: (() => void) | undefined;
  /** How many times the moment has been reset: above 0, the frame says "As it landed again." out loud, to a screen reader only. */
  readonly run?: number;
  /** What the frame calls the moment: "As it landed" for a play's, "As it was spun" for a spin's. */
  readonly label?: string;
  /** The moment's time; none while it is not known (a spin's moment before it is read), and then the frame names none. */
  readonly at?: string | undefined;
  readonly own?: string | null; readonly named: readonly string[]; readonly unrecorded: boolean;
  /** Where the list stands: an element (an ORIGIN box's foot) it is portaled into, null while that element is not there yet (nothing is drawn, so nothing arrives late in the box's content area), and left out for the frame's own foot over a post. */
  readonly listInto?: HTMLElement | null | undefined;
  /** The frame's element, for a control inside it to give focus to (Try again's answer). */
  readonly frame?: RefObject<HTMLDivElement | null>;
  readonly children: ReactNode;
}) {
  const { instance, ui } = useKayfa();
  /* A card back is drawn in no card's ink: which card it is stays the setter's. */
  const rules = play.faceDown ? undefined : instance.cards.find((c) => c.key === play.card);
  const onInk = useOnInk();
  const ink = play.faceDown ? undefined : inkOf(ui, play, [play], onInk);
  const ring = useRing();
  /* The moment is the content (a play-spun ORIGIN box): the box frames it, so there is no ring or tag, and a read not yet done is said above the words (and Try again). Over a post, As it landed opens once the moment is read (glass/prepared.ts), so the tag never says it is loading. */
  const content = back === undefined;
  const status = read === 'read' ? null : read === 'loading' ? 'Loading the moment…' : read === 'failed' ? 'The moment did not load.' : 'This play has no moment to show.';
  const said = content && status !== null;
  /* The list is said only of a moment that is read and shown: it ends with the line that nothing done to this post is saved (the Game sounds toggle in the Lens is the reader's own preference, and is). */
  /* Where it stands: the caller's element (an ORIGIN box's foot), else in the thread the post's own foot (`ring.foot`), else the frame's own foot (Stick Around's view, which lifts the words out of every post). */
  /* A strip portaled out of the frame takes the frame's ink with it, its alignment's color where the play has none (as `.kb-moment` falls back in moment.css). */
  const stripInk = ink ?? (rules?.alignment === 'salty' ? 'var(--kb-glass-salty)' : 'var(--kb-glass-sweet)');
  const into = listInto !== undefined ? listInto : !content && ring.foot !== null ? ring.foot : undefined;
  const list = read === 'read' && !bare ? (
    <div className="kb-moment-list" data-kb-strip={into !== undefined ? '' : undefined} style={{ '--kb-moment-ink': stripInk } as CSSProperties}>
      {own !== null && <p className="kb-moment-own">{own}.</p>}
      {named.length > 0 && <p>Also on the post then: {named.join(', ')}</p>}
      {unrecorded && <p>What else was on the post then wasn't recorded.</p>}
      <p>Nothing you do to this post is saved.</p>
    </div>
  ) : null;
  return (
    <div ref={(el) => { ring.host.current = el; if (frame) frame.current = el; }} tabIndex={-1} className="kb-moment" role="group" aria-label={at === undefined ? label : `${label}, ${when(at)}`} data-kb-alignment={rules?.alignment} data-kb-content={content ? '' : undefined} style={ink ? ({ '--kb-moment-ink': ink } as CSSProperties) : undefined}>
      {said && <p className="kb-moment-status kb-small kb-muted">{status}</p>}
      {/* Said on each run above 0: the text alternates by a no-break space so a second Reset is a change a screen reader says again. */}
      <p role="status" className="kb-visually-hidden">{run > 0 ? `As it landed again.${run % 2 === 0 ? ' ' : ''}` : ''}</p>
      <div ref={ring.clip} className="kb-moment-body" data-kb-quotable="hidden">{children}</div>
      {!content && <div ref={ring.ring} className="kb-moment-ring" aria-hidden="true" />}
      {!content && (
        <p ref={ring.tag} className="kb-moment-tag">
          <span>{label}</span>
          {/* The time the play landed is the frame's label and the Lens's (the owner, 2026-11-06: "the date is in the Lens already"); the tag says only what is not. */}
          {status !== null && read !== 'loading' && <><span aria-hidden="true"> · </span><span>{status}</span></>}
          {reset && back !== undefined && <><span aria-hidden="true"> · </span><button type="button" className="kb-moment-reset" onClick={(e) => { e.currentTarget.focus(); reset(); }}>Reset</button></>}
          {back && <><span aria-hidden="true"> · </span><button type="button" className="kb-moment-back" onClick={(e) => backToNow(e.currentTarget, play, back)}>{backLabel}</button></>}
        </p>
      )}
      {list !== null && (into === undefined ? list : into !== null && createPortal(list, into))}
    </div>
  );
}

/** The room the hung tag keeps from what stands on the date bar to its right (the marks, the permalink), in px. */
const TAG_GAP = 8;

/**
 * The ring's and the tag's places: in the thread the ring is over the post body the moment sits in (engine/ui/cards/body.ts), and the
 * tag hangs on the post's date bar, its foot on the body's top edge, out of the post's flow, so the words stand where they stood when
 * the play landed (the owner, 2026-11-06: "Moving it up to cover the post date works, since it's a temporary reversion to a previous
 * date/time anyway"). The tag starts at the date and stops short of the first thing to its right on the bar, the marks or the
 * permalink; where that leaves it too narrow for one line (a phone) it wraps, growing up over the band above, never into the words or
 * the marks. Both are measured from the moment and kept there as the moment, the body or the date bar changes size, or the words move
 * (a takeover moves them, and a moved moment is measured at its next render). With no body, both are the stylesheet's: the ring is the
 * moment's own box and the tag stands in the moment's flow.
 */
function useRing() {
  const host = useRef<HTMLDivElement | null>(null);
  const ring = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLParagraphElement>(null);
  const clip = useRef<HTMLDivElement>(null);
  const measure = useRef<(() => void) | null>(null);
  /* The post's own foot (its action row), where the list stands in the thread, under the content area and out of it; null where the moment stands in no post's body. */
  const [foot, setFoot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = host.current, r = ring.current, t = tag.current, c = clip.current;
    if (!el || !r || !t || !c) return;
    let body: HTMLElement | null = null;
    let bar: HTMLElement | null = null;
    let box: BodyBox | null = null;
    let cut: BodyBox | null = null;
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure.current?.()) : null;
    watch?.observe(el);
    const unhang = () => { t.removeAttribute('data-kb-hung'); t.removeAttribute('style'); };
    const unclip = () => { c.removeAttribute('data-kb-clipped'); for (const k of ['left', 'top', 'w', 'h']) c.style.removeProperty(`--kb-moment-clip-${k}`); cut = null; };
    measure.current = () => {
      const now = bodyOf(el);
      /* The bar is the date bar beside the body, in the body's own post: an ORIGIN box's area is no post's body, so the post the box stands in lends its moment no bar, and the tag stands in the moment's flow. */
      const nowBar = now?.parentElement?.querySelector<HTMLElement>(':scope > .kb-act-meta') ?? null;
      if (now !== body || nowBar !== bar) {
        if (body) watch?.unobserve(body);
        if (bar) watch?.unobserve(bar);
        if (now) watch?.observe(now);
        if (nowBar) watch?.observe(nowBar);
        body = now;
        bar = nowBar;
        if (!body) { r.removeAttribute('style'); box = null; unhang(); unclip(); }
        /* The foot is the bar's sibling at the other end of the body: found only where there is a bar, so an ORIGIN box's moment never lends its list to the opening post's foot. */
        setFoot(bar?.parentElement?.querySelector<HTMLElement>(':scope > .kb-act-foot') ?? null);
      }
      if (!body) return;
      const next = bodyBox(el, body);
      if (!box || !sameBox(box, next)) { box = next; placeLayer(r, box); }
      /*
       * The ring is a mask, not only a frame (the owner, 2026-11-21: the chamfered area "does not act as a true mask, the effect area overflows it"): what the moment draws is
       * cut along the ring's outer edge, its two chamfers with it, so no ink stands outside the ring or past its cut corners. The cut is the body's box measured from the
       * words' own wrapper, which holds every effect drawn in the moment; the hung tag and the list are outside the wrapper, so it never cuts them.
       */
      const nextCut = bodyBox(c, body);
      if (!cut || !sameBox(cut, nextCut)) {
        cut = nextCut;
        c.style.setProperty('--kb-moment-clip-left', `${cut.left}px`);
        c.style.setProperty('--kb-moment-clip-top', `${cut.top}px`);
        c.style.setProperty('--kb-moment-clip-w', `${cut.w}px`);
        c.style.setProperty('--kb-moment-clip-h', `${cut.h}px`);
        c.setAttribute('data-kb-clipped', '');
      }
      if (!bar) { unhang(); return; }
      /* The tag: from the date's left to the first thing right of it on the bar, its foot on the body's top edge. */
      const h = el.getBoundingClientRect(), b = body.getBoundingClientRect(), barBox = bar.getBoundingClientRect();
      const date = bar.querySelector<HTMLElement>(':scope > time');
      const left = (date ?? bar).getBoundingClientRect().left;
      let right = barBox.right - TAG_GAP;
      for (const other of bar.querySelectorAll<HTMLElement>(':scope > :not(time)')) {
        const o = other.getBoundingClientRect();
        if (o.width > 0 && o.left > left) right = Math.min(right, o.left - TAG_GAP);
      }
      /*
       * Placed from the moment's top, which the tag leaving the flow does not move (its foot would, measured from the bottom), and through
       * the style's properties: the page's policy refuses a written style attribute.
       */
      t.setAttribute('data-kb-hung', '');
      t.style.left = `${left - h.left}px`;
      t.style.maxWidth = `${Math.max(0, right - left)}px`;
      t.style.top = `${b.top + body.clientTop - h.top - t.offsetHeight}px`;
    };
    measure.current();
    return () => { measure.current = null; watch?.disconnect(); };
  }, []);
  /* Each render: a moment moved (into Stick Around's view and back) with no size change wakes no observer. */
  useLayoutEffect(() => { measure.current?.(); });
  return { host, ring, tag, clip, foot };
}

/**
 * Back to now, with focus kept where the reader is: the button goes with the frame, so focus moves to the play's As it landed in its
 * open Lens, else to the play's mark on the post.
 */
function backToNow(button: HTMLElement, play: CardPlay, back: () => void) {
  const post = button.closest('article, .kb-origin');
  back();
  queueMicrotask(() => {
    const pressed = document.querySelector<HTMLElement>(`.kb-lens-row[data-kb-play="${CSS.escape(play.id)}"] .kb-lens-action[aria-pressed]`);
    const mark = post?.querySelector<HTMLElement>(`.kb-mark[data-kb-card="${CSS.escape(play.card)}"]`);
    (pressed ?? mark)?.focus();
  });
}

/**
 * A play's moment, read and drawn: the frame, and the moment's version drawn by `bodyOf` inside the effects of its plays.
 * While it loads, or where it failed, the frame holds the post's words as they are now (`now`), so the post never empties, with the
 * tag saying so and Try again under it.
 */
export function MomentView({ play, place, nameOf, bodyOf, back, now, source, onView, listInto }: {
  readonly play: CardPlay; readonly place: EffectPlace;
  /** A spin's moment in place of the play's own: the pressed post as it was when the spin was written, labeled "As it was spun". */
  readonly source?: { readonly spin: Id };
  readonly nameOf: (character: Id | null) => string;
  readonly bodyOf: (version: Act) => ReactNode;
  readonly back?: () => void;
  readonly now: ReactNode;
  /** Where the drawn effects' views go, by card (null when an effect is gone): the strip of the post the moment shows on, where its Lens reads them. */
  readonly onView: (card: string, view: CardView | null) => void;
  /** The frame's list goes here where given (the ORIGIN box's foot, under its content area); see `MomentFrame`. */
  readonly listInto?: HTMLElement | null | undefined;
}) {
  const { api, instance, ui } = useKayfa();
  const key = source ? source.spin : play.id;
  const read = useMomentRead(key, () => (source ? api.spinMoment(source.spin) : api.playMoment(play.id)));
  const label = source ? 'As it was spun' : 'As it landed';
  const frame = useRef<HTMLDivElement>(null);
  /* Reset: each run of the moment's effects is keyed by the run, so a press remounts every one from the moment's states; the read moment is kept. */
  const lens = useLensStore();
  const run = useSyncExternalStore(lens.subscribe, () => lens.run(key), () => 0);
  /* The store's run outlives the view (Back to now, then As it landed again reopens it), so the status is said only of a Reset pressed while this view is mounted on this key. */
  /* Kept with the key it was taken for: a view given another moment (a new key) takes the run that moment has then as its own start. */
  const runAtMount = useRef({ key, run });
  if (runAtMount.current.key !== key) runAtMount.current = { key, run };
  if (read.status !== 'read' || read.moment === null) {
    return (
      <MomentFrame frame={frame} play={play} at={source ? undefined : play.playedAt} label={label} read={read.status === 'read' ? 'none' : read.status} back={back} named={[]} unrecorded={false}>
        {now}
        {read.status === 'failed' && <button type="button" className="kb-moment-retry" onClick={() => { frame.current?.focus(); read.retry(); }}>Try again</button>}
      </MomentFrame>
    );
  }
  const moment = read.moment;
  const parts = momentParts(moment, instance.cards, ui.cards, nameOf);
  return (
    <MomentFrame frame={frame} play={play} at={moment.at} label={label} read="read" back={back} reset={() => lens.reset(key)} run={run - runAtMount.current.run} own={parts.own} named={parts.named} unrecorded={!moment.recorded} listInto={listInto}>
      <MomentEffects key={run} moment={moment} place={place} nameOf={nameOf} onView={onView}>{bodyOf(moment.version)}</MomentEffects>
    </MomentFrame>
  );
}

/** The play whose moment the page shows, or null; a post subscribes to it, and is redrawn when it changes. */
export function useShownMoment(store: LensStore): Id | null {
  return useSyncExternalStore(store.subscribe, store.moment, () => null);
}

/** The rewind play whose post the page shows as the present (Return to present), or null; a post subscribes to it, and is redrawn when it changes. */
export function useShownPresent(store: LensStore): Id | null {
  return useSyncExternalStore(store.subscribe, store.present, () => null);
}
