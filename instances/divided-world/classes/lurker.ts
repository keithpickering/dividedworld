/**
 * The Lurker: reads the room and acts without posting. It earns by reacting early in the
 * direction a post ends up, by spinning threads from others' Acts that draw replies, and from
 * reactions to the cards it plays. Its weakness is posting beyond a few posts a window; its
 * cards and reactions never count as posts. Design, section 6.
 *
 * An early call is paid once the post has a crowd: in the window in which enough other players
 * have reacted, by where the post leans then without the Lurker's own vote (the owner's answer
 * 15, on #4), so a Lurker reacting first to sixty fresh posts earns nothing from that alone. It
 * is paid by its share of the Lurker's player's vote on the post, so a Lurker that hedges across
 * every quadrant is paid only the part that landed.
 */
import type { ClassRules, EconomyRead, Earning } from '../../../engine/rules/types.ts';
import { economyOf } from '../../../engine/rules/cards.ts';

/** The Lurker's numbers, in the order its rules read them: one list, which its `reads` is too. */
const READS: readonly EconomyRead[] = [
  { key: 'lurker.earlyPlayers', whole: true, min: 1 }, 'lurker.earlyMatch', { key: 'lurker.crowd', whole: true, min: 1 },
  { key: 'lurker.spunThreadRepliers', whole: true, min: 1 }, 'lurker.spunThread',
  { key: 'lurker.postsAllowed', whole: true, min: 0 }, 'lurker.overPosting',
];
const keyOf = (r: EconomyRead) => (typeof r === 'string' ? r : r.key);

export const lurker: ClassRules = {
  key: 'lurker',
  name: 'Lurker',
  reads: READS,
  earn: (input, settings) => {
    const [earlyPlayers, earlyMatch, crowd, spunThreadRepliers, spunThread, postsAllowed, overPosting] = READS.map((r) => economyOf(settings, keyOf(r))) as [number, number, number, number, number, number, number];
    return [
    ...input.held
      .filter((h) => h.rank >= 1 && h.rank <= earlyPlayers && h.othersBefore < crowd && h.othersNow >= crowd && h.quadrant === h.endsUp)
      .map((h): Earning => ({ reason: 'lurker.calledIt', amount: earlyMatch * h.share, act: h.act, quadrant: h.quadrant })),
    ...input.threadsSpun
      .filter((t) => t.fromOthers && t.repliersBefore < spunThreadRepliers && t.repliersNow >= spunThreadRepliers)
      .map((t): Earning => ({ reason: 'lurker.spunAThread', amount: spunThread, act: t.act })),
    ...input.received
      .filter((r) => r.actKind === 'card')
      .map((r): Earning => ({ reason: 'lurker.cardDrew', amount: settings.vote * r.votes, act: r.act, quadrant: r.quadrant })),
    ...input.posts
      .slice(postsAllowed)
      .map((p): Earning => ({ reason: 'lurker.postedTooMuch', amount: overPosting, act: p.act })),
    ];
  },
};
