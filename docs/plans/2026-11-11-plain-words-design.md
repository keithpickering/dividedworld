# Plain words that are true: the log, the out-of-character screens and what a failure says: design

Record, written 2026-11-11. The design session for the first chunk of the bug scrub of 2026-11-11, with the owner. Its
plan is `docs/plans/2026-11-11-plain-words-plan.md`. The scrub read every open issue and found about twenty places
where the log or an out-of-character screen says something untrue (CLAUDE.md, "The fiction may lie; the log never
does"), spread over a dozen follow-up issues. Their parent is #133. Each section below was decided one question at a
time; the owner's words are quoted where they decided something.

## 1. The form: fixes, and one vocabulary for failures

The untrue words are of three kinds.

- **The fact is in hand and the words are wrong.** A ban's log line, a group move's pronoun, a house rule's notice, the
  empty log's When cell.
- **The data does not carry the fact.** Who heard an appeal, how a visit ended, what a caught play cost.
- **A failure is reported without saying which kind it was.** One sentence stands in for a timeout, a server error, a
  refusal and a device that is offline; a failed read is drawn as an empty list; a change that landed is said to have
  failed because the read after it did.

Three forms were weighed.

- A. A list of fixes, each sentence corrected where it sits.
- B. The fixes, and for the third kind one vocabulary: the client's data layer names the kind of failure, and every
  screen words its message from that.
- C. B, and standing checks that hold words to facts wherever one can be written.

**Decided** (the owner: "B works"). A fixes each screen that guesses today and leaves the next one free to guess. C's
checks are built only where one was already proposed and is cheap to drive red (section 6).

## 2. The kinds of failure

The data layer names these as facts about the device and the server.

| Kind | What happened | What the player can do |
|---|---|---|
| Not sent | The device reports itself offline; nothing left it | Try again; nothing can have happened |
| No answer | The request timed out or the connection dropped | A read: try again. A write: look before sending again |
| Server failed | The server answered with an error | Try again in a moment; the connection is fine |
| Refused | The server said no, in its own words | Read the reason |
| Done, not refreshed | The write landed and the read after it failed | Nothing to redo; reload to see it |

"Nothing here" (no screen answers to the address) exists already and is unchanged.

A browser can prove "not sent" only when it reports itself offline (`navigator.onLine` is false). Every other network
failure is "no answer", because a request that failed on the way may have arrived.

A write's answer already has two of these: a refusal in the server's words, and `uncertain` for an answer that was
lost (`engine/ui/data/api.ts`, `Refusal`). The design adds "not sent" to writes, and gives reads a kind at all: today a
read throws a bare error and the router folds every rejection, and its own 20-second limit, into one screen.

The `act` edge function answers "no answer came back, so this may have gone through" to every transport error,
including ones where the write was certainly never sent (#5). It says "it did not go through; try again" where that is
true.

## 3. What the load-error screens say

Three forms were weighed for the two full-page screens (the glass's and the board's).

- A. Say the cause: each kind has its own sentence and its own advice.
- B. One sentence true of every kind.
- C. The cause on the glass only; the board's page keeps one wording.

**Decided** (the owner: "A works"). "Check your connection" is advice only when the connection is the problem. The
words below are the owner's approved copy ("Wording works").

The glass, with Try again and Back to the board on each:

| Kind | Title | Lead |
|---|---|---|
| Not sent | You're offline | Your device reports no connection, so nothing was sent. Reconnect, then try again. |
| No answer | This screen didn't load | The server didn't answer within 20 seconds, or the connection dropped on the way. Loading a screen changes nothing, so nothing was lost. |
| Server failed | This screen didn't load | The server answered with an error. Your connection is fine, and nothing was lost. Try again in a moment. If it keeps happening, tell an admin. |

The board, in the browser-error style it has today, under the heading "The page cannot be displayed":

| Kind | First paragraph | Advice |
|---|---|---|
| Not sent | You are not connected, so {site name} was never asked for this page. | Check that your connection is working; Try again; the browser's Back button |
| No answer | {site name} did not answer in time, or the connection dropped on the way. | As today |
| Server failed | {site name} answered, but with an error. Your connection is working. | Try again in a moment; if it keeps happening, tell an admin; back to the index; the browser's Back button |

"Tell an admin" links to the contact page on both. The owner chose to add it ("Agreed with A"): a server error that
repeats is the one kind a player can neither wait out nor fix.

## 4. Screens that guess today

| Screen | Today | Decided |
|---|---|---|
| A screen that draws the player's characters from the provider, after that read failed (#68; narrowed under "Where the design stops") | An empty list, read as "no characters" | "Your characters couldn't be loaded." with Try again |
| The Reveal, Debut and Turn dialogs, when the change landed and the read after it failed (#183) | "…could not be sent. Check your connection and try again." | The dialog closes as done, and its done line adds "This page may be out of date until you reload it." |
| The search box, after a failed suggestion read (#327) | "No suggestions" | "Suggestions couldn't be loaded." |
| The shine tip's tilt choice, after a refused save (#270) | Reverts with no words | Shows the refusal |
| Any write, when the device is offline | Sent, then "may have gone through" | Not sent: "You're offline, so this was not sent." |

How many places read the session and the preferences, and what the HUD shows while a read is out, are #124's design
and are not decided here.

## 5. Facts the data must carry

**A dropped visit (#316).** No code path lets an admin end a visit. The only writer of a visit's `reversed` outcome is
the tick, when a visit has failed to file ten times and is dropped, yet the Lens, the mark and the visit's page say an
admin ended it. The tick writes a new outcome, `dropped`, worded "could not be filed and was dropped", and `reversed`
is kept for the admin's reversal #315 asks for. A `reversed` end an instance already holds that names no Act behind
it (its `by_act` is null, as the tick wrote it) reads as dropped, so no Act is edited (CLAUDE.md, "Append-only").

**Who heard an appeal (#371).** The log's ruling line on a group move names the office stamped on the move. Once the
move's maker has left the staff, the current Boss hears the appeal, and the log names the wrong one. The read carries
the office that ruled, and the line names it. A ruling is stamped with its hearer's office from now on, as a move
is; a ruling an instance already holds has no stamp, and its line names no hearer ("{name}'s {group} was upheld on
appeal").

**A ban's log line (#316).** "Your other characters are not banned" was unconditional. It becomes "The ban is on
{name} only; each character has its own warn bar", a rule that is always true. A ban an appeal overturned,
shortened or lengthened says so, where today it says the ban "ended by itself": the log's read swaps the ruled end in
for the ban's own and carries no word of the ruling, so the read gains the verdict.

**A group move's pronoun (#371).** "barred it from posting" uses the character's pronouns.

**A house rule's notice (#316).** The notice recognizes "House Rule N" as well as "Rule N", so it no longer reads
"Rule 1: House Rule 1".

**The empty log's row (#258).** Its When cell is a dash when the next settlement is overdue, as its sentence already
leaves the time out.

**A face-down card's end in the Lens (#138, the sixth question).** The date comes from the compiled `setLasts`, so it
drifts if an admin changes the setting. The server stores each face-down card's end when it is set
(`face_down.ends_at`), and the screens read that. The play form's line for a card about to be set reads the server's
setting, not the compiled one.

**The claim refusal (#191).** A player who reveals in the seconds before a run claims the window, and reveals again,
is told the Turn takes effect at a settlement that then passes it over. The claim branch is skipped where the earlier
reveal already rules the Turn out.

**The wallet's refusal (#352).** It states its amounts in orbs, as the machine's refusal beside it does, not in
hundredths.

**The quiz's terms (#443).** "A wrong answer" becomes "An answer other than {the Mod}'s", since a Mod's answer key may
be wrong on purpose and the glass may not call the right answer wrong.

### The price a caught play quotes (#352)

The log's line for a caught play gives the card's price at the machine and the cast's cost. The hand is a count
(acquisitions less plays), not a set of copies, so "the copy that was played" has no price of its own once a player
has held two.

- A. First in, first out: the nth play of a card is the nth copy acquired; a pulled copy reads "from a pack".
- B. Drop the machine's price; the line says what the cast cost and that nothing came back.
- C. The most recent acquisition, bought or pulled (the issue's suggestion): still wrong when two copies were bought
  at different prices.

**Decided** (the owner): "I think B is fine especially since there will eventually be other ways to obtain cards. The
additional cost of the specific cast is more relevant here. Someone could hold a card for years and finally use it; at
that point the original cost is not really relevant".

## 6. Copy the owner approved

**The sign-in door's "New here?" block (#258)**, by the instance's registration mode:

| Mode | Words |
|---|---|
| Invite | Registering takes an invite from someone who plays. The same email code signs you in after. (unchanged) |
| Open | Anyone can register. The same email code signs you in after. |
| Closed | Registration is closed right now. You can still leave your email; when an admin opens registration, your next sign-in opens your account. |

The register form's lead, when registration is closed: "No password. We email you a code and a link. Registration is
closed, so your account opens once an admin opens it."

**Settings' sentence for the "Words put in your mouth" alert (#336).** "A post quotes one of your characters with
words that aren't in the post it points to." The server knows only that the words are not in the post the quote
names, not that the character never said them. The title stays.

**The Strategy Guide's "Coming attractions" (#371).** It lists Mod Bots, rules and the warn bar, and reports and
appeals as not built. They are built; The System is switched off in this instance (`systemEnabled` is false).

- A. Say what is true here: the list becomes "Built, and not switched on here yet", and "More cards" moves to its own
  line of what is still to come. A build check ties the section to the instance's switch.
- B. Drop the three until The System is on.
- C. Write their full guide sections now, marked as not yet switched on.

**Decided** (the owner: "A").

The door's and Settings' drafts were shown with this question and the owner raised nothing on them; they are in the
plan as shown, and the owner reads them again in this PR.

## 7. Checks

Two, each with a self-test that drives it red (CLAUDE.md, "A guard that has never been red is not known to work").

- **A visit's words and what the database records** (proposed on #316). Each `visit_end` outcome's words name no
  actor the SQL never records for it, and the notice is rendered for every shape of rule number. Poisons: the old
  `^Rule \d` test, and a writer of `reversed` with no account.
- **The guide and the System's switch.** The "not switched on here yet" section exists exactly when the instance's
  `systemEnabled` is false. Poison: the section present with the switch on, and absent with it off.

## Where the design stops

**Decided** (the owner: "A works"): everything where plain words are untrue is in. Three neighbors are their own
chunks.

- **Things that leave no log line** (#89: a Turn in an unscored window, a washed-clean Whoops! layer). The log is
  incomplete there, not untrue, and each line needs its own small design.
- **Card copy that understates what a card does** (#349, and items in #420, #390, #398, #422). Instance copy the
  owner approves; five cards are better read in one sitting.
- **An admin reversing a visit, an infraction or a ban** (#315). A feature with its own design. This change only
  stops a screen from claiming it exists.

What a suspended or banned account is told at sign-in (#5) is already decided in
`docs/plans/2026-11-02-conduct-design.md` and is being built in PR #428.

Reacting to a reveal (#5) was confirmed with the owner as a wording fix, and reading the code afterward showed it is
already right: `react` says "there is no such Act" only for an id that names no Act. It is not in the plan.

The failed read of a player's characters (#68) is narrower than the issue says. My characters and the profile editor
now read their own route document, so a failed read there is a load-error screen. What remains is the player's
provider, whose failed read is held as "loaded, with no characters"; the plan fixes that and the screens that draw
from it.

## The layers

Everything in sections 2 to 5 is engine: the kinds, the router, both error screens, the dialogs, the log's lines and
the SQL. The board's error page reads the instance's site name through the interface it has today
(`ui.copy.siteName`). Two things are instance content: the Strategy Guide
(`instances/divided-world/guide/strategy-guide.md`), and the guide check's reading of the instance's settings, which
`tools/check-guide.mjs` does already. The engine learns no instance's name.

## What could slip a mask

Nothing here is computed from a private fact (CLAUDE.md, "A response never proves a private fact").

- The kinds of failure describe the device and the server, and are the same whoever asks and whatever they ask for.
  "Refused" carries the server's words as it does today, and no refusal's words change here except the two named
  in section 5 (the claim and the wallet), which a player gets only about their own character and their own wallet.
- The log's changes read only rows the player's own log already reads. The office that ruled an appeal is public
  with the ruling.
- The sign-in door's words depend on the instance's registration mode, which is the same for every visitor.

## Ways out

The design adds no state a player, a character or a post can be put in. `dropped` is a way a visit ends, and it is
final as `reversed` was. Each failure screen names its way on: Try again, Back to the board, or the contact page.

## Open

- **A fourth kind the session found while planning, with words the owner has not seen.** A load can also fail
  because the page's own code threw, which is neither the connection nor the server. Calling it either would be
  untrue, so the plan gives it its own lead on both screens: "Something went wrong while loading it. Nothing was
  lost. Try again, and if it keeps happening, tell an admin." The owner reads it in this PR.
- **The ban line's words for an appealed ban** ("An appeal overturned the ban on {date}", "An appeal shortened the
  ban", "An appeal lengthened the ban") are the plan's drafts, for the owner to read in this PR.
- Whether the board's error page should gain a separate server-error page in the style of a 2003 browser's
  "HTTP 500" was raised and left: the three paragraphs above sit under the one heading.
- The words an admin's reversal of a visit will use wait on #315.
