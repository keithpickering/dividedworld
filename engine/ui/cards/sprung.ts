/**
 * The line a card that landed from a back carries in the Lens (`sprungWords`): who set it, when, and what set it off. The card's Act names its spring
 * (`CardPlay.spring`); the spring names the set and the post that set it off, and the characters are theirs. All of it is public, read once for a
 * spring and kept (once.ts): a spring never changes. A read that fails or finds nothing says nothing (the Lens draws the row without the line), and is asked again next time.
 */
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id, KayfaApi } from '../data/api.ts';
import { readCaughtFate, sprungWords } from './lens-words.ts';
import { onceFor } from './once.ts';

const text = (v: unknown): Id | null => (typeof v === 'string' && v !== '' ? v : null);

/** The line for a spring, or null where nothing could be read. */
export async function readSprungWords(api: Pick<KayfaApi, 'actsById' | 'characters'>, spring: Id): Promise<string | null> {
  const [sprang] = await api.actsById([spring]);
  if (!sprang || sprang.kind !== 'spring') return null;
  const ids = [text(sprang.payload.set), text(sprang.payload.by)].filter((id): id is Id => id !== null);
  const read = ids.length === 0 ? [] : await api.actsById(ids);
  const set = read.find((a) => a.id === sprang.payload.set);
  const by = read.find((a) => a.id === sprang.payload.by);
  const trigger = text(sprang.payload.trigger);
  const named = [sprang.character, trigger === 'reaction' ? null : by?.character ?? null].filter((c): c is Id => c !== null);
  const faces = named.length === 0 ? [] : await api.characters([...new Set(named)]);
  const nameOf = (id: Id | null | undefined) => (id ? faces.find((c) => c.id === id)?.name ?? null : null);
  return sprungWords({ setter: nameOf(sprang.character), setAt: set?.createdAt ?? null, quoter: trigger === 'reaction' ? null : nameOf(by?.character), trigger });
}

/** The fate of a caught play's card, by the spring that caught it; undefined while it is unread or when the spring is unknown. */
export function useCaughtFate(spring: Id | undefined): { readonly taken?: string } | undefined {
  const { api } = useKayfa();
  const [fate, setFate] = useState<{ spring: Id; fate: { readonly taken?: string } } | null>(null);
  useEffect(() => {
    if (spring === undefined) return undefined;
    let live = true;
    onceFor(api, spring, 'fate', () => readCaughtFate(api, spring)).then((f) => { if (live && f) setFate({ spring, fate: f }); }, () => {});
    return () => { live = false; };
  }, [api, spring]);
  return spring !== undefined && fate?.spring === spring ? fate.fate : undefined;
}

/** The line above a play's rows when it landed from a back, or null (no spring, not read yet, or unreadable). */
export function useSprungWords(spring: Id | undefined): string | null {
  const { api } = useKayfa();
  const [said, setSaid] = useState<{ spring: Id; words: string | null } | null>(null);
  useEffect(() => {
    if (spring === undefined) return undefined;
    let live = true;
    onceFor(api, spring, 'words', () => readSprungWords(api, spring)).then((words) => { if (live) setSaid({ spring, words }); }, () => {});
    return () => { live = false; };
  }, [api, spring]);
  return spring !== undefined && said?.spring === spring ? said.words : null;
}
