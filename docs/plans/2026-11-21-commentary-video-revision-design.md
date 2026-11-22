# The commentary video, revised: design

Record, written 2026-11-21. The owner's notes on the third cut of the commentary video
(`docs/plans/2026-11-21-commentary-video-design.md`, built by #914) and what they change. The script's words do not
change. The plan is `docs/plans/2026-11-21-commentary-video-revision-plan.md`. Nothing here changes the game.

## 0. What the third cut taught

The owner, on the cut: "Good start!", the commentary nodes work "though they could be a bit bigger", and:

- "There are times where the shot holds on no action or narration for an extended period of time awaiting a music
  cue. This is mainly happening in the shots around the middle of the video and is the main issue right now."
- "The earliest footage in the video has effectively no movement at all; when narrating a screen like this it's common
  to move the cursor or scroll around the page idly while talking."
- "This zoomed-out desktop view makes it a bit hard to see some of our most delicate effects, like picking and rolling
  an autocorrect strip with the screen zoomed in... It can rip several times." And: "In these takes the effects are not
  being interacted with much, which is most of the fun."
- "So early in the video it appears to be a simple narrated demo and it reveals itself as a tightly edited production
  over time, with the shot length generally decreasing as the music gains intensity. Cutting between 'Whoops' spills
  in the previous video, with the user scrubbing the spills away with increasing franticness and futility, worked
  well."
- "I don't actually see a You Were Saying cast when he mentions gpt2."
- "Let's try to only use real rehearsal lines for the staff", and "there are definitely some mechanisms (reporting,
  moderation reviews and quizzes, hall passes being triggered, etc) which don't seem to be represented, but which are
  built. Quicker cuts... give us an opportunity to pack in more game footage."
- The graffiti "could use more varied shapes in the scribbles".

The first design had one take a node, held or trimmed to its window. That is where the waiting came from: forty
seconds of speech laid over a hundred seconds of music.

## 1. The music starts early, and the voice chooses its length

**Decided (the owner):** the music does not wait for part two. "The track starts out quiet enough that I think it can
begin very shortly after Gabe begins initially talking... The calm beginning of the song functions well against the
narration which itself starts calm, sort of an instant air of subtle mischief that gets out of control."

So the narration runs continuously from the first frame, one node after another with a breath between, and the music
is laid under it from its end backward: the coda's first chord falls just after node 10's last word, and the music's
start is wherever that puts it. The full orchestra's entrance then falls where the speech is at that moment; with the
placeholder voice that is inside node 8, as he fails to stop his own node.

**The recording may be shortened.** The owner: "The song can be cut down if it's seamless, doesn't skip a beat."
An analysis of the recording found eighteen statements of the theme, sixteen beats each, six to a block; the first
block is at a constant tempo and level, so a pair of statements can be taken out of it with a tempo step under one
percent. Two shortened versions were rendered, each with one join in the first block: **mk-A** (2:16, statements 2
and 3 removed) and **mk-B** (1:58, statements 2 to 5 removed). A third, with a join in the accelerating second block,
leaves a tempo step of about a tenth and is not used. Shorter than that is not possible without an audible step.

The owner chose mk-B by ear. With the placeholder's two and a half minutes of speech, mk-B would start a minute in and
the full recording twenty-three seconds in. **Decided:** the edit chooses among the full recording, mk-A and mk-B the
longest whose start is at least five seconds into the film, so the music begins as early as the speech allows; a
quicker performance by the owner brings mk-A or mk-B in by itself. `--recording full|mk-a|mk-b` overrides. The owner
was told of the arithmetic and may still fix mk-B; that is one flag.

The first design's map of the recording was wrong in three places (the theme's first note is at 4.4 s after a held
drone, not 0.5; the second block starts at 58.1 s, not 64.4; the full orchestra enters at 102.3 s, not 100.3). The
measured statements replace it.

## 2. The cut: a demo that turns out to be an edit

**Decided:** shot length falls as the music climbs, by a cut list written against the music's statements and beats.

| Stretch | Music | The cut |
|---|---|---|
| Nodes 1 and 2 | Silence, then the drone and the first statements | One take a node, a locked frame, and a narrator's pointer that is alive (section 3). It looks like a narrated demo. |
| Nodes 3 and 4 | The first block | Two or three shots a node: the first cut-ins, to the card back turning over and the alert. |
| Nodes 5 to 7 | The second block, accelerating | A cut on every statement, then every half statement. Close-ups of effects being handled are cut against the node's own action. |
| Nodes 8 to 10 | The full orchestra | A cut every two to four beats: the heap, the scrub, the Staff's mechanisms, the board turning in space. |
| Node 11 | The coda | A cut on every chord, as now. |

