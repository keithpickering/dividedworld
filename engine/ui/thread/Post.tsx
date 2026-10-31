/**
 * One Act in a thread, as an `<article id="post-<seq>">` with a permalink. A post has its
 * character's postbit; an unmask, a tally and a reveal are plainer, until the screens that draw them
 * are built (the profile and reveal tasks). The words of an Act are shown as text or as BBCode, never
 * as markup. A card play is no Act of the thread's: it takes no number and shows as a mark on its post's date row
 * (engine/ui/cards/Marks.tsx), whose effect wraps the post's words.
 *
 * A post is memoized on its Act, its person and its layout, and its reactions read their own tally
 * from the tallies store, so a reaction re-renders the post it is on and nothing else.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { PostEffects } from '../cards/Effects.tsx';
import { PostMarks } from '../cards/Marks.tsx';
import { holdsEffects } from '../cards/plays.ts';
import { EditPost } from '../composer/EditPost.tsx';
import type { Act, Id } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { Postbit, Signature, type PostbitLayout, type PostbitPerson } from '../postbit/Postbit.tsx';
import { Link } from '../router.tsx';
import { Origin } from '../spin/Origin.tsx';
import { SpinForm } from '../spin/SpinForm.tsx';
import { SpunInto } from '../spin/SpunInto.tsx';
import { Reactions } from '../reactions/Reactions.tsx';
import { ThreadCtx, useThread, type ThreadContext } from './context.ts';
import { LastEdited, SystemPost, UnmaskLine, quoteLink, text, useHistory, when } from './lines.tsx';
import { pageOf, threadHref } from './pages.ts';

export { ThreadCtx, type ThreadContext };

const SYSTEM = 'The System';

interface Props {
  readonly act: Act;
  readonly person: PostbitPerson | undefined;
  readonly layout: PostbitLayout;
  readonly slid: boolean;
}

/** A post's name for a reader and a screen reader: the character's, The System's, or "A character" where it cannot be shown. */
const nameOf = (act: Act, person: PostbitPerson | undefined) => (act.character === null ? SYSTEM : person?.character.name ?? 'A character');

function Body({ act, name, person, editing, onDone, slot }: { readonly slot: React.RefObject<HTMLElement | null>; readonly act: Act; readonly name: string; readonly person: PostbitPerson | undefined; readonly editing: boolean; readonly onDone: () => void }) {
  const { summary, tallies, mine, changed, plays, nameOf: casterName } = useThread();
  switch (act.kind) {
    case 'unmask': return <UnmaskLine act={act} name={name} />;
    case 'tally':
    case 'reveal':
      /* The System's own posts are reacted to like any Act (no player is their author, so no one is shut out). */
      return (
        <>
          <SystemPost act={act} />
          <Reactions act={act.id} author={null} authorName={name} tallies={tallies} mine={mine} />
        </>
      );
    default: {
      /* A post, and a spin's first Act, which is a post that opens on its origin. */
      const origin = act.kind === 'spin' && summary.originActId !== null && summary.originThread !== null;
      return (
        <>
          {origin && <Origin summary={summary} />}
          {editing
            ? <EditPost act={act} seq={act.seq!} onDone={onDone} onSaved={changed} />
            : <PostEffects plays={plays} post={act} place="thread" slot={slot} nameOf={casterName}><BbCode text={text(act.currentPayload.body)} quoteLink={quoteLink} /></PostEffects>}
          <LastEdited act={act} />
          <Reactions act={act.id} author={act.character} authorName={name} tallies={tallies} mine={mine} />
          {person && <Signature text={person.character.signature} />}
        </>
      );
    }
  }
}

/**
 * What a reader can do with an Act: quote it, spin a thread from it, edit it (the player's own posts), and read its History.
 * The links stand on the post's footer bar, drawn like its header bar (the owner: the row on a bar of its own, so no 2003 text
 * lies on an ink a player picks); the spin form and the history, which open from them, stand under the bar.
 */
/** What the post's spin form is open for: the post itself, or a play on it (from its panel), with what gives focus back when it closes. */
export interface SpinOrigin { readonly id: Id; readonly label: string | null; readonly opener: HTMLElement | null }

