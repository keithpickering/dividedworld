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
 * screen's to say, so the screen hands a `quoteHead` that draws the head of a quote (its author and its post's link). With none,
 * the quote is still a quote, without a link. A counterfeit quote (`[quote=Name]`, or a real quote the Act's verdict says is forged) quotes nobody's post: its name is plain text,
 * never a link, which is the cue a screen reader hears; its look (bbcode.css, Wobble.tsx) is the cue an eye sees.
 */
import { Fragment, memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { colorHex, FONTS, parse, type BbNode } from '../../bbcode/parse.ts';
import { visibleWalk } from '../../bbcode/visible.ts';
import { stretchesOf, useTextLayers, type Stretch, type TextRun } from './layers.tsx';
import { inkOn as bestInk } from '../contrast.ts';
import { CutNote } from './CutNote.tsx';
import { HiddenNote } from '../conduct/Hidden.tsx';
import { useKayfaIfAny } from '../context.tsx';
import { actLoader } from '../thread/locate.tsx';
import { Mini } from '../mini.tsx';
import { Link } from '../router.tsx';
import { Video } from './Video.tsx';
import './bbcode.css';

export interface BbCodeProps {
  readonly text: string;
  /** The head of a quote: who is quoted and where, by the quote's kind. */
  readonly quoteHead?: (q: QuoteOf) => ReactNode;
  /** The Act's verdict (its payload's `forged`, `forgedList`): the posts whose quotes in these words are doctored. A real quote of one is drawn as a counterfeit that names that post's author. */
  readonly forged?: readonly string[] | undefined;
}

/**
 * What a quote's head is asked to draw: a real quote names an Act; a counterfeit names what its player typed, and a forged quote (a real quote whose words are not in the post it names) also carries that
 * post's Act in `act`, for the head to draw its author, never a link. A counterfeit written as one has `act: null`.
 */
export type QuoteOf =
  | { readonly kind: 'real'; readonly act: string }
  | { readonly kind: 'counterfeit'; readonly user: string | null; readonly name: string | null; readonly act: string | null };

/** The head a quote has when the screen gives none: an earlier post, or a counterfeit's typed name and letter (never a link). */
function defaultHead(q: QuoteOf): ReactNode {
  if (q.kind === 'real') return 'Quoting an earlier post';
  if (q.name !== null) return <><Mini character={undefined} name={q.name} /><span className="kb-byline-name">{q.name}</span></>;
  return q.user === null && q.act === null ? 'Quote' : 'Someone';
}

const REL = 'noopener noreferrer nofollow ugc';

/** The count of pictures drawn so far in one render, in tree order and quotes included: `data-kb-img` on an image is its place in it, the same numbering `contentOf` (engine/rules/anchor.ts) gives, so a mark attached to an image finds it. An `http:` image is drawn as a link and takes no number. */
interface ImageCount { n: number }

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
  /** The standing trails (layers.tsx, `stands`) by the offset they are drawn at, each offset's runs in the order drawn, and the offsets ascending. */
  readonly standing: ReadonlyMap<number, readonly TextRun[]>;
  readonly standingAt: readonly number[];
  /** The standing offsets no text piece ends at (they fall in a gap of the walk): drawn once, before the words of the text node that starts there, so inside whatever wraps that node (`standingTrails` says what follows from that). */
  readonly leading: ReadonlySet<number>;
  /** The mark runs (layers.tsx, `mark`) by the offset they are drawn at, each offset's runs by `z` then list order, and the offsets ascending; `markLeading` is the offsets no text piece ends at, drawn before the words of the text node that starts there. */
  readonly marks: ReadonlyMap<number, readonly TextRun[]>;
  readonly markAt: readonly number[];
  readonly markLeading: ReadonlySet<number>;
}

/**
 * Where a standing run's trail is drawn: its end clamped to the text (the run is kept if not then empty), and then, by the text nodes' spans,
 * at that offset where a text piece ends at it or holds it inside; where it falls in a gap (a `\n` the walk puts for a quote, an [hr] and the like)
 * at the start of the next text node at or after it, and past the last text node, at the last one's end. At one offset the runs are by `z`
 * ascending, then list order; that holds across how they got there, so a run whose end is the last node's end and one whose end fell in a gap
 * after it and was moved there share the offset and are ordered the same way. Only a wrap run with a trail stands.
 *
 * A trail moved to the start of the next text node is drawn inside whatever wraps that node: `cats[hr][b]today[/b]` gives
 * `<strong><trail/>today</strong>`, under a closed spoiler it is hidden with those words, and under an autolink it is inside the `<a>`.
 * That is kept. A run whose end clamps into a text with no text node at all has nothing to draw its trail against, and the trail is dropped.
 */
function standingTrails(length: number, runs: readonly TextRun[], spans: readonly (readonly [number, number])[]): Pick<Layered, 'standing' | 'standingAt' | 'leading'> {
  const standing = new Map<number, TextRun[]>();
  const leading = new Set<number>();
  const ends = new Set(spans.map(([, e]) => e));
  const placed = (e: number): number => {
    if (ends.has(e) || spans.some(([s, f]) => s < e && e < f)) return e;
    const next = spans.find(([s]) => s >= e);
    if (next) { leading.add(next[0]); return next[0]; }
    return spans.length ? spans[spans.length - 1]![1] : e;
  };
  runs.map((run, i) => ({ run, i }))
    .filter(({ run }) => stands(run) && Math.min(run.end, length) > Math.max(0, run.start))
    .sort((a, b) => a.run.z - b.run.z || a.i - b.i)
    .forEach(({ run }) => {
      if (!spans.length) return;
      const e = placed(Math.min(run.end, length));
      standing.set(e, [...(standing.get(e) ?? []), run]);
    });
  return { standing, standingAt: [...standing.keys()].sort((a, b) => a - b), leading };
}

/**
 * Where a mark is drawn, by the same placing as a standing trail's: its offset clamped to the text; at the end of a text piece that ends there, or inside the piece
 * that holds it; where it falls in a gap, at the start of the next piece (leading); past the last, at the last piece's end. A text with no text piece draws none.
 */
function markPlaces(length: number, runs: readonly TextRun[], spans: readonly (readonly [number, number])[]): Pick<Layered, 'marks' | 'markAt' | 'markLeading'> {
  const marks = new Map<number, TextRun[]>();
  const markLeading = new Set<number>();
  const ends = new Set(spans.map(([, e]) => e));
  const placed = (o: number): number => {
    if (ends.has(o) || spans.some(([s, f]) => s < o && o < f)) return o;
    const next = spans.find(([s]) => s >= o);
    if (next) { markLeading.add(next[0]); return next[0]; }
    return spans[spans.length - 1]![1];
  };
  if (spans.length) {
    runs.map((run, i) => ({ run, i })).filter(({ run }) => run.mode === 'mark')
      .sort((a, b) => a.run.z - b.run.z || a.i - b.i)
      .forEach(({ run }) => {
        const o = placed(Math.max(0, Math.min(run.start, length)));
        marks.set(o, [...(marks.get(o) ?? []), run]);
      });
  }
  return { marks, markAt: [...marks.keys()].sort((a, b) => a - b), markLeading };
}

/** What a post has when no run is a mark. */
const NO_MARKS: Pick<Layered, 'marks' | 'markAt' | 'markLeading'> = { marks: new Map(), markAt: [], markLeading: new Set() };

/** The mark elements drawn at `o`, if any. */
const marksAt = (layered: Layered, o: number): ReactNode[] => (layered.marks.get(o) ?? []).map((r) => r.render({ text: '', key: `${r.key}~mark` }));

/** The offsets `o` with `lo < o < hi` that a standing trail or a mark is drawn at, ascending. */
function cutsBetween(layered: Layered, lo: number, hi: number): number[] {
  const inside = (list: readonly number[]): number[] => {
    let [a, b] = [0, list.length];
    while (a < b) { const mid = (a + b) >> 1; if (list[mid]! <= lo) a = mid + 1; else b = mid; }
    const found: number[] = [];
    for (; a < list.length && list[a]! < hi; a++) found.push(list[a]!);
    return found;
  };
  const [x, y] = [inside(layered.standingAt), inside(layered.markAt)];
  return y.length === 0 ? x : [...new Set([...x, ...y])].sort((p, q) => p - q);
}

/** Whether a run draws a standing trail. */
const stands = (run: TextRun): boolean => run.mode === 'wrap' && run.stands === true && run.trail !== undefined;

/** What a post has when no run stands: one table for all of them, so such a post allocates nothing for it. */
const NO_STANDING: Pick<Layered, 'standing' | 'standingAt' | 'leading'> = { standing: new Map(), standingAt: [], leading: new Set() };

/** The standing trails drawn at `e`, if any. */
const trailsAt = (layered: Layered, e: number): ReactNode[] => (layered.standing.get(e) ?? []).map((r) => r.trail!(`${r.key}~trail`));

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
  const cuts = layered.standingAt.length > 0 || layered.markAt.length > 0;
  if (cuts && layered.leading.has(at)) out.push(...trailsAt(layered, at));
  if (cuts && layered.markLeading.has(at)) out.push(...marksAt(layered, at));
  for (let i = firstAfter(layered.stretches, at); i < layered.stretches.length && layered.stretches[i]!.start < end; i++) {
    const st = layered.stretches[i]!;
    const [from, to] = [Math.max(st.start, at), Math.min(st.end, end)];
    if (!st.run || st.run.mode === 'wrap') {
      // Plain words and a wrap piece are cut at every standing offset inside them, each part drawn as the piece was.
      let part = from;
      for (const e of cuts ? [...cutsBetween(layered, from, to), to] : [to]) {
        const words = n.text.slice(part - at, e - at);
        out.push(st.run ? st.run.render({ text: words, key: `${st.run.key}@${part}` }) : words);
        // The trail follows the piece that ends the run's drawn words: the stretch ends here, and at the run's own end (not under a higher run).
        // A run that stands draws its trail by the standing rule, once.
        if (e === to && st.run?.trail && !st.run.stands && st.end === to && st.end === Math.min(st.run.end, layered.text.length)) out.push(st.run.trail(`${st.run.key}~trail`));
        if (cuts) out.push(...trailsAt(layered, e), ...marksAt(layered, e));
        part = e;
      }
    }
    else if (!layered.drawn.has(st)) {
      layered.drawn.add(st);
      out.push(st.run.render({ text: layered.text.slice(st.start, st.end), key: `${st.run.key}@${st.start}` }));
      // A leading trail is drawn at its own node's start, so the replace stretch passing over it does not draw it too.
      if (cuts) {
        for (const e of cutsBetween(layered, st.start, st.end + 1)) {
          if (!layered.leading.has(e)) out.push(...trailsAt(layered, e));
          if (!layered.markLeading.has(e)) out.push(...marksAt(layered, e));
        }
      }
    }
  }
  return <Fragment key={key}>{out}</Fragment>;
}

