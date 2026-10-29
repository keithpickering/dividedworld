# Clues, not proof: the masks' line, and what follows from it

Record, written 2026-10-29. A design session with the owner after PR #9 (the screens' engine build,
`docs/plans/2026-10-29-screens-engine-plan.md`) merged. Its build left three questions, which the owner answered on the
issues: #10 (the estimate's per-reaction lines), #12 (thread view counts) and #13 (avatar files' write times). The
answers to #12 and #13 moved the line of the rule PR #9 was holding, so the rule is rewritten first and the changes
follow from it. Each question was put to the owner one at a time, with alternatives and a recommendation. The plan is
`docs/plans/2026-10-29-clues-plan.md`.

## 1. The rule: a response never proves a private fact

**Decided:** the rule "A response never varies with a private fact" becomes "A response never proves a private fact"
(CLAUDE.md; its record is `docs/working-rules/a-response-never-proves-a-private-fact.md`). No response may be
*computed from* a private fact (who owns a character, a character's class, who reacted, whether an address has an
account), so nothing the system says can prove one or let a player measure it. What characters do in public, and when,
is play, and the system does not hide it.

The owner, on #12: "There was never any direct evidence that somebody was using multiple accounts, but there are signs:
'one person leaves a room and another enters', so to speak. You never see Superman and Clark Kent in the same room
together. [...] Preserving the anonymity of a player isn't something we're doing because something awful will happen if
they are found out; it's something we're doing because it adds an element of strategy and mystique, something to chew
on." And on #13: "we don't need to necessarily stop this detective work from happening, as long as it's always
deduction, never 100% provable - being able to observe something like this is itself a source of controversy, I.e.
interesting discussion."

The cases that set the line:

| A clue: play, not hidden | Proof: never given |
|---|---|
| When a character posted, edited, reacted, Turned | A count of players where it could count characters (#12's "1 view") |
| An avatar file's write time (#13) | A live amount that halves when the same player reacts again (the screens' design, section 7) |
| A mask dropped the hour a story broke (section 4 here) | A quota shared across a player's masks that someone else can see |
| Which masks read a thread, counted per mask (section 2) | Presence that lights up all of an account's masks at once |
| Writing style, posting hours, who is never online with whom | A refusal or a delay that differs with who owns the target |

A clue the game would rather not give stays a design choice, never the rule's duty: the month-only "Joined", Turns
taking effect at the tally and an invite showing "used" only after a settlement are kept, because they were chosen for
play as well, and none is reopened here.

**The one exception is The System's own scoring.** The settlement reads who reacted and who owns what (one vote per
player, the halving), and shows each player only the settled window's sums. In a very quiet window a sum can still be
read, as the core-loop design's section 4 accepted; the rule names it as the one exception, with no noise added, and
nothing live is computed from a private fact.

