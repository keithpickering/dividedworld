/**
 * What an instance gives the engine for each of its cards (`InstanceUi.cards`, one `CardUi` per
 * card key of the rules' `CardRules`): how a card draws on a post it was played on, its settings in
 * the play form, its rules in plain words, and its face. The engine's screens are written against
 * these and never name a card ("KayfaBB never knows which instance it runs"); a card the instance
 * gives no `CardUi` is played, paid for and shown as its tag on the post, and draws nothing more.
 *
 * A card's name, alignment, price and rules for where it lands are the rules' (engine/rules/cards.ts);
 * this is only what a screen draws.
 */
import type { ComponentType, ReactNode } from 'react';
import type { Settings } from '../../rules/types.ts';
import type { BeyondPost, Reach } from '../../rules/cards.ts';
import type { Act, Answer, Donated, DriveGift, EffectState, Id, SurfaceAct, Wallet } from '../data/api.ts';
import type { CardFace } from './faces.ts';

/**
 * A card played on a post, read from its card Act: the Act itself is the record, this is its payload
 * in the shape an effect wants (supabase/migrations/0016_cards_screens.sql writes it).
 */
export interface CardPlay {
  /** The play's Act: what a saved state, a release and a log line name it by. */
  readonly id: Id;
  /** The card's key. */
  readonly card: string;
  /** The stacking layer, from 1 (a play written before layers has none and is layer 1). Plays of one card on one post are ordered by it. */
  readonly layer: number;
  /** The character that played it. */
  readonly caster: Id | null;
  /** The caster's words, plain text, at most 200 characters; empty when they left none. */
  readonly message: string;
  /**
   * The card's own settings as the server kept them (Whoops!'s ink), with the server's seed in a
   * seeded card's: the same on every reader's screen, so every reader draws the same effect.
   */
  readonly config: Readonly<Record<string, unknown>>;
  readonly playedAt: string;
  /** The post it landed on. */
  readonly post: Id;
  /** A card set face down (a set Act): its `card` is the engine's own back (`CARD_BACK`), the same for every card, and names none. */
  readonly faceDown?: true;
  /** A card back that sprang: the card it was and its spring, public from then. The back keeps its place among the marks. */
  readonly revealed?: { readonly card: string; readonly spring: Id; readonly at: string; /** The quadrant a ride back named, public once it has sprung (the spring's `quadrant`). */ readonly quadrant?: string };
  /** A card back its setter took back into their hand (a `take_back` Act): ended then, and it names no card. */
  readonly takenBack?: { readonly at: string };
  /** A play a back laid when it sprang (a Move landing on a quote), by the spring that laid it: the Lens says who set it and what set it off. */
  readonly spring?: Id;
  /** A cast that rode a ride back, by the set whose spring it sprang: it landed as usual, took its layer and was caught by nothing. */
  readonly rode?: Id;
  /** When a play's effect starts where that is later than the play (a scored-as play's window opens at the next settlement); absent where it starts when it lands. */
  readonly starts?: string;
  /** A play a trap caught, by the set that caught it: it is spent and does nothing, so no effect is drawn for it. */
  readonly caught?: Id;
  /** An admin ended this play (a `card_end` Act names it): its layer is off for everyone, though the play and its layer number stay. */
  readonly reversed?: true;
  /** The play's first generation failed, so it was refunded and is over (`Act.untaken`): not in force, never counted, though the play stays an Act the room can react to. */
  readonly untaken?: true;
  /** When a Use's effect ends, as the server wrote it when it landed; a play beyond a post's end, which it is drawn until. */
  readonly ends?: string;
  /**
   * A play beyond a post (0055_card_reach.sql): the reach it lands on and its target there (`on`: the character, the thread or the
   * board), where the screens draw its mark and its effect. Its `post` is the post its Act sits on (the postbit's post for a
   * character, the thread's first post), or empty for a board's, which sits on none.
   */
  readonly reach?: BeyondPost;
  readonly on?: Id;
  /** The drive this play belongs to (`CardRules.drive`): its opening play's id, from the play's own payload. Only a play of a drive card has one. */
  readonly drive?: Id;
  /** The key of the one the server drew at this play from the card's pool (`CardRules.draws`), from the play's own payload: a card with no draws has none. */
  readonly drawn?: string;
}

/**
 * One drive of a card on a post (`CardRules.drive`), as its effect is given it: its plays in play order, when it closes (its latest play's
 * time plus the card's `lasts`), whether that is still ahead, what has been given (the total in hundredths and the count of gifts, which are
 * the same for every reader) and its latest gifts, newest first, with `more` saying the wall holds older ones (`EffectProps.moreGifts`).
 */
