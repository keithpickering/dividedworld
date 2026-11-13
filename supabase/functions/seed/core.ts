/**
 * The seed, as a pure module: write the instance with seed_instance, then prove the rows whole with the same reading every
 * settlement and card action makes (withDatabaseSettings), so a seed that leaves an instance those would refuse answers 422 here,
 * and the release goes red before the site moves.
 *
 * Which failures are which: a refusal the database gave (a DatabaseError below 500: the SQL function raised, or PostgREST
 * rejected the call) is a fact about the seed and answers 422, which the release does not retry. Anything else, a TransportError or
 * a 5xx from PostgREST, is the platform failing and is rethrown so the function answers 500, which the release retries.
 */
import type { Instance } from '../../../engine/rules/types.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { databaseSettingsProblems } from '../_shared/settings.ts';
import { instanceSeed } from '../_shared/seed.ts';
import { conduct } from '../_shared/instance.ts';

export async function runSeed(db: Db, instance: Instance): Promise<{ status: number; body: unknown }> {
  let counts: unknown;
  try {
    counts = await db.rpc('seed_instance', { payload: instanceSeed(instance, conduct) });
  } catch (e) {
    if (e instanceof DatabaseError && e.status < 500) return { status: 422, body: { error: e.message } };
    throw e;
  }
  const { problems } = await databaseSettingsProblems(instance, db);
  if (problems.length) return { status: 422, body: { error: 'the seeded instance is not whole', problems } };
  return { status: 200, body: counts };
}
