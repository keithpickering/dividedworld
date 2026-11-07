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
import { Fragment, memo, useMemo, useState, type ReactNode } from 'react';
import { colorHex, FONTS, parse, type BbNode } from '../../bbcode/parse.ts';
import { visibleWalk } from '../../bbcode/visible.ts';
import { stretchesOf, useTextLayers, type Stretch } from './layers.tsx';
import { inkOn as bestInk } from '../contrast.ts';
import { Link } from '../router.tsx';
import { Video } from './Video.tsx';
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

/**
 * The text layers over this post's words (layers.tsx), where any are: the visible text and each text node's offset in it
 * (engine/bbcode/visible.ts), the stretches each run draws, and the replace stretches already drawn in this render.
 */
interface Layered {
  readonly text: string;
  readonly offsets: ReadonlyMap<BbNode, number>;
  readonly stretches: readonly Stretch[];
  readonly drawn: Set<Stretch>;
}

/** The first stretch that ends after `at`; the stretches are in order and cover the text end to end. */
function firstAfter(stretches: readonly Stretch[], at: number): number {
  let [lo, hi] = [0, stretches.length];
  while (lo < hi) { const mid = (lo + hi) >> 1; if (stretches[mid]!.end <= at) lo = mid + 1; else hi = mid; }
  return lo;
}

/** A text node's words under the layers: plain where no run is, each wrap piece by its run, a replace stretch once where it starts. */
function layeredText(n: Extract<BbNode, { type: 'text' | 'noparse' | 'autolink' }>, key: number, layered: Layered): ReactNode {
  const at = layered.offsets.get(n);
  if (at === undefined || !n.text) return n.text;
  const end = at + n.text.length;
  const out: ReactNode[] = [];
  for (let i = firstAfter(layered.stretches, at); i < layered.stretches.length && layered.stretches[i]!.start < end; i++) {
    const st = layered.stretches[i]!;
    const [from, to] = [Math.max(st.start, at), Math.min(st.end, end)];
    if (!st.run) out.push(n.text.slice(from - at, to - at));
    else if (st.run.mode === 'wrap') out.push(st.run.render({ text: n.text.slice(from - at, to - at), key: `${st.run.key}@${from}` }));
    else if (!layered.drawn.has(st)) {
      layered.drawn.add(st);
      out.push(st.run.render({ text: layered.text.slice(st.start, st.end), key: `${st.run.key}@${st.start}` }));
    }
  }
  return <Fragment key={key}>{out}</Fragment>;
}

/**
 * An inline spoiler: a black bar the width of its words while shut, the words themselves once pressed, and a second press shuts
 * it. Shut, its name is "Spoiler", so a screen reader does not read what the bar hides; open, its name is its words. The state
 * is the reader's alone: nothing stores it and nothing is sent.
 */
function ISpoiler({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" className="kb-bb-ispoiler" aria-expanded={open} aria-label={open ? undefined : 'Spoiler'} onClick={() => setOpen(!open)}>
      {children}
    </button>
  );
}

/**
 * A marquee: a moving line with a Pause / Play button before it, so the movement can be stopped from the keyboard or by touch
 * (WCAG 2.2.2). The state is the reader's alone. Under reduced motion nothing moves, so CSS hides the button.
 */