export interface Drive {
  /** The drive's id: its opening play's. */
  readonly id: Id;
  readonly plays: readonly CardPlay[];
  /** An ISO time. */
  readonly closes: string;
  readonly open: boolean;
  readonly total: number;
  readonly count: number;
  readonly gifts: readonly DriveGift[];
  readonly more: boolean;
}

/** Who the reader is to a post an effect wraps, on their own screen only (it is computed from the player's own characters, never sent). */
export interface EffectReader {
  /** One of the reader's characters wrote the post: an author is never held, and is the only one whose saved state is kept. */
  readonly author: boolean;
  /** One of the reader's characters played one of these plays: a caster is never held either. */
  readonly caster: boolean;
}

/** Where the post an effect wraps is drawn: in its thread, or in the ORIGIN box of a thread spun from it. */
export type EffectPlace = 'thread' | 'origin';

/**
 * One control a card puts on the kit's glass tiles (Kit.tsx, Task 2): at most two are drawn. The engine draws them, so every
 * card's controls share one floor of size, focus and labels; the card says only what each does.
 */
export type KitControl =
  /** Held down to act: `start` on pointer down or Space/Enter, `stop` on release, leave, cancel, key up and blur, and when the tile unmounts mid-hold. `stop` may be called without a `start` before it (a pointer leaving a tile that was never pressed), so it must be idempotent. */
  | { readonly kind: 'hold'; readonly label: string; readonly describe?: string; readonly start: () => void; readonly stop: () => void }
  | { readonly kind: 'press'; readonly label: string; readonly run: () => void }
  | { readonly kind: 'toggle'; readonly label: string; readonly on: boolean; readonly set: (on: boolean) => void }
  | { readonly kind: 'choose'; readonly label: string; readonly options: readonly { readonly value: string; readonly label: string }[]; readonly value: string; readonly choose: (value: string) => void }
  | { readonly kind: 'go'; readonly label: string; readonly to: string };

/**
 * What one card says about itself on one post, on this screen only (never saved or sent): the Lens and the marks are
 * drawn from it. An effect sets it as its state changes (`EffectProps.show`) and the engine draws a card with none from
 * `defaultView`.
 *
 * Each block of the Lens's words has one job (backfill-boards design, section 6; `lens-words.ts` checks what can be checked
 * from the words): the tab is the card's name; `state` is what the card is doing to this reader on this post now, a short
 * status, never a sentence and never how it ends; `ends` is the way out, present whenever the card holds the reader or
 * covers the post; a play's note is that play's own part only; `report` is said only where there is more to say; and
 * `CardUi.hint` is the first-meet line.
 */
export interface CardView {
  /** How far the effect has gone, 0 to 1, drawn as the mark's edge; null draws no edge. */
  readonly progress: number | null;
  /** What the card is doing to this reader on this post now, as a short status of at most 6 words ("41% washed for you", "Holding you on this post"): never a sentence, never how it ends. */
  readonly state: string;
  /** The way out, in plain words ("Ends when you press Break free."): present whenever the card holds the reader or covers the post, and said for any state that ends. */
  readonly ends?: string;
  /** The reader has something to do with this card on this post now: the mark's notch. */
  readonly yours: boolean;
  readonly controls: readonly KitControl[];
  /** A line about each play, by play: that play's own part only ("Layer 3 of 3, on top · 40% washed"), never the whole card's. */
  readonly notes: Readonly<Record<Id, string>>;
  /** A longer plain-words report for the Lens, only where the card has more to say than its status and its way out. */
  readonly report?: string;
}

/**
 * What a writing card's play has made for one version of its post, as its effect draws it: its text (`text`), a generation still waiting
 * for the version (`waiting`: the cursor typing nothing), or none (`failed`: the generation failed and there is no earlier text to keep).
 * A play with no entry has nothing known yet, or nothing for the version drawn (History), and draws nothing. `resolveWritten` (written.ts).
 */
export type Written = { readonly text: string } | { readonly waiting: true } | { readonly failed: true };

/**
 * What an effect is given. It wraps `children`, the post's words as they would be drawn without it,
 * and draws whatever it likes around them or over them; with several cards played on a post each
 * card's `Effect` wraps the one played before it, the latest outermost, so a card's `children`
 * already carry the earlier cards' effects.
 *
 * An effect that works on the post's own words (Autocorrect's strips) does not search the drawn page for them: it wraps
 * `children` in a `TextLayer` (engine/ui/bbcode/layers.tsx) with runs at offsets into the post's visible text
 * (engine/bbcode/visible.ts), the same offsets its rules read on the server, and the BBCode renderer inside draws them.
 */
