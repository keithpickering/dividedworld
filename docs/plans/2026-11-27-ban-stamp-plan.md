Record, written 2026-11-27.

# A banned mask is stamped in the glass: plan

Carries out `docs/plans/2026-11-27-ban-stamp-design.md`. One PR from `main`. No migration, no new read: every place
draws `MyCharacter.bannedUntil` (`engine/ui/data/api.ts`), which the player's own characters already carry.

Every task goes test first: write the failing test, record its red run, then the code. During a task run only the
changed code's tests, `npx vitest run <file>`. Run `npm run typecheck` and `npm run build` once after the last task,
with the tail in the PR. No deployed database, bucket or connector is touched. A ban is seeded in the fake with
`fake.seed.ban(character, until, { days })` (`engine/ui/data/fake.ts`).

## Task 1: the stamp and its memory

Model: sonnet

New files `engine/ui/glass/BanStamp.tsx`, `engine/ui/glass/ban-stamp.css`, `engine/ui/glass/stamp-seen.ts`.

- `stamp-seen.ts`: `seenStamp(character: Id, until: string): boolean` and `markStamp(character, until): void`, one
  `localStorage` key, `kb-ban-stamps`, holding a JSON list of `${character}|${until}`, every read and write in
  try/catch (a throw reads as not seen and writes nothing). It keeps only entries whose `until` is still ahead when it
  writes, so the list cannot grow past the player's live bans.
- `BanStamp({ character, until, size })`, `size` `'large' | 'small' | 'mark'`: renders nothing unless
  `useAhead(until)` (`engine/ui/composer/until.ts`); otherwise an `aria-hidden` span `kb-ban-stamp` over its
  positioned parent, holding the word BANNED (`'mark'` draws the frame alone, no letters). It sets
  `data-kb-banned` on nothing itself; the caller grays its own portrait with the class `kb-banned` (section 2's
  filter: `grayscale(1) brightness(.55)`). The slam: when `useFeel()` (`engine/ui/glass/motion.ts`) is not null and
  `seenStamp` is false, the span carries `data-kb-slam` and `markStamp` runs on mount; under Off it never slams.
- `ban-stamp.css`: the stamp as `docs/research/2026-11-27-ban-stamp/mock2.html` draws it: neon red ink, −16°, the
  ink broken by a repeating radial mask, `filter: drop-shadow(0 3px 0 rgba(0,0,0,.85)) drop-shadow(0 6px 10px
  rgba(0,0,0,.7))`. The red is a new glass token beside the others in `engine/ui/glass/tokens.css`. The slam is a
  keyframe on the reactions' thud curve (`kb-stamp-thud`, `engine/ui/reactions/reactions.css`): scale from about 2.4
  and transparent to 1, the parent's portrait nudged a few pixels at impact, timed by the feel's tokens as
  reactions.css times its stamp.

Tests first, `engine/ui/glass/BanStamp.test.tsx`:
- no `until`, or one past: nothing rendered;
- `until` ahead: an `aria-hidden` stamp with BANNED; `'mark'` has no letters;
- the clock passes `until` (fake timers): the stamp is gone with no read;
- first draw with motion on carries `data-kb-slam`; a second mount for the same character and `until` does not; a
  new `until` for the same character slams again;
- motion Off (`data-kb-motion="reduce"` on the root): no `data-kb-slam`, stamp drawn;
- `localStorage.getItem` and `setItem` throwing: the stamp draws and slams, no throw;
- `markStamp` drops entries whose `until` has passed.

## Task 2: My characters

Model: sonnet

`engine/ui/characters/Characters.tsx`, `engine/ui/characters/characters.css`.

- The roster card (`renderItem` in `Characters`): `<BanStamp size="large">` inside the `Portrait` box (the box gets
  `position: relative` and `kb-banned` while banned), and above `cardTurn(c)` a line
  `<span className="kb-roster-ban">Banned until {shortDate-and-time}</span>` in the stamp's red. The tab's name stays
  its drawn words, so the line is read with it.
- The panel (`panel`): while banned, at the head of the panel's body, `<p className="kb-notice" role="status">`:
  "<b>{name} is banned until {dayAndTime(until)}.</b> The ban ends by itself then, and it holds only this character:
  your other characters can post as usual." followed by `<BanAppeal character={c.id} />`. A hook cannot run per card
  in the carousel's map, so the card's line and the note are each a small component that calls `useAhead`.
- Other masks: unchanged.

Tests first, in `engine/ui/characters/Characters.test.tsx` (its `world()` seeds Pipewrench, Mrs. Hooligan, Spritey):
- Pipewrench banned for 3 days: her card has the stamp and "Banned until"; Mrs. Hooligan's and Spritey's have neither;
- her panel has the note's words exactly and an Appeal button; another's panel has no note;
- the clock passes the end: stamp, line and note go;
- axe finds no violation on the banned roster (`axeViolations`).

## Task 3: the HUD

Model: sonnet

`engine/ui/frame/Hud.tsx`, `engine/ui/frame/frame.css`.

- The avatar `Link` (`kb-hud-avatar`): `<BanStamp size={wide ? 'small' : 'mark'}>` over the `Avatar`, `kb-banned`
  on it while banned, and its `aria-label` "My characters. {name} is banned until {dayAndTime(until)}." while banned,
  "My characters" otherwise.
- The picker's options (`player.actingCharacters.map`): `{c.name}{banned ? ' (banned)' : ''}`, banned by
  `bannedUntil` ahead of `api.now()` at render; and the phone's `kb-hud-picked` name likewise, by `useAhead` on the
  HUD's mask. The name-fit probe (`wordProbe`) measures the same words it shows.

Tests first, a new `engine/ui/frame/hud-ban.test.tsx` beside `hud-recast.test.tsx`, in its harness:
- the HUD's mask banned: stamp on the avatar, the link's name has "is banned until", the option reads
  "Pipewrench (banned)", the other options plain;
- the phone layout: the stamp is the frame alone, the picked name has "(banned)";
- swapping to an unbanned mask: no stamp, plain name; the end passing: the stamp and "(banned)" go;
- the HUD and the roster both drawn for one ban: only the first slams.

## Task 4: BannedNote's words

Model: inline

`engine/ui/composer/BannedNote.tsx`: "switch to another in the HUD to post as {pronounWords(...).them}." becomes
"switch to another in the HUD to post as usual." and the `pronounWords` import goes if unused. Red first:
`engine/ui/composer/ban.test.tsx` line 30's expected sentence changes to the new words, then the note.

## Task 5: stories

Model: haiku

- `engine/ui/characters/Characters.stories.tsx`: a `Banned` story, the `full` world with Pipewrench seeded banned for
  3 days.
- `engine/ui/frame/Hud.board.stories.tsx`: a banned HUD story, wide and phone, in its file's pattern.

## Review focus

- The stamp's red on a grayed portrait: the word is decoration, but check it reads at 84px on a light picture and a
  dark one, with the shadow.
- A ban on the HUD's mask landing while the page is open: the player's characters are reread on a move; check the
  stamp appears with the slam on the next read, and that two places drawing it at once slam once.
- `kb-ban-stamps` holds only the player's own masks and prunes past bans: check nothing here reads another player's
  data, and that a shared computer's second account cannot learn anything from the list beyond ids it could see on
  postbits.
- The phone's name-fit: "(banned)" lengthens the picked name; check a long name still fits its box.
