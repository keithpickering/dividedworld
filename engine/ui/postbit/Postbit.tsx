/**
 * What a post shows about the character who wrote it: its avatar, name, title, a 2003 member rank
 * with a row of pips, its group's bar under the name (a staff character's with its office title beside it), its posts, the month it joined, and the class its player made public, if any.
 *
 * Everything here is public. The rank comes from the season standing (the exact number is on the
 * profile) and the instance's ranks; the pips from the character's pip style. "Joined" is the month
 * and never the day: two characters made a minute apart is a way of reading who owns them. The
 * layout is the reader's setting, side by side with a tall avatar or stacked with a square one; a
 * phone is always stacked, which is the stylesheet's to say (postbit.css), and the square then
 * stands in for a portrait through `<picture>`.
 */
import { memo, type CSSProperties, type ReactNode } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { useKayfa } from '../context.tsx';
import { useNarrow } from '../media.ts';
import type { Character } from '../data/api.ts';
import { rankIndex } from '../../rules/ranks.ts';
import { monthYear, shortDate } from './dates.ts';
import { Link } from '../router.tsx';
import type { Statement } from './reveals.ts';
import { Outfit, slotShape } from '../gear/Outfit.tsx';
import { GroupBar } from './GroupBar.tsx';
import { StaffBadge, showsStaffBadge } from './StaffBadge.tsx';
import { WarnMeter } from './WarnMeter.tsx';
import { TrophyBadge, heldBelts, postbitTrophies } from './Trophy.tsx';
import './postbit.css';

/** A character and what a postbit shows beside it, gathered once for a page of posts. */
export interface PostbitPerson extends Statement {
  readonly character: Character;
  readonly posts: number;
  /** Hundredths; null when the season has none for it yet. */
  readonly standing: number | null;
}

export type PostbitLayout = 'side' | 'stacked';

/**
 * The avatar slot: the portrait in the tall slot, the square where there is none, the initial where there is no avatar. A portrait draws at the shape it
 * was cut (`portraitTallness`) and wears its outfit; the square, on the stacked band and on a phone, wears the same pieces cut through its own frame.
 * A mask with no portrait wears nothing.
 */
function Avatar({ character, layout }: { readonly character: Character; readonly layout: PostbitLayout }) {
  const { avatarSquare: square, avatarPortrait: portrait, outfit, squareFrame, portraitTallness } = character;
  const squareFor = portrait && outfit.length > 0 ? <Outfit pieces={outfit} on="square" frame={squareFrame ?? (portraitTallness ? { x: 0, y: 0, w: 1, h: 1 / portraitTallness } : null)} /> : null;
  if (layout === 'stacked' || !portrait) {
    const src = layout === 'stacked' ? square : square ?? portrait;
    return (
      <span className="kb-postbit-avatar" data-kb-slot={layout === 'side' && src ? 'tall' : 'square'} aria-hidden="true">
        {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <span className="kb-postbit-none">{character.name.slice(0, 1)}</span>}
        {src && src === square && squareFor}
      </span>
    );
  }
  /* Both layers are always here and the stylesheet shows one by the width the <picture> source uses, so a phone never paints the tall slot and swaps. */
  return (
    <span className="kb-postbit-avatar" data-kb-slot="portrait" data-kb-square={square ? '' : undefined} data-kb-shaped={portraitTallness === null ? undefined : ''} aria-hidden="true" style={slotShape(portraitTallness)}>
      <picture>
        {square && <source media="(max-width: 40em)" srcSet={square} />}
        <img src={portrait} alt="" loading="lazy" decoding="async" />
      </picture>
      <Outfit pieces={outfit} on="portrait" />
      {square && squareFor}
    </span>
  );
}

/** The rank's pips: as many as the instance has ranks, the first (rank index + 1) filled. */
export function Pips({ ranks, index, name, style }: { readonly ranks: number; readonly index: number; readonly name: string; readonly style: { readonly full: string; readonly empty: string } | undefined }) {
  const images = style ? ({ '--kb-pip-full': `url("${style.full}")`, '--kb-pip-none': `url("${style.empty}")` } as CSSProperties) : undefined;
  return (
    <span className="kb-pips" role="img" aria-label={`Rank ${index + 1} of ${ranks}: ${name}`} style={images}>
      {Array.from({ length: ranks }, (_, i) => <span key={i} className="kb-pip" data-kb-filled={i <= index ? '' : undefined} />)}
    </span>
  );
}

