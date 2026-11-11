/**
 * What an instance gives the engine's screens, beside the rules' `Instance`
 * (engine/rules/types.ts): its look and its out-of-character words. The engine's screens are
 * written against `InstanceUi` and never name an instance; the composition root (web/) hands one
 * to them ("KayfaBB never knows which instance it runs").
 *
 * Everything here a player reads out of character is plain and true ("The fiction may lie; the
 * log never does"). The System's in-character words are the rules' `Copy`.
 */
import type { ConductMailOverride } from '../mail/conduct.ts';
import type { Quadrant, Span } from '../rules/types.ts';
import type { CardArt, CardUi } from './cards/types.ts';
import type { Alert } from './data/api.ts';
import type { TipKey } from './tips/keys.ts';

/**
 * A theme: a stylesheet that sets the `--kb-` tokens of engine/ui/tokens.css. `modes` says
 * which it holds: both (it follows the device, or the player's light or dark), or one only.
 */
export interface ThemeOption {
  readonly key: string;
  readonly name: string;
  readonly href: string;
  readonly modes: 'both' | 'light' | 'dark';
  /**
   * The tokens the picker's miniature draws, per mode, read from the theme's own file at build time (the instance imports it as
   * `theme.css?preview`, tools/theme-preview.mjs), so a preview never drifts from its theme. A theme that holds one mode only fills
   * that mode.
   */
  readonly preview: { readonly light?: ThemePreview; readonly dark?: ThemePreview };
}

/** A theme's tokens for one mode, resolved to literals (no `var()`), by token name: `--kb-head-bg`, `--kb-row-1` and the rest of tools/theme-preview.mjs's list. */
export type ThemePreview = Readonly<Record<string, string>>;

/** A class's look on the reveal's bar and a badge: a color, and a pattern for those who cannot tell colors apart. */
export interface ClassLook {
  readonly color: string;
  /** A CSS background-image drawn over the color (a hatch, dots), or none. */
  readonly pattern?: string;
  /**
   * How the class earns, in plain words, for the class cards, with the numbers in force written in (the core loop
   * design, section 6, #57): `economy` is the instance's economy as the server holds it now (`economyNow`), so a number an admin has
   * retuned is the one said. `settlementLength` is the settlement span in force (the screen settings'), for a class whose rule counts
   * per settlement window (#179). What hurts the class is `hurtsBy`, never in here: the card sets the two apart (the backfill design, section 5).
   */
  readonly description: (economy: Readonly<Record<string, number>>, settlementLength: Span) => string;
  /**
   * What hurts the class, in plain words and given the same numbers as `description` (it begins "Hurt by"): the card sets it under
   * the description, in the hurt color. `instanceUiProblems` refuses a class with none, and a description that still says "Hurt by".
   */
  readonly hurtsBy: (economy: Readonly<Record<string, number>>, settlementLength: Span) => string;
  /**
   * The class's marks on the reaction map, as the Turn board draws them on its class cards: the
   * quadrants it earns from (a plus), is hurt by (a minus), or earns by calling where a post ends up
   * (a dotted cell), and the same said in words, which is the marks' accessible name.
   */
  readonly marks?: ClassMarks;
}

/** The map's cells in the React picker's order: Heat and Hype on top, Groan and Calm below (the class cards and the guide draw it; a split must sit side by side in one row). */
export const MAP: readonly Quadrant[] = ['excitedNegative', 'excitedPositive', 'boredNegative', 'calmPositive'];

export interface ClassMarks {
  readonly label: string;
  readonly earns?: readonly Quadrant[];
  readonly hurts?: readonly Quadrant[];
  readonly calls?: readonly Quadrant[];
  /**
   * Two quadrants the class earns from together, by their balance: drawn as two cells each half-filled
   * toward the other and joined by a bar. The pair must sit side by side on the map (one row of
   * `MAP` above), and neither is also in `earns`, `hurts` or `calls`.
   */
  readonly splits?: readonly [Quadrant, Quadrant];
}

/**
 * A pip style's images, by the rules' `PipStyle.key`. Each is drawn as a mask over the pip's token
 * color (`--kb-pip`, `--kb-pip-empty`), so one image serves light and dark: its shape is what
 * counts, not its colors.
 */
export interface PipImages {
  readonly full: string;
  readonly empty: string;
}

/**
 * The out-of-character strings the engine's screens need. Each screen's words that are not the
 * instance's to give are the engine's own; these are the ones an instance names.
 */
