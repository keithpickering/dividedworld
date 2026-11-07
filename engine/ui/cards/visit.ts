/**
 * The pure parts of a visit's mark and its Lens tab (the Mod Bots design, section 9; Visit.tsx): its state from what the page and its Acts
 * say, the time left as the mark shows it, and the glass's plain words for each state. Kept apart from the screen so the words and the
 * arithmetic are tested under plain node.
 *
 * The words are the glass's own voice: plain and true, out of character. What a Mod said (its arrival line, its filing line, a verdict's line,
 * a quiz's question) is quoted by the screen as the Mod's words and never written here.
 */
import type { Visit, VisitBand, VisitCharge, VisitEnd, VisitInfraction, VisitOutcome } from '../data/api.ts';
import type { UiCopy } from '../types.ts';
import { figure } from '../characters/format.ts';

/** The Lens tab a visit takes: a pseudo-kind ahead of the card kinds, which no card key can be (a card key has no space). */
export const VISIT_KIND = 'visit';

/** What an instance that names no role word for a Mod calls one. */
export const DEFAULT_MOD_ROLE = 'A Mod';

/** A Mod's role as an instance words it ("A Moderator"), or the engine's plain word. */
export const modRole = (copy: Pick<UiCopy, 'modRole'>): string => copy.modRole ?? DEFAULT_MOD_ROLE;

/** A visit's state: open until it ends, then how it ended. */
export type VisitState = 'open' | VisitOutcome;

export const visitState = (visit: Visit, end: VisitEnd | null = visit.end): VisitState => end?.outcome ?? 'open';

/** The time left as the mark shows it, "2:41": whole minutes rounded up, so it reads 0:00 only when the time is up. */
export function timeLeft(endsAt: string, now: number): string {
  const minutes = Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 60_000));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The time left in words for a screen reader: "2 hours 41 minutes". */
export function timeLeftWords(endsAt: string, now: number): string {
  const minutes = Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  return h > 0 ? [part(h, 'hour'), m > 0 ? part(m, 'minute') : ''].filter((x) => x !== '').join(' ') : part(m, 'minute');
}

/** What the mark's tile says: the time left while the visit is open, else how it went. */
export function markText(state: VisitState, endsAt: string, now: number): string {
  switch (state) {
    case 'open': return timeLeft(endsAt, now);
    case 'filed': return 'Filed';
    case 'intercepted': return 'Talked down';
    case 'trapped': return 'Trapped';
    case 'reversed': return 'Ended';
  }
}

/** The Lens tab's name. */
export function tabName(state: VisitState): string {
  switch (state) {
    case 'open': return 'On a visit';
    case 'filed': return 'Filed';
    case 'intercepted': return 'Talked down';
    case 'trapped': return 'Trapped';
    case 'reversed': return 'Ended';
  }
}

/** The mark's name for a screen reader: the Mod, the time left or how it ended, and that it opens the visit. */
export function markLabel(mod: string, state: VisitState, endsAt: string, now: number): string {
  const how = {
    open: `${mod} is on a visit to this post, ${timeLeftWords(endsAt, now)} left`,
    filed: `${mod} filed its visit to this post`,
    intercepted: `${mod}'s visit to this post was talked down`,
    trapped: `${mod}'s visit to this post was ended by a trap`,
    reversed: `${mod}'s visit to this post was ended by an admin`,
  }[state];
  return `${how}. Opens the visit.`;
}

const BAND_ORDER: Record<VisitBand, number> = { minor: 1, moderate: 2, severe: 3 };

/** The charge a visit files on: the heaviest band, the first named among equals (`file_visit`). */
export function topCharge(charges: readonly VisitCharge[]): VisitCharge | null {
  let top: VisitCharge | null = null;
  for (const c of charges) if (top === null || BAND_ORDER[c.band] > BAND_ORDER[top.band]) top = c;
  return top;
}

export const pointsWords = (n: number): string => `${n} warn point${n === 1 ? '' : 's'}`;

/** A charge in words: "Rule 2: No double posting (minor, 2 warn points)". A charge that names no rule is the board's premise. */
export function chargeWords(c: VisitCharge, points: number): string {
  return `${c.rule ?? (c.ruleNumber === null ? 'the board\'s premise' : `Rule ${c.ruleNumber}`)} (${c.band}, ${pointsWords(points)})`;
}

/** What the post is marked as breaking if the visit files: "Rule 2", or the charge's own words where it has no number. */
export const markedAs = (c: VisitCharge): string => (c.ruleNumber === null ? c.rule ?? 'the board\'s premise' : `Rule ${c.ruleNumber}`);

/** "Nov 13", in the reader's zone as the Lens's other dates are. */
export const shortDate = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** An Aura price in hundredths, as the glass says it: "0.50 Aura". */
export const auraWords = (hundredths: number): string => `${figure(hundredths)} Aura`;

/** An appeal's ruling in a plain clause: what the Mod did with the appeal. */
export function rulingWords(verdict: string): string {
  switch (verdict) {
    case 'overturned': return 'overturned it, so the points are gone';
    case 'upheld': return 'upheld it, so nothing changed';
    case 'reduced': return 'reduced it, so fewer points stand';
    case 'increased': return 'increased it, so more points landed';
    default: return 'ruled on it';
  }
}

/** The terms of an appeal, in the glass's plain words. */
export function appealTerms(mod: string, infraction: Pick<VisitInfraction, 'points'>): string {
  return `${mod} hears it, or whoever has taken its place. It is refunded if overturned. It may be upheld, reduced, or increased by up to ${pointsWords(infraction.points)}. One appeal per filing, and your plea is public.`;
}

/** The terms of a try at talking a visit down, for the mask making it. */
export function tryTerms(mod: string, mask: string, tailHours: number): string {
  return `One try for ${mask}. A wrong answer, and ${mod} visits ${mask}'s next post within ${tailHours} hours.`;
}

/** Whether the infraction's points are still on the bar. */
export const stillCounts = (i: VisitInfraction, now: number): boolean => Date.parse(i.expiresAt) > now;
