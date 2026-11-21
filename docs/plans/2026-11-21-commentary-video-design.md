# The commentary video: design

Record, written 2026-11-21. A design session with the owner for Divided World's second hype video. The first
(`docs/plans/2026-11-14-hype-video-storyboard.md` on the branch `claude/divided-world-hype-video-27387f`, never merged)
is treated as round 1. The plan is `docs/plans/2026-11-21-commentary-video-plan.md`. Nothing here changes the game: the
video is filmed from a stage story and a set of tools, and no screen, rule or payload of the app is added.

## 0. What round 1 taught

- The game's own mechanics made its best jokes (the Autocorrect tape over FRIENDS, the scrub that never ends). The
  title cards did less, and the owner cut ending text as superfluous three times.
- The arsenal showed breadth: a second per card. A seasoned player reads depth from one play answering another.
- The orchestra over a forum was the joke, and it is spent.
- The specific homage landed: the owner's own 2005 Wiggler sheet.

## 1. The spine: a developer commentary

**Decided (the owner, A):** one thread and a voiced developer commentary by Gabe, the developer persona, in the form
of a Valve commentary track: a floating node, a calm voice explaining design decisions "real or imaginary" (the
owner). The picture shows plays answering plays by the rules as built; the narrator undersells all of it.

Weighed: **B**, the same exchange with no narrator, cut like a combo video (the purest show of depth, and it loses
the voice); **C**, round 1's trailer form again with the new cards (cheapest, and still breadth).

## 2. The shape: it starts straight and he loses control

**Decided (the owner):** no music at first, played as a straight commentary. Then Grieg's "In the Hall of the Mountain
King" comes in and the video "gets increasingly ridiculous", up to many effects stacked on one post in the manner of
the famous post story (`engine/ui/cards/FamousPost.board.stories.tsx`), with Gabe "audibly distressed and confused
amid the chaos, losing control of his own presentation". The piece is one theme repeated in three blocks, each faster
and louder, then hammered chords with silences between them, so its form is the video's form:

| Part | Music | Nodes | What happens |
|---|---|---|---|
| One | None | 1 to 4 | A sober commentary. Each node is one real mechanic. |
| Two | Block 1, low and quiet, then block 2 as the violins take the theme | 5 to 8 | Plays answer plays faster than he explains them. Nodes appear that nobody clicked. A node takes control of the page. |
| Three | Block 3, full orchestra, and the coda's chords | 9 to 11 | Everything lands on one post. The Staff arrive. He tries to stop his own node. |
| Out | Silence, then circus music | 12, 13 | Black, held. Then the end card. Gabe never comes back. |

The first draft had no music, a closing node on My log and a spoken sign-off. The owner: "It will lose steam with no
music at all", and cut the closing node for the black and the end card.

## 3. The voice

The first draft wrote Gabe as the style guide in the sibling session does (the yacht, the fellas at the lab). The
owner: "I am basically writing him as Cave Johnson which is funny in its own way, but doesn't translate as well to a
played-straight gabe-esque narration", and asked for the real records. A research pass read the published captions of
Gabe Newell's commentary intros from Lost Coast (2005) to Half-Life 2's anniversary (2024), a dozen nodes by other
Valve developers, and interviews and AMAs. What the script takes from them:

