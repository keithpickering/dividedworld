/**
 * The phrase after "spun from", and its links, for a spun thread's origin: drawn here and nowhere else, by the board's row and
 * by the ORIGIN box's head, so the two cannot drift apart. A play on a character is several links (the character, the post), the
 * words between them plain text so the phrase reads as one sentence; every other place is one link, or the words alone where the
 * place leads nowhere. With no place it reads "an Act". `faces`, where given, draws the character with its avatar inside its link
 * (the box); without it the name is a plain link (the board's row, which is no link itself, so none nests in another). `here` is the spun thread's
 * own board: where the origin is on another board (`place.board`) and that board's name is known, the phrase ends " on {Board}", plain text in the same
 * sentence (docs/plans/2026-11-25-spin-board-plan.md, Task 6); an update names none.
 */
import { Fragment } from 'react';
import { useKayfa } from '../context.tsx';
import type { Character, Id, OriginPlace } from '../data/api.ts';
import { useBoardName } from '../boards.ts';
import { CharacterLink } from '../mini.tsx';
import { Link } from '../router.tsx';
import { placeParts } from './place.ts';

export function OriginLink({ place, here, perPage, faces }: { readonly place: OriginPlace | null; readonly here: Id | null; readonly perPage: number; readonly faces?: (id: string) => Character | undefined }) {
  const { instance } = useKayfa();
  const boardName = useBoardName();
  if (place === null) return <>an Act</>;
  const groups = [...instance.groups.ladder, ...instance.groups.conferred];
  const parts = placeParts(place, (key) => instance.cards.find((c) => c.key === key)?.name, (key) => groups.find((g) => g.key === key)?.name, perPage);
  const board = place.kind !== 'update' && place.board !== undefined && place.board !== here ? boardName(place.board) : null;
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part.href === null ? part.words
            : part.character !== undefined && faces ? <CharacterLink id={part.character} character={faces(part.character)} name={part.words} />
            : <Link to={part.href}>{part.words}</Link>}
        </Fragment>
      ))}
      {board !== null && ` on ${board}`}
    </>
  );
}
