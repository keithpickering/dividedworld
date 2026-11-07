import { useId } from 'react';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import { Link, usePendingFrom } from '../router.tsx';
import { Spinner } from './Spinner.tsx';

export type GlassButtonKind = 'primary' | 'secondary' | 'quiet';
export type GlassButtonSize = 'm' | 's';

type Common = {
  readonly kind?: GlassButtonKind;
  readonly size?: GlassButtonSize;
  readonly children?: ReactNode;
  /** A wait is out: the label gives way to the spinner and a press does nothing. The control is not `disabled`, so focus stays. */
  readonly busy?: boolean;
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
 * inside the skew, in one grid cell with the spinner, so the width is the label's whether or not
 * it is busy. A link with `to` is busy, too, while the load it started is out. A link that is disabled is an anchor with no href: it goes nowhere and leaves
 * the tab order.
 */
export function GlassButton(props: GlassButtonProps) {
  const { kind = 'secondary', size = 'm', children, className } = props;
  const source = useId();
  const pending = usePendingFrom(props.to !== undefined ? source : undefined);
  const busy = props.busy === true || pending;
  const cls = `kb-glass-button kb-glass-skew${className ? ` ${className}` : ''}`;
  const label = <span className="kb-glass-upright"><span className="kb-glass-label">{children}</span><Spinner /></span>;
  const busyAttr = busy ? { 'aria-busy': true as const } : {};
  if (props.to !== undefined) {
    const { kind: _k, size: _s, children: _c, className: _n, busy: _b, to, disabled, onClick, state, replace, early, ...anchor } = props;
    if (disabled === true || anchor['aria-disabled'] === true || anchor['aria-disabled'] === 'true') {
      const { href: _h, target: _t, rel: _r, download: _d, tabIndex: _i, ...rest } = anchor;
      return <a {...rest} role="link" aria-disabled="true" className={cls} data-kb-kind={kind} data-kb-size={size}>{label}</a>;
    }
    const press = (e: MouseEvent<HTMLAnchorElement>) => {
      if (busy) { e.preventDefault(); return; }
      onClick?.(e);
    };
    return <Link {...anchor} {...busyAttr} to={to} source={source} state={state} replace={replace} early={early} onClick={press} className={cls} data-kb-kind={kind} data-kb-size={size}>{label}</Link>;
  }
  const { kind: _k, size: _s, children: _c, className: _n, busy: _b, to: _t, type, onClick, ...rest } = props;
  const press = (e: MouseEvent<HTMLButtonElement>) => {
    if (busy) { e.preventDefault(); return; }
    onClick?.(e);
  };
  return <button type={type ?? 'button'} {...rest} {...busyAttr} onClick={press} className={cls} data-kb-kind={kind} data-kb-size={size}>{label}</button>;
}

/** Controls side by side: the row breaks between them and never inside one. */
export function ButtonRow({ children, align }: { readonly children?: ReactNode; readonly align?: 'start' | 'end' | 'center' }) {
  return <div className="kb-button-row" data-kb-align={align}>{children}</div>;
}
