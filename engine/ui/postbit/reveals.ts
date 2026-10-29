/**
 * What a character's postbit says of its class: the latest statement its player made public
 * (`class_reveals`), and the date of an announced Turn made after it, which makes that statement
 * out of date ("Revealed: Heel (Oct 3)", "Has Turned since (Oct 20)"). A Turn from before the
 * reveal changes nothing it says, and a Turn with no reveal says nothing about a class.
 */
import type { ClassReveal, Id, TurnAnnounced } from '../data/api.ts';

export interface Statement {
  readonly revealed: { readonly class: string; readonly at: string } | null;
  readonly turnedAt: string | null;
}

/** One entry for each character that has a reveal. */
export function reveals(revealed: readonly ClassReveal[], turns: readonly TurnAnnounced[]): Map<Id, Statement> {
  const latest = new Map<Id, ClassReveal>();
  for (const r of revealed) {
    const was = latest.get(r.character);
    if (!was || Date.parse(r.at) >= Date.parse(was.at)) latest.set(r.character, r);
  }
  const out = new Map<Id, Statement>();
  for (const [character, r] of latest) {
    let turnedAt: string | null = null;
    for (const t of turns) {
      if (t.character !== character || Date.parse(t.at) <= Date.parse(r.at)) continue;
      if (turnedAt === null || Date.parse(t.at) > Date.parse(turnedAt)) turnedAt = t.at;
    }
    out.set(character, { revealed: { class: r.class, at: r.at }, turnedAt });
  }
  return out;
}
