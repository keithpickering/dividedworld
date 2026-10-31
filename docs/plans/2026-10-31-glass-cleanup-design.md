# The glass cleanup: design

Record, written 2026-10-31. One build session clears what the glass's first PRs (#71, #87) left: the dead ends #90
and #85, the tests #88 is owed, and the follow-ups from #86 and #89 that leave a player stuck, told something untrue,
or unable to use a screen. The plan is `docs/plans/2026-10-31-glass-cleanup-plan.md`.

## 1. #90: every page drawn with no menu bar has a way back

`/log/settlement` is drawn with no menu bar (`NO_MENU`, `web/src/App.tsx`). Its ready state has Back to the board and
Esc, but its loading, failed, empty and signed-out states have only Esc, which a touch screen does not have.

**Decided:** every state of a page with no menu bar draws Back to the board, the ready state's own link. The page
owns the link, not each state, so a state added later cannot leave it out. The check renders every state of every
`NO_MENU` page and asserts the link. It reads the set from `App.tsx`, so a page added to it is covered too.

Weighed: a menu bar on the failed and empty states only. This was turned down because the summary is meant to read
as one card over the board, and two looks for one page is a seam.

## 2. #85: the post's own player washes a retired character's splat clean

The owner asked whether this is a dead end if another player later adopts the retired character. Today nobody can
adopt one. A character's `owner` never changes, and `restore_character` (0021) gives it back only to the same player,
with an admin's help. So nothing is waiting to free the splat. Even after the Pound is designed, an adoption that may
never come cannot be the stated way out.

The three answers #85 offered, weighed against "A response never proves a private fact". Only a character's own
player is told it is retired (0021's header):
- (a) Refuse a Whoops! play on a retired character's post: the refusal would tell the caster that the mask is
  retired. Turned down.
- (c) Let a splat on a retired post wear off: whether a splat fades would tell every reader the same thing. Turned
  down.
- (b) Let the post's player wash it clean through the retired mask. **Chosen by the owner, 2026-10-31.**

**Decided:**
- `save_effect_state` accepts its `through` when that character is the post's author and is owned by the caller,
  whether or not it is retired. It refuses a waiting one, as it does today, and every other check stands.
- A save is a row in `effect_state`, never an Act, so "Append-only" and `acts_well_formed`'s refusal of a retired
  character's Acts are untouched.
- The screen saves for the author through the player's characters that wrote the post, retired among them. Every
  other control keeps `actingCharacters`: casting, releasing, the HUD and the composer.
- What a reader sees is a layer marked clean, which they already see whenever any author washes, so nothing about the
  retirement shows.
- The same holds for the fake backend (`engine/ui/data/fake.ts`).

When the Pound lets another player adopt a mask, the adopter becomes its owner and inherits this path. The Pound's
design names that.

## 3. #88: the breakdown's tests

The owner's word on #88 is "Looks good": the breakdown stands as drawn in "12 Log, open". Three tests are owed:
- keyboard open and close, with focus returned to the control;
- each reason's shares adding up on screen to the reason's exact total;
- the two sentences: the split sentence, and "Scored over the whole window, not post by post."

#89's open question about Show posts flipping its label to Hide posts while also carrying `aria-expanded` is settled
by the same word. The label stays as drawn.

## 4. The follow-ups taken from #86 and #89

**Taken.** A follow-up is taken when it breaks one of CLAUDE.md's rules for a player: a dead end, a true-words
rule, or the forum's own accessibility.

| Item | Rule it breaks | Decided |
|---|---|---|
| #86: the "no room" message undersells washing | The fiction may lie; the log never does | The suggested wording: "…shows on your screen only, but washing it clean still clears it for everyone." |
| #86: strokes lost when the author leaves mid-save | The System acts; it never destroys what a player wrote (the author's own wash is their act) | Leaving the post sends what is unsaved after the save in flight, never drops it |
| #86: the screen's price is not the server's | The fiction may lie; the log never does (a price is out of character) | The screens read the card prices the server charges (below) |
| #89 F4: the log's cursor cannot pass a full instant | No player is ever stuck (Show older lines reloads the same page forever) | The page moves past an instant that fills `LOG_ROWS`, or fails loudly, never repeats |
| #89: the summary's first load is lost if the player leaves mid-read | No player is ever stuck (the summary never opens and is never looked for again) | A read that is dropped is looked for again on the next board page |
| #89 F2 and F3: the `shares_kept` mapping and two log sentences untested | A guard that has never been red is not known to work | Their tests, each driven red |
| #89 P2-1: live regions mount with their content | An accessible path (the forum's own: the purchase's result, the save's report) | Write into a region already on the page |
| #89 P2-2: the play form drops characters past 200 silently | The out-of-character screens speak plainly; an accessible path | `maxLength`, the code-point slice kept, and the counter announced politely |
| #89 P3-2: the removed list's class names in the Vending Machine | Tidying | Removed |

**The prices the screens read.** Today `screen_settings` (0030, 0036) keeps the whole economy out, because the
economy also holds the classes' numbers, which no screen needs. Only what a card's price reads joins it: each card's
`priceKey` and the keys its rules list in `reads`. These go under one key, `cardEconomy`, that `seed_instance`
records from the instance's cards. The view returns those numbers from the live economy row, so an admin's tuning
shows at once. A card's price is not a private fact: the machine shows it to everyone. The classes' numbers stay out.

**Left on their issues.** Each of these stays open where it is filed:
- Stick Around's wheel tuning, the play tag's phone fold, the lifted-controls CSS, 0035's backfill, `PLAYS_PER_POST`
  and Whoops!'s folder (#86);
- P2-3's smoke, P2-4's `:has()`, P3-1, P3-3, P3-4 and the board chrome (#89);
- the Turns the log does not show, the admin link, own-play washes, same-instant order, focus after Show older lines,
  F1 on #25 and F5 (#89).

The build may take a small one it passes through (CLAUDE.md, "Tidying") and ticks it on its issue.

## Open

Nothing is waiting on the owner.
