/**
 * The glass's wait: four skewed bars rising in a wave, a meter charging (the Signal, option C of
 * docs/research/2026-11-07-glass-load/spinner.html). It draws in `currentColor`, so the control it
 * sits in sets its color, and it is hidden from assistive technology: what announces a wait is the
 * control's `aria-busy`, never the drawing. Under Motion Off (`data-kb-motion='reduce'`) it stands
 * still at four heights (spinner.css).
 */
import './spinner.css';

export function Spinner({ className }: { readonly className?: string }) {
  return (
    <span className={`kb-spinner${className ? ` ${className}` : ''}`} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}
