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
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { MoveTag } from '../board/MoveNotice.tsx';
import { PostEffects } from '../cards/Effects.tsx';
import { PostMarks, type FormAsk } from '../cards/Marks.tsx';
import { AppealCtx, ViolationNotice } from '../cards/Visit.tsx';
import { useReachShown } from '../cards/PlayActions.tsx';
import { effectsOf } from '../cards/land.ts';
import { livePlays, usePlays } from '../cards/plays.ts';
import type { CardPlay } from '../cards/types.ts';
import { quoteStop } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { EditPost } from '../composer/EditPost.tsx';
import type { Act, Id, MyHiddenVersion, Visit } from '../data/api.ts';
import { useNarrow } from '../media.ts';
import { landPost } from '../shine/landing.ts';
import { usePlayer } from '../player.tsx';
import { Postbit, Signature, type PostbitLayout, type PostbitPerson } from '../postbit/Postbit.tsx';
import { Link } from '../router.tsx';
import { Origin } from '../spin/Origin.tsx';
import { SpinForm, useSpinDrafts } from '../spin/SpinForm.tsx';
import { SpunInto } from '../spin/SpunInto.tsx';
import { Reactions } from '../reactions/Reactions.tsx';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';
import { lowerFirst } from '../copy-words.ts';
import { useKayfa } from '../context.tsx';
import { ThreadCtx, useOwnerOf, useThread, type ThreadContext, type Under } from './context.ts';
import { moveOffice } from '../board/move-words.ts';
import { GroupMoveLine, RulingTag, rulingOf } from './GroupMove.tsx';
import { ConcealingNote, HiddenNote, HiddenOwn, useMyHidden } from '../conduct/Hidden.tsx';
import { AnnounceLine, LastEdited, MoveEndLine, MoveKeepLine, SystemPost, UnmaskLine, quoteHead, text, useHistory, when, type PostAbout } from './lines.tsx';
import { pageOf, threadHref } from './pages.ts';
import { FoldBar } from './FoldBar.tsx';
import { RowFoldCtx, useFoldMotion } from './fold.tsx';

export { ThreadCtx, type ThreadContext };

interface Props {
  readonly act: Act;
  readonly person: PostbitPerson | undefined;
  readonly layout: PostbitLayout;
  readonly slid: boolean;
}

/** What makes a post the reply a play in force draws under another: the post it is under (its id and number) and the play that put it there. */
interface Cut { readonly parent: Id; readonly seq: number; readonly play: Id }

/** A post's name for a reader and a screen reader: the character's, the staff's (`UiCopy.staffWord`, for an Act with no character), or "A character" where it cannot be shown. */
const nameOf = (act: Act, person: PostbitPerson | undefined, staff: string) => (act.character === null ? staff : person?.character.name ?? 'A character');