export interface UiCopy {
  /** The banner's name, and the line under it. */
  readonly siteName: string;
  readonly siteTagline: string;
  /**
   * Who speaks for the board, in the instance's words, so the engine names no one. `roleWord` is the role that runs the board and
   * signs its moves ("The Boss"); `staffWord` is the staff as a whole, the name of an unsigned Act's author and of the index's
   * last post by one ("The staff"); `gameWord` is the game in the glass's plain voice, in the middle of a sentence ("the game":
   * "checked by the game"); `staffBoardTag` is the tag on the staff's board in the index ("Staff post here; you react and spin").
   * Each is non-empty text; `instanceUiProblems` refuses one that is not.
   */
  readonly roleWord: string;
  readonly staffWord: string;
  readonly gameWord: string;
  readonly staffBoardTag: string;
  /**
   * How a card's kind is said on its face and in its spoken name, in the instance's words, for each way a card is played: cast on a
   * target (`cast`), set face down (`set`) and used on the player's own post (`use`). Absent, a face says the play capitalized
   * ("Cast", "Set", "Use"). Each is non-empty text; `instanceUiProblems` refuses one that is not.
   */
  readonly cardKinds?: Readonly<Record<'cast' | 'set' | 'use', string>>;
  /** What the shop is called, in plain words: the log's line and the machine's group label say it. */
  readonly shopName: string;
  /**
   * Names for the machine's sign, decoration only: the Vending screen draws one picked at random each time it mounts. Absent,
   * the sign shows `shopName`. Each is at most 20 characters (the sign's width at 390px); `instanceUiProblems` refuses an empty
   * list, an empty entry and a long one.
   */
  readonly marquees?: readonly string[];
  /**
   * The footer's 80 by 15 badges, each a pair of short words (the first on the dark half, the second on the light), drawn in the
   * instance's own pixel face (`--kb-font-badge`) and hidden from assistive tech: decoration the instance may joke in, never a claim.
   * Absent, the footer holds the credit alone. A pair is at most 12 characters in all, which is what 80 pixels hold; `instanceUiProblems`
   * refuses an empty list, a pair that is not two words and a pair too wide.
   */
  readonly badges?: readonly (readonly [string, string])[];
  /**
   * How a card's effect still happens with motion Off, in Settings' Motion sentence after "A card's
   * effect still happens: ", naming the instance's own card the way its players know it (the engine names
   * none), such as "a card that holds you in place still does, only instantly."
   */
  readonly reducedMotionCard: string;
  /**
   * What the glass calls a Mod Bot's role where a screen names it, as it begins a sentence or a by-line ("A Moderator"): the Lens's visit tab
   * credits a Mod's acts with it. Absent, the engine's plain "A Mod" stands (engine/ui/cards/visit.ts).
   */
  readonly modRole?: string;
  /** Words where the instance names a thing in an alert; absent, the engine's plain words stand (engine/ui/alerts/words.ts). */
  readonly alerts?: AlertCopy;
}

/** The instance's words for the alerts that name something it invented. Each is plain and true: the glass describes the game, it never bluffs. */
export interface AlertCopy {
  /**
   * A hint's line and its detail by the pattern that fired (`leading:<quadrant>`, `divisive` or `thunder`, the alerts design's section 5),
   * and whether the Act it is about is a card play (`about.card`) and not a post: a hint can be about either, and for a thunder it says
   * which side of the theft the player is on. Undefined for a pattern the instance has no words for, which is then said in the engine's plain words. May joke, may not mislead.
   */
  readonly hint?: (pattern: string, about: { readonly card: boolean }) => { readonly line: string; readonly detail: string } | undefined;
  /**
   * A season-news alert's line and detail by its sub (`results`, `tally`, `bossArrived`, `bossLeft`) and the row (the Boss's name, a count of names);
   * undefined for one the instance has no words for, which is then said in the engine's plain words. The link to the Season page is the engine's.
   */
  readonly seasonNews?: (sub: string, row: Alert) => { readonly line: string; readonly detail: string } | undefined;
  /**
   * A `trapStruck` alert's line and detail, for the player whose post a face-down card landed on after a quote (`how: 'quote'`), or whose cast a
   * catching set card caught (`how: 'caught'`), in the instance's voice. It is handed only what the spring already shows everyone: the setter's character
   * (null where it could not be read), the setter's card (the quote's `card`; for a caught cast, the caster's own card), the card laid (null for a
   * caught cast) and how long the card was set face down before it sprang ("two days"; null where unknown). It may gloat and may not bluff:
   * what it says happened did. Undefined for one the instance has no words for, which is then said in the engine's plain words.
   */
  readonly trapStruck?: (facts: TrapStruckFacts) => { readonly line: string; readonly detail: string } | undefined;
}

