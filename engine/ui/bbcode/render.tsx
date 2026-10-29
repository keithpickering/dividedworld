/**
 * The BBCode renderer: React elements for the tree engine/bbcode/parse.ts makes, and nothing else.
 *
 * It handles exactly the parser's node types. Every string goes in as a React text child, which
 * escapes it, and nothing here reaches for raw markup, so a post cannot put script on the page
 * whatever it contains; the parser has already refused any address or color the allowlist does not
 * cover (a refused tag is text in the tree, so it is text here). A link says it is a reader's
 * link and keeps the reader's address from the host (`rel` and `referrerPolicy`), and an image is
 * loaded lazily with no referrer, since its host sees every reader that loads it.
 *
 * A quote names an Act, not a place: where that Act is (this thread, another, which page) is the
 * screen's to say, so the screen hands a `quoteLink` that returns the link for an Act's id. With none,
 * the quote is still a quote, without a link.
 */
import { memo, useMemo, type ReactNode } from 'react';
import { parse, type BbNode } from '../../bbcode/parse.ts';
import { Link } from '../router.tsx';
import './bbcode.css';

export interface BbCodeProps {
  readonly text: string;
  /** The link to the Act a quote quotes, by the Act's id. */
  readonly quoteLink?: (act: string) => ReactNode;
}

const REL = 'noopener noreferrer nofollow ugc';

/** Alt text for a picture a player linked: where it comes from, since nothing says what it shows. */
function altFor(src: string): string {
  try { return `Image from ${new URL(src).hostname}`; } catch { return 'Image from another site'; }
}

function nodes(list: readonly BbNode[], quoteLink: BbCodeProps['quoteLink']): ReactNode[] {
  return list.map((n, i) => node(n, i, quoteLink));
}

function node(n: BbNode, key: number, quoteLink: BbCodeProps['quoteLink']): ReactNode {
  switch (n.type) {
    case 'text': return n.text;
    case 'bold': return <strong key={key}>{nodes(n.children, quoteLink)}</strong>;
    case 'italic': return <em key={key}>{nodes(n.children, quoteLink)}</em>;
    case 'underline': return <u key={key}>{nodes(n.children, quoteLink)}</u>;
    case 'strike': return <s key={key}>{nodes(n.children, quoteLink)}</s>;
    case 'color': return <span key={key} style={{ color: n.color }}>{nodes(n.children, quoteLink)}</span>;
    case 'size': return <span key={key} className={`kb-bb-size-${n.size}`}>{nodes(n.children, quoteLink)}</span>;
    case 'url': {
      const inside = nodes(n.children, quoteLink);
      /* A path on this site moves within the app; every other address leaves it. */
      return n.href.startsWith('/')
        ? <Link key={key} to={n.href} rel={REL} referrerPolicy="no-referrer">{inside}</Link>
        : <a key={key} href={n.href} rel={REL} referrerPolicy="no-referrer">{inside}</a>;
    }
    case 'img':
      /* The parser keeps what the player wrote, http: included; the page's img-src is https only (web/headers.ts), so an http: image would be a broken picture. A link to it is what can be shown. */
      if (/^http:/i.test(n.src)) return <a key={key} href={n.src} rel={REL} referrerPolicy="no-referrer">image: {n.src}</a>;
      return <img key={key} className="kb-bb-img" src={n.src} alt={altFor(n.src)} loading="lazy" referrerPolicy="no-referrer" />;
    case 'quote':
      return (
        <blockquote key={key} className="kb-quote">
          <cite className="kb-quote-from">{quoteLink ? quoteLink(n.act) : 'Quoting an earlier post'}</cite>
          <div className="kb-quote-body">{nodes(n.children, quoteLink)}</div>
        </blockquote>
      );
    case 'code': return <pre key={key} className="kb-bb-code"><code>{n.text}</code></pre>;
    case 'list': {
      const items = n.items.map((item, i) => <li key={i}>{nodes(item, quoteLink)}</li>);
      return n.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
  }
}

/** A post's, a signature's or a preview's words as the page shows them. Parsed once per text. */
export const BbCode = memo(function BbCode({ text, quoteLink }: BbCodeProps) {
  const tree = useMemo(() => parse(text), [text]);
  return <div className="kb-bb">{nodes(tree, quoteLink)}</div>;
});
