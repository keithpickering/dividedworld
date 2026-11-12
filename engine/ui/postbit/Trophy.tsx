/**
 * A trophy as a picture: its image carries its name (alt and title), because the badge is information and not decoration. An instance's own
 * kind draws the art its UI holds for the kind's key; an admin's kind carries the URL of its picture. A kind with no art at all is its name in
 * words, so it is never a blank. Shared by the postbit's row and the profile's case.
 */
import type { ShownTrophy } from '../data/api.ts';
import { useKayfa } from '../context.tsx';

export function TrophyBadge({ trophy, className }: { readonly trophy: Pick<ShownTrophy, 'trophy' | 'name' | 'art' | 'belt'>; readonly className?: string }) {
  const { ui } = useKayfa();
  const src = trophy.art ?? ui.trophies?.[trophy.trophy]?.art ?? null;
  const classes = ['kb-trophy', trophy.belt ? 'kb-trophy-belt' : '', className ?? ''].filter(Boolean).join(' ');
  if (src === null) return <span className={classes} title={trophy.name}>{trophy.name}</span>;
  return <img className={classes} src={src} alt={trophy.name} title={trophy.name} loading="lazy" decoding="async" />;
}

/**
 * The trophies a postbit shows: the chosen ones in their order, at most `shownMost` of them (the server caps too), and every belt held now,
 * which stands apart from the count. A held belt that was also chosen is one belt, not a trophy that uses a place.
 */
export function postbitTrophies(list: readonly ShownTrophy[], shownMost: number): readonly ShownTrophy[] {
  let places = 0;
  return list.filter((t) => {
    if (t.belt && t.held) return true;
    places += 1;
    return places <= shownMost;
  });
}

export const heldBelts = (list: readonly ShownTrophy[]): readonly ShownTrophy[] => list.filter((t) => t.belt && t.held);
