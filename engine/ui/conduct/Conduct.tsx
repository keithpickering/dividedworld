/**
 * The code of conduct at /conduct (docs/plans/2026-11-02-conduct-design.md, section 9; the conduct plan's Task 1): the instance's sections
 * (`InstanceUi.conduct`), each a second-level heading with an anchor equal to its key (`/conduct#hate`), which registration, the sign-in
 * acceptance and a report's form can link to. The words are the instance's and are Markdown, drawn through the guide's renderer, so nothing
 * here sets HTML from a string.
 *
 * It is a public glass page, readable signed out, because a player reads it before they have an account (registration links here). It is
 * plain and never in character (CLAUDE.md, "The fiction may lie; the log never does"): its opening says the difference between the board's
 * own Report, which is play, and Report to admins, which reaches a person. It reads nothing but the instance's words and makes no request.
 */
import { useMemo } from 'react';
import { useKayfa } from '../context.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { CalmRegion } from '../glass/Calm.tsx';
import { parse } from '../guide/markdown.ts';
import { Blocks, type Fill } from '../guide/render.tsx';
import '../account/account.css';
import './conduct.css';

/** Where the page is. */
export const CONDUCT_PATH = '/conduct';

export function Conduct() {
  const { ui, settings } = useKayfa();
  const sections = useMemo(() => ui.conduct.sections.map((s) => ({ ...s, blocks: parse(s.text) })), [ui.conduct.sections]);
  /* The code names no setting and no marker; the renderer's fill is the page's own path and an empty marker. */
  const fill: Fill = { settings, path: CONDUCT_PATH, marker: () => null };
  return (
    <div className="kb-acct kb-conduct">
      <PageHead title="Code of conduct" />
      <CalmRegion className="kb-acct-panel">
        <p className="kb-acct-lead">This is the code everyone here plays by. The board&apos;s own Report button is part of the game: a Mod Bot hears it, and what happens next is play. Report to admins, on a post&apos;s glass layer, reaches a person, and is for a post that breaks this code.</p>
        {sections.map((s) => (
          <section key={s.key} id={s.key} className="kb-conduct-section" aria-labelledby={`${s.key}-title`}>
            <h2 id={`${s.key}-title`} className="kb-conduct-title">{s.title}</h2>
            <div className="kb-conduct-text"><Blocks blocks={s.blocks} fill={fill} /></div>
          </section>
        ))}
      </CalmRegion>
    </div>
  );
}

/** The page at /conduct: the same for every reader, signed in or out. */
export function ConductScreen() {
  return <Conduct />;
}
