/**
 * A character's public profile at /c/:id (a character's own page is public; no player is named).
 * It shows only what anyone could have watched: the tall avatar, title, rank, the exact standing
 * and when it was settled, its place, counts of posts, spins and card plays, the month it joined,
 * its signature, and its public record's latest rows with a link to the full view.
 *
 * Its class is shown only as its player made it public, as of its date ("Revealed: Heel (Oct 3)",
 * "Has Turned since (Oct 20)"); a Turn announced with its old class names that class in the record
 * because it was announced. Nothing else about a class is read or drawn here. A character waiting
 * to debut, and one that does not exist, are the same "No such character".
 *
 * Out of character and plain.
 */
import { useMemo } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { useKayfa } from '../context.tsx';
import type { Character, CharacterCounts, ClassReveal, Id, ProfilePage, StandingPlace, TurnAnnounced } from '../data/api.ts';
import { rankIndex } from '../../rules/ranks.ts';
import { dayAndTime, figure } from '../characters/format.ts';
import { Ago } from '../mini.tsx';
import { FrontDoor } from '../front-door/FrontDoor.tsx';
import { Pips } from '../postbit/Postbit.tsx';
import { Avatar } from './Avatar.tsx';
import { StaffProfile } from './Staff.tsx';
import { monthYear, shortDate } from '../postbit/dates.ts';
import { reveals } from '../postbit/reveals.ts';
import { Link } from '../router.tsx';
import { isSignedOutDoc, type ScreenDoc } from '../screen-docs.ts';
import { PROFILE_ROWS, actRow, mergeWindow, newest, playLinksFrom, revealRow, seasonRow, turnLinksFrom, turnRow, type RecordRow, type Words } from './record.ts';
import { recordHref } from './Record.tsx';
import './profile.css';

interface Loaded {
  readonly counts: CharacterCounts;
  readonly standing: StandingPlace | null;
  readonly settledAt: string | null;
  readonly season: number | null;
  readonly reveals: readonly ClassReveal[];
  readonly turns: readonly TurnAnnounced[];
  readonly rows: readonly RecordRow[];
}

/** The profile draws its document (the forum-load plan, Task 13): whole on the first frame. A character not shown is the router's "cannot find"; signed out, the marker is the front door. */
export function ProfileScreen({ id: _id, doc }: { readonly id: Id; readonly doc: ScreenDoc<ProfilePage> }) {
  if (isSignedOutDoc(doc)) return <FrontDoor />;
  /* A Boss or a Mod Bot is a profile of its own kind: no standing, no class, no season record; its moderation log instead. */
  return doc.character.staff ? <StaffProfile character={doc.character} /> : <Profile character={doc.character} doc={doc} />;
}

function Profile({ character: c, doc }: { readonly character: Character; readonly doc: ProfilePage }) {
  const { instance, ui, settings } = useKayfa();
  const data = useMemo<Loaded>(() => {
    const words: Words = {
      className: (k) => instance.classes.find((x) => x.key === k)?.name ?? k,
      cardName: (k) => instance.cards.find((x) => x.key === k)?.name ?? (k || 'a card'),
      perPage: settings.postsPerPage,
    };
    /* The Turns' tallies and the card plays' target posts come with the document. */
    const links = turnLinksFrom(doc.targets, words.perPage);
    const plays = playLinksFrom(doc.targets, doc.acts, words.perPage);
    /* The newest few of everything: the newest few Acts, with every reveal and Turn, hold the newest few overall. */
    const extras = newest([...doc.reveals.map((r) => revealRow(r, words)), ...doc.turns.map((t) => turnRow(t, words, links)), ...doc.seasons.map((a) => seasonRow(a, c.id, words))]);
    const rows = mergeWindow(extras, doc.acts.map((a) => actRow(a, words, plays)), 0, 0, PROFILE_ROWS);
    return { counts: doc.counts, standing: doc.standing, settledAt: doc.settledAt, season: doc.season?.number ?? null, reveals: doc.reveals, turns: doc.turns, rows };
  }, [doc, instance, settings.postsPerPage]);

  const standing = data.standing?.standing ?? null;
  const index = rankIndex(instance.ranks, standing);
  const rank = instance.ranks[index]?.name ?? '';
  const stated = reveals(data.reveals, data.turns).get(c.id);
  const className = (k: string) => instance.classes.find((x) => x.key === k)?.name ?? k;
  const pips = ui.pips?.[c.pipStyle] ?? ui.pips?.default;
  return (
    <div className="kb-profile">
      <p className="kb-crumb"><Link to="/">Index</Link> › {c.name}</p>
      <h1 className="kb-heading kb-profile-name">{c.name}</h1>
      <section className="kb-profile-card kb-box" aria-label={`About ${c.name}`}>
        <Avatar character={c} />
        <div className="kb-profile-facts">
          {c.title && <p className="kb-profile-title kb-muted">{c.title}</p>}
          {data && (
            <>
              {data.standing && instance.ranks.length > 0 && (
                <p className="kb-profile-rank">
                  <b aria-hidden="true">{rank}</b> <Pips ranks={instance.ranks.length} index={index} name={rank} style={pips} />
                </p>
              )}
              {data.standing && data.settledAt
                ? (
                  <p className="kb-profile-standing">
                    Aura this season: <b>{figure(data.standing.standing)}</b> (settled {dayAndTime(data.settledAt)}) · Place {data.standing.place}{data.standing.of > 0 && <> of {data.standing.of}</>}{data.season !== null && <> in season {data.season}</>} · <Link to="/season?tab=rankings">season standings</Link>
                  </p>
                )
                : <p className="kb-profile-standing kb-muted">Nothing has settled for it yet. <Link to="/season?tab=rankings">Season standings</Link></p>}
              <p className="kb-profile-counts">
                <span>Posts: {data.counts.posts}</span> · <span>Threads spun: {data.counts.spins}</span> · <span>Cards played: {data.counts.cards}</span>
                {monthYear(c.joined) && <> · <span>Joined {monthYear(c.joined)}</span></>}
              </p>
              {stated?.revealed && (
                <p className="kb-profile-class">
                  Revealed: {className(stated.revealed.class)} ({shortDate(stated.revealed.at)})
                  {stated.turnedAt && <> · Has Turned since ({shortDate(stated.turnedAt)})</>}
                </p>
              )}
            </>
          )}
          {c.signature.trim() && <div className="kb-signature kb-small"><BbCode text={c.signature} /></div>}
        </div>
      </section>
      <section className="kb-profile-record" aria-label="Public record">
        <h2 className="kb-heading">Public record</h2>
        {data && (data.rows.length === 0
          ? <p>Nothing yet.</p>
          : (
            <table className="kb-table kb-record-table">
              <caption className="kb-visually-hidden">Latest rows of the public record, newest first</caption>
              <thead><tr><th scope="col">When</th><th scope="col">What</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key}>
                    <td className="kb-small"><Ago at={r.at} /></td>
                    <td>{r.href ? <Link to={r.href}>{r.text}</Link> : r.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        <p className="kb-small"><Link to={recordHref(c.id, 'all')}>See the full record</Link></p>
      </section>
    </div>
  );
}