/**
 * An inline spoiler: a black bar the width of its words while shut, the words themselves once pressed, and a second press shuts
 * it. Shut, its words sit in an aria-hidden span and a visually hidden "Spoiler" is its name (from content, so WCAG 2.5.3 holds), so a screen reader does not read what the bar hides; open, its name is its words. The state
 * is the reader's alone: nothing stores it and nothing is sent.
 */
function ISpoiler({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" className="kb-bb-ispoiler" aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? children : <><span aria-hidden="true">{children}</span><span className="kb-visually-hidden">Spoiler</span></>}
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
      <button type="button" className="kb-bb-marquee-toggle" data-kb-quotable="hidden" aria-pressed={paused} onClick={() => setPaused(!paused)}>
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

/** Whether a quote has nothing in it: either the conceal job emptied it (concealQuotes, 0340) or a player wrote it empty. */
const concealed = (children: readonly BbNode[]): boolean => children.every((c) => (c.type === 'text' || c.type === 'noparse') && c.text.trim() === '');

/**
 * What stands in an empty quote: the hidden note only when the quoted post really has a hidden version now (`acts_public.any_hidden`, the predicate that empties a quote), read for its
 * cite already by the located-act cache. The glass never claims an admin hid what is not hidden ("The fiction may lie; the log never does"), so an empty quote a player typed
 * by hand, or one read where no backend is at hand, is drawn as the empty quote it is.
 */
function EmptyQuote({ act }: { readonly act: string }) {
  const kayfa = useKayfaIfAny();
  const api = kayfa?.api;
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!api) return undefined;
    let live = true;
    void actLoader(api).ask(act).then((k) => { if (live) setHidden(k?.hidden === true); });
    return () => { live = false; };
  }, [api, act]);
  return hidden ? <HiddenNote /> : null;
}