function Marquee({ children }: { readonly children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  return (
    <div className="kb-bb-marquee" data-paused={paused ? '' : undefined}>
      <button type="button" className="kb-bb-marquee-toggle" aria-pressed={paused} onClick={() => setPaused(!paused)}>
        {paused ? 'Play' : 'Pause'}
      </button>
      <span className="kb-bb-marquee-run">{children}</span>
    </div>
  );
}

/** The ink for a highlight: black or white, whichever has the higher contrast on the color, as a token so a theme cannot lose it. */
function inkOn(color: string): string {
  const hex = colorHex(color);
  return hex === null || bestInk(hex) === 'black' ? 'var(--kb-ink-black)' : 'var(--kb-ink-white)';
}

function nodes(list: readonly BbNode[], quoteLink: BbCodeProps['quoteLink'], layered?: Layered): ReactNode[] {
  return list.map((n, i) => node(n, i, quoteLink, layered));
}

function node(n: BbNode, key: number, quoteLink: BbCodeProps['quoteLink'], layered?: Layered): ReactNode {
  switch (n.type) {
    case 'text': case 'noparse': return layered ? layeredText(n, key, layered) : n.text;
    case 'autolink':
      return <a key={key} href={n.href} rel={REL} referrerPolicy="no-referrer">{layered ? layeredText(n, 0, layered) : n.text}</a>;
    case 'bold': return <strong key={key}>{nodes(n.children, quoteLink, layered)}</strong>;
    case 'italic': return <em key={key}>{nodes(n.children, quoteLink, layered)}</em>;
    case 'underline': return <u key={key}>{nodes(n.children, quoteLink, layered)}</u>;
    case 'strike': return <s key={key}>{nodes(n.children, quoteLink, layered)}</s>;
    case 'color': return <span key={key} style={{ color: n.color }}>{nodes(n.children, quoteLink, layered)}</span>;
    case 'size': return <span key={key} className={`kb-bb-size-${n.size}`}>{nodes(n.children, quoteLink, layered)}</span>;
    case 'url': {
      const inside = nodes(n.children, quoteLink, layered);
      /* A path on this site moves within the app; every other address leaves it. */
      return n.href.startsWith('/')
        ? <Link key={key} to={n.href} rel={REL} referrerPolicy="no-referrer">{inside}</Link>
        : <a key={key} href={n.href} rel={REL} referrerPolicy="no-referrer">{inside}</a>;
    }
    case 'img':
      /* The parser keeps what the player wrote, http: included; the page's img-src is https only (web/headers.ts), so an http: image would be a broken picture. A link to it is what can be shown. */
      if (/^http:/i.test(n.src)) return <a key={key} href={n.src} rel={REL} referrerPolicy="no-referrer">image: {n.src}</a>;
      return <img key={key} className="kb-bb-img" src={n.src} alt={altFor(n.src)} loading="lazy" referrerPolicy="no-referrer" />;
    case 'video': return <Video key={key} video={n.video} />;
    case 'quote':
      return (
        <blockquote key={key} className="kb-quote">
          <cite className="kb-quote-from">{quoteLink ? quoteLink(n.act) : 'Quoting an earlier post'}</cite>
          <div className="kb-quote-body">{nodes(n.children, quoteLink)}</div>
        </blockquote>
      );
    case 'counterfeit':
      /* Minimal for now: the head, the look and the wobble are built with the quote heads (plan, Task 10). */
      return (
        <blockquote key={key} className="kb-quote" data-kb-counterfeit="">
          <div className="kb-quote-body">{nodes(n.children, quoteLink, layered)}</div>
        </blockquote>
      );
    case 'spoiler':
      return (
        <details key={key} className="kb-bb-spoiler">
          <summary>{n.title}</summary>
          <div>{nodes(n.children, quoteLink, layered)}</div>
        </details>
      );
    case 'ispoiler': return <ISpoiler key={key}>{nodes(n.children, quoteLink, layered)}</ISpoiler>;
    case 'code': return <pre key={key} className="kb-bb-code"><code>{n.text}</code></pre>;
    case 'align': return <div key={key} className={`kb-bb-align-${n.align}`}>{nodes(n.children, quoteLink, layered)}</div>;
    case 'hr': return <hr key={key} className="kb-bb-hr" />;
    case 'sub': return <sub key={key}>{nodes(n.children, quoteLink, layered)}</sub>;
    case 'sup': return <sup key={key}>{nodes(n.children, quoteLink, layered)}</sup>;
    case 'font': return <span key={key} style={{ fontFamily: FONTS[n.font] }}>{nodes(n.children, quoteLink, layered)}</span>;
    case 'marquee':
      return <Marquee key={key}>{nodes(n.children, quoteLink, layered)}</Marquee>;
    case 'glow': {
      const c = n.color ?? 'var(--kb-fg)';
      return <span key={key} className="kb-bb-glow" style={{ textShadow: `0 0 0.2em ${c}, 0 0 0.45em ${c}` }}>{nodes(n.children, quoteLink, layered)}</span>;
    }
    case 'shadow':
      return <span key={key} className="kb-bb-shadow" style={{ textShadow: `0.08em 0.08em 0.1em ${n.color ?? 'var(--kb-fg)'}` }}>{nodes(n.children, quoteLink, layered)}</span>;
    case 'rainbow': return <span key={key} className="kb-bb-rainbow">{nodes(n.children, quoteLink, layered)}</span>;
    case 'highlight':
      return <mark key={key} className="kb-bb-highlight" style={{ backgroundColor: n.color, color: inkOn(n.color) }}>{nodes(n.children, quoteLink, layered)}</mark>;
    case 'list': {
      const items = n.items.map((item, i) => <li key={i}>{nodes(item, quoteLink, layered)}</li>);
      return n.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
  }
}

/** A post's, a signature's or a preview's words as the page shows them. Parsed once per text. */
export const BbCode = memo(function BbCode({ text, quoteLink }: BbCodeProps) {
  const tree = useMemo(() => parse(text), [text]);
  const runs = useTextLayers();
  // Only a post with layers over it is walked; one with none draws exactly as it always has. The walk reads the tree alone, so
  // it is kept while layers come and go, and only made again when the words change or the first layer arrives.
  const layeredOn = runs.length > 0;
  const walk = useMemo(() => (layeredOn ? visibleWalk(tree) : null), [tree, layeredOn]);
  const stretches = useMemo(() => (walk ? stretchesOf(walk.text.length, runs) : []), [walk, runs]);
  const layered = walk ? { text: walk.text, offsets: walk.offsets, stretches, drawn: new Set<Stretch>() } : undefined;
  return <div className="kb-bb">{nodes(tree, quoteLink, layered)}</div>;
});
