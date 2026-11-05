# The front door: plan

Record, written 2026-11-05. Carries out `docs/plans/2026-11-05-front-door-design.md`. Every task goes test first: the
failing test and its red run, then the code. Run only the changed code's tests during a task, and `npm run build` once
after the last task.

World: the board (the 2003 house style) for the thread; the glass for the HUD's plate and the persona's post
(`docs/plans/2026-10-29-two-worlds-design.md`). The sketch the build matches is
`.impeccable/mocks/decision/the-thread.html`, with the owner's two changes (the cast argue; the HUD reads "Who will you
play as?").

## Task 1. `FrontDoorUi`, and Divided World's front door

Model: sonnet

**Files:** `engine/ui/types.ts` (the interface, and `frontDoor` on `InstanceUi`), `engine/ui/tips/problems.ts` (the
checks, beside `instanceUiProblems`'s others), `engine/ui/tips/problems.test.ts`,
`instances/divided-world/ui/front-door.ts` (new), `instances/divided-world/ui/index.ts` (wire it), and every test
world that builds an `InstanceUi` by hand (`engine/ui/test-world.tsx` and any other `rg "onboarding:"` finds) gets a
small front door of its own.

```ts
export interface FrontDoorCharacter {
  /** Unique in the cast: what a post's `by` names. */
  readonly key: string;
  readonly name: string;
  /** The postbit's custom title, as a character's. */
  readonly title?: string;
  /** Which of the instance's ranks the postbit draws (index into `instance.ranks`). */
  readonly rank: number;
  readonly posts: number;
}
export interface FrontDoorPost {
  readonly by: string;
  /** BBCode; `{{setting:<path>}}` is filled from the instance's settings, as the guide's are. */
  readonly body: string;
  /** Counts shown on the post, by reaction key. Static: nothing can be pressed. */
  readonly reactions: Readonly<Record<string, number>>;
  /** Cards played on the post, drawn by each card's `CardUi.Effect`: its key, who cast it, and its config (a seeded card's seed included). */
  readonly plays?: readonly { readonly card: string; readonly by: string; readonly config: Readonly<Record<string, unknown>> }[];
}
export interface FrontDoorUi {
  /** The sample thread's title. */
  readonly title: string;
  /** The visible label that says the thread is made up. */
  readonly label: string;
  readonly cast: readonly FrontDoorCharacter[];
  readonly posts: readonly FrontDoorPost[];
  /** The developer persona's closing post, Markdown with `{{setting:<path>}}` markers, drawn through the guide's renderer. */
  readonly note: string;
  /** The HUD's plate signed out: its heading and the one line under it. */
  readonly prompt: { readonly title: string; readonly line: string };
}
```

**Checks** (`instanceUiProblems`): a post's `by` or a play's `by` that names no cast key; a reaction key the instance
does not have; a play's card with no `CardUi`; a cast `rank` outside `instance.ranks`; duplicate cast keys; an empty
`posts`. Each problem names the post by its index.

**Divided World's copy** (approved by the owner on 2026-11-05 as the draft; the owner may still edit it in review):

- title: `how do we explain this place to the new person`
- label: `Sample thread · made up`
- cast: Spritey (Main Eventer rank, the highest of the instance's ranks the demo uses; posts 1204), Pipewrench (title
  "Enhancement Talent", lowest rank, posts 212), Mrs. Hooligan (a middle rank, posts 388). Ranks by index into
  `instance.ranks`, chosen so the pips differ.
- posts:
  1. Spritey: `ok someone new is reading. be normal.\n\nHi! It's a forum. You post. That's it.` Reactions: fire 4,
     eye-roll 2.
  2. Pipewrench: `That is not it. Everyone here plays up to {{setting:charactersPerPlayer}} characters. Each one wears a
     mask and has a secret class, and the class decides which reactions make it stronger.\n\nI'm one of them. Or I'm
     not.` Reactions: tea 3, tomato 1.
  3. Mrs. Hooligan, with one Whoops! cast by Pipewrench (config `{ color: '#ff3d7f', seed: <a fixed integer chosen so
     the splat covers the middle lines> }`): `Don't scare them. Reactions settle into Aura at the settlement, and Aura
     buys postcards you play on other people's posts. Like this one.\n\nPipewrench, if there's ink on my post I know it
     was you.` Reactions: cursing 2, handshake 1.
  4. Spritey: `The best part is nobody knows who anybody is. At the end of the season every character's class is
     revealed. Never who played it.` Reactions: heart 5.
  5. Pipewrench: `So you could be talking to your best friend right now.` Reactions: star-struck 2.
  6. Mrs. Hooligan: `Or your worst enemy. Same person, usually.` Reactions: fire 6, raised-hands 3.
- note:
  ```
  Hi. I made this. They're mostly right.

  - You play up to {{setting:charactersPerPlayer}} characters, each with a secret class only you can see.
  - Reactions turn into Aura at each settlement, {{setting:settlementLength}} apart. Spend it on postcards and play them on posts.
  - Every season ends with every character's class revealed, and never the player behind it.
  - It's for adults, and for now it's by invite.
  ```
- prompt: title `Who will you play as?`; line `A message board where everyone wears a mask, and everyone is someone you
  know.`

**Tests first:** each check fails on a poisoned front door (a post by an unknown key, an unknown reaction, a card with
no `CardUi`) and passes on Divided World's; `instances/divided-world/ui/index.test.tsx` holds its front door to
`instanceUiProblems` with no problem.

## Task 2. The front door screen

Model: sonnet

**Files:** `engine/ui/front-door/FrontDoor.tsx` (new), `engine/ui/front-door/front-door.css` (new),
`engine/ui/front-door/FrontDoor.test.tsx` (new), `engine/ui/postbit/Postbit.tsx` (a `link` prop, default true: false
draws the name as text).

`FrontDoor` is a board page: `<div className="kb-front-door">` inside the frame, with the breadcrumb row
(`{siteName} » {title}`), the label as a visible tag beside it, the title as the page's `h1`, then the posts as the
thread draws them: an `article` per post with the postbit (side layout; stacked below the thread's breakpoint, as
`Thread.tsx` chooses), the post's body through `BbCode`, and its reactions as non-interactive chips in the reaction
row's style (`emoji count`, the emoji `aria-hidden`, the chip named "`<count>` `<emoji>`" for a screen reader by the
reaction's own label where the reactions UI has one). No Quote, Spin, Edit, React or permalink: nothing is pressable
but the card's controls and the HUD's links.

The staged people: each cast member becomes a `PostbitPerson` with a `Character` built in the screen (id
`front-door:<key>`, no avatar, `joined` omitted, `pipStyle: 'default'`, not staff), its `standing` chosen so
`rankIndex` lands on the cast's `rank`. Read `rankIndex` (`engine/ui/postbit`) for how standing maps to a rank.

The plays: for each play, the card's `CardUi` from `ui.cards`; its `Effect` wraps the post's words with a `CardPlay`
(id `front-door:<post index>:<play index>`, layer 1, caster the cast member's id, empty message, the config as given,
`playedAt` a fixed instant, `post` the staged post's id), `states: {}`, `released: new Set()`, reader
`{ author: false, caster: false }`, place `'thread'`, reach the post's own, `still: false`, `marks: null`, `save` and
`release` answering a refusal ("this is a sample post"), `nameOf` from the cast, and `show` kept in state so the
card's controls (the view's `controls`) are drawn under the post with `Kit`. Read `EffectProps` in
`engine/ui/cards/types.ts` for every field and supply each; a field this plan missed is a plan gap. A card with no
`Effect` draws the words alone.

The staged `Act` for each post: `kind: 'post'`, `seq` its index + 1, `currentPayload.body` the filled BBCode, and the
other fields as `Act` requires (read `engine/ui/data/api.ts`).

The persona's post follows the thread, in the glass: a `kb-glass` panel with `PersonaMark`, the persona's name and
tagline (`instance.developer ?? DEFAULT_DEVELOPER`), and the note through the guide's `parse` and `Blocks`, filled with
`settingText` as `Welcome.tsx` does. Its heading is a visually hidden `h2` ("A note from `<name>`").

`{{setting:<path>}}` in a post body is replaced with `settingText(path, settings) ?? DASH` before `BbCode`.

The screen reads nothing from the API. It is wrapped in a `region` labeled by the label text, so a screen reader hears
that it is a sample.

**Tests first** (`FrontDoor.test.tsx`, on the test world): the title is the `h1` and the label is visible; each post
shows its author's name as text, not a link; reaction chips are not buttons; a post with a play of a test card draws
that card's effect around its words; the card's controls from `show` appear; the persona's note shows its filled
setting; a setting marker in a post is filled; and the API is never called (a spy on every method of the fake).
Postbit's `link={false}` draws no link (`Postbit.test.tsx`).

## Task 3. The HUD signed out

Model: sonnet

**Files:** `engine/ui/frame/Hud.tsx`, `engine/ui/frame/frame.css`, `engine/ui/frame/Frame.test.tsx`.

Signed out, the plate holds, in place of the lone Sign in: a square mark with "?" (`aria-hidden`), the prompt's title
as the plate's heading (`kb-glass-display`, as a character's name is drawn), and the line under it. The HUD's side
holds the action by `settings.registrationMode`, as the design's table in section 2.3 says, with the engine's words:

