/**
 * The caster's live pierce (a Cheap Shot), as the cast form and the ghost marks read it, so a card a ward would turn away is offered a character
 * that has one up (`decidePlay`'s `pierce`, the Cheap Shot design, section 3.4).
 *
 * A pierce is a Use on the player's own character, so its play is kept in the page's store of plays under that character, like any play beyond a post.
 * The store is the one source: this reads the character's plays from it, and a play is live there until something spends it (`Plays.add` marks the pierce
 * a Move names in `pierce.by` spent), so it ends on the page as it ends on the server. What the store may not hold yet is read once, with
 * `effectsAbove([character], null, null)`, at most once per character per page: every ghost mark on every post shares that one read (a page of posts is
 * one read, never one per post, "Weigh a design at the scale of a busy instance"). The read is kept for the store it filled, so it goes with the page.
 */
import { useContext, useEffect } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id } from '../data/api.ts';
import type { Rarity } from '../../rules/cards.ts';
import { ThreadCtx } from '../thread/context.ts';
import { createPlays, livePlays, readAbove, usePlays, type Plays } from './plays.ts';

/** The characters whose plays a store has been asked for, by store. A failed read is forgotten, so the next ask reads again. */
const asked = new WeakMap<Plays, Set<Id>>();

/** What a screen with no page's store reads: no plays, so no pierce. */
const NO_PLAYS = createPlays();
const NO_CARDS: ReadonlySet<string> = new Set();

/**
 * The pierce this character has up, or null: the card's `upTo` (the rarest card it gets past a ward) and the card's key, for the form's "This Move uses up
 * your ..." line. `plays` is the page's store (a thread's, or the one a play form was opened with); it defaults to the thread the post is drawn in.
 */
export function usePierce(character: Id | null, plays?: Plays, wanted = true): { readonly upTo: Rarity; readonly card: string } | null {
  const { api, instance } = useKayfa();
  const inThread = useContext(ThreadCtx)?.plays;
  const store = plays ?? inThread ?? NO_PLAYS;
  const mine = usePlays(store, character ?? '');
  useEffect(() => {
    if (!wanted || character === null || store === NO_PLAYS) return;
    const held = asked.get(store) ?? new Set<Id>();
    asked.set(store, held);
    if (held.has(character)) return;
    held.add(character);
    void readAbove(api, store, [character], null, null, NO_CARDS).catch(() => { held.delete(character); });
  }, [api, store, character, wanted]);
  if (character === null) return null;
  const now = api.now();
  for (const p of livePlays(mine.plays, now)) {
    if (p.reach !== 'character' || p.caster !== character) continue;
    const gimmick = instance.cards.find((c) => c.key === p.card)?.gimmick;
    if (gimmick?.kind === 'pierce') return { upTo: gimmick.upTo, card: p.card };
  }
  return null;
}
