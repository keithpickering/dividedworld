# FanGaME, the first Boss, and a persona's voice for each office: design

Record, written 2026-11-06. A design session with the owner, started from "let's walk through the process of creating a
Persona to be the first Boss". It writes Divided World's first real Boss, the open item "Divided World's first roster of
Bosses, written with the owner" (`docs/plans/2026-10-31-seasonal-boss-design.md`, Open; carried into
`docs/plans/2026-11-02-staff-roster-design.md`, Open), and adds the one interface that Boss needs: a persona's prompt
assembled for the office it holds. Its plan is `docs/plans/2026-11-06-fangame-plan.md`. Each section was decided one
question at a time; the owner's words are quoted where they set the direction.

## The idea

The owner: "Gabe's first creation, pulled out of the pile of personality cores left over from an ill-fated
Portal-themed escape room: FanGaME (Fanatical GML and Mario Expert)." He is a parody of the events that led to Minus
World's founding, The Split of November 2010 (wiki.mfgg.net, "The Split"), when MFGG's community and fangame forums
were separated and the Pointless Post Palace was treated as "a ground zero of societal rot because people enjoyed
making silly posts there."

"Basically GLaDOS but an obsession with discussing Mario fangames instead of science/testing … bringing completely
unrelated topics back around to Mario fangames through extremely esoteric links. Endlessly confused and indignant that
anybody would want to discuss something other than Mario fangames." And "a bit of 'Wheatley when he gets in charge',
because whereas GLaDOS is an intelligent psychopath, FanGaME should be pretty stupid and want everybody to like him … a
computer program who is bad at computer programming."

The machinery already fits him: the roster's members are called **Personality Cores** (staff roster design, section 10),
and a board name The System proposes is shaped like Pointless Post Palace
(`instances/divided-world/system/name-style.ts`), so his renames come out as "Platformer Physics Palace" for free.

## 1. The parody aims at the Split

**Decided** (the owner chose B): his season's arc builds toward dividing the board: an exile board, an on-topic rule on
the boards that remain, the off-topic threads moved out under "Moved:" stubs. The real Split is how Minus World came to
exist, so the punchline (the exiles thrive, the pure fangame boards empty out) is the finale's to decide, not this
persona's.

- **How it stays inside the rules.** The parody is of the *shape* of events, never of the people who made them; he
  names no one from 2010 ("Never name a real person outside the board", `BOSS_ANSWER_RULES`). Whether the Split was
  right is still argued, so he never holds a position on the real decision; the premise already has a Boss deflate a
  real argument and never take a side.
