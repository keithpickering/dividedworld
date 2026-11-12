/**
 * The admin's pages, reached from each other (the booster packs design, the amendment of 2026-11-07, "the admin pages share sub-navigation"): a strip of two
 * small buttons under a page's lead, Moves (the queue), The machine and Trophies, the current one filled and marked `aria-current="page"`. The Admin tab of the menu
 * still opens the queue; a later admin page adds a button here. Plain, out-of-character text like the pages around it; the strip stands in a calm of its own, as the lead above it does, so its words are legible on the smoke at a phone.
 */
import { GLASS_NAV } from '../glass/nav.ts';
import { CalmRegion } from '../glass/Calm.tsx';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import './admin-pages.css';

export type AdminPage = 'moves' | 'machine' | 'trophies';

export function AdminPages({ current }: { readonly current: AdminPage }) {
  return (
    <CalmRegion as="nav" aria-label="Admin pages" className="kb-admin-pages">
      <ButtonRow>
        <GlassButton size="s" to={GLASS_NAV.admin} kind={current === 'moves' ? 'primary' : 'secondary'} aria-current={current === 'moves' ? 'page' : undefined}>Moves</GlassButton>
        <GlassButton size="s" to={GLASS_NAV.adminMachine} kind={current === 'machine' ? 'primary' : 'secondary'} aria-current={current === 'machine' ? 'page' : undefined}>The machine</GlassButton>
        <GlassButton size="s" to={GLASS_NAV.adminTrophies} kind={current === 'trophies' ? 'primary' : 'secondary'} aria-current={current === 'trophies' ? 'page' : undefined}>Trophies</GlassButton>
      </ButtonRow>
    </CalmRegion>
  );
}
