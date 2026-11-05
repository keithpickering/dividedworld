# The front door: what a signed-out visitor meets

Record, written 2026-11-05. A design session with the owner, who opened it asking for "a more full-fledged landing
page. Currently we just load to the board with a 'this board is private' message and a sign in link. Would be nice to
have something more introductory to the concept inviting a signup." The plan that carries it out is
`docs/plans/2026-11-05-front-door-plan.md`. The sketches the owner chose from are in `.impeccable/mocks/decision/`
(`the-invite.html`, `the-thread.html`, `the-season.html`).

## 0. Where it starts

Read from the code on 2026-11-05:

- Signed out, every board route (the Index, a board, a thread, a profile, a record) draws `SignInPrompt`
  (`engine/ui/mini.tsx`): "The board is for players. Sign in to read it." The glass pages draw the same line on a calm.
- The HUD signed out holds one control, Sign in (`engine/ui/frame/Hud.tsx`), and nothing else.
- Registration is passwordless and follows `settings.registrationMode` (`open`, `invite`, `closed`); Divided World runs
  `invite` (`engine/ui/account/SignIn.tsx`).
- The onboarding design recorded the owner's choice that signed out stays hidden, "the friend who sent the invite is the
  pitch" (`docs/plans/2026-11-02-onboarding-design.md`, section 1). This design changes the pitch, not the hiding: no
  real post, character or count is shown signed out.

## 1. The board stays hidden; the front door is staged

**Decided** (the owner chose "Hidden, staged demo"): the front door shows a made-up thread, labeled as a sample, and
nothing read from the server. No real post, character, board name, count or presence appears. Every visitor sees the same
page, so nothing on it is computed from a private fact (CLAUDE.md, "A response never proves a private fact"); the
one setting it reads, `registrationMode`, is the instance's public setting.

Weighed: words only (no demo), which explains the game without letting a visitor touch it; a public teaser of real
board content, which needs new public reads and undoes the "post openly" reason the owner gave for hiding the board.

## 2. The structure: the Sample Thread

**Decided** (the owner chose sketch 2 of three, "the most unique"): the front door is a board page, in the 2003 house
style, inside the ordinary frame. The banner and navigation are the board's. The page is one thread,
"how do we explain this place to the new person", labeled **Sample thread · made up**, with the HUD docked under it as
on every board page. The seam between the two worlds is visible in the first viewport.

Weighed: The Invite (one oversized postcard on the glass, with the invite field on its address side), and The Season (a
glass title page with the season's five steps). Both explain the game on the glass alone; neither shows the board.

### 2.1 The thread

**Decided** (the owner): the sample characters argue with each other about how to explain the game to the newcomer.
They are the demo world's made-up names (Spritey, Pipewrench, Mrs. Hooligan), drawn with the real postbit (rank and
pips) but without links, since there is no profile behind them. Each post has a static row of reaction counts in the
board's style (no React button, since nothing can be pressed). The owner approved the draft copy as written in the
plan's Task 1. It is the instance's copy, committed to the repository, and can still be edited in the PR's review.

**The splat is real.** Mrs. Hooligan's post carries a Whoops! play, drawn by the instance's own card effect
(`CardUi.Effect`) with a fixed seed, so the visitor scrubs the ink to read the post that explains Aura and postcards.
The visitor is a reader, never the author: their strokes stay on their screen, nothing is saved, and a reload brings
the ink back. The card's keyboard path ("Hold to scrub", drawn by the engine's `Kit`) sits under the post as it does in
the Lens, so the obstacle costs the same either way (CLAUDE.md, "An accessible path costs what the obstacle costs").
The same facts are in the persona's closing post in plain words, so no one has to scrub to learn the rules.

### 2.2 The persona's note

**Decided** (the owner chose "Glass plain + Gabe note"): the thread ends with a post from the instance's developer
persona (`instance.developer`, Gabe), drawn in the glass as the Updates page draws the persona's posts (`PersonaMark`,
name, tagline). It settles the argument in four plain, true lines. It is the persona's voice, allowed because it is
committed copy the owner approves in review (CLAUDE.md, "The fiction may lie; the log never does"). It names no number a
retune would make untrue except through `{{setting:...}}`, which the guide's renderer fills.

### 2.3 The HUD, signed out

**Decided** (the owner): the HUD's plate reads **"Who will you play as?"**, with a one-line description of the game under
it for a visitor who has not read the thread. Its action follows `registrationMode`:

| Mode | Primary | Under it |
|---|---|---|
| `invite` | **Register with an invite** (to `/register`) | "No invite? Ask someone who plays." and Sign in |
| `open` | **Register** (to `/register`) | Sign in |
| `closed` | none | "Registration is closed for now." and Sign in |

Both links keep the address the visitor was on as `next` (`signInHref`), so a friend's link to a thread returns there
after the account opens. The empty orbs, clock, Alerts, Menu and Hand stay away while signed out, as today. The prompt
and the line are the instance's copy (`InstanceUi.frontDoor.prompt`); the mode's words are the engine's, plain and
out of character.

## 3. Where it appears

**Decided** (the owner chose "Every board address"): signed out, every board route that drew `SignInPrompt` draws the
front door instead: the Index, a board, a thread, a profile and a record. A link a friend sends opens on the front door
and returns to its address after sign-in. The glass pages (Settings, the Guide, My log and the rest) keep the plain
sign-in line, since they are not the board.

## 4. Layers

- **Instance:** the thread's title and label, the cast, the posts' BBCode, their reaction counts, the card played on a
  post (its key and config), the persona's note (Markdown), and the HUD's prompt and line. A new `InstanceUi.frontDoor`
  (`FrontDoorUi`) carries them.
- **Engine:** the screen (`engine/ui/front-door/FrontDoor.tsx`), which draws whatever the instance gives with the
  board's postbit and BBCode, the instance's card effects through `CardUi`, and the persona's post through the guide's
  renderer. It never names a card, a class or a character. `instanceUiProblems` refuses a front door whose post names a
  character not in its cast, a reaction the instance does not have, or a card with no `CardUi`.

## 5. States and ways out

The front door adds no state a player, character or post can be put in. The visitor's way on is Register or Sign in,
on every board address, and both return them to that address. A splat a visitor scrubs is their screen's alone and ends
on reload.

## 6. Open

- Whether the front door gets a phone-specific order (the HUD's plate wraps the line under the prompt today). The plan
  builds the phone board's HUD layout and checks it at 390px; a different order is a follow-up if the owner asks.
- Whether a second sample thread, or a rotating one, would earn its keep. Not built.
