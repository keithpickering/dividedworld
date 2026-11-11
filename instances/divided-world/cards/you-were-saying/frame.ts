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
import type { WriteFrameInput } from '../../../../engine/rules/cards.ts';

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
 * The prompt and its stops. The post's own words lose only their leading space and their trailing space (a model's first token carries its
 * own), and each tail keeps its own edges, as the model wrote them, so the chain reads as one run; only a tail's line breaks become spaces.
 */
export function youWereSayingFrame(input: WriteFrameInput): { readonly prompt: string; readonly stop: readonly string[] } {
  const lines = [HEADER, `Thread: ${clip(input.title, TITLE_MOST)}`, ''];
  const post = (name: string, text: string): void => void lines.push(RULE, `${POSTED_BY}${clip(name, NAME_MOST)}:`, safeStart(text));
  for (const p of input.before.slice(-BEFORE_POSTS)) post(p.name, clip(p.text, BEFORE_MOST));
  post(input.post.name, lastChars(oneLine(input.post.text), POST_MOST) + input.tails.map(flat).join(''));
  return { prompt: lines.join('\n'), stop: STOPS };
}
