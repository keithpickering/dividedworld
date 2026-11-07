/**
 * A member group's rank bar (the member groups design, option A): a 2003 rank image, a small gradient bar in the group's color with its name in
 * capitals. The name is real text (the capitals are the stylesheet's), so a screen reader reads "Regulars" and not a picture.
 *
 * The color is a game piece's: it comes from the settings (`ScreenSettings.groups`, from `group_kinds`) as an inline custom property, so no theme
 * recolors a group, while a theme restyles the bar's shape through the `--kb-group-bar-*` tokens. A striped group (`stripe`) is drawn striped,
 * which is how a punishment group reads at a glance. Its lettering is measured on the face in group-bar-face.ts.
 *
 * Public: a character's group is public (characters_public), and so is its look.
 */
import type { CSSProperties } from 'react';
import type { ScreenSettings } from '../data/api.ts';
import './postbit.css';

export type GroupLook = Pick<ScreenSettings['groups'][number], 'key' | 'name' | 'color' | 'stripe'>;

export function GroupBar({ look }: { readonly look: GroupLook }) {
  return (
    <span className="kb-group-bar" data-kb-stripe={look.stripe ? '' : undefined} style={{ '--kb-group-color': look.color } as CSSProperties}>
      {look.name}
    </span>
  );
}
