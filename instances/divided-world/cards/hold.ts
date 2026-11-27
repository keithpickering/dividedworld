/**
 * The author's hold: a card may refuse its post author's saves for a number of hours after a play lands
 * (`CardRules.stateHeldUntil`; docs/plans/2026-11-16-autocorrect-hold-design.md, and Hot Box's in
 * docs/plans/2026-11-27-lasting-gags-design.md section 2.2). The server's rule and the screens' preview read the same end from
 * the play's public landing time and an economy setting, so the hold proves nothing private.
 */

/** When a hold of `hours` on a play that landed at `landed` ends; undefined for no hold (0). The server's rule and the screens' preview both read it. */
export function holdEnds(hours: number, landed: Date): Date | undefined {
  return hours > 0 ? new Date(landed.getTime() + hours * 3_600_000) : undefined;
}

/**
 * When the author's hold on a play that landed at `playedAt` (an ISO time) ends, read from the economy setting `key`, for the screens,
 * which hold only the economy of the settings; undefined for no hold, an unparsable time, or an economy without the setting (the
 * screens only preview; the act function refuses the save).
 */
export function heldUntil(settings: { readonly economy: Readonly<Record<string, number>> }, key: string, playedAt: string): Date | undefined {
  const landed = new Date(playedAt), hours = settings.economy[key];
  return Number.isNaN(landed.getTime()) || typeof hours !== 'number' || !Number.isFinite(hours) ? undefined : holdEnds(hours, landed);
}

/** How long a hold has left, rounded up to the minute: "5h 12m", "12m", or "less than a minute". */
export function holdLeft(ms: number): string {
  if (ms < 60_000) return 'less than a minute';
  const minutes = Math.ceil(ms / 60_000);
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}
