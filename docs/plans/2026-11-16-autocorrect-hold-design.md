# Autocorrect's hold

Record, written 2026-11-16. A design session with the owner, started from the owner's note that Autocorrect "is rather
underpowered, trivial to mess up even by removing a strip partway". It refines `docs/plans/2026-11-11-autocorrect-tape-design.md`
(the tape, its peel and peek, and the half peel it saves), whose sections all still hold except where this design says. The plan is
`docs/plans/2026-11-16-autocorrect-hold-plan.md`.

## 0. Where it starts

The tape design's principle is that what a removal costs grows with how long it lasts and how many people see it. The author's peel
lasts forever and everyone sees it, yet it costs a few seconds of careful dragging, and a half peel already shows the covered words.
The card pays off while readers see the replacement in context, which is mostly in the hours just after it lands, and that is exactly
when the author can take it off. So the card is easy to undo at the one time it matters.

## 1. The hold

**Decided** (the owner chose a flat hold of 24 hours, over a short one of an hour or two and one that grows with the characters
covered):

- **What it is.** For `autocorrect.holdHours` hours after a play lands, the post's author cannot save anything on that play: no
  whole peel, no half peel, no `clean`. After the hold, the tape design's peel applies unchanged.
- **When it counts from.** The play's own landing time (the card Act's `created_at`, a play's `playedAt` on the screens). It is public
  and never changes. A play that is drawn later than it lands (a set card's spring lays a new play, with its own time) holds from
  that play's own time.
- **Stacks.** Each play holds from its own landing. Only the top strip of a stack can be peeled (the tape design's section 8), and the
  top is the newest play, so in practice the top layer's hold is the one an author meets.
- **The setting.** `autocorrect.holdHours` is an economy number, whole, from 0 to 168, at 24. 0 turns the hold off. It is economy and
  not a card setting because the server reads it to refuse a save, and the screens read it to say when the hold ends; both read the
  economy (the settings rows hold the whole economy, `supabase/functions/_shared/settings.ts`).
- **No exemption for a caster who is also the author.** Whether a play's caster and the post's author are one player is a private fact.
  An exemption would make the answer to a save differ with it.

Weighed: a slower peel at first (a smaller `give` and `pace` that ease off over time), which a determined author still gets through,
so it would not answer the note; a short flat hold, which leaves the tape gone before most readers come by; a hold that grows with
the characters covered, harder to say in a sentence and nearly nothing for a one-word play on a long post.

## 2. Edits

**Decided** (the owner: "Edit is fine"): the author's other way out stays as it is. Editing the phrase away is one public edit, kept
in History, and a strip follows the post's words as the tape design says. The hold does not touch edits.

## 3. Where it is enforced

**Decided by the session**, inside "a game rule is decided on the server; the client only previews":

- **The engine** gains one optional rule on a card that keeps state: `stateHeldUntil(settings, landed)`, the time before which the
  post's author's saves on a play are refused, or nothing when there is no hold. It names no card.
- **The act function** (`supabase/functions/act/core.ts`), on a save, reads the play's landing time when the card has the rule and
  refuses a save made before the time the rule gives. The landing time cannot change, so checking it before the write leaves no race
  that matters: a save one moment early is refused, one moment late is kept.
- **The read** is one new plain SQL function, `play_landed_at(play)`, next to `card_of_play` (`supabase/migrations/0006_cards.sql`).
  The landing time is public. `effect_state` and `save_effect_state` are unchanged.
- **The refusal** is the same for every caller and comes before the database's author check, so it says nothing about who wrote the
  post: "This tape is stuck on until 2026-11-17 15:14 UTC. It can be peeled after that." (the time as `refusalTime` writes it).

Weighed: the check in `save_effect_state` (a second place that would need the setting from the economy row and the card's key, so the
engine's rule would be written twice, once in SQL); a `heldUntil` stored on the play when it lands (a new column, and a setting
changed later would not reach plays already held).

## 4. The screens

**Decided** (the owner chose the quiet way: the countdown in the Lens and the anchor only, over a note on the post at the strip, and
over tape that will not move for the author):

- **During the hold the author's hands peek.** On a held play's strips, the author's drag or held key lifts the tape to read under it
  and lays it back down, exactly as a reader's does (the tape design's section 7). No peel starts, nothing is saved, and the tape never
  tears.
- **Nothing on the post says so.** No note at the strip.
- **The Lens's ends for the author** while any strip on the post is held: "Stuck on for 5h 12m. After that you can peel strips off
  for good: hold one end until it lifts, then pull slowly. Pull too fast and it tears." Once nothing is held, the tape design's
  words. With a stack held to different times, the latest time a strip that is still on the post holds to.
- **The anchor's name for the author** on a held strip: "Autocorrected text: “Luigi”. Stuck on for 5h 12m. Hold Enter or Space to
  lift it and read under it".
- **The countdown** is whole hours and minutes ("5h 12m", "12m", under a minute "less than a minute"), and the screen moves it on once a
  minute. When the hold ends on a screen that is open, the hands start peeling with no reload.
- **Readers** see nothing new. The countdown is drawn only where the screen's own `reader.author` is true, computed on the reader's
  screen from their own characters, as today.
- **The card's description** gains: "The author can't peel any of a play's tape for the first 24 hours after it lands." (with the
  setting's number). The log line of a play gains the same in the log's words: "Its author can't peel it for 24 hours."

## 5. Ways out

| State | Way out |
| --- | --- |
| A strip held | It ends by itself, `holdHours` after its play landed; the author edits the phrase away; a reader peeks, the author too; Quote, History and the Lens show the words. |

Every way out the tape design's section 15 lists after the hold is unchanged.

## 6. The masks

- The hold is computed from the play's landing time and a setting, both public.
- The refusal is the same words for every caller, before the author check.
- The countdown is computed on the author's own screen from `reader.author` and the play's public time. Nothing is sent.

## 7. A busy instance

- One small read by primary key per save of a card with a hold. Saves are already debounced to one at a time per play on the screen.
- The screens add one timer per autocorrected post that the author is looking at while a hold runs, ticking once a minute, and none
  otherwise.

## 8. What it changes for plays already held

No change to any table. A play less than `holdHours` old when this ships is held from its landing at once; states already saved on it
stay as they are, and the author's next save waits for the hold. A deployed settings row lacks the new key until the release's seed
adds it, which the seed does for keys it lacks.

## Open

- Whether 24 hours is right is judged in play; it is a settings row.
