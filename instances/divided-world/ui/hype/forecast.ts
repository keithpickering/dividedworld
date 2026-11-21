/**
 * The stage's forecast (docs/plans/2026-11-21-commentary-video-plan.md, Task 4; the design's node 2): what the orbs' hatched ghost shows
 * as a player's pending Aura, scored by the instance's own class rules.
 *
 * The in-memory backend does not compute an estimate: `fake.estimate()` hands back whatever a seed put there. The real function reads the
 * reactions each of a player's characters received and pays them by the character's class, so a Heel's forecast climbs on a tomato and
 * falls on a thumbs up. The stage replaces the fake's `estimate` with one that does that, from the same two things the real one reads:
 * the tallies of the character's posts (public: every reaction counts as anyone's) and the class's own `earn`, which is the game's rule
 * and not a copy of it. Each reaction counts as one vote, as it does when each reactor leaves one on a post. Nothing here sets a number.
 *
 * The estimate is asked again the moment a reaction lands: the page's own throttle holds an ask for the backend's `freshAfter`, which is
 * thirty seconds of the page's time in the fake, so the stage's estimate says it is fresh at once. (The real one is held; a film of
 * thirty-second beats would be a film of waiting.)
 */
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import type { Estimate, EstimateLine } from '../../../../engine/ui/data/api.ts';
import type { ClassInput, Earning, Instance, ReceivedReaction } from '../../../../engine/rules/types.ts';

/**
 * Replaces `fake.estimate` with the class-scored one, for the thread the stage is of. The counts the world seeds on its posts are its backdrop
 * (the settled history a thread already has when a shot opens it), so the forecast counts the reactions since: `rest()` takes the counts as
 * they stand, and is called once the world is seeded.
 */
export function installForecast(fake: Fake, instance: Instance, thread: string): { readonly rest: () => Promise<void> } {
  let backdrop: Readonly<Record<string, Readonly<Record<string, number>>>> = {};
  fake.estimate = async (): Promise<Estimate> => {
    const session = await fake.session();
    if (!session.account) throw new Error('sign in to see your estimate');
    const mine = (await fake.myCharacters()).filter((c) => c.debutedAt !== null && c.retiredAt === null);
    const acts = await fake.acts(thread, 1, 500);
    const tallies = await fake.tallies(acts.map((a) => a.id));
    const quadrantOf = new Map(instance.reactions.map((r) => [r.key, r.quadrant]));
    const now = Date.now();
    const entries: { character: string; reason: string; amount: number }[] = [];
    const lines: EstimateLine[] = [];
    for (const c of mine) {
      const rules = instance.classes.find((k) => k.key === c.class);
      if (!rules) continue;
      const received: ReceivedReaction[] = [];
      for (const a of acts) {
        if (a.character !== c.id || (a.kind !== 'post' && a.kind !== 'spin')) continue;
        for (const [kind, had] of Object.entries(tallies[a.id] ?? {})) {
          const quadrant = quadrantOf.get(kind);
          if (quadrant === undefined) continue;
          const n = had - (backdrop[a.id]?.[kind] ?? 0);
          for (let i = 0; i < n; i++) received.push({ act: a.id, actKind: a.kind, quadrant, at: now, actAt: Date.parse(a.createdAt), kind, votes: 1 });
        }
      }
      const input: ClassInput = { character: c.id, from: now - 86_400_000, to: now, posts: [], received, given: [], held: [], cardsPlayed: [], cardsLanded: [], threadsSpun: [], standings: [], debates: [] };
      const earned: readonly Earning[] = rules.earn(input, instance.settings);
      for (const e of earned) {
        lines.push({ character: c.id, reason: e.reason, amount: e.amount, ...(e.act === undefined ? {} : { act: e.act }), ...(e.quadrant === undefined ? {} : { quadrant: e.quadrant }), at: now });
        const have = entries.find((x) => x.character === c.id && x.reason === e.reason);
        if (have) have.amount += e.amount; else entries.push({ character: c.id, reason: e.reason, amount: e.amount });
      }
    }
    return { entries, lines, crowd: null, asOf: new Date(now).toISOString(), freshAfter: new Date(now).toISOString() };
  };
  return { rest: async () => { backdrop = await fake.tallies((await fake.acts(thread, 1, 500)).map((a) => a.id)); } };
}

/** The sum of an estimate's entries, signed hundredths: what the orbs' ghost shows. */
export const pendingOf = (e: Estimate): number => e.entries.reduce((n, x) => n + x.amount, 0) + (e.crowd?.amount ?? 0);