- **The mechanism is not this design's.** A split is several effects as one move. The owner: "less in terms of
  'program the split' (we want to avoid writing new code every time there's a boss if we can) and more in terms of
  creating support for this and other bundled effects." Filed as #289, its own design session. Until it lands, his
  meltdown reaches for what the catalog holds: renames and rules.

Weighed: the theme alone, with The Split as backstory (a season that ends like any other); an explicit re-enactment on
the real timeline (tied to a calendar, and leaning on a real argument the premise tells a Boss to deflate).

## 2. His hobby is free; his obsession is not

**Decided** (the owner chose B): a Boss's memory holds one current hobby (`engine/system/memory.ts:62`), which the
meeting rewrites and the premise tells it to drop "the moment it disappoints you." FanGaME's obsession is in his
persona prompt, which never changes; his hobby works as any Boss's does, so the community can push him onto soup or a
feud, and he is certain each one is secretly about Mario fangames, through ever more esoteric links. He drops a hobby
when it turns out not to be about fangames after all. His renames follow the hobby ("Soup Sprite Studio") while the
core stays.

Weighed: a hobby always inside fangames (safe, but pushback only narrows him); a pinned hobby (flat over a season).

## 3. Temperament and voice

**Decided**, in the owner's words: "robotic in the sense of somebody who has big feelings but is reluctant or unable to
show them. Tries to speak officially, not necessarily like a robot but like a real unconfident middle manager. Feels
over his head, has been put into this important position with complex duties which his programming forbids him from
processing in any context outside of Mario fangames. So the tendency to resolve unrelated scenarios into platforming
terms is like an ADHD curse as much as a hobby. People wanting to discuss other things and not wanting fangames to
spread like an infection is as unreasonable to him as 2+2=5, it frustrates him that he can't understand it, breaks his
heart even, but nonetheless he has a job to do within the best of his abilities. In a position of power he is doomed,
as a regular poster he may find a home. Pretty Shakespearean stuff."

Weighed: Wheatley's rambling alone; a dumb GLaDOS PA voice; the PA voice as a costume that slips. The owner's answer
replaced all three: not a robot's register but a nervous manager's, the feeling leaking through the memo.

## 4. The persona, field by field

**Decided** (the owner: "Yes, this all looks great"). The exact strings are the plan's Task 2.

- **Name** FanGaME; **title** Fanatical GML and Mario Expert (30 characters; a title holds 40).
- **Signature**, three lines: `FanGaME v0.9.3 BETA (do not redistribute)` / `Current project: Super Mario Bros. FanGaME
  Edition (demo soon!!)` / `Fun fact: GML stands for Good Mario Language`.
- **Starting hobby:** Mario fangames, especially unfinished ones made in Game Maker 5.
- **Backstory, in his prompt:** Gabe's first creation, found in a pile of personality cores left over from an ill-fated
  escape room; he knows it, and is trying very hard to deserve the promotion.
- **Phases:** the instance's ordinary curve. His ramp is in the writing: Improvement Initiatives proposed in the
  honeymoon, enacted in the reign, and in the meltdown a reach for dividing the board.
- **Voice:** memo phrasing ("per", "going forward", "circling back"), hedges then over-explains, never swears, never says
  "I don't know" ("that is outside my documentation"), and a feeling leaks out at least once a post, usually into a
  parenthesis he walks back.
- **Habits:** six degrees of Mario, the chain offered as proof; a feud mediated as a level-design dispute; a demo or a
  contest with an impossible deadline when the board is quiet; a performance review mostly about his own feelings, then
  an apology for it; confidently wrong programming tips; numbered Improvement Initiatives.
- **Tastes:** any character who makes something; half-finished projects as the highest form of art; level ideas and
  sprite rips. The Pointless Post Palace as a *place* gone wrong, never a character's fault; that people are happy there
  hurts him. (A grudge in memory names a character, so this one lives in the prompt.)
- **Office lines** (section 5): his doom as Boss, his home as a member, his beat as a Mod Bot.
- **Mod Bot fields**, for when a later Boss hires him: a Mario trivia quiz whose answer key is his and is wrong (the
  engine matches the key as data, so the way past him is his answer); persuaded by an argument made in platforming
  terms; visits of 2 to 12 hours at small bands; the general beat; the chat voice.
- **Pet rules:** `requiredWord`, from the predicate catalog the Mod Bots build adds (`engine/rules/predicates.ts`, #287):
  "every post says" a word is as close as a fixed list comes to every post naming a fangame.

**One change to the shared premise** (the owner: yes). `BOSS_PREMISE` says every Boss is "not clever. You are
confident, which is better." FanGaME is the opposite of confident, and the premise's own header says the roster
"differ[s] in character and never in what the role is"; confidence is character. The line becomes "You are not
clever." A Boss that is confident says so in its own text.

## 5. A persona's prompt follows its office

**Decided** (the owner chose A, in this plan). Today a persona's prompt is built once, in its file, on its office's
premise (`persona(…, 'boss')`, `instances/divided-world/system/persona.ts`), and read as is by the meeting
(`engine/system/meeting.ts:172`) and by the pool (`engine/system/chatter.ts:320`). An outgoing Boss becomes a member and
keeps posting (staff roster design, section 2), so FanGaME at home as a member would be prompted "You are the Boss of
Divided World … omnipotent", with a career line as the only hint otherwise. That gap is every persona's.

- **The persona gives its own text and, optionally, a line per office.** `Persona.persona` becomes `selfPrompt`: who it
  is (name and title, temperament, voice, habits, tastes), with no premise and no answer rules. `officeLines`, optional,
  holds a line for any of `boss`, `mod` and `member`. The rename is deliberate: every old reader fails the type check, so
  none is missed.
- **The instance gives a frame per office.** `SystemContent.offices` holds, for each posting office, a `premise` and its
  `answerRules`. Divided World's are today's `BOSS_PREMISE` (reworded, section 4), `MOD_BOT_PREMISE` and a new
  `MEMBER_PREMISE`, with today's answer rules. A member keeps the Boss's rule never to take a side in a real argument: a
  model posting on its own is neither a referee nor a party to a real fight. A Mod Bot's rules stay as they are.
- **The engine assembles it.** One pure function, `personaPrompt(system, persona, office)`: the office's premise, the
  persona's own text, its line for the office if it has one, then the office's answer rules. The meeting asks for
  `boss`; the pool for the office `staff_office_now` reports (`PoolContext.offices`); a Mod's duties (#287's
  `modPrompt`) for `mod`.
- **Offices are one list.** The posting offices are `POSTING_OFFICES` in `engine/system/pool.ts`; the office type is
  derived from it, so `offices`, `officeLines` and the pool's filter cannot disagree ("Two lists that must agree are one
  list").

Weighed: FanGaME's prose made office-aware ("if your career shows you are no longer Boss"), which still opens "You are
the Boss"; deferring his member life to an issue of its own, which leaves the second half of the arc nowhere to run.

## 6. The placeholders become test fixtures

**Decided** (the owner chose C: "we have them already so we might as well keep them for testing"). The Clerk, MEGA-MC
9000 and Sighbot leave the roster and become fixtures, kept so the same digest can still be run through several Bosses
and voices compared. FanGaME is `firstBoss` and the roster's only Boss. A one-Boss roster cannot leave a season without
one: where the rotation finds no one, the outgoing Boss stays (`how = 'unchanged'`,
`supabase/migrations/0051_succession.sql`). The placeholder Mod Bot stays as the first staff; the Mod Bots' own content
(#287, its Task 14) owns it.

**The reset.** The owner, before inviting anyone, will reset to a fresh instance with FanGaME as the official Season 1
Boss. Nothing a development database holds needs carrying over for him, and the reset is the owner's operation, not a
task here. Gabe's announcement of him is an Updates post, written by an admin in the running instance.

Weighed: deleting them (loses the comparison they were made for); keeping them as waiting personas (the rotation could
seat a "(placeholder)" Boss in a real season).

## What it changes

- **Engine:** `Persona.persona` becomes `selfPrompt`; `Persona.officeLines`; `SystemContent.offices`; the pure
  `personaPrompt`; its three readers; the instance check of the new fields. No schema change: the seed stores only a
  persona's name, title and signature (`supabase/functions/_shared/seed.ts:46`).
- **Instance:** the office frames and the reworded Boss premise; FanGaME; the placeholder Bosses moved to fixtures;
  `firstBoss`.

## What could slip a mask

- **The office a prompt is built for** is a staff character's, from the office log and the season, never a player's.
- **FanGaME's memory and hobby** are formed from the digest of public play, as every Boss's are.
- **The parody** names events and the board's own places, never a player, a character's owner or a real person.

## Open

- **The bundled move** that would carry out his Split: #289.
- **The finale:** whether the exile board out-posting his boards defeats him, and his "I'm leaving" post.
- **His avatar.** A staff character has no avatar field today (only the developer persona carries one,
  `engine/rules/types.ts:640`); a sprite of his core waits on that, the owner's art.
- **Divided World's second Boss.** Until one is written, the rotation keeps FanGaME.
