/**
 * A move in force, on the board it changed (the system plan, Task 12; mock-s1-move-notice.html C): the Boss's `move` Act drawn as a
 * 2003 notice under the board's description ("ANNOUNCEMENT from The Director: ..."), its top three reactions small, and on its corner
 * the Act's label in glass, as a card's mark breaks a post's frame: the long label ("THE SYSTEM RENAMED THIS BOARD"), then a plain
 * segment, "WAY OUT: 7 OF 12 POSTERS", which opens a glass overlay with the detail.
 *
 * Two voices, kept apart. The notice's words are the Boss's, in character, and may bluff (the fiction may lie). The glass is
 * plain and never in character (the log never does): the label, the segment and the overlay are the engine's own words, built from
 * the move's kind and demand in the catalogs (engine/system/moves.ts, demands.ts) and the numbers `move_progress` returned, and
 * nothing the Boss wrote is read into them. The overlay says so.
 *
 * The segment is a button. Its overlay is the glass's (engine/ui/glass/Overlay.tsx, the board's modal layer underneath): focus moves
 * into it as it opens, Tab is held inside, Escape and Close shut it, and focus goes back to the segment.
 *
 * Cost: a board page reads this once, for the board's one move in force (boards_now.move_act): the Act, its tally and its progress.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { demandKind, demandWords } from '../../system/demands.ts';
import { moveKind } from '../../system/moves.ts';
import { BbCode } from '../bbcode/render.tsx';
import { dayAndTime } from '../characters/format.ts';
import { useKayfa } from '../context.tsx';
import type { BoardName, Character, Id, MoveNotice as Notice } from '../data/api.ts';
import { Overlay } from '../glass/Overlay.tsx';
import { shortDate } from '../postbit/dates.ts';
import { readable } from '../reactions/Reactions.tsx';
import { Link } from '../router.tsx';
import { moveLabel, wayOut } from './move-words.ts';
import './move.css';

/**
 * The Act's label in glass: the long label from the move kind's catalog, and `way`, the segment beside it where there is one (the
 * board's notice has it; a move's post in a thread has the label alone, so a page of announcements reads no progress per post).
 */
export function MoveTag({ kind, way }: { readonly kind: string; readonly way?: ReactNode }) {
  return (
    <span className="kb-move-tag" data-kb-move-kind={kind}>
      <span className="kb-move-label">{moveLabel(kind)}</span>
      {way}
    </span>
  );
}

interface Loaded {
  readonly notice: Notice;
  readonly boss: Character | null;
  readonly boards: readonly BoardName[];
}

function useNotice(act: Id): Loaded | 'failed' | 'none' | null {
  const { api } = useKayfa();
  const [loaded, setLoaded] = useState<Loaded | 'failed' | 'none' | null>(null);
  useEffect(() => {
    let live = true;
    setLoaded(null);
    void (async () => {
      const [notice, boards] = await Promise.all([api.moveNotice(act), api.boardNames()]);
      if (!notice) { if (live) setLoaded('none'); return; }
      const boss = notice.character ? (await api.characters([notice.character]))[0] ?? null : null;
      if (live) setLoaded({ notice, boss, boards });
    })().catch(() => { if (live) setLoaded('failed'); });
    return () => { live = false; };
  }, [api, act]);
  return loaded;
}

export function MoveNotice({ act }: { readonly act: Id }) {
  const { instance } = useKayfa();
  const loaded = useNotice(act);
  const [open, setOpen] = useState(false);
  const way = useRef<HTMLButtonElement>(null);
  if (loaded === null || loaded === 'none') return null;
  if (loaded === 'failed') return <p className="kb-notice" data-kb-tone="refusal">The notice about this board could not be loaded. Reload the page to try again.</p>;
  const { notice, boss } = loaded;
  const name = boss?.name ?? 'The System';
  const emoji = (kind: string) => instance.reactions.find((r) => r.key === kind)?.emoji ?? readable(kind);
  return (
    <>
      <section className="kb-move-notice" aria-label={`Announcement from ${name}`}>
        <MoveTag
          kind={notice.kind}
          way={(
            <button ref={way} type="button" className="kb-move-way" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
              {wayOut(notice.demand, notice.progress, notice.expiresAt)}<span aria-hidden="true"> ›</span>
            </button>
          )}
        />
        <p className="kb-move-from"><b>ANNOUNCEMENT from {boss ? <Link to={`/c/${encodeURIComponent(boss.id)}`}>{name}</Link> : name}:</b></p>
        <BbCode text={notice.body} />
        {notice.reactions.length > 0 && (
          <ul className="kb-chips kb-move-reactions" aria-label="Reactions">
            {notice.reactions.map((r) => (
              <li key={r.kind} className="kb-chip" data-kb-reaction={r.kind}>
                <span className="kb-visually-hidden">{readable(r.kind)}, {r.count}</span>
                <span aria-hidden="true">{emoji(r.kind)} {r.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {open && <MoveDetail loaded={loaded} onClose={() => setOpen(false)} returnFocusTo={() => way.current} />}
    </>
  );
}

/** The overlay: what was done and when, the demand in words, a progress bar, the expiry, and that an admin can reverse it. Plain. */
function MoveDetail({ loaded, onClose, returnFocusTo }: { readonly loaded: Loaded; readonly onClose: () => void; readonly returnFocusTo: () => HTMLElement | null }) {
  const { notice, boards } = loaded;
  const kind = moveKind(notice.kind);
  const demand = notice.demand;
  const progress = notice.progress;
  const known = demand !== null && demandKind(demand.kind) !== undefined;
  const readProgress = progress !== null && !progress.error && progress.of > 0 ? progress : null;
  const was = boards.find((b) => b.id === notice.params['board'])?.was ?? null;
  const unit = known && readProgress ? (readProgress.of === 1 ? demandKind(demand.kind)!.unit.one : demandKind(demand.kind)!.unit.many).toLowerCase() : '';
  return (
    <Overlay title={moveLabel(notice.kind)} surface="log" kicker="This board" className="kb-move-overlay" onClose={onClose} returnFocusTo={returnFocusTo}>
      <div className="kb-move-detail">
        <h3>What was done</h3>
        <p>
          {kind ? kind.template(notice.params) : moveLabel(notice.kind)}
          {was !== null && <> It was called {was}.</>} It landed {dayAndTime(notice.landedAt)}.
        </p>
        <h3>The way out</h3>
        {demand === null
          ? <p>It asks nothing of the board.</p>
          : known && demand ? <p>{readProgress ? demandWords(demand, readProgress) : demandWords(demand, { done: 0, of: 0 })}</p> : <p>It asks for something this page has no words for.</p>}
        {readProgress && (
          <div className="kb-move-bar" role="progressbar" aria-label="Progress toward the way out" aria-valuemin={0} aria-valuemax={readProgress.of} aria-valuenow={readProgress.done} aria-valuetext={`${readProgress.done} of ${readProgress.of} ${unit}`}>
            <i style={{ width: `${Math.round((100 * readProgress.done) / readProgress.of)}%` }} />
          </div>
        )}
        {progress?.error && <p>Its progress could not be counted just now.</p>}
        {notice.expiresAt && <p>If that does not happen, it ends on {shortDate(notice.expiresAt)}.</p>}
        <p>An admin can reverse it at any time.</p>
        <p className="kb-move-plain">This panel is plain. The announcement on the board is in character and may bluff.</p>
      </div>
    </Overlay>
  );
}
