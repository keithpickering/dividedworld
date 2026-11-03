# Jimmy Wails: the uncommon Sweet donation drive

Record, written 2026-11-03. The design session on Jimmy Wails, made with the owner. It is one of Minus World's Season 2
spells (`docs/research/minus-world/season-2-spellbook-roster.csv`: Sweet, 200, "Type a sob story about why this post
should get more love. Adds a Good Sh*t donation drive below the post"), and one of the greatest hits the core loop's
design means to bring back (`docs/plans/2026-10-28-core-loop-design.md`, section 7). The plan is
`docs/plans/2026-11-03-jimmy-wails-plan.md`, built by one build session in one PR.

The owner described it: "we basically just render the caster's message on one of these banners (randomized and saved to
the post) and we can have a donation drive to send aura directly to the OP." The owner supplied Minus World's banner
plates in this session (`docs/research/minus-world/jimmy-wails-plates/`).

The owner answered sections 1 to 5 one question at a time. Section 6's text layout was the owner's choice. The summary
of the whole was put to the owner, and the owner answered by sending the plates. That answer is taken as a yes, and the
owner can revise any part of it in review of this design's PR. A point that is this session's own choice, not one the
owner was asked, says so.

## 0. Where it starts

- A Cast lands on a post as an Act of kind `card`, written by `play_card` (last rewritten in
  `supabase/migrations/0054_card_plays.sql`), which locks the post, counts the card's stack and spends the wallet.
- A card's caster message is already part of every play: plain text, at most 200 characters (`casterMessage`,
  `MESSAGE_MOST`, `engine/rules/cards.ts`).
- A seeded card's play carries a number the server draws (`seeded`, `supabase/migrations/0016_cards_screens.sql`).
- The wallet is private, one per player, shared by all of the player's characters, and capped (core loop, section 8).
  `wallet_move` (`supabase/migrations/0003_aura.sql`) records what the cap cut off as `overflow`.
- A trap's Pay out is the one place that credits a wallet the play's own player does not hold. It reads the setter's
  account inside the SQL function and tells no one else (card mechanic design, section 11).
- **No Aura has ever moved from one player to another.** Jimmy Wails is the first card that moves it.

## 1. Where a gift lands

**Decided** (the owner chose the recommendation): in the OP's wallet, minus The System's overhead.

- The giver's wallet pays the gift's amount. The post's author's player's wallet receives the amount less The System's
  overhead. The overhead is `ceil(amount × overhead% / 100)`, starting at 25%, an economy setting. On 0.10 it is 0.03,
  and 0.07 arrives. This session chose the rounding.
- **The overhead is why a sock puppet's drive is never free.** A player giving to their own mask's post pays only the
  overhead, since the wallet is the same, and a big drive staged among one player's masks costs them a quarter of it.
- **A full wallet:** what the OP's wallet cannot hold is lost, as a settlement's overflow is. The gift is never refused
  for it, and the giver's answer is the same either way, since the OP's wallet is private and shared across masks.
- **A post by staff or The System:** staff hold no wallet, so the whole gift is overhead. The giver's answer is the same
  shape, and their log says plainly that nothing reached anyone. This session chose this, and the owner did not answer it
  directly.

Weighed: the OP's wallet in full (a sock puppet fakes a drive for nothing); the OP character's standing (spendable Aura
turned into standing outside the class rules).

## 2. What is public

**Decided** (the owner chose the recommendation): every gift is a public Act, with its giver and its amount.

- A gift is an Act of a new kind, `donation`, written by the giving character, targeting the drive (section 4).
- The drive shows a running total and a donor wall: "Spritey gave 0.50".
- Who gives to whom, and when, is a clue the game hands out on purpose: a mask that always rushes to fund one character's
  drives is telling a story.
- What arrived in the OP's wallet is public arithmetic, since the overhead is a public setting. A full wallet's overflow is
  never shown.

Weighed: a total with hidden givers (like reactions); givers named with no amounts.

## 3. How much

**Decided** (the owner chose the recommendation): preset buttons, given as often as the wallet allows.

- Four amounts, starting at 0.10, 0.25, 0.50 and 1.00, each an economy setting. Any other amount is refused.
- No cap per giver. A cap per player would be a quota shared across a player's masks that others can see ("A response never
  proves a private fact"), and a cap per character only asks for a second mask.

Weighed: presets plus a free amount; one gift per character per drive.

## 4. The drive: up to three plays, one carousel, one deadline

