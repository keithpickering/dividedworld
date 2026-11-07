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
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { MoveTag } from '../board/MoveNotice.tsx';
import { PostEffects } from '../cards/Effects.tsx';
import { PostMarks } from '../cards/Marks.tsx';
import { useReachShown } from '../cards/PlayActions.tsx';
import { EditPost } from '../composer/EditPost.tsx';
import type { Act, Id } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { Postbit, Signature, type PostbitLayout, type PostbitPerson } from '../postbit/Postbit.tsx';
import { Link } from '../router.tsx';
import { Origin } from '../spin/Origin.tsx';
import { SpinForm, useSpinDrafts } from '../spin/SpinForm.tsx';
import { SpunInto } from '../spin/SpunInto.tsx';
import { Reactions } from '../reactions/Reactions.tsx';
import { ThreadCtx, useThread, type ThreadContext } from './context.ts';
import { AnnounceLine, LastEdited, MoveEndLine, MoveKeepLine, SystemPost, UnmaskLine, quoteLink, text, useHistory, when } from './lines.tsx';
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

function Body({ act, name, person, editing, onDone, marks }: { readonly marks: ReactNode; readonly act: Act; readonly name: string; readonly person: PostbitPerson | undefined; readonly editing: boolean; readonly onDone: () => void }) {
  const { summary, tallies, mine, changed, plays, nameOf: casterName } = useThread();
  switch (act.kind) {
    case 'unmask': return <UnmaskLine act={act} name={name} />;
    case 'announce':
      /* A character's own Act: its line, with the postbit above and the reactions under, which are scored for the character. */
      return (
        <>
          <AnnounceLine act={act} name={name} />
          <Reactions act={act.id} author={act.character} authorName={name} tallies={tallies} mine={mine} />
        </>
      );
    case 'move_end': return <MoveEndLine act={act} />;
    case 'move_keep': return <MoveKeepLine name={name} />;
    case 'move':
      /* The Boss's move: its stock line in its own voice, under the glass's label of the move, which the engine's catalog words and the Boss cannot change. */
      return (
        <>
          <MoveTag kind={text(act.payload.kind)} />
          <BbCode text={text(act.currentPayload.body)} quoteLink={quoteLink} />
          <Reactions act={act.id} author={act.character} authorName={name} tallies={tallies} mine={mine} />
          {person && <Signature text={person.character.signature} />}
        </>
      );
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
            : <PostEffects plays={plays} post={act} place="thread" marks={marks} nameOf={casterName} bodyOf={(version) => <BbCode text={text(version.currentPayload.body)} quoteLink={quoteLink} />}><BbCode text={text(act.currentPayload.body)} quoteLink={quoteLink} /></PostEffects>}
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
/** What the post's spin form is open for: the post itself, or a play on it (from its Lens), with what gives focus back when it closes. */
export interface SpinOrigin { readonly id: Id; readonly label: string | null; readonly opener: HTMLElement | null }

function Actions({ act, editing, onEdit, editButton, spinOrigin, setSpinOrigin }: {
  readonly act: Act; readonly editing: boolean; readonly onEdit: () => void; readonly editButton: React.RefObject<HTMLButtonElement | null>;
  readonly spinOrigin: SpinOrigin | null; readonly setSpinOrigin: (o: SpinOrigin | null) => void;
}) {
  const { quote } = useThread();
  const { actingCharacters } = usePlayer();
  const spinButton = useRef<HTMLButtonElement>(null);
  /* One draft per origin: the form is keyed by its origin, so a switch between the post and a play would otherwise lose what was typed (#100). */
  const drafts = useSpinDrafts();
  const history = useHistory(act.id);
  const quotable = (act.kind === 'post' || act.kind === 'spin') && quote !== null;
  const mine = act.kind === 'post' && act.character !== null && actingCharacters.some((c) => c.id === act.character);
  /* The post's own Spin thread is pressed while its form is open for the post; a play's form is opened from its row in the Lens. */
  const spinning = spinOrigin?.id === act.id;
  return (
    <>
      <footer className="kb-act-foot" data-kb-cell="actions">
        <div className="kb-act-links kb-small">
          {quotable && <button type="button" className="kb-button" data-kb-size="small" onClick={() => quote(act)}>Quote</button>}
          <button
            ref={spinButton} type="button" className="kb-button" data-kb-size="small" aria-expanded={spinning} aria-controls={`spin-${act.id}`}
            onClick={() => setSpinOrigin(spinning ? null : { id: act.id, label: act.seq === null ? null : `post ${act.seq}`, opener: spinButton.current })}
          >Spin thread</button>
          {mine && !editing && <button ref={editButton} type="button" className="kb-button" data-kb-size="small" onClick={onEdit}>Edit</button>}
          {act.kind === 'post' && history.button}
        </div>
      </footer>
      <div className="kb-act-panels">
        <div id={`spin-${act.id}`}>
          {spinOrigin && (
            <SpinForm
              key={spinOrigin.id} origin={spinOrigin.id} label={spinOrigin.label}
              draft={drafts.get(spinOrigin.id)} onDraft={(d) => drafts.set(spinOrigin.id, d)}
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
  const { thread, perPage, observer, plays, tallies, mine, nameOf: casterName, summary, know } = useThread();
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
  const editButton = useRef<HTMLButtonElement>(null);
  /* After an edit is saved or cancelled, focus goes back to the Edit button. */
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const plain = act.kind === 'unmask';
  const [spinOrigin, setSpinOrigin] = useState<SpinOrigin | null>(null);
  /* The strip is drawn on the date row, and again by a card that lifts the post out of its thread (Stick Around): the same node, each with its own Lens owner. */
  const marks = act.kind === 'post'
    ? <PostMarks post={act.id} ghost={act} plays={plays} to={threadHref(thread, pageOf(seq, perPage), seq)} nameOf={casterName} tallies={tallies} mine={mine} onSpin={(play, name, opener) => setSpinOrigin({ id: play.id, label: name, opener })} />
    : null;
  /* The character's own live plays, on its postbit, and the armed character card's ghost there (the card mechanic's design, section 7). */
  /* Drawn only where a play or an armed card concerns the character; memoized, so the memo on Postbit still skips a postbit whose character, post and page are unchanged. */
  const shown = useReachShown(plays, act.kind === 'post' ? act.character : null, 'character');
  const characterMarks = useMemo(() => (shown && act.kind === 'post' && act.character !== null
    ? <PostMarks
        post={act.character} plays={plays} compare={false} to={threadHref(thread, pageOf(seq, perPage), seq)} nameOf={casterName} tallies={tallies} mine={mine}
        reachAt={{ reach: 'character', target: act.character, name, fromPost: act, thread, board: summary.board, title: summary.title, to: threadHref(thread, pageOf(seq, perPage), seq), plays, know: know ?? (async () => {}), focusBack: () => document.getElementById(`post-${seq}`) }}
        onSpin={(play, label, opener) => setSpinOrigin({ id: play.id, label, opener })}
      />
    : null), [shown, act, plays, thread, seq, perPage, casterName, tallies, mine, name, summary.board, summary.title, know]);
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
        ? <Postbit person={person} layout={layout} marks={characterMarks} />
        : <div className="kb-postbit-system"><span className="kb-postbit-name">{name}</span></div>)}
      <header className="kb-act-meta" data-kb-cell="line">
        <time dateTime={act.createdAt} title={when(act.createdAt)}>{when(act.createdAt)}</time>
        {marks}
        <Link className="kb-act-number" to={threadHref(thread, pageOf(seq, perPage), seq)} aria-label={`Permalink to post #${seq}`}>#{seq}</Link>
      </header>
      <div className="kb-act-main" data-kb-cell="words">
        <Body act={act} name={name} person={person} editing={editing} onDone={() => setEditing(false)} marks={marks} />
        <SpunInto act={act.id} />
      </div>
      <Actions act={act} editing={editing} onEdit={() => setEditing(true)} editButton={editButton} spinOrigin={spinOrigin} setSpinOrigin={setSpinOrigin} />
    </article>
  );
});

