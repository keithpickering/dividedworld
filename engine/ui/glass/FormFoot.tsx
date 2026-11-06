import type { ReactNode } from 'react';
import { ButtonRow } from './Button.tsx';

/**
 * The foot of a form or a dialog, as the Turn board's footer draws it: one plain line saying what will happen, and the form's buttons
 * beside it. The line is built from the form's state (engine/ui/characters/footers.ts), so it never promises what the preview above it does
 * not. A rule above it and the glass's section gap over that set it apart from the last section. It stands in the form's calm, so its
 * words need none of their own. parts.css has the layout.
 */
export function FormFoot({ line, children }: { readonly line: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="kb-glass-form-foot">
      <p className="kb-glass-form-foot-line">{line}</p>
      <ButtonRow>{children}</ButtonRow>
    </div>
  );
}
