/**
 * The license and credits page at /license (docs/plans/2026-11-25-licensing-design.md, section 5; the licensing plan's Task 5): the engine's own
 * notice, the instance's terms (`InstanceUi.licensing.terms`, Markdown drawn through the guide's renderer as the code of conduct's sections are),
 * and the instance's credits. It is a public glass page, readable signed out, plain and never in character. Everything but the engine's notice
 * comes through `InstanceUi.licensing`; the page makes no request and shows nothing computed from a private fact.
 */
import { useMemo } from 'react';
import { useKayfa } from '../context.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { CalmRegion } from '../glass/Calm.tsx';
import { parse } from '../guide/markdown.ts';
import { Blocks, type Fill } from '../guide/render.tsx';
import type { LicenseCredit } from '../types.ts';
import '../account/account.css';
import './license.css';

/** Where the page is. */
export const LICENSE_PATH = '/license';

const AGPL_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

function Credit({ credit }: { readonly credit: LicenseCredit }) {
  return (
    <li className="kb-license-credit">
      <span className="kb-license-work">{credit.work}</span> by {credit.maker}. Terms: {credit.termsUrl ? <a href={credit.termsUrl} rel="noopener noreferrer">{credit.terms}</a> : credit.terms}.
      {credit.source && <> <a href={credit.source} rel="noopener noreferrer">Source</a>.</>}
      {credit.note && <> <span className="kb-license-note">{credit.note}</span></>}
    </li>
  );
}

export function License() {
  const { ui, settings } = useKayfa();
  const { source, terms, credits } = ui.licensing;
  const blocks = useMemo(() => parse(terms), [terms]);
  const fill: Fill = { settings, path: LICENSE_PATH, marker: () => null };
  return (
    <div className="kb-acct kb-license">
      <PageHead title="License & credits" />
      <CalmRegion className="kb-acct-panel">
        <section id="kayfabb" className="kb-license-section" aria-labelledby="kayfabb-title">
          <h2 id="kayfabb-title" className="kb-license-title">KayfaBB</h2>
          <p>KayfaBB is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.</p>
          <p>Copyright (C) 2026 Keith Pickering and the KayfaBB contributors.</p>
          <p><a href={AGPL_URL} rel="noopener noreferrer">GNU Affero General Public License, version 3</a></p>
          <p><a href={source} rel="noopener noreferrer">Get the source this site runs</a></p>
        </section>
        <section id="site" className="kb-license-section" aria-labelledby="site-title">
          <h2 id="site-title" className="kb-license-title">This site</h2>
          <div className="kb-license-text"><Blocks blocks={blocks} fill={fill} demote={1} /></div>
        </section>
        {credits.length > 0 && (
          <section id="credits" className="kb-license-section" aria-labelledby="credits-title">
            <h2 id="credits-title" className="kb-license-title">Credits</h2>
            <ul className="kb-license-credits">{credits.map((c) => <Credit key={`${c.work}|${c.maker}|${c.source ?? ''}`} credit={c} />)}</ul>
          </section>
        )}
      </CalmRegion>
    </div>
  );
}

/** The page at /license: the same for every reader, signed in or out. */
export function LicenseScreen() {
  return <License />;
}