**Decided** (the owner's own proposal, over the recommendation of one per post): up to three plays of Jimmy Wails share
one drive on a post.

- **The first play on a post with no open drive opens one.** Each play carries its drive's id in its payload: the id of
  the play that opened it. The drive's id is that first play's id.
- **A drive closes 7 days after its latest play** (`lasts`, a card setting). Each play that joins it pushes its close
  back, so a drive of three can run about three weeks. The close is computed from the plays' own Acts and is never stored
  or edited ("Append-only").
- **A fourth play while the drive is open is refused** in plain words, the same for everyone: "this post's drive already
  carries 3 appeals". Once it closes, the next play opens a new drive.
- **One shared total.** Gifts go to the drive, never to one play. Every gift pays the OP, whoever cast.
- **The carousel:** the drive's banners rotate, one at a time, each with its own message and its caster's name.
- **After it closes,** its banners stay as a record, and the give buttons are replaced by "This drive has ended. It raised
  4.20 in 11 gifts."

## 5. The card

**Decided** (the owner chose the recommendation): uncommon, Sweet, a Cast on a post, 2.00 to buy (twice a common card's
price, as on Minus World). The price is an economy setting, and the season review replaces it.

- It can land on any post, the caster's own included. Begging for yourself is allowed, and the overhead makes it cost.
- The sob story is the card's caster message: at most 200 characters, as every card's is. Jimmy Wails requires one,
  since a blank appeal is no appeal.
- **The plays earn by class as any card's do**, Sweet: a Face lifting a post that then draws cheers.
- **A gift earns nothing beyond the Aura it moves** (the owner chose the recommendation). It cannot be reacted to, no
  class rule reads it, it is never counted as posting or in the halving, and it never touches standing.

Weighed: common at 1.00; rare at 3.00; gifts that count toward standing; gifts as reactable Acts.

## 6. The banner

**Decided** (the owner chose clean plates and live text): each banner is a clean plate from the instance's pool, with
the caster's message laid out on it as real text.

- **The draw:** when the play is written, the server draws one banner from the card's pool and saves its key on the play.
  Every reader sees that banner forever. A key, not a number, so that a pool that grows never changes which banner an old
  play shows. This session chose the key.
- **The pool** is the instance's: the three plates the owner supplied, each with its text box (where the text sits, in
  the plate's pixels), its ink color and the side its panel extends to. The banner is wider than a narrow plate: the
  blue-shirt plate is drawn on the left, and its white fade is carried on into a panel on the right, as the reference shows.
- **The text,** set in a plain white or dark sans, as the original appeals were: a small "Please read:", the message large,
  then "A personal appeal from Spritey". It steps its size down to fit its box. This session chose the attribution line,
  and the owner judges it on the shots.
- **Where:** below the post's words, in its thread. In the ORIGIN box of a spun thread, the banner shows without the give
  buttons.
- **The look's world:** the post is on the board, in the house style, and the banner is one of the game's own pieces, so it
  carries its photograph and color. The give buttons and the donor wall take the Wikipedia appeal's own plain look under it.

Weighed: the original banners with the message in a box beneath them (the joke loses its punch).

## 7. The accessible path

The banner is decoration and a message, not an obstacle, so it follows the forum's usual standard. This section is this
session's own choice:

- The carousel advances every 8 seconds, pauses while the pointer is over it or focus is in it, and has a pause button.
  Under reduced motion it never advances by itself, and previous and next buttons move it.
- The message is real text. The plate is decorative (`alt=""`), with the banner labeled "Appeal from Spritey".
- Each give button is labeled "Give 0.25 Aura to this drive", and a gift's result is announced politely.

## 8. The engine and the instance

- **Engine:**
  - `CardRules.draws`: keys the server draws one of at each play, stored on the play as `drawn`.
  - `CardRules.drive`: the card's plays on a post share a drive, with its `lasts`, its gift amounts' economy keys and its
    overhead's economy key.
  - The `donation` Act kind and a `donate` SQL function, which reads the OP's account inside the function, as a trap's
    Pay out does.
  - `card_target` gives a drive play its drive and its close. `play_card` counts a drive card's stack in the open drive.
  - The act Edge Function's `donate` action, the screens' API, and the drive's data and a `give` action on `EffectProps`.
  - Settlement leaves gifts out, and the log and the thread's readers handle the new kind.
  - **The engine names no card.** A drive and a draw are interfaces any instance's card may take.
- **Instance** (`instances/divided-world/`): the card's rules, the plate pool and its text boxes, the banner, the
  carousel, the give buttons and the donor wall, its face, its words and its settings.

## 9. The masks

- **The OP's account is read only inside `donate`,** to credit it, as `spring_traps` reads a setter's. No answer, Act,
  broadcast or log line but the OP's own carries it.
- **The giver's answer never varies with the OP's wallet:** no refusal for a full wallet, and no overflow in the answer.
- **The refusals read only the giver's own wallet** (a short wallet, seen only by the giver, who knows it) **or public
  facts** (a closed drive, an amount not offered).
- **Giving to one's own mask is not refused,** since that would read who owns what. The overhead makes it cost.
- **Timing:** `donate` locks both wallets in account order, as a Pay out does. A wait on the OP's wallet lock is the same
  for every giver, and is the precedent the card mechanic's Pay out already set.

## 10. The log

- **The giver:** "You gave 0.50 to the drive on post N; 0.38 reached its author after The System's 25% overhead". On a
  staff or System post: "You gave 0.50 to the drive on post N; it all went to The System's overhead."
- **The OP:** "Spritey gave 0.50 to the drive on your post N; you received 0.38". When the wallet was full: "...; you
  received 0.38, and your wallet was full, so 0.12 of it was lost".
- **The caster:** "You played Jimmy Wails on post N" (the existing line), with "It opened a drive" or "It joined the drive".

## 11. Ways out

- **A drive:** it closes by itself 7 days after its latest play, at most about three weeks after it opened.
- **A post whose drive is full:** the drive closes by itself, and the next play opens a new one.
- **A gift:** a finished Act, with no state.
- **The carousel:** the pause button, focus or hover, and reduced motion.

## 12. A busy instance

- A drive's gifts are one indexed read per drive on the page (acts by `target_act_id` and kind), with the total and count
  summed in SQL and the donor wall limited to the latest 20, with "and N more" opening the rest.
- Each gift is an Act. A character can give at most its wallet's cap's worth before refilling (60 gifts of 0.10), so a
  drive's Acts are bounded by the givers' wallets, and gifts never appear in a thread's list of posts.
- `play_card` computes a drive's close from the post's plays of the card, which it already reads under the post's lock.

## Open

- **An alert for the OP on a gift,** beside the log line: weighed with the alerts design's kinds when it is next revisited.
- **More plates:** the pool takes more banners as the owner finds them, each with its text box.
- **The shots:** the text boxes' positions, the type and the attribution line are judged by the owner on them.
