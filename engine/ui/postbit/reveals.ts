/**
 * What a character's postbit says of its class: the latest statement its player made public
 * (`class_reveals`), "Revealed: Heel (Oct 3)", while that statement is current. An announced Turn
 * made after the reveal clears it, so the character has no entry until it reveals again; a Turn
 * from before the reveal, or at its exact moment (a Turn announced with its new class writes both
 * rows at one instant), changes nothing, and a Turn with no reveal says nothing about a class. A
 * silent Turn is never read: only `turns_announced` reaches here.
 */
import type { ClassReveal, Id, TurnAnnounced } from '../data/api.ts';

export interface Statement {
  readonly revealed: { readonly class: string; readonly at: string } | null;
}

/** One entry for each character whose latest reveal no announced Turn came after. */
export function reveals(revealed: readonly ClassReveal[], turns: readonly TurnAnnounced[]): Map<Id, Statement> {
  const latest = new Map<Id, ClassReveal>();
  for (const r of revealed) {
    const was = latest.get(r.character);
    if (!was || Date.parse(r.at) >= Date.parse(was.at)) latest.set(r.character, r);
  }
  const out = new Map<Id, Statement>();
  for (const [character, r] of latest) {
    if (turns.some((t) => t.character === character && Date.parse(t.at) > Date.parse(r.at))) continue;
    out.set(character, { revealed: { class: r.class, at: r.at } });
  }
  return out;
}
