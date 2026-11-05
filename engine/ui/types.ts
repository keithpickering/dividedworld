/**
 * What an instance gives the engine's screens, beside the rules' `Instance`
 * (engine/rules/types.ts): its look and its out-of-character words. The engine's screens are
 * written against `InstanceUi` and never name an instance; the composition root (web/) hands one
 * to them ("KayfaBB never knows which instance it runs").
 *
 * Everything here a player reads out of character is plain and true ("The fiction may lie; the
 * log never does"). The System's in-character words are the rules' `Copy`.
 */
import type { FontFile } from './fonts.ts';
import type { Quadrant, Span } from '../rules/types.ts';
import type { CardUi } from './cards/types.ts';
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
}

/** A class's look on the reveal's bar and a badge: a color, and a pattern for those who cannot tell colors apart. */
export interface ClassLook {
  readonly color: string;
  /** A CSS background-image drawn over the color (a hatch, dots), or none. */
  readonly pattern?: string;
  /**
   * How the class earns and what hurts it, in plain words, for the class cards, with the numbers in force written in (the core loop
   * design, section 6, #57): `economy` is the instance's economy as the server holds it now (`economyNow`), so a number an admin has
   * retuned is the one said. `settlementLength` is the settlement span in force (the screen settings'), for a class whose rule counts
   * per settlement window (#179).
   */
  readonly description: (economy: Readonly<Record<string, number>>, settlementLength: Span) => string;
  /**
   * The class's marks on the reaction map, as the Turn board draws them on its class cards: the
   * quadrants it earns from (a plus), is hurt by (a minus), or earns by calling where a post ends up
   * (a dotted cell), and the same said in words, which is the marks' accessible name.
   */
  readonly marks?: ClassMarks;
}

