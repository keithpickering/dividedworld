/**
 * The instance as the database's settings rows have it now: the code's settings, with every row
 * an admin has tuned laid over them. So the season review retunes a vote, a class's bonus or a
 * card's price with a row, never a deploy. The economy row is the whole economy, as buy_card
 * reads it (supabase/migrations/0006_cards.sql), never the code's numbers with the row's laid
 * over them, so the settlement, the Vending Machine and the SQL read the same numbers. An
 * instance the rows would make not whole (a number a class reads missing from the row) is
 * refused, with each problem named, before anything is decided on it: a wrong row stops the
 * settlement and the card actions loudly until an admin fixes it, rather than paying from
 * numbers nobody chose.
 */
import { deepFreeze, instanceProblems, withOverrides } from '../../../engine/rules/instance.ts';
import type { Instance, Settings } from '../../../engine/rules/types.ts';
import type { Db } from './rpc.ts';

/**
 * The instance the rows make, and what is wrong with it: the one reading both callers share. withDatabaseSettings throws the
 * problems; the seed (supabase/functions/seed/core.ts) answers them one by one.
 */
export async function databaseSettingsProblems(instance: Instance, db: Db): Promise<{ readonly tuned: Instance; readonly problems: string[] }> {
  const rows = (await db.rpc<Record<string, unknown> | null>('instance_settings', {})) ?? {};
  // The System's words are their own row (copy), read by the SQL that posts them.
  const { copy: _copy, economy, ...settings } = rows;
  const laid = withOverrides(instance.settings, settings as Partial<Settings>);
  if (economy === undefined) throw new Error('the settings rows hold no economy; seed the instance (supabase/functions/seed/)');
  const tuned: Instance = { ...instance, settings: deepFreeze({ ...laid, economy: economy as Settings['economy'] }) };
  return { tuned, problems: instanceProblems(tuned) };
}

export async function withDatabaseSettings(instance: Instance, db: Db): Promise<Instance> {
  const { tuned, problems } = await databaseSettingsProblems(instance, db);
  if (problems.length) throw new Error(`the settings rows make the instance not whole: ${problems.join('; ')}`);
  return tuned;
}
