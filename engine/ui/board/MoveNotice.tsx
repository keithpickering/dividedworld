/**
 * A move in force, on the board it changed (the system plan, Task 12; mock-s1-move-notice.html C): the Boss's `move` Act drawn as a
 * period table under the board's description (a light band reading "Announcement from The Director", the Boss's words, its top reactions;
 * the board look's Task 10, docs/research/2026-11-06-board-look/11-move-notice.html), its top three reactions small, and on its corner
 * the Act's label in glass, as a card's mark breaks a post's frame: the long label ("The Boss renamed this board", in capitals), then a plain
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
 * Cost: a board page reads this once, for the board's one move in force (boards_now.move_act): the Act, its tally and its progress. The
 * progress is the count the tick stored (a primary-key probe, whatever the board holds), so the overlay says when it was counted, and says
 * plainly when the tick has not counted the demand yet, with no number.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { demandAsk, demandKind, demandWords } from '../../system/demands.ts';
import { moveKind } from '../../system/moves.ts';
import { BbCode } from '../bbcode/render.tsx';
import { dayAndTime } from '../characters/format.ts';
import { useKayfa } from '../context.tsx';
import type { BoardName, Character, Id, MoveNotice as Notice, Office } from '../data/api.ts';
import { Layers } from '../glass/layer.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { shortDate } from '../postbit/dates.ts';
import { emojiOfKey } from '../../rules/emoji.ts';
import { localName, readable } from '../reactions/Reactions.tsx';
import { Link } from '../router.tsx';
import { moveLabel, officeRole, wayOut } from './move-words.ts';
import './move.css';

/**
 * The Act's label in glass: the long label from the move kind's catalog, and `way`, the segment beside it where there is one (the
 * board's notice has it; a move's post in a thread has the label alone, so a page of announcements reads no progress per post).
 */
export function MoveTag({ kind, way, office }: { readonly kind: string; readonly way?: ReactNode; /** The office of the staff character who made the move, which decides who the label says made it (a Mod may make some of the Boss's moves). Absent: the Boss. */ readonly office?: Office }) {
  const { ui } = useKayfa();
  return (
    <span className="kb-move-tag" data-kb-move-kind={kind}>
      <span className="kb-move-label">{moveLabel(kind, officeRole(ui.copy, office))}</span>
      {way}
    </span>
  );
}

interface Loaded {
  readonly notice: Notice;
  readonly boss: Character | null;
  readonly boards: readonly BoardName[];
  /** The name of the character a group move put in a group (the params hold its id); null for another kind, or when it could not be read. */
  readonly subject: string | null;
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
      const subjectId = notice.kind === 'conferGroup' && typeof notice.params['character'] === 'string' ? notice.params['character'] : null;
      const [boss, subject] = await Promise.all([
        notice.character ? api.characters([notice.character]).then((r) => r[0] ?? null) : null,
        subjectId ? api.characters([subjectId]).then((r) => r[0]?.name ?? null, () => null) : null,
      ]);
      if (live) setLoaded({ notice, boss, boards, subject });
    })().catch(() => { if (live) setLoaded('failed'); });
    return () => { live = false; };
  }, [api, act]);
  return loaded;
}

