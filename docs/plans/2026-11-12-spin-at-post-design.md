# A spin from a card on a character shows the post it was spun at

Record, written 2026-11-12. A design session with the owner, who showed a thread on the deployed instance spun from a
Glitter Bomb: "A spin from a play that affects a character links to the character profile, although the spin in this
case was made from a post inside a thread. [...] it would be nice to display the actual post 'as it landed' and see the
glitter there." The plan is `docs/plans/2026-11-12-spin-at-post-plan.md`.

This widens the origin place (`docs/plans/2026-11-04-origin-place-design.md`) and a play's moment
(`docs/plans/2026-11-03-effect-history-design.md`, section 4). It does not depend on kept glitter
(`docs/plans/2026-11-12-glitter-keeps-design.md`), which is designed and planned and, on this date, not built: a moment
holds the play as it stood, so the box shows the glitter whether or not the post keeps it in its thread.

## 0. What happens today

A thread spun from a card play has that play's Act as its origin. For a play cast on a character:

- the place is the character (`thread_open.origin_place`, `0152_origin_place_board_now.sql`), so the head reads
  "Spun from Glitter Bomb on <name>" and the phrase goes to `/c/<id>` (`engine/ui/spin/place.ts`);
- the ORIGIN box draws the play's mark alone and no post (`engine/ui/spin/Origin.tsx`: `cardPlay.reach ? null : ...`);
- the play does hold a post: `target_act_id` is the post whose postbit took the card (`0055_card_reach.sql`, which says
  it is there "so 'Go to post' and a spin's ORIGIN box still have a post"). Nothing reads it for the box;
- the post the spinner pressed Spin on is recorded nowhere. The mark sits on the postbit of every post by that
  character (`engine/ui/thread/Post.tsx`, `characterMarks`), and `spin` takes the origin Act alone;