- invite: a `kb-glass-cut-button` link "Register with an invite" to `/register` with `next` kept the way
  `signInHref` keeps it for `/sign-in` (read `engine/ui/account/next.ts`; add a `registerHref` beside `signInHref` if
  none exists), then "No invite? Ask someone who plays." and a Sign in link;
- open: "Register", then Sign in;
- closed: "Registration is closed for now." then Sign in.

On the Phone board's layout the plate shows the title with the line under it in the phone's sizes, and the action row
wraps under the plate; nothing is cut at 390px.

**Tests first** (`Frame.test.tsx`): signed out, the HUD shows the instance's prompt and line; for each mode, its
action words and hrefs (each keeps the current path as `next`); signed in, none of it shows. Update the existing
signed-out test that expects Sign in alone.

## Task 4. Every board address shows the front door signed out

Model: haiku

**Files:** `engine/ui/index/Index.tsx`, `engine/ui/board/Board.tsx`, `engine/ui/thread/Thread.tsx`,
`engine/ui/profile/Profile.tsx`, `engine/ui/profile/Record.tsx`, and their tests that assert the sign-in prompt
(`rg "The board is for players" engine`).

Each `if (!signedIn) return <div className="kb-…"><SignInPrompt /></div>;` on these five board screens becomes
`return <FrontDoor />;`. The glass pages keep `SignInPrompt` unchanged.

