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
}

export interface InstanceUi {
  /** The themes a player may pick; the first is the house theme, used when the account says "system". */
  readonly themes: readonly ThemeOption[];
  /** The four quadrants' labels on the reaction picker. */
  readonly quadrantLabels: Readonly<Record<Quadrant, string>>;
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
}
