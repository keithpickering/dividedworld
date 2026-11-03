# The Reveal on the glass: design

Record, written 2026-11-03. The design for issue #67 ("On a glass page, the Reveal dialog is still the board's 2003
modal"), made with the owner. The plan is `docs/plans/2026-11-03-glass-reveal-plan.md`.

## 0. Where it starts

On main at b7867e5 the issue still holds. `engine/ui/characters/RevealDialog.tsx` draws the board's `Modal`
(`engine/ui/modal.tsx`), and it is the last thing in the engine that does. Two screens open it:

- **My characters** (`engine/ui/characters/Characters.tsx`), a glass page. It opens the dialog with no thread, so the
  player chooses a board and a thread. The dialog shows as a 2003 box: it does not dim the menu bar, and it does not
  stand on smoke, unlike the Turn and Debut dialogs that open beside it (`TurnDialog.tsx`, `DebutDialog.tsx`, both
  moved to `engine/ui/glass/Overlay.tsx` in PR #49's Task 2.2).
- **The composer** (`engine/ui/composer/Composer.tsx`), on the board. It always passes its own thread (`thread: Id`,
  never null), so the dialog says "It will be posted in this thread."

Each opener already uses only one half of the dialog: the glass only the board and thread pickers, the board only the
given thread.

## 1. On the glass it is drawn like Debut, with a preview

**Decided:** on My characters, the Reveal confirmation is a glass `Overlay`, built like `DebutDialog`. It has the
kicker "My characters › Reveal", the same title, words and pickers in the glass's controls (`kb-glass-field`,
`kb-glass-select`, `kb-glass-input`, and the skewed `kb-glass-action` Cancel and `kb-glass-confirm` Reveal), and a
`PreviewBox` showing what everyone will see, as the Turn and Debut dialogs do.

Weighed:
- Swapping only the shell and the controls, with no preview. That's the smallest change, but it would be the one
  dialog of the three on My characters that doesn't show the post it makes.
- The Turn's full layout, with the portrait, rank and class on the left. It's the richest, but a lot of new CSS for a
  short confirmation that has already named the class.

The preview is a new `revealPreview` in `engine/ui/characters/previews.ts`. Unlike the others, its line is the
character's own, not The System's (the class reveal design, §2: "a reveal is the character's own Act"). So the line's
`by` is the character's name, and the line reads as `UnmaskLine` draws it (`engine/ui/thread/lines.tsx`): "Pipewrench
revealed: Face", followed by ` — “<message>”` when the player has typed a line. The preview's `where` is "At once, in
<the chosen thread's title>", or "At once, in the thread you choose" before one is chosen. `previews.test.tsx` already
holds the Turn preview's reveal line to `UnmaskLine`, and it holds this one the same way, with and without a message.

The board's composer dialog gets no preview: issue #67 is about the glass, and the board's 2003 dialog keeps the
board's look. If a preview is wanted there, that's a separate change.

## 2. It stands on the Turn's smoke

**Decided:** `surface="turn"`, as Debut does. The three dialogs that change or announce a character's class on My
characters (Turn, Debut, Reveal) read as one family, set apart from the page dimmed behind them.

Weighed: the page's own `characters` smoke. It reads as part of My characters, but it blends into the dimmed page
behind the dialog.

## 3. Two shells, one core

**Decided:** the dialog is split by world, and the rules of a reveal are written once.

- **`engine/ui/characters/reveal.ts`**, the core. It exports a hook, `useReveal(character)`, which holds the message
  and its count against the limit of 200, the busy flag, the refusal, the class's name, and
  `submit(thread, threadTitle)`, which calls `api.unmask`, refreshes the player, and returns the "revealed as" line or
  a refusal in the server's words. It also exports the dialog's shared words: the confirmation sentence, the pending
  Turn note and the Reveal button's label. Both shells read these, so neither world can drift.
- **`engine/ui/characters/RevealModal.tsx`**, the board's. It replaces `RevealDialog.tsx`, keeps the `Modal` and takes
  a required `thread`. Without the pickers, which only the glass uses, it is the composer's dialog as it is today.
- **`engine/ui/characters/RevealOverlay.tsx`**, the glass's. It is the `Overlay` from §1 and §2, and owns the board
  and thread pickers, with their pages of older threads (`api.boards`, `api.threads`), which only the glass uses.

Weighed:
- One component with a `world` prop. That's one file, but it would branch on every control's class name through all
  of its markup.
- Finding the glass page from a context that `Page.tsx` provides. That would be automatic for later dialogs, but the
  world would be chosen implicitly instead of by the screen that opens the dialog, and the glass and board versions
  differ in more than their look (§0).

## 4. What this does not change

The reveal itself is unchanged. It is the same `api.unmask` call, writes the same Act and is checked the same way on
the server.

- **No new state:** a player can still leave the dialog by Cancel, Close and Esc, as the `Overlay` provides
  ("No player is ever stuck").
- **No new response, payload, event or timing:** the dialog reads the player's own character and public boards and
  threads, as it does today ("A response never proves a private fact").
- **Engine only:** every file is in `engine/ui/`, and no instance content is involved.
- **Accessibility:** the `Overlay` keeps the board modal's focus behavior, since it is built on the same
  `useModalLayer`. The board's `Modal` keeps no glass-only behavior.

## 5. Open

Nothing.