/** What a `trapStruck` alert's words may say (AlertCopy.trapStruck): public facts of the spring, never an account or a class. */
export interface TrapStruckFacts {
  readonly how: 'quote' | 'caught';
  readonly setter: string | null;
  readonly card: string | null;
  readonly laid: string | null;
  readonly span: string | null;
  /** Whether the setter is a staff character (a public fact of a character): a staff catching set card takes nothing, so the caught card is spent. */
  readonly setterStaff: boolean;
  /** For a quote that met conditions: the passage the quoted excerpt held, already shortened and in quotation marks; null where none was set. Never an Anyone-but list. */
  readonly passage?: string | null;
  /** For a quote that met conditions: the phrase the quoting post said, already shortened and in quotation marks; null where none was set. */
  readonly says?: string | null;
}

/**
 * Where the glass draws smoke: the engine's closed list. Each surface names one of the instance's
 * smoke recipes (`GlassTheme.smoke.surfaces`), so a surface the engine adds is a surface every
 * instance must name a recipe for, and tools/check-glass-contrast.mjs refuses one that does not.
 */
export type GlassSurface =
  | 'hud' | 'hand' | 'play' | 'react' | 'turn' | 'effect' | 'vending'
  | 'characters' | 'rankings' | 'log' | 'settings' | 'account' | 'settlement';

/**
 * Where the glass draws a sheet over the board instead of smoke: the engine's closed list of overlay sheets. An overlay's panel is
 * `--kb-glass-sheet` over a scrim over whatever page is behind it, which can be white, so a sheet is read by its own rule in
 * tools/check-glass-contrast.mjs (the scrim's share read from the overlay's stylesheet), and the guard refuses an overlay it has no
 * rule for. `'tips'` is the spotlight's panel (engine/ui/tips/tips.css).
 */
export type GlassOverlay = 'tips';

/**
 * How a class's large text (`GlassClassColor.large`) is drawn on a surface: on the full smoke, inside
 * a calm, or not at all. The engine says which for every surface (`classLargeText`,
 * engine/ui/glass/apply.ts), and tools/check-glass-contrast.mjs reads each class against it.
 */
export type ClassLargeDraw = 'full' | 'calmed' | 'none';

/** How a field layer slides: `seconds` each way across `travel` px, so layers at different rates read as depth. */
export interface FieldDrift {
  readonly seconds: number;
  readonly travel: number;
}

/**
 * One layer of the field's shape: SVG fractal noise through a color matrix's alpha row, blurred.
 * The shape is shared by every surface (the glass polish design, section 6); a surface's recipe
 * gives only the layer's color and opacity (`LayerColor`). `alpha` is the matrix's alpha row
 * (r, g, b, a, bias), which turns the noise into the layer's cloud.
 */
export interface FieldLayer {
  readonly alpha: readonly number[];
  /** feTurbulence's baseFrequency, x then y. */
  readonly frequency: readonly number[];
  readonly octaves: number;
  readonly seed: number;
  /** feGaussianBlur's stdDeviation. */
  readonly blur: number;
  readonly drift: FieldDrift;
}

/**
 * What one surface's recipe says of one field layer: the matrix's constant color as an 8-bit hex
 * (what the browser quantizes it to) and the opacity of the layer's element. An opacity of 0 leaves
 * the layer out on that surface.
 */
export interface LayerColor {
  readonly color: string;
  readonly opacity: number;
}

/**
 * The smoke of one kind of screen: a color and opacity for each field layer, in the field's order
 * (`colors`, one per `GlassTheme.smoke.field.layers`). Below 600px the field's `narrow` layers are
 * drawn instead, in `narrowColors` (one per narrow layer) or, where the recipe has none, in the
 * first colors. `calm` is this surface's calm opacity where it differs from the theme's; `calmAll`
 * says every text node on the surface stands in a calm, large text too (the guard does not hold its
 * large text to the full smoke).
 */
