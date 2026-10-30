/**
 * A class as a chip in its own glass colors, the class's fill with its ink, as the Roster and Turn
 * boards draw it. It is drawn only from the player's own rows (`MyCharacter.class`), on the
 * player's own screens, so a class's color never says anything about a character the viewer does
 * not play ("A response never proves a private fact"). The colors are the instance's
 * (`--kb-glass-class-<key>-fill` and `-ink`, engine/ui/glass/apply.ts); the engine names none.
 */
import type { CSSProperties } from 'react';

export const classVars = (cls: string) => ({
  '--kb-class-fill': `var(--kb-glass-class-${cls}-fill)`,
  '--kb-class-ink': `var(--kb-glass-class-${cls}-ink)`,
  '--kb-class-large': `var(--kb-glass-class-${cls}-large)`,
}) as CSSProperties;

export function ClassChip({ cls, name }: { readonly cls: string; readonly name: string }) {
  return <span className="kb-class-chip" data-kb-class={cls} style={classVars(cls)}>{name}</span>;
}
