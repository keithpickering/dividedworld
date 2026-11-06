import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Link } from '../router.tsx';

export type GlassButtonKind = 'primary' | 'secondary' | 'quiet';
export type GlassButtonSize = 'm' | 's';

type Common = {
  readonly kind?: GlassButtonKind;
  readonly size?: GlassButtonSize;
  readonly children?: ReactNode;
};
/** Without `to`, a button and its props. */
type AsButton = Common & { readonly to?: undefined; readonly ref?: Ref<HTMLButtonElement> } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;
/** With `to`, the router's Link and an anchor's props (plus `state`, `replace` and `early`, which the router's Link takes, and `disabled`, which a link has no attribute for). */
type AsLink = Common & { readonly to: string; readonly disabled?: boolean; readonly state?: unknown; readonly replace?: boolean; readonly early?: boolean } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>;
export type GlassButtonProps = AsButton | AsLink;

/**
 * The glass's skewed control, the one every screen draws instead of a button of its own. Its
 * measure comes from the control tokens (tokens.css) and its kind from the fills the glass's
 * primary, secondary and quiet controls have always had (parts.css). The label is held upright
 * inside the skew. A link that is disabled is an anchor with no href: it goes nowhere and leaves
 * the tab order.
 */
export function GlassButton(props: GlassButtonProps) {
  const { kind = 'secondary', size = 'm', children, className } = props;
  const cls = `kb-glass-button kb-glass-skew${className ? ` ${className}` : ''}`;
  const label = <span className="kb-glass-upright">{children}</span>;
  if (props.to !== undefined) {
    const { kind: _k, size: _s, children: _c, className: _n, to, disabled, onClick, state, replace, early, ...anchor } = props;
    if (disabled === true || anchor['aria-disabled'] === true || anchor['aria-disabled'] === 'true') {
      const { href: _h, target: _t, rel: _r, download: _d, tabIndex: _i, ...rest } = anchor;
      return <a {...rest} role="link" aria-disabled="true" className={cls} data-kb-kind={kind} data-kb-size={size}>{label}</a>;
    }
    return <Link {...anchor} to={to} state={state} replace={replace} early={early} onClick={onClick} className={cls} data-kb-kind={kind} data-kb-size={size}>{label}</Link>;
  }
  const { kind: _k, size: _s, children: _c, className: _n, to: _t, type, ...rest } = props;
  return <button type={type ?? 'button'} {...rest} className={cls} data-kb-kind={kind} data-kb-size={size}>{label}</button>;
}

/** Controls side by side: the row breaks between them and never inside one. */
export function ButtonRow({ children, align }: { readonly children?: ReactNode; readonly align?: 'start' | 'end' | 'center' }) {
  return <div className="kb-button-row" data-kb-align={align}>{children}</div>;
}