export interface SmokeRecipe {
  readonly colors: readonly LayerColor[];
  readonly narrowColors?: readonly LayerColor[];
  readonly calm?: number;
  readonly calmAll?: boolean;
}

/**
 * How the contrast guard reads a token: `body` (4.5:1 against its surface's calmed worst pixel),
 * `large` (3:1 against the full smoke), `waiting` (3:1 calmed), `ink` (4.5:1 against the fill it is
 * for, named by `on`). A token with no tag is not text.
 */
export type GlassTag = 'body' | 'large' | 'waiting' | 'ink';

export interface GlassToken {
  readonly value: string;
  readonly tags?: readonly GlassTag[];
  /** For an ink: the tokens it is set on. */
  readonly on?: readonly string[];
}

/** A key: every `--kb-glass-*` token the glass reads, name to value. */
export type GlassKey = Readonly<Record<string, GlassToken>>;

/** A size step: `--kb-glass-size-<name>`, in px, in the face (family and weight) it is set in. */
export interface GlassSize {
  readonly px: number;
  readonly family: string;
  readonly weight: number;
  /** A phone's step: held to 16px of computed size, not to ink. */
  readonly phone?: boolean;
}

/** One font file: the family it joins, its weight and style, and its ink ratio (see tools/check-glass-contrast.mjs). */
export interface GlassFont {
  readonly family: string;
  /** In glass.json a path under the instance's ui/ folder; in `InstanceUi.glass` the URL the instance resolved it to. */
  readonly file: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
  /** The share of its em the face inks from ascender to descender. */
  readonly ink: number;
}

/** A class's color on the glass: its fill, the ink set on that fill, and its color as large text. */
export interface GlassClassColor {
  readonly fill: string;
  readonly ink: string;
  readonly large: string;
}

/** An orb's three stops: highlight, color, shade. */
export interface GlassOrbStops {
  readonly highlight: string;
  readonly color: string;
  readonly shade: string;
}

/** One control size's height and horizontal padding in px, and its type size by the size step's name (`body`, `phone-small`). */
export interface GlassControlSize {
  readonly height: number;
  readonly pad: number;
  readonly size: string;
}

/** The skewed controls (GlassButton): sizes m and s on the Main layout and on the phone's, the letter spacing and the gap in a row, in px. */
export interface GlassControls {
  readonly m: GlassControlSize;
  readonly s: GlassControlSize;
  readonly phone: { readonly m: GlassControlSize; readonly s: GlassControlSize };
  readonly spacing: number;
  readonly gap: number;
}

/** What a theme may give of the controls' measure: any field it leaves out is the engine's default (`glassVars` merges field by field). */
export interface GlassControlsInput {
  readonly m?: Partial<GlassControlSize>;
  readonly s?: Partial<GlassControlSize>;
  readonly phone?: { readonly m?: Partial<GlassControlSize>; readonly s?: Partial<GlassControlSize> };
  readonly spacing?: number;
  readonly gap?: number;
}

/** A feel of the glass's motion: Smooth or Snappy (docs/plans/2026-11-04-glass-polish-design.md, section 9). */
export type Feel = 'smooth' | 'snappy';

/** One feel's tokens: durations in ms, an ease (a cubic-bezier), an optional spring, and how an enter looks. */
export interface FeelTokens {
  /** An enter's duration, ms. */
  readonly enter: number;
  /** An exit's duration, ms. */
  readonly exit: number;
  /** A screen change's (and a crossing's) duration, ms. */
  readonly screen: number;
  /** The gap between one item's entrance and the next's, ms; capped so the last starts within `screen`. */
  readonly stagger: number;
  /** A CSS `cubic-bezier(a, b, c, d)`. */
  readonly ease: string;
  /** Where a thing lands with a spring (stiffness, damping); absent means eased. */
  readonly spring?: { readonly stiffness: number; readonly damping: number };
  /** How far an enter travels, px. */
  readonly distance: number;
  /** The blur an enter clears, px. */
  readonly blur: number;
  /** The scale an enter grows from. */
  readonly scale: number;
  /** What a mask does: a plain fade, or a wipe along the glass's skew. */
  readonly mask: 'fade' | 'skew';
}

/** An instance's overrides of either feel's tokens in glass.json; the engine's defaults stand where it gives none. */
export interface GlassMotion {
  readonly smooth?: Partial<FeelTokens>;
  readonly snappy?: Partial<FeelTokens>;
}

