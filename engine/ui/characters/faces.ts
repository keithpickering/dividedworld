/**
 * The public faces of the player's characters, from the document the page loaded (`MyCharactersPage.faces`), with the profile or pip style
 * the page has just saved laid over its face until the document is read again, so a select or a form never snaps back between a save and
 * the read that follows it. A new document drops the overlay: it was read after the save.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Character, Id, MyCharactersPage } from '../data/api.ts';

export function useFaces(page: MyCharactersPage): { readonly faces: ReadonlyMap<Id, Character>; readonly setFace: (face: Character) => void } {
  const base = useMemo(() => new Map(page.faces.map((c) => [c.id, c])), [page]);
  const [saved, setSaved] = useState<{ readonly page: MyCharactersPage; readonly faces: ReadonlyMap<Id, Character> } | null>(null);
  const faces = useMemo(() => (saved?.page === page ? new Map([...base, ...saved.faces]) : base), [base, saved, page]);
  const setFace = useCallback((face: Character) => {
    setSaved((was) => ({ page, faces: new Map([...(was?.page === page ? was.faces : []), [face.id, face]]) }));
  }, [page]);
  return { faces, setFace };
}
