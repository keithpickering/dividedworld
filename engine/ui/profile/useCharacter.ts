import { useEffect, useState } from 'react';
import type { Character, Id, KayfaApi } from '../data/api.ts';

export type Found = { readonly status: 'loading' } | { readonly status: 'failed' } | { readonly status: 'missing' } | { readonly status: 'ready'; readonly character: Character };

/** A debuted character by id; a waiting one, a retired-and-unknown one and none at all are all "missing". */
export function useCharacter(api: KayfaApi, id: Id): Found {
  const [found, setFound] = useState<Found>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    setFound({ status: 'loading' });
    api.characters([id]).then(
      (list) => { if (live) setFound(list[0] ? { status: 'ready', character: list[0] } : { status: 'missing' }); },
      () => { if (live) setFound({ status: 'failed' }); },
    );
    return () => { live = false; };
  }, [api, id]);
  return found;
}
