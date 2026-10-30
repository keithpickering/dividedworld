/**
 * One Act in a thread, as an `<article id="post-<seq>">` with a permalink. A post has its
 * character's postbit; an unmask, a tally and a reveal are plainer, until the screens that draw them
 * are built (the profile and reveal tasks). The words of an Act are shown as text or as BBCode, never
 * as markup. A card play is no Act of the thread's: it takes no number and shows as a tag on its post
 * (engine/ui/cards/), whose effect wraps the post's words.
 *
 * A post is memoized on its Act, its person and its layout, and its reactions read their own tally
 * from the tallies store, so a reaction re-renders the post it is on and nothing else.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { PlayTags, PostEffects } from '../cards/Effects.tsx';
import { PlayActions } from '../cards/PlayActions.tsx';
import { EditPost } from '../composer/EditPost.tsx';
import type { Act } from '../data/api.ts';
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
  const { summary, tallies, mine, changed, plays } = useThread();
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
            : <PostEffects plays={plays} post={act} place="thread" slot={slot}><BbCode text={text(act.currentPayload.body)} quoteLink={quoteLink} /></PostEffects>}
          <LastEdited act={act} />
          <Reactions act={act.id} author={act.character} authorName={name} tallies={tallies} mine={mine} />
          {person && <Signature text={person.character.signature} />}
        </>
      );
    }
  }
}

/** What a reader can do with an Act: quote it, spin a thread from it, edit it (the player's own posts), and read its History. */
function Actions({ act, editing, onEdit, editButton }: { readonly act: Act; readonly editing: boolean; readonly onEdit: () => void; readonly editButton: React.RefObject<HTMLButtonElement | null> }) {
  const { quote } = useThread();
  const { actingCharacters } = usePlayer();
  const [spinning, setSpinning] = useState(false);
  const spinButton = useRef<HTMLButtonElement>(null);
  const history = useHistory(act.id);
  const quotable = (act.kind === 'post' || act.kind === 'spin') && quote !== null;
  const mine = act.kind === 'post' && act.character !== null && actingCharacters.some((c) => c.id === act.character);
  return (
    <div className="kb-act-actions">
      <div className="kb-act-links kb-small">
        <PlayActions act={act} />
        {quotable && <button type="button" className="kb-link-button" onClick={() => quote(act)}>Quote</button>}
        <button ref={spinButton} type="button" className="kb-link-button" aria-expanded={spinning} aria-controls={`spin-${act.id}`} onClick={() => setSpinning(!spinning)}>Spin thread</button>
        {mine && !editing && <button ref={editButton} type="button" className="kb-link-button" onClick={onEdit}>Edit</button>}
        {act.kind === 'post' && history.button}
      </div>
      <div id={`spin-${act.id}`}>
        {spinning && <SpinForm origin={act.id} seq={act.seq} onClose={() => { setSpinning(false); spinButton.current?.focus(); }} />}
      </div>
      {act.kind === 'post' && history.panel}
    </div>
  );
}

export const ActArticle = memo(function ActArticle({ act, person, layout, slid }: Props) {
  const { thread, perPage, observer, plays, nameOf: casterName } = useThread();
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
  /* Where a card's words and controls stand, under the post's chrome (cards/Effects.tsx). A ref and not state, so the post's words are not drawn again when it mounts. */
  const slot = useRef<HTMLDivElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  /* After an edit is saved or cancelled, focus goes back to the Edit button. */
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const plain = act.kind === 'unmask';
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
        <Link className="kb-act-number" to={threadHref(thread, pageOf(seq, perPage), seq)} aria-label={`Permalink to post #${seq}`}>#{seq}</Link>
      </header>
      <div className="kb-act-main">
        {act.kind === 'post' && <PlayTags plays={plays} post={act.id} to={threadHref(thread, pageOf(seq, perPage), seq)} nameOf={casterName} />}
        <Body act={act} name={name} person={person} editing={editing} onDone={() => setEditing(false)} slot={slot} />
        <SpunInto act={act.id} />
        <Actions act={act} editing={editing} onEdit={() => setEditing(true)} editButton={editButton} />
      </div>
      {act.kind === 'post' && <div className="kb-act-slot" ref={slot} />}
    </article>
  );
});
