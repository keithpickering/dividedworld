/**
 * The names of the characters a list of moves names in their params (a trophy award's `character`), for MoveSentence's `character`: the params hold only an id. Read once
 * for the ids the rows name that are not yet known, through the public lookup (`characters(ids)`), which holds only debuted characters, so a mask that has not debuted is
 * named nowhere. A lookup that fails leaves the sentence saying "a member", as it always did.
 */
import { useEffect, useMemo, useState } from 'react';
import { useKayfa } from '../context.tsx';

export function useMoveCharacters(rows: readonly { readonly params: Readonly<Record<string, unknown>> }[]): (params: Readonly<Record<string, unknown>>) => string | undefined {
  const { api } = useKayfa();
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const wanted = useMemo(() => [...new Set(rows.flatMap((r) => (typeof r.params['character'] === 'string' ? [r.params['character']] : [])))].sort(), [rows]);
  const key = wanted.join(',');
  useEffect(() => {
    const missing = wanted.filter((id) => !names.has(id));
    if (missing.length === 0) return undefined;
    let live = true;
    api.characters(missing).then((found) => {
      if (live) setNames((had) => new Map([...had, ...found.map((c): [string, string] => [c.id, c.name])]));
    }, () => { /* the sentence says "a member" */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the wanted ids; `names` only says which are known
  }, [api, key]);
  return (params) => (typeof params['character'] === 'string' ? names.get(params['character']) : undefined);
}
