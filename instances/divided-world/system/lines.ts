/**
 * Stock lines: what the staff say at each standing order when a model call is out of budget
 * or fails (design, section 2), so cost never grows without bound and nothing stalls. In the
 * board's world, so they may bluff; they carry no fact the glass does not show plainly. Each key
 * may use only the tokens the engine gives it (engine/system/stock.ts): `{move}` a move's plain
 * name, `{boss}` a Boss's name, `{board}` a board's name, `{rule}` a rule's number and words. Where a line may use `{boss}` or `{mod}`, it may add that staff
 * character's pronouns, filled from its own set: `{mod.they} {mod.them} {mod.their} {mod.theirs} {mod.themself}`, each capitalized too
 * (`{mod.They}`), and the verbs `{mod.is} {mod.was} {mod.has} {mod.does}` and `{mod.s}` ("{mod.they} {mod.is}" reads "they are" or
 * "it is"); `{boss.they}` and the rest likewise. A reporter's or an appellant's are never tokens. Several lines a key, so one is not
 * heard every time.
 */
import type { StockLines } from '../../../engine/rules/types.ts';

export const stockLines: StockLines = Object.freeze({
  moveLanded: Object.freeze([
    'It is done: I have decided on {move}. I do not take questions.',
    'Effective immediately: {move}. Please remain calm and keep posting.',
    'I have decided on {move}, and I feel good about it.',
  ]),
  moveMet: Object.freeze([
    'You did it, and so {move} is over. I am not proud. I am merely satisfied.',
    'The demand was met and {move} is lifted. Do not let it go to your heads.',
    'Fine. As of now, {move} ends. Well performed. Do not get used to it.',
  ]),
  moveExpired: Object.freeze([
    'Nobody did anything, so {move} has run its course. I am not disappointed. I am a little disappointed.',
    'Time is up: {move} is over. I was going to do something about that, and now I will not.',
    'As of today, {move} has expired. I have already moved on to something I will like more.',
  ]),
  moveReversed: Object.freeze([
    'A higher power has stepped in and {move} is undone. I have been overruled, and I would like that noted.',
    'It turns out {move} was a mistake. I stand by it, and it is also over.',
    'Management has intervened: {move} is reversed. I would like a word with Management.',
  ]),
  moveSuperseded: Object.freeze([
    'A new era has begun, and {move} has been filed under things the last Boss did. It is over.',
    'I have looked at {move} and decided it was somebody else\'s idea. It is set aside.',
    'Regime change: {move} did not survive the handover. My regards to whoever thought of it.',
  ]),
  // A favor whose check came and the demand was not met: the group is taken back. `{move}` names the group by its name. DRAFT for the owner.
  moveUnmet: Object.freeze([
    'The check came and the demand was not met, so {move} is withdrawn. I am not surprised. I am a little surprised.',
    'Time was called and nothing was done: {move} is over. The favor was a loan, and I am collecting.',
    'Audit complete, and {move} does not survive it. I expected more, and I have written down exactly how much.',
  ]),
  // A move overturned on appeal. DRAFT for the owner.
  moveOverturned: Object.freeze([
    'On appeal, {move} is overturned. I would like it noted that I was right and have been outvoted.',
    'The appeal succeeded and {move} is undone. I accept this the way a cat accepts a bath.',
    'So {move} did not survive its appeal. I have filed a grievance against the appeal.',
  ]),
  bossFarewell: Object.freeze([
    '{boss} is leaving the building. Please stop clapping.',
    'This season belonged to {boss}. {boss} regrets nothing and will say so at length.',
    '{boss} has cleared out the desk. The stapler, it is said, was not returned.',
  ]),
  bossArrival: Object.freeze([
    '{boss} is your Boss now. Nobody asked you, and nobody will.',
    'Make way for {boss}, who has read the file on every one of you and found it thin.',
    '{boss} has taken the seat. The seat is warm. Nobody wants to talk about why.',
  ]),
  boardDescription: Object.freeze([
    'Welcome to {board}! Posts go here. Posts also go elsewhere. The staff have decided this is the better one.',
    '{board}: a board. Please be nice, or at least be interesting.',
    'The staff were told to describe {board} and have chosen to give you a feeling instead.',
  ]),
  // A rule landing: `{rule}` is the engine's words for it, `{board}` the board's name. DRAFT for the owner.
  ruleSet: Object.freeze([
    'New law on {board}. {rule}. I expect compliance, and I will notice either way.',
    'Be advised, {board}. {rule}. It is written down now, so nobody can say they were not told.',
    'The pile on {board} grows by one. {rule}. I regret nothing.',
    'A staff member has had an idea about {board}, and the idea is now law. {rule}. Do not look at the staff member.',
    'Attention, {board}. {rule}. This was not a suggestion, though it was phrased like one in the meeting.',
    'The rulebook for {board} grew by one. {rule}. The rulebook has never once been read all the way through.',
  ]),
  // A Mod arriving on a post, and filing it. `{rule}` is the rules charged, in the engine's words. DRAFT for the owner.
  visitArrived: Object.freeze([
    '{mod} has taken an interest in this post, on a charge of {rule}. {mod} will be back.',
    'This post is now under inspection by {mod}, who suspects {rule}.',
    '{mod} is looking at this post. The charge is {rule}. {mod} takes a long time over these.',
    '{mod} has arrived with a clipboard and no explanation, and suspects {rule}.',
    'Nobody panic. {mod} is only standing next to this post and breathing, and thinking about {rule}.',
    '{mod} has opened a file on this post. Page one reads {rule}. There is no page two yet.',
  ]),
  visitFiled: Object.freeze([
    '{mod} has finished with this post and found it in violation of {rule}.',
    'Inspection over. {mod} files this post under {rule}.',
    '{mod} found this post in violation of {rule}, and has written it down.',
    '{mod} has stamped this post. The stamp says {rule}, and the stamp is heavy.',
    'Case closed by {mod}, with the finding {rule}. {mod} has already forgotten how {mod.they} felt about this.',
    '{mod} came, saw and filed. The finding is {rule}, and {mod} would do it again.',
  ]),
  // A report dismissed (the Aura is spent, the Mod grumbles) and one that backfired on the reporter. DRAFT for the owner.
  reportDismissed: Object.freeze([
    '{mod} has read {reporter}\'s report and dismissed it. {mod} would like it known that reading is not free.',
    'Report dismissed. {reporter} may have the receipt, which is this sentence.',
    '{mod} sighs at {reporter}\'s report, files it where reports go, and goes back to the other thing.',
    '{mod} looked everywhere in that post for what {reporter} described and found only a post. Dismissed.',
    'Thank you, {reporter}, for your report. It has been received, considered for one whole second, and set down gently.',
    '{reporter} reported it. {mod} checked it. It was fine. {mod} is now slightly less fond of {reporter}.',
  ]),
  reportBackfired: Object.freeze([
    '{mod} has read {reporter}\'s report and has a few things to say about wasting the staff\'s time.',
    '{mod} noticed who sent that report, {reporter}. {mod} is in a mood.',
    '{reporter} reported, and {mod} read it, and now {mod} is reading {reporter} instead.',
    '{reporter}\'s report has been returned to sender, with interest. {mod} added a note in the margin.',
    'It is a bold thing, {reporter}, to bring {mod} a report like that. {mod} admires it and is about to ruin it.',
    '{mod} turned {reporter}\'s report over, and the problem was on the other side.',
  ]),
  // What a hearer says when it has no words of its own for a ruling on an appeal. DRAFT for the owner.
  appealOverturned: Object.freeze([
    '{mod} has reconsidered {appellant}\'s appeal and is, regrettably, wrong. The Aura goes back.',
    'Appeal granted. {appellant} may tell everyone, and {mod} will pretend not to listen.',
    '{mod} looked again at what {appellant} was charged with, and could not find it. Overturned.',
    '{appellant} made a good point, and {mod} has agreed to forget who made it. Overturned.',
    'Well. {mod} has read the appeal twice and the ruling once, and one of them does not hold. Overturned for {appellant}.',
    'Overturned. {mod} would like {appellant} to know this changes nothing about how {mod} feels.',
  ]),
  appealUpheld: Object.freeze([
    '{mod} has read {appellant}\'s appeal in full and finds nothing to change.',
    'Appeal denied. {mod} wishes {appellant} well in the meantime.',
    '{mod} upholds the ruling. {appellant}\'s plea has been filed with the other pleas.',
    '{mod} gave {appellant}\'s appeal a fair hearing, and the hearing went the way hearings go. Upheld.',
    'The ruling stands. {appellant} is welcome to feel strongly about it.',
    '{mod} admired the effort of {appellant}\'s appeal. The ruling is upheld. The effort has been noted.',
  ]),
  appealReduced: Object.freeze([
    '{mod} has taken some of it back for {appellant}. Not all of it. Some.',
    'Reduced on appeal. {appellant} should consider this a gift, and {mod} should be thanked.',
    '{mod} splits the difference with {appellant}, in {mod}\'s own favor.',
    '{appellant} argued well enough for a discount. {mod} has applied it. {mod} does not do refunds.',
    'A compromise, courtesy of {mod}: less than before, more than {appellant} wanted.',
    '{mod} sanded the edges off {appellant}\'s punishment. The middle remains.',
  ]),
  appealIncreased: Object.freeze([
    '{mod} has heard {appellant}\'s appeal, and it was a mistake to make it. Increased.',
    'Appeal heard, and the punishment grows. {appellant} asked for a closer look and got one.',
    '{mod} looked again at {appellant}\'s case and found more of it. Increased.',
    '{appellant} appealed, and {mod} read the whole file this time. Increased.',
    'You asked for a second opinion, {appellant}. {mod}\'s second opinion is worse than the first.',
    'Increased. {mod} would like {appellant} to treat this as a learning opportunity, mostly for {appellant}.',
  ]),
});
