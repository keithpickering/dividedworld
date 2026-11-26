/**
 * The admin's pages, reached from each other (the booster packs design, the amendment of 2026-11-07, "the admin pages share sub-navigation"): a strip of
 * small buttons under a page's lead, Moves (the queue), Reports, The machine, Trophies and Jobs, the current one filled and marked `aria-current="page"`. While any scheduled job is stopped, a plain line over the buttons says which and since when, linking to Jobs
 * (the job health design, section 3). The Admin tab of the menu
 * still opens the queue; a later admin page adds a button here. Plain, out-of-character text like the pages around it; the strip stands in a calm of its own, as the lead above it does, so its words are legible on the smoke at a phone.
 */
import { GLASS_NAV } from '../glass/nav.ts';
import { CalmRegion } from '../glass/Calm.tsx';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { JOBS, stoppedJobs } from '../../rules/jobs.ts';
import { useKayfa } from '../context.tsx';
import { useJobHealth } from '../jobs/useJobHealth.ts';
import { shortTime } from '../postbit/dates.ts';
import { Link } from '../router.tsx';
import './admin-pages.css';

export type AdminPage = 'moves' | 'reports' | 'machine' | 'trophies' | 'jobs';

/** The strip's line while jobs are stopped: how many, which (in the jobs' order) and since when (the earliest), or null while none is. */
function StoppedLine() {
  const { api } = useKayfa();
  const health = useJobHealth();
  const stopped = health === null ? [] : stoppedJobs(health);
  if (stopped.length === 0) return null;
  const names = JOBS.map((j) => j.name).filter((n) => stopped.some((h) => h.job === n)).map((n) => n.replace(/^kayfabb-/u, ''));
  const times = stopped.flatMap((h) => (h.since === null ? [] : [Date.parse(h.since)])).filter((t) => !Number.isNaN(t));
  const since = times.length === 0 ? null : shortTime(new Date(Math.min(...times)).toISOString(), api.now());
  const lead = `${stopped.length} ${stopped.length === 1 ? 'job has' : 'jobs have'} stopped`;
  return (
    <CalmRegion as="p" role="status" className="kb-admin-pages-stopped">
      <Link to={GLASS_NAV.adminJobs}>{lead}</Link>{`: ${names.join(', ')}${since === null ? '' : `, since ${since}`}.`}
    </CalmRegion>
  );
}

export function AdminPages({ current }: { readonly current: AdminPage }) {
  return (
    <>
      <StoppedLine />
      <Buttons current={current} />
    </>
  );
}

function Buttons({ current }: { readonly current: AdminPage }) {
  return (
    <CalmRegion as="nav" aria-label="Admin pages" className="kb-admin-pages">
      <ButtonRow>
        <GlassButton size="s" to={GLASS_NAV.admin} kind={current === 'moves' ? 'primary' : 'secondary'} aria-current={current === 'moves' ? 'page' : undefined}>Moves</GlassButton>
        <GlassButton size="s" to={GLASS_NAV.adminReports} kind={current === 'reports' ? 'primary' : 'secondary'} aria-current={current === 'reports' ? 'page' : undefined}>Reports</GlassButton>
        <GlassButton size="s" to={GLASS_NAV.adminMachine} kind={current === 'machine' ? 'primary' : 'secondary'} aria-current={current === 'machine' ? 'page' : undefined}>The machine</GlassButton>
        <GlassButton size="s" to={GLASS_NAV.adminTrophies} kind={current === 'trophies' ? 'primary' : 'secondary'} aria-current={current === 'trophies' ? 'page' : undefined}>Trophies</GlassButton>
        <GlassButton size="s" to={GLASS_NAV.adminJobs} kind={current === 'jobs' ? 'primary' : 'secondary'} aria-current={current === 'jobs' ? 'page' : undefined}>Jobs</GlassButton>
      </ButtonRow>
    </CalmRegion>
  );
}
