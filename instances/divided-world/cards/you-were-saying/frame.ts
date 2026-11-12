/**
 * The frame You Were Saying? gives the old voice (docs/plans/2026-11-07-you-were-saying-design.md, section 3): a 2003 thread page that
 * ends exactly where the post's words end, so the model continues the post mid-line. The prompt holds the header line, the thread's
 * title, then each post as a rule line (`---`), a header line this file makes (`Posted by Name:`) and the post's text on the next line,
 * the last post being the one the model continues, with the tails already chained on it. Nothing follows: no newline and no space is
 * added at the end.
 *
 * The frame's own caps, whatever the caller sends: the post's text is clipped from its START to its last 2,000 characters (the prompt
 * must end where the post ends), at a code-point boundary; at most the last 8 earlier posts are shown; lone surrogates are stripped
 * everywhere (a JSON endpoint can refuse them).
 *
 * Nobody's words can shape the page. Every name, title and earlier post is collapsed to one line, and so is the post and every tail, so
 * only this file puts a newline in the prompt. Each new post therefore begins with a line the frame wrote, and the stops, all of which
 * start with a newline, are what the model writes when it leaves the post: a rule, a post header, a quote or the page header again. A
 * player's words never reach the stops (names cannot be stops: the model can invent one). The one way a player's words could still start
 * a line the frame did not write is a body that begins with a stop's text (`---`, `Posted by `, `Quote:`, the header), because a body
 * sits at a line's start; such a body gets one leading space, the least surprising defense, which touches the start of a text and never
 * its end.
 */
import { FIT_TITLE_CHARS, type WriteFrameInput } from '../../../../engine/rules/cards.ts';

export const HEADER = 'Welcome to the Message Boards - Thread View';

const RULE = '---';
const POSTED_BY = 'Posted by ';
const QUOTE = 'Quote:';

/** Where the model has left the post: a rule, a post header, a quote, or the page's own header again. A newline starts each, so it is a line's start. */
export const STOPS: readonly string[] = Object.freeze([`\n${RULE}`, `\n${POSTED_BY}`, `\n${QUOTE}`, `\n${HEADER}`]);

const NAME_MOST = 60;
const TITLE_MOST = 200;
const BEFORE_MOST = 500;
const POST_MOST = 2000;
const BEFORE_POSTS = 8;

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
/** Every run of white space (a newline, a tab, a Unicode line separator, U+0085) becomes one space; a lone surrogate goes. */
const flat = (s: string): string => s.replace(LONE_SURROGATE, '').replace(/[\s\u0085]+/g, ' ');
const oneLine = (s: string): string => flat(s).trim();
const clip = (s: string, most: number): string => {
  const chars = [...oneLine(s)];
  return chars.length <= most ? chars.join('') : `${chars.slice(0, most).join('').trimEnd()}…`;
};
/** A text's last `most` characters, from a code-point boundary. */
const lastChars = (s: string, most: number): string => {
  const chars = [...s];
  return chars.length <= most ? s : chars.slice(-most).join('').trimStart();
};
/** A body on its own line must not begin with the text of a stop, or it would be a line the frame did not write. */
const safeStart = (s: string): string => (s.startsWith(RULE) || s.startsWith(POSTED_BY) || s.startsWith(QUOTE) || s.startsWith(HEADER) ? ` ${s}` : s);

/**
 * The prompt and its stops, fitted to `input.budget` tokens by `input.count` (docs/plans/2026-11-12-old-voice-window-design.md, section 3).
 * Under budget nothing changes. Over it, the frame gives up material in this order, each step only when the one before did not fit: the
 * earlier posts, oldest first, one at a time; the thread's title, clipped to 40 characters and then to none (`Thread:` and nothing after
 * it); the post's own text, clipped from its start; last, the text of the tails chained on it, clipped from its start, since its end is
 * where the model continues. A clip finds the most characters that fit by bisection (about a dozen counts for 2,000 characters), at a
 * code-point boundary. The page header, the post's author line and the end of the post's text with its tails (at least a character of
 * each that has any) are never removed; a budget even those cannot meet gets that smallest prompt, and the frame never throws (the
 * interface's `promptTooLong` refuses it before anything is sent).
 *
 * The post's words lose only their leading space and their trailing space (a model's first token carries its own), and each tail keeps its
 * own edges, as the model wrote them, so the chain reads as one run; only a tail's line breaks become spaces.
 */
export function youWereSayingFrame(input: WriteFrameInput): { readonly prompt: string; readonly stop: readonly string[] } {
  const earlier = input.before.slice(-BEFORE_POSTS).map((p) => ({ name: p.name, text: clip(p.text, BEFORE_MOST) }));
  const title = clip(input.title, TITLE_MOST);
  const postChars = [...lastChars(oneLine(input.post.text), POST_MOST)];
  const tailChars = [...input.tails.map(flat).join('')];
  const build = (dropped: number, titleText: string | null, postKept: number, tailKept: number): string => {
    const lines = [HEADER, titleText === null ? 'Thread:' : `Thread: ${titleText}`, ''];
    const post = (name: string, text: string): void => void lines.push(RULE, `${POSTED_BY}${clip(name, NAME_MOST)}:`, safeStart(text));
    for (const p of earlier.slice(dropped)) post(p.name, p.text);
    const kept = postKept === postChars.length ? postChars : postChars.slice(-postKept);
    // A clipped post loses its start the way an over-long one does: the first character is not a space.
    const text = (postKept === postChars.length ? kept.join('') : kept.join('').trimStart()) + (tailKept === tailChars.length ? tailChars : tailChars.slice(-tailKept)).join('');
    post(input.post.name, text);
    return lines.join('\n');
  };
  const done = (prompt: string) => ({ prompt, stop: STOPS });
  const fits = (prompt: string): boolean => input.count(prompt) <= input.budget;
  const postAll = postChars.length;
  const tailAll = tailChars.length;
  const postLeast = Math.min(1, postAll);
  const tailLeast = Math.min(1, tailAll);

  // The most characters, from `least` to `all`, that keep the prompt within budget; null where even `least` does not. `all` is known not to fit.
  const most = (least: number, all: number, at: (kept: number) => string): number | null => {
    if (!fits(at(least))) return null;
    let [lo, hi] = [least, all]; // lo fits, hi does not
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (fits(at(mid))) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  let dropped = 0;
  let prompt = build(0, title, postAll, tailAll);
  if (fits(prompt)) return done(prompt);
  while (dropped < earlier.length) {
    prompt = build(++dropped, title, postAll, tailAll);
    if (fits(prompt)) return done(prompt);
  }
  const titleClips: (string | null)[] = [];
  if ([...title].length > FIT_TITLE_CHARS) titleClips.push(clip(title, FIT_TITLE_CHARS));
  if (title !== '') titleClips.push(null);
  let shown: string | null = title;
  for (const t of titleClips) {
    shown = t;
    prompt = build(dropped, shown, postAll, tailAll);
    if (fits(prompt)) return done(prompt);
  }
  const postKept = most(postLeast, postAll, (k) => build(dropped, shown, k, tailAll));
  if (postKept !== null) return done(build(dropped, shown, postKept, tailAll));
  const tailKept = most(tailLeast, tailAll, (k) => build(dropped, shown, postLeast, k));
  return done(build(dropped, shown, postLeast, tailKept ?? tailLeast));
}