export interface EffectProps {
  /** The post, as every reader sees it now (its current words included). */
  readonly post: Act;
  /** This card's plays on the post, ordered by layer, then by when they were played: one for most cards, up to the card's stack for the rest. */
  readonly plays: readonly CardPlay[];
  /** What each play's effect has saved, by play: the post author's version, which every reader loads. A play that has saved none is absent. */
  readonly states: Readonly<Record<Id, EffectState>>;
  /** The plays the reader has released themselves from, on every device (their certification). Nothing here is ever broadcast or counted. */
  readonly released: ReadonlySet<Id>;
  /**
   * What each play of a card that writes (`CardRules.writes`) has made for the version of the post drawn, by play (written.ts): the text
   * of the version drawn now (a failed regeneration keeps the tail it had: the text of the play's latest earlier version), or what is still
   * waiting. In still mode it is the drawn version's own rows alone, so a tail shows in full whatever `states` hold. Empty for any other card.
   * An effect draws a tail after the words by wrapping `children` (`<>{children}<Tail/></>`), its element marked `data-kb-tail`: the
   * engine draws the post's words inline before it (bbcode.css), so the last line of the words and the tail's first characters share a line.
   */
  readonly written: ReadonlyMap<Id, Written>;
  /** The version of the post `written` is for (the post's Act, or the edit that made it), where it is known: what an author's save of a version names. */
  readonly version?: Id;
  readonly reader: EffectReader;
  readonly place: EffectPlace;
  /**
   * Which reach these plays are on (the card mechanic's design, section 7): the post's own, or one above it (its board, its thread,
   * its author) whose effect falls on every post there. An effect beyond a post saves no state: its plays have no post author.
   */
  readonly reach: Reach;
  /**
   * Say what this card's state is on this post, for its mark and the Lens, or clear it with null. Bound to this post and
   * this card by the engine; an effect says it as often as its state changes, and equal views cost nothing. The engine clears
   * it when the effect is gone.
   */
  readonly show: (view: CardView | null) => void;
  /** The reader has met this card's effect (the first-time callout). */
  readonly met: () => void;
  /**
   * Say that this effect holds the reader's screen (a takeover's full-screen view) or lets it go. No tip is shown over a held screen
   * (engine/ui/tips/store.ts); the engine clears it when the effect is gone.
   */
  readonly holdScreen: (held: boolean) => void;
  /**
   * Drawn in a play's moment (docs/plans/2026-11-03-effect-history-design.md, sections 3 and 5), not live. A card whose rules say its
   * effect can change after it lands (`drawnInMoment`) honors it, and a test of each such card asserts it:
   * - it draws `states` as given, as they stood then, and nothing the reader did since; it takes no input (no pointer, key or scroll
   *   handler is bound), starts no animation that changes what it shows (a fade, a snap-back, a strip's fall), lifts nothing, and
   *   makes nothing inert. A decoration that loops over the same state (a rainbow that cycles at the stack the moment caught) still
   *   moves, and holds under reduced motion as it does live: a moment holds the state, not the motion;
   * - its `show` gives the words the moment's frame shows for it (the view's `state`, "Gloomba's yellow, 40% washed"): the moment's
   *   words, which a reader can read as well as see;
   * - `save` and `release` refuse without asking, `met` does nothing, `holdScreen` does nothing, and `marks` is null.
   * False on every live post.
   */
  readonly still: boolean;
  /** The post's marks, drawn where the card's effect puts them (a takeover's only; null for every other card). */
  readonly marks: ReactNode;
  /**
   * Save a play's state, as the post's author (the server refuses anyone else, and so does this,
   * without asking); the screen shows what is saved at once and every other reader hears of it.
   * Bounded and checked by the card's rules (`CardRules.validateState`), whose refusal comes back in its words.
   */
  readonly save: (play: Id, state: Readonly<Record<string, unknown>>) => Promise<Answer<{ readonly play: Id; readonly savedAt: string }>>;
  /** Release the reader from a play's effect for good (Stick Around's certification), and show it at once. */
  readonly release: (play: Id) => Promise<Answer<{ readonly play: Id; readonly releasedAt: string }>>;
  /** A character's name as the screen the post is drawn on knows it, for a card that names a play's caster ("top: Spritey's yellow"). */
  readonly nameOf: (character: Id | null) => string;
  /** Each drive of this card on this post, in play order: only a card with `CardRules.drive` is given any (undefined for every other). */
  readonly drives?: readonly Drive[];
  /**
   * Give `amount` (hundredths) to a drive, as the reader's character at the HUD: the gift's Act and the giver's own balance, or the
   * refusal in the database's words (a closed drive, an amount not offered, a short wallet). A gift the answer carries is shown at once and
   * counted once, however it also arrives on the thread's channel. Refuses without asking in a moment and on a sample page.
   */
  readonly give: (drive: Id, amount: number) => Promise<Answer<Donated>>;
  /** Read the next page of a drive's wall, after the oldest gift shown, and append it. A failed read leaves the wall as it was. */
  readonly moreGifts: (drive: Id) => Promise<void>;
  /** The reader's own settled wallet, from the header's store (null before it is known): a give button short of Aura is the reader's own fact. */
  readonly wallet: Wallet | null;
  /**
   * The surface of this card's play on the post, for a card with `CardRules.surface`; undefined for every other card, and in a moment.
   * Any character may add to it (`draw`) and the post's own character takes ink off (`wash`); both refuse without asking in a moment and on a sample page.
   */
  readonly surface?: {
    /** The cells the layer covers now, of the grid's 10,000 (from the page's read, then the channel's). */
    readonly covered: number;
    /** The most cells it may cover: the card's limit (`CardRules.surface.limitKey`) as cells. */
    readonly most: number;
    /** The live draws and washes, oldest first; null until read (fetched near the viewport). */
    readonly acts: readonly SurfaceAct[] | null;
    /** Ask for `acts`: read once, and again each time the surface changes after. A page of many walls reads only the walls that ask. */
    near(): void;
    draw(play: Id, as: Id, input: unknown): Promise<Answer<SurfaceAct>>;
    /** As the post's character; refused for anyone else. */
    wash(play: Id, input: unknown): Promise<Answer<SurfaceAct>>;
  };
  /**
   * The post's ink registry, so two cards that hold ink on one post share it: each effect that holds ink `claim`s a hit test (client px) and
   * starts a stroke only where `topAt` is true, which it is for the outermost claimant whose hit test is true at that point. A press on an
   * outer card's ink works that card, and a press beside it falls through to the card beneath.
   */
  readonly ink: {
    /** Register a hit test; the answer takes it back. */
    claim(hit: (x: number, y: number) => boolean): () => void;
    /** Whether this effect is the outermost claimant whose hit test is true at the point. */
    topAt(x: number, y: number): boolean;
  };
  readonly children: ReactNode;
}