function nodes(list: readonly BbNode[], quoteHead: BbCodeProps['quoteHead'], layered: Layered | undefined, imgs: ImageCount): ReactNode[] {
  return list.map((n, i) => node(n, i, quoteHead, layered, imgs));
}

function node(n: BbNode, key: number, quoteHead: BbCodeProps['quoteHead'], layered: Layered | undefined, imgs: ImageCount): ReactNode {
  switch (n.type) {
    case 'text': case 'noparse': return layered ? layeredText(n, key, layered) : n.text;
    case 'autolink':
      return <a key={key} href={n.href} rel={REL} referrerPolicy="no-referrer">{layered ? layeredText(n, 0, layered) : n.text}</a>;
    case 'bold': return <strong key={key}>{nodes(n.children, quoteHead, layered, imgs)}</strong>;
    case 'italic': return <em key={key}>{nodes(n.children, quoteHead, layered, imgs)}</em>;
    case 'underline': return <u key={key}>{nodes(n.children, quoteHead, layered, imgs)}</u>;
    case 'strike': return <s key={key}>{nodes(n.children, quoteHead, layered, imgs)}</s>;
    case 'color': return <span key={key} style={{ color: n.color }}>{nodes(n.children, quoteHead, layered, imgs)}</span>;
    case 'size': return <span key={key} className={`kb-bb-size-${n.size}`}>{nodes(n.children, quoteHead, layered, imgs)}</span>;
    case 'url': {
      const inside = nodes(n.children, quoteHead, layered, imgs);
      /* A path on this site moves within the app; every other address leaves it. */
      return n.href.startsWith('/')
        ? <Link key={key} to={n.href} rel={REL} referrerPolicy="no-referrer">{inside}</Link>
        : <a key={key} href={n.href} rel={REL} referrerPolicy="no-referrer">{inside}</a>;
    }
    case 'img':
      /* The parser keeps what the player wrote, http: included; the page's img-src is https only (web/headers.ts), so an http: image would be a broken picture. A link to it is what can be shown; its "image: " words are the page's, and an image has no words in a post's text, so a highlight leaves them out (a quote holds only the post's own words, forged-quotes design, section 4). */
      if (/^http:/i.test(n.src)) return <a key={key} href={n.src} rel={REL} referrerPolicy="no-referrer" data-kb-quotable="hidden">image: {n.src}</a>;
      return <img key={key} className="kb-bb-img" src={n.src} alt={altFor(n.src)} loading="lazy" referrerPolicy="no-referrer" data-kb-img={imgs.n++} />;
    case 'video': return <Video key={key} video={n.video} />;
    case 'quote':
      return (
        <blockquote key={key} className="kb-quote">
          <cite className="kb-quote-from">{(quoteHead ?? defaultHead)({ kind: 'real', act: n.act })}</cite>
          <div className="kb-quote-body">{concealed(n.children) ? <EmptyQuote act={n.act} /> : nodes(n.children, quoteHead, undefined, imgs)}</div>
        </blockquote>
      );
    case 'cut':
      /* The head of the first Act cut, as any real quote's; nothing else is asked of the Act loader, so a cut never depends on whether the quoted post is hidden. */
      return (
        <blockquote key={key} className="kb-quote" data-kb-cut="">
          <cite className="kb-quote-from">{(quoteHead ?? defaultHead)({ kind: 'real', act: n.acts[0]! })}</cite>
          <div className="kb-quote-body"><CutNote /></div>
        </blockquote>
      );
    case 'counterfeit':
      return (
        <blockquote key={key} className="kb-quote" data-kb-counterfeit="">
          <cite className="kb-quote-from">{(quoteHead ?? defaultHead)({ kind: 'counterfeit', user: n.user, name: n.name, act: n.act })}</cite>
          <div className="kb-quote-body">{nodes(n.children, quoteHead, layered, imgs)}</div>
        </blockquote>
      );
    case 'spoiler':
      return (
        <details key={key} className="kb-bb-spoiler">
          <summary>{n.title}</summary>
          <div>{nodes(n.children, quoteHead, layered, imgs)}</div>
        </details>
      );
    case 'ispoiler': return <ISpoiler key={key}>{nodes(n.children, quoteHead, layered, imgs)}</ISpoiler>;
    case 'code': return <pre key={key} className="kb-bb-code"><code>{n.text}</code></pre>;
    case 'align': return <div key={key} className={`kb-bb-align-${n.align}`}>{nodes(n.children, quoteHead, layered, imgs)}</div>;
    case 'hr': return <hr key={key} className="kb-bb-hr" />;
    case 'sub': return <sub key={key}>{nodes(n.children, quoteHead, layered, imgs)}</sub>;
    case 'sup': return <sup key={key}>{nodes(n.children, quoteHead, layered, imgs)}</sup>;
    case 'font': return <span key={key} style={{ fontFamily: FONTS[n.font] }}>{nodes(n.children, quoteHead, layered, imgs)}</span>;
    case 'marquee':
      return <Marquee key={key}>{nodes(n.children, quoteHead, layered, imgs)}</Marquee>;
    case 'glow': {
      const c = n.color ?? 'var(--kb-fg)';
      return <span key={key} className="kb-bb-glow" style={{ textShadow: `0 0 0.2em ${c}, 0 0 0.45em ${c}` }}>{nodes(n.children, quoteHead, layered, imgs)}</span>;
    }
    case 'shadow':
      return <span key={key} className="kb-bb-shadow" style={{ textShadow: `0.08em 0.08em 0.1em ${n.color ?? 'var(--kb-fg)'}` }}>{nodes(n.children, quoteHead, layered, imgs)}</span>;
    case 'rainbow': return <span key={key} className="kb-bb-rainbow">{nodes(n.children, quoteHead, layered, imgs)}</span>;
    case 'highlight':
      return <mark key={key} className="kb-bb-highlight" style={{ backgroundColor: n.color, color: inkOn(n.color) }}>{nodes(n.children, quoteHead, layered, imgs)}</mark>;
    case 'list': {
      const items = n.items.map((item, i) => <li key={i}>{nodes(item, quoteHead, layered, imgs)}</li>);
      return n.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
  }
}

/** A post's, a signature's or a preview's words as the page shows them. Parsed once per text. */
export const BbCode = memo(function BbCode({ text, quoteHead, forged }: BbCodeProps) {
  /* The verdict is keyed by its ids, so a list made again with the same ids does not parse the words again. */
  const verdict = forged && forged.length > 0 ? forged.join(',') : '';
  const tree = useMemo(() => parse(text, undefined, verdict === '' ? undefined : new Set(verdict.split(','))), [text, verdict]);
  const runs = useTextLayers();
  // Only a post with layers over it is walked; one with none draws exactly as it always has. The walk reads the tree alone, so
  // it is kept while layers come and go, and only made again when the words change or the first layer arrives.
  const layeredOn = runs.length > 0;
  const walk = useMemo(() => (layeredOn ? visibleWalk(tree) : null), [tree, layeredOn]);
  const stretches = useMemo(() => (walk ? stretchesOf(walk.text.length, runs) : []), [walk, runs]);
  // The text pieces' spans, in the walk's order, which is ascending: `visibleWalk` fills `offsets` as it reads the tree in order, each text node
  // at the text's length so far, and a Map keeps insertion order, so no sort is needed. Built only where some run stands.
  const anyStands = runs.some(stands);
  const anyMarks = runs.some((r) => r.mode === 'mark');
  const spans = useMemo(() => {
    if (!walk || !(anyStands || anyMarks)) return null;
    const out: [number, number][] = [];
    for (const [n, o] of walk.offsets) if ((n.type === 'text' || n.type === 'noparse' || n.type === 'autolink') && n.text) out.push([o, o + n.text.length]);
    return out;
  }, [walk, anyStands, anyMarks]);
  const standing = useMemo(() => (!walk ? null : spans && anyStands ? standingTrails(walk.text.length, runs, spans) : NO_STANDING), [walk, spans, anyStands, runs]);
  const marked = useMemo(() => (!walk ? null : spans && anyMarks ? markPlaces(walk.text.length, runs, spans) : NO_MARKS), [walk, spans, anyMarks, runs]);
  const layered = walk && standing && marked ? { text: walk.text, offsets: walk.offsets, stretches, drawn: new Set<Stretch>(), ...standing, ...marked } : undefined;
  return <div className="kb-bb">{nodes(tree, quoteHead, layered, { n: 0 })}</div>;
});
