/**
 * A play's moment on the post (docs/plans/2026-11-03-effect-history-design.md, section 4): the post as it read when the play landed,
 * with every play on it then as each stood, drawn in place of the post's live body when a reader presses As it landed in the play's
 * Lens row, and in the ORIGIN box of a thread spun from the play.
 *
 * It is glass laid on a board post, in plain words and never in character: a chamfered ring in the play's ink (`inkOf`), or its
 * card's alignment's color, with its glow; a tag at the ring's top ("As it landed · Back to now", the time being the Lens's); and under the
 * words, the plays named in words and each still card's own words, so the moment can be read as well as seen. In the thread the ring
 * is the post body's own edge (`.kb-act-main`, bar to bar), since a card's effect paints the whole body and the moment shows it as it
 * landed (the owner, 2026-11-06: the frame "should extend all the way to the edges accordingly, so it can show the effect
 * accurately"); it is laid over the body and clips nothing. Elsewhere (the ORIGIN box) the ring is the moment's own box. The post's own
 * words are not restyled.
 *
 * A moment is the reader's own screen state: nothing is broadcast, and the log is unchanged. It is read once for the page
 * (`useMomentRead`, kept by the Lens store), and it never changes.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, Id, PlayMoment } from '../data/api.ts';
import { when } from '../thread/lines.tsx';
import { bodyBox, bodyOf, placeLayer, sameBox, type BodyBox } from './body.ts';
import { MomentEffects, inkOf, momentParts } from './Effects.tsx';
import { useLensStore, type LensStore } from './Lens.tsx';
import type { CardPlay, EffectPlace } from './types.ts';
import './moment.css';

/** A moment as it is being read: loading, failed (with a way to ask again), or read. */
export type MomentRead =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly retry: () => void }
  | { readonly status: 'read'; readonly moment: PlayMoment | null };

/** The moment of `play`, read once for the page (the Lens store keeps it) and not again however often it is shown. */
export function useMomentRead(play: Id): MomentRead {
  const { api } = useKayfa();
  const store = useLensStore();
  const kept = useSyncExternalStore(store.subscribe, () => store.kept(play));
  const [failed, setFailed] = useState(0);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (kept !== undefined) return;
    let gone = false;
    store.readMoment(play, () => api.playMoment(play)).catch(() => { if (!gone) setFailed((n) => n + 1); });
    return () => { gone = true; };
  }, [api, store, play, kept, asked]);
  const retry = useCallback(() => setAsked((n) => n + 1), []);
  if (kept !== undefined) return { status: 'read', moment: kept };
  return failed > asked ? { status: 'failed', retry } : { status: 'loading' };
}

/**
 * The frame a moment is drawn in. `back` is Back to now's press (none in an ORIGIN box, whose moment is its content); `named` and
 * `words` are what the frame says under the post; `unrecorded` says what else was on the post then wasn't recorded.
 */