/** What the play form gives a card's own settings: its current value, and where to put the next. */
export interface ConfigFormProps {
  /** The settings as they stand; undefined before the player has touched them (the card's rules give the default). */
  readonly config: Readonly<Record<string, unknown>> | undefined;
  readonly onChange: (config: Readonly<Record<string, unknown>>) => void;
  /** The post it will land on, for a setting that depends on it. */
  readonly post: Act;
  /** Unique on the page, to hang the form's labels on. */
  readonly id: string;
  /** Every card of the instance that is cast on a post, as its face draws it (not only the player's hand), for a setting that names one (a set card that waits for a card). */
  readonly castable?: readonly CardFace[];
}

/**
 * A card's face, as data: a color and an image, which the Vending Machine's slot, the hand's card and
 * the play form draw. It is the instance's art, the one place a card's color is written, so a screen
 * never names one (tools/check-ui-tokens.mjs).
 */
export interface CardArt {
  /** The card's color, for its border, its glow and its fill: any CSS color. */
  readonly color: string;
  /** The ink set on `color`, readable on it. */
  readonly ink: string;
  /**
   * The card's art, a URL the bundler resolved: an SVG on the 540 by 840 canvas (TEMPLATE.canvas), or a WebP image of 1080 by 1680
   * (specs/card-art.md). It is decoration: the card's name and rules say the rest.
   */
  readonly canvas: string;
  /** The mark: a square SVG drawn to read at 18px, a URL the bundler resolved. */
  readonly mark: string;
  /** Who made the art, from its manifest, said on the sheet's foot line: "Art · <credit>". */
  readonly credit: string;
  /** One short line for the face of a small card, such as the hand's ("Hold a reader on a post."); none draws the name alone. */
  readonly tagline?: string;
}

