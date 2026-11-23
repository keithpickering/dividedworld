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
 * every quadrant is paid only the part that landed. A call is a bet: one that misses (the post
 * ends up in a quadrant other than the vote's) costs what a hit pays, by the same share, under
 * `lurker.misread`, judged in the same window. A post that ties (no leading quadrant) costs
 * nothing. A miss is not a reaction the character received, so it carries no `votes` and Thick
 * Skin does not cushion it. Class balance design, section 5.
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
  /* The crowd floor (docs/plans/2026-11-23-crowd-floor-design.md, section 3) is narrowed to the Lurker's cards. With no quadrant it charges, every reaction
     to its posts would pay the floor, and a fourth post in a window drawing a crowd would outpay the over-posting charge (five fresh voters pay 10 against
     a charge of 10; twenty pay 40), so posting past the allowance would profit. Its cards already pay every reaction (`lurker.cardDrew`), so in practice the
     Lurker earns no floor; this is written as cards, not as nothing, so a later change to its card rule reaches the floor without a second edit. */
  floorOn: (r) => r.actKind === 'card',
  earn: (input, settings) => {
    const [earlyPlayers, earlyMatch, crowd, spunThreadRepliers, spunThread, postsAllowed, overPosting] = READS.map((r) => economyOf(settings, keyOf(r))) as [number, number, number, number, number, number, number];
    return [
    ...input.held
      .filter((h) => h.rank >= 1 && h.rank <= earlyPlayers && h.othersBefore < crowd && h.othersNow >= crowd && h.quadrant === h.endsUp)
      .map((h): Earning => ({ reason: 'lurker.calledIt', amount: earlyMatch * h.share, act: h.act, quadrant: h.quadrant, at: h.reactedAt, fromReactions: true })),
    ...input.held
      .filter((h) => h.rank >= 1 && h.rank <= earlyPlayers && h.othersBefore < crowd && h.othersNow >= crowd && h.endsUp !== null && h.quadrant !== h.endsUp)
      .map((h): Earning => ({ reason: 'lurker.misread', amount: -earlyMatch * h.share, act: h.act, quadrant: h.quadrant, at: h.reactedAt })),
    ...input.threadsSpun
      .filter((t) => t.fromOthers && t.repliersBefore < spunThreadRepliers && t.repliersNow >= spunThreadRepliers)
      .map((t): Earning => ({ reason: 'lurker.spunAThread', amount: spunThread, act: t.act, params: { 'lurker.spunThreadRepliers': spunThreadRepliers } })),
    ...input.received
      .filter((r) => r.actKind === 'card')
      .map((r): Earning => ({ reason: 'lurker.cardDrew', amount: settings.vote * r.votes, act: r.act, quadrant: r.quadrant, at: r.at, kind: r.kind, votes: r.votes, fromReactions: true })),
    ...input.posts
      .slice(postsAllowed)
      .map((p): Earning => ({ reason: 'lurker.postedTooMuch', amount: overPosting, act: p.act, params: { 'lurker.postsAllowed': postsAllowed } })),
    ];
  },
};