**Tests first:** each of the five screens, signed out, shows the front door's title (`getByRole('heading', { level: 1,
name: <test world's title> })`) and no sign-in prompt.

## Task 5. Story, a11y, contrast, and the look

Model: sonnet

**Files:** `engine/ui/front-door/FrontDoor.board.stories.tsx` (new; the story conventions of
`engine/ui/welcome/Welcome.board.stories.tsx`), and wherever `web/a11y.test.tsx` and `web/contrast.test.tsx` list the
screens they measure (add the front door, signed out, at desktop and phone).

Render the dev app signed out (`npm run dev:web`, then sign out) at 1440×900 and 390×844, light and dark themes, and
compare with the sketch. The first viewport at 1440 shows the label, the title, at least the first three posts with
the splat, and the HUD. Run `.claude/skills/impeccable/scripts/impeccable detect --json engine/ui/front-door
engine/ui/frame` and answer what it finds.

**Tests first:** the a11y run fails before the story exists (the new entry names a missing story) and passes after.

## Review focus

- A mask slipping: nothing on the front door is read from the server or differs between visitors; a test proves the
  API is not called. The register line reads `registrationMode` only.
- The real card effect run with no server: `save` and `release` must refuse without a request, and the effect must not
  try to save a reader's strokes (reader is never the author).
- Every board route signed out now draws the front door: a test that expected the old prompt on a board screen is
  updated, not deleted; the glass pages' prompts are untouched.
- The engine names no card, class or character of Divided World (`tools/check-*` boundary checks pass).
