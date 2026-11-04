import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from '../router.tsx';

export type GlassButtonKind = 'primary' | 'secondary' | 'quiet';
export type GlassButtonSize = 'm' | 's';

type Props = {
  readonly kind?: GlassButtonKind;
  readonly size?: GlassButtonSize;
  /** Set, the control is the router's Link to this path, not a button. */
  readonly to?: string;
  readonly children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

/**
 * The glass's skewed control, the one every screen draws instead of a button of its own. Its
 * measure comes from the control tokens (tokens.css) and its kind from the fills the glass's
 * primary, secondary and quiet controls have always had (parts.css). The label is held upright
 * inside the skew.
 */
export function GlassButton({ kind = 'secondary', size = 'm', to, children, className, type, ...rest }: Props) {
  const cls = `kb-glass-button kb-glass-skew${className ? ` ${className}` : ''}`;
  const label = <span className="kb-glass-upright">{children}</span>;
  if (to !== undefined) {
    return (
      <Link to={to} className={cls} data-kb-kind={kind} data-kb-size={size} aria-disabled={rest['aria-disabled']}>{label}</Link>
    );
  }
  return <button type={type ?? 'button'} className={cls} data-kb-kind={kind} data-kb-size={size} {...rest}>{label}</button>;
}

/** Controls side by side: the row breaks between them and never inside one. */
export function ButtonRow({ children, align }: { readonly children?: ReactNode; readonly align?: 'start' | 'end' | 'center' }) {
  return <div className="kb-button-row" data-kb-align={align}>{children}</div>;
}
