/**
 * A staff character's profile (the system plan, Task 12; mock-s2-director-profile.html C): the ordinary profile with a staff member's
 * fields, and its moderation log beside it. A Boss and a Mod Bot are the same screen; the Boss has ADMINISTRATOR on its badge and
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
import { useCallback, useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { BoardName, Character, CharacterCounts, MoveLogRow, MovesCursor, StaffProfile as StaffProfileData } from '../data/api.ts';
import { BbCode } from '../bbcode/render.tsx';
import { MoveSentence } from '../board/MoveSentence.tsx';
import { endedWords } from '../board/move-words.ts';
import { monthYear, shortDate } from '../postbit/dates.ts';
import { StaffBadge } from '../postbit/StaffBadge.tsx';
import { Link } from '../router.tsx';
import { Avatar } from './Avatar.tsx';
import './profile.css';

interface Said {
  readonly profile: StaffProfileData | null;
  readonly favorites: readonly Character[];
  readonly counts: CharacterCounts;
}

export function StaffProfile({ character: c }: { readonly character: Character }) {
  const { api } = useKayfa();
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
  return (
    <div className="kb-profile kb-staff" aria-busy={said === null || undefined}>
      <p className="kb-crumb"><Link to="/">Index</Link> › {c.name}</p>
      <h1 className="kb-heading kb-profile-name">{c.name}</h1>
      <div className="kb-staff-layout">
        <section className="kb-profile-card kb-box kb-staff-card" aria-label={`About ${c.name}`}>
          <Avatar character={c} />
          <div className="kb-profile-facts">
            <p className="kb-profile-title"><StaffBadge character={c} />{c.title && <span className="kb-muted"> {c.title}</span>}</p>
            {said === 'failed' && <p className="kb-notice" data-kb-tone="refusal">Its profile could not be loaded. Reload the page to try again.</p>}
            {data && (
              <table className="kb-table kb-staff-table" aria-label={`About ${c.name}, in its own words`}>
                <tbody>
                  <tr><th scope="row">Interests</th><td>{data.profile && data.profile.interests.length > 0 ? data.profile.interests.join(', ') : <span className="kb-muted">None yet</span>}</td></tr>
                  <tr>
                    <th scope="row">Favorite Members</th>
                    <td>
                      {data.favorites.length === 0
                        ? <span className="kb-muted">None yet</span>
                        : data.favorites.map((f, i) => <span key={f.id}>{i > 0 && ', '}<Link to={`/c/${encodeURIComponent(f.id)}`}>{f.name}</Link></span>)}
                    </td>
                  </tr>
                  <tr><th scope="row">Current Mood</th><td>{data.profile?.mood ? data.profile.mood : <span className="kb-muted">None yet</span>}</td></tr>
                  <tr><th scope="row">Posts</th><td>{data.counts.posts}{joined && <> · Joined {joined}</>}</td></tr>
                </tbody>
              </table>
            )}
            {signature && <div className="kb-signature kb-small"><BbCode text={signature} /></div>}
            <p className="kb-small kb-muted">The interests, favorites, mood and signature are what it says about itself, in character, and it may bluff. The moderation log is a plain record.</p>
          </div>
        </section>
        <ModerationLog staff={staff} bot={c.office === 'mod'} />
      </div>
    </div>
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

  return (
    <section className="kb-staff-log" aria-label="Moderation log">
      <h2 className="kb-heading">Moderation log</h2>
      {state === 'failed' && <p className="kb-notice" data-kb-tone="refusal">The moderation log could not be loaded. Reload the page to try again.</p>}
      {rows === null && state !== 'failed' && <p className="kb-muted" aria-busy="true">Loading the log…</p>}
      {rows !== null && rows.length === 0 && (
        <p>{bot ? 'Nothing here yet. A Mod Bot\'s moderation log stays empty until Mod Bots start their visits.' : 'Nothing here yet. It has not made a move.'}</p>
      )}
      {rows !== null && rows.length > 0 && (
        <table className="kb-table kb-modlog" aria-label="Moderation log, newest first">
          <thead className="kb-visually-hidden"><tr><th scope="col">When</th><th scope="col">What was done</th><th scope="col">How it ended</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.act}>
                <td className="kb-small"><time dateTime={r.at} title={new Date(r.at).toLocaleString('en-US')}>{shortDate(r.at)}</time></td>
                <td><MoveSentence kind={r.kind} params={r.params} boards={boards} bosses={bosses} unnamed={UNINTRODUCED} tense="done" /></td>
                <td className="kb-small kb-muted">{endedWords(r.end, r.demand, r.keptBy ? bosses.find((b) => b.staff === r.keptBy)?.name ?? UNINTRODUCED : null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows !== null && rows.length > 0 && (
        <p className="kb-small kb-muted">
          Every move this staff member has made, newest first.{' '}
          {older && <button type="button" className="kb-link-button" disabled={state === 'paging'} onClick={more}>Older ›</button>}
        </p>
      )}
    </section>
  );
}
