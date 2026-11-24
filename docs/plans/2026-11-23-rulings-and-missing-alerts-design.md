Record, written 2026-11-23.

# Rulings, and the other things done to a player that never alerted: design

The owner noticed that warn points landing on a character show in My log and never as an Alert, and asked whether that
was by design. It was half by design. The alerts design (`docs/plans/2026-11-02-alerts-design.md`, section 2) put
**Ruling** in the catalog ("a punishment, a report judged, an appeal answered, a title or user group given, your thread
moved or retitled, a Mod Bot visit that ended with an outcome") and said each ruling's build would add its alert. The
Mod Bots design (`docs/plans/2026-11-06-mod-bots-design.md`, section 6) then restated the staff design's "the author
gets no alert" (`docs/plans/2026-10-31-the-staff-design.md`, section 5, from the spec's "zero notifications when a Mod
Bot targets their post") for a visit's filing too, and the member-groups design
(`docs/plans/2026-11-06-member-groups-design.md`, section 8) chose no alert for a group move "as Mod Bots sends none for
a visit". Nothing reconciled the catalog with those, so the `ruling` kind was built everywhere but its writer: the
table admits it, Settings has its toast switch, the words and the stories carry it, and no SQL writes one.

A survey of every line My log draws against every writer of an alert found more gaps of the same shape: things done to
a player's characters, posts, cards or wallet by someone else, logged truly and never nudged. This design says which of
them alert, and how.

## 1. A visit stays silent; what it lands alerts

**Decided** (the owner, A): the spec's "zero notifications" is about the visit. While a Mod Bot visits a post the
author is told nothing, so friends spotting the bot stays the social part. Once a visit **files**, what landed is a
ruling on the character, and it alerts: the warn points, or the ban the points brought. A real forum's mods send the
infraction message too. So do these outcomes of the Mod Bots' work:

- **Warning:** a filing's points landed on your character.
- **Ban:** a filing filled the bar and banned your character.
- **Fall taken:** another character took the fall for your post (Fall cards, `0361_discipline_cards.sql`). The
  character who took it gets the **warning** (or **ban**) itself.
- **Report judged:** a report your character filed was heard (a visit, dismissed, or backfire), or could not be heard
  and was refunded.
- **Appeal answered:** an appeal your character made was ruled on (overturned, upheld, reduced, increased), or expired
  unheard and was refunded. An `increased` ruling's extra points or ban are told in this one alert, never in a second
  warning alert.

**Decided** (the owner, A): a visit that ends **without filing** (intercepted, dropped, reversed by an admin, or ended
by a trap) alerts no one about the visit. Nothing landed, and telling the author would announce a visit the spec keeps
unannounced. The board and the Lens show it to anyone who looks. A trap's setter still has their `trapSprang`.

**What this revises:** the staff design's and the Mod Bots design's "the author gets no alert" now covers the visit
while it runs and an unfiled end, not the filing. The alerts catalog's "a Mod Bot visit that ended with an outcome"
means a filing.

Weighed: alerting only what stops a character (a ban, and the answers to a report or appeal the player paid for),
with warn points left to the postbit's meter (B); everything silent as built, removing Mod Bot rulings from the
catalog (C).

## 2. A Boss's move alerts when it lands

**Decided** (the owner, A):

- **Grouped:** a `conferGroup` move landed on your character: a title, or a punishment group that bars posting.
- **Thread moved:** a `moveThread` move put a thread your character started on another board. The thread's starter is
  told, and My log gains the line it lacks today ("'Thwomp appreciation' was moved to the Hobbies board").
- **Leaving a group** (expired, met, overturned, reversed, superseded, spent) stays in My log only. Its end was
  stated when it landed, and the bar leaving the postbit says so. An appeal that overturned it has its own
  **appeal answered** alert (section 1).
- **A board merge** (`mergeBoard`) alerts no thread's starter. It reshapes a board, which is board news, and it would
  write one alert per thread on the merged board.

**What this revises:** the member-groups design's "no alert when a group move lands" was chosen because Mod Bots sent
none for a visit; section 1 changed that reason, and the owner chose the alert.

Weighed: alerting both the landing and the leaving (B); keeping group moves silent and alerting thread moves only (C).

## 3. An admin's in-game acts on what is yours

**Decided** (the owner, A): each of these alerts, in plain words:

- **A card ended on yours:** an admin ended another character's card that sat on your post, your character or your
  thread, or a lockout that held your character. Today only the caster hears (`reverse_card`, `0405_cut.sql`). Where
  the caster and the target are the same player's, the caster's alert is the only one.
- **Trophy taken back:** an admin reversed a trophy your character was given (`reverse_award`).
- **Poll closed:** an admin closed your character's poll (`close_poll_as_admin`).
- **Gear given:** an admin gave your character gear (`grant_gear`).

An **Aura grant** (`grant_aura`) stays in My log only. It is an account's, not a character's, and alerts are written per
character. It is the owner's service-role tool today, with no screen. A design that gives it a screen can add an
account-level alert.

Weighed: everything, the Aura grant included, with an account-level written alert (B); only what took something away,
leaving gifts silent (C).

## 4. Real moderation on a post alerts, plainly

**Decided** (the owner, A): each of the four post outcomes of the code of conduct (`0340_conduct.sql`) alerts its
author, in a kind of its own, **conduct**: **hidden**, **hidden until edited**, **brought back**, **edit approved**.
The emails `0341_conduct_mail.sql` sends stay as they are. Today "brought back" and "edit approved" reach the player by
neither. "Hidden until edited" links to the post's edit, its way out.

Conduct is never a `ruling`. A ruling is the game's; conduct is real moderation, out of character, and its words are
plain ("The fiction may lie; the log never does"). Its own kind keeps it apart in the words, in the icon's ink and in
Settings. The account-level outcomes (nudge, suspend, ban, lift) stay email only, as now.

Weighed: email for the two outcomes that send none, keeping real moderation out of the game's alerts (B); both (C).

## 5. Gifts and drawings, from other players

**Decided** (the owner, A):

- **Gift:** a gift reached your character through a drive on its post (`donate`). It is a kind of its own, **gift**:
  it is no card play.
- **Drew:** another character drew on a wall on your post (a surface's `draw`). It is a **card on yours**, sub `drew`.
- Both can come many times, so the Alerts page batches them as it batches cards on yours: gifts per drive, drawings per
  wall.
- A **wash** stays in My log only. Only the post's author washes, tidying their own post.
- A gift or drawing by one of your own other masks writes nothing ("what your own other masks did to your
  characters" is never alerted). A Mod Bot's drawing on a wall alerts like a player's.

Weighed: also telling a drawer that their drawing was washed (B); a gift told once when the drive closes, derived and
stored nowhere (C).

## 6. The smaller gaps

Proposed by the session and confirmed by the owner with the shape above:

- **The settlement alert misses crowd pay.** The derived `settlement` alert (`my_alerts`) counts a settlement only
  where the account has a ledger line in it. Crowd pay is a wallet move with no ledger line, so a settlement that paid
  only crowd pay was never alerted. It counts the account's `crowd` wallet moves too.
- **A writing card that failed and was refunded** (`refund_card_write`) tells its caster, as **card ended**, sub
  `refunded`. Otherwise the caster believes the card landed. A writing card that wrote has no second alert: its play
  was alerted.

## 7. How the alerts are kept: kinds and subs

| Event | Kind | Sub | To the character | About (the alert's Act) |
|---|---|---|---|---|
| Warn points filed | `ruling` | `warning` | the one warned | the infraction |
| Ban from the bar | `ruling` | `ban` | the one banned | the ban |
| A fall taken for your post | `ruling` | `fallTaken` | the post's author | the infraction |
| Report judged | `ruling` | `reportJudged` | the reporter | the verdict |
| Report refunded, unheard | `ruling` | `reportRefunded` | the reporter | the report |
| Appeal answered | `ruling` | `appealAnswered` | the appellant | the ruling |
| Appeal refunded, unheard | `ruling` | `appealRefunded` | the appellant | the appeal |
| Put in a group | `ruling` | `grouped` | the one grouped | the move |
| Thread moved | `ruling` | `threadMoved` | the thread's starter | the move |
| Trophy taken back | `ruling` | `trophyReversed` | the award's | none (as `trophy`) |
| Poll closed by an admin | `ruling` | `pollClosed` | the poll's | the close |
| Gear given | `ruling` | `gearGiven` | the one given it | none (as `trophy`) |
| Card ended on yours | `cardEnded` | `onYours` | the target's | the `card_end` |
| Writing card refunded | `cardEnded` | `refunded` | the caster | the play |
| A drawing on your wall | `cardOnYours` | `drew` | the post's author | the `draw` |
| A gift | `gift` | none | the drive post's author | the `donation` |
| Conduct on your post | `conduct` | the outcome | the post's author | the version |

Each is written in the transaction of the Act or row it is about, through `write_alert`. The acting account is passed
where a player acted (a drawing, a gift, a fall taken), so that player's own other masks are skipped. It is null where
The System or an admin acted.

The **ruling** subs share Settings' one "Rulings" toast switch, on by default. **Conduct** and **gift** each get a switch
of their own, on by default. The `ruling` alert's words become one line per sub, each naming what landed and on whom,
with the log or the post as its link.

Weighed: a kind of its own for each event (eleven new switches in Settings, and eleven checks to widen); every new
event as a `ruling` sub (conduct filed as a game ruling, and gifts under "Rulings").

## 8. The layers

All of it is the engine's. The kinds, the subs, the writers, the words, the toast defaults and the log line name no
instance, no persona and no card. A Mod's name reaches the words from the public Acts, as the Lens reads it. An
instance's `AlertCopy` may later give a sub its own words, as it does for hints. Nothing here needs it.

## 9. The masks

- **Every new alert is read only by its own account** (`alerts`' row-level security, unchanged), and its content names
  only public things: the Act, the character it landed on, the public names of a board or a thread. No alert names who
  reacted or who owns a character.
- **The System's and an admin's writers** answer no player. The tick, `file_visit`, `close_appeal`, `close_report` and
  the admin functions write their alert in their own transaction, and its broadcast is queued and sent after it
  commits (`broadcast_later`), as every alert's is.
- **The players' writers** (`donate`, a drawing) answer the giver or drawer the same whoever owns the post. The alert
  row is written in the same transaction for an owned target and none for a staff one (staff is public), and its
  broadcast waits for the response. Skipping one's own masks differs only for the acting account, which knows.
- **A fall taken** alerts the author with the taker's owner as the acting account, so a player who takes the fall for
  their own other mask hears nothing on that mask, and no one else can tell.
- **Report judged** goes to the reporter alone. A backfire verdict already names the reporter publicly, and the visit it
  sends stays as silent as any (section 1): the alert names the verdict, never the visit to come.
- **Crowd pay in the settlement alert** reads only the caller's own wallet moves.

## 10. Ways out

This design adds no state a player, character or post can be put in. An alert is a nudge with no state of its own,
cleared by the account's "new" mark as every alert is. Every state the new alerts point at already names its way out
(the Mod Bots, member-groups and conduct designs), and each alert's link leads to the screen where that way out is:
the post's Lens for a filing (its Appeal), the log for a ban (when it ends), the post's edit for "hidden until edited".

## 11. A busy instance

Every new alert is one row per event, written where the event is written, as cards on yours are. Filings, report and
appeal answers are capped by the Mod Bots' daily budgets; Boss moves by the meeting; admin acts by admins. Gifts and
drawings grow with play, as cards on yours do, and are batched on the page. A drawing is bounded per wall by its
48 live draws, and over time by the players' own hands. The merge, the one fan-out by thread count, writes nothing
(section 2). The settlement alert's crowd branch reads the caller's own wallet moves by an index on account.

## 12. Open

- **An account-level alert** (an Aura grant, anything else with no character) waits for a screen that grants Aura.
- **Out of the site** (email, push) stays the alerts design's open question; conduct keeps its emails.