- **The intro's formula**, kept for nineteen years: a greeting, one framing sentence, three instruction sentences
  nearly word for word ("To listen to a commentary node, put your crosshair over the floating commentary symbol and
  press your use key..."), a request for feedback, "Thanks, and have fun!"
- **"After nine years in development, hopefully it will have been worth the wait."** Team Fortress 2's intro, and the
  source of round 1's last words.
- **The joke is one flat clause** on the end of a factual sentence, never signaled ("...and my favorite class is the
  spy.").
- **The body is the other developers' reasoning:** "Playtesters would often...", "We found that...", "In response,
  we...", "This trains the player to...", and "what we call a 'gate'". "We" for the work; "I" for opinion and failure.
- **He hedges and never hypes:** "hopefully", "I think", "mostly".
- **His own old code:** "it's not easy to crack open decade's-old computer code and wonder what the hell you were
  thinking way back then" (2024). The owner's point about the old MyBB fork is carried by a line in that shape.

**Decided:** this register is for the video. Whether the style guide (`docs/plans/2026-11-21-gabes-voice-design.md`,
on the sibling session's branch on this date) moves toward it is open (section 9).

**What the video's Gabe may say** is the rule the sibling session asked the owner about (#904, answered A): tall tales
about himself and where the game came from are free (the playtesters, the pile of Personality Cores); whatever he
says about how the game works is true. That rewording of CLAUDE.md's "The fiction may lie; the log never does" was on
the sibling session's branch on this date and not on main, so this design turns on it. The style guide's other
rules hold here: he never quotes the Boss or a Mod Bot (their words are on screen only), never says "The System",
says "no other player" and never "nobody", and mocks no player.

**The performance.** The placeholder is an original designed voice, "DW Commentary Placeholder" in the owner's
ElevenLabs library, made from the description "a deadpan, husky software sort of guy" and auditioned on the owner's own
intro post. The owner may replace it with a performance of their own. A session makes no clone of a real person's
voice. The voice track is replaceable by design (section 5). Gabe Newell's real email address, which every real intro
reads aloud, is left out.

## 4. The script

Draft 2 with the owner's changes. The lines are the owner's to revise; the picture beats are what the plan builds.
The thread is round 1's "my first sprite sheet (please be normal)" with the same cast (Snuckles, Chadluminum, Serious
Deer, Human Josh, D-Guy).

### Part one: no music

**1. Welcome.** The thread. A speech bubble floats over it; the pointer clicks it.

> Hi, my name is Gabe, and welcome to Divided World. After nine years in development, hopefully it will have been worth
> the wait. The last forum ran on code I wrote when I was twenty, and it's not easy to open that up and wonder what
> you were thinking. This is, I think, better. To listen to a commentary node, put your cursor over the floating
> commentary symbol and click. To stop a commentary node, click it again. Some commentary nodes may take control of
> the forum in order to show something to you. In these cases, simply click again to stop the commentary.

**2. The class.** D-Guy's review, from his player's seat. Tomatoes land and his forecast climbs under his class tag,
which only he sees. One thumbs up lands and it dips.

> Early playtests showed that people on a forum want to be liked. We considered this a design problem. So every
> character has a secret class, and some classes are paid for being disliked. This one is a Heel. Playtesters threw
> tomatoes at him and he made money. We then found they could hurt him by agreeing with him, politely. We didn't
> design that. We kept it.

**3. The gate.** D-Guy casts Whoops! on Snuckles's post. The card back there turns over: Rope Break. The ink never
lands, and the card is Snuckles's.

> Sometimes we need to stop a player from doing something. In our other games we use what we call a gate. Here, the
> gate is another player. Every card back looks the same, so you can't know what's waiting on a post. Playtesters
> described this as unfair. We agree.

**4. The vibes.** Snuckles's post, held. The last calm shot. The words are the owner's.

> I understand there may be some concerns that vibe coding was used on this project. I want to assure you that all
> vibes were completely negative, and that the requisite amount of human suffering for a project to count as art was
> achieved. In fact, it was exceeded, and I personally saw to it that that was the case.

### Part two: the music enters

**5. The read.** Snuckles throws the caught Whoops! back at D-Guy's review, and ink fills it. The back on D-Guy's own
post turns over: 4D Chess, naming Whoops!. He is paid for the ink he baited.

> This is a training arc. The player learns that a card can be caught, and then learns that being caught can be the
> plan. We found that about one playtester in five understood this. He won everything, and we couldn't work out who
> he was.

**6. The phrase trap.** Human Josh quotes Chadluminum and types "to be fair". A Steel Chair springs and dents his
post. A second speech bubble has appeared in the margin; nobody clicked it.

> A card can be set to go off when somebody says a particular phrase. This trains players to choose their words
> carefully, which, on a forum, we think is new.

**7. The mask.** The violins take the theme. The player switches masks: D-Guy becomes Chadluminum, and the tag
changes to Face. More bubbles drift in.

> Each player has several characters, and no other player can see which are theirs. So the argument you've been
> watching is, I think, mostly, one person. That's, um. There seem to be more nodes than we shipped.

**8. The node takes control.** The page scrolls by itself down the thread, past smoke, glitter, a rainbow, graffiti
and taped-over words. The pointer clicks a bubble. It keeps going.

> Some commentary nodes may take control of the forum in order to show something to you. In these cases, simply click
> again to stop the— I'm clicking it.

### Part three: full orchestra

**9. Everything, on one post.** It all lands on Snuckles's sprite sheet, a play to each entry of the theme: three
coats of ink, three chairs, smoke, a laugh track on "walk cycle", a donation banner, the old chatbot continuing his
post for him, Off Day in its legendary foil. The reader tries to scroll away and Stick Around holds the page.

> So the, the way we think about this is, any time you do something new there's a normal distribution of pain, and
> this is— that's a chair. This is not in the middle of the curve. Okay. This is GPT-2 finishing someone's post. Do
> we... do we have a filter on that? My god, there are laws about this stuff, you know.

The last three sentences are the owner's. "A normal distribution of pain" and "the middle of the pain curve" are
Newell's own, from his 2014 AMA.

**10. The Staff arrive.** FanGaME's memo. Two boards merge, with his reason on the notice. QC-1000 files the sprite
post. Every staff line is the second rehearsal's output, as in round 1.

> That's the moderator. He's a Personality Core, we found him in a pile, he's the permanent Boss, and nothing will go—
> he's merging the boards. To stop a commentary node, put your cursor over— I'm doing that.

**11. The chords.** A hard cut on each hammered chord: a chair, the ink, the Boss, the settlement summary opening. In
the gaps:

> Please let me know— / —what you think— / —after you have had a chance—

The final crash.

### Out

**12. Black.** Silence, held for several seconds.

**13. The end card.** A rainbow background, and in Comic Sans, the whole of this, word for word:

`DIVIDED WROLD (misspelled) (put the misspelled word 'world' in there for real)`

Obnoxious circus music. Gabe never comes back. The owner: "the joke being that it appears as if it was prompted-for,
repeatedly wrong, and still wrong in the final product."

### Why these plays

Each beat was checked against the rules on this date, and three first ideas were dropped because the rules refuse
them: a post holds one face-down card, so a Rope Break and a set Move cannot wait on the same post; a Move that lands
from a quote is not a cast, so it never meets Rope Break, 4D Chess or Whoopee Cushion; and Toll cannot already be on a
post written at the moment a sprung Move lands on it. What stands: a Heel is paid by excited-negative reactions and
costs on calm-positive ones; Rope Break catches a Salty common and takes it into its setter's hand; 4D Chess lets the
named Move land and pays its setter; a set Move with a "They say" phrase springs on the quote that says it, and the
Lens shows the phrase; Off Day names a class in public and nothing reaches a character to stop it; and Whoops!, Steel
Chair and Feelin' Fab each stack three deep.

## 5. The cut: who leads

**Decided:** the voice leads part one and the music leads the rest.

- **Part one** has no music. Each node's picture is held or trimmed to its voice clip, so any performance re-times it.
- **Parts two and three** sit on the recording, which cannot stretch. Each node has a window between measured points
  of the music (the block boundaries, the theme's entries, the coda's chords), and a voice clip must fit its window.
  The edit refuses a clip that overruns, naming the node, the window and the overrun, and prints every window's
  length as a timing sheet for whoever performs the lines. Node 11's fragments are meant to be cut off by the chords.
- **The voice track is a folder of clips, one a node.** Replacing the folder and running the edit again is the whole
  of a re-voice.

Weighed: the voice leading everything (the music would have to be cut and looped under it, and its one long
acceleration is the point); the music leading everything (part one has none).

## 6. Sound and captions

- **Music:** the Musopen Symphony recording of 2012 (the Czech National Symphony Orchestra), 2:34, as FLAC from
  Wikimedia Commons, which marks it released into the public domain by Musopen. IMSLP lists the same recording as CC
  BY 3.0, and Musopen's own page could not be read on this date. A credit satisfies either, and neither is
  share-alike, so round 1's question about Verdi's recording does not return. The film's description carries the
  credit, and the source page and a dated copy of its license are kept beside the film against a mistaken claim.
- **The game's own sounds** (`instances/divided-world/ui/sounds/`) play on the hits they belong to, under the voice.
- **Captions** are burned in, in the manner of Source's closed captions, and a subtitle file ships beside the film:
  most people meet this muted, on a phone.
- **The end card's music** is not chosen (section 9).

## 7. Where it is made, and what may be published

- **The takes** are filmed frame by frame from the stage story, as round 1's were, and can be filmed in a cloud
  session or on the owner's machine.
- **The final film is assembled on the owner's machine,** where the voice clips, the recordings and Comic Sans are.
  None of them is committed (`.runs/` is ignored). Without them the edit makes a silent cut with the captions, which
  is what a build session can show.
- **It is published only when its words are true** (the owner, on the Staff: in, as their own node, and the video
  waits for the switch): the Staff are switched on (`systemEnabled`), and every sentence a player could act on has
  been checked against the code that day.

## 8. The rules

- **The layers.** The stage, the script and the staff's lines are Divided World's (`instances/divided-world/ui/hype/`).
  The camera and the edit are the repository's tools (`tools/hype/`). The engine is not changed and learns no
  instance's name. The fake does not play a Move from a quote, so that shot seeds the spring and the card it landed,
  as the fake's own stories do.
- **The masks.** Nothing here reaches the app: the stage is drawn only by the story route and Storybook, on the fake,
  with a made-up cast. No real player, post or name is on screen.
- **Ways out.** No state is added that a player, a character or a post can be put in.
- **At a busy instance.** Nothing here runs in an instance.
- **Real people.** The register is drawn from a public figure's published commentaries, as parody; the persona is the
  instance's cartoon of a developer, as it already was. Nobody from the community is named or alluded to but the
  owner, by the owner's own wish, as Gabe's own history ("code I wrote when I was twenty").

## 9. Open

- **"This is GPT-2".** The card's words say "a chatbot from 2021" and the settings say the model is of "GPT-2's
  family". If it is not GPT-2 itself, the line misstates a mechanic. The owner knows the model; the plan's truth check
  stops on it.
- **Free, and by invitation.** Nothing in the video says so since the closing node was cut. One flat clause in the
  welcome would carry it; the owner has not said.
- **The circus music.** Fučík's "Entry of the Gladiators" is the obvious piece, and he died in 1916. No recording
  has been checked. A United States Marine Band recording, if one exists, would be a government work.
- **The style guide.** Whether Gabe's written voice (the Strategy Guide, Updates posts) moves toward this register.
- **What the picture gives away.** Node 2 shows a Heel hurt by a thumbs up, which the onboarding design counts among
  the things players are meant to find. The owner read the node twice and did not strike it; it stands unless struck.
- **The block timings** in section 2 are estimates from the score. The plan measures them on the recording.
