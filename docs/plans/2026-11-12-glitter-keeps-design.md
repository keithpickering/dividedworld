# Glitter Bomb keeps: the posts written during the week keep their glitter

Record, written 2026-11-12. A design session with the owner, begun on 2026-11-09: "seems posts made during the week
should keep the glitter permanently, so e.g. all the 'why are my posts glittery' posts still make sense after the week
is up." The plan is `docs/plans/2026-11-12-glitter-keeps-plan.md`.

This changes Glitter Bomb as the card mechanic's design describes it (`docs/plans/2026-11-01-card-mechanic-design.md`,
section 8: "the character's posts sparkle for a week") and widens one mechanism of card notes Part 2
(`docs/plans/2026-11-11-card-notes-part-2-plan.md`): Feelin' Glam's `keeps`, which that plan allows only on a card that
reaches a thread. Everything else in the Shine design (`docs/plans/2026-11-06-shine-design.md`) and the Shake design
(`docs/plans/2026-11-11-shake-design.md`) holds.

## 1. What a Glitter Bomb leaves behind

**Decided.** After its week, a post by the character it was cast on keeps its glitter for good where the post was
written while the play was up: at or after the play's date, and before its end. The posts that character wrote before
the play stop glittering at the end of the week, as every post does today. Nothing is written on any post: whether a
post keeps it is computed from the play's dates and the post's ("Append-only"), by Glam's `fallsOn`.

- **A caught play** never landed, so it leaves nothing.
- **An admin's end** takes the glitter off every post, kept ones included, during the week or after. That is the way
  out, and the way out Glam's design names for its kept level.
- **The masks.** Only public facts are read: the play's dates, the post's date and the post's author, which is the
  character the play landed on. Nothing reads who owns a character.

## 2. The way out, and the rule

The owner's reading of "No player is ever stuck" (2026-11-09): the rule is there so that a post is never made
permanently illegible, not so that every effect can be undone at its author's whim, which would cheapen playing a card.
Glitter is decoration: the words stay readable under it, as they do under Feelin' Fab. The rule as written already
names an admin as a way out ("by themselves within a stated time, by a player's act on the screen where the state
shows, or by an admin"), and Glam's design relies on that, so **this design needs no change to the rule.**

Two things came out of the conversation that are not part of this design:

- **A rewording of the rule** around whether a reader can always reach a post's words (Glitter Bomb and Feelin' Fab:
  always; Autocorrect: by peeling, each load; Whoops!: by washing). Worth having on its own, as a `CLAUDE.md` change,
  which waits on the owner. Open.
- **A caster calling off their own landed Cast.** The owner believed a Feelin' Fab caster could revoke it. No such path
  exists: a landed Cast ends only by its time or an admin's `reverse_card`; `take_back` is for a face-down back. Filed
  as an issue for its own design. Open.

## 3. How it is built: Glam's `keeps`, widened

**Decided** (the owner: "Agree with A"). Alternatives:

- **A. Widen `keeps` to a card that reaches a character as well as a thread** (chosen). One flag, one `fallsOn`, one
  `kept` key in the thread page. Glitter Bomb sets `keeps: true`. Built after card notes Part 2.
- B. Fold it into Part 2's plan before it is built. The same result in one plan fewer, but it widens a plan already
  reviewed and ties Glitter Bomb to Line Cutter's schedule.
- C. A flag of Glitter Bomb's own. Two lists that must agree.

The engine names no card. A cast card whose one reach is a thread or a character, with a time up, may keep.

## 4. How a kept post looks

**Decided** (the owner: "A, good idea"). A kept post loads settled: every flake in place at once, no burst, still
glinting, still catching the cursor and still shaking off on a flick (the Shake design treats it as a Glitter Bomb
post). The burst stays the mark of a live bomb; what is left on old posts reads as what the bomb left behind, and a
reader going through an old thread is not met by a burst on every post. It is the path the effect already takes under
reduced motion and for a post that comes back into view.

Alternatives: a burst on every load, as during the week (a busy week's posts would go off for years, and the burst
would stop meaning a live bomb); a burst once for each reader, then settled (a stored row or browser storage for a
small thing).

## 5. The price

**Decided** (the owner: "A works"). It stays uncommon, at 150 in the machine. What a cast leaves behind is the target's
doing: a character who keeps posting through the week leaves a trail of glittered posts, and one who lies low leaves
almost none. That is the fun of it, and not something the caster buys. Admins can reprice it from the machine screen.
Alternative: 200, Jimmy Wails's price.

## 6. The words

The glass speaks plainly, and the log never bluffs.

- Summary: `Cast on a character. Every post by that character sparkles for a week, and posts written in that time keep it.`
- Describe: `A Pepperoni card, uncommon, cast from any post by the character it lands on. For a week, every one of that
  character's posts sparkles, wherever it is. When the week is up, the posts written during it keep their sparkle for
  good, settled where it landed; every other post stops. It falls on that mask alone. <the set words> It costs nothing
  more to play.`
- The Lens, after the week: the engine's line from Part 2, `Ended <date>. Posts written while it was up keep it.`
- The log: the caster's timed-end line, today `Glitter Bomb on <place> ended.`, says for any card that keeps
  `Posts written while it was up keep it.` (the same gap Glam has). Glitter Bomb's play line, which both the caster's
  log and the target player's log carry, says `Posts that character writes before it ends keep their sparkle for good.`

## 7. A busy instance

A page's read gains one range scan of `play_reach_character` (`(character, ends_at)`) for the page's authors, from the
page's earliest post date. A character carries one Glitter Bomb at a time, each a week, so that scan meets about one
play for each week the page's posts span, for each author; it returns at most 100, as Glam's does. Drawing costs what a
Glitter Bomb post costs today, only for longer: one glitter for each kept post in view, under the page's one loop, which
draws only what is on screen and frees what leaves it. A thread whose busiest week was under a bomb has many glittered
posts, which is the case the loop and Shake's limits (at most 400 flakes in the air) were built for.

## 8. Open

- The rule's rewording (section 2).
- A caster's own end of a landed Cast (section 2, the issue).
- Kept glitter is drawn in the post's thread only. The record page and the profile draw no effects above a post today
  (Part 2's "Decided in planning" says the same of Glam), and that is not changed here.