The cut list is data (`cutlist.json`): for each statement of the music, the shots that fill its sixteen beats, each
naming a take, where in the take it starts, and its move. A shot of a node's own action may be pinned to a word of the
narration instead of a beat, so the chair still lands as he says "phrase". The edit refuses a statement whose beats
do not add up, and prints the median shot length of each block, which a test holds to be falling.

**Nothing is held to be read.** The owner, before the list was written: "it's okay not to hold on text long enough to
read all of it, leaving some of this stuff as only fully legible with a pause. The cuts should be fast-paced, and
trying to let the viewer sit there and read this whole thing from start to finish would work against that." A shot's
length comes from the music's beats and never from how long its words take to read; what a take owes its words is a
sharp frame.

## 3. The narrator's pointer

In nodes 1 to 4 the camera stays locked off and the pointer does what a person's does while talking over a screen: it
drifts to the thing being named and rests near it, circles a word, scrolls a little and comes back, hovers a button
without pressing it. Each gesture is tied to the caption being spoken, so the pointer is on the class tag at "secret
class" and on the tomatoes at "threw tomatoes at him". The shot reads the voice clips' lengths to time them; a new
performance means filming part one again, which is four short takes.

## 4. Close-ups, and hands on the effects

**Decided:** a library of short close-up takes, filmed with the page zoomed in and driven by the real pointer, each of
one effect being handled:

- **Autocorrect:** a strip picked at its corner and rolled back, tearing, three times.
- **Whoops!:** the scrub, in three takes of rising franticness; the last ends as a fresh coat lands.
- **Hot Box:** the smoke waved away and rolling back in.
- **Glitter Bomb:** the pointer dragged through it.
- **Graffiti:** a wall tagged live, with shapes that differ (an arrow, a heart, a face, a word, a scribble-out).
- **Stick Around:** the wheel against the Break Free bar.
- **Steel Chair, Laugh Track, Jimmy Wails, Below the Fold, a reaction's stamp, the booster pack, the hand.**
- **You Were Saying?:** the tail typing in under a post, large enough to read, as he says "This is GPT-2 finishing
  someone's post." The words are the model's own (section 6).

The stage's five dressed posts get graffiti of varied shapes, and the commentary nodes are drawn about half again as
large.

## 5. The Staff, in their own words

**Decided (the owner):** every staff line on screen is the second rehearsal's output. The two lines the first build
inherited from round 1 for ONTOPIC 5.0's filing are in no log (#914's final review, F1) and go.

The logs hold: the Boss's memos to his Mods, his board moves with their reasons, six templates of a Mod's opening
line on a visit, each filing's words with the post it was aimed at, ONTOPIC 5.0's star reviews, group and trophy
moves, and the whole handover (the succession, FanGaME's farewell, QC-1000's arrival). They hold no text for a quiz,
a report's verdict, an appeal's ruling or an apology: the rehearsal never exercised them.

So the mechanisms are shown this way:

| Mechanism | Shown as | The words |
|---|---|---|
| A visit opens | The Mod's mark and countdown on a post, its Lens open | A real opening line |
| A quiz | The Lens's choices; a wrong answer pressed | **The fixture's quiz** ("Which form is used to request another form?"), by the owner's leave, as the one exception |
| A Hall Pass springs | A face-down card turns over as the visit begins; the visit ends | The game's own notice |
| A filing | The filing on the post, the warn bar rising | A real filing line, aimed at a post like the one it was written about |
| A report | The report form opened from a post and sent | The game's own form; no verdict line is shown |
| An appeal | The Appeal button and its form | The game's own form; no ruling line is shown |
| A board made, a thread moved, boards merged | The move notices | The Boss's real reasons |
| A memo, a star review | Staff posts | Real |
| The handover | The Boss's farewell, and the new Boss taking the seat | Real |

The rehearsal's posters are renamed to the cast, as round 1's were, and each line is kept as written beside its
recast copy.

## 6. Smaller things settled

