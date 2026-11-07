/**
 * The admin's pages, reached from each other (the booster packs design, the amendment of 2026-11-07, "the admin pages share sub-navigation"): a strip of two
 * small buttons under a page's lead, Moves (the queue) and The machine, the current one filled and marked `aria-current="page"`. The Admin tab of the menu
 * still opens the queue; a later admin page adds a button here. Plain, out-of-character text like the pages around it.
 */
import { GLASS_NAV } from '../glass/nav.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import './admin-pages.css';

export type AdminPage = 'moves' | 'machine';

export function AdminPages({ current }: { readonly current: AdminPage }) {
  return (
    <nav aria-label="Admin pages" className="kb-admin-pages">
      <ButtonRow>
        <GlassButton size="s" to={GLASS_NAV.admin} kind={current === 'moves' ? 'primary' : 'secondary'} aria-current={current === 'moves' ? 'page' : undefined}>Moves</GlassButton>
        <GlassButton size="s" to={GLASS_NAV.adminMachine} kind={current === 'machine' ? 'primary' : 'secondary'} aria-current={current === 'machine' ? 'page' : undefined}>The machine</GlassButton>
      </ButtonRow>
    </nav>
  );
}
