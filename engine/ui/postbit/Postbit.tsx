/**
 * What a post shows about the character who wrote it: its avatar, name, title, a 2003 member rank
 * with a row of pips, its posts, the month it joined, and the class its player made public, if any.
 *
 * Everything here is public. The rank comes from the season standing (the exact number is on the
 * profile) and the instance's ranks; the pips from the character's pip style. "Joined" is the month
 * and never the day: two characters made a minute apart is a way of reading who owns them. The
 * layout is the reader's setting, side by side with a tall avatar or stacked with a square one; a
 * phone is always stacked, which is the stylesheet's to say (postbit.css), and the square then
 * stands in for a portrait through `<picture>`.
 */
import { memo, type CSSProperties } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { useKayfa } from '../context.tsx';
import type { Character } from '../data/api.ts';
import { rankIndex } from '../../rules/ranks.ts';
import { monthYear, shortDate } from './dates.ts';
import type { Statement } from './reveals.ts';
import './postbit.css';

/** A character and what a postbit shows beside it, gathered once for a page of posts. */
export interface PostbitPerson extends Statement {
  readonly character: Character;
  readonly posts: number;
  /** Hundredths; null when the season has none for it yet. */
  readonly standing: number | null;
}

export type PostbitLayout = 'side' | 'stacked';

/** The avatar slot: the portrait in the tall slot, the square where there is none, the initial where there is no avatar. */
function Avatar({ character, layout }: { readonly character: Character; readonly layout: PostbitLayout }) {
  const { avatarSquare: square, avatarPortrait: portrait } = character;
  if (layout === 'stacked' || !portrait) {
    const src = layout === 'stacked' ? square : square ?? portrait;
    return (
      <span className="kb-postbit-avatar" data-kb-slot={layout === 'side' && src ? 'tall' : 'square'} aria-hidden="true">
        {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <span className="kb-postbit-none">{character.name.slice(0, 1)}</span>}
      </span>
    );
  }
  return (
    <span className="kb-postbit-avatar" data-kb-slot="tall" aria-hidden="true">
      <picture>
        {square && <source media="(max-width: 40em)" srcSet={square} />}
        <img src={portrait} alt="" loading="lazy" decoding="async" />
      </picture>
    </span>
  );
}

/** The rank's pips: as many as the instance has ranks, the first (rank index + 1) filled. */
function Pips({ ranks, index, name, style }: { readonly ranks: number; readonly index: number; readonly name: string; readonly style: { readonly full: string; readonly empty: string } | undefined }) {
  const images = style ? ({ '--kb-pip-full': `url("${style.full}")`, '--kb-pip-none': `url("${style.empty}")` } as CSSProperties) : undefined;
  return (
    <span className="kb-pips" role="img" aria-label={`Rank ${index + 1} of ${ranks}: ${name}`} style={images}>
      {Array.from({ length: ranks }, (_, i) => <span key={i} className="kb-pip" data-kb-filled={i <= index ? '' : undefined} />)}
    </span>
  );
}

export const Postbit = memo(function Postbit({ person, layout }: { readonly person: PostbitPerson; readonly layout: PostbitLayout }) {
  const { instance, ui } = useKayfa();
  const { character: c } = person;
  const index = rankIndex(instance.ranks, person.standing);
  const rank = instance.ranks[index]?.name ?? '';
  const className = (key: string | undefined) => (key === undefined ? undefined : instance.classes.find((k) => k.key === key)?.name ?? key);
  const joined = monthYear(c.joined);
  const pipImages = ui.pips?.[c.pipStyle] ?? ui.pips?.default;
  return (
    <div className="kb-postbit" role="group" aria-label={`About ${c.name}`} data-kb-postbit={layout}>
      <Avatar character={c} layout={layout} />
      <div className="kb-postbit-text">
        <span className="kb-postbit-name">{c.name}</span>
        {c.title && <span className="kb-postbit-title kb-small kb-muted">{c.title}</span>}
        <span className="kb-postbit-rank kb-small">
          <b className="kb-postbit-rank-name" aria-hidden={instance.ranks.length > 0 || undefined}>{rank}</b>
          {instance.ranks.length > 0 && <Pips ranks={instance.ranks.length} index={index} name={rank} style={pipImages} />}
        </span>
        <span className="kb-postbit-counts kb-small kb-muted">
          <span>Posts: {person.posts}</span>
          {joined && <span>Joined {joined}</span>}
        </span>
        {person.revealed && (
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