- no moment is taken for a play beyond a post (`take_play_moment`'s trigger and `play_moment` are for a play on a post),
  and a moment never draws a play above the post, only names it (`momentParts`).

## 1. Which post

**Decided: both** (the owner: "the cast-from post is what inspired the glitter, but it's not what inspired the spin.
The spinner may see a post they've never read in their life inside the spin they made"). The box leads with the post
the spinner pressed Spin on, and the head names the cast-from post.

Alternatives: the cast-from post alone (already recorded, and the same box for every spin of one play, but it can show
the spinner a post they never read); the pressed post alone (loses what the glitter was cast at).

**A spin records the post it was pressed on.** A spin made from a character play's mark on a postbit carries that post
on its own Act, written with the Act and never after ("Append-only"). The server takes it only where the origin is a
play on a character that landed (not caught), the post is a post by that character, and the play is up when the spin
is written (its time has not run out and no admin has ended it). Every one of those is public. A refusal says
`that card is not on that post`, the same words whichever check failed.

**Decided in planning.** It is built for any card cast on a character; the engine names no card. A thread's play and a
board's play have their marks on the thread's title and the board, with no post under the press, so their spins are as
they are today: the mark alone. That is section 8's first open item.

## 2. What the box shows

**Decided: the pressed post as it was when spun** (the owner chose it over the post as it reads now with the glitter
held on, and over both posts as moments). The post's words at that moment, every effect on it then, and the origin
play drawn on it, still. It never changes, as a spin from a play on a post never does. A link leads to the post as it
is now.

- **The origin play is drawn.** A moment today names a play above the post and never draws it, "since its moment isn't
  one post's". The moment's own play is the exception this design adds: the box is about that play on that post, so its
  card's effect is drawn in its `still` form (for Glitter Bomb, every flake landed, at rest, from the public seed, the
  same on every device). Every other play above the post then is named in words, as today.
- **A byline.** Above the words: the author's avatar and name, linked to the profile (section 4), and the post's date.
- **A hidden version stays hidden.** The moment serves the version as `acts_public` shows it (`public_payload`, as
  `play_moment` has since `0340_conduct.sql`), so words an admin hides later leave the box too.

## 3. Spins already made

They hold no pressed post, the owner's exhibit among them. For those, and for any spin of a character play that names
no post, the box shows **the cast-from post as the play landed on it**.

That needs a play's moment for a play cast on a character. From this change on, the snapshot is taken when such a play
lands (the post's version, and the layers on it with what each had saved). A play made before has none and is answered
as plays older than the snapshot table already are: the version current at the play's time, from the post's edits, and
itself alone, with "What else was on the post then wasn't recorded."

The Lens's As it landed is still offered only for a play on a post. Whether a character play's Lens row should offer
it is section 8's second open item.

## 4. The head, and its links

```
ORIGIN · Spun from Glitter Bomb on [avatar] Wario, at #31 in Why are my posts shiny · as it was spun
Cast from #12 in Kart tier list
```

**Decided** (the owner: "Let's make the character name a link to their profile, ideally the avatar too - and this
behavior should most likely be consistent throughout the UI").

- The character's name is a link to the profile, and in the box its avatar is inside that link.
- "#31 in Why are my posts shiny" is a link to the pressed post as it is now.
- "Cast from #12 in ..." is a second line, in the box only, and a link to that post.
- A spin with no pressed post reads "Glitter Bomb on [avatar] Wario, cast from #12 in ..." on one line, and says
  "as it landed".
- The board's thread list draws the same phrase with the same two links, without the avatar and without the second
  line (**decided in planning**: the row is one small line under a title, and it already carries the starter's and the
  last poster's avatars). One function draws the phrase for both, as today (`OriginLink`).

**Scope, named and split** (the owner: "Two plans"). Linking every character's name and avatar to the profile on every
screen is a sweep wider than this change. This plan adds the one shared piece, a character's name and avatar as one
link to the profile, and uses it in the ORIGIN box. A second design and plan moves every other screen onto it, with a
build check so a new screen cannot draw a bare name. That design has questions of its own: The System's own posts,
a character not yet debuted, names inside the log's lines and inside alerts.

## 5. The masks

- **The spin's post** is a public Act's public fact, like its origin. The check reads the play's reach row, the post's
  author and the play's end: no owner, no class.
- **The refusal** is one sentence for every failed check, computed from public facts, so it proves nothing private and
  its timing does not differ with who owns the character.
- **The moment** is the same bytes for every reader, as `play_moment` is: nothing reads who is asking.
- **The thread row's place** gains the two posts' thread, title and place number, each a public fact of a public post.
- **A clue, not a leak:** which of a character's posts a spinner was reading when they spun is something that mask did
  in public, like a quote.

## 6. Ways out

No state is added to a player, a character or a post. The box is a view. A spin refused for its post can be made again
with no post, or from the mark on another post. A moment that cannot be read says so with Try again, as today.

## 7. A busy instance

- **Writing:** one snapshot row for each spin that names a post, and one row for each layer on that post then (a post
  carries a handful). One more snapshot for each play cast on a character. Neither grows with the thread or the
  instance.
- **Reading the moment:** probes by primary key and by the snapshot's keys, and `play_reach`'s three indexes bounded
  to the plays live then, as `play_moment` measures today.
- **The thread row:** `thread_open` gains three joins by primary key that are met only by a thread spun from a play
  on a character, and are null probes for every other row. On a board's deep page the skipped rows are computed too
  (`0152`'s header measures this for the board branch); the plan's test measures it again with half the threads spun
  this way.

## 8. Open

- A spin from a thread's or a board's play still shows its mark alone.
- Whether a character play's row in the Lens offers As it landed, now that the moment exists for it.
- **Kept glitter.** Once a post keeps its glitter after the week, a reader may want to spin from a kept post's mark.
  This design's check takes a post only while the play is up. Whichever of the two is built second widens the check to
  a kept post (`fallsOn`); the plan's Review focus names it.
- The sweep of every screen onto the shared name link (section 4), for its own design.
