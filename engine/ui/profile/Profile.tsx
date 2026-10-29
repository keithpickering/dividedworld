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
import { useEffect, useState } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { useKayfa } from '../context.tsx';
import type { Character, CharacterCounts, ClassReveal, Id, StandingPlace, TurnAnnounced } from '../data/api.ts';
import { rankIndex } from '../../rules/ranks.ts';
import { dayAndTime, figure } from '../characters/format.ts';
import { Ago, SignInPrompt, useSignedIn } from '../mini.tsx';
import { Pips } from '../postbit/Postbit.tsx';
import { monthYear, shortDate } from '../postbit/dates.ts';
import { reveals } from '../postbit/reveals.ts';
import { Link } from '../router.tsx';
import { PROFILE_ROWS, actRow, mergeWindow, newest, revealRow, seasonRow, turnLinks, turnRow, type RecordRow, type Words } from './record.ts';
import { NotFound, recordHref } from './Record.tsx';
import { useCharacter } from './useCharacter.ts';
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

export function ProfileScreen({ id }: { readonly id: Id }) {
  const { api } = useKayfa();
  const signedIn = useSignedIn(api);
  const found = useCharacter(api, id);
  if (signedIn === null || found.status === 'loading') return <div className="kb-profile" aria-busy="true" />;
  if (!signedIn) return <div className="kb-profile"><SignInPrompt /></div>;
  if (found.status === 'failed') return <div className="kb-profile"><p className="kb-notice" data-kb-tone="refusal">The profile could not be loaded. Reload the page to try again.</p></div>;
  if (found.status === 'missing') return <NotFound />;
  return <Profile character={found.character} />;
}

function Avatar({ character }: { readonly character: Character }) {
  const src = character.avatarPortrait ?? character.avatarSquare;
  return (
    <span className="kb-profile-avatar" aria-hidden="true">
      {src ? <img src={src} alt="" decoding="async" /> : <span className="kb-profile-none">{character.name.slice(0, 1)}</span>}
    </span>
  );
}

function Profile({ character: c }: { readonly character: Character }) {
  const { api, instance, ui, settings } = useKayfa();
  const [loaded, setLoaded] = useState<Loaded | 'failed' | null>(null);
  useEffect(() => {
    let live = true;
    const words: Words = {
      className: (k) => instance.classes.find((x) => x.key === k)?.name ?? k,
      cardName: (k) => instance.cards.find((x) => x.key === k)?.name ?? (k || 'a card'),
      perPage: settings.postsPerPage,
    };
    Promise.all([
      /* Every read here costs the page and not the history: counters (the counts, the place) and a few newest rows with no count. */
      api.characterCounts(c.id), api.standingPlace(c.id), api.lastSettledAt(), api.season(),
      api.classReveals([c.id]), api.turnsAnnounced([c.id]), api.characterActs(c.id, ['post', 'spin', 'card'], { offset: 0, limit: PROFILE_ROWS }),
      api.characterReveals(c.id),
    ]).then(async ([counts, standing, settledAt, season, revealed, turns, acts, seasons]) => {
      /* The Turns' tallies are placed with one batched read, which needs the Turns first. */
      const links = await turnLinks(api, turns, words.perPage);
      /* The newest few of everything: the newest few Acts, with every reveal and Turn, hold the newest few overall. */
      const extras = newest([...revealed.map((r) => revealRow(r, words)), ...turns.map((t) => turnRow(t, words, links)), ...seasons.map((a) => seasonRow(a, words))]);
      const rows = mergeWindow(extras, acts.map((a) => actRow(a, words)), 0, 0, PROFILE_ROWS);
      if (live) setLoaded({ counts, standing, settledAt, season: season?.number ?? null, reveals: revealed, turns, rows });
    }, () => { if (live) setLoaded('failed'); });
    return () => { live = false; };
  }, [api, c.id, instance, settings.postsPerPage]);

  const data = loaded && loaded !== 'failed' ? loaded : null;
  const standing = data?.standing?.standing ?? null;
  const index = rankIndex(instance.ranks, standing);
  const rank = instance.ranks[index]?.name ?? '';
  const stated = data ? reveals(data.reveals, data.turns).get(c.id) : undefined;
  const className = (k: string) => instance.classes.find((x) => x.key === k)?.name ?? k;
  const pips = ui.pips?.[c.pipStyle] ?? ui.pips?.default;
  return (
    <div className="kb-profile" aria-busy={loaded === null || undefined}>
      <p className="kb-crumb"><Link to="/">Index</Link> › {c.name}</p>
      <h1 className="kb-heading kb-profile-name">{c.name}</h1>
      <section className="kb-profile-card kb-box" aria-label={`About ${c.name}`}>
        <Avatar character={c} />
        <div className="kb-profile-facts">
          {c.title && <p className="kb-profile-title kb-muted">{c.title}</p>}
          {loaded === 'failed' && <p className="kb-notice" data-kb-tone="refusal">Its standing and record could not be loaded. Reload the page to try again.</p>}
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
                    Aura this season: <b>{figure(data.standing.standing)}</b> (settled {dayAndTime(data.settledAt)}) · Place {data.standing.place}{data.standing.of > 0 && <> of {data.standing.of}</>}{data.season !== null && <> in season {data.season}</>} · <Link to="/standings">season standings</Link>
                  </p>
                )
                : <p className="kb-profile-standing kb-muted">Nothing has settled for it yet. <Link to="/standings">Season standings</Link></p>}
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