- **The GPT-2 text** is real output of the card, read from the owner's test instance: the owner casts one at length
  and its text is copied into the stage. Until then a shorter real one stands in ("...but for some reason this shit
  keeps"). The post it continues on the stage is not the post it continued in the instance; the record of claims says
  so.
- **The Jimmy Wails banner stays.** The owner: the image "can be used under the same CC license as the effect itself."
  The film's credits carry the image's credit beside the recording's.
- **The end card's stand-in** stays as an opt-in for previews; the owner did not strike it.

## 7. The rules

- **The layers, the masks, ways out, scale:** as the first design's section 8. The stage, the cut list, the lines and
  the maps are Divided World's; the camera and the edit are tools; the engine is not changed.
- **The one write to a deployed database** in this work was the owner's own instruction: a grant of Aura to the
  owner's test account, through the game's `grant_aura`, so the owner can cast the card whose text the film shows. No
  build session or subagent touches the instance; the text is read once, by the session the owner asked.

## 8. Open

- **mk-B, fixed, or the rule in section 1.** The rule stands unless the owner fixes the version.
- **Free, and by invitation:** still said nowhere in the film.
- **Whether node 2's forecast counts as filmed from the game** (#914's design question 3): unanswered.
- **The matched phrase in node 6's Lens** needs the fake's seeded spring to carry it (#922). Without it the close-up
  shows the phrase in the dented post.

## 9. The owner's script pass, on the fifth cut

The owner, on seeing the fifth cut whole: "We are getting there!", with a pass over the script and the stage's posts.
The words below are the owner's; `commentary.ts` holds them as the film says them.

**The posts.**

- Snuckles's first post: "Hi divided world, it's ya boy Snuckles here with my first ever sprite sheet. He's an
  original character I invented after I saw him in a Mario game." Then the sheet. Then: "When he walks his legs move."
- D-Guy's reply, in place of the review: "OF COURSE YOUR SPRITES LOOK LIKE THIS WITH THOSE STEAMBOAT WILLIE ASS
  FINGERS"
- The smoked post: "ok i am just going to say it: this wiggler is making me wiggle in all kinds of ways 👀"
- Chadluminum's: "Some go their whole lives wondering. Only a few among us truly achieve the greatness of making a
  Sprite Sheet"
- Human Josh quotes him with a forged quote: "Some go their whole lives wondering. Only a few among us are Wiggler
  Freaks enough to do something about it", and adds "what did he mean by this".
- Serious Deer, in a post folded by Below the Fold: "I've analyzed this sprite sheet's pixels and come to the
  unfortunate conclusion that it was created using generative AI."

**The narration.**

- **Node 1:** "Hi, I'm Gabe. Over the last few years, people have been asking me what our company has been up to. Why
  haven't we been making any games? Well, I'm happy to announce that the indefinite delay of Half-Life: Nuts & Bolts
  has not been in vain. For the last nine years, we've been putting all of our resources into this: Divided World. And
  nobody can ever get that time back. To listen to a commentary node, put your cursor over the floating commentary
  symbol and click. To stop one, click it again. Some commentary nodes may take temporary control over the forum in
  order to show you something. It's best to just let those ones happen."
- **Node 2:** "Early playtests showed us that people posting on a forum want to be liked. We found this resulted in a
  positive, nurturing environment - So instead, every character has a secret class, and some classes are paid for
  being disliked. This one is a Heel. Playtesters threw tomatoes at him and he made money. We then found they could
  hurt him by agreeing with him, politely." Then D-Guy is seen typing a reply, furiously: "Who was that??? Come out
  here and fight me like a man and I will show you where to stick that thumbs up", the shot cutting off before he
  sends it, under: "And that REALLY got him going!" He cannot know who it was: who reacted is private, which is the
  joke.
- **Node 3:** as it was, without "We agree."
- **Node 4:** the words stand. The picture changes: the post at rest under a slow push was awkward (section 10).
- **Node 5:** "This is a training arc. The player learns that a card can be caught, and then learns that being caught
  can be the plan. We found 1 in 5 players understood this. He took the other four for everything they had, and none
  of them ever logged in again."
- **Nodes 6, 7, 8:** as they were.
- **Node 9:** as it was through "This is not in the middle of the curve. Okay." Then, in place of the GPT-2 lines:
  "This is... somebody's post continuing itself? I guess? Okay, I'm hoping at one point one of the, uh..." The session
  kept the chair's lines on its own reading of the note; the owner may strike them.
- **Node 10:** "Okay good, here's a Moderator. He's a personality core we pulled out of a pile, he should be able to
  clean some of this up, aaand.... he's merging all the boards together."
- **Node 11:** four fragments between the chords: "Please let me know..." / "what you think...." / "after you've had
  a chance...." / "to figure this stupid thing out!"

The model is no longer named in the narration, so the claim that it is GPT-2 leaves the film; the text on screen is
still the card's real output.

**The ending.** The circus music, the held black and the rainbow card go. The owner: "take advantage of the final 2
strikes of the mountain king... to show 'DIVIDED WROLD' on strike 1 and then the nonsense in the parentheses
immediately afterwards on strike 2, in smaller text. Make the title card look essentially cinematic in quality in
spite of the inexplicable errors in the text itself." The film ends as the last chord dies. The card is drawn in the
glass's own look (its smoke, its heading face), so the title belongs to the game.

## 10. What the fifth cut showed, in the owner's words

- **Node 4** "needs something else on the screen, it's just the same snuckles post again with a slow zoom that is a
  bit awkward." The scrub carries the whole node: ink on the post from his first words, a hand at it throughout, a
  fresh coat on "exceeded" and another on "personally".
- **Node 5:** "the footage is cool but it doesn't really line up with the explanation of a reversal anymore." Its shots
  are put in the order of its sentences: the catch at "can be caught", the card thrown back and the 4D Chess paying at
  "being caught can be the plan".
- **The chair** "makes a noise here when it gets triggered but I don't actually see the chair hitting the wall. We
  should get a good take where the chair is thrown, gets a good dent, bounce, falls onto the floor satisfyingly."
- **The glass in close-up:** "The Stick Around UI doesn't really show the post as visible. In fact a lot of the glass
  shots are using a rather wide variant of the tablet layout, not as flattering as a full desktop view in some cases,
  such as the mod poll with quite wide buttons." The close-ups were filmed at small viewports, which the glass answers
  with its tablet layout. A take that shows the glass is filmed at a desktop viewport and magnified.

**A forged quote and a phrase trap.** Node 6's chair springs on a quote that says a phrase. Whether a forged quote
springs a card set on the post it claims to quote is the rules' to say, and the stage follows them: if it does not,
the chair is sprung by a real quote of Chadluminum's post by another character, and the forged quote stands beside it
as its own beat.

## 11. The owner's rewrite, on the sixth cut (2026-11-22)

The owner, on the sixth cut: "one more rewrite, substantial recut but some footage should at least be reusable this
time." The narration is new from its first line; `commentary.ts` holds it as the film says it. Sections 9 and 10
stand as the record of the pass before; where this section differs, this one is the film.

**The cast and the look.**

- The Heel is no longer D-Guy but **Hotel Bro**, a character of the video's own, whose avatar is the owner's own art
  (Mario, from "President Peach's Beautiful Border Wall").
- **D-Guy** takes Human Josh's place and voice (the lowercase poster). Human Josh leaves the stage.
- Reshoots use the **Fan Site** or **Hot Rod** theme, on main as it stands with the latest changes merged. The session
  films the calm opening in Fan Site and turns to Hot Rod when the narrator loses control; footage kept from earlier
  takes keeps its skin.
- Serious Deer's line under the fold ("...it was created using generative AI") "is a really perfect gag but it is
  currently being used twice. It needs to only happen once and at the perfect time. Probably immediately after/as Gabe
  says 'Making games is hard'".

**The film, beat by beat** (the owner's directions in parentheses, the narration quoted).

1. (The recording opens on Snuckles's post, in silence. A commentary node sits on screen and is cautiously clicked. The
   click is what starts the voice.)
   "Hi, I'm Gabe. Over the last few years, people have been asking me what our company has been up to. Why haven't we
   been making any games? Well, I'm happy to announce that the indefinite delay of Half-Life: Nuts & Bolts has not
   been in vain. For the last nine years, we've been putting all of our resources into this: Divided World. And since
   we'll never get any of that time back, let's dive right in."
2. (A closer shot of the first post.)
   "Here we see a straightforward MFGG submission with a solid 2.9 star rating trajectory. You're probably wondering
   how something so earnest and innocuous could possibly end up starting a vicious fight: and that's exactly the kind
   of game design problem we set out to solve."
3. (The cursor moves down; a cut to Chadluminum's post with the cursor entering it. Then a slow scroll through the
   kind posts under it: rainbows, positive reactions, Sweet cards.)
   "See, one of the first things we found in playtesting is that human beings enjoy being Liked. Among a population of
   well-adjusted adults, this tends to result in a positive nurturing environment."
   The kind posts: "Good job! Looks cool" / "not too shabby" / "I'll use it in my game!" / "The walk looks like it was
   hard to make 💪"
4. "So to fix that, we gave every character an anonymous class: And some of the classes get points for being
   DISliked."
5. (The scroll arrives at Hotel Bro's post, the insult. A close-up on the Aura bar rising.)
   "Take this guy: he's a Heel. He made this piece-of-shit post, and the crowd threw tomatoes at him. Normally this
   would be a bad thing, but for a Heel, it gives him Aura. The flip side is that if you agree with him politely, he
   actually LOSES Aura. We tried that out and he lost his MIND, heh, check this out:"
   (The angry typing.) "Problem solved."
6. (The carousel of classes in the character creator.)
   "These are the six classes: Face, Heel, Jabroni, Technician, Tweener, and Lurker. You get six characters, so you
   can try all of them if you want."
7. (The Aura bar, going up.)
   "They all share the same aura, so you can farm reactions as one class to power up another class."
8. (The Vending Machine, a booster pack, a card chosen and played, a quick run of post effects.)
   "The aura gets spent on cards at the vending machine, and the characters play those to earn even more reactions.
   In the biz we call that a 'gameplay loop'."
9. (The footage gets "progressively more frantic, Gabe is not the one controlling the screen, we suppose perhaps he
   never was. He is trying to keep up with the images he is seeing, explaining them in vain to the viewer. It becomes
   a rapid fire effect montage, impossible to keep up with. Gabe needs to speak more loudly as the music rises in
   intensity to match the quick cuts, tight close-ups, fast camera tracking with realistic motion blur, and intense
   motion of the action packed forum and lens footage - try not to hold on any shot for too long".)
   "Okay, this is, uh...yeah, we call this a training arc. A card can be face down on any post, the poster can set
   conditions for it to spring, so other players learn to uh, to not trust anybody, basically. Sometimes the player
   plays a card and then it turns out the player you played the card on actually WANTED you to play that card, so you
   really should've played a different card, or just not played any card at all. And uh, you get some really
   interesting conversations, at the end of the day. It's a positive experience. We tested this. The testers...okay,
   I'll level with you, this is the first time we've really tested it. And you know, what do you know, anyway?!"
   (For a couple of moments, the droning You Were Saying? text typing on; then back to the rapid fire.)
   "You sit there on your gaming chair and you expect everything handed to you on a silver platter. Making games is
   hard! Being Gabe, is hard! I don't have to give my "commentary" to you! This is a good idea! THIS IS A GOOD IDEA!
   THIS IS A GOOD IDEA!!!"
10. (Rapid fire: the characters submitting their leaving posts, the page scrolling down to follow each, as the music
    reaches its crescendo.)
    Snuckles: "That's it! I'll kindly take my Wigglers elsewhere!!!" / Hotel Bro: "I can't wait to fuggetabout you
    clowns, capiche?" / Serious Deer: "I didn't do anything but ok." / D-Guy: "that's all, folks 😬" / Chadluminum:
    "I've really tried for a long time, but I just don't think this is going to work. See you all around."
11. (A cut to black before the final sting.) Over pure black: "*sigh* Well, at least it's better than anime."
12. (The title, on the music's final note.) The owner: "my parentheses and misspelling joke has outstayed its welcome,
    let's do a really cool title card with an 'invite only' and try to earn it with the coolness of the editing
    leading up to it, not lean on it being some kind of ironic sting. In any case it should align exactly with the
    final sting of the mountain king track. Big sting, final note, title card with the divided world logo coin +
    courier new at the exact moment of the orchestra hitting that final beat."

A note the owner marked as unimportant: the forged quote of Chadluminum "turns out to be a Line Cutter", so it sits
right under his post; it may be faked or earlier footage reused.

**What the session decided inside it.**

- **The ending on the music.** The leaving posts land on the coda's chords. The picture cuts to black on the
  second-to-last strike; the sigh sits in the gap before the last, which is 3.4 seconds on the recording; the title
  lands on the final crash.
- **The music still starts early.** This narration is longer than the recording allows from an early start, so the
  recording may be lengthened as it was shortened: a pair of statements of its first block repeated, where the tempo
  and level are constant. The edit picks, of the versions it has, the one that starts the music soonest after the
  opening lines.
- **The Staff** are no longer narrated; their takes are flashes in the montage.
- **The narration's claims** were checked on this date: the six classes are named as he names them
  (`instances/divided-world/classes/`), and `charactersPerPlayer` is 6 (`instances/divided-world/settings.ts`).
- **The blur** is the camera's own: a fast move is filmed at four times the frame rate on the page's stepped clock
  and blended down, so it is what a shutter would have seen.
- **The title** is the instance's coin (`instances/divided-world/ui/icon/coin.svg`), "DIVIDED WORLD" in Courier New,
  and "INVITE ONLY". `TITLE_NOTE` and the misspelling go.

**The last line, changed the same day.** The owner replaced the line over black with "a clean punchline": "*sigh* This
is a bad idea." It answers the rant's last words, "THIS IS A GOOD IDEA!!!"