/** The glass: an instance's look for everything outside the board, as data (docs/plans/2026-10-30-glass-to-the-boards-plan.md, sections 4 to 6). */
export interface GlassTheme {
  /** Standard and high contrast: the same tokens, each with its tags, the high key's values reaching 7:1. */
  readonly keys: { readonly standard: GlassKey; readonly high: GlassKey };
  readonly smoke: {
    /** The one field of clouds every surface is a window onto: its layers, and `narrow` below 600px. At most 4 layers, 3 narrow. */
    readonly field: { readonly layers: readonly FieldLayer[]; readonly narrow?: readonly FieldLayer[] };
    readonly recipes: Readonly<Record<string, SmokeRecipe>>;
    readonly surfaces: Readonly<Record<GlassSurface, string>>;
  };
  /** The calm's backing: its opacity and the width of its feathered edge in px. */
  readonly calm: { readonly opacity: number; readonly feather: number };
  /** The skewed controls' measure; any field not given is the engine's default, merged field by field (DEFAULT_CONTROLS, engine/ui/glass/apply.ts). */
  readonly controls?: GlassControlsInput;
  /** Either feel's tokens, over the engine's defaults (engine/ui/glass/motion-tokens.ts). */
  readonly motion?: GlassMotion;
  readonly sizes: Readonly<Record<string, GlassSize>>;
  readonly fonts: readonly GlassFont[];
  /** Each class's glass colors, by the class's key. */
  readonly classes: Readonly<Record<string, GlassClassColor>>;
  /** The orbs: six gradients and the orb's body. */
  readonly orbs: { readonly gradients: readonly GlassOrbStops[]; readonly body: { readonly core: string; readonly edge: string } };
}

/** An instance's code of conduct: a version and its sections, read by engine/ui/conduct/Conduct.tsx. */
export interface ConductUi {
  readonly version: number;
  readonly sections: readonly { readonly key: string; readonly title: string; readonly text: string }[];
  /** Words for the moderation emails in place of the engine's (engine/mail/conduct.ts); a template left out keeps the engine's. */
  readonly mail?: ConductMailOverride;
}

export interface InstanceUi {
  /** The themes a player may pick; the first is the house theme, used when the account says "system". */
  readonly themes: readonly ThemeOption[];
  /** The four quadrants' labels on the reaction picker. */
  readonly quadrantLabels: Readonly<Record<Quadrant, string>>;
  /**
   * The class whose glass colors (`GlassTheme.classes`) each quadrant wears on the reaction picker,
   * by the class's key: its tint and its label in the class's large text, as the React board draws
   * them. A quadrant the instance gives no class is drawn in the glass's own text.
   */
  readonly quadrantClasses?: Readonly<Partial<Record<Quadrant, string>>>;
  /** Each class's look, by the class's key. */
  readonly classLooks: Readonly<Record<string, ClassLook>>;
  /**
   * A ledger reason (a class's `face.cheered`) as one plain sentence for the player's own log,
   * saying what the character did or drew. The log prints the amount, and where a line has them
   * the Act and the quadrant, beside it. Never who reacted.
   *
   * `params` are the numbers the sentence states (the core loop design, section 6, #57): a settled
   * line's own, which the settlement wrote into its ledger row (`ledger.params`, 0073), so a line
   * settled before a retune says the numbers it was settled under; and, for a row with none and for
   * the live estimate, the economy as the server holds it now (`economyNow`).
   */
  readonly reasonWords: (reason: string, params: Readonly<Record<string, number | string>>) => string;
  readonly copy: UiCopy;
  /** Each pip style's images, by key; `default` is always there. */
  readonly pips: Readonly<Record<string, PipImages>>;
  /** The glass: smoke, tokens, fonts and class colors for every screen outside the board. */
  readonly glass: GlassTheme;
  /** The instance's pictures for its personas, by the key its rules name (`DeveloperPersona.avatar`) as a URL; a persona with none is drawn as an initial. */
  readonly avatars?: Readonly<Record<string, string>>;
  /** How each card draws and describes itself, one per card key the instance sells; a card with none is shown as its tag alone (engine/ui/cards/types.ts). */
  readonly cards: readonly CardUi[];
  /** How each pack the instance sells draws itself, by the rules' `PackRules.key`: its name and its face art, placed as a card's face art is (engine/ui/cards/types.ts, `CardArt`). */
  readonly packs: Readonly<Record<string, { readonly name: string; readonly art: CardArt }>>;
  /**
   * The instance's mark for a card's back: a URL the bundler resolved, drawn at the center of the back's crossed bands
   * (`PostcardBack`). It is the instance's, never a card's, so a back still says nothing about the card it is. Without it the back
   * is the glass's bands alone.
   */
  readonly cardBack?: { readonly mark: string };
  /** The instance's onboarding words, in its developer persona's voice (docs/plans/2026-11-02-onboarding-plan.md, Task 4). */
  readonly onboarding: OnboardingUi;
  /** The instance's Strategy Guide: its prose, and Gabe's hint for each class (docs/plans/2026-11-02-onboarding-plan.md, Task 8). */
  readonly guide: GuideUi;
  /**
   * The instance's code of conduct (docs/plans/2026-11-02-conduct-design.md, section 9): versioned, so an account accepts the current
   * version. Each section's `key` is its anchor on /conduct, its `title` the bold sentence, its `text` plain Markdown.
   */
  readonly conduct: ConductUi;
  /** What a signed-out visitor meets: a made-up sample thread, the developer persona's note and the HUD's prompt (docs/plans/2026-11-05-front-door-design.md, section 4). */
  readonly frontDoor: FrontDoorUi;
}

