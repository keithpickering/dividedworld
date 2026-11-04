/**
 * The phrase after "spun from", and its link, for a spun thread's origin: drawn here and nowhere else, by the board's row and
 * by the ORIGIN box's head, so the two cannot drift apart. The whole phrase is one link; where the place leads nowhere it is
 * the words alone, and with no place it reads "an Act".
 */
import { useKayfa } from '../context.tsx';
import type { OriginPlace } from '../data/api.ts';
import { Link } from '../router.tsx';
import { placeHref, placeWords } from './place.ts';

export function OriginLink({ place, perPage }: { readonly place: OriginPlace | null; readonly perPage: number }) {
  const { instance } = useKayfa();
  if (place === null) return <>an Act</>;
  const words = placeWords(place, (key) => instance.cards.find((c) => c.key === key)?.name);
  const href = placeHref(place, perPage);
  return href === null ? <>{words}</> : <Link to={href}>{words}</Link>;
}