export function MoveNotice({ act }: { readonly act: Id }) {
  const { instance, ui } = useKayfa();
  const loaded = useNotice(act);
  const [open, setOpen] = useState(false);
  const way = useRef<HTMLButtonElement>(null);
  const band = useId();
  if (loaded === null || loaded === 'none') return null;
  if (loaded === 'failed') return <p className="kb-notice" data-kb-tone="refusal">The notice about this board could not be loaded. Reload the page to try again.</p>;
  const { notice, boss } = loaded;
  const name = boss?.name ?? ui.copy.roleWord;
  /* A reaction a card added to the post has no entry in the instance's set: its key is its emoji (the row's lookup). */
  const emoji = (kind: string) => instance.reactions.find((r) => r.key === kind)?.emoji ?? emojiOfKey(kind) ?? readable(kind);
  const said = (kind: string) => (instance.reactions.some((r) => r.key === kind) || emojiOfKey(kind) === null ? readable(kind) : localName(emojiOfKey(kind)!, null));
  return (
    <>
      <div className="kb-move-notice">
        <MoveTag
          kind={notice.kind}
          office={notice.office}
          way={(
            <button ref={way} type="button" className="kb-move-way" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
              {wayOut(notice.demand, notice.progress, notice.expiresAt)}<span aria-hidden="true"> ›</span>
            </button>
          )}
        />
        <table className="kb-table kb-move-table" role="table" aria-labelledby={band}>
          <thead role="rowgroup">
            <tr role="row">
              <td role="cell" className="kb-bar"><span id={band} className="kb-move-from">Announcement from {boss ? <Link to={`/c/${encodeURIComponent(boss.id)}`}>{name}</Link> : name}</span></td>
            </tr>
          </thead>
          <tbody role="rowgroup">
            <tr role="row">
              <td role="cell" className="kb-move-words">
                <BbCode text={notice.body} />
                {notice.reactions.length > 0 && (
                  <ul className="kb-chips kb-move-reactions" aria-label="Reactions">
                    {notice.reactions.map((r) => (
                      <li key={r.kind} className="kb-chip" data-kb-reaction={r.kind}>
                        <span className="kb-visually-hidden">{said(r.kind)}, {r.count}</span>
                        <span className="kb-move-tile" aria-hidden="true"><span className="kb-move-emoji">{emoji(r.kind)}</span> <b>{r.count}</b></span>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Layers>{open && <MoveDetail loaded={loaded} onClose={() => setOpen(false)} returnFocusTo={() => way.current} />}</Layers>
    </>
  );
}

/** The overlay: what was done and when, the demand in words, a progress bar, the expiry, and that an admin can reverse it. Plain. */
function MoveDetail({ loaded, onClose, returnFocusTo }: { readonly loaded: Loaded; readonly onClose: () => void; readonly returnFocusTo: () => HTMLElement | null }) {
  const { ui, settings } = useKayfa();
  const { notice, boards, boss, subject } = loaded;
  const kind = moveKind(notice.kind);
  const role = officeRole(ui.copy, notice.office);
  /* A group move names its character, group and board; the params hold ids and keys, and the instance's rows give the names. */
  const names = {
    ...(subject !== null ? { character: subject } : {}),
    ...(settings.groups.find((g) => g.key === notice.params['group']) ? { group: settings.groups.find((g) => g.key === notice.params['group'])!.name } : {}),
    ...(boards.find((b) => b.id === notice.params['board']) ? { board: boards.find((b) => b.id === notice.params['board'])!.name } : {}),
  };
  const demand = notice.demand;
  const progress = notice.progress;
  const known = demand !== null && demandKind(demand.kind) !== undefined;
  const readProgress = progress !== null && !progress.error && progress.of > 0 ? progress : null;
  const was = boards.find((b) => b.id === notice.params['board'])?.was ?? null;
  const unit = known && readProgress ? (readProgress.of === 1 ? demandKind(demand.kind)!.unit.one : demandKind(demand.kind)!.unit.many).toLowerCase() : '';
  return (
    <Overlay title={moveLabel(notice.kind, role)} surface="log" kicker="This board" className="kb-move-overlay" onClose={onClose} returnFocusTo={returnFocusTo}>
      <div className="kb-move-detail">
        <h3>What was done</h3>
        <p>
          {kind ? kind.template(notice.params, role, names) : moveLabel(notice.kind, role)}
          {was !== null && <> It was called {was}.</>} It landed {dayAndTime(notice.landedAt)}.
        </p>
        <h3>The way out</h3>
        {demand === null
          ? <p>It asks nothing of the board.</p>
          : known && demand ? <p>{readProgress ? demandWords(demand, readProgress) : demandAsk(demand)}</p> : <p>It asks for something this page has no words for.</p>}
        {readProgress && (
          <div className="kb-move-bar" role="progressbar" aria-label="Progress toward the way out" aria-valuemin={0} aria-valuemax={readProgress.of} aria-valuenow={readProgress.done} aria-valuetext={`${readProgress.done} of ${readProgress.of} ${unit}`}>
            <i style={{ width: `${Math.round((100 * readProgress.done) / readProgress.of)}%` }} />
          </div>
        )}
        {progress?.error && <p>Its progress could not be counted just now.</p>}
        {known && progress !== null && progress.checkedAt === null && <p>It has not been counted yet.</p>}
        {known && progress !== null && progress.checkedAt !== null && !progress.error && <p className="kb-move-counted">Counted {dayAndTime(progress.checkedAt)}.</p>}
        {notice.expiresAt && <p>{demand === null ? 'It' : 'If that does not happen, it'} ends on {shortDate(notice.expiresAt)}.</p>}
        <p>An admin can reverse it at any time.</p>
        <p className="kb-move-plain">This panel is plain. The announcement on the board is in character and may bluff.</p>
      </div>
    </Overlay>
  );
}