/** A made-up character in the front door's sample thread; there is no profile behind it. */
export interface FrontDoorCharacter {
  /** Unique in the cast: what a post's `by` names. */
  readonly key: string;
  readonly name: string;
  /** The postbit's custom title, as a character's. */
  readonly title?: string;
  /** Which of the instance's ranks the postbit draws (an index into `instance.ranks`). */
  readonly rank: number;
  readonly posts: number;
  /**
   * The class this character's player revealed, and when: drawn by the postbit's own "Revealed: <class> (date)" line, so a sample cast
   * can show one of each class through a mechanic the game has. None keeps the class hidden, as a character's is until its player reveals it.
   */
  readonly revealed?: { readonly class: string; readonly at: string };
  /** The sample character's pictures, URLs the instance's bundler gives; none keeps the initial the postbit draws where a character has no avatar. */
  readonly avatarSquare?: string;
  readonly avatarPortrait?: string;
}

/** A post in the front door's sample thread. */
export interface FrontDoorPost {
  /** The key of a cast member. */
  readonly by: string;
  /** BBCode; `{{setting:<path>}}` is filled from the instance's settings, as the guide's are. */
  readonly body: string;
  /** The counts the post starts with, by reaction key; a visitor's own reactions are added on their screen alone. */
  readonly reactions: Readonly<Record<string, number>>;
  /**
   * Cards played on the post, each shown by its card's mark and drawn by its `CardUi.Effect`: its key, who cast it (a cast key), its
   * config (a seeded card's seed included), its layer where the card stacks (1 when none is given), and the counts its play starts with.
   */
  readonly plays?: readonly {
    readonly card: string; readonly by: string; readonly config: Readonly<Record<string, unknown>>;
    readonly layer?: number; readonly reactions?: Readonly<Record<string, number>>;
  }[];
}

/**
 * The front door: the sample thread a signed-out visitor reads in place of the board, which stays hidden. Every word is the instance's,
 * committed and approved by the owner in review; nothing in it is read from the server (`instanceUiProblems` holds it to the instance).
 */
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

/**
 * The Strategy Guide's words from an instance. `markdown` is the guide's prose: the Markdown engine/ui/guide/markdown.ts reads, with its
 * markers (the letter, the reaction grid, the classes, the cards) and `{{setting:<path>}}` for every number, so a retune keeps it true.
 * `hints` is one line for each of the instance's classes, in the persona's voice, shown with the class's own description; the keys are
 * exactly the instance's classes (tools/check-guide.mjs).
 */
export interface GuideUi {
  readonly markdown: string;
  readonly hints: Readonly<Record<string, string>>;
}

/**
 * The words onboarding needs from an instance. `tips` has every tip key the engine knows and none it does not
 * (`instanceUiProblems`, engine/ui/tips/problems.ts); each is a title (what the spotlight is headed) and a line. `letter` is the
 * welcome page's letter, Markdown (Task 7 draws it).
 */
export interface OnboardingUi {
  readonly tips: Readonly<Record<TipKey, { readonly title: string; readonly line: string; /** The label of the button the engine gives this tip (`ACTION_TIPS`, engine/ui/tips/keys.ts). */ readonly action?: string }>>;
  readonly letter: string;
}
