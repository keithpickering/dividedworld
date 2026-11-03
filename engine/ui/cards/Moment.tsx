/**
 * A play's moment on the post (docs/plans/2026-11-03-effect-history-design.md, section 4): the post as it read when the play landed,
 * with every play on it then as each stood, drawn in place of the post's live body when a reader presses As it landed in the play's
 * Lens row, and in the ORIGIN box of a thread spun from the play.
 *
 * It is glass laid on a board post, in plain words and never in character: a chamfered frame in the play's ink (`inkOf`), or its
 * card's alignment's color, its glow on a wrapper as the Lens's is (the chamfer's clip-path cuts a box-shadow); a tag hung on the
 * frame's top edge ("As it landed · Nov 3, 4:12 PM · Back to now"); and under the frame, the plays named in words and each still
 * card's own words, so the moment can be read as well as seen. The tag and the list are positioned over the post, out of the page's
 * flow, as the marks are, and the post's own words are not restyled.
 *
 * A moment is the reader's own screen state: nothing is broadcast, and the log is unchanged. It is read once for the page
 * (`useMomentRead`, kept by the Lens store), and it never changes.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, Id, PlayMoment } from '../data/api.ts';
import { when } from '../thread/lines.tsx';
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
export function MomentFrame({ play, at, read, back, named, words, unrecorded, frame, children }: {
  /** `none`: the read answered that the play is no play on a post, which a play on a post never is. */
  readonly play: CardPlay; readonly at: string; readonly read: MomentRead['status'] | 'none';
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
  return (
    <div ref={frame} tabIndex={-1} className="kb-moment" role="group" aria-label={`As it landed, ${when(at)}`} data-kb-alignment={rules?.alignment} style={ink ? ({ '--kb-moment-ink': ink } as CSSProperties) : undefined}>
      <div className="kb-moment-frame"><div className="kb-moment-body">{children}</div></div>
      <p className="kb-moment-tag">
        <span>As it landed</span>
        <span aria-hidden="true"> · </span>
        <span>{read === 'loading' ? 'Loading the moment…' : read === 'failed' ? 'The moment did not load.' : read === 'none' ? 'This play has no moment to show.' : <time dateTime={at}>{when(at)}</time>}</span>
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
      <MomentFrame frame={frame} play={play} at={play.playedAt} read={read.status === 'read' ? 'none' : read.status} back={back} named={[]} words={[]} unrecorded={false}>
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
    <MomentFrame frame={frame} play={play} at={play.playedAt} read="read" back={back} named={parts.named} words={words} unrecorded={!moment.recorded}>
      <MomentEffects moment={moment} place={place} nameOf={nameOf} onWords={onWords}>{bodyOf(moment.version)}</MomentEffects>
    </MomentFrame>
  );
}

/** The play whose moment the page shows, or null; a post subscribes to it, and is redrawn when it changes. */
export function useShownMoment(store: LensStore): Id | null {
  return useSyncExternalStore(store.subscribe, store.moment, () => null);
}
