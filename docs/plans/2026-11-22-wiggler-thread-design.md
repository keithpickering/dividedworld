# The thread under the commentary video: design

Record, written 2026-11-22. A script pass with the owner, on the commentary video (#927). The owner: "it's not enough for
the thread underneath to just be scattered test posts: we have to tell a story, a real petty and outrageous forum
debate, with chances to show our associated mechanics in action." The owner wrote the thread; this record adds the
cards, the Mod activity and the cut against the v4 narration (`instances/divided-world/ui/hype/commentary.ts`, unchanged)
and `instances/divided-world/ui/hype/cutlist.json`. It follows section 11 of
`docs/plans/2026-11-21-commentary-video-revision-design.md`. Every mechanic named was checked as built on main at b4f12f1
unless it is marked otherwise. Nothing here changes the game, and no take is filmed by this change.

The board is **Arts & Crafts**. That puts the thread on QC-1000's beat, and it lets two of the second rehearsal's real
lines land on it word for word (marked **REAL**). The other staff words are marked **GENERATED** (section 5): the
engine's own prompt for that call, built from this thread, answered by one light-tier take and passed through the
engine's repair.

---

## 1. The story in one breath

Snuckles posts an earnest sprite sheet. Hotel Bro, a Heel, insults it for the Aura. A polite 👍 drives him into a rage,
and the Mods can't touch him: Chadluminum reports him and a Hall Pass bounces the visit. A Goomba takes his bait and
gets locked out by So Very Happy. A Goomba spins a complaint thread and gets chaired again, and his report is
dismissed with his Aura spent. Meanwhile the staff punish the wrong people. Snuckles takes a filing for D-Guy's horny
post through a card he thought was nice. QC-1000 posts a review of the sheet nobody asked for. Chadluminum, the Face
who glazed everyone, fails a quiz, gets filed twice, and turns Heel in despair. Serious Deer gets filed for the one dry
thing he said. Everyone leaves, and the one who did the most damage leaves the happiest.

The Mods are the escalation. Every player who turns to the staff for justice gets punished for it, and the only one
they never touch is the man everyone wants them to touch.

---

## 2. The thread

`#n` is the post number on screen. New lines are marked *(new)*. Plays and Mod moves are indented under the post they
land on, in the order they land, which is not always the order of the posts.

**#1 Snuckles** — *Look At My Wiggler Sprites*
> Hi divided world, it's ya boy Snuckles here with my first ever sprite sheet. He's an original character I invented
> after I saw him in a Mario game.
> [wiggler-sheet.gif]
> Let me know what you think!

- **Graffiti**, later: the wall fills with critique. Arrows and circles at the shading, a "??", a heart, one face, a
  scribble-out. This is the varied-shapes graffiti the owner asked for, now with a reason to exist.

**#2 Shy Guy Fieri** — Good job! Looks cool
**#3 A Goomba** — Not too shabby
**#4 Irock** — I'll use it in my game!
**#5 D-Guy** — The walk looks like it was hard to make 💪

(Fire, hearts and a Feelin' Fab or two are scattered through #2–#5, the nurturing environment of node 3.)

**#6 Hotel Bro**
> OF COURSE YOUR SPRITES LOOK LIKE THIS WITH THOSE STEAMBOAT WILLIE ASS FINGERS

- 🍅 ×5, then a single 👍. The 👍 lands right after #7, so a viewer suspects Snuckles and nothing confirms it. Who
  reacted is private, which is the joke, and it's what makes #8 funny.

**#7 Snuckles**
> I don't understand. Is that good or bad? Steamboat Willie is a classic.

**#8 Hotel Bro**
> Who was that react from?! Come fight me like a man and I'll show ya where to put that thumbs up.

- A **card back** sits on the post. It's a Hall Pass, but no reader can tell it from a Card Collector.
- **Chadluminum reports it** *(new)*, public, for 0.25 Aura. His reason, the player's words: *"He's threatening to
  fight people in a sprite thread. A sprite thread!"* QC-1000 rules **visit**, charged under the premise (minor).
  **GENERATED**, the verdict line everyone reads:
  > DECLINED: a sprite thread is for sprites, not a sparring ring. Gameplay: none. Filed under How-Tos, which it is
  > not. Visit opened on Premise. (Processed: 997. Probably.)
- **The visit opens.** A yellow stopwatch and countdown appear on the date bar, and QC-1000 shows in "Users browsing"
  as *On a visit · post #8*. The opener, **REAL** (`openerQcArts`):
  > QC-1000 has opened a file on this post. Page one reads the premise of Arts & Crafts. There is no page two yet.
- **The Hall Pass springs.** The back turns over and the visit ends. Nothing is filed.
- **Autocorrect ×3**, later (the stack is 3):
  - "man" → "Goomba"
  - "where" → "how"
  - "put that thumbs up" → "do the Mario"
  - On screen it reads: *Come fight me like a **Goomba** and I'll show ya **how** to **do the Mario**.*
  - **Every shot of the tape is a hand picking at it** (the owner). A reader lifts a strip by its end, the original
    words show underneath ("man", "put that thumbs up"), and it lays back down. Then the next strip. A reader's lift
    is never kept, so it can be done again and again, which is the point of the shot.

**#9 Chadluminum**
> Big talk from a guy whose girlfriend went to 7 hotels in one night.

- **Overreaction 💀** (💀 isn't in the forum's sixteen reactions, so the card allows it). It's the play the film shows
  in node 9, and the 💀 count climbs.
- **Feelin' Fab ×3.** Chadluminum is the Face, and the crowd loves him.
- **Steel Chair ×3**, thrown by Hotel Bro *(new)*: dents, bounces, chairs on the floor.

**#10 Hotel Bro**
> How 'bout you stay outta this one, blockhead?

Reports are public, so this line now answers the report on #8. No new words are needed; it just gets a reason.

**#11 Snuckles**
> I'm going to keep working on my sheet. I think I'm really close to a breakthrough.

- **You Were Saying?** The old voice rambles on from "breakthrough". Per the design (section 6), the text must be the
  card's real output, cast on this post in the owner's test instance.

**#12 Serious Deer**
> You would do well to address the pillow shading.

**#13 D-Guy**
> This sheet makes me wanna wiggle in all sorts of ways 👀

- **Take the Fall**, cast by **Snuckles** *(new)*. It's a Sweet card, and Snuckles thinks he's being supportive.
- **QC-1000's patrol visits #13 and files it.** Because of Take the Fall, the warn points land on **Snuckles**: two
  points on the warn bar of a man who has done nothing but post sprites. **GENERATED**:
  > DECLINED: a reply about a sheet is not a sheet. The board asks you to show what you made, and this shows a wiggle
  > emoji. Gameplay: none. Graphics: an eyeball. Is this a demo or the full game? I have processed 997 submissions.
- **Whoops!, in white**, a player's play, as the owner wrote it. QC-1000 was offered Whoops! for the post below and
  didn't play it, so the censor-bar version doesn't happen.

**#14 QC-1000** *(new; QC-1000's daily pool post, quoting #13)* **GENERATED**:
> SUBMISSION REVIEW
>
> Category: Sprites, filed under Complete Games. Nothing on this sheet is complete.
>
> Gameplay: none provided.
> Graphics: 5/10, see Serious Deer on the pillow shading.
> Replay Value: 11/10, which is not possible, and I am noting it anyway.
>
> Is this a demo or the full sheet? The thread says breakthrough. I need to know which one I am reviewing.
>
> D-Guy, "wanna wiggle" is a reaction, not a note. Please provide notes.
>
> ACCEPTED, with notes. I am tired. I am keeping that on the record too.

This is the sheet's 2.9-star review from node 2, delivered by the staff. (Its private note, never shown: *"Hotel Bro
is out of scope for Sprites. Ask who the sheet credits next time, and whether the breakthrough ever shipped."*)

**#15 Chadluminum**
> Some go their whole lives wondering. Only a few among us truly achieve the greatness of making a Sprite Sheet

- **Autocorrect** "making" → "glazing". This is the extreme close-up. The pointer picks at the strip's end and lifts
  it to show "making" underneath. The strip lays back down on "glazing", and the pointer goes for it again, faster
  each time as the narration climbs. A reader's lift is never saved. Only the author's slow peel is, and he never
  finishes one.
- **A patrol visit opens** on #15 *(new)*. Chadluminum takes the thread's one interception try, the **quiz**, and
  presses the wrong answer. A failed try means his next post within 24 hours draws an Obstruction visit.
- **The quiz** is written in #1002's shape: QC-1000's own voice, about the post as readers see it now, which
  includes the autocorrect. *(Standing in until #1002 is built and the rehearsal writes it.)*
  > **SUBMISSION UNDER REVIEW.** Per the post as filed, what must one do to a Sprite Sheet to achieve greatness?
  > - Make it
  > - Glaze it ✔
  > - Wonder about it
  > - Address its pillow shading

  Chadluminum presses **Make it**, which is what he actually wrote. He's wrong, because the post as filed says
  "glazing". He fails a quiz about his own post because somebody taped over it. In the cut, the wrong press and the
  "glazing" close-up are one beat.
- **The visit ends and files #15** (2 points on Chadluminum). **GENERATED**, reading the post as taped:
  > DECLINED: no sprite, drawing, song or story here, only a remark about glazing one. This board asks you to show
  > what you made. Filed under Complete Games. I am tired, and I have seen worse glazing, though not often.

**#25 Hotel Bro**, drawn under #15 by **Line Cutter**
> > Some go their whole lives wondering. Only a few among us are Wiggler Freaks enough to really do something about it
> What did he mean by this

It's written after #24 and drawn right under the post it fakes. The **#25 between #15 and #16** is a detail for a
close-up, the thread's timeline visibly out of order.

**#16 Snuckles**
> > You would do well to address the pillow shading.
> What's shading?

(His postbit now shows the warn bar from #13.)

**#17 A Goomba**
> Someone really ought to shut this Hotel guy up.....

This now follows the failed report: the staff wouldn't, so he will.

**#18 Hotel Bro**
> Oh yeah? What are you gonna do, throw somethin' at me? I'd like to see ya try!

- A **card back** on the post. It's **So Very Happy**.
- **A Goomba throws a Steel Chair.** The chair lands and the back turns over. A Goomba is **locked out of the thread
  for 24 hours**. His composer reads "A Goomba is locked out of this thread until …", that the lockout ends by
  itself, and that it holds only this character.

> **A Goomba's spun thread** *(new title)*: *can a mod PLEASE do something about hotel bro*
> ORIGIN box: #18, frozen as it was when spun, with A Goomba's own chair in it.
> **A Goomba** *(new)*: I got locked out for throwing ONE chair. He literally asked for it.
>
> - **Hotel Bro throws three Steel Chairs** at it with **Front Row** up on him, so each 😂 piling onto the plays
>   pays him half a vote more.
> - **A Goomba reports #18.** A locked-out character can still report. His reason, the player's words: *"He
>   literally asked me to throw something and then I got locked out for it. This is entrapment. Please do
>   something."* QC-1000 **dismisses** it, and the 0.25 Aura stays spent. **GENERATED**:
>   > DISMISSED: no rule is in force on this board, and a taunt is a reply, not a submission. Notes: the wiggler
>   > sheet is still missing its Gameplay field. The reporter's Aura is spent.
>
>   (I'd hoped for a backfire. The one take dismissed it, and I kept that. The Mod still does something to the
>   reporter: it charges him and ignores him.)

**#19 Snuckles**
> I think I fixed the shading.
> [wiggler-sheet-dropshadow.gif: every sprite with a black Photoshop drop shadow] *(new asset)*

**#20 Serious Deer**
> After analyzing the pixels in this sprite sheet I have come to the unfortunate conclusion that it was created with
> the assistance of generative AI.

- **Below the Fold.** The post is one bar until pressed. It opens exactly on "Making games is hard!", the only
  f-fold in the film.

**The System's Turns thread:** *Chadluminum has Turned. He was a Face; he is now a Heel.*
(An announced Turn may name both classes. Naming the new one unmasks it, and that's his choice. It takes effect at the
next daily settlement.)

**#21 Chadluminum**
> To be trapped in this place, with you people, is an indescribable hell.

- **🍅 from everyone.** As a Heel they now pay him, and his Aura bar rises: the same close-up as Hotel Bro's in node
  5, now on the man who was everyone's favorite.
- **The Obstruction visit** from the failed quiz lands here, and the post is filed under Obstruction. His warn bar
  stands at 4 of 10. **GENERATED**:
  > FILED under Obstruction (minor; tail). The sprite sheet is buried under a complaint about the company, and a
  > complaint is not a submission. Gameplay: 11/10. Replay Value: none, we are all trapped here. One weary aside: I
  > have processed 997 of these.

**#22 Serious Deer**
> You don't have to describe it. You can just stop talking.

**#23 D-Guy**
> What if wigglers are just pokeys that fell over?

- **Hot Box**, warm smoky gray.

**#24 Serious Deer** *(new)*
> This has been debunked, D-Guy.

- **QC-1000 files it.** **REAL** (`filingQcGotcha`, its recast copy, verbatim):
  > Filed under premise, minor: Arts & Crafts asks for shown work, and 'this has been debunked, D-Guy' shows no work
  > at all, only a verdict. Art is welcome here. Gotcha is not a sprite. Count remains 997.

  It hits the character whose whole voice is verdicts without shown work, including the AI accusation.

**The leaving posts**, the coda, one to a chord:

- **#26 Snuckles:** That does it! I'll kindly take my Wigglers elsewhere!!! (If D-Guy cast Glitter Bomb on Snuckles
  earlier, this post sparkles, an angry exit in glitter. Optional.)
- **#27 Hotel Bro:** I can't wait to fuggetabout you clowns, capiche?
- **#28 Serious Deer:** I didn't do anything but ok. (Her filing from #24 sits just above. She did one thing.)
- **#29 D-Guy:** that's all, folks 😬
- **#30 Chadluminum:** I've really tried for a long time, but I just don't think this is going to work. See you all
  around. (🍅 on it pay him. He leaves as the thread's big winner.)

**The Boss, in the heap:** FanGaME **moves the thread** from Arts & Crafts to **Video Games** (a Boss move, built,
landing with no admin queue). The move notice is one flash in the last statements.
- The game's own words (`MOVE_THREAD.template`): *FanGaME moved "Look At My Wiggler Sprites" from Arts & Crafts to
  Video Games. Nothing in the thread was changed; the board it left lists where it went for a few days.*
- His reason, **WRITTEN** in his voice (181 of the 200 characters a reason may hold):
  > Per my programming, a wiggler with a walk cycle is a Mario fangame, demo stage. Fangames are video games. Moving
  > it there, where nobody fights. (I checked. This is fine. I am fine.)

Video Games is also on QC-1000's beat, so the move changes nothing about who's watching. A viewer who pauses can
find that out.

---

## 3. The cut, node by node

Takes named `n-` are new; the rest keep their cut-list names and refilm on the new stage wherever the posts changed.

| Node | Words | On screen |
|---|---|---|
| v01 | (whole node) | `o-open`: #1, the click on the node. |
| v02 | "straightforward MFGG submission" | `o-op-close`: #1 closer. |
| v03 | "enjoy being Liked … nurturing environment" | `o-kind`: the slow scroll through #2–#5. This drops the old cut-in to Chadluminum, who now first posts at #9. |
| v04 | "points for being DISliked" | The scroll arrives at #6. |
| v05 | "threw tomatoes" / "gives him Aura" / "politely" | `o-heel`, `o-heel-aura`: the 🍅 ×5, the bar, and the 👍 on "politely", landing right under #7. |
| v05→v06 | (after "check this out:") | `o-rant`, **retyped to #8's new words**: he starts typing furiously, with no hold. |
| v06 | "Problem solved." | **Said over the typing, mid-rant** (the owner): the anger is the solution. He keeps typing through the line and after it, until the caret reaches "…where to put that **thu**". There the film **hard-cuts on the "u"**, as if the edit got out before he typed something crass, straight into v07's classes carousel. The autocorrect close-up later shows how the post was sent. |
| v07–v08 | classes, shared Aura | Unchanged (`g-classes`, `g-aura`). |
| v09 | "spent on cards … play those" | `g-vending`, `g-pack`, `g-hand`, then **`g-play` = Overreaction 💀 on #9**, typing the emoji. |
| stmt 9 | "gameplay loop" | The effects run, each now on this thread: rainbow #9 · chair #9 · ink #13 (white) · tape #8 · smoke #23 · glitter (Snuckles) · graffiti #1. |
| v10a | "a card can be face down on any post" | The card backs on #8 and #18, a quick pair. |
| | "the poster can set conditions for it to spring" | **`n-hallpass`**: the stopwatch appears on #8, the opener line, the back turns over, the visit ends. |
| | "to not trust anybody, basically" | **`n-report`**: Chadluminum's report form sent, then #10 "stay outta this one, blockhead". |
| v10b | "WANTED you to play that card" | #18, "I'd like to see ya try!" |
| | "should've played a different card" | **`n-svh`**: A Goomba's chair lands, and So Very Happy turns over. |
| | "or just not played any card at all" | The locked-out composer note. Replaces `f-chess-lens`: 4D Chess has no place in this story. |
| | "really interesting conversations" | **`n-spin`**: A Goomba's spun thread, with the ORIGIN box holding his own chair. |
| | "It's a positive experience." | Hotel Bro's three chairs land on A Goomba as 😂 piles up. |
| | "We tested this." | **`n-quiz`**: the wrong answer pressed on #15. |
| | "okay, I'll level with you" | **`n-dismissed`**: A Goomba's report comes back DISMISSED, his Aura spent. |
| | "first time we've really tested it" | **`n-tookfall`**: #13 filed, and the bar rises on **Snuckles**. A flash of #14, "ACCEPTED, with notes." |
| v10c | "what do you know, anyway?!" | `f-gpt2`: You Were Saying? typing on under #11. |
| | "gaming chair" | `f-chair` on #9: dent, bounce, floor. |
| | "silver platter" | **`n-turn`**: the Turns thread notice, Face → Heel. |
| v10d | "Making games is hard!" | `f-fold` on #20, opening on "Making". |
| | "Being Gabe, is hard!" | **`n-heel-aura`**: 🍅 on #21 and Chadluminum's bar rising, a rhyme on `o-heel-aura`. |
| | "I don't have to give my 'commentary' to you!" | #22, "You can just stop talking." |
| | "This is a good idea!" | #19, the drop-shadow sheet, a hard push in. |
| | "THIS IS A GOOD IDEA!" | The "glazing" autocorrect close-up on #15. |
| | "THIS IS A GOOD IDEA!!!" | **`n-filed-deer`**, then #23's smoke, the #8 triple-tape close-up (three strips lifted one after another, each showing the words under it), the move notice, the heap. |
| coda | (chords) | `f-leave-1` … `f-leave-5`: #26–#30, each with what it carries (sparkle, warn bars, 🍅). |
| v11 | "This is a bad idea." | Black, then the title. |

The heap takes (`f-heap-*`) stay the connective tissue in statements 13–18. Their content becomes this thread's posts,
fully loaded.

---

## 4. Corrections to the draft

- **Front Row, not Class Clown** (the owner, 2026-11-22). Class Clown pays on 😂 and 🙄 on *the character's posts*.
  The laughs on Hotel Bro's chairs are votes on *plays*, which is Front Row's.
- **The Turn isn't instant.** It lands at the next daily settlement and is announced in The System's Turns thread,
  not inside this thread. It shows as a cutaway, which the non-chronological cut handles well.
- **A Goomba is "locked out", not "kicked out".** The lockout lasts 24 hours, covers this thread only, and can still
  spin. That last part is what makes the spun thread legal.
- **Staff can't lock a thread or post conversational replies yet** (both designed, not built), so nothing here relies
  on either.
- **Serious Deer is she/her** (the owner, 2026-11-22). The Lens and the visit mark show only the Mod's pronouns, so
  her filing, the report screens and every staff line are unchanged; none of the lines uses a pronoun for her. Her
  postbit shows she/her, so the stage's character data carries it. The prompts sent for the GENERATED lines tagged her
  (he/him) in their thread excerpts and spelled "Chadliminum". The files in `docs/research/2026-11-21-commentary-video/staff-takes/prompts/` are now rebuilt with
  both corrected, so they are not byte for byte what was sent.
- **Spelling: Chadluminum** (the owner, 2026-11-22), as the repository has it. The prompts sent for the GENERATED
  lines spelled him "Chadliminum". None of those lines names him, so they stand as written.

---

## 5. Staff words: where each comes from

The owner's rule from the third cut was real rehearsal output only. On 2026-11-22 the owner accepted generated output
in its place, rather than rework the rehearsal to take a written thread.

| Beat | Words | Source |
|---|---|---|
| Visit opens on #8 | "QC-1000 has opened a file on this post…" | **REAL**, `openerQcArts` |
| Serious Deer filed on #24 | "Filed under premise, minor: Arts & Crafts asks for shown work…" | **REAL**, `filingQcGotcha` |
| Report on #8 → visit | "DECLINED: a sprite thread is for sprites, not a sparring ring…" | **GENERATED**, `reportPrompt` |
| #13 filed (lands on Snuckles) | "DECLINED: a reply about a sheet is not a sheet…" | **GENERATED**, `filingPrompt`, premise, patrol |
| #14, QC-1000's pool post | "SUBMISSION REVIEW … ACCEPTED, with notes." | **GENERATED**, `chatterPrompt`, offered Whoops! and Feelin' Fab, played neither |
| #15 filed | "DECLINED: no sprite, drawing, song or story here…" | **GENERATED**, `filingPrompt`, premise, patrol |
| #18 report → dismissed | "DISMISSED: no rule is in force on this board…" | **GENERATED**, `reportPrompt` |
| #21 filed | "FILED under Obstruction (minor; tail)…" | **GENERATED**, `filingPrompt`, Obstruction, tail |
| Quiz on #15 | "Per the post as filed, what must one do to a Sprite Sheet…" | Written by the session to #1002's shape, by the owner's leave |
| Hall Pass, lockout, report form, Turn notice, move notice, filing notice on a post | The game's own copy | Built UI |
| FanGaME's move reason | "Per my programming, a wiggler with a walk cycle is a Mario fangame…" | **WRITTEN** by the session in his voice from the real `memo`, `moved`, `mergedLast` and `farewell` lines, by the owner's leave. Not generated: the meeting reads a full digest, phase, bank and memory, which would all be invented |

**How GENERATED was made.** `docs/research/2026-11-21-commentary-video/staff-takes/build.ts` calls the engine's own prompt builders with the field values
the staff and chatter functions pass:
- the thread's newest 8 posts, cut at 280 characters, as readers see them;
- the board's premise;
- no rules in force;
- QC-1000's persona;
- the Boss's real order to QC-1000 (`orderNoAllowance`);
- no allowance;
- a Mod career from the season's start.

Each prompt went to one fresh light-tier (Haiku) agent that saw nothing but the prompt file. Each answer went through
the engine's repair (`repairFiling`, `repairReport`, `repairChatter`; `docs/research/2026-11-21-commentary-video/staff-takes/check.ts`): nothing was
trimmed or dropped. Every call was one take, kept as it came.

The exception was #21. Its first take was given the premise charge by mistake, where a tail visit is charged
Obstruction (`0105_visits.sql`). It was retaken with the right charge, and the first take is kept beside it.

**How it differs from a rehearsal.**
- The visits' existence and timing are scripted, not drawn by the patrol.
- The game state is hand-assembled rather than read from a database.
- The agent wrapper stands in for the API's structured output.
- #14's prompt saw the thread up to #13, while the later calls' windows don't include #14.

The record of claims (`docs/research/2026-11-21-commentary-video/claims.md`) should say the film's staff lines are
generated this way, beside the two REAL ones.

---

## 6. New assets and takes

- `wiggler-sheet-dropshadow.gif`: the sheet with a black drop shadow on every sprite.
- The real You Were Saying? text, cast on #11's words in the test instance.
- Takes: `n-hallpass`, `n-report`, `n-svh`, `n-spin`, `n-dismissed`, `n-quiz`, `n-tookfall`, `n-turn`, `n-heel-aura`,
  `n-filed-deer`, plus `o-rant` retyped and the close-ups (triple tape on #8, "glazing" on #15) retargeted.
- **The edit, for `o-rant`:**
  - v06 no longer waits out a silent pause after the typing. It starts partway into the typing, so `after: 4.5` in
    `commentary.ts` shrinks to a short lead-in (about 2 s of typing before "Problem solved.").
  - The take needs a sync mark at the "u" of "thu". The cut to `g-classes` is pinned to it, landing after "Problem
    solved." ends, with typing still running.
- `f-chess-lens` leaves the cut list.

---

## 7. What the build owes

This record is a script. The build session that puts it on the stage owes these, beside the takes in section 6:

- **The stage's staff lines and their test.** `instances/divided-world/ui/hype/Stage.test.tsx` finds every staff line's
  `said` in the second rehearsal's logs. The GENERATED lines are in no log, so the stage's line data needs a declared
  source for each. The test then checks that line against
  `docs/research/2026-11-21-commentary-video/staff-takes/answers/`, as it checks a rehearsal line against its log. The
  two WRITTEN lines (the quiz, FanGaME's reason) are named as written, as the fixture quiz was.
- **Main under the film.** #927's branch has only the General board. Arts & Crafts, the thread's board, and the Video
  Games board FanGaME moves it to are on main. Section 11 of the revision design already films on main as it stands.
  The scripts in `docs/research/2026-11-21-commentary-video/staff-takes/` need the same: `build.ts` reads the board's
  premise from the instance, so it runs on main at b4f12f1 or later.
- **The cast's data.** Chadluminum's spelling is the repository's. Serious Deer is she/her and every other character
  he/him. Hotel Bro holds Front Row for the chairs in A Goomba's thread, and Chadluminum turns from Face to Heel.
- **The narration's timing.** `after: 4.5` on v06 in `instances/divided-world/ui/hype/commentary.ts` becomes the short
  lead-in of section 6, and the cut list pins the cut out of `o-rant` to the take's "thu" mark.
- **The claims record.** `docs/research/2026-11-21-commentary-video/claims.md` records the new staff lines' sources
  (its section "Revised, 2026-11-22").
