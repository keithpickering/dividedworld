/**
 * The instance as the database's settings rows have it now: the code's settings, with every row
 * an admin has tuned laid over them, the economy number by number. So the season review retunes
 * a vote, a class's bonus or a card's price with a row, never a deploy, and the settlement and
 * the Vending Machine read the same numbers the SQL does. An instance the rows would make not
 * whole is refused, with each problem named, before anything is decided on it.
 */
import { instanceProblems, withOverrides } from '../../../engine/rules/instance.ts';
import type { Instance, Settings } from '../../../engine/rules/types.ts';
import type { Db } from './rpc.ts';

export async function withDatabaseSettings(instance: Instance, db: Db): Promise<Instance> {
  const rows = (await db.rpc<Record<string, unknown> | null>('instance_settings', {})) ?? {};
  // The System's words are their own row (copy), read by the SQL that posts them.
  const { copy: _copy, ...settings } = rows;
  const tuned: Instance = { ...instance, settings: withOverrides(instance.settings, settings as Partial<Settings>) };
  const problems = instanceProblems(tuned);
  if (problems.length) throw new Error(`the settings rows make the instance not whole: ${problems.join('; ')}`);
  return tuned;
}
