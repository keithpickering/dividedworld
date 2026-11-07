/**
 * A staff character's profile (the system plan, Task 12; mock-s2-director-profile.html C): the ordinary profile with a staff member's
 * fields in Task 9's card, and its moderation log under it as one full-width table (the board look's Task 10). A Boss and a Mod Bot are the same screen; the Boss has ADMINISTRATOR on its badge and
 * the bot MODERATOR, each with its own title. It has no standing, class or season record (a staff character is not scored), so none of
 * those reads is made here.
 *
 * Two voices, kept apart. The table (interests, favorites, mood) and the signature are what the staff member says about itself, in
 * character (`staff_profile_now`), and may bluff; the page says so. The moderation log is a plain record of what it did, from the
 * move Acts themselves (`moves_log`): the date, what was done in the engine's words with links to the boards, and how it ended in
 * short plain words. Newest first, a page at a time, paged by keyset (the last row's time and Act), so a long reign costs a page.
 *
 * A Mod Bot's log is empty until Part 3 gives it visits, and the empty state says so.
 */
import { useCallback, useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import type { BoardName, Character, CharacterCounts, MoveLogRow, MovesCursor, StaffProfile as StaffProfileData } from '../data/api.ts';
import { careerText, type Career } from '../../system/career.ts';
import { BbCode } from '../bbcode/render.tsx';
import { MoveSentence } from '../board/MoveSentence.tsx';
import { endedWords } from '../board/move-words.ts';
import { monthYear, shortDate } from '../postbit/dates.ts';
import { StaffBadge, showsStaffBadge } from '../postbit/StaffBadge.tsx';
import { Link } from '../router.tsx';
import { Avatar } from './Avatar.tsx';
import './profile.css';

interface Said {
  readonly profile: StaffProfileData | null;
  readonly favorites: readonly Character[];
  readonly counts: CharacterCounts;
}

export function StaffProfile({ character: c }: { readonly character: Character }) {
  const { api, settings } = useKayfa();
  const staff = c.staff!;
  const [said, setSaid] = useState<Said | 'failed' | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [profile, counts] = await Promise.all([api.staffProfile(staff), api.characterCounts(c.id)]);
      const favorites = profile && profile.favorites.length > 0 ? await api.characters(profile.favorites) : [];
      if (live) setSaid({ profile, favorites, counts });
    })().catch(() => { if (live) setSaid('failed'); });
    return () => { live = false; };
  }, [api, c.id, staff]);

  const data = said && said !== 'failed' ? said : null;
  const joined = monthYear(c.joined);
  const signature = data?.profile?.signature.trim() || c.signature.trim();
  const none = <span className="kb-muted">None yet</span>;
  /* Each fact is a row, as the ordinary profile's are: its label a row header, its words as they were. `lead` marks the two that stand beside the avatar on a phone. */
  const badge = showsStaffBadge(c, settings.staffGroup?.name);
  const facts: readonly Fact[] = [
    ...(badge ? [{ key: 'staff', label: 'Staff', lead: true, value: <StaffBadge character={c} /> }] : []),
    ...(c.title ? [{ key: 'title', label: 'Title', lead: true, value: c.title }] : []),
    ...(data
      ? [
        { key: 'interests', label: 'Interests', value: data.profile && data.profile.interests.length > 0 ? data.profile.interests.join(', ') : none },
        {
          key: 'favorites',
          label: 'Favorite Members',
          value: data.favorites.length === 0
            ? none
            : data.favorites.map((f, i) => <span key={f.id}>{i > 0 && ', '}<Link to={`/c/${encodeURIComponent(f.id)}`}>{f.name}</Link></span>),
        },
        { key: 'mood', label: 'Current Mood', value: data.profile?.mood ? data.profile.mood : none },
      ]
      : []),
    { key: 'career', label: 'Career', value: <CareerList staff={staff} /> },
    ...(data
      ? [
        { key: 'posts', label: 'Posts', value: data.counts.posts },
        ...(joined ? [{ key: 'joined', label: 'Joined', value: joined }] : []),
      ]
      : []),
  ];
  const lead = facts.filter((f) => f.lead).length;
  const band = useId();
  return (
    <div className="kb-profile kb-staff" aria-busy={said === null || undefined}>
      <p className="kb-crumb"><Link to="/">Index</Link> › {c.name}</p>
      <h1 className="kb-heading kb-profile-name">{c.name}</h1>
      <section className="kb-profile-card">
        <table className="kb-table kb-about kb-staff-card" role="table" aria-labelledby={band} data-kb-lead={lead} style={{ '--kb-about-lead': Math.max(1, lead) } as CSSProperties}>
          <thead role="rowgroup"><tr role="row"><th id={band} role="columnheader" scope="col" colSpan={3}>About {c.name}</th></tr></thead>
          <tbody role="rowgroup">
            {facts.map((f, i) => (
              <tr key={f.key} role="row" data-kb-fact={f.key} data-kb-lead-row={f.lead ? '' : undefined}>
                {i === 0 && <td role="presentation" className="kb-about-avatar" rowSpan={facts.length + 1}><Avatar character={c} /></td>}
                <th role="rowheader" scope="row" className="kb-about-label">{f.label}</th>
                <td role="cell" className="kb-about-value">{f.value}</td>
              </tr>
            ))}
            <tr role="row">
              <td role="cell" colSpan={2} className="kb-about-sig">
                {said === 'failed' && <p className="kb-notice" data-kb-tone="refusal">Its profile could not be loaded. Reload the page to try again.</p>}
                {signature && <div className="kb-signature kb-small"><BbCode text={signature} /></div>}
                <p className="kb-small kb-muted kb-about-note">The interests, favorites, mood and signature are what it says about itself, in character, and it may bluff. The moderation log is a plain record.</p>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <ModerationLog staff={staff} bot={c.office === 'mod'} />
    </div>
  );
}