function Body({ act, name, spoken, person, editing, own, onEdit, onDone, marks, visit }: {
  /** What the post's own player may read of it while hidden: undefined while it is read, null for nothing more than the note. */
  readonly own: MyHiddenVersion | null | undefined; readonly marks: ReactNode; readonly visit: Visit | undefined; readonly act: Act; readonly name: string; readonly spoken: string; readonly person: PostbitPerson | undefined; readonly editing: boolean; readonly onEdit: () => void; readonly onDone: () => void }) {
  const { summary, tallies, mine, changed, plays, nameOf: casterName } = useThread();
  const owner = useOwnerOf();
  /* A hidden post's words are never drawn from the Act: the note stands in their place. Its own player, and only that, reads their words back (Hidden.tsx, read by the article). */
  const hidden = act.hidden === true;
  switch (act.kind) {
    case 'unmask': return <UnmaskLine act={act} name={name} />;
    case 'announce':
      /* A character's own Act: its line, with the postbit above and the reactions under, which are scored for the character. */
      return (
        <>
          <AnnounceLine act={act} name={name} />
          <Reactions act={act.id} author={act.character} authorName={spoken} tallies={tallies} mine={mine} />
        </>
      );
    /* A draw or a wash is a surface's layer, drawn by its card's effect on the post it is on: it is nothing to draw as a post. */
    case 'draw':
    case 'wash': return null;
    case 'move_end': return <MoveEndLine act={act} />;
    case 'move_keep': return <MoveKeepLine name={name} pronouns={person?.character.pronouns ?? ENGINE_DEFAULT_PRONOUNS} />;
    case 'move':
      /* The Boss's move: its stock line in its own voice, under the glass's label of the move, which the engine's catalog words and the Boss cannot change. */
      return (
        <>
          <MoveTag kind={text(act.payload.kind)} office={moveOffice(act.payload)} />
          <GroupMoveLine act={act} office={moveOffice(act.payload)} />
          <BbCode text={text(act.currentPayload.body)} quoteHead={quoteHead} />
          <Reactions act={act.id} author={act.character} authorName={spoken} tallies={tallies} mine={mine} />
          {person && <Signature text={person.character.signature} />}
        </>
      );
    case 'tally':
    case 'reveal':
      /* The System's own posts are reacted to like any Act (no player is their author, so no one is shut out). */
      return (
        <>
          <SystemPost act={act} />
          <Reactions act={act.id} author={null} authorName={spoken} tallies={tallies} mine={mine} />
        </>
      );
    default: {
      /* A post, and a spin's first Act, which is a post that opens on its origin. */
      const origin = act.kind === 'spin' && summary.originActId !== null && summary.originThread !== null;
      const ruling = rulingOf(act);
      /* A veiled post is drawn under the stand-in, and it is still its author's player's: the edit form saves as the character that wrote it, and the row is theirs. */
      const by = owner(act);
      const editable = by === act.character ? act : { ...act, character: by };
      return (
        <>
          {ruling && <RulingTag ruling={ruling} />}
          {origin && <Origin summary={summary} />}
          {!editing && <ViolationNotice visit={visit} />}
          {editing
            ? <EditPost key={own?.words ?? ''} act={editable} seq={act.seq!} onDone={onDone} onSaved={changed} {...(own ? { start: own.words } : {})} />
            : act.concealing === true && !hidden
              ? <ConcealingNote />
              : hidden
              ? (
                <>
                  <HiddenNote />
                  {own && <HiddenOwn own={own} onEdit={onEdit}><BbCode text={own.words} quoteHead={quoteHead} /></HiddenOwn>}
                </>
              )
              : <PostEffects plays={plays} post={act} place="thread" marks={marks} nameOf={casterName} bodyOf={(version) => <BbCode text={text(version.currentPayload.body)} quoteHead={quoteHead} />}><BbCode text={text(act.currentPayload.body)} quoteHead={quoteHead} /></PostEffects>}
          <LastEdited act={act} />
          <Reactions act={act.id} author={by} authorName={spoken} tallies={tallies} mine={mine} plays={plays} />
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
/**
 * What the post's spin form is open for: the post itself, or a play on it (from its Lens), with what gives focus back when it closes.
 * `at` is the post a spin is pressed on, set only from a card on a character's mark on that post's postbit: the spin records it
 * (docs/plans/2026-11-12-spin-at-post-design.md). No other caller sets it.
 */
export interface SpinOrigin { readonly id: Id; readonly label: string | null; readonly opener: HTMLElement | null; readonly at?: Id }

/**
 * Whether a post's plays stop a quote of it as of the moment this is called (`quoteStop`). `quotableAt` calls it when a selection is made, so it reads the
 * time then. The post's own Quote link and the toolbar's (`Thread.tsx`, `latest`, a `useMemo`) call it while drawing, so a play that has ended frees them
 * when that post or the toolbar next renders after the end (a change to that post's plays, or a new page read), not at the moment itself. Meanwhile nothing
 * on the client refuses a quote typed by hand; the server's guard is the authority.
 */
export function quoteStopped(plays: readonly CardPlay[], instance: Pick<Instance, 'cards' | 'settings'>): boolean {
  return quoteStop(effectsOf(plays, instance.cards)) !== undefined;
}

function Actions({ act, about, canEdit, editing, onEdit, editButton, spinOrigin, setSpinOrigin, onReport }: {
  /** What names the post when a version of it is reported from its History. */
  readonly about: PostAbout;
  /** Whether the post may be edited from here: not a hidden one whose author's words are not (yet) read, which would open a blank editor. */
  readonly canEdit: boolean;
  /** Opens the post's report form; absent where the post cannot be reported by this reader (a staff post, the current mask's own, no mask to report through). */
  readonly onReport: ((opener: HTMLElement) => void) | null;
  readonly act: Act; readonly editing: boolean; readonly onEdit: () => void; readonly editButton: React.RefObject<HTMLButtonElement | null>;
  readonly spinOrigin: SpinOrigin | null; readonly setSpinOrigin: (o: SpinOrigin | null) => void;
}) {
  const { quote, plays } = useThread();
  const owner = useOwnerOf();
  const { instance } = useKayfa();
  const { actingCharacters } = usePlayer();
  const spinButton = useRef<HTMLButtonElement>(null);
  /* One draft per origin: the form is keyed by its origin, so a switch between the post and a play would otherwise lose what was typed (#100). */
  const drafts = useSpinDrafts();
  const history = useHistory(act.id, about);
  const stopped = quoteStopped(usePlays(plays, act.id).plays, instance);
  /* A post under a no-quote has no Quote link: left out, not disabled, since its mark and Lens say why. */
  const quotable = (act.kind === 'post' || act.kind === 'spin') && quote !== null && !stopped;
  const by = owner(act);
  const mine = act.kind === 'post' && by !== null && actingCharacters.some((c) => c.id === by);
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
          {mine && canEdit && !editing && <button ref={editButton} type="button" className="kb-button" data-kb-size="small" onClick={onEdit}>Edit</button>}
          {act.kind === 'post' && history.button}
          {onReport && <button type="button" className="kb-button" data-kb-size="small" aria-haspopup="dialog" onClick={(e) => onReport(e.currentTarget)}>Report</button>}
        </div>
      </footer>
      <div className="kb-act-panels">
        <div id={`spin-${act.id}`}>
          {spinOrigin && (
            <SpinForm
              key={spinOrigin.id} origin={spinOrigin.id} label={spinOrigin.label} {...(spinOrigin.at ? { at: spinOrigin.at } : {})}
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

/**
 * A post, and the reply a play in force draws under it (`nested`, a card that replies): a second article right after the post's, built by the same
 * component, so everything a post is and does (its postbit, marks, reactions, controls, the conduct layer, the plays on it) it is and does there. No
 * wrapper holds the two, so the post is the same element before and after a reply arrives live and keeps an open editor, form and focus.
 */
export const ActArticle = memo(function ActArticle({ act, person, layout, slid, nested, nestedPerson }: Props & { readonly nested?: Under | undefined; readonly nestedPerson?: PostbitPerson | undefined }) {
  const play = nested?.play;
  const cut = useMemo<Cut | undefined>(() => (play === undefined ? undefined : { parent: act.id, seq: act.seq!, play }), [play, act.id, act.seq]);
  return (
    <>
      <PostArticle act={act} person={person} layout={layout} slid={slid} />
      {nested && <PostArticle act={nested.act} person={nestedPerson} layout={layout} slid={false} cut={cut} />}
    </>
  );
});

const PostArticle = memo(function PostArticle({ act, person, layout, slid, cut }: Props & { readonly cut?: Cut | undefined }) {
  const { thread, perPage, observer, plays, tallies, mine, nameOf: casterName, faceOf, pronounsOf, summary, know, visits } = useThread();
  const { api, ui, instance } = useKayfa();
  const ref = useRef<HTMLElement>(null);
  const narrow = useNarrow();
  const seq = act.seq!;
  /* A reply drawn under a post is linked by its own number on the page of the post it is under, since its own number's page leaves it empty. */
  const href = threadHref(thread, pageOf(cut?.seq ?? seq, perPage), seq);
  /* The rail down its edge is its card's flavor, from the instance's rules for the card the play is of, and the board's muted ink where that is not known. */
  const parentPlays = usePlays(plays, cut?.parent ?? '').plays;
  const flavor = cut ? instance.cards.find((c) => c.key === parentPlays.find((p) => p.id === cut.play)?.card)?.alignment : undefined;
  useEffect(() => {
    const el = ref.current;
    if (!observer || !el) return;
    observer.observe(el);
    return () => observer.unobserve(el);
  }, [observer]);
  /* Glitter lands on this post's cells (docs/plans/2026-11-11-shake-design.md section 4); the way out lets go of them. Strict-mode safe: each run's way out undoes that run. */
  useEffect(() => {
    const el = ref.current;
    return el ? landPost(el) : undefined;
  }, []);
  const name = nameOf(act, person, ui.copy.staffWord);
  /* The name as it reads inside a sentence: the staff's word is set for a name slot ("The staff"), so it is lowered here ("Post 3 by the staff"). */
  const spoken = act.character === null ? lowerFirst(name) : name;
  const [editing, setEditing] = useState(false);
  /* The row folds behind a bar while the post wears a live play, on its own reach, of a card that folds the row (`CardUi.foldsRow`); an admin's ending of it unfolds the row when the post next renders. The reader's own state, in the page's memory. */
  const ownPlays = usePlays(plays, act.id).plays;
  const folding = (act.kind === 'post' || act.kind === 'spin') && livePlays(ownPlays, api.now()).some((p) => !p.reach && ui.cards.find((c) => c.key === p.card)?.foldsRow === true);
  const [folded, setFolded] = useState(false);
  const toggleFold = useCallback(() => setFolded((was) => !was), []);
  const grid = useRef<HTMLDivElement>(null);
  useFoldMotion(folded, folding, grid, ref);
  const rowFold = useMemo(() => (folding ? { open: folded, toggle: toggleFold } : null), [folding, folded, toggleFold]);
  const { actingCharacters: acting } = usePlayer();
  const own = useMyHidden(act.id, act.character !== null && acting.some((c) => c.id === act.character), act.hidden === true);
  const canEdit = act.hidden !== true || own != null;
  const editButton = useRef<HTMLButtonElement>(null);
  /* After an edit is saved or cancelled, focus goes back to the Edit button. */
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const plain = act.kind === 'unmask';
  const [spinOrigin, setSpinOrigin] = useState<SpinOrigin | null>(null);
  /* A form the post's strip opens its Lens on: Report from the foot links, Appeal from a filed visit's tab (AppealCtx below). */
  const [ask, setAsk] = useState<FormAsk | null>(null);
  const asks = useRef(0);
  const { hudCharacter } = usePlayer();
  const visit = visits?.get(act.id);
  const askAppeal = useCallback((infraction: Id, opener: HTMLElement) => setAsk({ n: ++asks.current, form: { kind: 'appeal', infraction, visit }, opener }), [visit]);
  /* "Report" is on a player's post that is not the current mask's own; never on a staff post (the server refuses one) or where the post's author is not known to be a player. */
  const reportable = (act.kind === 'post' || act.kind === 'spin') && act.character !== null && person !== undefined && !person.character.staff && hudCharacter !== null && hudCharacter.id !== act.character;
  const askReport = useCallback((opener: HTMLElement) => setAsk({ n: ++asks.current, form: { kind: 'report', post: act.id, seq }, opener }), [act.id, seq]);
  /* "Report to admins" at the foot of the post's Lens: for a post (a spin's first Act is no version the server takes) whose current version is not hidden, whoever wrote it. Its current version is the post itself until it is edited, and read when the dialog opens after. */
  const reportTo = act.kind === 'post' && act.hidden !== true ? { post: act.id, version: act.editedAt === null ? act.id : null, kicker: `Post #${seq} by ${spoken}, current version` } : undefined;
  /* The strip is drawn on the date row, and again by a card that lifts the post out of its thread (Stick Around): the same node, each with its own Lens owner. */
  const marks = act.kind === 'post'
    ? <PostMarks
        post={act.id} ghost={act} plays={plays} to={href} nameOf={casterName} faceOf={faceOf} tallies={tallies} mine={mine} onSpin={(play, name, opener) => setSpinOrigin({ id: play.id, label: name, opener })}
        visit={visit} modPronouns={visit ? pronounsOf(visit.mod) : undefined} author={act.character} thread={thread} onSpinAct={(id, label, opener) => setSpinOrigin({ id, label, opener })} ask={ask}
        {...(reportTo ? { reportTo } : {})}
      />
    : null;
  /* The character's own live plays, on its postbit, and the armed character card's ghost there (the card mechanic's design, section 7). */
  /* Drawn only where a play or an armed card concerns the character; memoized, so the memo on Postbit still skips a postbit whose character, post and page are unchanged. */
  /* The stand-in a veil shows takes no character card: no ghost of an armed one on its postbit. */
  const standIn = person?.character.office === 'anonymous';
  const shown = useReachShown(plays, act.kind === 'post' && !standIn ? act.character : null, 'character');
  const characterMarks = useMemo(() => (shown && act.kind === 'post' && act.character !== null
    ? <PostMarks
        post={act.character} postAt={act.createdAt} plays={plays} compare={false} to={href} nameOf={casterName} faceOf={faceOf} tallies={tallies} mine={mine}
        reachAt={{ reach: 'character', target: act.character, name, ...(person ? { pronouns: person.character.pronouns } : {}), fromPost: act, thread, board: summary.board, title: summary.title, to: href, plays, know: know ?? (async () => {}), focusBack: () => document.getElementById(`post-${seq}`) }}
        onSpin={(play, label, opener) => setSpinOrigin({ id: play.id, label, opener, at: act.id })}
      />
    : null), [shown, act, plays, thread, seq, perPage, casterName, faceOf, tallies, mine, name, person?.character.pronouns, summary.board, summary.title, know]);
  return (
    <AppealCtx.Provider value={askAppeal}>
    <article
      ref={ref}
      id={`post-${seq}`}
      tabIndex={-1}
      className="kb-act"
      aria-labelledby={`post-${seq}-title`}
      {...(cut ? { 'data-kb-under': '', 'data-kb-cut-seq': seq } : { 'data-kb-seq': seq })}
      style={flavor ? ({ '--kb-rail': `var(--kb-${flavor})` } as CSSProperties) : undefined}
      data-kb-parity={seq % 2 === 0 ? 'even' : 'odd'}
      data-kb-kind={act.kind}
      data-kb-ruling={rulingOf(act) ?? undefined}
      data-kb-postbit={layout}
      data-kb-arrived={slid ? 'slide' : undefined}
      data-kb-fold={folding ? (folded ? 'open' : 'folded') : undefined}
    >
    <RowFoldCtx.Provider value={rowFold}>
      <h2 id={`post-${seq}-title`} className="kb-visually-hidden">Post {seq} by {spoken}{cut && `, cut in under post ${cut.seq}`}</h2>
      {cut && <p className="kb-act-cutline kb-small">Cut in line under post {cut.seq}</p>}
      {folding && <FoldBar person={person} name={name} spoken={spoken} seq={seq} open={folded} toggle={toggleFold} marks={marks} controls={`post-${seq}-row`} />}
      <div ref={grid} className="kb-act-grid" {...(folding ? { id: `post-${seq}-row`, hidden: !folded } : {})}>
        {/* The author first, then the post's line: the order the board is read in, side by side or stacked. */}
        {!plain && (person
          ? <Postbit person={person} layout={layout} marks={characterMarks} />
          : <div className="kb-postbit-system"><span className="kb-postbit-name">{name}</span></div>)}
        <header className="kb-act-meta" data-kb-cell="line">
          <time dateTime={act.createdAt} title={when(act.createdAt)}>{when(act.createdAt, narrow, api.now())}</time>
          {!folding && marks}
          <Link className="kb-act-number" to={href} aria-label={`Permalink to post #${seq}`}>#{seq}</Link>
        </header>
        <div className="kb-act-main" data-kb-cell="words">
          <Body act={act} name={name} spoken={spoken} person={person} editing={editing} own={own} onEdit={() => setEditing(true)} onDone={() => setEditing(false)} marks={marks} visit={visit} />
          <SpunInto act={act.id} />
        </div>
        <Actions act={act} about={{ seq, name: spoken }} canEdit={canEdit} editing={editing} onEdit={() => setEditing(true)} editButton={editButton} spinOrigin={spinOrigin} setSpinOrigin={setSpinOrigin} onReport={reportable ? askReport : null} />
      </div>
    </RowFoldCtx.Provider>
    </article>
    </AppealCtx.Provider>
  );
});

/**
 * The thread's head: its title, the top pager, and the thread's own live plays as marks beside the title, with the armed thread card's
 * ghost there (the card mechanic's design, section 7). A play's Lens offers Spin, whose form opens under the head.
 */
export function ThreadHead({ pager }: { readonly pager: ReactNode }) {
  const { thread, summary, plays, tallies, mine, nameOf, faceOf, know } = useThread();
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
            post={thread} plays={plays} compare={false} to={to} nameOf={nameOf} faceOf={faceOf} tallies={tallies} mine={mine}
            reachAt={{ reach: 'thread', target: thread, name: `“${summary.title}”`, fromPost: null, thread: null, board: summary.board, starter: summary.firstCharacter, title: summary.title, to, plays, know: know ?? (async () => {}), focusBack: () => title.current }}
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
