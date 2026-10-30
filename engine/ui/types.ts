/**
 * What an instance gives the engine's screens, beside the rules' `Instance`
 * (engine/rules/types.ts): its look and its out-of-character words. The engine's screens are
 * written against `InstanceUi` and never name an instance; the composition root (web/) hands one
 * to them ("KayfaBB never knows which instance it runs").
 *
 * Everything here a player reads out of character is plain and true ("The fiction may lie; the
 * log never does"). The System's in-character words are the rules' `Copy`.
 */
import type { Quadrant } from '../rules/types.ts';

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
  /** How the class earns and what hurts it, in plain words, for the class cards. */
  readonly description: string;
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
  /** What the shop is called (the owner names it later; a placeholder until then). */
  readonly shopName: string;
  /**
   * How a card's effect stays under reduced motion, in Settings' Motion sentence after "A card's
   * effect stays: ", naming the instance's own card the way its players know it (the engine names
   * none), such as "a card that holds you in place still does, only instantly."
   */
  readonly reducedMotionCard: string;
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
   * the Act and the quadrant, beside it; a settled ledger row holds nothing more than its reason
   * (supabase/migrations/0003_aura.sql), so the sentence never depends on more. Never who reacted.
   */
  readonly reasonWords: (reason: string) => string;
  readonly copy: UiCopy;
  /** Each pip style's images, by key; `default` is always there. */
  readonly pips: Readonly<Record<string, PipImages>>;
  /** The glass: smoke, tokens, fonts and class colors for every screen outside the board. */
  readonly glass: GlassTheme;
}