interface Fact { readonly key: string; readonly label: string; readonly lead?: boolean; readonly value: ReactNode }

/**
 * The career: the seasons it led and the offices it held, as plain facts (`staff_career`, public like "Former Administrator" on a forum),
 * newest first and cut to the engine's bound with "and N more." The words of the Career row. This is the glass, not the persona: it never bluffs.
 */
function CareerList({ staff }: { readonly staff: string }) {
  const { api } = useKayfa();
  const [career, setCareer] = useState<Career | 'failed' | null>(null);
  useEffect(() => {
    let live = true;
    setCareer(null);
    api.staffCareer(staff).then((c) => { if (live) setCareer(c); }, () => { if (live) setCareer('failed'); });
    return () => { live = false; };
  }, [api, staff]);
  const lines = career && career !== 'failed' ? careerText(career) : null;
  return (
    <>
      {career === 'failed' && <p role="alert" className="kb-notice" data-kb-tone="refusal">Its career could not be loaded. Reload the page to try again.</p>}
      <div role="status">{career === null && <p className="kb-visually-hidden">Reading the career</p>}</div>
      {career === null && <p className="kb-muted" aria-hidden="true">Loading the career…</p>}
      {lines !== null && lines.length === 0 && <>No office held yet.</>}
      {lines !== null && lines.length > 0 && (
        <ul className="kb-career">
          {lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
    </>
  );
}

/** A staff key no public name resolves: a persona that has not debuted stays unnamed. */
const UNINTRODUCED = 'a Boss who has not been introduced';

function ModerationLog({ staff, bot }: { readonly staff: string; readonly bot: boolean }) {
  const { api } = useKayfa();
  const [rows, setRows] = useState<readonly MoveLogRow[] | null>(null);
  const [older, setOlder] = useState<MovesCursor | null>(null);
  const [boards, setBoards] = useState<readonly BoardName[]>([]);
  const [bosses, setBosses] = useState<readonly { readonly staff: string; readonly name: string }[]>([]);
  const [state, setState] = useState<'ready' | 'failed' | 'paging'>('ready');

  useEffect(() => {
    let live = true;
    setRows(null);
    /* The debuted staff's public names are a nicety (who keeps a move, whom a nomination names): the log reads without them. */
    Promise.all([api.movesLog(staff), api.boardNames(), api.staffNames().catch(() => [])]).then(([page, names, roster]) => {
      if (!live) return;
      setRows(page.rows);
      setOlder(page.older);
      setBoards(names);
      setBosses(roster);
    }, () => { if (live) setState('failed'); });
    return () => { live = false; };
  }, [api, staff]);

  const more = useCallback(() => {
    if (!older) return;
    setState('paging');
    api.movesLog(staff, older).then((page) => {
      setRows((r) => [...(r ?? []), ...page.rows]);
      setOlder(page.older);
      setState('ready');
    }, () => setState('failed'));
  }, [api, staff, older]);

  const heading = useId();
  return (
    <div className="kb-staff-log">
      {(rows === null || rows.length === 0 || state === 'failed') && <h2 className="kb-heading">Moderation log</h2>}
      {state === 'failed' && <p className="kb-notice" data-kb-tone="refusal">The moderation log could not be loaded. Reload the page to try again.</p>}
      {rows === null && state !== 'failed' && <p className="kb-muted" aria-busy="true">Loading the log…</p>}
      {rows !== null && rows.length === 0 && (
        <p>{bot ? 'Nothing here yet. A Mod Bot\'s moderation log stays empty until Mod Bots start their visits.' : 'Nothing here yet. It has not made a move.'}</p>
      )}
      {rows !== null && rows.length > 0 && (
        <table className="kb-table kb-modlog" role="table" aria-labelledby={heading}>
          <thead role="rowgroup">
            <tr role="row"><td role="cell" className="kb-bar" colSpan={3}><h2 id={heading}>Moderation log</h2></td></tr>
            <tr role="row"><th role="columnheader" scope="col">When</th><th role="columnheader" scope="col">What it did</th><th role="columnheader" scope="col">How it ended</th></tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map((r) => (
              <tr key={r.act} role="row">
                <td role="cell" className="kb-small"><time dateTime={r.at} title={new Date(r.at).toLocaleString('en-US')}>{shortDate(r.at)}</time></td>
                <td role="cell"><MoveSentence kind={r.kind} params={r.params} boards={boards} bosses={bosses} unnamed={UNINTRODUCED} tense="done" /></td>
                <td role="cell" className="kb-small kb-muted">{endedWords(r.end, r.demand, r.keptBy ? bosses.find((b) => b.staff === r.keptBy)?.name ?? UNINTRODUCED : null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows !== null && rows.length > 0 && (
        <p className="kb-small kb-muted kb-modlog-note">
          Every move this staff member has made, newest first.{' '}
          {older && <button type="button" className="kb-link-button" disabled={state === 'paging'} onClick={more}>Older ›</button>}
        </p>
      )}
    </div>
  );
}
