/**
 * The phrase after "spun from", and its links, for a spun thread's origin: drawn here and nowhere else, by the board's row and
 * by the ORIGIN box's head, so the two cannot drift apart. A play on a character is several links (the character, the post), the
 * words between them plain text so the phrase reads as one sentence; every other place is one link, or the words alone where the
 * place leads nowhere. With no place it reads "an Act". `faces`, where given, draws the character with its avatar inside its link
 * (the box); without it the name is a plain link (the board's row, which is no link itself, so none nests in another).
 */
import { Fragment } from 'react';
import { useKayfa } from '../context.tsx';
import type { Character, OriginPlace } from '../data/api.ts';
import { CharacterLink } from '../mini.tsx';
import { Link } from '../router.tsx';
import { placeParts } from './place.ts';

export function OriginLink({ place, perPage, faces }: { readonly place: OriginPlace | null; readonly perPage: number; readonly faces?: (id: string) => Character | undefined }) {
  const { instance } = useKayfa();
  if (place === null) return <>an Act</>;
  const parts = placeParts(place, (key) => instance.cards.find((c) => c.key === key)?.name, perPage);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part.href === null ? part.words
            : part.character !== undefined && faces ? <CharacterLink id={part.character} character={faces(part.character)} name={part.words} />
            : <Link to={part.href}>{part.words}</Link>}
        </Fragment>
      ))}
    </>
  );
}