function Actions({ act, editing, onEdit, editButton, spinOrigin, setSpinOrigin }: {
  readonly act: Act; readonly editing: boolean; readonly onEdit: () => void; readonly editButton: React.RefObject<HTMLButtonElement | null>;
  readonly spinOrigin: SpinOrigin | null; readonly setSpinOrigin: (o: SpinOrigin | null) => void;
}) {
  const { quote } = useThread();
  const { actingCharacters } = usePlayer();
  const spinButton = useRef<HTMLButtonElement>(null);
  const history = useHistory(act.id);
  const quotable = (act.kind === 'post' || act.kind === 'spin') && quote !== null;
  const mine = act.kind === 'post' && act.character !== null && actingCharacters.some((c) => c.id === act.character);
  /* The post's own Spin thread is pressed while its form is open for the post; a play's form is the play's panel's. */
  const spinning = spinOrigin?.id === act.id;
  return (
    <>
      <footer className="kb-act-foot">
        <div className="kb-act-links kb-small">
          {quotable && <button type="button" className="kb-link-button" onClick={() => quote(act)}>Quote</button>}
          <button
            ref={spinButton} type="button" className="kb-link-button" aria-expanded={spinning} aria-controls={`spin-${act.id}`}
            onClick={() => setSpinOrigin(spinning ? null : { id: act.id, label: act.seq === null ? null : `post ${act.seq}`, opener: spinButton.current })}
          >Spin thread</button>
          {mine && !editing && <button ref={editButton} type="button" className="kb-link-button" onClick={onEdit}>Edit</button>}
          {act.kind === 'post' && history.button}
        </div>
      </footer>
      <div className="kb-act-panels">
        <div id={`spin-${act.id}`}>
          {spinOrigin && (
            <SpinForm
              key={spinOrigin.id} origin={spinOrigin.id} label={spinOrigin.label}
              onClose={() => { const back = spinOrigin.opener; setSpinOrigin(null); (back?.isConnected ? back : spinButton.current)?.focus(); }}
            />
          )}
        </div>
        {act.kind === 'post' && history.panel}
      </div>
    </>
  );
}

export const ActArticle = memo(function ActArticle({ act, person, layout, slid }: Props) {
  const { thread, perPage, observer, plays, tallies, mine, nameOf: casterName } = useThread();
  const ref = useRef<HTMLElement>(null);
  const seq = act.seq!;
  useEffect(() => {
    const el = ref.current;
    if (!observer || !el) return;
    observer.observe(el);
    return () => observer.unobserve(el);
  }, [observer]);
  const name = nameOf(act, person);
  const [editing, setEditing] = useState(false);
  /* Where a card's words and controls stand, under the post's chrome (cards/Effects.tsx `EffectStrip`). Going in Task 6 of the marks-and-the-lens plan, when Whoops! moves from its plate to the Lens. A ref and not state, so the post's words are not drawn again when it mounts. */
  const slot = useRef<HTMLDivElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  /* After an edit is saved or cancelled, focus goes back to the Edit button. */
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const plain = act.kind === 'unmask';
  const [spinOrigin, setSpinOrigin] = useState<SpinOrigin | null>(null);
  return (
    <article
      ref={ref}
      id={`post-${seq}`}
      tabIndex={-1}
      className="kb-act"
      aria-labelledby={`post-${seq}-title`}
      data-kb-seq={seq}
      data-kb-kind={act.kind}
      data-kb-postbit={layout}
      data-kb-arrived={slid ? 'slide' : undefined}
    >
      <h2 id={`post-${seq}-title`} className="kb-visually-hidden">Post {seq} by {name}</h2>
      {/* The author first, then the post's line: the order the board is read in, side by side or stacked. */}
      {!plain && (person
        ? <Postbit person={person} layout={layout} />
        : <div className="kb-postbit-system"><span className="kb-postbit-name">{name}</span></div>)}
      <header className="kb-act-meta">
        <time dateTime={act.createdAt}>{when(act.createdAt)}</time>
        {act.kind === 'post' && <PostMarks post={act.id} ghost={act} plays={plays} to={threadHref(thread, pageOf(seq, perPage), seq)} nameOf={casterName} tallies={tallies} mine={mine} onSpin={(play, name, opener) => setSpinOrigin({ id: play.id, label: name, opener })} />}
        <Link className="kb-act-number" to={threadHref(thread, pageOf(seq, perPage), seq)} aria-label={`Permalink to post #${seq}`}>#{seq}</Link>
      </header>
      <div className="kb-act-main">
        <Body act={act} name={name} person={person} editing={editing} onDone={() => setEditing(false)} slot={slot} />
        <SpunInto act={act.id} />
      </div>
      <Actions act={act} editing={editing} onEdit={() => setEditing(true)} editButton={editButton} spinOrigin={spinOrigin} setSpinOrigin={setSpinOrigin} />
      {holdsEffects(act.kind) && <div className="kb-act-slot" ref={slot} />}
    </article>
  );
});
