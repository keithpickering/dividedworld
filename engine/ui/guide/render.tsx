/**
 * The Strategy Guide's tree (markdown.ts) drawn as React elements. Nothing here sets HTML from a string: text is a child, so a `<script>`
 * in the prose is the characters it is, and a link is drawn only if the reader kept it (markdown.ts's `safeHref`). A site path is a
 * router link, so it moves without a reload; a fragment is this page's own; any other address is an ordinary link out.
 *
 * A marker is drawn by `marker`, which the screen gives (engine/ui/guide/markers.tsx), and a `{{setting:<path>}}` by `settingText`
 * against the live settings: a path it cannot say is a dash, never a number made up, and tools/check-guide.mjs refuses the path at build.
 */
import type { ReactNode } from 'react';
import type { ScreenSettings } from '../data/api.ts';
import { Link } from '../router.tsx';
import { settingText, type Block, type Inline } from './markdown.ts';

export interface Fill {
  readonly settings: ScreenSettings;
  /** The page's path, for a link to a fragment of it. */
  readonly path: string;
  /** What a marker draws; nothing for a name it does not know. */
  readonly marker: (name: string) => ReactNode;
}

export const DASH = '—';

function Inlines({ nodes, fill }: { readonly nodes: readonly Inline[]; readonly fill: Fill }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text': return n.text;
          case 'strong': return <strong key={i}><Inlines nodes={n.children} fill={fill} /></strong>;
          case 'em': return <em key={i}><Inlines nodes={n.children} fill={fill} /></em>;
          case 'code': return <code key={i}>{n.text}</code>;
          case 'setting': return settingText(n.path, fill.settings) ?? DASH;
          case 'link': {
            const words = <Inlines nodes={n.children} fill={fill} />;
            if (n.href.startsWith('#')) return <Link key={i} to={`${fill.path}${n.href}`}>{words}</Link>;
            if (n.href.startsWith('/')) return <Link key={i} to={n.href}>{words}</Link>;
            return <a key={i} href={n.href} rel="noopener noreferrer">{words}</a>;
          }
        }
      })}
    </>
  );
}

/** A heading's level in the tag it is drawn as: `demote` levels down (the letter's `##` is a `###` inside a section), at most the sixth. */
const tag = (level: number, demote: number): 'h2' | 'h3' | 'h4' | 'h5' | 'h6' => `h${Math.min(6, Math.max(2, level + demote))}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export function Blocks({ blocks, fill, demote = 0 }: { readonly blocks: readonly Block[]; readonly fill: Fill; readonly demote?: number }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'heading': {
            const H = tag(b.level, demote);
            return <H key={i}><Inlines nodes={b.children} fill={fill} /></H>;
          }
          case 'p': return <p key={i}><Inlines nodes={b.children} fill={fill} /></p>;
          case 'ul':
          case 'ol': {
            const List = b.t;
            return <List key={i}>{b.items.map((item, j) => <li key={j}><Inlines nodes={item} fill={fill} /></li>)}</List>;
          }
          case 'quote': return <blockquote key={i}><Blocks blocks={b.blocks} fill={fill} demote={demote} /></blockquote>;
          case 'hr': return <hr key={i} />;
          case 'marker': {
            const drawn = fill.marker(b.name);
            return drawn == null ? null : <div key={i} className="kb-guide-marker">{drawn}</div>;
          }
          case 'table':
            return (
              <div key={i} className="kb-guide-table-wrap" tabIndex={0}>
                <table className="kb-guide-table">
                  <thead><tr>{b.head.map((c, j) => <th key={j} scope="col"><Inlines nodes={c} fill={fill} /></th>)}</tr></thead>
                  <tbody>{b.rows.map((row, r) => <tr key={r}>{row.map((c, j) => <td key={j}><Inlines nodes={c} fill={fill} /></td>)}</tr>)}</tbody>
                </table>
              </div>
            );
        }
      })}
    </>
  );
}