export interface ClassMarks {
  readonly label: string;
  readonly earns?: readonly Quadrant[];
  readonly hurts?: readonly Quadrant[];
  readonly calls?: readonly Quadrant[];
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
  /** What the shop is called, in plain words: the log's line and the machine's group label say it. */
  readonly shopName: string;
  /**
   * Names for the machine's sign, decoration only: the Vending screen draws one picked at random each time it mounts. Absent,
   * the sign shows `shopName`. Each is at most 20 characters (the sign's width at 390px); `instanceUiProblems` refuses an empty
   * list, an empty entry and a long one.
   */
  readonly marquees?: readonly string[];
  /**
   * How a card's effect stays under reduced motion, in Settings' Motion sentence after "A card's
   * effect stays: ", naming the instance's own card the way its players know it (the engine names
   * none), such as "a card that holds you in place still does, only instantly."
   */
  readonly reducedMotionCard: string;
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

/**
 * One layer of smoke: SVG fractal noise through a color matrix, blurred. `color` is the matrix's
 * constant color as an 8-bit hex (what the browser quantizes it to); `alpha` is the matrix's alpha
 * row (r, g, b, a, bias), which turns the noise into the layer's cloud; `opacity` is the opacity of
 * the rect the filter is drawn on.
 */
export interface SmokeLayer {
  readonly color: string;
  readonly opacity: number;
  readonly alpha: readonly number[];
  /** feTurbulence's baseFrequency, x then y. */
  readonly frequency: readonly number[];
  readonly octaves: number;
  readonly seed: number;
  /** feGaussianBlur's stdDeviation. */
  readonly blur: number;
}

/** A strip of smoke wider than its frame that slides `travel` px back and forth, `seconds` each way. */
export interface SmokeDrift {
  readonly width: number;
  readonly seconds: number;
  readonly travel: number;
}

/**
 * The smoke of one kind of screen. `calm` is this surface's calm opacity where it differs from the
 * theme's; `calmAll` says every text node on the surface stands in a calm, large text too (the
 * guard does not hold its large text to the full smoke); `narrow` replaces `layers` below 600px.
 */
export interface SmokeRecipe {
  readonly layers: readonly SmokeLayer[];
  readonly drift?: SmokeDrift;
  readonly calm?: number;
  readonly calmAll?: boolean;
  readonly narrow?: readonly SmokeLayer[];
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

/** The glass: an instance's look for everything outside the board, as data (docs/plans/2026-10-30-glass-to-the-boards-plan.md, sections 4 to 6). */
export interface GlassTheme {
  /** Standard and high contrast: the same tokens, each with its tags, the high key's values reaching 7:1. */
  readonly keys: { readonly standard: GlassKey; readonly high: GlassKey };
  readonly smoke: {
    readonly recipes: Readonly<Record<string, SmokeRecipe>>;
    readonly surfaces: Readonly<Record<GlassSurface, string>>;
  };
  /** The calm's backing: its opacity and the width of its feathered edge in px. */
  readonly calm: { readonly opacity: number; readonly feather: number };
  /** The skewed controls' measure; any field not given is the engine's default, merged field by field (DEFAULT_CONTROLS, engine/ui/glass/apply.ts). */
  readonly controls?: GlassControlsInput;
  readonly sizes: Readonly<Record<string, GlassSize>>;
  readonly fonts: readonly GlassFont[];
  /** Each class's glass colors, by the class's key. */
  readonly classes: Readonly<Record<string, GlassClassColor>>;
  /** The orbs: six gradients and the orb's body. */
  readonly orbs: { readonly gradients: readonly GlassOrbStops[]; readonly body: { readonly core: string; readonly edge: string } };
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
  readonly reasonWords: (reason: string, params: Readonly<Record<string, number>>) => string;
  readonly copy: UiCopy;
  /** Each pip style's images, by key; `default` is always there. */
  readonly pips: Readonly<Record<string, PipImages>>;
  /** The glass: smoke, tokens, fonts and class colors for every screen outside the board. */
  readonly glass: GlassTheme;
  /**
   * Font files for the board's own stacks (the theme's `--kb-font-body` and `--kb-font-mono`), for a
   * device that has none of the families the stack names before them: a phone with no Verdana falls
   * to its own sans-serif otherwise. Each is installed at load (engine/ui/fonts.ts) and fetched only
   * where text needs it, so a device with an earlier family, or with the face installed, downloads nothing.
   */
  readonly boardFonts?: readonly FontFile[];
  /** The instance's pictures for its personas, by the key its rules name (`DeveloperPersona.avatar`) as a URL; a persona with none is drawn as an initial. */
  readonly avatars?: Readonly<Record<string, string>>;
  /** How each card draws and describes itself, one per card key the instance sells; a card with none is shown as its tag alone (engine/ui/cards/types.ts). */
  readonly cards: readonly CardUi[];
  /** The instance's onboarding words, in its developer persona's voice (docs/plans/2026-11-02-onboarding-plan.md, Task 4). */
  readonly onboarding: OnboardingUi;
  /** The instance's Strategy Guide: its prose, and Gabe's hint for each class (docs/plans/2026-11-02-onboarding-plan.md, Task 8). */
  readonly guide: GuideUi;
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
}

/** A post in the front door's sample thread. */
export interface FrontDoorPost {
  /** The key of a cast member. */
  readonly by: string;
  /** BBCode; `{{setting:<path>}}` is filled from the instance's settings, as the guide's are. */
  readonly body: string;
  /** Counts shown on the post, by reaction key. Static: nothing can be pressed. */
  readonly reactions: Readonly<Record<string, number>>;
  /** Cards played on the post, drawn by each card's `CardUi.Effect`: its key, who cast it (a cast key), and its config (a seeded card's seed included). */
  readonly plays?: readonly { readonly card: string; readonly by: string; readonly config: Readonly<Record<string, unknown>> }[];
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
  readonly tips: Readonly<Record<TipKey, { readonly title: string; readonly line: string }>>;
  readonly letter: string;
}