export function MomentFrame({ play, place, at, read, back, named, words, unrecorded, frame, children }: {
  /** `none`: the read answered that the play is no play on a post, which a play on a post never is. */
  readonly play: CardPlay; readonly place: EffectPlace; readonly at: string; readonly read: MomentRead['status'] | 'none';
  readonly back?: (() => void) | undefined;
  readonly named: readonly string[]; readonly words: readonly string[]; readonly unrecorded: boolean;
  /** The frame's element, for a control inside it to give focus to (Try again's answer). */
  readonly frame?: RefObject<HTMLDivElement | null>;
  readonly children: ReactNode;
}) {
  const { instance, ui } = useKayfa();
  /* A card back is drawn in no card's ink: which card it is stays the setter's. */
  const rules = play.faceDown ? undefined : instance.cards.find((c) => c.key === play.card);
  const ink = play.faceDown ? undefined : inkOf(ui, play, [play]);
  const ring = useRing(place);
  return (
    <div ref={(el) => { ring.host.current = el; if (frame) frame.current = el; }} tabIndex={-1} className="kb-moment" role="group" aria-label={`As it landed, ${when(at)}`} data-kb-alignment={rules?.alignment} style={ink ? ({ '--kb-moment-ink': ink } as CSSProperties) : undefined}>
      <div className="kb-moment-body">{children}</div>
      <div ref={ring.ring} className="kb-moment-ring" aria-hidden="true" />
      <p ref={ring.tag} className="kb-moment-tag">
        <span>As it landed</span>
        {/* The time the play landed is the frame's label and the Lens's (the owner, 2026-11-06: "the date is in the Lens already"); the tag says only what is not. */}
        {read !== 'read' && <><span aria-hidden="true"> · </span><span>{read === 'loading' ? 'Loading the moment…' : read === 'failed' ? 'The moment did not load.' : 'This play has no moment to show.'}</span></>}
        {back && <><span aria-hidden="true"> · </span><button type="button" className="kb-moment-back" onClick={(e) => backToNow(e.currentTarget, play, back)}>Back to now</button></>}
      </p>
      {(named.length > 0 || words.length > 0 || unrecorded) && (
        <div className="kb-moment-list">
          {words.map((w) => <p key={w}>{w}</p>)}
          {named.length > 0 && <p>Also on the post then: {named.join(', ')}</p>}
          {unrecorded && <p>What else was on the post then wasn't recorded.</p>}
        </div>
      )}
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
function useRing(place: EffectPlace) {
  const host = useRef<HTMLDivElement | null>(null);
  const ring = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLParagraphElement>(null);
  const measure = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const el = host.current, r = ring.current, t = tag.current;
    if (!el || !r || !t) return;
    let body: HTMLElement | null = null;
    let bar: HTMLElement | null = null;
    let box: BodyBox | null = null;
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure.current?.()) : null;
    watch?.observe(el);
    const unhang = () => { t.removeAttribute('data-kb-hung'); t.removeAttribute('style'); };
    measure.current = () => {
      const now = bodyOf(el, place);
      const nowBar = now?.closest('article')?.querySelector<HTMLElement>(':scope > .kb-act-meta') ?? null;
      if (now !== body || nowBar !== bar) {
        if (body) watch?.unobserve(body);
        if (bar) watch?.unobserve(bar);
        if (now) watch?.observe(now);
        if (nowBar) watch?.observe(nowBar);
        body = now;
        bar = nowBar;
        if (!body) { r.removeAttribute('style'); box = null; unhang(); }
      }
      if (!body) return;
      const next = bodyBox(el, body);
      if (!box || !sameBox(box, next)) { box = next; placeLayer(r, box); }
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
  }, [place]);
  /* Each render: a moment moved (into Stick Around's view and back) with no size change wakes no observer. */
  useLayoutEffect(() => { measure.current?.(); });
  return { host, ring, tag };
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
 * A play's moment, read and drawn: the frame, the moment's version drawn by `bodyOf` inside its still effects, and the frame's words.
 * While it loads, or where it failed, the frame holds the post's words as they are now (`now`), so the post never empties, with the
 * tag saying so and Try again under it.
 */
export function MomentView({ play, place, nameOf, bodyOf, back, now }: {
  readonly play: CardPlay; readonly place: EffectPlace;
  readonly nameOf: (character: Id | null) => string;
  readonly bodyOf: (version: Act) => ReactNode;
  readonly back?: () => void;
  readonly now: ReactNode;
}) {
  const { instance, ui } = useKayfa();
  const read = useMomentRead(play.id);
  const frame = useRef<HTMLDivElement>(null);
  const [said, setSaid] = useState<Readonly<Record<string, string>>>({});
  const onWords = useCallback((card: string, words: string | null) => {
    setSaid((s) => {
      if ((s[card] ?? null) === words) return s;
      const next = { ...s };
      if (words === null) delete next[card]; else next[card] = words;
      return next;
    });
  }, []);
  if (read.status !== 'read' || read.moment === null) {
    return (
      <MomentFrame frame={frame} play={play} place={place} at={play.playedAt} read={read.status === 'read' ? 'none' : read.status} back={back} named={[]} words={[]} unrecorded={false}>
        {now}
        {read.status === 'failed' && <button type="button" className="kb-moment-retry" onClick={() => { frame.current?.focus(); read.retry(); }}>Try again</button>}
      </MomentFrame>
    );
  }
  const moment = read.moment;
  const parts = momentParts(moment, instance.cards, ui.cards, nameOf, instance.settings.setLasts);
  const name = (key: string) => instance.cards.find((c) => c.key === key)?.name ?? key;
  const words = Object.keys(said).sort().map((k) => `${name(k)}: ${said[k]}`);
  return (
    <MomentFrame frame={frame} play={play} place={place} at={play.playedAt} read="read" back={back} named={parts.named} words={words} unrecorded={!moment.recorded}>
      <MomentEffects moment={moment} place={place} nameOf={nameOf} onWords={onWords}>{bodyOf(moment.version)}</MomentEffects>
    </MomentFrame>
  );
}

/** The play whose moment the page shows, or null; a post subscribes to it, and is redrawn when it changes. */
export function useShownMoment(store: LensStore): Id | null {
  return useSyncExternalStore(store.subscribe, store.moment, () => null);
}
