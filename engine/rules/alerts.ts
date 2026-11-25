/**
 * The alerts catalog (docs/plans/2026-11-02-alerts-design.md, section 2): the kinds of alert, and how each reaches a
 * player. Three sets, and every kind is in exactly one:
 *
 * - written: stored as a row of `alerts` in the same transaction as the public Act it points at (the table holds no
 *   content, only the account, the kind, the Act and the time). Skipped for a staff character and for the acting
 *   account's own characters.
 * - derived: the player's own, computed when Alerts or the HUD's count is read, from the player's reading marks and
 *   from Acts and settlements. Nothing is stored, so no Act fans out to followers and a settlement is no write.
 * - everyone's: public news, computed from public Acts and shown to every player alike. It is never a row per player.
 *
 * A ruling is written with a sub-key naming what landed (design `docs/plans/2026-11-23-rulings-and-missing-alerts-design.md`,
 * section 7). A Mod Bot visit while it runs, and one that ends unfiled, writes none.
 */

export const WRITTEN_KINDS = ['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'cardEnded', 'framed', 'trophy', 'beltLost', 'beltBack', 'gift', 'conduct'] as const;
export const DERIVED_KINDS = ['settlement', 'followed'] as const;
export const EVERYONE_KINDS = ['update', 'seasonNews'] as const;

export const ALERT_KINDS = [...WRITTEN_KINDS, ...DERIVED_KINDS, ...EVERYONE_KINDS] as const;

export type WrittenKind = (typeof WRITTEN_KINDS)[number];
export type AlertKind = (typeof ALERT_KINDS)[number];

/** The sub-keys of `ruling`: what landed on the character or the post. */
export const RULING_SUBS = ['warning', 'ban', 'fallTaken', 'reportJudged', 'reportRefunded', 'appealAnswered', 'appealRefunded', 'grouped', 'threadMoved', 'trophyReversed', 'pollClosed', 'gearGiven'] as const;
export type RulingSub = (typeof RULING_SUBS)[number];

/** The sub-keys of `cardEnded`. A null sub is the caster's own card ended, as first built. */
export const CARD_ENDED_SUBS = ['onYours', 'refunded'] as const;
export type CardEndedSub = (typeof CARD_ENDED_SUBS)[number];

/** The sub-keys of `cardOnYours` beyond a card played on yours (null). */
export const CARD_ON_YOURS_SUBS = ['drew'] as const;
export type CardOnYoursSub = (typeof CARD_ON_YOURS_SUBS)[number];

/** The sub-keys of `conduct`: the outcomes' own names in `conduct_decisions`. */
export const CONDUCT_SUBS = ['hide', 'hideUntilEdited', 'unhide', 'approve'] as const;
export type ConductSub = (typeof CONDUCT_SUBS)[number];

export function isWritten(kind: AlertKind): kind is WrittenKind {
  return (WRITTEN_KINDS as readonly string[]).includes(kind);
}

export function isForEveryone(kind: AlertKind): boolean {
  return (EVERYONE_KINDS as readonly string[]).includes(kind);
}
