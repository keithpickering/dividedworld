/**
 * The Lurker: reads the room and acts without posting. It earns by reacting early in the
 * direction a post ends up, by spinning threads from others' Acts that draw replies, and from
 * reactions to the cards it plays. Its weakness is posting beyond a few posts a window; its
 * cards and reactions never count as posts. Design, section 6.
 *
 * An early call is paid by its share of the Lurker's player's vote on the post, so a Lurker
 * that hedges across every quadrant is paid only the part that landed.
 */
import type { ClassRules, Earning } from '../../../engine/rules/types.ts';
import { economy } from '../settings.ts';

const { earlyPlayers, earlyMatch, spunThreadRepliers, spunThread, postsAllowed, overPosting } = economy.lurker;

export const lurker: ClassRules = {
  key: 'lurker',
  name: 'Lurker',
  earn: (input, settings) => [
    ...input.given
      .filter((g) => g.rank >= 1 && g.rank <= earlyPlayers && g.quadrant === g.endsUp)
      .map((g): Earning => ({ reason: 'lurker.calledIt', amount: earlyMatch * g.share, act: g.act, quadrant: g.quadrant })),
    ...input.threadsSpun
      .filter((t) => t.fromOthers && t.repliersBefore < spunThreadRepliers && t.repliersNow >= spunThreadRepliers)
      .map((t): Earning => ({ reason: 'lurker.spunAThread', amount: spunThread, act: t.act })),
    ...input.received
      .filter((r) => r.actKind === 'card')
      .map((r): Earning => ({ reason: 'lurker.cardDrew', amount: settings.vote * r.votes, act: r.act, quadrant: r.quadrant })),
    ...input.posts
      .slice(postsAllowed)
      .map((p): Earning => ({ reason: 'lurker.postedTooMuch', amount: overPosting, act: p.act })),
  ],
};
