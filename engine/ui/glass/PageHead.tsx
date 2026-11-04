import type { ReactNode } from 'react';
import { ButtonRow } from './Button.tsx';

/**
 * The head every glass page opens with: the title in the display face, an eyebrow above it, a lead
 * beside it (under it when it would be narrower than 18em), the page's actions in a button row, and
 * a count after the title. The calm is on the title and the lead, as each screen has it; parts.css
 * has the layout.
 */
export function PageHead({ title, eyebrow, lead, actions, count }: {
  readonly title: ReactNode;
  readonly eyebrow?: ReactNode;
  readonly lead?: ReactNode;
  readonly actions?: ReactNode;
  readonly count?: ReactNode;
}) {
  return (
    <div className="kb-page-head">
      {eyebrow !== undefined && <p className="kb-page-head-eyebrow kb-calm" data-kb-calm="flush">{eyebrow}</p>}
      <h1 className="kb-page-head-title kb-glass-display kb-calm" data-kb-calm="flush">
        {title}
        {count !== undefined && <> <span className="kb-page-head-count">{count}</span></>}
      </h1>
      {lead !== undefined && <p className="kb-page-head-lead kb-calm" data-kb-calm="flush">{lead}</p>}
      {actions !== undefined && <ButtonRow>{actions}</ButtonRow>}
    </div>
  );
}
