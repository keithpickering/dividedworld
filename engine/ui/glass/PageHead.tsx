import type { ReactNode } from 'react';
import { ButtonRow } from './Button.tsx';

/**
 * The head every glass page opens with: the title in the display face, an eyebrow above it, a lead
 * beside it (under it when it would be narrower than 18em), the page's actions in a button row, and
 * a count after the title. The title is the oversized display heading with no calm behind it (the
 * Anton headings stand on the full smoke); the eyebrow and the lead carry a calm. `size="roster"` is
 * the character pages' 96px title. parts.css has the layout.
 */
export function PageHead({ title, eyebrow, lead, actions, count, size, tabs, calmed }: {
  readonly title: ReactNode;
  readonly eyebrow?: ReactNode;
  readonly lead?: ReactNode;
  readonly actions?: ReactNode;
  readonly count?: ReactNode;
  readonly size?: 'page' | 'roster';
  /** A tablist or a navigation of pressed-state buttons that goes with the title (whose log, which tab): the caller draws its `nav` or tablist and its ButtonRow. */
  readonly tabs?: ReactNode;
  /** The title stands in a calm: only for a surface whose smoke recipe is `calmAll` (the settlement's), where every text node must, large or not. The rest stand on the full smoke. */
  readonly calmed?: boolean;
}) {
  return (
    <div className="kb-page-head" data-kb-size={size}>
      {eyebrow !== undefined && <p className="kb-page-head-eyebrow kb-calm">{eyebrow}</p>}
      <h1 className={`kb-page-head-title kb-glass-display${calmed ? ' kb-calm' : ''}`}>
        {title}
        {count !== undefined && <> <span className="kb-page-head-count">{count}</span></>}
      </h1>
      {tabs !== undefined && <div className="kb-page-head-tabs">{tabs}</div>}
      {lead !== undefined && <p className="kb-page-head-lead kb-calm">{lead}</p>}
      {actions !== undefined && <ButtonRow>{actions}</ButtonRow>}
    </div>
  );
}