/**
 * The thread's head: its title, the top pager, and the thread's own live plays as marks beside the title, with the armed thread card's
 * ghost there (the card mechanic's design, section 7). A play's Lens offers Spin, whose form opens under the head.
 */
export function ThreadHead({ pager }: { readonly pager: ReactNode }) {
  const { thread, summary, plays, tallies, mine, nameOf, know } = useThread();
  const [spinOrigin, setSpinOrigin] = useState<SpinOrigin | null>(null);
  const drafts = useSpinDrafts();
  const to = threadHref(thread, 1);
  /* Where focus goes back to after a play from the head: the ghost goes with the play, the title stays. */
  const title = useRef<HTMLHeadingElement>(null);
  const shown = useReachShown(plays, thread, 'thread');
  return (
    <>
      <div className="kb-thread-head">
        <h1 ref={title} tabIndex={-1} className="kb-heading kb-thread-title">{summary.title}</h1>
        {shown && <span className="kb-thread-head-marks">
          <PostMarks
            post={thread} plays={plays} compare={false} to={to} nameOf={nameOf} tallies={tallies} mine={mine}
            reachAt={{ reach: 'thread', target: thread, name: `“${summary.title}”`, fromPost: null, thread: null, board: summary.board, title: summary.title, to, plays, know: know ?? (async () => {}), focusBack: () => title.current }}
            onSpin={(play, label, opener) => setSpinOrigin({ id: play.id, label, opener })}
          />
        </span>}
        {pager}
      </div>
      {spinOrigin && (
        <SpinForm
          key={spinOrigin.id} origin={spinOrigin.id} label={spinOrigin.label}
          draft={drafts.get(spinOrigin.id)} onDraft={(d) => drafts.set(spinOrigin.id, d)}
          onClose={() => { const back = spinOrigin.opener; setSpinOrigin(null); back?.focus(); }}
        />
      )}
    </>
  );
}
