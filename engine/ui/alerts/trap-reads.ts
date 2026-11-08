/**
 * What a `trapStruck` alert's words need beyond the rows (words.ts): a card landed from a face-down back names its spring (`payload.spring`), and a
 * cast a Trap Card caught names the set that caught it (`payload.caught`). Both Acts are public, and so are the character they name; nothing is
 * read about anyone but because an alert of the player's names it. A read that fails leaves the plain words ("A face-down card struck ...").
 */
import type { Act, Alert, Id, KayfaApi } from '../data/api.ts';

const text = (v: unknown): Id | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * The Acts and the character names to add for these rows' trapStruck alerts, beyond `acts` and `names` already held: the spring, the set it
 * names, and the setter's character. Reads in two rounds (the card's Act names the spring, the spring names the set), each in one call.
 */
export async function readTrapActs(api: Pick<KayfaApi, 'actsById' | 'characters'>, rows: readonly Alert[], acts: ReadonlyMap<Id, Act>, names: ReadonlyMap<Id, string>): Promise<{ acts: Map<Id, Act>; names: Map<Id, string> }> {
  const gotActs = new Map<Id, Act>();
  const gotNames = new Map<Id, string>();
  try {
    const struck = rows.filter((r) => r.kind === 'trapStruck' && r.act !== null).map((r) => acts.get(r.act!)).filter((a): a is Act => a !== undefined);
    const held = (id: Id) => acts.get(id) ?? gotActs.get(id);
    const read = async (ids: readonly (Id | null)[]) => {
      const want = [...new Set(ids.filter((id): id is Id => id !== null && held(id) === undefined))];
      if (want.length > 0) for (const a of await api.actsById(want)) gotActs.set(a.id, a);
    };
    await read(struck.map((a) => text(a.payload.spring)));
    await read(struck.map((a) => text(a.payload.caught) ?? text(held(text(a.payload.spring) ?? '')?.payload.set)));
    const setters = struck.map((a) => held(text(a.payload.caught) ?? text(held(text(a.payload.spring) ?? '')?.payload.set) ?? '')?.character ?? held(text(a.payload.spring) ?? '')?.character ?? null);
    const unnamed = [...new Set(setters.filter((c): c is Id => c !== null && !names.has(c)))];
    if (unnamed.length > 0) for (const c of await api.characters(unnamed)) gotNames.set(c.id, c.name);
  } catch { /* the plain words stand */ }
  return { acts: gotActs, names: gotNames };
}