Weighed: today's rule with a list of allowed clues (every new clue would need the owner to add it); clues allowed but
blurred (every clue batched or coarsened, which would make an instant drop impossible). For the settled sums: adding
noise or a floor (the log would stop being exact, against "The fiction may lie; the log never does"); calling them a
clue (the rule's text would not match the code).

## 2. Thread views count characters, and earn nothing

**Decided:** a thread's view count is the number of characters that have read it, each counted once; a reader with no
character yet counts once as themselves (the owner, recorded on #12: "Each character that reads a thread counts as a
view. Views are not much of an exploitable metric"). The character is the HUD's at the time of the read, as `mark_read`
already takes it. One player reading through three masks counts three, which is the masks' doing, not the player's. The
count is public to signed-in players.

Which masks read a thread stays private: a view is a private row, never an Act (the screens' design, section 6), and
only the count is shown. The counts still move in hourly batches (`viewCountCron`), now for cost alone: a live count is
a broadcast per read at a busy instance.

**Views earn no Aura, for now.** The owner floated views earning Aura ("it's desirable to have people look at your
posts"), with a player's own characters never paying each other. Weighed against it: a view is passive and costs
nothing, so two friends with six masks each could read each other's threads for Aura, which counting per player would
close only by making reading a scoring input, against the screens' design's "class rules still read no reading". It is
open, for the season review (Open, below).

Weighed: a count of players with a delay or a floor (still proof in a quiet thread); no count.

## 3. The estimate's lines are exact

**Decided** (#10, the owner: "2 sounds like the fixed and/or more accurate version, if so it's approved"): an `Earning`
may name `at`, the time of the one reaction it comes from, and every Divided World rule that pays for one reaction names
it. The live estimate then shows each reaction's own amount at its own time and never apportions a line. A Lurker's call
is shown on the Lurker's own reaction, whole.

How each rule says it:

- A whole vote received or given (`perVote`: the Face's cheer, the Heel's heat, the Jabroni's groan, their weaknesses;
  the Lurker's card drawing a vote): the reaction's own time, already on `ReceivedReaction.at`.
- The Lurker's call: the time of the Lurker's own reaction. `HeldVote.at` is when the crowd arrived, so `HeldVote` gains
  `reactedAt`, the time of the reaction the vote is held through.
- A Face's lift: it pays for many votes on another Act, each a whole vote alike, so it keeps `valuing` and its lines are
  each vote's, which is exact.
- An earning that pays for no reaction (a card landing, a spun thread, posting too much) is one line with no reaction
  time, as now.

An earning with a quadrant that names neither `at` nor `valuing` is shown as one line with no time, never split: the
estimate never says a reaction earned what it did not.

## 4. A new character drops now or debuts at the tally

**Decided:** creating a character offers two timings, each silent or announced, like a Turn's loudness. The owner, on
#12: "sometimes it's instead funnier to create a character the same hour as some news article and start doing a bit
that same day [...] It makes sense to have this be an option when creating a character (instant drop vs. Scheduled
debut) similar to how we have different announcement options for a Turn."

| | Announced | Silent |
|---|---|---|
| **Drop now** | Acts at once; The System posts at once in the season's Turns thread, naming it | Acts at once; its first post is its entrance |
| **Debut at the tally** (today) | Waits; named in the tally | Waits; debuts at the tally, unnamed |

A dropped character is debuted from its creation, so it appears in every list at once, its creation's minute a clue its
player chose. The announcement is a tally Act of one name, written at once and broadcast like the tally, so every
screen that draws a tally draws it. A character waiting to debut may be dropped now, or have its announcement changed,
until the tally. A season's reveal names every character, silent ones included, as it names silent Turns.

The tally's announcement never names a class. **A class revealed by choice is its own design** (below): the owner
raised it while answering this, and it reaches past character creation.

## 5. Avatars: two files, served publicly

**Decided:** an avatar is two files, both public: a portrait crop (from 1:1 to 1:2) and a square crop cut from inside the
portrait. The uncropped original is no longer kept. The owner: "Is storing only two versions (square crop, portrait crop)
an option? Portrait crop can probably be done at upload time, and then a square crop can be made based on the portrait
one. I think it's unlikely that someone would want elements visible in their 1:1 version that are not visible in the
1:2."

- The portrait is stored larger than the postbit draws it, up to 512 wide and 1024 tall, so a square that zooms into it
  stays sharp. The square stays a small file of its own (256 by 256), so lists load no portraits.
- A recrop of the square is cut in the browser from the public portrait, with no upload. A new portrait is a new upload,
  from the player's own copy.
- A profile written before this change keeps its files, and its original is removed: what a player cropped away is no
  longer stored anywhere. A profile with a square and no portrait keeps it, the square filling the tall slot, until its
  player uploads again.
- The `avatars` bucket is public again, by URL alone. Its files' names are random, the bucket cannot be listed, and a
  file's write time is a clue (section 1). Someone not signed in sees an avatar only through a link a player shared.
  Files are served straight from Storage's CDN and cached for good, since a name never changes its bytes.
- Files no row names (a replaced avatar's removal that failed, a write whose answer was lost, the originals above) are
  swept: an operator's tool removes every file in the bucket that no profile names and that is older than an hour, so a
  file stored a moment before its profile is written is never taken.
- A character's first avatar locks the character, so two first uploads at once are one after the other and the second
  reports the first's files as replaced (#11).

Weighed: the original kept private in a bucket of its own, shown to its player by a signed link (the owner proposed
not keeping it); the original public beside the crops (cropping would hide nothing). For serving: signed links for
signed-in readers (a signing request per page of avatars), a function in front of the bucket (a call per uncached
avatar). The answers to #4 kept boards, threads and Acts for signed-in players; an avatar's URL is the one thing a
signed-out person can open, and only when given it.

## 6. Folded in from #11

The owner chose to fold in the follow-ups that touch what this design changes, and to write the screen ones into the
web plan; the rest stay on #11.

- **`set_avatar`'s first-avatar lock** and **the sweep of unnamed files**: section 5.
- **Whoops! states saved in 0006's stroke shape.** A stroke of 0006's shape has no `tool`, and its "down" is a fraction
  of the post's height, which cannot be turned into widths of the fixed layout without the post's laid-out height,
  which only a browser knows. So a migration moves each such state under `legacy` with no strokes: the splat and its
  ink are untouched, the author's old strokes are kept for an admin and no longer drawn, and the author's next save
  starts clean. Nobody is stuck: a save with new strokes or `clean: true` is accepted, as it is now. Whether dw.gripe
  holds any such row is for the owner to look at, since no build session reads a deployed database.
- **`next_settlement_at`'s cap at the season's end**, never driven red: a check that puts a season's end inside the
  open window, with its poison.
- **For the web plan:** the HUD asks for the estimate when it opens, when a reaction lands on one of the player's own
  Acts, and after the player's own reaction (a line they earn by reacting, the Lurker's call, otherwise waits), never on
  a timer, and once more at `freshAfter`; a Turn whose `takes_effect_at` is null says "at the next settlement".

Left on #11: a Storage body that stalls, SQL test files that run only in order, ICC profiles in avatars, and its two
small notes.

## 7. The layers

Everything here is engine (SQL, `engine/rules/`, the avatar and estimate functions, the tools) except each class's
`at` and `reactedAt` reads (`instances/divided-world/classes/`), which plug into the `Earning` and `HeldVote` interfaces.
The drop announcement's words are the web plan's and the instance's, as the tally's are; the engine stores only its
names.

## Open

- **A class revealed by choice, and whether the season's reveal shows every class.** The owner, answering section 4:
  "It could be that the 'reveal' is a tracked event/act for a character, where their class becomes publicly known from
  that point forward until they Turn. It could be known from the start, or it could be something they try to play
  close to the chest, and losing it is a dramatic event. They might have to reinvent themselves as a new character to
  keep that strategy up. Very high stakes stuff. This also raises the question of whether classes should be revealed
  automatically at season end (as I believe we planned) or if the secret should be allowed to roll over, with 'how did
  that person get so much aura by being such an ass?' being a clue instead of a stated fact." Its own design session,
  filed as #14; it could add "announced with its class" to creation and Turns at once.
- **Views earning Aura** (section 2), for the season review.