export const Postbit = memo(function Postbit({ person, layout, marks = null, link = true }: {
  readonly person: PostbitPerson; readonly layout: PostbitLayout;
  /** The name links to the character's profile; false draws it as text, for a made-up character with no profile behind it (the front door). */
  readonly link?: boolean;
  /** The character's own marks (its live plays beyond a post), drawn under its name: the thread hands them in. */
  readonly marks?: ReactNode;
}) {
  const { instance, ui, settings } = useKayfa();
  const { character: c } = person;
  /* The look of the group it is in; a key the settings do not list (an answer older than groups) draws no bar rather than a wrong one. */
  const group = settings.groups.find((g) => g.key === c.group);
  /* The stand-in a card's veil shows in place of a post's author (office `anonymous`) is no scored character and holds no rung: no bar, no badge, no meter, no rank. */
  const standIn = c.office === 'anonymous';
  const scored = !c.staff && !standIn;
  /* A stacked postbit, chosen or forced on a phone, drops Posts and Joined: the profile carries them a tap away (the board look design, section 3). */
  const narrow = useNarrow();
  const counts = layout === 'side' && !narrow;
  const index = rankIndex(instance.ranks, person.standing);
  const rank = instance.ranks[index]?.name ?? '';
  const className = (key: string | undefined) => (key === undefined ? undefined : instance.classes.find((k) => k.key === key)?.name ?? key);
  const joined = monthYear(c.joined);
  /* A ban holds while its time is in the future (characters_public.banned_until): the page read it, and the title line says so for as long as the page is open. */
  const banned = c.bannedUntil !== undefined && Date.parse(c.bannedUntil) > Date.now();
  /* The side layout shows the chosen trophies and any belt under the rank; the stacked band and a phone show a held belt only, beside the name. */
  const shelf = counts ? postbitTrophies(c.trophies, instance.settings.cosmetics.trophies.shownMost) : [];
  const belts = counts ? [] : heldBelts(c.trophies);
  const pipImages = ui.pips?.[c.pipStyle] ?? ui.pips?.default;
  return (
    <div className="kb-postbit" role="group" aria-label={`About ${c.name}`} data-kb-postbit={layout}>
      <Avatar character={c} layout={layout} />
      <div className="kb-postbit-text">
        <span className="kb-postbit-name">{link ? <Link to={`/c/${encodeURIComponent(c.id)}`}>{c.name}</Link> : c.name}{belts.length > 0 && <span className="kb-postbit-belts">{belts.map((t) => <TrophyBadge key={t.award} trophy={t} />)}</span>}</span>
        {/* The group's bar under the name; a staff character's has its office title beside it. */}
        {!standIn && (group || showsStaffBadge(c)) && <span className="kb-postbit-group">{group && <GroupBar look={group} />}<StaffBadge character={c} /></span>}
        {marks && <span className="kb-postbit-marks">{marks}</span>}
        {(c.title || banned) && (
          <span className="kb-postbit-title kb-small kb-muted">
            {c.title}
            {banned && <>{c.title && ' '}<strong className="kb-postbit-banned">BANNED<span className="kb-visually-hidden"> until {shortDate(c.bannedUntil!)}</span></strong></>}
          </span>
        )}
        {/* A staff character, and the stand-in, are not scored: no rank, no pips, and no class to reveal. */}
        {scored && (
          <span className="kb-postbit-rank">
            <span className="kb-postbit-rank-name" aria-hidden={instance.ranks.length > 0 || undefined}>{rank}</span>
            {instance.ranks.length > 0 && <Pips ranks={instance.ranks.length} index={index} name={rank} style={pipImages} />}
          </span>
        )}
        {shelf.length > 0 && <span className="kb-postbit-trophies">{shelf.map((t) => <TrophyBadge key={t.award} trophy={t} />)}</span>}
        {c.warnPoints !== undefined && c.warnPoints > 0 && scored && <WarnMeter points={c.warnPoints} size={instance.settings.warnBar.size} />}
        {counts && (
          <span className="kb-postbit-counts kb-small kb-muted">
            <span>Posts: {person.posts}</span>
            {joined && <span>Joined {joined}</span>}
          </span>
        )}
        {scored && person.revealed && (
          <span className="kb-postbit-class kb-small">
            <span>Revealed: {className(person.revealed.class)} ({shortDate(person.revealed.at)})</span>
            {person.turnedAt && <span>Has Turned since ({shortDate(person.turnedAt)})</span>}
          </span>
        )}
      </div>
    </div>
  );
});

/** A character's signature, in BBCode, under its posts. */
export function Signature({ text }: { readonly text: string }) {
  if (!text.trim()) return null;
  return <div className="kb-signature kb-small"><BbCode text={text} /></div>;
}
