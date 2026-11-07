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
import { useMemo, type CSSProperties, type ReactNode } from 'react';
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

interface Fact { readonly key: string; readonly label: string; readonly lead?: boolean; readonly value: ReactNode }

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
  const monthJoined = monthYear(c.joined);
  const signed = c.signature.trim() !== '';
  /* Each fact is a row: its label a row header, its words and links as they were a line of a paragraph. `lead` marks the two that stand beside the avatar on a phone. */
  const facts: readonly Fact[] = [
    ...(c.title ? [{ key: 'title', label: 'Title', lead: true, value: c.title }] : []),
    ...(data.standing && instance.ranks.length > 0
      ? [{ key: 'rank', label: 'Rank', lead: true, value: <span className="kb-about-rank"><b aria-hidden="true">{rank}</b> <Pips ranks={instance.ranks.length} index={index} name={rank} style={pips} /></span> }]
      : []),
    ...(data.standing && data.settledAt
      ? [
        { key: 'aura', label: 'Aura this season', value: <><b>{figure(data.standing.standing)}</b> <span className="kb-muted">(settled {dayAndTime(data.settledAt)})</span></> },
        { key: 'place', label: 'Place', value: <>{data.standing.place}{data.standing.of > 0 && <> of {data.standing.of}</>}{data.season !== null && <> in season {data.season}</>} · <Link to="/season?tab=rankings">season standings</Link></> },
      ]
      : [{ key: 'aura', label: 'Aura this season', value: <span className="kb-muted">Nothing has settled for it yet. <Link to="/season?tab=rankings">Season standings</Link></span> }]),
    { key: 'posts', label: 'Posts', value: data.counts.posts },
    { key: 'spins', label: 'Threads spun', value: data.counts.spins },
    { key: 'cards', label: 'Cards played', value: data.counts.cards },
    ...(monthJoined ? [{ key: 'joined', label: 'Joined', value: monthJoined }] : []),
    ...(stated?.revealed
      ? [{ key: 'class', label: 'Class', value: <>Revealed: {className(stated.revealed.class)} ({shortDate(stated.revealed.at)}){stated.turnedAt && <> · Has Turned since ({shortDate(stated.turnedAt)})</>}</> }]
      : []),
  ];
  const lead = facts.filter((f) => f.lead).length;
  return (
    <div className="kb-profile">
      <p className="kb-crumb"><Link to="/">Index</Link> › {c.name}</p>
      <h1 className="kb-heading kb-profile-name">{c.name}</h1>
      <section className="kb-profile-card">
        <table className="kb-table kb-about" role="table" aria-labelledby="kb-about-band" data-kb-lead={lead} style={{ '--kb-about-lead': Math.max(1, lead) } as CSSProperties}>
          <thead role="rowgroup"><tr role="row"><th id="kb-about-band" role="columnheader" scope="col" colSpan={3}>About {c.name}</th></tr></thead>
          <tbody role="rowgroup">
            {facts.map((f, i) => (
              <tr key={f.key} role="row" data-kb-fact={f.key} data-kb-lead-row={f.lead ? '' : undefined}>
                {i === 0 && <td role="presentation" className="kb-about-avatar" rowSpan={facts.length + (signed ? 1 : 0)}><Avatar character={c} /></td>}
                <th role="rowheader" scope="row" className="kb-about-label">{f.label}</th>
                <td role="cell" className="kb-about-value">{f.value}</td>
              </tr>
            ))}
            {signed && <tr role="row"><td role="cell" colSpan={2} className="kb-about-sig"><div className="kb-signature kb-small"><BbCode text={c.signature} /></div></td></tr>}
          </tbody>
        </table>
      </section>
      <section className="kb-profile-record" aria-label="Public record">
        {data.rows.length === 0
          ? <><h2 className="kb-heading">Public record</h2><p>Nothing yet.</p></>
          : (
            <table className="kb-table kb-record-table" role="table">
              <caption className="kb-visually-hidden">Latest rows of the public record, newest first</caption>
              <thead role="rowgroup">
                <tr role="row" className="kb-record-band"><td role="cell" className="kb-bar" colSpan={2}><h2>Public record</h2></td></tr>
                <tr role="row"><th role="columnheader" scope="col">When</th><th role="columnheader" scope="col">What</th></tr>
              </thead>
              <tbody role="rowgroup">
                {data.rows.map((r) => (
                  <tr key={r.key} role="row">
                    <td role="cell" className="kb-small"><Ago at={r.at} /></td>
                    <td role="cell">{r.href ? <Link to={r.href}>{r.text}</Link> : r.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        <p className="kb-small kb-profile-all"><Link to={recordHref(c.id, 'all')}>See the full record</Link></p>
      </section>
    </div>
  );
}