export interface CardUi {
  /** The rules' `CardRules.key`. */
  readonly key: string;
  /**
   * Draws the card's effect on the post it was played on, wherever the post is drawn. A card without
   * one draws nothing beside its tag on the post. It must draw its `children` (the post's words),
   * or the post is gone. Never given a quote, which holds a post's words and is no post.
   */
  readonly Effect?: ComponentType<EffectProps>;
  /**
   * The ink of a play's tag where the card chooses it (Whoops!'s top layer takes the ink it splatted),
   * given the play and all of this card's plays on its post in play order: a `#rrggbb` hex or an opaque
   * `rgb()`, drawn as the tag's border and glow on the same glass, the text unchanged, and lifted toward
   * white where it is too dark to read there (`glassInk`, ink.ts). A play it gives none, or a color the
   * engine cannot read, keeps the tag its alignment draws.
   */
  readonly tag?: (play: CardPlay, plays: readonly CardPlay[]) => string | undefined;
  /** The card's own settings in the play form, when it has any (Whoops!'s ink). A card with none gives none. */
  readonly ConfigForm?: ComponentType<ConfigFormProps>;
  /**
   * What the play form calls the part of a play's price that depends on the post it lands on
   * ("Long post, +0.25 per 500 characters"), true to the settings the instance runs; the form says
   * "This post" where a card gives none. The amount is the rules' (`playPrice`), never this line's.
   */
  readonly surcharge?: (settings: Settings) => string;
  /**
   * The card's rules in plain words, for the Vending Machine and the hand: what it does and what it
   * costs, true to the settings the instance runs (its numbers are read from them, never restated).
   * Out of character: plain and honest.
   */
  readonly describe: (settings: Settings) => string;
  /** What the card does in one sentence with no numbers in it, for the face of a large card (the hand's sheet); `describe`'s words when none is given. */
  readonly summary?: string;
  /** The effect covers the post (the reader cannot read it as it stands), so the Lens leads with the card's controls. */
  readonly takeover?: boolean;
  /** `PostEffects` nests this card's effect innermost, whatever its play order, under every card without it (a layer other cards' ink lies on); among several, play order holds. A takeover is still outermost. */
  readonly beneath?: true;
  /** One short line the Lens gives a reader who has not yet met the card's effect: the first-meet line. */
  readonly hint?: string;
  /**
   * The status a card with no live view of its own shows as the Lens's heading (`CardView.state`), in place of `summary`: a short
   * status of at most 6 words, never a sentence ("Sparkling every post by that character"). A card whose status depends on how many of
   * its plays are on the post (Feelin' Fab's "2 of 3 stacked") gives a function of those plays. A card face down has the engine's
   * own, the same for every card that can be face down ("Face down on this post"), so one card's cannot be told from another's.
   * `instanceUiProblems` holds every card to having one, and to these words (lens-words.ts): the heading falls back to `summary`,
   * a sentence, without it.
   */
  readonly status?: string | ((plays: readonly CardPlay[]) => string);
  readonly art: CardArt;
  /**
   * What the player's log says of a state the post's author saved on a play of this card on one of the player's posts, where the
   * save is worth a line of its own (Whoops!'s layer washed clean): the line's What, and either a plain sentence of what it did (`said`,
   * read after "<caster>'s <card> on <post>.") or, for a card whose save is the author's own act, the verb of it (`verb`: "erased" makes
   * "You erased <card> on post #3."). A card gives none, or answers undefined, for a save that is not (a stroke washed away). Out of
   * character and true.
   */
  readonly logSave?: (state: unknown) => { readonly what: string; readonly said: string } | { readonly what: string; readonly verb: string } | undefined;
  /**
   * What a play of this card did, in a sentence, for the caster's played line and the author's "a card on your post" line, read
   * from the play's configuration ("It covers “Mario” with “Luigi”."). A card that gives none, or answers undefined, adds nothing.
   * Out of character and true. It is given what the play recorded with itself (`tokens`, for a card that writes: the length it bought, written
   * with the play and never worked out again from today's economy), for a card whose play is said with a number it recorded; `opened` (a drive card's play: true where its own id is its drive's, false where it joined one an earlier play opened; absent for a play with no drive), so a card can say which; and `starts` and `ends` (ISO times, as the server wrote them with the play) for a card whose play is said with the window it
   * names (a scored-as card's two settlements).
   */
  readonly logPlay?: (config: Readonly<Record<string, unknown>>, recorded: { readonly tokens?: number; readonly opened?: boolean; readonly starts?: string; readonly ends?: string }) => string | undefined;
  /**
   * What a card that writes (`CardRules.writes`) did to a post of the author's, for the author's log, as the verb phrase after its subject; the
   * engine names the card and the post, and says nothing of who played it or what it cost. `continued` follows "<card> on your post #3" (the
   * play's first text, whatever version it came on); `again` follows "Your edit of post #3", given the card's name (a text after an earlier text);
   * `failed` follows "<card> on post #3" (the failure that ended the play, which was refunded). A failure the play survived, and a failed
   * regeneration after a text, keep things as they were and have no line. Out of character and true.
   */
  readonly logWritten?: {
    readonly continued: string;
    readonly again: (card: string) => string;
    readonly failed: string;
  };
}
