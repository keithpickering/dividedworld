/**
 * The economy as the server holds it now, for the words that state a class's numbers (the core loop design, section 6, #57): the
 * compiled economy with the numbers `screen_settings` gives laid over it (`ScreenSettings.economy`, 0072), so a description or a
 * line with no numbers of its own says the number an admin has tuned. A key the server did not give, or gave as anything but a
 * number, is the compiled economy's.
 */
import type { Settings } from '../rules/types.ts';
import { withCardEconomy } from './cards/faces.ts';

export function economyNow(settings: Settings, held: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, number>> {
  return withCardEconomy(settings, held).economy;
}

/** The numbers a settled or estimated line's words state: its own where its ledger row holds them, over the economy now. */
export function paramsOf(line: { readonly params?: Readonly<Record<string, number>> }, economy: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  return line.params ? { ...economy, ...line.params } : economy;
}
