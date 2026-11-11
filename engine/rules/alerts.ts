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
 * A ruling is written, with a sub-key each ruling's own build adds when it lands one on a character or a post (only
 * board moves exist today, and none of them does), in the same change as that build ("No player is ever stuck").
 */

export const WRITTEN_KINDS = ['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'cardEnded', 'framed', 'trophy', 'beltLost'] as const;
export const DERIVED_KINDS = ['settlement', 'followed'] as const;
export const EVERYONE_KINDS = ['update', 'seasonNews'] as const;

export const ALERT_KINDS = [...WRITTEN_KINDS, ...DERIVED_KINDS, ...EVERYONE_KINDS] as const;

export type WrittenKind = (typeof WRITTEN_KINDS)[number];
export type AlertKind = (typeof ALERT_KINDS)[number];

/** The sub-keys of `ruling`; empty until a ruling's build adds its own. */
export const RULING_SUBS = [] as const;
export type RulingSub = (typeof RULING_SUBS)[number];

export function isWritten(kind: AlertKind): kind is WrittenKind {
  return (WRITTEN_KINDS as readonly string[]).includes(kind);
}

export function isForEveryone(kind: AlertKind): boolean {
  return (EVERYONE_KINDS as readonly string[]).includes(kind);
}
